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
    private Map<?, ?> pluginSessions;
    @Before public void setup() throws Exception {
        Platform.getBundle("io.musespark.eclipse").start();
        fixture = Files.createTempFile("m104-runtime-", ".py");
        try (InputStream input = getClass().getResourceAsStream("/fixtures/runtime.py")) { assertNotNull(input); Files.write(fixture, input.readAllBytes()); }
        receipts = Files.createTempFile("m104-receipts-", ".ndjson");
        ProcessBuilder builder = new ProcessBuilder("python3", fixture.toString(), "--receipts", receipts.toString()); Map<String, String> clean = Assets.environment(builder.environment()); builder.environment().clear(); builder.environment().putAll(clean); runtime = builder.start();
        session = new WindowSession(PlatformUI.getWorkbench().getActiveWorkbenchWindow(), runtime);
        java.lang.reflect.Field owned = MusePlugin.class.getDeclaredField("sessions"); owned.setAccessible(true);
        if (!(owned.get(MusePlugin.get()) instanceof Map<?, ?> registered)) throw new AssertionError("plugin session registry unavailable");
        pluginSessions = registered;
        // The Window-menu must adopt this fake; it must never launch a real agent.
        registered.getClass().getMethod("put", Object.class, Object.class).invoke(registered, session.window, session);
        CountDownLatch initialized = new CountDownLatch(1); session.afterInitialize(initialized::countDown); pump(() -> initialized.getCount() == 0);
        project = ResourcesPlugin.getWorkspace().getRoot().getProject("m104-session-" + UUID.randomUUID()); project.create(null); project.open(null);
        IFile file = project.getFile("example.txt"); file.create(new ByteArrayInputStream("user".getBytes(StandardCharsets.UTF_8)), true, null); editor = session.documents.open(file.getLocationURI().toString());
    }
    @After public void cleanup() throws Exception {
        if (pluginSessions != null && session != null) pluginSessions.values().removeIf(value -> value == session);
        if (session != null) session.close();
        for (IViewReference reference : PlatformUI.getWorkbench().getActiveWorkbenchWindow().getActivePage().getViewReferences())
            if (reference.getView(false) instanceof MuseView view) view.getSite().getPage().hideView(view);
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
    private ProcessHandle startRuntimeWithChild() throws Exception {
        session.close();
        String wrapper = "import subprocess,sys,runpy; child=subprocess.Popen([sys.executable,'-c',\"import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); print('ready',flush=True); time.sleep(100)\"],stdout=subprocess.PIPE); child.stdout.readline(); runpy.run_path(sys.argv[1],run_name='__main__')";
        ProcessBuilder builder = new ProcessBuilder("python3", "-c", wrapper, fixture.toString()); Map<String, String> clean = Assets.environment(builder.environment()); builder.environment().clear(); builder.environment().putAll(clean); runtime = builder.start();
        session = new WindowSession(PlatformUI.getWorkbench().getActiveWorkbenchWindow(), runtime); CountDownLatch ready = new CountDownLatch(1); session.afterInitialize(ready::countDown); pump(() -> ready.getCount() == 0);
        List<ProcessHandle> children = runtime.descendants().toList(); assertEquals("fixture must have started exactly one descendant", 1, children.size());
        ProcessHandle child = children.get(0); assertTrue("descendant must be running before cleanup", running(child)); return child;
    }
    private static boolean running(ProcessHandle child) {
        if (!child.isAlive()) return false;
        if (!System.getProperty("os.name").equals("Linux")) return child.isAlive();
        Path stat = Path.of("/proc", Long.toString(child.pid()), "stat");
        try {
            String status = Files.readString(stat);
            return !status.substring(status.lastIndexOf(')') + 1).trim().startsWith("Z ");
        } catch (NoSuchFileException ex) { return false; }
        catch (IOException ex) { throw new AssertionError("cannot observe descendant state", ex); }
    }
    @Test public void descendantObservationTreatsAVanishedProcEntryAsExited() {
        ProcessHandle vanished = (ProcessHandle) java.lang.reflect.Proxy.newProxyInstance(ProcessHandle.class.getClassLoader(), new Class<?>[] {ProcessHandle.class}, (proxy, method, arguments) -> switch (method.getName()) {
            case "isAlive" -> true;
            case "pid" -> Long.MAX_VALUE;
            default -> throw new AssertionError("unexpected process observation");
        });
        assertEquals("a stale isAlive observation cannot revive a reaped process", !System.getProperty("os.name").equals("Linux"), running(vanished));
    }
    private static void awaitExit(ProcessHandle child) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        boolean alive = running(child);
        while (alive && System.nanoTime() < deadline) { Thread.sleep(20); alive = running(child); }
        assertFalse("started descendant survived cleanup: " + child.pid(), alive);
    }
    @Test public void closeKillsCapturedDescendantsAfterTheParentExits() throws Exception {
        ProcessHandle child = startRuntimeWithChild();
        try { session.close(); assertFalse("parent survived cleanup", runtime.isAlive()); awaitExit(child); }
        finally { child.destroyForcibly(); }
    }
    @Test public void rootKilledBeforeCloseStillKillsItsReparentedChild() throws Exception {
        ProcessHandle child = startRuntimeWithChild();
        try {
            runtime.toHandle().destroyForcibly(); assertTrue(runtime.waitFor(2, TimeUnit.SECONDS));
            assertEquals("dead roots have no discoverable descendants", 0, runtime.descendants().count());
            session.close(); awaitExit(child);
        } finally { child.destroyForcibly(); }
    }
    @Test public void cleanupFailureStillKillsRuntimeTreeAndContinuesOtherSteps() throws Exception {
        ProcessHandle child = startRuntimeWithChild();
        java.util.concurrent.atomic.AtomicInteger attempts = new java.util.concurrent.atomic.AtomicInteger();
        java.lang.reflect.Field uiField = WindowSession.class.getDeclaredField("ui"); uiField.setAccessible(true);
        NativeUi original = session.ui;
        uiField.set(session, new NativeUi(session) { @Override public void close() { attempts.incrementAndGet(); throw new IllegalStateException("fixture cleanup failure"); } });
        List<String> logged = new CopyOnWriteArrayList<>(); org.eclipse.core.runtime.ILogListener listener = (status, plugin) -> logged.add(status.getMessage());
        MusePlugin.get().getLog().addLogListener(listener);
        try {
            Throwable failure = null; try { session.close(); } catch (Throwable ex) { failure = ex; }
            assertFalse("early cleanup failure must not keep the parent alive", runtime.isAlive()); awaitExit(child);
            assertNull("close isolates the injected cleanup exception", failure);
            assertTrue("cleanup failure must be logged", logged.contains("MHP_UI_CLEANUP_FAILURE"));
            assertEquals("MHP_CLOSED", assertThrows(IllegalStateException.class, () -> session.peer.send(Json.object("fixture", "closed"))).getMessage());
            session.close(); assertEquals("close is idempotent", 1, attempts.get());
        } finally { MusePlugin.get().getLog().removeLogListener(listener); uiField.set(session, original); original.close(); child.destroyForcibly(); }
    }
    @Test public void nonUiCloseDisposesLiveViewsAfterThePluginStops() throws Exception {
        session.uiRequest("surfaces/open", Json.object("kind", "chat", "placement", "side", "sessionId", "closing-owned"));
        MuseView view = views().get(0); pump(view.binding()::isReady);
        java.lang.reflect.Field browserField = MuseView.class.getDeclaredField("browser"); browserField.setAccessible(true);
        org.eclipse.swt.browser.Browser browser = (org.eclipse.swt.browser.Browser) browserField.get(view);
        java.util.concurrent.atomic.AtomicReference<Throwable> failure = new java.util.concurrent.atomic.AtomicReference<>();
        Thread closer = new Thread(() -> { try { session.close(); } catch (Throwable ex) { failure.set(ex); } });
        closer.start(); closer.join(TimeUnit.SECONDS.toMillis(5)); assertFalse("non-UI close must finish without the display", closer.isAlive());
        assertNull(failure.get()); assertFalse(runtime.isAlive());
        MusePlugin plugin = MusePlugin.get(); java.lang.reflect.Field singleton = MusePlugin.class.getDeclaredField("instance"); singleton.setAccessible(true);
        List<String> logged = new CopyOnWriteArrayList<>(); org.eclipse.core.runtime.ILogListener listener = (status, source) -> logged.add(status.getMessage()); plugin.getLog().addLogListener(listener);
        try {
            singleton.set(null, null);
            java.lang.reflect.Method reload = MuseView.class.getDeclaredMethod("loadPage"); reload.setAccessible(true); reload.invoke(view);
            pump(() -> views().isEmpty());
            assertTrue("deferred native cleanup must dispose the browser", browser.isDisposed());
            assertFalse(view.binding().isReady());
            assertTrue("transport cleanup failure must use the retained logger", logged.contains("MHP_SURFACE_FAILURE"));
            assertFalse("view cleanup must finish after plugin stop", logged.contains("MHP_SURFACE_CLEANUP_FAILURE"));
        } finally { singleton.set(null, plugin); plugin.getLog().removeLogListener(listener); }
    }
    @Test public void pluginStopAdmissionRefusesSessionAcquisition() throws Exception {
        MusePlugin plugin = MusePlugin.get(); java.lang.reflect.Field stopping = MusePlugin.class.getDeclaredField("stopping"); stopping.setAccessible(true);
        synchronized (plugin) {
            stopping.setBoolean(plugin, true);
            try { assertEquals("MHP_CLOSED", assertThrows(IllegalStateException.class, () -> plugin.session(session.window)).getMessage()); }
            finally { stopping.setBoolean(plugin, false); }
        }
    }
    @Test public void nonUiNativeRequestsAreRefusedBeforeTouchingState() throws Exception {
        java.util.concurrent.atomic.AtomicReference<Throwable> failure = new java.util.concurrent.atomic.AtomicReference<>();
        Thread caller = new Thread(() -> { try { session.uiRequest("workspace/trust", new JsonObject()); } catch (Throwable ex) { failure.set(ex); } });
        caller.start(); caller.join(TimeUnit.SECONDS.toMillis(2)); assertFalse(caller.isAlive());
        assertNotNull("native requests must be confined to their display", failure.get());
        assertEquals("MHP_UI_THREAD_REQUIRED", failure.get().getMessage());
    }
    @Test public void nonUiCloseDuringSettledMutationLeavesCleanupOnTheDisplay() throws Exception {
        CountDownLatch mutating = new CountDownLatch(1), returned = new CountDownLatch(1);
        java.util.concurrent.atomic.AtomicReference<Throwable> failure = new java.util.concurrent.atomic.AtomicReference<>();
        Thread displayThread = Thread.currentThread();
        Map<String, Object> owned = new HashMap<>() {
            private void owner() { assertSame("analysis state belongs to the display", displayThread, Thread.currentThread()); }
            @Override public Object put(String key, Object value) {
                owner(); Object result = super.put(key, value); mutating.countDown();
                try { assertTrue("non-UI close must not wait for the display", returned.await(5, TimeUnit.SECONDS)); }
                catch (InterruptedException ex) { throw new AssertionError(ex); }
                return result;
            }
            @Override public Collection<Object> values() { owner(); return super.values(); }
            @Override public void clear() { owner(); super.clear(); }
        };
        java.lang.reflect.Field analysesField = WindowSession.class.getDeclaredField("analyses"); analysesField.setAccessible(true); analysesField.set(session, owned);
        Thread closer = new Thread(() -> {
            try { assertTrue(mutating.await(5, TimeUnit.SECONDS)); session.close(); session.close(); }
            catch (Throwable ex) { failure.set(ex); }
            finally { returned.countDown(); }
        }, "fixture-osgi-stop");
        closer.start();
        try {
            String uri = session.documents.uri(editor);
            JsonElement version = session.documents.descriptor(editor).get("version");
            assertTrue(session.uiRequest("diagnostics/settled", Json.object("uri", uri, "expectedVersion", version)).isJsonNull());
            closer.join(TimeUnit.SECONDS.toMillis(2)); assertFalse("close thread did not finish", closer.isAlive());
            assertNull("non-UI close touched display-owned state", failure.get()); assertFalse(runtime.isAlive());
            pump(owned::isEmpty);
            assertEquals("MHP_CLOSED", assertThrows(IllegalArgumentException.class, () -> session.uiRequest("diagnostics/settled", Json.object("uri", uri, "expectedVersion", version))).getMessage());
        } finally { returned.countDown(); closer.join(TimeUnit.SECONDS.toMillis(2)); }
    }
    @Test public void admittedBrowserMessagesWaitForReloadAndRemainCounted() throws Exception {
        MuseView view = new MuseView();
        PanelSurface binding = new PanelSurface(session.contract, "reload-test", "session", "chat", session.peer::send, session.peer::purge, code -> { });
        java.lang.reflect.Field field = MuseView.class.getDeclaredField("binding"); field.setAccessible(true); field.set(view, binding);
        binding.opened(); binding.ready(); session.add(view);
        session.panel(Json.object("mhp", "1.5", "kind", "panel", "surface", binding.id, "direction", "toPanel", "seq", 1, "payload", Json.object("type", "conversationCleared")));
        binding.reload(); while (Display.getDefault().readAndDispatch()) { }
        assertEquals("reload must retain admitted messages and their byte reservations", 1, session.dropBrowser(binding.id));
        binding.ready(); session.panel(Json.object("mhp", "1.5", "kind", "panel", "surface", binding.id, "direction", "toPanel", "seq", 2, "payload", Json.object("type", "conversationCleared")));
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
            session.panel(Json.object("mhp", "1.5", "kind", "panel", "surface", binding.id, "direction", "toPanel", "seq", 1, "payload", Json.object("type", "conversationCleared")));
            binding.reload(); while (Display.getDefault().readAndDispatch()) { } assertNull(browser.evaluate("return window.received;"));
            binding.ready(); session.browserReady(); pump(() -> "conversationCleared".equals(browser.evaluate("return window.received && window.received.type;"))); assertEquals(0, session.dropBrowser(binding.id));
            browser.dispose(); session.panel(Json.object("mhp", "1.5", "kind", "panel", "surface", binding.id, "direction", "toPanel", "seq", 2, "payload", Json.object("type", "conversationCleared")));
            pump(() -> { try { return Files.readString(receipts).contains("\"seq\": 2, \"code\": \"MHP_PANEL_NOT_READY\""); } catch (IOException ex) { throw new java.io.UncheckedIOException(ex); } });
            assertTrue(Files.readString(receipts), Files.readString(receipts).lines().map(Json::parse).map(JsonElement::getAsJsonObject).anyMatch(frame -> frame.has("code") && frame.get("code").getAsString().equals("MHP_PANEL_NOT_READY") && frame.get("seq").getAsInt() == 2));
            binding.close(0); session.remove(view);
        } finally { if (!browser.isDisposed()) browser.dispose(); shell.dispose(); }
    }
    @Test public void aFullBrowserQueueCanStillReportFailedDelivery() throws Exception {
        MuseView view = new MuseView(); PanelSurface binding = new PanelSurface(session.contract, "full-queue-test", "session", "chat", session.peer::send, session.peer::purge, code -> { });
        java.lang.reflect.Field field = MuseView.class.getDeclaredField("binding"); field.setAccessible(true); field.set(view, binding); binding.opened(); binding.ready(); session.add(view); session.peer.drain();
        for (int seq = 1; seq <= session.contract.queueMessages; seq++) session.panel(Json.object("mhp", "1.5", "kind", "panel", "surface", binding.id, "direction", "toPanel", "seq", seq, "payload", Json.object("type", "conversationCleared")));
        pump(() -> { try { return Files.readString(receipts).contains("\"seq\": " + session.contract.queueMessages + ", \"code\": \"MHP_PANEL_NOT_READY\""); } catch (IOException ex) { throw new java.io.UncheckedIOException(ex); } });
        assertFalse(session.isClosed()); assertEquals(0, session.dropBrowser(binding.id)); binding.close(0); session.remove(view);
    }
    @Test public void nativeHtmlRenderRejectsStaleRepliesAndRoutesWhatsNewClicks() throws Exception {
        session.close(); List<JsonObject> requests = new ArrayList<>(); List<CompletableFuture<JsonObject>> replies = new ArrayList<>();
        Assets.HtmlPort port = new Assets.HtmlPort() {
            @Override public boolean supports(String protocol, String capability) { return protocol.equals("mhp/1.5.0") && capability.equals("surfaceHtml"); }
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
    @Test public void settledDiagnosticsAttestTheCheckedDocumentVersion() throws Exception {
        IFile file = project.getFile("example.txt");
        IMarker marker = file.createMarker(IMarker.PROBLEM); marker.setAttribute(IMarker.LINE_NUMBER, 1); marker.setAttribute(IMarker.SEVERITY, IMarker.SEVERITY_ERROR); marker.setAttribute(IMarker.MESSAGE, "fake settled diagnostic");
        try {
            String uri = file.getLocationURI().toString();
            JsonElement version = session.documents.descriptor(editor).get("version");
            java.util.concurrent.atomic.AtomicReference<JsonElement> report = new java.util.concurrent.atomic.AtomicReference<>();
            pump(() -> { try { report.set(session.uiRequest("diagnostics/settled", Json.object("uri", uri, "expectedVersion", version))); return !report.get().isJsonNull(); } catch (Exception ex) { throw new AssertionError(ex); } });
            JsonObject settled = report.get().getAsJsonObject();
            assertEquals(version, settled.get("version"));
            assertEquals(uri, settled.get("uri").getAsString());
            assertEquals(1, settled.getAsJsonArray("diagnostics").size());
            assertEquals("error", settled.getAsJsonArray("diagnostics").get(0).getAsJsonObject().get("severity").getAsString());
            assertTrue(session.uiRequest("diagnostics/settled", Json.object("uri", uri, "expectedVersion", version.getAsLong() + 1)).isJsonNull());
        } finally { marker.delete(); }
    }
    @Test public void settledDiagnosticsWaitForAnalysisAfterASavedEdit() throws Exception {
        IFile file = project.getFile("example.txt");
        session.documents.document(editor).set("new error"); editor.doSave(new org.eclipse.core.runtime.NullProgressMonitor());
        long version = session.documents.descriptor(editor).get("version").getAsLong();
        CountDownLatch analysing = new CountDownLatch(1), finish = new CountDownLatch(1);
        org.eclipse.core.runtime.jobs.Job builder = new org.eclipse.core.runtime.jobs.Job("pending fixture analysis") {
            @Override public boolean belongsTo(Object family) { return family == ResourcesPlugin.FAMILY_AUTO_BUILD; }
            @Override protected org.eclipse.core.runtime.IStatus run(org.eclipse.core.runtime.IProgressMonitor monitor) {
                analysing.countDown();
                try {
                    assertTrue(finish.await(5, TimeUnit.SECONDS));
                    IMarker marker = file.createMarker(IMarker.PROBLEM); marker.setAttribute(IMarker.LINE_NUMBER, 1);
                    marker.setAttribute(IMarker.SEVERITY, IMarker.SEVERITY_ERROR); marker.setAttribute(IMarker.MESSAGE, "new version error");
                    return org.eclipse.core.runtime.Status.OK_STATUS;
                } catch (Exception ex) { return org.eclipse.core.runtime.Status.error("fixture analysis failed", ex); }
            }
        };
        builder.schedule(); assertTrue(analysing.await(2, TimeUnit.SECONDS));
        try {
            JsonObject params = Json.object("uri", file.getLocationURI().toString(), "expectedVersion", version);
            assertTrue("cached clean markers are not settled for the edit", session.uiRequest("diagnostics/settled", params).isJsonNull());
            finish.countDown();
            java.util.concurrent.atomic.AtomicReference<JsonElement> report = new java.util.concurrent.atomic.AtomicReference<>();
            pump(() -> { try { report.set(session.uiRequest("diagnostics/settled", params)); return !report.get().isJsonNull(); } catch (Exception ex) { throw new AssertionError(ex); } });
            assertEquals(version, report.get().getAsJsonObject().get("version").getAsLong());
            assertTrue(report.get().toString(), report.get().toString().contains("new version error"));
        } finally { finish.countDown(); builder.join(); }
    }
    @Test public void userMenuOpenReplacesAnUnboundRestoredViewWithTheOwnedSession() throws Exception {
        IWorkbenchPage page = session.window.getActivePage();
        MuseView placeholder = (MuseView) page.showView("io.musespark.panel"); assertNull(placeholder.binding());
        String owned = "restored-owned-session";
        session.uiRequest("surfaces/open", Json.object("kind", "chat", "placement", "side", "sessionId", owned));
        for (MuseView view : views()) if (view.binding() != null) page.hideView(view);
        assertEquals(List.of(placeholder), views());
        OpenHandler.openPanel(session.window);
        assertTrue("Open must replace the unbound placeholder", views().stream().anyMatch(view -> view.binding() != null));
        assertEquals(1, views().size()); assertEquals(owned, views().get(0).binding().session);
    }
    @Test public void userMenuScansPlaceholdersBeforeAndAfterTheOwnedView() throws Exception {
        IWorkbenchPage actual = session.window.getActivePage();
        MuseView placeholder = (MuseView) actual.showView("io.musespark.panel");
        session.uiRequest("surfaces/open", Json.object("kind", "chat", "placement", "side", "sessionId", "mixed-owned"));
        MuseView owned = views().stream().filter(view -> view.binding() != null).findFirst().orElseThrow();
        IViewReference ownedReference = actual.findViewReference("io.musespark.panel", owned.getViewSite().getSecondaryId());
        IViewReference unboundReference = actual.findViewReference("io.musespark.panel");
        for (IViewReference[] order : List.of(new IViewReference[] {ownedReference, unboundReference}, new IViewReference[] {unboundReference, ownedReference})) {
            List<IViewReference> hidden = new ArrayList<>(); List<Object> activated = new ArrayList<>();
            IWorkbenchWindow decorated = menuWindow(order, hidden, activated);
            OpenHandler.openPanel(decorated);
            assertEquals("scan must remove the placeholder regardless of order", List.of(unboundReference), hidden);
            assertEquals(List.of(owned), activated);
        }
        assertNull(placeholder.binding());
    }
    @Test public void userMenuReplacesANotYetCreatedPlaceholderWithoutCreatingIt() throws Exception {
        IWorkbenchPage actual = session.window.getActivePage();
        session.uiRequest("surfaces/open", Json.object("kind", "chat", "placement", "side", "sessionId", "lazy-owned"));
        MuseView owned = views().get(0);
        IViewReference ownedReference = actual.findViewReference("io.musespark.panel", owned.getViewSite().getSecondaryId());
        IViewReference lazy = (IViewReference) java.lang.reflect.Proxy.newProxyInstance(IViewReference.class.getClassLoader(), new Class<?>[] {IViewReference.class}, (proxy, method, arguments) -> {
            if (method.getName().equals("getId")) return "io.musespark.panel";
            if (method.getName().equals("getView")) { assertEquals("Open must not instantiate the placeholder", false, arguments[0]); return null; }
            throw new AssertionError("unexpected lazy reference call: " + method.getName());
        });
        List<IViewReference> hidden = new ArrayList<>(); List<Object> activated = new ArrayList<>();
        OpenHandler.openPanel(menuWindow(new IViewReference[] {lazy, ownedReference}, hidden, activated));
        assertEquals(List.of(lazy), hidden); assertEquals(List.of(owned), activated);
    }
    private IWorkbenchWindow menuWindow(IViewReference[] references, List<IViewReference> hidden, List<Object> activated) throws Exception {
        IWorkbenchWindow actual = session.window; IWorkbenchPage page = actual.getActivePage();
        IWorkbenchPage decoratedPage = (IWorkbenchPage) java.lang.reflect.Proxy.newProxyInstance(IWorkbenchPage.class.getClassLoader(), new Class<?>[] {IWorkbenchPage.class}, (proxy, method, arguments) -> {
            if (method.getName().equals("getViewReferences")) return references;
            if (method.getName().equals("hideView")) { assertTrue("hide the reference without creating it", arguments[0] instanceof IViewReference); hidden.add((IViewReference) arguments[0]); return null; }
            if (method.getName().equals("activate")) { activated.add(arguments[0]); return null; }
            return method.invoke(page, arguments);
        });
        IWorkbenchWindow decorated = (IWorkbenchWindow) java.lang.reflect.Proxy.newProxyInstance(IWorkbenchWindow.class.getClassLoader(), new Class<?>[] {IWorkbenchWindow.class}, (proxy, method, arguments) -> {
            if (method.getName().equals("getActivePage")) return decoratedPage;
            if (method.getName().equals("hashCode")) return System.identityHashCode(proxy);
            if (method.getName().equals("equals")) return proxy == arguments[0];
            return method.invoke(actual, arguments);
        });
        pluginSessions.getClass().getMethod("put", Object.class, Object.class).invoke(pluginSessions, decorated, session);
        return decorated;
    }
    @Test public void runtimeCommandRunNotifiesItsRegisteredExecution() throws Exception {
        session.uiRequest("commands/register", Json.object("id", "fixture-run", "title", "Fixture run command"));
        session.uiRequest("commands/run", Json.object("id", "fixture-run", "args", new JsonArray()));
        pump(() -> { try { return Files.readString(receipts).contains("\"method\": \"commands/execute\"") && Files.readString(receipts).contains("\"id\": \"fixture-run\""); } catch (IOException ex) { throw new java.io.UncheckedIOException(ex); } });
        assertEquals("MHP_CAPABILITY_UNAVAILABLE", assertThrows(IllegalArgumentException.class, () -> session.uiRequest("commands/run", Json.object("id", "missing", "args", new JsonArray()))).getMessage());
    }
    @Test public void userMenuOpenAdoptsTheOwnedSessionInsteadOfPublishingAnUnownedOne() throws Exception {
        OpenHandler.openPanel(session.window);
        assertTrue("menu open before startup must not publish an unowned view", views().isEmpty());
        String owned = "owned-chat-session";
        session.uiRequest("surfaces/open", Json.object("kind", "chat", "placement", "side", "sessionId", owned));
        assertEquals(1, views().size());
        OpenHandler.openPanel(session.window);
        assertEquals("menu open must activate the owned view instead of publishing another session", 1, views().size());
        assertEquals(owned, views().get(0).binding().session);
        session.window.getActivePage().hideView(views().get(0));
        long hidden = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (!views().isEmpty() && System.nanoTime() < hidden) { while (Display.getDefault().readAndDispatch()) { } Thread.sleep(20); }
        assertTrue("closed view must be removed before reopening", views().isEmpty());
        OpenHandler.openPanel(session.window);
        pump(() -> !views().isEmpty());
        assertEquals(1, views().size());
        assertEquals(owned, views().get(0).binding().session);
        for (String line : Files.readAllLines(receipts)) if (line.contains("\"event\": \"opened\"")) assertTrue(line, line.contains(owned));
    }
    private List<MuseView> views() {
        List<MuseView> found = new ArrayList<>();
        for (IViewReference reference : session.window.getActivePage().getViewReferences()) if (reference.getView(false) instanceof MuseView view) found.add(view);
        return found;
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
