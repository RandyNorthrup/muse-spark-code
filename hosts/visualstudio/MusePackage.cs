using System;
using System.ComponentModel.Design;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Controls;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.ComponentModelHost;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Microsoft.VisualStudio.TextManager.Interop;
using MuseSpark.VisualStudio.Editor;
using MuseSpark.VisualStudio.Panel;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json.Linq;
using Microsoft.VisualStudio.PlatformUI;

namespace MuseSpark.VisualStudio
{
  [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
  [ProvideMenuResource("Menus.ctmenu", 1)]
  [ProvideToolWindow(typeof(MuseToolWindow), MultiInstances = true, Style = VsDockStyle.Tabbed, Window = ToolWindowGuids80.SolutionExplorer)]
  [Guid(PackageId)]
  public sealed class MusePackage : AsyncPackage
  {
    public const string PackageId = "640cd42d-9e16-4d8c-9bd5-b48b640e1b7c";
    public const string CommandSetId = "c8bb17e8-cf85-48a4-9f28-b0f4c83a9e06";
    private const int OpenCommandId = 0x0100;
    private VisualStudioHost? host;
    private RuntimeProcess? runtime;
    private NativeSurfaces? surfaces;
    private NativeUi? ui;
    private UiText? text;
    private TabCompletion? completion;
    private bool opening;
    // The conformance suite drives the live connection inside the experimental instance.
    internal VisualStudioHost? Host => host;
    internal MhpPeer? Peer => runtime?.Peer;
    internal NativeSurfaces? Surfaces => surfaces;
    internal string? StartFailure { get; private set; }

    protected override async Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
    {
      await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
      if (await GetServiceAsync(typeof(IMenuCommandService)) is OleMenuCommandService commands)
      {
        var command = new OleMenuCommand((sender, args) => JoinableTaskFactory.RunAsync(OpenAsync).FileAndForget("MuseSpark/Open"), new CommandID(new Guid(CommandSetId), OpenCommandId));
        commands.AddCommand(command);
      }
      else throw new InvalidOperationException("MHP_MENU_SERVICE_UNAVAILABLE");
    }

    private async Task OpenAsync()
    {
      await JoinableTaskFactory.SwitchToMainThreadAsync(DisposalToken);
      MuseToolWindow? window = null;
      var starts = false;
      try
      {
        var assets = Path.Combine(Path.GetDirectoryName(typeof(MusePackage).Assembly.Location) ?? throw new InvalidOperationException("MHP_ASSET_ROOT_UNAVAILABLE"), "assets");
        text = text ?? new UiText(assets);
        window = await ShowToolWindowAsync(typeof(MuseToolWindow), 0, true, DisposalToken) as MuseToolWindow ?? throw new InvalidOperationException("MHP_TOOL_WINDOW_UNAVAILABLE");
        window.Caption = text.Manifest("displayName");
        if (runtime != null || opening) return;
        opening = true;
        starts = true;
        StartFailure = null;
        if (!(await GetServiceAsync(typeof(SComponentModel)) is IComponentModel components)) throw new InvalidOperationException("MHP_COMPONENT_MODEL_UNAVAILABLE");
        if (!(await GetServiceAsync(typeof(SVsRunningDocumentTable)) is IVsRunningDocumentTable rdt) || !(await GetServiceAsync(typeof(SVsTextManager)) is IVsTextManager textManager))
          throw new InvalidOperationException("MHP_EDITOR_SERVICE_UNAVAILABLE");
        completion = components.GetService<TabCompletion>() ?? throw new InvalidOperationException("MHP_TAB_SERVICE_UNAVAILABLE");
        var errorList = await GetServiceAsync(typeof(SVsErrorList)) as IVsTaskList;
        Action<string> log = identifier => ActivityLog.LogError("Muse Spark Code (Unofficial)", identifier);
        ui = new NativeUi(JoinableTaskFactory, text, log);
        // Per hive, so an experimental instance never shares browser data or a scratch folder with the person's own.
        var dataFolder = Path.Combine(new Microsoft.VisualStudio.Shell.Settings.ShellSettingsManager(this).GetApplicationDataFolder(Microsoft.VisualStudio.Settings.ApplicationDataFolder.LocalSettings), "MuseSparkCode");
        surfaces = new NativeSurfaces(this, assets, Path.Combine(dataFolder, "WebView2"), text, ui);
        host = new VisualStudioHost(this, components, rdt, textManager, completion, errorList, surfaces, ui);
        var workspace = Path.Combine(dataFolder, "scratch");
        if (await GetServiceAsync(typeof(SVsSolution)) is IVsSolution solution && solution.GetSolutionInfo(out var directory, out _, out _) == VSConstants.S_OK && !string.IsNullOrEmpty(directory)) workspace = directory;
        Directory.CreateDirectory(workspace);
        var location = await Task.Run(() => RuntimeLocator.Find(assets, Environment.GetEnvironmentVariable("PATH") ?? "", Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData)), DisposalToken);
        await JoinableTaskFactory.SwitchToMainThreadAsync(DisposalToken);
        runtime = new RuntimeProcess(location.Node, location.Entry, workspace, host, JoinableTaskFactory, location.Helper);
        runtime.Peer.Log = log;
        host.Peer = runtime.Peer;
        surfaces.Peer = runtime.Peer;
        ui.Peer = runtime.Peer;
        completion.Attach(runtime.Peer, () => text["insertCode"]);
        using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(DisposalToken))
        {
          deadline.CancelAfter(TimeSpan.FromSeconds(30));
          var theme = CurrentTheme();
          surfaces.Theme = theme;
          var application = (await GetServiceAsync(typeof(EnvDTE.DTE)) as EnvDTE.DTE) ?? throw new InvalidOperationException("MHP_HOST_VERSION_UNAVAILABLE");
          var version = System.Diagnostics.FileVersionInfo.GetVersionInfo(application.FullName).ProductVersion ?? throw new InvalidOperationException("MHP_HOST_VERSION_UNAVAILABLE");
          await runtime.Peer.InitializeAsync(new JObject
          {
            ["host"] = new JObject { ["id"] = "visual-studio", ["version"] = version },
            ["protocolRange"] = SchemaContract.Load().Export["range"]?.DeepClone(),
            ["capabilities"] = new JArray(host.Capabilities),
            ["locale"] = text.Locale,
            ["theme"] = theme,
            ["folders"] = new JArray(new JObject { ["uri"] = new Uri(workspace + Path.DirectorySeparatorChar).AbsoluteUri, ["name"] = new DirectoryInfo(workspace).Name }),
            // No implicit solution-trust grant; a native trust adapter is a separate checkpoint.
            ["trusted"] = false
          }, deadline.Token);
        }
        // The runtime opens the first chat through surfaces/open once the handshake is answered.
        VSColorTheme.ThemeChanged += OnThemeChanged;
      }
      catch (Exception error)
      {
        // Startup errors can contain private paths or accounts; show and log only a fixed identifier.
        await JoinableTaskFactory.SwitchToMainThreadAsync();
        Release();
        var code = error is InvalidOperationException && (error.Message == "MHP_NODE_22_REQUIRED" || error.Message == "MHP_ACP_PANEL_PACKAGE_REQUIRED" || error.Message == "MHP_JOB_HELPER_NOT_INSTALLED") || error is MhpException && error.Message.StartsWith("MHP_", StringComparison.Ordinal) ? error.Message : "MHP_PANEL_START_FAILED";
        StartFailure = code + " " + Describe(error);
        ActivityLog.LogError("Muse Spark Code (Unofficial)", StartFailure);
        if (window != null && text != null) window.Show(new TextBlock { Text = text["crashTitle"] + Environment.NewLine + code, TextWrapping = System.Windows.TextWrapping.Wrap });
      }
      finally { if (starts) opening = false; }
    }

