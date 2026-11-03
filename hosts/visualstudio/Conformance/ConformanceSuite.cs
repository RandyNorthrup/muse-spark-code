using System;
using System.Collections.Generic;
using System.ComponentModel.Design;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.ComponentModelHost;
using Microsoft.VisualStudio.Editor;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Microsoft.VisualStudio.Text;
using Microsoft.VisualStudio.Text.Editor;
using Microsoft.VisualStudio.Text.Operations;
using Microsoft.VisualStudio.TextManager.Interop;
using MuseSpark.VisualStudio.Panel;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Xunit;

namespace MuseSpark.VisualStudio.Conformance
{
  // Drives test/hostApi/scenarios/contract.json inside a Visual Studio experimental instance. The installed VSIX
  // opens through its real command and starts this tree's packed agent (conformance.ps1 installs it where the
  // product's locator finds an npm install, a PATH folder's node_modules) with panel --stdio through the real job
  // helper. The runtime opens its chat surface in the real tool window, where the real WebView2 page shakes hands
  // with it and shows the sign-in state the scratch home really has. Host-owned legs then drive the production
  // VisualStudioHost on real text buffers; the runtime-owned legs (checkpoint, diff-hunks) spawn the node drivers in
  // test/unit/hostDrivers, as the JetBrains and Eclipse suites do. No session starts and no model is called.
  // The runner (node hosts/visualstudio/run.mjs) validates the observations this writes.
  public sealed class ConformanceSuite
  {
    private const string HostName = "visualstudio";
    private const string PackageId = "640cd42d-9e16-4d8c-9bd5-b48b640e1b7c";
    private const string CommandSet = "{c8bb17e8-cf85-48a4-9f28-b0f4c83a9e06}";
    private const int OpenCommand = 0x0100;
    private const string UndoLabel = "Conformance edit";
    private const int MaximumUndos = 8;
    private const string SignedOutText = "Muse Code is not signed in";
    private const string FatalCardText = "The Panel Hit an Error";
    private const string VisibleText = "document.body.innerText";
    private const string PaintFacts = "(() => { const root = document.documentElement, style = getComputedStyle(root); return JSON.stringify({ theme: root.dataset.msTheme, foreground: style.getPropertyValue('--vscode-foreground').trim(), text: style.color, surface: style.backgroundColor }); })()";
    private static readonly TimeSpan CardSettle = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan OpenDeadline = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan SettleDeadline = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan DriverDeadline = TimeSpan.FromMinutes(2);
    private static readonly string[] ScratchVariables = { "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP" };

