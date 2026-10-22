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
    private readonly IPanelChannel channel;
    private readonly JoinableTaskFactory taskFactory;
    private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
    private readonly PanelInbox inbox;
    private string? bootstrapId;
    private bool disposed;
    private bool loaded;

    public PanelView(IPanelChannel channel, JoinableTaskFactory taskFactory)
    {
      this.channel = channel; this.taskFactory = taskFactory;
      inbox = new PanelInbox(channel.ParseRuntimeMessage, json => browser.CoreWebView2.PostWebMessageAsJson(json));
      Children.Add(browser);
    }

    public async Task InitializeAsync(string assets, UiText text, string kind = "chat")
    {
      await taskFactory.SwitchToMainThreadAsync(lifetime.Token);
      var userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MuseSparkCode", "VisualStudio", "WebView2");
      var environment = await CoreWebView2Environment.CreateAsync(null, userData);
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
      core.FrameNavigationStarting += Navigating;
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
      inbox.Navigating();
      if (loaded && channel is PanelChannel relay)
        taskFactory.RunAsync(async () => { await relay.ReloadAsync(); }).FileAndForget("MuseSpark/PanelReload");
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
      inbox.Loaded(args.IsSuccess);
      loaded = args.IsSuccess;
    }

    private void WebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
      if (!AssetPolicy.IsAssetUri(args.Source)) return;
      taskFactory.RunAsync(async () =>
      {
        try { await channel.PostAsync(channel.ParseWebviewMessage(args.WebMessageAsJson), lifetime.Token); }
        catch (OperationCanceledException) { }
        catch (JsonException) { /* Reject malformed browser input without logging it. */ }
        catch (Protocol.MhpException) { /* The injected zod boundary rejected this message. */ }
      }).FileAndForget("MuseSpark/PanelMessage");
    }

    private void RuntimeMessage(object sender, JToken message)
    {
      taskFactory.RunAsync(async () =>
      {
        try
        {
          await taskFactory.SwitchToMainThreadAsync(lifetime.Token);
          inbox.Receive(message);
        }
        catch (OperationCanceledException) { }
        catch (JsonException) { /* Reject malformed runtime input without logging it. */ }
        catch (Protocol.MhpException) { /* A channel or page boundary rejected this message. */ }
      }).FileAndForget("MuseSpark/PanelRuntimeMessage");
    }

    public void Dispose()
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      if (disposed) return; disposed = true;
      lifetime.Cancel();
      inbox.Clear();
      channel.MessageReceived -= RuntimeMessage;
      channel.Dispose();
      var core = browser.CoreWebView2;
      if (core != null)
      {
        core.NavigationStarting -= Navigating; core.FrameNavigationStarting -= Navigating;
        core.NewWindowRequested -= NewWindow; core.PermissionRequested -= Permission; core.DownloadStarting -= Download;
        core.WebResourceRequested -= Resource; core.WebMessageReceived -= WebMessage; core.NavigationCompleted -= NavigationComplete;
        if (bootstrapId != null) core.RemoveScriptToExecuteOnDocumentCreated(bootstrapId);
        core.ClearVirtualHostNameToFolderMapping(AssetPolicy.VirtualHost);
      }
      browser.Dispose(); lifetime.Dispose();
    }
  }
}