    // Type, result code and our own frame: enough to place a failure, with no text the failure chose.
    private static string Describe(Exception error)
    {
      var frames = new System.Diagnostics.StackTrace(error, false).GetFrames()?.Select(f => f.GetMethod()).ToArray() ?? Array.Empty<System.Reflection.MethodBase>();
      var names = frames.Take(6).Select(m => m?.DeclaringType?.Name + "." + m?.Name);
      return error.GetType().Name + " 0x" + error.HResult.ToString("X8", System.Globalization.CultureInfo.InvariantCulture) + " " + string.Join(" < ", names);
    }

    private static JObject CurrentTheme()
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      var background = VSColorTheme.GetThemedColor(EnvironmentColors.ToolWindowBackgroundColorKey);
      var foreground = VSColorTheme.GetThemedColor(EnvironmentColors.ToolWindowTextColorKey);
      var isLight = background.GetBrightness() > 0.5;
      return new JObject
      {
        ["kind"] = System.Windows.SystemParameters.HighContrast ? (isLight ? "highContrastLight" : "highContrastDark") : (isLight ? "light" : "dark"),
        ["tokens"] = new JObject { ["--muse-editorBackground"] = Color(background), ["--muse-foreground"] = Color(foreground) }
      };
    }

    private void OnThemeChanged(ThemeChangedEventArgs args)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      var peer = runtime?.Peer;
      if (peer == null || surfaces == null) return;
      var theme = CurrentTheme();
      surfaces.Theme = theme;
      JoinableTaskFactory.RunAsync(() => peer.NotifyAsync("window/didChangeTheme", new JObject { ["theme"] = theme })).FileAndForget("MuseSpark/ThemeChanged");
    }

    private void Release()
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      VSColorTheme.ThemeChanged -= OnThemeChanged;
      try { completion?.Attach(null, null); surfaces?.Dispose(); ui?.Dispose(); }
      finally
      {
        try { host?.Dispose(); }
        finally
        {
          try { runtime?.Dispose(); }
          catch (Exception) { ActivityLog.LogError("Muse Spark Code (Unofficial)", "MHP_RUNTIME_CLOSE_FAILED"); }
          finally { completion = null; surfaces = null; ui = null; host = null; runtime = null; }
        }
      }
    }

    private static string Color(System.Drawing.Color value) => "#" + value.R.ToString("x2", System.Globalization.CultureInfo.InvariantCulture) + value.G.ToString("x2", System.Globalization.CultureInfo.InvariantCulture) + value.B.ToString("x2", System.Globalization.CultureInfo.InvariantCulture);

    protected override void Dispose(bool disposing)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      if (disposing) Release();
      base.Dispose(disposing);
    }
  }

  [Guid("9eae6020-a381-4bca-a67f-4bbd160b0474")]
  public sealed class MuseToolWindow : ToolWindowPane
  {
    // The shell refuses a pane without content (E_UNEXPECTED) and hosts the element it was given for the pane's
    // whole life: the panel or its startup error goes inside it, so WebView2 finds a loaded parent.
    private readonly Grid root = new Grid();
    public MuseToolWindow() : base(null) { Content = root; }
    internal void Show(System.Windows.UIElement element) { root.Children.Clear(); root.Children.Add(element); }
  }
}
