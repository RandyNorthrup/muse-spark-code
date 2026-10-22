using System;
using System.ComponentModel.Design;
using System.IO;
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
      var assets = Path.Combine(Path.GetDirectoryName(typeof(MusePackage).Assembly.Location) ?? throw new InvalidOperationException("MHP_ASSET_ROOT_UNAVAILABLE"), "assets");
      text = text ?? new UiText(assets);
      var window = await ShowToolWindowAsync(typeof(MuseToolWindow), 0, true, DisposalToken) as MuseToolWindow ?? throw new InvalidOperationException("MHP_TOOL_WINDOW_UNAVAILABLE");
      window.Caption = text.Manifest("displayName");
      if (runtime != null || opening) return;
      opening = true;
      try
      {
        if (!(await GetServiceAsync(typeof(SComponentModel)) is IComponentModel components)) throw new InvalidOperationException("MHP_COMPONENT_MODEL_UNAVAILABLE");
        if (!(await GetServiceAsync(typeof(SVsRunningDocumentTable)) is IVsRunningDocumentTable rdt) || !(await GetServiceAsync(typeof(SVsTextManager)) is IVsTextManager textManager))
          throw new InvalidOperationException("MHP_EDITOR_SERVICE_UNAVAILABLE");
        completion = components.GetService<TabCompletion>() ?? throw new InvalidOperationException("MHP_TAB_SERVICE_UNAVAILABLE");
        var errorList = await GetServiceAsync(typeof(SVsErrorList)) as IVsTaskList;
        Action<string> log = identifier => ActivityLog.LogError("Muse Spark Code (Unofficial)", identifier);
        ui = new NativeUi(JoinableTaskFactory, text, log);
        surfaces = new NativeSurfaces(this, assets, text, ui);
        host = new VisualStudioHost(this, components, rdt, textManager, completion, errorList, surfaces, ui);
        var workspace = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MuseSparkCode", "VisualStudio", "scratch");
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
          var background = VSColorTheme.GetThemedColor(EnvironmentColors.ToolWindowBackgroundColorKey);
          var foreground = VSColorTheme.GetThemedColor(EnvironmentColors.ToolWindowTextColorKey);
          var isLight = background.GetBrightness() > 0.5;
          var theme = new JObject
          {
            ["kind"] = System.Windows.SystemParameters.HighContrast ? (isLight ? "highContrastLight" : "highContrastDark") : (isLight ? "light" : "dark"),
            ["tokens"] = new JObject { ["--muse-editorBackground"] = Color(background), ["--muse-foreground"] = Color(foreground) }
          };
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
        var channel = new MhpPanelChannel(runtime.Peer, Guid.NewGuid().ToString("N"), "chat", File.ReadAllText(Path.Combine(assets, "embedded-bridge.js")), message => ActivityLog.LogWarning("Muse Spark Code (Unofficial)", message));
        await channel.OpenAsync();
        panel = new PanelView(channel, JoinableTaskFactory);
        window.Content = panel;
        await panel.InitializeAsync(assets, text);
      }
      catch (Exception error)
      {
        // Startup errors can contain private paths or accounts; show only a fixed identifier.
        await JoinableTaskFactory.SwitchToMainThreadAsync();
        Release();
        var code = error is InvalidOperationException && (error.Message == "MHP_NODE_22_REQUIRED" || error.Message == "MHP_ACP_PANEL_PACKAGE_REQUIRED" || error.Message == "MHP_JOB_HELPER_NOT_INSTALLED") ? error.Message : "MHP_PANEL_START_FAILED";
        window.Content = new TextBlock { Text = text["crashTitle"] + Environment.NewLine + code, TextWrapping = System.Windows.TextWrapping.Wrap };
      }
      finally { opening = false; }
    }

    private void Release()
    {
      ThreadHelper.ThrowIfNotOnUIThread();
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
    public MuseToolWindow() : base(null) { }
  }
}
