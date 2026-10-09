using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Threading;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.ComponentModelHost;
using Microsoft.VisualStudio.Editor;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Microsoft.VisualStudio.Text;
using Microsoft.VisualStudio.Text.Editor;
using Microsoft.VisualStudio.Text.Operations;
using Microsoft.VisualStudio.TextManager.Interop;
using MuseSpark.VisualStudio.Protocol;
using MuseSpark.VisualStudio.Panel;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Editor
{
  public sealed class VisualStudioHost : IHostServices, IVsRunningDocTableEvents, IDisposable
  {
    private readonly AsyncPackage package;
    private readonly IVsEditorAdaptersFactoryService adapters;
    private readonly ITextDocumentFactoryService documents;
    private readonly ITextUndoHistoryRegistry undo;
    private readonly IVsRunningDocumentTable rdt;
    private readonly IVsTextManager textManager;
    private readonly TabCompletion completion;
    private readonly NativeSurfaces surfaces;
    private readonly NativeUi ui;
    private readonly IVsTaskList? errors;
    private readonly DispatcherTimer diagnosticTimer;
    private readonly Dictionary<string, JArray> lastDiagnostics = new Dictionary<string, JArray>(StringComparer.OrdinalIgnoreCase);
    private readonly DocumentTable<ITextBuffer, ITextDocument> tracked = new DocumentTable<ITextBuffer, ITextDocument>(document => document.FilePath);
    private readonly uint cookie;
    private readonly HashSet<IWpfTextView> views = new HashSet<IWpfTextView>();
    public MhpPeer? Peer { private get; set; }
    // 1.3 adds settled diagnostics, command execution and file/settings UI.
    // Keep existing component drivers; partial groups use the reviewed runtime fallback.
    public IReadOnlyCollection<string> Capabilities => new[] { "lifecycle", "documents", "editor", "tab", "window" };

    public VisualStudioHost(AsyncPackage package, IComponentModel components, IVsRunningDocumentTable rdt, IVsTextManager textManager, TabCompletion completion, IVsTaskList? errors, NativeSurfaces surfaces, NativeUi ui)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      this.package = package;
      this.rdt = rdt;
      this.textManager = textManager;
      this.completion = completion;
      this.surfaces = surfaces;
      this.ui = ui;
      this.errors = errors;
      diagnosticTimer = new DispatcherTimer(DispatcherPriority.Background) { Interval = TimeSpan.FromMilliseconds(500) };
      diagnosticTimer.Tick += DiagnosticTick;
      if (errors != null) diagnosticTimer.Start();
      adapters = components.GetService<IVsEditorAdaptersFactoryService>();
      documents = components.GetService<ITextDocumentFactoryService>();
      undo = components.GetService<ITextUndoHistoryRegistry>();
      ErrorHandler.ThrowOnFailure(rdt.AdviseRunningDocTableEvents(this, out cookie));
      Refresh();
    }

    public async Task<JToken> InvokeAsync(string method, JObject parameters, CancellationToken cancellation)
    {
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(cancellation);
      cancellation.ThrowIfCancellationRequested();
      if (method.StartsWith("surfaces/", StringComparison.Ordinal)) return await surfaces.InvokeAsync(method, parameters, cancellation);
      if (method.StartsWith("ui/", StringComparison.Ordinal)) return await ui.InvokeAsync(method, parameters, cancellation);
      if (method == "commands/register") return await ui.InvokeAsync(method, parameters, cancellation);
      Refresh();
      switch (method)
      {
        case "documents/list": return new JArray(tracked.Documents.Select(Document));
        case "documents/read":
          var read = Find(parameters.Value<string>("uri") ?? "");
          return new JObject { ["document"] = Document(read), ["text"] = read.TextBuffer.CurrentSnapshot.GetText() };
        case "documents/applyEdits": return Apply(Find(parameters.Value<string>("uri") ?? ""), parameters);
        case "documents/save":
          var save = Find(parameters.Value<string>("uri") ?? "");
          RequireVersion(save, parameters.Value<long>("expectedVersion"));
          save.Save(); return Document(save);
        case "documents/saveAll":
          foreach (var document in tracked.Documents.ToArray()) if (document.IsDirty) document.Save();
          return new JObject { ["saved"] = tracked.Documents.All(d => !d.IsDirty) };
        case "editor/active": return Selection() ?? JValue.CreateNull();
        case "editor/open":
          var view = Open(parameters.Value<string>("uri") ?? "");
          if (parameters["range"] is JToken range)
          {
            var text = view.TextSnapshot.GetText();
            var start = EditPlan.Offset(text, range["start"] ?? throw Invalid());
            var end = EditPlan.Offset(text, range["end"] ?? throw Invalid());
            if (end < start) throw Invalid();
            view.Selection.Select(new SnapshotSpan(view.TextSnapshot, start, end - start), false);
            view.Caret.MoveTo(new SnapshotPoint(view.TextSnapshot, end));
            view.ViewScroller.EnsureSpanVisible(new SnapshotSpan(view.TextSnapshot, start, end - start));
          }
          return JValue.CreateNull();
        case "editor/insertAtCursor":
        case "editor/replaceSelection":
          var location = parameters["range"] ?? new JObject { ["start"] = parameters["position"], ["end"] = parameters["position"] };
          return Apply(Find(parameters.Value<string>("uri") ?? ""), new JObject
          {
            ["expectedVersion"] = parameters["expectedVersion"],
            ["undoLabel"] = parameters["undoLabel"],
            ["edits"] = new JArray(new JObject { ["range"] = location, ["newText"] = parameters["text"] })
          });
        case "window/state": return new JObject { ["focused"] = System.Windows.Application.Current?.MainWindow?.IsActive == true };
        case "tab/register": completion.Register(parameters); return JValue.CreateNull();
        case "diagnostics/get":
          if (errors == null) throw new MhpException("unsupportedCapability", "MHP_UNSUPPORTED_CAPABILITY");
          return ErrorListDiagnostics.Read(errors, parameters.Value<string>("uri"));
        case "window/attention":
          if (await package.GetServiceAsync(typeof(SVsStatusbar)) is IVsStatusbar status) ErrorHandler.ThrowOnFailure(status.SetText(parameters.Value<string>("message") ?? ""));
          else throw new MhpException("internalError", "MHP_STATUSBAR_UNAVAILABLE");
          return JValue.CreateNull();
        default: throw new MhpException("unsupportedCapability", "MHP_UNSUPPORTED_CAPABILITY");
      }
    }

    private static JObject Document(ITextDocument document) => new JObject
    {
      ["uri"] = new Uri(document.FilePath).AbsoluteUri,
      ["version"] = document.TextBuffer.CurrentSnapshot.Version.VersionNumber,
      ["dirty"] = document.IsDirty,
      ["languageId"] = document.TextBuffer.ContentType.TypeName
    };

    private static void RequireVersion(ITextDocument document, long version)
    {
      if (document.TextBuffer.CurrentSnapshot.Version.VersionNumber != version) throw new MhpException("versionConflict", "MHP_VERSION_CONFLICT");
    }

    private JObject Apply(ITextDocument document, JObject parameters)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      var snapshot = document.TextBuffer.CurrentSnapshot;
      var plan = EditPlan.Create(snapshot.GetText(), snapshot.Version.VersionNumber, document.IsDirty, parameters);
      var history = undo.RegisterHistory(document.TextBuffer);
      using (var transaction = history.CreateTransaction(parameters.Value<string>("undoLabel") ?? throw Invalid()))
      using (var edit = document.TextBuffer.CreateEdit())
      {
        foreach (var replacement in plan)
          if (!edit.Replace(replacement.Start, replacement.Length, replacement.Text)) { edit.Cancel(); transaction.Cancel(); throw new MhpException("permissionDenied", "MHP_EDIT_REFUSED"); }
        if (edit.HasFailedChanges) { edit.Cancel(); transaction.Cancel(); throw new MhpException("permissionDenied", "MHP_EDIT_REFUSED"); }
        edit.Apply();
        if (edit.Canceled) { transaction.Cancel(); throw new MhpException("permissionDenied", "MHP_EDIT_REFUSED"); }
        transaction.Complete();
      }
      return Document(document);
    }

    // Refresh has tracked every open buffer; any spelling of an open file returns that buffer, never a second one.
    private ITextDocument Find(string uri)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      var held = tracked.Find(FilePath(uri));
      if (held != null) return held;
      var view = Open(uri);
      if (!documents.TryGetTextDocument(view.TextBuffer, out var document)) throw new MhpException("invalidParams", "MHP_DOCUMENT_UNAVAILABLE");
      Track(document);
      return document;
    }

    private IWpfTextView Open(string uri)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      var path = FilePath(uri);
      // Open by the moniker the RDT already holds, so Visual Studio activates that window instead of a new one.
      VsShellUtilities.OpenDocument(package, tracked.Find(path)?.FilePath ?? path, VSConstants.LOGVIEWID_TextView, out _, out _, out var frame);
      var native = VsShellUtilities.GetTextView(frame);
      var view = adapters.GetWpfTextView(native) ?? throw new MhpException("invalidParams", "MHP_DOCUMENT_UNAVAILABLE");
      TrackView(view);
      return view;
    }

    private static string FilePath(string source) => DocumentPath.Parse(source);

    private void Refresh()
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      ErrorHandler.ThrowOnFailure(rdt.GetRunningDocumentsEnum(out var enumerator));
      var ids = new uint[1];
      while (enumerator.Next(1, ids, out var fetched) == VSConstants.S_OK && fetched != 0)
      {
        ErrorHandler.ThrowOnFailure(rdt.GetDocumentInfo(ids[0], out _, out _, out _, out _, out _, out _, out var data));
        try
        {
          if (data != IntPtr.Zero && Marshal.GetObjectForIUnknown(data) is IVsTextBuffer native)
          {
            var buffer = adapters.GetDataBuffer(native);
            if (buffer != null && documents.TryGetTextDocument(buffer, out var document)) Track(document);
          }
        }
        finally { if (data != IntPtr.Zero) Marshal.Release(data); }
      }
      if (textManager.GetActiveView(1, null, out var active) == VSConstants.S_OK && active != null)
      {
        var view = adapters.GetWpfTextView(active);
        if (view != null) TrackView(view);
      }
    }

    private void Track(ITextDocument document)
    {
      if (!tracked.Track(document.TextBuffer, document)) return;
      document.TextBuffer.Changed += BufferChanged;
      document.FileActionOccurred += FileAction;
    }

    private void DiagnosticTick(object sender, EventArgs args)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      if (errors == null || Peer == null) return;
      var groups = ErrorListDiagnostics.Read(errors, null).OfType<JObject>().GroupBy(d => d.Value<string>("uri") ?? "", StringComparer.OrdinalIgnoreCase)
          .ToDictionary(g => g.Key, g => new JArray(g), StringComparer.OrdinalIgnoreCase);
      foreach (var uri in groups.Keys.Union(lastDiagnostics.Keys, StringComparer.OrdinalIgnoreCase).ToArray())
      {
        var current = groups.TryGetValue(uri, out var values) ? values : new JArray();
        if (!lastDiagnostics.TryGetValue(uri, out var previous) || !JToken.DeepEquals(previous, current))
          Notify("diagnostics/didChange", new JObject { ["uri"] = uri, ["diagnostics"] = current });
      }
      lastDiagnostics.Clear();
      foreach (var group in groups) lastDiagnostics.Add(group.Key, group.Value);
    }

    private void TrackView(IWpfTextView view)
    {
      if (!views.Add(view)) return;
      view.Selection.SelectionChanged += SelectionChanged;
      view.Caret.PositionChanged += CaretChanged;
      view.GotAggregateFocus += SelectionChanged;
      view.Closed += ViewClosed;
    }

    private JToken? Selection()
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      if (textManager.GetActiveView(1, null, out var native) != VSConstants.S_OK || native == null) return null;
      var view = adapters.GetWpfTextView(native);
      if (view == null || !documents.TryGetTextDocument(view.TextBuffer, out var document)) return null;
      Track(document); TrackView(view);
      var span = view.Selection.StreamSelectionSpan.SnapshotSpan;
      var text = view.TextSnapshot.GetText();
      var limit = SchemaContract.Load().Method("editor/active")["result"]?["properties"]?["result"]?["anyOf"]?[0]?["properties"]?["excerpt"]?.Value<int>("maxLength") ?? throw Invalid();
      return new JObject
      {
        ["uri"] = new Uri(document.FilePath).AbsoluteUri,
        ["version"] = view.TextSnapshot.Version.VersionNumber,
        ["range"] = new JObject { ["start"] = EditPlan.Position(text, span.Start.Position), ["end"] = EditPlan.Position(text, span.End.Position) },
        ["excerpt"] = span.GetText().Substring(0, Math.Min(span.Length, limit)),
        ["truncated"] = span.Length > limit
      };
    }

    private void BufferChanged(object sender, TextContentChangedEventArgs args)
    {
      if (sender is ITextBuffer buffer && tracked.Get(buffer) is ITextDocument document)
        Notify("documents/didChange", new JObject { ["document"] = Document(document), ["text"] = args.After.GetText() });
    }

    private void FileAction(object sender, TextDocumentFileActionEventArgs args)
    {
      if ((args.FileActionType & FileActionTypes.ContentSavedToDisk) != 0 && sender is ITextDocument document) Notify("documents/didSave", Document(document));
    }

    private void SelectionChanged(object sender, EventArgs args) { ThreadHelper.ThrowIfNotOnUIThread(); Notify("editor/didChangeSelection", new JObject { ["selection"] = Selection() ?? JValue.CreateNull() }); }
    private void CaretChanged(object sender, CaretPositionChangedEventArgs args) { ThreadHelper.ThrowIfNotOnUIThread(); SelectionChanged(sender, args); }
    private void ViewClosed(object sender, EventArgs args) { if (sender is IWpfTextView view) UntrackView(view); }

    private void Notify(string method, JObject parameters)
    {
      var peer = Peer;
      if (peer == null) return;
      package.JoinableTaskFactory.RunAsync(async () =>
      {
        try { await peer.NotifyAsync(method, parameters); }
        catch (MhpException) { /* No negotiated channel before initialize or after shutdown. */ }
        catch (IOException) { /* A closed runtime pipe cannot receive an editor event. */ }
      }).FileAndForget("MuseSpark/MhpNotification");
    }

    private void UntrackView(IWpfTextView view)
    {
      views.Remove(view);
      view.Selection.SelectionChanged -= SelectionChanged;
      view.Caret.PositionChanged -= CaretChanged;
      view.GotAggregateFocus -= SelectionChanged;
      view.Closed -= ViewClosed;
    }

    public int OnAfterFirstDocumentLock(uint docCookie, uint lockType, uint readLocks, uint editLocks) { ThreadHelper.ThrowIfNotOnUIThread(); Refresh(); return VSConstants.S_OK; }
    public int OnBeforeLastDocumentUnlock(uint docCookie, uint lockType, uint readRemaining, uint editRemaining)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      if (readRemaining != 0 || editRemaining != 0) return VSConstants.S_OK;
      ErrorHandler.ThrowOnFailure(rdt.GetDocumentInfo(docCookie, out _, out _, out _, out var moniker, out _, out _, out var data));
      ITextBuffer? held = null;
      try { if (data != IntPtr.Zero && Marshal.GetObjectForIUnknown(data) is IVsTextBuffer native) held = adapters.GetDataBuffer(native); }
      finally { if (data != IntPtr.Zero) Marshal.Release(data); }
      // Release the buffer this RDT entry holds; another spelling of its moniker must not leave it subscribed.
      var document = tracked.Untrack(held, moniker);
      if (document != null)
      {
        document.TextBuffer.Changed -= BufferChanged; document.FileActionOccurred -= FileAction;
        Notify("documents/didClose", new JObject { ["uri"] = new Uri(document.FilePath).AbsoluteUri });
      }
      return VSConstants.S_OK;
    }
    public int OnAfterSave(uint docCookie) => VSConstants.S_OK;
    public int OnAfterAttributeChange(uint docCookie, uint attributes) => VSConstants.S_OK;
    public int OnBeforeDocumentWindowShow(uint docCookie, int firstShow, IVsWindowFrame frame) { ThreadHelper.ThrowIfNotOnUIThread(); Refresh(); return VSConstants.S_OK; }
    public int OnAfterDocumentWindowHide(uint docCookie, IVsWindowFrame frame) => VSConstants.S_OK;
    private static MhpException Invalid() => new MhpException("invalidParams", "MHP_INVALID_EDITOR_POSITION");

    public void Dispose()
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      Peer = null;
      diagnosticTimer.Stop(); diagnosticTimer.Tick -= DiagnosticTick;
      rdt.UnadviseRunningDocTableEvents(cookie);
      foreach (var document in tracked.Documents) { document.TextBuffer.Changed -= BufferChanged; document.FileActionOccurred -= FileAction; }
      foreach (var view in views.ToArray()) UntrackView(view);
      tracked.Clear();
    }
  }
}
