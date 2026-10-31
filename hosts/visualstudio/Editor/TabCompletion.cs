using System;
using System.Collections.Generic;
using System.ComponentModel.Composition;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Editor;
using Microsoft.VisualStudio.OLE.Interop;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Text;
using Microsoft.VisualStudio.Text.Editor;
using Microsoft.VisualStudio.Text.Operations;
using Microsoft.VisualStudio.Threading;
using Microsoft.VisualStudio.Utilities;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Editor
{
  [Export]
  public sealed class TabCompletion
  {
    public const string LayerName = "MuseSparkGhostText";
    private readonly HashSet<GhostText> views = new HashSet<GhostText>();
    private HashSet<string> languages = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    private string? trigger;
    private Func<string>? undoLabel;
    public MhpPeer? Peer { get; private set; }
    public void Attach(MhpPeer? peer, Func<string>? undoLabel) { ThreadHelper.ThrowIfNotOnUIThread(); this.undoLabel = undoLabel; Peer = peer; if (peer == null) foreach (var view in views) view.Clear(); }
    internal string UndoLabel => undoLabel?.Invoke() ?? throw new MhpException("invalidRequest", "MHP_NOT_READY");
    public void Register(JObject parameters)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      languages = new HashSet<string>((parameters["languages"] as JArray ?? throw new MhpException("invalidParams", "MHP_INVALID_PARAMS")).Values<string>().OfType<string>(), StringComparer.OrdinalIgnoreCase);
      trigger = parameters.Value<string>("trigger");
      foreach (var view in views) view.Clear();
    }
    internal bool Enabled(string language, bool automatic) => Peer != null && trigger != null && (languages.Count == 0 || languages.Contains(language)) && (trigger == "both" || trigger == (automatic ? "automatic" : "invoke"));
    internal void Add(GhostText view) => views.Add(view);
    internal void Remove(GhostText view) => views.Remove(view);
  }

  [Export(typeof(IWpfTextViewCreationListener))]
  [ContentType("text")]
  [TextViewRole(PredefinedTextViewRoles.Editable)]
  public sealed class TabViewListener : IWpfTextViewCreationListener
  {
    private readonly IVsEditorAdaptersFactoryService adapters;
    private readonly ITextDocumentFactoryService documents;
    private readonly ITextUndoHistoryRegistry undo;
    private readonly TabCompletion completion;
    [Export(typeof(AdornmentLayerDefinition))]
    [Name(TabCompletion.LayerName)]
    [Order(After = PredefinedAdornmentLayers.Text)]
    public AdornmentLayerDefinition? Layer { get; set; }

    [ImportingConstructor]
    public TabViewListener(IVsEditorAdaptersFactoryService adapters, ITextDocumentFactoryService documents, ITextUndoHistoryRegistry undo, TabCompletion completion)
    { this.adapters = adapters; this.documents = documents; this.undo = undo; this.completion = completion; }

    public void TextViewCreated(IWpfTextView view)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      if (!documents.TryGetTextDocument(view.TextBuffer, out var document)) return;
      var native = adapters.GetViewAdapter(view);
      if (native == null) return;
      var ghost = new GhostText(view, document, completion, undo, ThreadHelper.JoinableTaskFactory);
      ErrorHandler.ThrowOnFailure(native.AddCommandFilter(ghost, out var next));
      ghost.SetNext(next, () => native.RemoveCommandFilter(ghost));
    }
  }

  internal sealed class GhostText : IOleCommandTarget
  {
    private const int MaximumContextChars = 16384;
    private readonly IWpfTextView view;
    private readonly ITextDocument document;
    private readonly TabCompletion completion;
    private readonly ITextUndoHistoryRegistry undo;
    private readonly JoinableTaskFactory factory;
    private readonly IAdornmentLayer layer;
    private CancellationTokenSource? request;
    private IOleCommandTarget? next;
    private Action? removeFilter;
    private JObject? suggestion;
    private int version;
    private int caret;
    private bool closed;
    private bool applying;
    internal GhostText(IWpfTextView view, ITextDocument document, TabCompletion completion, ITextUndoHistoryRegistry undo, JoinableTaskFactory factory)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      this.view = view; this.document = document; this.completion = completion; this.undo = undo; this.factory = factory;
      layer = view.GetAdornmentLayer(TabCompletion.LayerName);
      view.TextBuffer.Changed += Changed;
      view.Caret.PositionChanged += Moved;
      view.LayoutChanged += Layout;
      view.LostAggregateFocus += LostFocus;
      view.Closed += Closed;
      completion.Add(this);
    }
    internal void SetNext(IOleCommandTarget target, Action remove) { next = target; removeFilter = remove; }
    internal void Clear()
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      request?.Cancel(); request?.Dispose(); request = null;
      var rejected = suggestion; suggestion = null; layer.RemoveAllAdornments();
      if (rejected != null) Notify("tab/rejected", new JObject { ["id"] = rejected["id"] });
    }
    private void Changed(object sender, TextContentChangedEventArgs args) { ThreadHelper.ThrowIfNotOnUIThread(); Clear(); if (!applying) Invoke(true); }
    private void Moved(object sender, CaretPositionChangedEventArgs args) { ThreadHelper.ThrowIfNotOnUIThread(); Clear(); }
    private void LostFocus(object sender, EventArgs args) { ThreadHelper.ThrowIfNotOnUIThread(); Clear(); }
    private void Layout(object sender, TextViewLayoutChangedEventArgs args) { ThreadHelper.ThrowIfNotOnUIThread(); Render(); }
    private void Closed(object sender, EventArgs args)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      closed = true; Clear(); completion.Remove(this); removeFilter?.Invoke();
      view.TextBuffer.Changed -= Changed; view.Caret.PositionChanged -= Moved; view.LayoutChanged -= Layout;
      view.LostAggregateFocus -= LostFocus; view.Closed -= Closed;
    }
    private void Invoke(bool automatic)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      var peer = completion.Peer;
      if (closed || peer == null || !completion.Enabled(view.TextBuffer.ContentType.TypeName, automatic) || !view.Selection.IsEmpty) return;
      Clear();
      var cancellation = new CancellationTokenSource(); request = cancellation;
      var snapshot = view.TextSnapshot;
      var position = view.Caret.Position.BufferPosition.Position;
      var text = snapshot.GetText();
      factory.RunAsync(async () =>
      {
        try
        {
          var results = await peer.RequestAsync("tab/complete", new JObject
          {
            ["uri"] = new Uri(document.FilePath).AbsoluteUri,
            ["version"] = snapshot.Version.VersionNumber,
            ["position"] = EditPlan.Position(text, position),
            ["context"] = new JObject
            {
              ["prefix"] = text.Substring(Math.Max(0, position - MaximumContextChars), Math.Min(position, MaximumContextChars)),
              ["suffix"] = text.Substring(position, Math.Min(text.Length - position, MaximumContextChars)),
              ["trigger"] = automatic ? "automatic" : "invoke"
            }
          }, cancellation.Token);
          await factory.SwitchToMainThreadAsync(cancellation.Token);
          if (closed || !ReferenceEquals(request, cancellation) || view.TextSnapshot != snapshot || view.Caret.Position.BufferPosition.Position != position) return;
          if (results is JArray choices && choices.First is JObject first)
          { suggestion = first; version = snapshot.Version.VersionNumber; caret = position; Render(); }
        }
        catch (OperationCanceledException) { }
        catch (MhpException) { /* The runtime refused or withdrew this completion. */ }
        catch (System.IO.IOException) { /* The runtime closed its pipe. */ }
      }).FileAndForget("MuseSpark/TabCompletion");
    }
    private void Render()
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      layer.RemoveAllAdornments();
      if (suggestion == null || view.IsClosed || version != view.TextSnapshot.Version.VersionNumber) return;
      var point = new SnapshotPoint(view.TextSnapshot, caret);
      var line = view.GetTextViewLineContainingBufferPosition(point);
      if (line == null) return;
      var bounds = line.GetCharacterBounds(point);
      var label = new TextBlock { Text = suggestion.Value<string>("text"), Foreground = System.Windows.SystemColors.GrayTextBrush, Background = Brushes.Transparent };
      Canvas.SetLeft(label, bounds.Left); Canvas.SetTop(label, bounds.Top);
      layer.AddAdornment(AdornmentPositioningBehavior.TextRelative, new SnapshotSpan(point, 0), this, label, null);
    }
    private bool Accept()
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      var item = suggestion;
      if (item == null || version != view.TextSnapshot.Version.VersionNumber || caret != view.Caret.Position.BufferPosition.Position) { Clear(); return false; }
      var snapshot = view.TextSnapshot;
      Replacement replacement;
      try { replacement = CompletionPlan.Create(snapshot.GetText(), snapshot.Version.VersionNumber, view.Caret.Position.BufferPosition.Position, version, caret, item, completion.UndoLabel); }
      catch (MhpException) { Clear(); return false; }
      // User-accepted Tab is an editor action and may extend an unsaved buffer.
      suggestion = null;
      applying = true;
      try
      {
        using (var transaction = undo.RegisterHistory(view.TextBuffer).CreateTransaction(completion.UndoLabel))
        using (var edit = view.TextBuffer.CreateEdit())
        {
          if (!edit.Replace(replacement.Start, replacement.Length, replacement.Text) || edit.HasFailedChanges) { edit.Cancel(); transaction.Cancel(); Clear(); return false; }
          edit.Apply(); if (edit.Canceled) { transaction.Cancel(); Clear(); return false; }
          transaction.Complete();
        }
      }
      finally { applying = false; }
      view.Caret.MoveTo(new SnapshotPoint(view.TextSnapshot, replacement.Start + replacement.Text.Length));
      Clear();
      Notify("tab/accepted", new JObject { ["id"] = item["id"], ["uri"] = new Uri(document.FilePath).AbsoluteUri, ["version"] = view.TextSnapshot.Version.VersionNumber });
      return true;
    }
    private void Notify(string method, JObject parameters)
    {
      var peer = completion.Peer;
      if (peer == null) return;
      factory.RunAsync(async () => { try { await peer.NotifyAsync(method, parameters); } catch (MhpException) { } catch (System.IO.IOException) { } }).FileAndForget("MuseSpark/TabDecision");
    }
    public int QueryStatus(ref Guid group, uint count, OLECMD[] commands, IntPtr text) { ThreadHelper.ThrowIfNotOnUIThread(); return next?.QueryStatus(ref group, count, commands, text) ?? VSConstants.E_NOTIMPL; }
    public int Exec(ref Guid group, uint command, uint options, IntPtr input, IntPtr output)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      if (group == VSConstants.VSStd2K)
      {
        if (command == (uint)VSConstants.VSStd2KCmdID.TAB && suggestion != null && Accept()) return VSConstants.S_OK;
        if (command == (uint)VSConstants.VSStd2KCmdID.CANCEL && suggestion != null) { Clear(); return VSConstants.S_OK; }
        if (command == (uint)VSConstants.VSStd2KCmdID.AUTOCOMPLETE && completion.Enabled(view.TextBuffer.ContentType.TypeName, false)) { Invoke(false); return VSConstants.S_OK; }
      }
      return next?.Exec(ref group, command, options, input, output) ?? VSConstants.E_NOTIMPL;
    }
  }
}
