package io.musespark.eclipse.tests;

import static org.junit.Assert.*;
import com.google.gson.*;
import io.musespark.eclipse.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.eclipse.core.resources.*;
import org.eclipse.core.runtime.Platform;
import org.eclipse.jface.text.*;
import org.eclipse.swt.SWT;
import org.eclipse.swt.custom.*;
import org.eclipse.swt.widgets.*;
import org.eclipse.ui.*;
import org.eclipse.ui.texteditor.ITextEditor;
import org.junit.*;

public class SessionTest {
    private WindowSession session;
    private Process runtime;
    private Path fixture;
    private IProject project;
    private ITextEditor editor;
    @Before public void setup() throws Exception {
        Platform.getBundle("io.musespark.eclipse").start();
        fixture = Files.createTempFile("m104-runtime-", ".py");
        try (InputStream input = getClass().getResourceAsStream("/fixtures/runtime.py")) { assertNotNull(input); Files.write(fixture, input.readAllBytes()); }
        ProcessBuilder builder = new ProcessBuilder("python3", fixture.toString()); Map<String, String> clean = Assets.environment(builder.environment()); builder.environment().clear(); builder.environment().putAll(clean); runtime = builder.start();
        session = new WindowSession(PlatformUI.getWorkbench().getActiveWorkbenchWindow(), runtime);
        CountDownLatch initialized = new CountDownLatch(1); session.afterInitialize(initialized::countDown); pump(() -> initialized.getCount() == 0);
        project = ResourcesPlugin.getWorkspace().getRoot().getProject("m104-session-" + UUID.randomUUID()); project.create(null); project.open(null);
        IFile file = project.getFile("example.txt"); file.create(new ByteArrayInputStream("user".getBytes(StandardCharsets.UTF_8)), true, null); editor = session.documents.open(file.getLocationURI().toString());
    }
    @After public void cleanup() throws Exception {
        if (session != null) session.close();
        if (editor != null) PlatformUI.getWorkbench().getActiveWorkbenchWindow().getActivePage().closeEditor(editor, false);
        if (project != null) project.delete(true, true, null);
        if (runtime != null) { runtime.destroyForcibly(); runtime.waitFor(2, TimeUnit.SECONDS); }
        if (fixture != null) Files.deleteIfExists(fixture);
    }
    @Test public void realProblemsFeedTheNativeVerifyLoopAndLifecycleClosesRuntime() throws Exception {
        IFile file = project.getFile("example.txt"); IMarker marker = file.createMarker(IMarker.PROBLEM); marker.setAttribute(IMarker.LINE_NUMBER, 1); marker.setAttribute(IMarker.SEVERITY, IMarker.SEVERITY_ERROR); marker.setAttribute(IMarker.MESSAGE, "fake compiler diagnostic");
        JsonArray diagnostics = session.diagnostics(file.getLocationURI().toString()); assertEquals(1, diagnostics.size()); assertEquals("error", diagnostics.get(0).getAsJsonObject().get("severity").getAsString());
        assertFalse(session.uiRequest("workspace/trust", new JsonObject()).getAsJsonObject().get("trusted").getAsBoolean());
        assertFalse(WindowSession.CAPABILITIES.contains("surfaces"));
        assertThrows(IllegalArgumentException.class, () -> session.uiRequest("surfaces/open", Json.object("kind", "whatsNew", "placement", "tab")));
        assertThrows(IllegalArgumentException.class, () -> session.uiRequest("workspace/findFiles", Json.object("include", "**", "limit", 100)));
        session.close(); assertFalse(runtime.isAlive());
    }
    @Test public void invokeGhostTextAndTabAcceptUseFakeRuntimeAndOneUndo() throws Exception {
        session.uiRequest("tab/register", Json.object("languages", new String[] {"txt"}, "trigger", "invoke"));
        ITextOperationTarget target = editor.getAdapter(ITextOperationTarget.class); if (!(target instanceof TextViewer viewer)) throw new AssertionError("text viewer unavailable"); StyledText widget = viewer.getTextWidget(); widget.setCaretOffset(4);
        Completion.invoke(session);
        Event event = new Event(); event.keyCode = SWT.TAB; event.character = '\t';
        pump(() -> { event.doit = true; widget.notifyListeners(ST.VerifyKey, event); return !event.doit; });
        assertFalse(event.doit); assertEquals("user-complete", session.documents.document(editor).get());
        viewer.doOperation(ITextOperationTarget.UNDO); assertEquals("user", session.documents.document(editor).get());
    }
    @Test public void automaticCompletionSurvivesTheTypingCaretEvent() throws Exception {
        session.uiRequest("tab/register", Json.object("languages", new String[] {"txt"}, "trigger", "automatic"));
        ITextOperationTarget target = editor.getAdapter(ITextOperationTarget.class); if (!(target instanceof TextViewer viewer)) throw new AssertionError("text viewer unavailable"); StyledText widget = viewer.getTextWidget();
        session.documents.document(editor).replace(4, 0, " typed"); widget.setCaretOffset(session.documents.document(editor).getLength());
        Event event = new Event(); event.keyCode = SWT.TAB; event.character = '\t';
        pump(() -> { event.doit = true; widget.notifyListeners(ST.VerifyKey, event); return !event.doit; });
        assertEquals("user typed-complete", session.documents.document(editor).get());
        viewer.doOperation(ITextOperationTarget.UNDO); assertEquals("user typed", session.documents.document(editor).get());
    }
    @Test public void interruptedQueuedEditorRequestCannotApplyLater() throws Exception {
        JsonObject position = Json.object("line", 0, "character", 0); JsonArray edits = new JsonArray();
        edits.add(Json.object("range", Json.object("start", position, "end", position), "newText", "unexpected"));
        JsonObject params = Json.object("uri", session.documents.uri(editor), "expectedVersion", session.documents.descriptor(editor).get("version"), "edits", edits, "undoLabel", "fake queued edit");
        java.util.concurrent.atomic.AtomicReference<Exception> failure = new java.util.concurrent.atomic.AtomicReference<>();
        Thread request = new Thread(() -> { try { session.request("documents/applyEdits", params, () -> false); } catch (Exception ex) { failure.set(ex); } });
        request.start(); long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        while (request.getState() != Thread.State.TIMED_WAITING && System.nanoTime() < deadline) Thread.onSpinWait();
        assertEquals(Thread.State.TIMED_WAITING, request.getState()); request.interrupt(); request.join(TimeUnit.SECONDS.toMillis(2)); assertFalse(request.isAlive()); assertTrue(failure.get() instanceof InterruptedException);
        while (Display.getDefault().readAndDispatch()) { }
        assertEquals("user", session.documents.document(editor).get());
    }
    private static void pump(java.util.function.BooleanSupplier complete) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(100);
        boolean settled = complete.getAsBoolean();
        while (!settled && System.nanoTime() < deadline) { Display.getDefault().timerExec(100, () -> { }); if (!Display.getDefault().readAndDispatch()) Display.getDefault().sleep(); settled = complete.getAsBoolean(); }
        assertTrue("fake runtime operation did not settle", settled);
    }
}
