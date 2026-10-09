package io.musespark.eclipse;

import com.google.gson.*;
import java.util.*;
import org.eclipse.jface.text.*;
import org.eclipse.swt.SWT;
import org.eclipse.swt.custom.StyledText;
import org.eclipse.swt.custom.VerifyKeyListener;
import org.eclipse.swt.events.*;
import org.eclipse.swt.graphics.Point;
import org.eclipse.ui.*;
import org.eclipse.ui.texteditor.ITextEditor;

/** Ghost text belongs to the host; prices and model capability checks belong to the runtime. */
public final class Completion {
    private static final Map<WindowSession, Completion> INSTANCES = new HashMap<>();
    private final WindowSession session;
    private JsonObject registration;
    private StyledText widget;
    private TextViewer viewer;
    private int modelCaret;
    private JsonObject suggestion;
    private long version;
    private int caret;
    private long generation;
    private final PaintListener paint = event -> {
        if (suggestion == null || widget == null || widget.isDisposed()) return;
        Point point = widget.getLocationAtOffset(caret);
        event.gc.setForeground(widget.getDisplay().getSystemColor(SWT.COLOR_GRAY));
        event.gc.drawText(suggestion.get("text").getAsString(), point.x, point.y, true);
    };
    private final VerifyKeyListener key = this::handleKey;
    private void handleKey(VerifyEvent event) {
        if (event.keyCode == SWT.ESC) { clear(true); return; }
        if (event.keyCode != SWT.TAB || suggestion == null) return;
        event.doit = false;
        try {
            ITextEditor editor = session.documents.active();
            if (editor == null || session.documents.descriptor(editor).get("version").getAsLong() != version || widget.getCaretOffset() != caret || modelOffset() != modelCaret) { clear(true); return; }
            JsonObject selected = suggestion; suggestion = null;
            JsonObject params = Json.object("uri", session.documents.uri(editor), "expectedVersion", version, "range", selected.get("range"), "text", selected.get("text"), "undoLabel", selected.get("id").getAsString());
            // Completion is the user's explicit Tab action: current dirty text is expected, not overwritten.
            session.documents.acceptCompletion(params);
            session.notify("tab/accepted", Json.object("id", selected.get("id"), "uri", session.documents.uri(editor), "version", session.documents.descriptor(editor).get("version")));
            widget.redraw();
        } catch (Exception ex) { clear(true); MusePlugin.get().log("MHP_COMPLETION_FAILURE"); }
    }
    private final ModifyListener modify = event -> { clear(true); scheduleAutomatic(); };
    private final org.eclipse.swt.custom.CaretListener move = event -> { clear(true); scheduleAutomatic(); };
    private void scheduleAutomatic() {
        if (registration.get("trigger").getAsString().equals("invoke") || widget == null || widget.isDisposed()) return;
        long expected = generation;
        widget.getDisplay().timerExec(100, () -> { if (generation == expected && widget != null && !widget.isDisposed()) complete("automatic"); });
    }
    private final ISelectionListener selection = (part, value) -> attach();
    private Completion(WindowSession session, JsonObject registration) { this.session = session; this.registration = registration; session.window.getSelectionService().addPostSelectionListener(selection); attach(); }
    public static void install(WindowSession session, JsonObject params) { Completion existing = INSTANCES.get(session); if (existing != null) existing.registration = params.deepCopy(); else INSTANCES.put(session, new Completion(session, params.deepCopy())); }
    public static void invoke(WindowSession session) { Completion instance = INSTANCES.get(session); if (instance == null) throw new IllegalStateException("MHP_TAB_NOT_REGISTERED"); instance.attach(); instance.complete("invoke"); }
    private void attach() {
        ITextEditor editor = session.documents.active();
        ITextOperationTarget target = editor == null ? null : editor.getAdapter(ITextOperationTarget.class);
        TextViewer nextViewer = target instanceof TextViewer text ? text : null;
        StyledText next = nextViewer == null ? null : nextViewer.getTextWidget();
        if (widget == next) return;
        detach(); viewer = nextViewer; widget = next;
        if (widget != null) { widget.addPaintListener(paint); widget.addVerifyKeyListener(key); widget.addModifyListener(modify); widget.addCaretListener(move); }
    }
    private void complete(String trigger) {
        try {
            if (widget == null || widget.isDisposed()) throw new IllegalStateException("MHP_EDITOR_UNAVAILABLE");
            clear(true);
            ITextEditor editor = session.documents.active();
            JsonObject descriptor = session.documents.descriptor(editor);
            if (!registration.getAsJsonArray("languages").asList().contains(descriptor.get("languageId"))) return;
            IDocument document = session.documents.document(editor);
            caret = widget.getCaretOffset(); modelCaret = modelOffset();
            if (modelCaret < 0 || modelCaret > document.getLength()) throw new IllegalArgumentException("MHP_INVALID_RANGE");
            version = descriptor.get("version").getAsLong(); long expected = ++generation;
            JsonObject params = Json.object("uri", descriptor.get("uri"), "version", version, "position", Documents.position(document, modelCaret), "context", Json.object("prefix", document.get(0, modelCaret), "suffix", document.get(modelCaret, document.getLength() - modelCaret), "trigger", trigger));
            org.eclipse.swt.widgets.Display display = widget.getDisplay();
            session.peer.request("tab/complete", params).whenComplete((result, error) -> { if (display.isDisposed()) return; display.asyncExec(() -> {
                if (widget == null || widget.isDisposed() || generation != expected) return;
                if (error != null) { MusePlugin.get().log("MHP_COMPLETION_FAILURE"); return; }
                JsonArray completions = result.getAsJsonArray(); suggestion = completions.isEmpty() ? null : completions.get(0).getAsJsonObject(); widget.redraw();
            }); });
        } catch (Exception ex) { MusePlugin.get().log("MHP_COMPLETION_FAILURE"); }
    }
    private int modelOffset() { return viewer instanceof ITextViewerExtension5 projection ? projection.widgetOffset2ModelOffset(widget.getCaretOffset()) : viewer.getVisibleRegion().getOffset() + widget.getCaretOffset(); }
    private void clear(boolean rejected) { generation++; if (suggestion != null && rejected) session.notify("tab/rejected", Json.object("id", suggestion.get("id"))); suggestion = null; if (widget != null && !widget.isDisposed()) widget.redraw(); }
    private void detach() { clear(true); if (widget != null && !widget.isDisposed()) { widget.removePaintListener(paint); widget.removeVerifyKeyListener(key); widget.removeModifyListener(modify); widget.removeCaretListener(move); } widget = null; viewer = null; }
    public static void dispose(WindowSession session) { Completion instance = INSTANCES.remove(session); if (instance != null) { session.window.getSelectionService().removePostSelectionListener(instance.selection); instance.detach(); } }
}
