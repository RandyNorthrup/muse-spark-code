package io.musespark.eclipse;

import com.google.gson.*;
import java.net.URI;
import java.util.*;
import java.util.function.Consumer;
import org.eclipse.core.filesystem.EFS;
import org.eclipse.core.resources.*;
import org.eclipse.core.runtime.*;
import org.eclipse.jface.text.*;
import org.eclipse.ui.*;
import org.eclipse.ui.ide.IDE;
import org.eclipse.ui.texteditor.*;

/** Eclipse buffers are authoritative. Validate every edit before opening an undo transaction. */
public final class Documents implements AutoCloseable {
    private record Buffer(ITextEditor editor, IDocument document, IDocumentListener listener) { }
    private final Map<String, Buffer> buffers = new HashMap<>();
    private final IWorkbenchWindow window;
    private final Consumer<JsonObject> change;
    private final int selectionCap;
    public Documents(IWorkbenchWindow window, Consumer<JsonObject> change, int selectionCap) { this.window = window; this.change = change; this.selectionCap = selectionCap; }
    public ITextEditor active() {
        IEditorPart part = window.getActivePage().getActiveEditor();
        return part instanceof ITextEditor text ? text : null;
    }
    public String uri(ITextEditor editor) {
        if (editor.getEditorInput() instanceof IURIEditorInput input) return input.getURI().toString();
        throw new IllegalArgumentException("MHP_DOCUMENT_UNAVAILABLE");
    }
    public IDocument document(ITextEditor editor) {
        IDocument document = editor.getDocumentProvider().getDocument(editor.getEditorInput());
        String uri = uri(editor);
        if (!buffers.containsKey(uri)) {
            IDocumentListener listener = new IDocumentListener() {
                @Override public void documentAboutToBeChanged(DocumentEvent event) { }
                @Override public void documentChanged(DocumentEvent event) { change.accept(Json.object("document", descriptor(editor), "text", document.get())); }
            };
            document.addDocumentListener(listener); buffers.put(uri, new Buffer(editor, document, listener));
        }
        return document;
    }
    public ITextEditor open(String uri) throws Exception {
        URI location = URI.create(uri);
        if (!location.getScheme().equals("file")) throw new IllegalArgumentException("MHP_DOCUMENT_UNAVAILABLE");
        IEditorPart part = IDE.openEditorOnFileStore(window.getActivePage(), EFS.getStore(location));
        if (!(part instanceof ITextEditor text)) throw new IllegalArgumentException("MHP_DOCUMENT_UNAVAILABLE");
        document(text); return text;
    }
    public JsonObject descriptor(ITextEditor editor) {
        IDocument document = editor.getDocumentProvider().getDocument(editor.getEditorInput());
        if (!(document instanceof IDocumentExtension4 extended)) throw new IllegalArgumentException("MHP_DOCUMENT_VERSION_UNAVAILABLE");
        long version = extended.getModificationStamp();
        if (version < 0) throw new IllegalArgumentException("MHP_DOCUMENT_VERSION_UNAVAILABLE");
        String language = editor.getEditorInput().getName(); int dot = language.lastIndexOf('.');
        return Json.object("uri", uri(editor), "version", version, "dirty", editor.isDirty(), "languageId", dot < 0 ? "plaintext" : switch (language.substring(dot + 1).toLowerCase(Locale.ROOT)) {
            case "ts", "mts", "cts" -> "typescript";
            case "tsx" -> "typescriptreact";
            case "js", "mjs", "cjs" -> "javascript";
            case "jsx" -> "javascriptreact";
            case "py", "pyw" -> "python";
            case "txt" -> "plaintext";
            case "h" -> "c";
            case "cc", "cxx", "hpp", "hxx" -> "cpp";
            case "cs" -> "csharp";
            case "sh", "bash" -> "shellscript";
            case "md" -> "markdown";
            case "yml" -> "yaml";
            case "rs" -> "rust";
            case "kt", "kts" -> "kotlin";
            case "rb" -> "ruby";
            default -> language.substring(dot + 1).toLowerCase(Locale.ROOT);
        });
    }
    public JsonArray list() {
        JsonArray result = new JsonArray();
        for (IWorkbenchWindow window : PlatformUI.getWorkbench().getWorkbenchWindows()) for (IWorkbenchPage page : window.getPages()) for (IEditorReference reference : page.getEditorReferences()) {
            IEditorPart part = reference.getEditor(false);
            if (part instanceof ITextEditor text) { document(text); result.add(descriptor(text)); }
        }
        return result;
    }
    public static int offset(IDocument document, JsonObject position) throws BadLocationException {
        int line = position.get("line").getAsInt(); int character = position.get("character").getAsInt();
        IRegion region = document.getLineInformation(line);
        if (character < 0 || character > region.getLength()) throw new BadLocationException();
        return region.getOffset() + character;
    }
    public static JsonObject position(IDocument document, int offset) throws BadLocationException {
        int line = document.getLineOfOffset(offset);
        return Json.object("line", line, "character", offset - document.getLineOffset(line));
    }
    public JsonElement selection() throws BadLocationException {
        ITextEditor editor = active();
        if (editor == null) return JsonNull.INSTANCE;
        IDocument document = document(editor);
        if (!(editor.getSelectionProvider().getSelection() instanceof ITextSelection selection)) return JsonNull.INSTANCE;
        int start = selection.getOffset(); int end = start + selection.getLength();
        JsonObject range = Json.object("start", position(document, start), "end", position(document, end));
        int cap = selectionCap;
        return Json.object("uri", uri(editor), "version", descriptor(editor).get("version"), "range", range, "excerpt", document.get(start, Math.min(selection.getLength(), cap)), "truncated", selection.getLength() > cap);
    }
    public JsonElement request(String method, JsonObject params) throws Exception {
        if (method.equals("documents/list")) return list();
        if (method.equals("documents/saveAll")) return Json.object("saved", PlatformUI.getWorkbench().saveAllEditors(true));
        if (method.equals("editor/active")) return selection();
        ITextEditor editor = open(params.get("uri").getAsString()); IDocument document = document(editor);
        if (method.equals("documents/read")) return Json.object("document", descriptor(editor), "text", document.get());
        if (method.equals("editor/open")) {
            if (params.has("range")) { JsonObject range = params.getAsJsonObject("range"); int start = offset(document, range.getAsJsonObject("start")); int end = offset(document, range.getAsJsonObject("end")); if (end < start) throw new IllegalArgumentException("MHP_INVALID_RANGE"); editor.selectAndReveal(start, end - start); }
            return JsonNull.INSTANCE;
        }
        if (descriptor(editor).get("version").getAsLong() != params.get("expectedVersion").getAsLong()) throw new IllegalArgumentException("MHP_VERSION_CONFLICT");
        if (method.equals("documents/save")) { editor.doSave(new NullProgressMonitor()); if (editor.isDirty()) throw new IllegalStateException("MHP_SAVE_FAILED"); return descriptor(editor); }
        if (editor.isDirty()) throw new IllegalArgumentException("MHP_DIRTY_DOCUMENT");
        JsonArray edits;
        if (method.equals("documents/applyEdits")) edits = params.getAsJsonArray("edits");
        else {
            JsonObject range = method.equals("editor/insertAtCursor") ? Json.object("start", params.get("position"), "end", params.get("position")) : params.getAsJsonObject("range");
            edits = new JsonArray(); edits.add(Json.object("range", range, "newText", params.get("text")));
        }
        List<Replacement> replacements = replacements(document, edits);
        return apply(editor, document, replacements);
    }
    public JsonElement acceptCompletion(JsonObject params) throws Exception {
        ITextEditor editor = active();
        if (editor == null || !uri(editor).equals(params.get("uri").getAsString()) || descriptor(editor).get("version").getAsLong() != params.get("expectedVersion").getAsLong()) throw new IllegalArgumentException("MHP_VERSION_CONFLICT");
        JsonArray edits = new JsonArray(); edits.add(Json.object("range", params.get("range"), "newText", params.get("text")));
        return apply(editor, document(editor), replacements(document(editor), edits));
    }
    private JsonElement apply(ITextEditor editor, IDocument document, List<Replacement> replacements) throws BadLocationException {
        IRewriteTarget target = editor.getAdapter(IRewriteTarget.class);
        if (target == null) throw new IllegalArgumentException("MHP_UNDO_UNAVAILABLE");
        target.beginCompoundChange();
        try { for (Replacement replacement : replacements) document.replace(replacement.start, replacement.length, replacement.text); }
        finally { target.endCompoundChange(); }
        return descriptor(editor);
    }
    private record Replacement(int start, int length, String text) { }
    private static List<Replacement> replacements(IDocument document, JsonArray edits) {
        try {
            List<Replacement> replacements = new ArrayList<>();
            for (JsonElement edit : edits) {
                JsonObject range = edit.getAsJsonObject().getAsJsonObject("range");
                int start = offset(document, range.getAsJsonObject("start")); int end = offset(document, range.getAsJsonObject("end"));
                if (end < start) throw new IllegalArgumentException("MHP_INVALID_RANGE");
                replacements.add(new Replacement(start, end - start, edit.getAsJsonObject().get("newText").getAsString()));
            }
            replacements.sort(Comparator.comparingInt(Replacement::start).reversed());
            for (int i = 1; i < replacements.size(); i++) if (replacements.get(i).start + replacements.get(i).length > replacements.get(i - 1).start || replacements.get(i).start == replacements.get(i - 1).start) throw new IllegalArgumentException("MHP_INVALID_RANGE");
            return replacements;
        } catch (BadLocationException ex) { throw new IllegalArgumentException("MHP_INVALID_RANGE"); }
    }
    public void closed(ITextEditor editor) {
        Buffer buffer = buffers.remove(uri(editor));
        if (buffer != null) buffer.document.removeDocumentListener(buffer.listener);
    }
    public ITextEditor editor(String uri) {
        for (IWorkbenchWindow window : PlatformUI.getWorkbench().getWorkbenchWindows()) for (IWorkbenchPage page : window.getPages()) for (IEditorReference reference : page.getEditorReferences()) {
            IEditorPart part = reference.getEditor(false);
            if (part instanceof ITextEditor text) { try { if (uri(text).equals(uri)) return text; } catch (IllegalArgumentException ex) { /* Inputs without a file URI never match. */ } }
        }
        return null;
    }
    @Override public void close() { for (Buffer buffer : buffers.values()) buffer.document.removeDocumentListener(buffer.listener); buffers.clear(); }
}
