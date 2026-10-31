using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using Microsoft.VisualStudio.Threading;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Panel
{
  public sealed class NativeUi : IDisposable
  {
    private readonly JoinableTaskFactory factory;
    private readonly Action<string> failure;
    private readonly UiText text;
    private readonly SemaphoreSlim prompts = new SemaphoreSlim(1);
    private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
    private readonly Dictionary<string, Window> status = new Dictionary<string, Window>(StringComparer.Ordinal);
    private readonly Dictionary<string, (Window Window, CommandBinding Binding, KeyBinding? Key, RoutedUICommand Command)> commands = new Dictionary<string, (Window, CommandBinding, KeyBinding?, RoutedUICommand)>(StringComparer.Ordinal);
    private bool disposed;
    public MhpPeer? Peer { private get; set; }
    public NativeUi(JoinableTaskFactory factory, UiText text, Action<string> failure) { this.factory = factory; this.text = text; this.failure = failure; }

    public async Task<JToken> InvokeAsync(string method, JObject parameters, CancellationToken cancellation)
    {
      using (var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellation, lifetime.Token))
      {
        await factory.SwitchToMainThreadAsync(linked.Token);
        linked.Token.ThrowIfCancellationRequested();
        if (disposed) throw new MhpException("cancelled", "MHP_UI_CLOSED");
        switch (method)
        {
          case "ui/clipboard": Clipboard.SetText(parameters.Value<string>("text") ?? ""); return JValue.CreateNull();
          case "ui/openExternal":
            var uri = new Uri(parameters.Value<string>("uri") ?? throw Invalid());
            if (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp) throw Invalid();
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            return JValue.CreateNull();
          case "ui/status":
          case "ui/progress": return UpdateStatus(method, parameters);
          case "commands/register": return Register(parameters);
          default:
            await prompts.WaitAsync(linked.Token);
            try
            {
              await factory.SwitchToMainThreadAsync(linked.Token);
              linked.Token.ThrowIfCancellationRequested();
              return Prompt(method, parameters, linked.Token);
            }
            finally { prompts.Release(); }
        }
      }
    }

    private JToken Prompt(string method, JObject parameters, CancellationToken cancellation)
    {
      RequireUIThread();
      var title = parameters.Value<string>("title") ?? text.Manifest("displayName");
      var window = new Window { Title = title, Width = 560, SizeToContent = SizeToContent.Height, MaxHeight = 640, WindowStartupLocation = WindowStartupLocation.CenterOwner, Owner = Application.Current?.MainWindow };
      var content = new StackPanel { Margin = new Thickness(16) };
      AutomationProperties.SetName(content, title);
      var message = parameters.Value<string>("message") ?? parameters.Value<string>("prompt") ?? "";
      content.Children.Add(new TextBlock { Text = message, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 16) });
      var buttons = new WrapPanel { HorizontalAlignment = HorizontalAlignment.Right };
      JToken result = JValue.CreateNull();
      void Choose(JToken value) { if (cancellation.IsCancellationRequested) return; result = value.DeepClone(); window.DialogResult = true; }
      Button Button(string label, Action run, bool cancel = false)
      {
        var button = new Button { Content = label, Margin = new Thickness(4), Padding = new Thickness(12, 6, 12, 6), IsCancel = cancel };
        AutomationProperties.SetName(button, label); button.Click += (sender, args) => run(); buttons.Children.Add(button); return button;
      }
      switch (method)
      {
        case "ui/confirm":
          foreach (var choice in parameters["choices"] as JArray ?? throw Invalid())
            Button(choice.Value<string>("title") ?? throw Invalid(), () => Choose(choice["id"] ?? throw Invalid()));
          break;
        case "ui/input":
          var input = new TextBox { Text = parameters.Value<string>("value") ?? "", MinWidth = 320, Margin = new Thickness(0, 0, 0, 12) };
          AutomationProperties.SetName(input, message); content.Children.Add(input);
          Button(text["fallbackContinue"], () => Choose(new JValue(input.Text)));
          window.Loaded += (sender, args) => { input.Focus(); input.SelectAll(); };
          break;
        case "ui/pick":
          var list = new ListBox { SelectionMode = parameters.Value<bool>("multiple") ? SelectionMode.Multiple : SelectionMode.Single, MaxHeight = 360 };
          AutomationProperties.SetName(list, title);
          foreach (var choice in parameters["items"] as JArray ?? throw Invalid()) list.Items.Add(new ListBoxItem { Content = choice.Value<string>("title"), Tag = choice["id"]?.DeepClone() });
          content.Children.Add(list);
          Button(text["fallbackContinue"], () => Choose(new JArray(list.SelectedItems.OfType<ListBoxItem>().Select(item => item.Tag))));
          window.Loaded += (sender, args) => list.Focus();
          break;
        case "ui/notify": Button(text["fallbackContinue"], () => Choose(JValue.CreateNull())); break;
        default: throw new MhpException("unsupportedCapability", "MHP_UNSUPPORTED_CAPABILITY");
      }
      Button(text["questionCancel"], () => window.Close(), true);
      content.Children.Add(buttons); window.Content = content;
      // No default Allow button; choices keep their supplied opaque IDs.
      using (cancellation.Register(() => Observe(async () => { await factory.SwitchToMainThreadAsync(); window.Close(); }))) window.ShowDialog();
      cancellation.ThrowIfCancellationRequested();
      return result;
    }

    private JToken UpdateStatus(string method, JObject parameters)
    {
      RequireUIThread();
      var identifier = parameters["id"] ?? throw Invalid();
      var id = identifier.Type == JTokenType.Integer || identifier.Type == JTokenType.Float
        ? "number:" + identifier.Value<long>().ToString(System.Globalization.CultureInfo.InvariantCulture)
        : "string:" + identifier.Value<string>();
      var visible = method == "ui/status" ? parameters.Value<bool>("visible") : !parameters.Value<bool>("done");
      if (status.TryGetValue(id, out var previous)) { status.Remove(id); previous.Close(); }
      if (!visible) return JValue.CreateNull();
      var title = parameters.Value<string>("text") ?? parameters.Value<string>("title") ?? throw Invalid();
      var window = new Window { Title = title, Width = 360, SizeToContent = SizeToContent.Height, ShowActivated = false, ShowInTaskbar = false, Owner = Application.Current?.MainWindow };
      var stack = new StackPanel { Margin = new Thickness(12) };
      stack.Children.Add(new TextBlock { Text = parameters.Value<string>("message") ?? title, TextWrapping = TextWrapping.Wrap });
      if (parameters["fraction"] != null) stack.Children.Add(new ProgressBar { Minimum = 0, Maximum = 1, Value = parameters.Value<double>("fraction"), Height = 16 });
      else if (method == "ui/progress") stack.Children.Add(new ProgressBar { IsIndeterminate = true, Height = 16 });
      if (parameters.Value<string>("command") is string command)
      {
        if (!commands.ContainsKey(command)) throw new MhpException("invalidParams", "MHP_COMMAND_NOT_REGISTERED");
        var button = new Button { Content = title };
        button.Click += (sender, args) => Execute(command);
        stack.Children.Add(button);
      }
      window.Content = stack; status.Add(id, window); window.Show();
      return JValue.CreateNull();
    }
    public void Dispose()
    {
      RequireUIThread();
      if (disposed) return; disposed = true; lifetime.Cancel(); Peer = null;
      foreach (var window in status.Values) window.Close(); status.Clear();
      foreach (var entry in commands.Values) { entry.Window.CommandBindings.Remove(entry.Binding); if (entry.Key != null) entry.Window.InputBindings.Remove(entry.Key); }
      commands.Clear();
    }
    private JToken Register(JObject parameters)
    {
      RequireUIThread();
      var owner = Application.Current?.MainWindow ?? throw new MhpException("internalError", "MHP_NATIVE_WINDOW_UNAVAILABLE");
      var id = parameters.Value<string>("id") ?? throw Invalid();
      var title = parameters.Value<string>("title") ?? throw Invalid();
      var command = new RoutedUICommand(title, id, typeof(NativeUi));
      var binding = new CommandBinding(command, (sender, args) => Execute(id));
      KeyBinding? key = null;
      if (parameters.Value<string>("suggestedKey") is string suggestion)
      {
        var gesture = new KeyGestureConverter().ConvertFromInvariantString(suggestion) as KeyGesture ?? throw Invalid();
        key = new KeyBinding(command, gesture);
      }
      if (commands.TryGetValue(id, out var previous)) { previous.Window.CommandBindings.Remove(previous.Binding); if (previous.Key != null) previous.Window.InputBindings.Remove(previous.Key); }
      owner.CommandBindings.Add(binding); if (key != null) owner.InputBindings.Add(key);
      commands[id] = (owner, binding, key, command);
      return JValue.CreateNull();
    }
    public Menu CommandMenu()
    {
      RequireUIThread();
      var menu = new Menu();
      var header = new MenuItem { Header = text["commandsTitle"] };
      header.SubmenuOpened += (sender, args) =>
      {
        header.Items.Clear();
        foreach (var entry in commands.Values)
        {
          var command = entry.Command;
          header.Items.Add(new MenuItem { Header = command.Text, Command = command, CommandTarget = entry.Window });
        }
      };
      menu.Items.Add(header); return menu;
    }
    private void Execute(string id) => Observe(async () =>
    {
      if (disposed || !commands.ContainsKey(id)) throw new MhpException("cancelled", "MHP_UI_CLOSED");
      await (Peer ?? throw new MhpException("cancelled", "MHP_UI_CLOSED")).NotifyAsync("commands/execute", new JObject { ["id"] = id });
    });
    private void RequireUIThread() { if (!factory.Context.IsOnMainThread) throw new InvalidOperationException("MHP_UI_THREAD_REQUIRED"); }
    private void Observe(Func<Task> work)
    {
      _ = factory.RunAsync(async () =>
      {
        try { await work(); }
        catch (OperationCanceledException) { }
        catch (Exception) { failure("MHP_UI_ACTION_FAILED"); }
      });
    }
    private static MhpException Invalid() => new MhpException("invalidParams", "MHP_INVALID_PARAMS");
  }
}
