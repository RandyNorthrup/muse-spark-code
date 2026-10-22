using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Panel
{
  public sealed class NativeSurfaces : IDisposable
  {
    private sealed class Surface
    {
      public PanelChannel Channel { get; }
      public PanelView View { get; }
      public IVsWindowFrame Frame { get; }
      public MuseToolWindow Window { get; }
      public Surface(PanelChannel channel, PanelView view, IVsWindowFrame frame, MuseToolWindow window) { Channel = channel; View = view; Frame = frame; Window = window; }
    }
    private readonly AsyncPackage package;
    private readonly string assets;
    private readonly UiText text;
    private readonly NativeUi ui;
    private readonly Dictionary<string, Surface> surfaces = new Dictionary<string, Surface>(StringComparer.Ordinal);
    private int nextWindow;
    private bool disposed;
    public MhpPeer? Peer { private get; set; }
    public JObject? Theme { private get; set; }

    public NativeSurfaces(AsyncPackage package, string assets, UiText text, NativeUi ui) { this.package = package; this.assets = assets; this.text = text; this.ui = ui; }
    public async Task<JToken> InvokeAsync(string method, JObject parameters, CancellationToken cancellation)
    {
      await package.JoinableTaskFactory.SwitchToMainThreadAsync(cancellation);
      if (disposed) throw new MhpException("cancelled", "MHP_SURFACE_CLOSED");
      if (method == "surfaces/open")
      {
        var kind = parameters.Value<string>("kind") ?? throw Invalid();
        // Authored HTML for What's New must come from C's presentation port.
        if (kind != "chat" && kind != "tasks") throw new MhpException("unsupportedCapability", "MHP_AUXILIARY_RENDER_UNAVAILABLE");
        var session = parameters.Value<string>("sessionId") ?? throw Invalid();
        var id = "visual-studio:" + Guid.NewGuid().ToString("N");
        var window = await package.ShowToolWindowAsync(typeof(MuseToolWindow), nextWindow++, true, cancellation) as MuseToolWindow ?? throw Invalid();
        var frame = window.Frame as IVsWindowFrame ?? throw Invalid();
        var channel = new PanelChannel(Peer ?? throw Invalid(), SchemaContract.Load(), id, session, kind, Theme ?? throw Invalid());
        var view = new PanelView(channel, package.JoinableTaskFactory);
        channel.Faulted += (sender, code) => package.JoinableTaskFactory.RunAsync(() => FaultedAsync(id, channel, code)).FileAndForget("MuseSpark/PanelFaulted");
        try
        {
          await channel.OpenAsync();
          window.Caption = text.Manifest("displayName");
          var container = new DockPanel();
          var menu = ui.CommandMenu(); DockPanel.SetDock(menu, Dock.Top);
          container.Children.Add(menu); container.Children.Add(view);
          window.Content = container;
          await view.InitializeAsync(assets, text, kind);
          cancellation.ThrowIfCancellationRequested();
          if (disposed || channel.FaultCode != null) throw new OperationCanceledException();
          surfaces.Add(id, new Surface(channel, view, frame, window));
          return new JObject { ["surfaceId"] = id };
        }
        catch { view.Dispose(); frame.Hide(); throw; }
      }
      var surfaceId = parameters.Value<string>("surfaceId") ?? throw Invalid();
      if (!surfaces.TryGetValue(surfaceId, out var held)) throw Invalid();
      switch (method)
      {
        case "surfaces/close":
          surfaces.Remove(surfaceId);
          try { await held.Channel.CloseAsync(); }
          finally { held.View.Dispose(); held.Frame.Hide(); }
          return JValue.CreateNull();
        case "surfaces/focus": held.Frame.Show(); held.View.Focus(); return JValue.CreateNull();
        case "surfaces/state": return new JObject { ["visible"] = held.Frame.IsVisible() == Microsoft.VisualStudio.VSConstants.S_OK, ["focused"] = held.View.IsKeyboardFocusWithin };
        default: throw Invalid();
      }
    }

    // The channel already sent `closed`; the window shows the fixed identifier instead of a desynchronized page.
    private async Task FaultedAsync(string id, PanelChannel channel, string code)
    {
      await package.JoinableTaskFactory.SwitchToMainThreadAsync();
      if (!surfaces.TryGetValue(id, out var held) || !ReferenceEquals(held.Channel, channel)) return;
      surfaces.Remove(id);
      held.View.Dispose();
      held.Window.Content = new TextBlock { Text = text["crashTitle"] + Environment.NewLine + code, TextWrapping = TextWrapping.Wrap };
    }

    public void Dispose()
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      disposed = true; Peer = null;
      foreach (var surface in surfaces.Values) { surface.View.Dispose(); surface.Frame.Hide(); }
      surfaces.Clear();
    }
    private static MhpException Invalid() => new MhpException("invalidParams", "MHP_SURFACE_UNAVAILABLE");
  }
}
