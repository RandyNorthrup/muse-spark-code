package io.musespark.eclipse.tests;

import static org.junit.Assert.*;
import com.google.gson.*;
import io.musespark.eclipse.*;
import java.io.ByteArrayInputStream;
import java.util.*;
import org.eclipse.core.resources.*;
import org.eclipse.core.runtime.NullProgressMonitor;
import org.eclipse.jface.text.*;
import org.eclipse.ui.*;
import org.eclipse.ui.texteditor.ITextEditor;
import org.junit.*;

public class WorkbenchTest {
    private IProject project;
    private IFile file;
    private Documents documents;
    private ITextEditor editor;
    private final List<JsonObject> changes = new ArrayList<>();
    @Before public void setup() throws Exception {
        project = ResourcesPlugin.getWorkspace().getRoot().getProject("m104-test-" + UUID.randomUUID()); project.create(null); project.open(null);
        file = project.getFile("sample.txt"); file.create(new ByteArrayInputStream("alpha\nbeta\n".getBytes(java.nio.charset.StandardCharsets.UTF_8)), true, null);
        documents = new Documents(PlatformUI.getWorkbench().getActiveWorkbenchWindow(), changes::add, new Contract().selectionCap); editor = documents.open(file.getLocationURI().toString());
    }
    @After public void cleanup() throws Exception { documents.close(); PlatformUI.getWorkbench().getActiveWorkbenchWindow().getActivePage().closeEditor(editor, false); project.delete(true, true, null); }
    @Test public void currentVersionEditIsAtomicAndOneUndoRestoresBuffer() throws Exception {
        long version = documents.descriptor(editor).get("version").getAsLong();
        JsonArray edits = new JsonArray(); edits.add(edit(0, 0, 0, 5, "ALPHA")); edits.add(edit(1, 0, 1, 4, "BETA"));
        documents.request("documents/applyEdits", params(version, edits)); assertEquals("ALPHA\nBETA\n", documents.document(editor).get()); assertTrue(editor.isDirty());
        ITextOperationTarget target = editor.getAdapter(ITextOperationTarget.class); assertNotNull(target); assertTrue(target.canDoOperation(ITextOperationTarget.UNDO)); target.doOperation(ITextOperationTarget.UNDO);
        assertEquals("alpha\nbeta\n", documents.document(editor).get()); assertFalse(changes.isEmpty());
    }
    @Test public void staleVersionAndDirtyBufferNeverChangeUserText() throws Exception {
        long version = documents.descriptor(editor).get("version").getAsLong(); JsonArray edits = new JsonArray(); edits.add(edit(0, 0, 0, 5, "changed"));
        assertThrows(IllegalArgumentException.class, () -> documents.request("documents/applyEdits", params(version + 1, edits)));
        documents.document(editor).replace(0, 0, "user "); String before = documents.document(editor).get();
        assertThrows(IllegalArgumentException.class, () -> documents.request("documents/applyEdits", params(documents.descriptor(editor).get("version").getAsLong(), edits)));
        assertEquals(before, documents.document(editor).get());
    }
    @Test public void invalidOrOverlappingRangesAreRefusedBeforeAnyEdit() throws Exception {
        long version = documents.descriptor(editor).get("version").getAsLong();
        for (JsonArray edits : new JsonArray[] {array(edit(0, 2, 0, 1, "x")), array(edit(0, 0, 0, 100, "x")), array(edit(0, 0, 0, 4, "x"), edit(0, 2, 0, 5, "y")), array(edit(0, 0, 0, 0, "x"), edit(0, 0, 0, 0, "y"))}) { assertThrows(IllegalArgumentException.class, () -> documents.request("documents/applyEdits", params(version, edits))); assertEquals("alpha\nbeta\n", documents.document(editor).get()); }
    }
    @Test public void unsavedReadSelectionAndSaveUseEditorBuffer() throws Exception {
        documents.document(editor).replace(0, 0, "draft "); editor.selectAndReveal(0, 5);
        JsonElement selection = documents.selection(); assertEquals("draft", selection.getAsJsonObject().get("excerpt").getAsString());
        JsonElement read = documents.request("documents/read", Json.object("uri", file.getLocationURI().toString())); assertTrue(read.getAsJsonObject().get("text").getAsString().startsWith("draft "));
        documents.request("documents/save", Json.object("uri", file.getLocationURI().toString(), "expectedVersion", documents.descriptor(editor).get("version"))); assertFalse(editor.isDirty());
    }
    @Test public void completionAcceptsCurrentDirtyBufferWithoutLosingOtherText() throws Exception {
        documents.document(editor).replace(0, 0, "user ");
        JsonObject params = Json.object("uri", file.getLocationURI().toString(), "expectedVersion", documents.descriptor(editor).get("version"), "range", edit(0, 5, 0, 5, "x").get("range"), "text", "completion");
        documents.acceptCompletion(params); assertEquals("user completionalpha\nbeta\n", documents.document(editor).get());
        assertThrows(IllegalArgumentException.class, () -> documents.acceptCompletion(params));
    }
    @Test public void standardLanguageIdsMatchRuntimeCompletionRegistrations() throws Exception {
        Map<String, String> languages = Map.of("ts", "typescript", "tsx", "typescriptreact", "js", "javascript", "jsx", "javascriptreact", "py", "python", "txt", "plaintext", "TS", "typescript");
        for (var entry : languages.entrySet()) {
            IFile sample = project.getFile("language." + entry.getKey()); sample.create(new ByteArrayInputStream(new byte[0]), true, null); ITextEditor opened = (ITextEditor) org.eclipse.ui.ide.IDE.openEditor(PlatformUI.getWorkbench().getActiveWorkbenchWindow().getActivePage(), sample, "org.eclipse.ui.DefaultTextEditor");
            try { assertEquals(entry.getKey(), entry.getValue(), documents.descriptor(opened).get("languageId").getAsString()); }
            finally { PlatformUI.getWorkbench().getActiveWorkbenchWindow().getActivePage().closeEditor(opened, false); }
        }
    }
    private JsonObject params(long version, JsonArray edits) { return Json.object("uri", file.getLocationURI().toString(), "expectedVersion", version, "edits", edits, "undoLabel", "test"); }
    private static JsonObject edit(int sl, int sc, int el, int ec, String text) { return Json.object("range", Json.object("start", Json.object("line", sl, "character", sc), "end", Json.object("line", el, "character", ec)), "newText", text); }
    private static JsonArray array(JsonObject... edits) { JsonArray result = new JsonArray(); for (JsonObject edit : edits) result.add(edit); return result; }
}
