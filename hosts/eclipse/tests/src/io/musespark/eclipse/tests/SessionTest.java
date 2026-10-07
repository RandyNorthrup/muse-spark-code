package io.musespark.eclipse.tests;

import static org.junit.Assert.*;
import com.google.gson.*;
import io.musespark.eclipse.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.List;
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
    private Path receipts;
    private IProject project;
    private ITextEditor editor;
    @Before public void setup() throws Exception {
        Platform.getBundle("io.musespark.eclipse").start();
        fixture = Files.createTempFile("m104-runtime-", ".py");
        try (InputStream input = getClass().getResourceAsStream("/fixtures/runtime.py")) { assertNotNull(input); Files.write(fixture, input.readAllBytes()); }
        receipts = Files.createTempFile("m104-receipts-", ".ndjson");
        ProcessBuilder builder = new ProcessBuilder("python3", fixture.toString(), "--receipts", receipts.toString()); Map<String, String> clean = Assets.environment(builder.environment()); builder.environment().clear(); builder.environment().putAll(clean); runtime = builder.start();
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
        if (receipts != null) Files.deleteIfExists(receipts);
    }
    @Test public void realProblemsFeedTheNativeVerifyLoopAndLifecycleClosesRuntime() throws Exception {
        IFile file = project.getFile("example.txt"); IMarker marker = file.createMarker(IMarker.PROBLEM); marker.setAttribute(IMarker.LINE_NUMBER, 1); marker.setAttribute(IMarker.SEVERITY, IMarker.SEVERITY_ERROR); marker.setAttribute(IMarker.MESSAGE, "fake compiler diagnostic");
        JsonArray diagnostics = session.diagnostics(file.getLocationURI().toString()); assertEquals(1, diagnostics.size()); assertEquals("error", diagnostics.get(0).getAsJsonObject().get("severity").getAsString());
        assertFalse(session.uiRequest("workspace/trust", new JsonObject()).getAsJsonObject().get("trusted").getAsBoolean());
        assertTrue(WindowSession.CAPABILITIES.contains("surfaces"));
        assertThrows(IllegalArgumentException.class, () -> session.uiRequest("surfaces/open", Json.object("kind", "whatsNew", "placement", "tab")));
        assertThrows(IllegalArgumentException.class, () -> session.uiRequest("workspace/findFiles", Json.object("include", "**", "limit", 100)));
        session.close(); assertFalse(runtime.isAlive());
    }
    @Test public void invokeGhostTextAndTabAcceptUseFakeRuntimeAndOneUndo() throws Exception {
        session.uiRequest("tab/register", Json.object("languages", new String[] {"plaintext"}, "trigger", "invoke"));
        ITextOperationTarget target = editor.getAdapter(ITextOperationTarget.class); if (!(target instanceof TextViewer viewer)) throw new AssertionError("text viewer unavailable"); StyledText widget = viewer.getTextWidget(); widget.setCaretOffset(4);
        Completion.invoke(session);
        Event event = new Event(); event.keyCode = SWT.TAB; event.character = '\t';
        pump(() -> { event.doit = true; widget.notifyListeners(ST.VerifyKey, event); return !event.doit; });
        assertFalse(event.doit); assertEquals("user-complete", session.documents.document(editor).get());
        viewer.doOperation(ITextOperationTarget.UNDO); assertEquals("user", session.documents.document(editor).get());
    }
    @Test public void automaticCompletionSurvivesTheTypingCaretEvent() throws Exception {
        session.uiRequest("tab/register", Json.object("languages", new String[] {"plaintext"}, "trigger", "automatic"));
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
    @Test public void restrictedViewerCompletionUsesDocumentCoordinatesAndOneUndo() throws Exception {
        session.uiRequest("tab/register", Json.object("languages", new String[] {"plaintext"}, "trigger", "invoke"));
        IDocument document = session.documents.document(editor); document.set("hidden\nuser");
        ITextOperationTarget target = editor.getAdapter(ITextOperationTarget.class); if (!(target instanceof TextViewer viewer)) throw new AssertionError("text viewer unavailable");
        viewer.setVisibleRegion("hidden\n".length(), "user".length()); StyledText widget = viewer.getTextWidget(); widget.setCaretOffset("user".length());
        Completion.invoke(session); Event event = new Event(); event.keyCode = SWT.TAB; event.character = '\t';
        pump(() -> { event.doit = true; widget.notifyListeners(ST.VerifyKey, event); return !event.doit; });
        assertEquals("hidden\nuser-complete", document.get()); viewer.doOperation(ITextOperationTarget.UNDO); assertEquals("hidden\nuser", document.get()); viewer.resetVisibleRegion();
    }
    @Test public void foldedViewerCompletionUsesFullDocumentRange() throws Exception {
        IDocument document = session.documents.document(editor); document.set("heading\nhidden\nuser"); session.close();
        Shell shell = new Shell(Display.getDefault()); shell.setLayout(new org.eclipse.swt.layout.FillLayout());
        java.util.concurrent.atomic.AtomicInteger projectionShift = new java.util.concurrent.atomic.AtomicInteger();
        org.eclipse.jface.text.source.projection.ProjectionViewer viewer = new org.eclipse.jface.text.source.projection.ProjectionViewer(shell, null, null, false, SWT.NONE) {
            @Override public int widgetOffset2ModelOffset(int offset) { return super.widgetOffset2ModelOffset(offset) + projectionShift.get(); }
        };
        viewer.setDocument(document, new org.eclipse.jface.text.source.AnnotationModel()); viewer.enableProjection();
        viewer.getProjectionAnnotationModel().addAnnotation(new org.eclipse.jface.text.source.projection.ProjectionAnnotation(true), new Position(0, "heading\nhidden\n".length()));
        ITextEditor decorated = (ITextEditor) java.lang.reflect.Proxy.newProxyInstance(ITextEditor.class.getClassLoader(), new Class<?>[] {ITextEditor.class}, (proxy, method, arguments) -> method.getName().equals("getAdapter") && arguments[0] == ITextOperationTarget.class ? viewer : method.invoke(editor, arguments));
        IWorkbenchWindow actual = PlatformUI.getWorkbench().getActiveWorkbenchWindow(); IWorkbenchPage page = actual.getActivePage();
        IWorkbenchPage decoratedPage = (IWorkbenchPage) java.lang.reflect.Proxy.newProxyInstance(IWorkbenchPage.class.getClassLoader(), new Class<?>[] {IWorkbenchPage.class}, (proxy, method, arguments) -> method.getName().equals("getActiveEditor") ? decorated : method.invoke(page, arguments));
        IWorkbenchWindow decoratedWindow = (IWorkbenchWindow) java.lang.reflect.Proxy.newProxyInstance(IWorkbenchWindow.class.getClassLoader(), new Class<?>[] {IWorkbenchWindow.class}, (proxy, method, arguments) -> method.getName().equals("getActivePage") ? decoratedPage : method.invoke(actual, arguments));
        ProcessBuilder builder = new ProcessBuilder("python3", fixture.toString()); Map<String, String> clean = Assets.environment(builder.environment()); builder.environment().clear(); builder.environment().putAll(clean); runtime = builder.start();
        session = new WindowSession(decoratedWindow, runtime); CountDownLatch ready = new CountDownLatch(1); session.afterInitialize(ready::countDown); pump(() -> ready.getCount() == 0);
        try {
            shell.open(); session.uiRequest("tab/register", Json.object("languages", new String[] {"plaintext"}, "trigger", "invoke")); StyledText widget = viewer.getTextWidget(); assertFalse(widget.getText().contains("hidden")); widget.setCaretOffset(widget.getCharCount());
            Completion.invoke(session);
            java.lang.reflect.Field instances = Completion.class.getDeclaredField("INSTANCES"); instances.setAccessible(true); if (!(instances.get(null) instanceof Map<?, ?> completions)) throw new AssertionError("completion registration unavailable");
            Object completion = completions.get(session); java.lang.reflect.Field suggestion = Completion.class.getDeclaredField("suggestion"); suggestion.setAccessible(true);
            pump(() -> { try { return suggestion.get(completion) != null; } catch (IllegalAccessException ex) { throw new AssertionError(ex); } });
            projectionShift.set(1); Event event = new Event(); event.keyCode = SWT.TAB; event.character = '\t'; event.doit = true; widget.notifyListeners(ST.VerifyKey, event);
            assertEquals("a changed projection must not accept the old document range", "heading\nhidden\nuser", document.get()); projectionShift.set(0); Completion.invoke(session);
            pump(() -> { event.doit = true; widget.notifyListeners(ST.VerifyKey, event); return !event.doit; }); assertEquals("heading\nhidden\nuser-complete", document.get());
            editor.getAdapter(ITextOperationTarget.class).doOperation(ITextOperationTarget.UNDO); assertEquals("heading\nhidden\nuser", document.get());
        } finally { session.close(); shell.dispose(); }
    }
    @Test public void recursiveFileGlobsIncludeAndExcludeProjectRootFiles() throws Exception {
        IFile root = project.getFile("sample.ts"); root.create(new ByteArrayInputStream(new byte[0]), true, null);
        IFolder nested = project.getFolder("nested"); nested.create(true, true, null); IFile child = nested.getFile("child.ts"); child.create(new ByteArrayInputStream(new byte[0]), true, null);
        session.grantTrust();
        JsonArray typescript = session.uiRequest("workspace/findFiles", Json.object("include", "**/*.ts", "limit", 100)).getAsJsonArray();
        assertTrue(typescript.asList().contains(new JsonPrimitive(root.getLocationURI().toString()))); assertTrue(typescript.asList().contains(new JsonPrimitive(child.getLocationURI().toString())));
        JsonArray all = session.uiRequest("workspace/findFiles", Json.object("include", "**/*", "exclude", "**/*.ts", "limit", 100)).getAsJsonArray();
        assertTrue(all.asList().contains(new JsonPrimitive(project.getFile("example.txt").getLocationURI().toString()))); assertFalse(all.asList().contains(new JsonPrimitive(root.getLocationURI().toString()))); assertFalse(all.asList().contains(new JsonPrimitive(child.getLocationURI().toString())));
        JsonArray limited = session.uiRequest("workspace/findFiles", Json.object("include", "**/*", "limit", 1)).getAsJsonArray(); assertEquals(1, limited.size());
        MusePlugin.get().getPreferenceStore().setValue("trusted:" + ResourcesPlugin.getWorkspace().getRoot().getLocationURI(), false);
    }
    @Test public void sessionCloseTerminatesAnUnreadingRuntimeThatIgnoresGracefulStop() throws Exception {
        session.close();
        String source = Files.readString(fixture).replace("import json", "import json\nimport signal\nimport time\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)"); source = source.substring(0, source.indexOf("for line in sys.stdin:")) + "time.sleep(100)\n"; Files.writeString(fixture, source);
        ProcessBuilder builder = new ProcessBuilder("python3", fixture.toString()); Map<String, String> clean = Assets.environment(builder.environment()); builder.environment().clear(); builder.environment().putAll(clean); runtime = builder.start();
        session = new WindowSession(PlatformUI.getWorkbench().getActiveWorkbenchWindow(), runtime); CountDownLatch ready = new CountDownLatch(1); session.afterInitialize(ready::countDown); pump(() -> ready.getCount() == 0);
        session.peer.send(Json.object("body", "x".repeat(1024 * 1024))); session.peer.drain();
        java.util.concurrent.atomic.AtomicBoolean expired = new java.util.concurrent.atomic.AtomicBoolean(); ScheduledExecutorService watchdog = Executors.newSingleThreadScheduledExecutor(); Process child = runtime;
        ScheduledFuture<?> timeout = watchdog.schedule(() -> { expired.set(true); child.toHandle().destroyForcibly(); }, 2 + 2 + 2, TimeUnit.SECONDS);
        try { session.close(); assertFalse("window close waited for the watchdog to release the blocked pipe", expired.get()); assertTrue(child.waitFor(2, TimeUnit.SECONDS)); }
        finally { timeout.cancel(false); watchdog.shutdownNow(); child.toHandle().destroyForcibly(); }
    }
    @Test public void closeKillsCapturedDescendantsAfterTheParentExits() throws Exception {
        session.close();
        String wrapper = "import subprocess,sys,runpy; child=subprocess.Popen([sys.executable,'-c',\"import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); print('ready',flush=True); time.sleep(100)\"],stdout=subprocess.PIPE); child.stdout.readline(); runpy.run_path(sys.argv[1],run_name='__main__')";
        ProcessBuilder builder = new ProcessBuilder("python3", "-c", wrapper, fixture.toString()); Map<String, String> clean = Assets.environment(builder.environment()); builder.environment().clear(); builder.environment().putAll(clean); runtime = builder.start();
        session = new WindowSession(PlatformUI.getWorkbench().getActiveWorkbenchWindow(), runtime); CountDownLatch ready = new CountDownLatch(1); session.afterInitialize(ready::countDown); pump(() -> ready.getCount() == 0);
        List<ProcessHandle> children = runtime.descendants().toList(); assertEquals(1, children.size());
        try {
            session.close(); assertFalse(runtime.isAlive()); long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            java.util.function.BooleanSupplier running = () -> {
                if (!children.get(0).isAlive()) return false;
                Path stat = Path.of("/proc", Long.toString(children.get(0).pid()), "stat");
                try { return !Files.exists(stat) || !Files.readString(stat).contains(") Z "); } catch (IOException ex) { return children.get(0).isAlive(); }
            };
            while (running.getAsBoolean() && System.nanoTime() < deadline) Thread.onSpinWait(); assertFalse("captured child survived its parent", running.getAsBoolean());
        } finally { children.forEach(ProcessHandle::destroyForcibly); }
    }
    @Test public void admittedBrowserMessagesWaitForReloadAndRemainCounted() throws Exception {
        MuseView view = new MuseView();
        PanelSurface binding = new PanelSurface(session.contract, "reload-test", "session", "chat", session.peer::send, session.peer::purge, code -> { });
        java.lang.reflect.Field field = MuseView.class.getDeclaredField("binding"); field.setAccessible(true); field.set(view, binding);
        binding.opened(); binding.ready(); session.add(view);
        session.panel(Json.object("mhp", "1.2", "kind", "panel", "surface", binding.id, "direction", "toPanel", "seq", 1, "payload", Json.object("type", "conversationCleared")));
        binding.reload(); while (Display.getDefault().readAndDispatch()) { }
        assertEquals("reload must retain admitted messages and their byte reservations", 1, session.dropBrowser(binding.id));
        binding.ready(); session.panel(Json.object("mhp", "1.2", "kind", "panel", "surface", binding.id, "direction", "toPanel", "seq", 2, "payload", Json.object("type", "conversationCleared")));
        binding.reload(); while (Display.getDefault().readAndDispatch()) { } assertEquals(1, session.dropBrowser(binding.id)); binding.close(1); session.remove(view);
    }
    @Test public void browserReadyResumesRetainedDeliveriesAndFailuresAreReported() throws Exception {
        MuseView view = new MuseView(); PanelSurface binding = new PanelSurface(session.contract, "resume-test", "session", "chat", session.peer::send, session.peer::purge, code -> { });
        java.lang.reflect.Field field = MuseView.class.getDeclaredField("binding"); field.setAccessible(true); field.set(view, binding);
        Shell shell = new Shell(Display.getDefault()); shell.setLayout(new org.eclipse.swt.layout.FillLayout()); org.eclipse.swt.browser.Browser browser = new org.eclipse.swt.browser.Browser(shell, MuseView.browserStyle());
        field = MuseView.class.getDeclaredField("browser"); field.setAccessible(true); field.set(view, browser);
        try {
            shell.open(); browser.setText("<html><script>window.__museDeliver = payload => window.received = payload; window.testReady = true;</script></html>");
            pump(() -> { try { return Boolean.TRUE.equals(browser.evaluate("return window.testReady === true;")); } catch (RuntimeException ex) { return false; } });
            binding.opened(); binding.ready(); session.add(view);
            session.panel(Json.object("mhp", "1.2", "kind", "panel", "surface", binding.id, "direction", "toPanel", "seq", 1, "payload", Json.object("type", "conversationCleared")));
            binding.reload(); while (Display.getDefault().readAndDispatch()) { } assertNull(browser.evaluate("return window.received;"));
            binding.ready(); session.browserReady(); pump(() -> "conversationCleared".equals(browser.evaluate("return window.received && window.received.type;"))); assertEquals(0, session.dropBrowser(binding.id));
            browser.dispose(); session.panel(Json.object("mhp", "1.2", "kind", "panel", "surface", binding.id, "direction", "toPanel", "seq", 2, "payload", Json.object("type", "conversationCleared")));
            pump(() -> { try { return Files.readString(receipts).contains("\"seq\": 2, \"code\": \"MHP_PANEL_NOT_READY\""); } catch (IOException ex) { throw new java.io.UncheckedIOException(ex); } });
            assertTrue(Files.readString(receipts), Files.readString(receipts).lines().map(Json::parse).map(JsonElement::getAsJsonObject).anyMatch(frame -> frame.has("code") && frame.get("code").getAsString().equals("MHP_PANEL_NOT_READY") && frame.get("seq").getAsInt() == 2));
            binding.close(0); session.remove(view);
        } finally { if (!browser.isDisposed()) browser.dispose(); shell.dispose(); }
    }
    @Test public void aFullBrowserQueueCanStillReportFailedDelivery() throws Exception {
        MuseView view = new MuseView(); PanelSurface binding = new PanelSurface(session.contract, "full-queue-test", "session", "chat", session.peer::send, session.peer::purge, code -> { });
        java.lang.reflect.Field field = MuseView.class.getDeclaredField("binding"); field.setAccessible(true); field.set(view, binding); binding.opened(); binding.ready(); session.add(view); session.peer.drain();
        for (int seq = 1; seq <= session.contract.queueMessages; seq++) session.panel(Json.object("mhp", "1.2", "kind", "panel", "surface", binding.id, "direction", "toPanel", "seq", seq, "payload", Json.object("type", "conversationCleared")));
        pump(() -> { try { return Files.readString(receipts).contains("\"seq\": " + session.contract.queueMessages + ", \"code\": \"MHP_PANEL_NOT_READY\""); } catch (IOException ex) { throw new java.io.UncheckedIOException(ex); } });
        assertFalse(session.isClosed()); assertEquals(0, session.dropBrowser(binding.id)); binding.close(0); session.remove(view);
    }
    @Test public void nativeHtmlRenderRejectsStaleRepliesAndRoutesWhatsNewClicks() throws Exception {
        session.close(); List<JsonObject> requests = new ArrayList<>(); List<CompletableFuture<JsonObject>> replies = new ArrayList<>();
        Assets.HtmlPort port = new Assets.HtmlPort() {
            @Override public boolean supports(String protocol, String capability) { return protocol.equals("mhp/1.2.0") && capability.equals("surfaceHtml"); }
            @Override public CompletableFuture<JsonObject> render(JsonObject params) { requests.add(params); CompletableFuture<JsonObject> reply = new CompletableFuture<>(); replies.add(reply); return reply; }
        };
        ProcessBuilder builder = new ProcessBuilder("python3", fixture.toString(), "--receipts", receipts.toString()); Map<String, String> clean = Assets.environment(builder.environment()); builder.environment().clear(); builder.environment().putAll(clean); runtime = builder.start();
        session = new WindowSession(PlatformUI.getWorkbench().getActiveWorkbenchWindow(), runtime, port); CountDownLatch initialized = new CountDownLatch(1); session.afterInitialize(initialized::countDown); pump(() -> initialized.getCount() == 0);
        JsonObject context = session.hostContext(); assertEquals(Set.of("host", "protocolRange", "capabilities", "locale", "theme", "folders", "trusted"), context.keySet()); assertEquals(Assets.locale(Platform.getNL()), context.get("locale").getAsString()); assertFalse(context.get("host").getAsJsonObject().get("version").getAsString().isBlank()); assertTrue(WindowSession.CAPABILITIES.contains("surfaces"));
        String surface = session.uiRequest("surfaces/open", Json.object("kind", "whatsNew", "placement", "tab", "sessionId", "html-test")).getAsJsonObject().get("surfaceId").getAsString();
        MuseView view = null; for (IViewReference reference : session.window.getActivePage().getViewReferences()) if (reference.getView(false) instanceof MuseView candidate && candidate.binding().id.equals(surface)) view = candidate;
        assertNotNull(view); MuseView opened = view; pump(() -> requests.size() == 1);
        java.lang.reflect.Field browserField = MuseView.class.getDeclaredField("browser"); browserField.setAccessible(true); org.eclipse.swt.browser.Browser browser = (org.eclipse.swt.browser.Browser) browserField.get(opened);
        java.lang.reflect.Method reload = MuseView.class.getDeclaredMethod("loadPage"); reload.setAccessible(true); reload.invoke(opened); pump(() -> requests.size() == 2); while (Display.getDefault().readAndDispatch()) { } assertFalse("cancelled old render closed the live browser", browser.isDisposed());
        replies.get(0).complete(Json.object("html", renderedFixture(requests.get(0), "stale")));
        replies.get(1).complete(Json.object("html", renderedFixture(requests.get(1), "fresh"))); pump(opened.binding()::isReady);
        assertEquals("fresh", browser.evaluate("return document.getElementById('rendered').textContent;"));
        assertEquals(1, ((Number) browser.evaluate("return document.querySelectorAll('script[src]').length;")).intValue());
        browser.execute("document.querySelector('[data-link]').click();");
        pump(() -> { try { return Files.readString(receipts).contains("\"type\": \"openLink\", \"index\": 7"); } catch (IOException ex) { throw new java.io.UncheckedIOException(ex); } });
        browser.execute("location.reload();"); pump(() -> requests.size() == 3); assertFalse(opened.binding().isReady()); replies.get(2).complete(Json.object("html", renderedFixture(requests.get(2), "reloaded"))); pump(opened.binding()::isReady); assertEquals("reloaded", browser.evaluate("return document.getElementById('rendered').textContent;"));
        reload.invoke(opened); pump(() -> requests.size() == 4); java.lang.reflect.Field pageField = MuseView.class.getDeclaredField("page"); pageField.setAccessible(true); Path page = (Path) pageField.get(opened);
        session.window.getActivePage().hideView(opened); replies.get(3).complete(Json.object("html", renderedFixture(requests.get(3), "late"))); while (Display.getDefault().readAndDispatch()) { } assertFalse("late render recreated a disposed page", Files.exists(page));
    }
    private static String renderedFixture(JsonObject params, String text) {
        String script = params.get("scriptUri").getAsString().replace("&", "&amp;").replace("'", "&#39;");
        return "<!DOCTYPE html><html><head></head><body><p id=\"rendered\">" + text + "</p><a href=\"https://example.com\" data-link=\"7\">link</a><script nonce=\"" + params.get("nonce").getAsString() + "\" src=\"" + script + "\"></script></body></html>";
    }
    private static void pump(java.util.function.BooleanSupplier complete) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(100);
        boolean settled = complete.getAsBoolean();
        while (!settled && System.nanoTime() < deadline) { Display.getDefault().timerExec(100, () -> { }); if (!Display.getDefault().readAndDispatch()) Display.getDefault().sleep(); settled = complete.getAsBoolean(); }
        assertTrue("fake runtime operation did not settle", settled);
    }
}