    private sealed class Layout
    {
      public string Root { get; }
      public string Contract { get; }
      public string Observations { get; }
      public string RunDriver { get; }
      public string Node { get; }
      public string Scratch { get; }
      public Layout()
      {
        Root = RepositoryRoot();
        Contract = Environment.GetEnvironmentVariable("MUSE_CONFORMANCE_CONTRACT") ?? Path.Combine(Root, "test", "hostApi", "scenarios", "contract.json");
        Observations = Environment.GetEnvironmentVariable("MUSE_CONFORMANCE_OBSERVATIONS") ?? Path.Combine(Root, "hosts", "visualstudio", "conformance-observations.json");
        RunDriver = Path.Combine(Root, "test", "unit", "hostDrivers", "runDriver.mjs");
        Node = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator).Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => Path.Combine(p.Trim('"'), "node.exe")).First(File.Exists);
        Scratch = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), "muse-vs-conformance-" + Guid.NewGuid().ToString("N"))).FullName;
        foreach (var required in new[] { Contract, RunDriver }) if (!File.Exists(required)) throw new InvalidOperationException("MHP_CONFORMANCE_HARNESS_FAILED");
      }

      private static string RepositoryRoot()
      {
        // Set by the runner; the suite runs inside devenv, whose current directory is not the checkout.
        var configured = Environment.GetEnvironmentVariable("MUSE_CONFORMANCE_ROOT");
        if (!string.IsNullOrEmpty(configured)) return configured;
        for (var directory = new DirectoryInfo(Path.GetDirectoryName(typeof(ConformanceSuite).Assembly.Location) ?? ""); directory != null; directory = directory.Parent)
          if (File.Exists(Path.Combine(directory.FullName, "test", "hostApi", "scenarios", "contract.json"))) return directory.FullName;
        throw new InvalidOperationException("MHP_CONFORMANCE_HARNESS_FAILED");
      }
    }

    [IdeFact(RootSuffix = "MuseConf", MinVersion = VisualStudioVersion.VS2022, MaxVersion = VisualStudioVersion.VS2022, MaxAttempts = 1)]
    public async Task ContractAgainstProductionRuntimeAsync()
    {
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      // This suite carries no copy of the product: its reference binds to what the hive installed from the VSIX,
      // so the package is loaded first and nothing above DriveContractAsync names one of its types.
      AppDomain.CurrentDomain.AssemblyResolve += (_, request) => AppDomain.CurrentDomain.GetAssemblies().FirstOrDefault(assembly => assembly.FullName == request.Name);
      var shell = await ServiceProvider.GetGlobalServiceAsync<SVsShell, IVsShell>();
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      var packageId = new Guid(PackageId);
      ErrorHandler.ThrowOnFailure(shell.LoadPackage(ref packageId, out var loaded));
      await DriveContractAsync(loaded);
    }

    private static async Task DriveContractAsync(IVsPackage loaded)
    {
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      var layout = new Layout();
      var contract = JObject.Parse(File.ReadAllText(layout.Contract));
      var legs = RunnableLegs(contract);
      Assert.NotEmpty(legs);
      var live = await OpenPanelAsync(layout, loaded as MusePackage ?? throw new InvalidOperationException("MHP_CONFORMANCE_HARNESS_FAILED"));
      var observed = new JObject();
      foreach (var leg in legs)
      {
        try { observed[leg.Backend + "/" + leg.Scenario] = await DriveAsync(layout, live, leg); }
        catch (Exception error) { throw new InvalidOperationException(leg.Backend + "/" + leg.Scenario + ": " + error.Message, error); }
        finally { CloseEveryDocument(live.Dte); }
      }
      WriteIdeState(live.Dte);
      Directory.CreateDirectory(Path.GetDirectoryName(layout.Observations) ?? throw new InvalidOperationException("MHP_CONFORMANCE_HARNESS_FAILED"));
      File.WriteAllText(layout.Observations, new JObject { ["observations"] = observed }.ToString(Formatting.None));
    }

    // What a person sees below the editor on a green run, beside the harness's own logs: each Output pane with its
    // line count and last lines, and every Error List entry. A pane or an entry of ours would be a defect.
    private static void WriteIdeState(DTE2 dte)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      var logs = Environment.GetEnvironmentVariable("XUNIT_LOGS");
      if (string.IsNullOrEmpty(logs)) return;
      var state = new System.Text.StringBuilder();
      foreach (OutputWindowPane pane in dte.ToolWindows.OutputWindow.OutputWindowPanes)
      {
        try
        {
          var document = pane.TextDocument;
          var lines = document.StartPoint.CreateEditPoint().GetText(document.EndPoint).Split('\n');
          state.AppendLine("pane [" + pane.Name + "] " + lines.Length.ToString(System.Globalization.CultureInfo.InvariantCulture) + " lines");
          foreach (var line in lines.Skip(Math.Max(0, lines.Length - 4))) state.AppendLine("  " + line.TrimEnd());
        }
        // A pane that was never written has no document yet.
        catch (System.Runtime.InteropServices.COMException) { state.AppendLine("pane [" + pane.Name + "] no document"); }
      }
      var errors = dte.ToolWindows.ErrorList.ErrorItems;
      state.AppendLine("error list " + errors.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) + " entries");
      for (var index = 1; index <= errors.Count; index++) state.AppendLine("  " + errors.Item(index).ErrorLevel + " " + errors.Item(index).Description);
      File.WriteAllText(Path.Combine(logs, "ide-state.txt"), state.ToString());
    }

    private sealed class Leg
    {
      public string Backend { get; }
      public string Scenario { get; }
      public Leg(string backend, string scenario) { Backend = backend; Scenario = scenario; }
    }

    private static List<Leg> RunnableLegs(JObject contract)
    {
      var legs = new List<Leg>();
      foreach (var backend in contract["backends"]?.Values<string>().OfType<string>() ?? Enumerable.Empty<string>())
        foreach (var scenario in contract["scenarios"]?.Select(s => s.Value<string>("id")).OfType<string>() ?? Enumerable.Empty<string>())
          if (!(contract["waiting"] as JArray ?? new JArray()).Any(w => w.Value<string>("backend") == backend && w.Value<string>("scenario") == scenario && (w["hosts"] == null || w["hosts"]!.Values<string>().Contains(HostName))))
            legs.Add(new Leg(backend, scenario));
      return legs;
    }

    private sealed class Live
    {
      public MusePackage Package { get; }
      public Editor.VisualStudioHost Host { get; }
      public MhpPeer Peer { get; }
      public DTE2 Dte { get; }
      public string Workspace { get; }
      public IComponentModel Components { get; }
      public Live(MusePackage package, Editor.VisualStudioHost host, MhpPeer peer, DTE2 dte, string workspace, IComponentModel components) { Package = package; Host = host; Peer = peer; Dte = dte; Workspace = workspace; Components = components; }
    }

    // The product's own way in: the View menu's command on the installed package, in a saved solution's folder.
    private static async Task<Live> OpenPanelAsync(Layout layout, MusePackage package)
    {
      var dte = await ServiceProvider.GetGlobalServiceAsync<SDTE, DTE2>();
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      var workspace = Directory.CreateDirectory(Path.Combine(layout.Scratch, "workspace")).FullName;
      dte.Solution.Create(workspace, "conformance");
      dte.Solution.SaveAs(Path.Combine(workspace, "conformance.sln"));
      // The runtime's user data stays in scratch: no conformance run touches the person's real store. The window is
      // short: RuntimeProcess snapshots the variables when it starts, and every other process here is the instance's own.
      var home = Directory.CreateDirectory(Path.Combine(layout.Scratch, "home")).FullName;
      var saved = ScratchVariables.ToDictionary(name => name, Environment.GetEnvironmentVariable);
      foreach (var name in ScratchVariables) Environment.SetEnvironmentVariable(name, home);
      object input = null!;
      object output = null!;
      try
      {
        dte.Commands.Raise(CommandSet, OpenCommand, ref input, ref output);
        await WaitAsync(() =>
        {
          if (package.StartFailure != null) throw new InvalidOperationException(package.StartFailure);
          return package.Peer != null;
        }, OpenDeadline, "MHP_PANEL_START_FAILED");
      }
      finally { foreach (var name in ScratchVariables) Environment.SetEnvironmentVariable(name, saved[name]); }
      var surfaces = package.Surfaces ?? throw new InvalidOperationException("MHP_CONFORMANCE_HARNESS_FAILED");
      // The runtime asked for the chat surface, the real page loaded in WebView2, sent its ready and received the
      // runtime's first frames (theme, init, auth state).
      await WaitAsync(() =>
      {
        if (package.StartFailure != null) throw new InvalidOperationException(package.StartFailure);
        return surfaces.Channels.Any(channel => channel.LastReceivedSequence > 0);
      }, OpenDeadline, "MHP_PANEL_NOT_READY");
      // The page rendered what the runtime sent: the sign-in state its scratch home really has, and not its fatal
      // card, which sits over a page that had already rendered. No picture needed.
      string shown = "";
      var rendering = Stopwatch.StartNew();
      while (!shown.Contains(SignedOutText))
      {
        if (rendering.Elapsed > SettleDeadline) throw new InvalidOperationException("MHP_PANEL_NOT_RENDERED: " + shown);
        shown = await surfaces.Views[0].EvaluateAsync(VisibleText);
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
        if (!shown.Contains(SignedOutText)) await Task.Delay(250);
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      }
      await Task.Delay(CardSettle);
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      shown = await surfaces.Views[0].EvaluateAsync(VisibleText);
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      if (shown.Contains(FatalCardText)) throw new InvalidOperationException("MHP_PANEL_FATAL_CARD");
      // The panel is painted and readable: the theme bridge took the page, and its text is not its background.
      var paint = JToken.Parse(JToken.Parse(await surfaces.Views[0].EvaluateAsync(PaintFacts)).Value<string>() ?? "{}");
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      if (string.IsNullOrEmpty(paint.Value<string>("theme")) || string.IsNullOrEmpty(paint.Value<string>("foreground")) || paint.Value<string>("text") == paint.Value<string>("surface")) throw new InvalidOperationException("MHP_PANEL_UNREADABLE " + paint.ToString(Formatting.None));
      var components = await ServiceProvider.GetGlobalServiceAsync<SComponentModel, IComponentModel>();
      return new Live(package, package.Host ?? throw new InvalidOperationException("MHP_CONFORMANCE_HARNESS_FAILED"), package.Peer ?? throw new InvalidOperationException("MHP_CONFORMANCE_HARNESS_FAILED"), dte, workspace, components);
    }

    private static async Task WaitAsync(Func<bool> done, TimeSpan deadline, string code)
    {
      var started = Stopwatch.StartNew();
      while (!done())
      {
        if (started.Elapsed > deadline) throw new InvalidOperationException(code);
        await Task.Delay(100);
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      }
    }

    private static void CloseEveryDocument(DTE2 dte)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      dte.Documents.CloseAll(vsSaveChanges.vsSaveChangesNo);
    }

    private static Task<JToken> DriveAsync(Layout layout, Live live, Leg leg)
    {
      switch (leg.Scenario)
      {
        case "settings": return SettingsLegAsync(live);
        case "panel-order": return PanelOrderLegAsync(live);
        case "diagnostics": return DiagnosticsLegAsync(live, leg);
        case "dirty-buffer": return DirtyBufferLegAsync(live, leg);
        case "atomic-edit": return AtomicEditLegAsync(live, leg);
        case "diff-hunks": return HunksLegAsync(layout, live, leg);
        case "checkpoint": return CheckpointLegAsync(layout, leg);
        default: throw new InvalidOperationException("no native driver for runnable scenario " + leg.Scenario);
      }
    }

    // The live pipe to the live runtime: settings/update and settings/get on its real store. The store canonicalizes
    // USD values, so the scenario's integer round-trips through a plain integer setting, as the node driver does.
    private static async Task<JToken> SettingsLegAsync(Live live)
    {
      const string Key = "museSpark.schedulePauseAfterFailures";
      await live.Peer.RequestAsync("settings/update", new JObject { ["key"] = Key, ["value"] = 5, ["scope"] = "user" }, CancellationToken.None);
      var read = await live.Peer.RequestAsync("settings/get", new JObject { ["key"] = Key }, CancellationToken.None);
      return new JObject { ["settingValue"] = read["value"] };
    }

    // The production channel's own ordering: a refused frame neither delivers nor advances. A real peer with the
    // runtime's captured handshake answer stands apart from the live connection, which this leg must not desynchronize.
    private static async Task<JToken> PanelOrderLegAsync(Live live)
    {
      const string RecordedInitializeAnswer = "{\"jsonrpc\":\"2.0\",\"id\":\"vs:1\",\"result\":{\"protocolVersion\":\"mhp/1.6.0\",\"capabilities\":[\"lifecycle\",\"settings\",\"storage\"]}}";
      var contract = SchemaContract.Load(true);
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(contract, live.Host, output))
      {
        var started = peer.InitializeAsync(new JObject
        {
          ["host"] = new JObject { ["id"] = "visual-studio", ["version"] = "conformance" },
          ["protocolRange"] = contract.Export["range"]?.DeepClone(),
          ["capabilities"] = new JArray(live.Host.Capabilities),
          ["locale"] = "en",
          ["theme"] = new JObject { ["kind"] = "dark", ["tokens"] = new JObject() },
          ["folders"] = new JArray(),
          ["trusted"] = false
        }, CancellationToken.None);
        await peer.ReceiveAsync(RecordedInitializeAnswer);
        await started;
        using (var channel = new PanelChannel(peer, "conformance-surface", "conformance-session", "chat"))
        {
          await channel.OpenAsync();
          await channel.PostAsync(new JObject { ["type"] = "ready" }, CancellationToken.None);
          var delivered = new JArray();
          var refusals = new JArray();
          foreach (var seq in new long[] { 1, 1, 3, 2 })
          {
            try
            {
              channel.Receive(new JObject { ["mhp"] = "1.6", ["kind"] = "panel", ["surface"] = channel.SurfaceId, ["direction"] = "toPanel", ["seq"] = seq, ["payload"] = new JObject { ["type"] = "attachmentsCleared" } });
              delivered.Add(seq);
            }
            catch (MhpException refused) { refusals.Add(refused.Message); }
          }
          return new JObject { ["deliveredSequences"] = delivered, ["refusals"] = refusals };
        }
      }
    }

    private static string WriteFixture(Live live, Leg leg, string name, string text)
    {
      var path = Path.Combine(live.Workspace, leg.Backend + "-" + name);
      File.WriteAllText(path, text, new System.Text.UTF8Encoding(false));
      return path;
    }

    private static IWpfTextView OpenView(Live live, string path)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      VsShellUtilities.OpenDocument(live.Package, path, VSConstants.LOGVIEWID_TextView, out _, out _, out var frame);
      var native = VsShellUtilities.GetTextView(frame);
      return live.Components.GetService<IVsEditorAdaptersFactoryService>().GetWpfTextView(native) ?? throw new InvalidOperationException("MHP_CONFORMANCE_HARNESS_FAILED");
    }

    private static string Uri(string path) => new Uri(path).AbsoluteUri;

    private static JObject WholeRange(ITextSnapshot snapshot)
    {
      var last = snapshot.GetLineFromPosition(snapshot.Length);
      return new JObject
      {
        ["start"] = new JObject { ["line"] = 0, ["character"] = 0 },
        ["end"] = new JObject { ["line"] = last.LineNumber, ["character"] = snapshot.Length - last.Start.Position }
      };
    }

    private static async Task<JToken> DirectAsync(Live live, string method, JObject parameters)
    {
      var result = await live.Host.InvokeAsync(method, parameters, CancellationToken.None);
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      // The production answer must satisfy the frozen result schema, as it does on the wire.
      SchemaContract.Load(true).ValidateResult(method, new JObject { ["jsonrpc"] = "2.0", ["id"] = 1, ["result"] = result.DeepClone() });
      return result;
    }

    // ITextUndoHistory answers CanUndo true on an empty stack here, and undoing on it never ends, so what remains
    // is read from the buffer's own undo manager, the stack Edit > Undo offers.
    private static int UndoUnits(Live live, IWpfTextView view)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      var buffer = live.Components.GetService<IVsEditorAdaptersFactoryService>().GetBufferAdapter(view.TextBuffer) ?? throw new InvalidOperationException("MHP_CONFORMANCE_HARNESS_FAILED");
      ErrorHandler.ThrowOnFailure(buffer.GetUndoManager(out var manager));
      manager.EnumUndoable(out var units);
      var count = 0;
      var unit = new Microsoft.VisualStudio.OLE.Interop.IOleUndoUnit[1];
      while (units.Next(1, unit, out var fetched) == VSConstants.S_OK && fetched != 0) count++;
      return count;
    }

    // An edit a person typed (the real editor operations, one undo step), then the runtime's edit at the current
    // version: refused for the dirty buffer before any side effect.
    private static async Task<JToken> DirtyBufferLegAsync(Live live, Leg leg)
    {
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      var path = WriteFixture(live, leg, "dirty.txt", "original");
      var view = OpenView(live, path);
      var operations = live.Components.GetService<IEditorOperationsFactoryService>().GetEditorOperations(view);
      operations.SelectAll();
      operations.ReplaceSelection("dirtied");
      var read = await DirectAsync(live, "documents/read", new JObject { ["uri"] = Uri(path) });
      var version = read["document"]?.Value<long>("version") ?? throw new InvalidOperationException("MHP_CONFORMANCE_HARNESS_FAILED");
      var refusals = new JArray();
      try
      {
        await DirectAsync(live, "documents/applyEdits", new JObject { ["uri"] = Uri(path), ["expectedVersion"] = version, ["undoLabel"] = UndoLabel, ["edits"] = new JArray(new JObject { ["range"] = WholeRange(view.TextSnapshot), ["newText"] = "bad" }) });
      }
      catch (MhpException refused) { refusals.Add(refused.Message); }
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      var text = view.TextSnapshot.GetText();
      // The editor's undo history exposes no stack here: undos back to the opened text are counted for real, and redone.
      var history = live.Components.GetService<ITextUndoHistoryRegistry>().RegisterHistory(view.TextBuffer);
      var depth = 0;
      while (view.TextSnapshot.GetText() != "original" && depth < MaximumUndos) { history.Undo(1); depth++; }
      if (view.TextSnapshot.GetText() != "original") throw new InvalidOperationException("MHP_CONFORMANCE_UNDO_DID_NOT_RESTORE");
      if (depth > 0) history.Redo(depth);
      if (view.TextSnapshot.GetText() != text) throw new InvalidOperationException("MHP_CONFORMANCE_REDO_DID_NOT_RESTORE");
      return new JObject { ["text"] = text, ["version"] = version, ["refusals"] = refusals, ["undoDepth"] = depth };
    }

    // One edit applied at the version it names, a stale duplicate refused, one undo restoring everything.
    private static async Task<JToken> AtomicEditLegAsync(Live live, Leg leg)
    {
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      var path = WriteFixture(live, leg, "atomic.txt", "original");
      var view = OpenView(live, path);
      var read = await DirectAsync(live, "documents/read", new JObject { ["uri"] = Uri(path) });
      var opened = read["document"]?.Value<long>("version") ?? throw new InvalidOperationException("MHP_CONFORMANCE_HARNESS_FAILED");
      var edit = new JObject { ["uri"] = Uri(path), ["expectedVersion"] = opened, ["undoLabel"] = UndoLabel, ["edits"] = new JArray(new JObject { ["range"] = WholeRange(view.TextSnapshot), ["newText"] = "changed" }) };
      await DirectAsync(live, "documents/applyEdits", edit);
      var refusals = new JArray();
      try { await DirectAsync(live, "documents/applyEdits", (JObject)edit.DeepClone()); }
      catch (MhpException refused) { refusals.Add(refused.Message); }
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      var history = live.Components.GetService<ITextUndoHistoryRegistry>().RegisterHistory(view.TextBuffer);
      var transactions = 0;
      while (view.TextSnapshot.GetText() != "original" && transactions < MaximumUndos) { history.Undo(1); transactions++; }
      var after = await DirectAsync(live, "documents/read", new JObject { ["uri"] = Uri(path) });
      var remaining = UndoUnits(live, view);
      return new JObject { ["text"] = after.Value<string>("text"), ["version"] = after["document"]?.Value<long>("version"), ["refusals"] = refusals, ["undoDepth"] = remaining, ["undoTransactions"] = transactions };
    }

    // The scenario's error through the Error List's own provider API, read back through diagnostics/settled.
    private static async Task<JToken> DiagnosticsLegAsync(Live live, Leg leg)
    {
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      var path = WriteFixture(live, leg, "diagnostic.txt", "fixture text");
      OpenView(live, path);
      using (var provider = new ErrorListProvider(live.Package) { ProviderName = "Muse conformance", ProviderGuid = Guid.NewGuid() })
      {
        provider.Tasks.Add(new ErrorTask { ErrorCategory = TaskErrorCategory.Error, Category = TaskCategory.BuildCompile, Text = "fixture error", Document = path, Line = 0, Column = 0 });
        var read = await DirectAsync(live, "documents/read", new JObject { ["uri"] = Uri(path) });
        var version = read["document"]?.Value<long>("version") ?? throw new InvalidOperationException("MHP_CONFORMANCE_HARNESS_FAILED");
        var started = Stopwatch.StartNew();
        JToken settled = JValue.CreateNull();
        while (settled.Type == JTokenType.Null)
        {
          if (started.Elapsed > SettleDeadline) throw new InvalidOperationException("MHP_DIAGNOSTICS_UNAVAILABLE");
          settled = await DirectAsync(live, "diagnostics/settled", new JObject { ["uri"] = Uri(path), ["expectedVersion"] = version });
          if (settled.Type == JTokenType.Null) { await Task.Delay(250); await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(); }
        }
        var errors = new JArray(settled["diagnostics"]?.Where(d => d.Value<string>("severity") == "error").Select(d => d.Value<string>("message")) ?? Enumerable.Empty<string>());
        return new JObject { ["verifyErrors"] = errors };
      }
    }

    private static async Task<JToken> HunksLegAsync(Layout layout, Live live, Leg leg)
    {
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      // The driver's review works in its own repository folder on lines.txt; each leg has its own.
      var folder = Directory.CreateDirectory(Path.Combine(live.Workspace, leg.Backend + "-hunks")).FullName;
      var path = Path.Combine(folder, "lines.txt");
      File.WriteAllText(path, "l1\nl2\nl3\n", new System.Text.UTF8Encoding(false));
      OpenView(live, path);
      var read = await DirectAsync(live, "documents/read", new JObject { ["uri"] = Uri(path) });
      var version = read["document"]?.Value<long>("version") ?? throw new InvalidOperationException("MHP_CONFORMANCE_HARNESS_FAILED");
      JObject Replace(int line, string text) => new JObject
      {
        ["range"] = new JObject { ["start"] = new JObject { ["line"] = line, ["character"] = 0 }, ["end"] = new JObject { ["line"] = line, ["character"] = 2 } },
        ["newText"] = text
      };
      var applied = await DirectAsync(live, "documents/applyEdits", new JObject { ["uri"] = Uri(path), ["expectedVersion"] = version, ["undoLabel"] = UndoLabel, ["edits"] = new JArray(Replace(0, "l1c"), Replace(1, "l2c")) });
      var saved = await DirectAsync(live, "documents/save", new JObject { ["uri"] = Uri(path), ["expectedVersion"] = applied.Value<long>("version") });
      if (saved.Value<bool>("dirty")) throw new InvalidOperationException("MHP_SAVE_FAILED");
      // The revert half writes the disk: the editor lets the file go first, so no reload prompt can stand in the way.
      CloseEveryDocument(live.Dte);
      var observed = await RunDriverAsync(layout, "hunks", new JObject { ["workspaceRoot"] = folder });
      return new JObject { ["hunks"] = observed["hunks"], ["text"] = observed["text"] };
    }

    private static async Task<JToken> CheckpointLegAsync(Layout layout, Leg leg)
    {
      // The product restores Model API turns only; a runnable Muse Code leg must wait in the contract instead.
      if (leg.Backend != "modelapi") throw new InvalidOperationException("MHP_CONFORMANCE_HARNESS_FAILED");
      var workspace = Directory.CreateDirectory(Path.Combine(layout.Scratch, "checkpoint-workspace")).FullName;
      var data = Directory.CreateDirectory(Path.Combine(layout.Scratch, "checkpoint-data")).FullName;
      var observed = await RunDriverAsync(layout, "checkpoint", new JObject { ["workspaceRoot"] = workspace, ["dataRoot"] = data, ["sessionId"] = Guid.NewGuid().ToString(), ["backend"] = "modelApi" });
      return new JObject { ["text"] = observed["text"], ["checkpoints"] = observed["checkpoints"] };
    }

    private static async Task<JObject> RunDriverAsync(Layout layout, string driver, JObject arguments)
    {
      var info = new ProcessStartInfo(layout.Node, AssetPolicy.Quote(layout.RunDriver) + " " + driver + " " + AssetPolicy.Quote(arguments.ToString(Formatting.None))) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
      AssetPolicy.SanitizeEnvironment(info);
      var text = await Task.Run(() =>
      {
        using (var process = System.Diagnostics.Process.Start(info) ?? throw new InvalidOperationException("MHP_CONFORMANCE_HARNESS_FAILED"))
        {
          var stdout = process.StandardOutput.ReadToEndAsync();
          var stderr = process.StandardError.ReadToEndAsync();
          if (!process.WaitForExit((int)DriverDeadline.TotalMilliseconds)) { process.Kill(); throw new InvalidOperationException("MHP_CONFORMANCE_HARNESS_FAILED"); }
          if (process.ExitCode != 0) throw new InvalidOperationException("MHP_CONFORMANCE_DRIVER_FAILED " + driver + " exit " + process.ExitCode.ToString(System.Globalization.CultureInfo.InvariantCulture));
          return stdout.GetAwaiter().GetResult();
        }
      });
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      return JObject.Parse(text);
    }
  }
}
