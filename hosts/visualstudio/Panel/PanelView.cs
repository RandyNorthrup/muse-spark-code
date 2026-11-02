using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Panel
{
  public sealed class PanelView : Grid, IDisposable
  {
    private readonly WebView2 browser = new WebView2();
    private readonly PanelChannel channel;
    private readonly JoinableTaskFactory taskFactory;
    private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
    private string? bootstrapId;
    private bool disposed;
    private bool loaded;
    private bool navigatingAgain;

    public PanelView(PanelChannel channel, JoinableTaskFactory taskFactory)
    {
      this.channel = channel; this.taskFactory = taskFactory;
      Children.Add(browser);
      IsVisibleChanged += VisibilityChanged;
    }

    public async Task InitializeAsync(string assets, string browserData, UiText text, string kind)
    {
      await taskFactory.SwitchToMainThreadAsync(lifetime.Token);
      var environment = await CoreWebView2Environment.CreateAsync(null, browserData);
      lifetime.Token.ThrowIfCancellationRequested();
      await browser.EnsureCoreWebView2Async(environment);
      lifetime.Token.ThrowIfCancellationRequested();
      var core = browser.CoreWebView2;
      core.Settings.AreDevToolsEnabled = false;
      core.Settings.AreDefaultContextMenusEnabled = false;
      core.Settings.IsStatusBarEnabled = false;
      core.Settings.IsPasswordAutosaveEnabled = false;
      core.Settings.IsGeneralAutofillEnabled = false;
      core.SetVirtualHostNameToFolderMapping(AssetPolicy.VirtualHost, assets, CoreWebView2HostResourceAccessKind.DenyCors);
      core.NavigationStarting += Navigating;
      core.FrameNavigationStarting += FrameNavigating;
      core.NewWindowRequested += NewWindow;
      core.PermissionRequested += Permission;
      core.DownloadStarting += Download;
      core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
      core.WebResourceRequested += Resource;
      core.WebMessageReceived += WebMessage;
      core.NavigationCompleted += NavigationComplete;
      bootstrapId = await core.AddScriptToExecuteOnDocumentCreatedAsync(channel.DocumentBootstrap);
      lifetime.Token.ThrowIfCancellationRequested();
      channel.MessageReceived += RuntimeMessage;
      core.Navigate(AssetPolicy.Origin + "/webview/" + (kind == "tasks" ? "tasks." : "index.") + text.Locale + ".html");
    }

    private void Navigating(object? sender, CoreWebView2NavigationStartingEventArgs args)
    {
      if (!AssetPolicy.IsAssetUri(args.Uri)) { args.Cancel = true; return; }

      if (!loaded || navigatingAgain) { navigatingAgain = false; return; }
      args.Cancel = true;
      taskFactory.RunAsync(async () =>
      {
        await channel.ReloadAsync();
        await taskFactory.SwitchToMainThreadAsync(lifetime.Token);
        if (bootstrapId != null) browser.CoreWebView2.RemoveScriptToExecuteOnDocumentCreated(bootstrapId);
        bootstrapId = await browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(channel.DocumentBootstrap);
        navigatingAgain = true;
        browser.CoreWebView2.Navigate(args.Uri);
      }).FileAndForget("MuseSpark/PanelReload");
    }
    private static void FrameNavigating(object? sender, CoreWebView2NavigationStartingEventArgs args) { args.Cancel = true; }
    private void VisibilityChanged(object sender, DependencyPropertyChangedEventArgs args)
    {
      if (loaded && !IsVisible) taskFactory.RunAsync(() => channel.HiddenAsync()).FileAndForget("MuseSpark/PanelHidden");
    }
    private static void NewWindow(object? sender, CoreWebView2NewWindowRequestedEventArgs args) { args.Handled = true; }
    private static void Permission(object? sender, CoreWebView2PermissionRequestedEventArgs args) { args.State = CoreWebView2PermissionState.Deny; }
    private static void Download(object? sender, CoreWebView2DownloadStartingEventArgs args) { args.Cancel = true; }
    private void Resource(object? sender, CoreWebView2WebResourceRequestedEventArgs args)
    {
      if (!AssetPolicy.IsAssetUri(args.Request.Uri))
        args.Response = browser.CoreWebView2.Environment.CreateWebResourceResponse(Stream.Null, 403, "MHP_REMOTE_RESOURCE_DENIED", "Content-Type: text/plain\r\nCache-Control: no-store\r\n");
    }
    private void NavigationComplete(object? sender, CoreWebView2NavigationCompletedEventArgs args)
    {
      loaded = args.IsSuccess;
    }

    private void WebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
      if (!AssetPolicy.IsAssetUri(args.Source)) return;
      taskFactory.RunAsync(async () =>
      {
        try
        {
          await channel.PostAsync(channel.ParseWebviewMessage(args.WebMessageAsJson), lifetime.Token);
        }
        catch (OperationCanceledException) { }
        catch (JsonException) { /* Reject malformed browser input without logging it. */ }
        // A page message the frozen vocabulary refuses is logged by its fixed code; the page keeps its surface.
        catch (Protocol.MhpException error) { ActivityLog.LogWarning("Muse Spark Code (Unofficial)", error.Message); }
      }).FileAndForget("MuseSpark/PanelMessage");
    }

    private void RuntimeMessage(object sender, JToken message)
    {
      taskFactory.Run(async () =>
      {
        try
        {
          await taskFactory.SwitchToMainThreadAsync(lifetime.Token);
          browser.CoreWebView2.PostWebMessageAsJson(channel.ParseRuntimeMessage(message).ToString(Formatting.None));
        }
        catch (OperationCanceledException) { }
        catch (JsonException) { /* Reject malformed runtime input without logging it. */ }
        catch (Protocol.MhpException) { /* A channel or page boundary rejected this message. */ }
      });
    }

    // What the page shows a person, read as text: the conformance suite's proof that the runtime's frames rendered.
    internal Task<string> EvaluateAsync(string script) => browser.CoreWebView2.ExecuteScriptAsync(script);

    public void Dispose()
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      if (disposed) return; disposed = true;
      lifetime.Cancel();
      try
      {
        taskFactory.Run(async () =>
        {
          using (var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5)))
            await channel.CloseAsync().WithCancellation(deadline.Token);
        });
      }
      catch (OperationCanceledException) { ActivityLog.LogWarning("Muse Spark Code (Unofficial)", "MHP_PANEL_CLOSE_FAILED"); }
      catch (Protocol.MhpException) { ActivityLog.LogWarning("Muse Spark Code (Unofficial)", "MHP_PANEL_CLOSE_FAILED"); }
      IsVisibleChanged -= VisibilityChanged;
      channel.MessageReceived -= RuntimeMessage;
      channel.Dispose();
      var core = browser.CoreWebView2;
      if (core != null)
      {
        core.NavigationStarting -= Navigating; core.FrameNavigationStarting -= FrameNavigating;
        core.NewWindowRequested -= NewWindow; core.PermissionRequested -= Permission; core.DownloadStarting -= Download;
        core.WebResourceRequested -= Resource; core.WebMessageReceived -= WebMessage; core.NavigationCompleted -= NavigationComplete;
        if (bootstrapId != null) core.RemoveScriptToExecuteOnDocumentCreated(bootstrapId);
        core.ClearVirtualHostNameToFolderMapping(AssetPolicy.VirtualHost);
      }
      browser.Dispose(); lifetime.Dispose();
    }
  }
}
