package io.musespark.eclipse;

import com.google.gson.*;
import java.io.*;
import java.nio.file.*;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import org.eclipse.core.resources.*;
import org.eclipse.core.runtime.*;
import org.eclipse.swt.SWT;
import org.eclipse.swt.graphics.RGB;
import org.eclipse.swt.widgets.Display;
import org.eclipse.ui.*;
import org.eclipse.ui.texteditor.ITextEditor;

/** One runtime per workbench window. Omitted groups select the frozen shared fallbacks. */
public final class WindowSession implements MhpPeer.Host, AutoCloseable {
    public static final List<String> CAPABILITIES = List.of("lifecycle", "workspace", "documents", "editor", "diagnostics", "window", "tab", "surfaces", "ui", "commands");
    public final Contract contract = new Contract();
    public final Documents documents;
    public final MhpPeer peer;
    public final IWorkbenchWindow window;
    public final Assets.HtmlPort htmlPort;
    public final NativeUi ui;
    private record Command(org.eclipse.core.commands.Command command, org.eclipse.ui.handlers.IHandlerActivation activation) { }
    // The display thread owns commands, analyses, chatSession, trusted and all
    // native UI/document state. close() from OSGi never touches that state.
    private final Display display;
    private final java.util.function.Consumer<String> log;
    // One lock owns cross-thread close admission, surfaces and browserQueue.
    // disposed is volatile only for read-only cancellation checks by jobs/peers.
    private final Object stateLock = new Object();
    private final Map<String, Command> commands = new HashMap<>();
    private final String commandPrefix = "io.musespark.runtime." + UUID.randomUUID() + ".";
    private final Process process;
    private final RuntimeProcess runtime;
    private final Map<String, MuseView> surfaces = new HashMap<>();
    private record Analysis(long version, long stamp, org.eclipse.core.runtime.jobs.Job job, CompletableFuture<JsonArray> report) { }
    private final Map<String, Analysis> analyses = new HashMap<>();
    private record Delivery(MuseView view, JsonElement payload, JsonElement sequence, int bytes) { }
    private final ArrayDeque<Delivery> browserQueue = new ArrayDeque<>();
    private boolean browserScheduled;
    private final ISelectionListener selections;
    private final IResourceChangeListener problems;
    private final IPartListener2 parts;
    private final IWindowListener windows;
    private final ExecutorService stderr = Executors.newSingleThreadExecutor();
    private String chatSession;
    private boolean trusted;
    private volatile boolean disposed;
    private final CompletableFuture<JsonElement> initialization;
    private static Process launch() throws Exception {
        // nosemgrep: java.lang.security.audit.command-injection-process-builder.command-injection-process-builder -- panelCommand resolves the person's own configured runtime to a canonical absolute executable (real path, regular, executable, pinned file name and package identity) and returns a fixed argument list; no shell interprets it (PLAN.md §8).
        ProcessBuilder builder = new ProcessBuilder(RuntimeProcess.panelCommand(System.getenv("MUSE_SPARK_RUNTIME"), System.getenv("PATH")));
        Map<String, String> clean = Assets.environment(builder.environment()); builder.environment().clear(); builder.environment().putAll(clean);
        builder.directory(ResourcesPlugin.getWorkspace().getRoot().getLocation().toFile());
        return builder.start();
    }
    public WindowSession(IWorkbenchWindow window) throws Exception { this(window, launch()); }
    public WindowSession(IWorkbenchWindow window, Process runtime) throws Exception { this(window, runtime, null); }
    public WindowSession(IWorkbenchWindow window, Process runtime, Assets.HtmlPort htmlPort) throws Exception {
        this.window = window; this.htmlPort = htmlPort;
        display = window.getShell().getDisplay(); log = MusePlugin.get()::log;
        requireDisplay();
        ui = new NativeUi(this);
        process = runtime;
        this.runtime = new RuntimeProcess(process, log);
        documents = new Documents(window, params -> notify("documents/didChange", params), contract.selectionCap);
        peer = new MhpPeer(contract, process.getInputStream(), process.getOutputStream(), this, log);
        initialization = peer.initialized();
        initialization.orTimeout(100, TimeUnit.SECONDS).whenComplete((result, error) -> { if (error != null) shutdown(); });
        stderr.submit(() -> {
            try (InputStream input = process.getErrorStream()) { byte[] buffer = new byte[contract.chunkBytes]; while (input.read(buffer) != -1) { /* Drain without interpreting provider/account text. */ } }
            catch (IOException ex) { if (!disposed) log.accept("MHP_STDERR_FAILURE"); }
        });
        trusted = MusePlugin.get().getPreferenceStore().getBoolean("trusted:" + ResourcesPlugin.getWorkspace().getRoot().getLocationURI());
        selections = (part, selection) -> { if (part instanceof org.eclipse.ui.texteditor.ITextEditor) try { notify("editor/didChangeSelection", Json.object("selection", documents.selection())); } catch (Exception ex) { log.accept("MHP_SELECTION_FAILURE"); } };
        window.getSelectionService().addPostSelectionListener(selections);
        problems = event -> display.asyncExec(() -> {
            if (disposed) return;
            try { for (JsonElement item : documents.list()) { String uri = item.getAsJsonObject().get("uri").getAsString();
                IFile file = ResourcesPlugin.getWorkspace().getRoot().getFileForLocation(new org.eclipse.core.runtime.Path(Path.of(java.net.URI.create(uri)).toString()));
                IResourceDelta delta = file == null || event.getDelta() == null ? null : event.getDelta().findMember(file.getFullPath());
                if (delta != null && (delta.getFlags() & IResourceDelta.CONTENT) != 0 && !item.getAsJsonObject().get("dirty").getAsBoolean()) notify("documents/didSave", item.getAsJsonObject());
                notify("diagnostics/didChange", Json.object("uri", uri, "diagnostics", diagnostics(uri))); } }
            catch (Exception ex) { log.accept("MHP_DIAGNOSTICS_FAILURE"); }
        });
        ResourcesPlugin.getWorkspace().addResourceChangeListener(problems, IResourceChangeEvent.POST_CHANGE);
        parts = new IPartListener2() {
            @Override public void partOpened(IWorkbenchPartReference reference) { if (reference.getPart(false) instanceof org.eclipse.ui.texteditor.ITextEditor editor) documents.document(editor); }
            @Override public void partClosed(IWorkbenchPartReference reference) { if (reference.getPart(false) instanceof org.eclipse.ui.texteditor.ITextEditor editor) {
                String uri = documents.uri(editor); Analysis analysis = analyses.remove(uri); if (analysis != null) analysis.job.cancel();
                WindowSession.this.notify("documents/didClose", Json.object("uri", uri)); documents.closed(editor);
            } }
            @Override public void partActivated(IWorkbenchPartReference reference) { }
            @Override public void partBroughtToTop(IWorkbenchPartReference reference) { }
            @Override public void partDeactivated(IWorkbenchPartReference reference) { }
            @Override public void partHidden(IWorkbenchPartReference reference) { if (reference.getPart(false) instanceof MuseView view) view.hidden(); }
            @Override public void partVisible(IWorkbenchPartReference reference) { }
            @Override public void partInputChanged(IWorkbenchPartReference reference) { }
        };
        window.getPartService().addPartListener(parts);
        windows = new IWindowListener() {
            @Override public void windowClosed(IWorkbenchWindow closed) { if (closed == window) close(); }
            @Override public void windowActivated(IWorkbenchWindow activated) { }
            @Override public void windowDeactivated(IWorkbenchWindow deactivated) { }
            @Override public void windowOpened(IWorkbenchWindow opened) { }
        };
        PlatformUI.getWorkbench().addWindowListener(windows);
        documents.list();
        process.onExit().thenRun(() -> { if (!display.isDisposed()) display.asyncExec(() -> { if (!disposed) close(); }); });
        JsonObject metadata = hostContext();
        peer.start();
        try { peer.initialize(metadata); } catch (RuntimeException ex) { close(); throw ex; }
    }
    public void afterInitialize(Runnable action) { afterInitialize(action, () -> { }); }
    public void afterInitialize(Runnable action, Runnable failure) {
        initialization.whenComplete((result, error) -> { if (!display.isDisposed()) display.asyncExec(() -> {
            if (error != null) { log.accept("MHP_INITIALIZE_FAILURE"); failure.run(); }
            else if (!disposed) action.run();
        }); });
    }
    public void notify(String method, JsonObject params) {
        if (initialization == null || !initialization.isDone() || initialization.isCompletedExceptionally() || disposed) return;
        try { peer.notify(method, params); } catch (RuntimeException ex) { log.accept("MHP_NOTIFICATION_FAILURE"); }
    }
    public void grantTrust() {
        requireDisplay();
        trusted = true; MusePlugin.get().getPreferenceStore().setValue("trusted:" + ResourcesPlugin.getWorkspace().getRoot().getLocationURI(), true);
        notify("workspace/didGrantTrust", Json.object("trusted", true));
    }
    public void add(MuseView view) { synchronized (stateLock) { if (disposed) throw new IllegalStateException("MHP_CLOSED"); surfaces.put(view.binding().id, view); } }
    public void remove(MuseView view) { synchronized (stateLock) { surfaces.remove(view.binding().id); } }
    public boolean isClosed() { return disposed; }
    @Override public void shutdown() { close(); }
    @Override public void panel(JsonObject frame) {
        MuseView view;
        synchronized (stateLock) { if (disposed) return; view = surfaces.get(frame.get("surface").getAsString()); }
        try {
            if (view == null) throw new IllegalArgumentException("MHP_PANEL_UNKNOWN_SURFACE");
            view.binding().receive(frame, payload -> {
                int size = peer.reserveBrowser(frame);
                synchronized (stateLock) {
                    if (disposed) { peer.releaseBrowser(size); return; }
                    browserQueue.add(new Delivery(view, payload, frame.get("seq"), size));
                    if (!browserScheduled) { browserScheduled = true; display.asyncExec(this::drainBrowser); }
                }
            });
        } catch (RuntimeException ex) {
            String code = ex.getMessage(); if (code == null || !code.startsWith("MHP_PANEL_")) code = "MHP_PANEL_INVALID_PAYLOAD";
            JsonObject error = Json.object("mhp", "1.5", "kind", "panelError", "surface", frame.get("surface"), "seq", frame.get("seq"), "code", code);
            contract.panel("error", error); peer.send(error); log.accept(code);
        }
    }
    public void browserReady() {
        synchronized (stateLock) { if (!disposed && !browserQueue.isEmpty() && !browserScheduled) { browserScheduled = true; display.asyncExec(this::drainBrowser); } }
    }
    private void drainBrowser() {
        while (!disposed) {
            Delivery delivery;
            synchronized (stateLock) {
                delivery = null;
                Iterator<Delivery> iterator = browserQueue.iterator();
                while (iterator.hasNext()) { Delivery next = iterator.next(); if (next.view.binding().isReady()) { delivery = next; iterator.remove(); break; } }
                if (delivery == null) { browserScheduled = false; return; }
            }
            JsonObject error = null;
            try { delivery.view.deliverPayload(delivery.payload); } catch (RuntimeException ex) {
                error = Json.object("mhp", "1.5", "kind", "panelError", "surface", delivery.view.binding().id, "seq", delivery.sequence, "code", "MHP_PANEL_NOT_READY");
                contract.panel("error", error); log.accept("MHP_PANEL_NOT_READY");
            }
            finally { peer.releaseBrowser(delivery.bytes); }
            if (error != null) try { peer.send(error); } catch (RuntimeException ex) { peer.close(); }
        }
    }
    public int dropBrowser(String surface) {
        synchronized (stateLock) {
            int count = 0;
            Iterator<Delivery> iterator = browserQueue.iterator();
            while (iterator.hasNext()) { Delivery delivery = iterator.next(); if (delivery.view.binding().id.equals(surface)) { peer.releaseBrowser(delivery.bytes); iterator.remove(); count++; } }
            return count;
        }
    }
    @Override public JsonElement request(String method, JsonObject params, java.util.function.BooleanSupplier cancelled) throws Exception {
        if (disposed) throw new IOException("MHP_CLOSED");
        CompletableFuture<JsonElement> result = new CompletableFuture<>();
        display.asyncExec(() -> {
            if (result.isDone()) return;
            if (disposed) { result.completeExceptionally(new IOException("MHP_CLOSED")); return; }
            try { if (cancelled.getAsBoolean()) throw new IllegalArgumentException("MHP_CANCELLED"); result.complete(method.startsWith("ui/") ? ui.request(method, params, cancelled) : uiRequest(method, params)); } catch (Exception ex) { result.completeExceptionally(ex); }
        });
        try { return result.get(100, TimeUnit.SECONDS); }
        catch (InterruptedException ex) { result.cancel(false); Thread.currentThread().interrupt(); throw ex; }
        catch (TimeoutException ex) { result.cancel(false); throw ex; }
        catch (ExecutionException ex) { if (ex.getCause() instanceof Exception cause) throw cause; throw ex; }
    }
    public JsonElement uiRequest(String method, JsonObject params) throws Exception {
        requireDisplay();
        if (disposed) throw new IllegalArgumentException("MHP_CLOSED");
        if (method.startsWith("ui/")) return ui.request(method, params, () -> false);
        if (method.startsWith("documents/") || method.startsWith("editor/")) {
            JsonElement result = documents.request(method, params);

            return result;
        }
        return switch (method) {
            case "commands/register" -> {
                if (params.has("suggestedKey")) throw new IllegalArgumentException("MHP_CAPABILITY_UNAVAILABLE");
                String id = params.get("id").getAsString();
                if (!commands.containsKey(id) && commands.size() >= contract.queueMessages) throw new IllegalArgumentException("MHP_PANEL_BACKPRESSURE");
                org.eclipse.ui.commands.ICommandService service = window.getService(org.eclipse.ui.commands.ICommandService.class);
                org.eclipse.ui.handlers.IHandlerService handlers = window.getService(org.eclipse.ui.handlers.IHandlerService.class);
                Command previous = commands.remove(id); if (previous != null) { handlers.deactivateHandler(previous.activation); previous.command.undefine(); }
                org.eclipse.core.commands.Command command = service.getCommand(commandPrefix + id);
                command.define(params.get("title").getAsString(), "", service.getCategory("org.eclipse.ui.category.window"));
                var activation = handlers.activateHandler(command.getId(), new org.eclipse.core.commands.AbstractHandler() {
                    @Override public Object execute(org.eclipse.core.commands.ExecutionEvent event) { if (!disposed) WindowSession.this.notify("commands/execute", Json.object("id", id)); return null; }
                });
                commands.put(id, new Command(command, activation)); yield JsonNull.INSTANCE;
            }
            case "workspace/folders" -> folders();
            case "workspace/trust" -> Json.object("trusted", trusted);
            case "workspace/findFiles" -> findFiles(params);
            case "workspace/openFolder" -> {
                if (!trusted) throw new IllegalArgumentException("MHP_UNTRUSTED_WORKSPACE");
                Path location = Path.of(java.net.URI.create(params.get("uri").getAsString())).toRealPath();
                if (!Files.isDirectory(location)) throw new IllegalArgumentException("MHP_WORKSPACE_UNAVAILABLE");
                IProject project = null;
                for (IProject candidate : ResourcesPlugin.getWorkspace().getRoot().getProjects()) if (location.toUri().equals(candidate.getLocationURI())) project = candidate;
                if (project == null) {
                    IProjectDescription description;
                    if (Files.isRegularFile(location.resolve(".project"))) description = ResourcesPlugin.getWorkspace().loadProjectDescription(new org.eclipse.core.runtime.Path(location.resolve(".project").toString()));
                    else description = ResourcesPlugin.getWorkspace().newProjectDescription(location.getFileName().toString());
                    description.setLocationURI(location.toUri());
                    project = ResourcesPlugin.getWorkspace().getRoot().getProject(description.getName());
                    if (project.exists()) throw new IllegalArgumentException("MHP_WORKSPACE_NAME_CONFLICT");
                    project.create(description, null);
                }
                if (!project.isOpen()) project.open(null);
                if (params.get("newWindow").getAsBoolean()) PlatformUI.getWorkbench().openWorkbenchWindow(window.getActivePage().getPerspective().getId(), project);
                else window.getActivePage().showView("org.eclipse.ui.navigator.ProjectExplorer");
                yield JsonNull.INSTANCE;
            }
            case "diagnostics/get" -> diagnostics(params.has("uri") ? params.get("uri").getAsString() : null);
            case "diagnostics/settled" -> {
                String settledUri = params.get("uri").getAsString();
                long expectedVersion = params.get("expectedVersion").getAsLong();
                ITextEditor settledEditor = documents.editor(settledUri);
                if (settledEditor == null || settledEditor.isDirty() || version(settledEditor) != expectedVersion) yield JsonNull.INSTANCE;
                IFile file = ResourcesPlugin.getWorkspace().getRoot().getFileForLocation(new org.eclipse.core.runtime.Path(Path.of(java.net.URI.create(settledUri)).toString()));
                if (file == null || !file.exists()) throw new IllegalArgumentException("MHP_CAPABILITY_UNAVAILABLE");
                Analysis analysis = analyses.get(settledUri);
                if (analysis == null || analysis.version != expectedVersion || analysis.stamp != file.getModificationStamp()) {
                    if (analysis != null) analysis.job.cancel();
                    long stamp = file.getModificationStamp();
                    CompletableFuture<JsonArray> report = new CompletableFuture<>();
                    org.eclipse.core.runtime.jobs.Job build = new org.eclipse.core.runtime.jobs.Job("MHP_DIAGNOSTICS_BUILD") {
                        @Override protected IStatus run(IProgressMonitor monitor) {
                            try {
                                // Cached markers have no document-version attestation. Finish prior
                                // analysis, then explicitly build these saved bytes before reading them.
                                var jobs = org.eclipse.core.runtime.jobs.Job.getJobManager();
                                jobs.join(ResourcesPlugin.FAMILY_AUTO_BUILD, monitor);
                                jobs.join(ResourcesPlugin.FAMILY_MANUAL_BUILD, monitor);
                                if (monitor.isCanceled() || disposed) return Status.CANCEL_STATUS;
                                ResourcesPlugin.getWorkspace().build(IncrementalProjectBuilder.INCREMENTAL_BUILD, monitor);
                                if (monitor.isCanceled() || disposed) return Status.CANCEL_STATUS;
                                JsonArray checked = diagnostics(settledUri);
                                if (file.getModificationStamp() != stamp) report.completeExceptionally(new IllegalStateException("MHP_VERSION_CONFLICT"));
                                else report.complete(checked);
                                return Status.OK_STATUS;
                            } catch (Exception ex) { report.completeExceptionally(ex); return Status.CANCEL_STATUS; }
                        }
                    };
                    build.setSystem(true);
                    analyses.put(settledUri, new Analysis(expectedVersion, stamp, build, report));
                    build.schedule(); yield JsonNull.INSTANCE;
                }
                if (!analysis.report.isDone()) yield JsonNull.INSTANCE;
                if (analysis.report.isCompletedExceptionally()) throw new IllegalArgumentException("MHP_DIAGNOSTICS_UNAVAILABLE");
                JsonArray settled = analysis.report.join();
                if (settledEditor.isDirty() || version(settledEditor) != expectedVersion || file.getModificationStamp() != analysis.stamp) yield JsonNull.INSTANCE;
                yield Json.object("uri", settledUri, "version", params.get("expectedVersion"), "diagnostics", settled);
            }
            case "commands/run" -> {
                String id = params.get("id").getAsString();
                if (!commands.containsKey(id)) throw new IllegalArgumentException("MHP_CAPABILITY_UNAVAILABLE");
                notify("commands/execute", Json.object("id", id));
                yield JsonNull.INSTANCE;
            }
            case "surfaces/presentHtml" -> {
                MuseView view = surface(params);
                if (!view.binding().session.equals(params.get("sessionId").getAsString())) throw new IllegalArgumentException("MHP_PANEL_UNKNOWN_SURFACE");
                view.presentHtml(params.get("html").getAsString());
                yield JsonNull.INSTANCE;
            }
            case "surfaces/open" -> {
                if (!Set.of("chat", "tasks", "whatsNew").contains(params.get("kind").getAsString())) throw new IllegalArgumentException("MHP_CAPABILITY_UNAVAILABLE");
                if (params.get("kind").getAsString().equals("whatsNew") && !Assets.hasHtmlPort(htmlPort)) throw new IllegalArgumentException("MHP_CAPABILITY_UNAVAILABLE");
                String session = params.has("sessionId") ? params.get("sessionId").getAsString() : UUID.randomUUID().toString();
                if (params.has("sessionId") && params.get("kind").getAsString().equals("chat")) chatSession = session;
                String secondary = UUID.randomUUID().toString();
                MuseView.configure(secondary, session, params.get("kind").getAsString(), this);
                IWorkbenchWindow destination = params.get("placement").getAsString().equals("window") ? PlatformUI.getWorkbench().openWorkbenchWindow(window.getActivePage().getPerspective().getId(), ResourcesPlugin.getWorkspace().getRoot()) : window;
                IViewPart opened = destination.getActivePage().showView("io.musespark.panel", secondary, IWorkbenchPage.VIEW_ACTIVATE);
                if (!(opened instanceof MuseView view)) throw new IllegalStateException("MHP_VIEW_FAILURE");
                yield Json.object("surfaceId", view.binding().id);
            }
            case "surfaces/close" -> { MuseView view = surface(params); view.getSite().getPage().hideView(view); yield JsonNull.INSTANCE; }
            case "surfaces/focus" -> { MuseView view = surface(params); view.getSite().getPage().activate(view); yield JsonNull.INSTANCE; }
            case "surfaces/state" -> { MuseView view = surface(params); yield Json.object("visible", view.getSite().getPage().isPartVisible(view), "focused", view.getSite().getPage().getActivePart() == view); }
            case "window/state" -> Json.object("focused", window.getShell().isFocusControl() || window.getShell().getDisplay().getActiveShell() == window.getShell());
            case "window/attention" -> { window.getShell().forceActive(); yield JsonNull.INSTANCE; }
            case "tab/register" -> { Completion.install(this, params); yield JsonNull.INSTANCE; }
            default -> throw new IllegalArgumentException("MHP_CAPABILITY_UNAVAILABLE");
        };
    }
    public boolean hasCommand(String id) { requireDisplay(); return commands.containsKey(id); }
    public String chatSession() { requireDisplay(); return chatSession; }
    private MuseView surface(JsonObject params) { synchronized (stateLock) { MuseView view = surfaces.get(params.get("surfaceId").getAsString()); if (view == null) throw new IllegalArgumentException("MHP_PANEL_UNKNOWN_SURFACE"); return view; } }
    public static JsonArray folders() {
        JsonArray result = new JsonArray();
        IWorkspaceRoot root = ResourcesPlugin.getWorkspace().getRoot();
        result.add(Json.object("uri", root.getLocationURI().toString(), "name", root.getLocation().lastSegment()));
        for (IProject project : ResourcesPlugin.getWorkspace().getRoot().getProjects()) if (project.isOpen() && project.getLocationURI() != null) result.add(Json.object("uri", project.getLocationURI().toString(), "name", project.getName()));
        return result;
    }
    private JsonArray findFiles(JsonObject params) throws Exception {
        if (!trusted) throw new IllegalArgumentException("MHP_UNTRUSTED_WORKSPACE");
        PathMatcher include = FileSystems.getDefault().getPathMatcher("glob:" + params.get("include").getAsString().replace("**/", "{**/,}"));
        PathMatcher exclude = params.has("exclude") ? FileSystems.getDefault().getPathMatcher("glob:" + params.get("exclude").getAsString().replace("**/", "{**/,}")) : null;
        JsonArray result = new JsonArray(); int limit = params.get("limit").getAsInt();
        for (IProject project : ResourcesPlugin.getWorkspace().getRoot().getProjects()) if (project.isOpen()) project.accept(resource -> {
            if (result.size() >= limit) return false;
            if (resource instanceof IFile file && file.getLocationURI() != null && !file.isLinked()) { java.nio.file.Path path = Path.of(file.getProjectRelativePath().toString()); if (include.matches(path) && (exclude == null || !exclude.matches(path))) result.add(file.getLocationURI().toString()); }
            return !resource.isLinked();
        });
        return result;
    }
    private long version(ITextEditor editor) {
        try { return documents.descriptor(editor).get("version").getAsLong(); }
        catch (IllegalArgumentException ex) { return -1; }
    }
    public JsonArray diagnostics(String uri) throws Exception {
        JsonArray result = new JsonArray();
        for (IMarker marker : ResourcesPlugin.getWorkspace().getRoot().findMarkers(IMarker.PROBLEM, true, IResource.DEPTH_INFINITE)) {
            if (!(marker.getResource() instanceof IFile file) || file.getLocationURI() == null) continue;
            String location = file.getLocationURI().toString(); if (uri != null && !uri.equals(location)) continue;
            int line = Math.max(0, marker.getAttribute(IMarker.LINE_NUMBER, 1) - 1);
            JsonObject start = Json.object("line", line, "character", 0); JsonObject end = start.deepCopy();
            int severity = marker.getAttribute(IMarker.SEVERITY, IMarker.SEVERITY_INFO);
            result.add(Json.object("uri", location, "range", Json.object("start", start, "end", end), "severity", severity == IMarker.SEVERITY_ERROR ? "error" : severity == IMarker.SEVERITY_WARNING ? "warning" : "information", "message", marker.getAttribute(IMarker.MESSAGE, ""), "source", marker.getType()));
        }
        return result;
    }
    public JsonObject hostContext() throws IOException {
        requireDisplay();
        org.osgi.framework.Bundle platform = Platform.getBundle("org.eclipse.platform");
        String version = platform == null ? Platform.getBundle("org.eclipse.ui").getVersion().toString() : platform.getVersion().toString();
        boolean dark = PlatformUI.getWorkbench().getThemeManager().getCurrentTheme().getId().toLowerCase(Locale.ROOT).contains("dark");
        String kind = Display.getDefault().getHighContrast() ? dark ? "highContrastDark" : "highContrastLight" : dark ? "dark" : "light";
        return Json.object("host", Json.object("id", "eclipse", "version", version), "protocolRange", Json.object("minimum", "mhp/1.5.0", "maximumExclusive", "mhp/1.6.0"), "capabilities", Json.GSON.toJsonTree(CAPABILITIES), "locale", Assets.locale(Platform.getNL()), "theme", Json.object("kind", kind, "tokens", tokens()), "folders", folders(), "trusted", trusted);
    }
    public static JsonObject tokens() {
        RGB background = Display.getDefault().getSystemColor(SWT.COLOR_LIST_BACKGROUND).getRGB(); RGB foreground = Display.getDefault().getSystemColor(SWT.COLOR_LIST_FOREGROUND).getRGB();
        return Json.object("--muse-editor-background", String.format("#%02x%02x%02x", background.red, background.green, background.blue), "--muse-editor-foreground", String.format("#%02x%02x%02x", foreground.red, foreground.green, foreground.blue));
    }
    private void requireDisplay() {
        if (Display.getCurrent() != display) throw new IllegalStateException("MHP_UI_THREAD_REQUIRED");
    }
    private void cleanup(String code, Runnable step) {
        try { step.run(); } catch (RuntimeException ex) { log.accept(code); }
    }
    private void closeNative() {
        requireDisplay();
        List<Analysis> pending = List.copyOf(analyses.values()); analyses.clear();
        for (Analysis analysis : pending) cleanup("MHP_ANALYSIS_CLEANUP_FAILURE", () -> analysis.job.cancel());
        cleanup("MHP_UI_CLEANUP_FAILURE", ui::close);
        List<Command> registered = List.copyOf(commands.values()); commands.clear();
        for (Command command : registered) {
            cleanup("MHP_COMMAND_CLEANUP_FAILURE", () -> window.getService(org.eclipse.ui.handlers.IHandlerService.class).deactivateHandler(command.activation));
            cleanup("MHP_COMMAND_CLEANUP_FAILURE", command.command::undefine);
        }
        List<MuseView> views;
        synchronized (stateLock) { views = List.copyOf(surfaces.values()); surfaces.clear(); }
        for (MuseView view : views) {
            cleanup("MHP_SURFACE_FAILURE", () -> view.binding().close(dropBrowser(view.binding().id)));
            cleanup("MHP_SURFACE_CLEANUP_FAILURE", () -> { if (view.getSite() != null) view.getSite().getPage().hideView(view); });
        }
        chatSession = null;
        cleanup("MHP_TAB_CLEANUP_FAILURE", () -> Completion.dispose(this));
        cleanup("MHP_DOCUMENT_CLEANUP_FAILURE", documents::close);
        cleanup("MHP_SELECTION_CLEANUP_FAILURE", () -> window.getSelectionService().removePostSelectionListener(selections));
        cleanup("MHP_PART_CLEANUP_FAILURE", () -> window.getPartService().removePartListener(parts));
        cleanup("MHP_WINDOW_CLEANUP_FAILURE", () -> PlatformUI.getWorkbench().removeWindowListener(windows));
        cleanup("MHP_RESOURCE_CLEANUP_FAILURE", () -> ResourcesPlugin.getWorkspace().removeResourceChangeListener(problems));
    }
    @Override public void close() {
        synchronized (stateLock) { if (disposed) return; disposed = true; }
        // Retain identities before any cleanup can close a pipe or stop the parent.
        try {
            runtime.snapshotDescendants();
            cleanup("MHP_NATIVE_CLEANUP_FAILURE", () -> {
                if (Display.getCurrent() == display) closeNative();
                // Do not syncExec from OSGi stop: the display may be waiting for it.
                else if (!display.isDisposed()) display.asyncExec(this::closeNative);
            });
            synchronized (stateLock) {
                while (!browserQueue.isEmpty()) {
                    Delivery delivery = browserQueue.removeFirst();
                    cleanup("MHP_BROWSER_CLEANUP_FAILURE", () -> peer.releaseBrowser(delivery.bytes));
                }
                browserScheduled = false;
            }
            cleanup("MHP_PEER_DRAIN_FAILURE", peer::drain);
            cleanup("MHP_PEER_CLEANUP_FAILURE", peer::close);
            cleanup("MHP_STDERR_CLEANUP_FAILURE", () -> stderr.shutdownNow());
        } finally {
            runtime.close();
        }
    }
}
