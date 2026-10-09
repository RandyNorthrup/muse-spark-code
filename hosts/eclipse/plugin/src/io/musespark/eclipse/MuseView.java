package io.musespark.eclipse;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import org.eclipse.core.runtime.*;
import org.eclipse.swt.SWT;
import org.eclipse.swt.browser.*;
import org.eclipse.swt.layout.FillLayout;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.ui.*;
import org.eclipse.ui.part.ViewPart;

/** SWT Browser owns only a container and the frozen window.museHost bridge. */
public final class MuseView extends ViewPart {
    private record Configuration(String session, String kind, WindowSession owner) { }
    private static final Map<String, Configuration> CONFIGURATIONS = new HashMap<>();
    public static void configure(String id, String session, String kind, WindowSession owner) { CONFIGURATIONS.put(id, new Configuration(session, kind, owner)); }
    // Deferred display cleanup outlives MusePlugin.stop clearing the singleton.
    private final java.util.function.Consumer<String> log = MusePlugin.get()::log;
    private WindowSession session;
    private PanelSurface binding;
    private Browser browser;
    private BrowserFunction function;
    private org.eclipse.swt.widgets.Menu menu;
    private Path page;
    private String restoredSession;
    private JsonElement restoredState;
    private String kind = "chat";
    private boolean loaded;
    private long renderGeneration;
    private CompletableFuture<String> pendingRender;
    public PanelSurface binding() { return binding; }
    @Override public void init(IViewSite site, IMemento memento) throws PartInitException {
        super.init(site, memento);
        if (memento != null) {
            restoredSession = memento.getString("session"); String storedKind = memento.getString("kind"); if (storedKind != null) kind = storedKind;
            String state = memento.getString("state"); if (state != null) try { restoredState = Json.parse(state); } catch (RuntimeException ex) { log.accept("MHP_STATE_INVALID"); }
        }
    }
    public static int browserStyle() { return browserStyle(Platform.getOS()); }
    public static int browserStyle(String os) { return os.equals(Platform.OS_WIN32) ? SWT.EDGE : SWT.WEBKIT; }
    @Override public void createPartControl(Composite parent) {
        parent.setLayout(new FillLayout());
        Configuration configuration = CONFIGURATIONS.remove(getViewSite().getSecondaryId());
        if (configuration == null || configuration.owner == null) {
            // A view without runtime configuration owns no session: publishing an invented one
            // is rejected as unowned. Fail here; the Window-menu command opens the runtime's
            // configured surface instead.
            showFailure(parent);
            return;
        }
        try {
            session = configuration.owner;
            restoredSession = configuration.session; kind = configuration.kind;
            binding = new PanelSurface(session.contract, UUID.randomUUID().toString(), restoredSession == null ? UUID.randomUUID().toString() : restoredSession, kind, session.peer::send, session.peer::purge, log);
            if (restoredState != null) binding.state(restoredState);
            session.add(this);
            browser = new Browser(parent, browserStyle());
            String engine = Platform.getOS().equals(Platform.OS_WIN32) ? "edge" : "webkit";
            if (!engine.equals(browser.getBrowserType())) throw new IllegalStateException("MHP_BROWSER_ENGINE_UNAVAILABLE");
            browser.addListener(SWT.MenuDetect, event -> event.doit = false);
            browser.addListener(SWT.KeyDown, event -> { if (event.keyCode == SWT.F12 || (event.stateMask & SWT.CTRL) != 0 && (event.stateMask & SWT.SHIFT) != 0 && (event.keyCode == 'i' || event.keyCode == 'j')) event.doit = false; });
            menu = new org.eclipse.swt.widgets.Menu(browser); browser.setMenu(menu);
            browser.addOpenWindowListener(event -> event.required = true);
            browser.addLocationListener(new LocationAdapter() {
                @Override public void changing(LocationEvent event) {
                    event.doit = page != null && Assets.navigationAllowed(page, event.location);
                    // GTK does not set LocationEvent.top while changing; the exact document guard and frame-src policy identify this navigation.
                    if (event.doit && loaded) { try {
                        binding.reload();
                        if (kind.equals("whatsNew")) {
                            event.doit = false; loaded = false;
                            browser.getDisplay().asyncExec(() -> { try { if (!browser.isDisposed()) loadPage(); } catch (IOException ex) { log.accept("MHP_PAGE_FAILURE"); showFailure(parent); } });
                        }
                    } catch (RuntimeException ex) { event.doit = false; } }
                }
            });
            function = new BrowserFunction(browser, "museNative", true, new String[0]) {
                @Override public Object function(Object[] arguments) {
                    try {
                        if (arguments.length != 2 || !(arguments[0] instanceof String operation) || !(arguments[1] instanceof String value)) throw new IllegalArgumentException("MHP_INVALID_REQUEST");
                        if (value.getBytes(StandardCharsets.UTF_8).length > session.contract.frameCap) throw new IllegalArgumentException("MHP_PANEL_TOO_LARGE");
                        JsonElement payload = Json.parse(value);
                        switch (operation) {
                            case "post" -> binding.post(payload);
                            case "state" -> binding.state(payload);
                            case "getState" -> { if (!payload.isJsonNull()) throw new IllegalArgumentException("MHP_INVALID_REQUEST"); JsonElement state = binding.state(); return Json.object("present", state != null, "value", state).toString(); }
                            case "ready" -> { if (!payload.isJsonNull()) throw new IllegalArgumentException("MHP_INVALID_REQUEST"); binding.ready(); loaded = true; session.browserReady(); }
                            default -> throw new IllegalArgumentException("MHP_INVALID_REQUEST");
                        }
                        return null;
                    } catch (RuntimeException ex) { String code = ex.getMessage(); return code != null && code.matches("MHP_[A-Z_]+") ? code : "MHP_INVALID_REQUEST"; }
                }
            };
            browser.addProgressListener(new ProgressAdapter() {
                @Override public void completed(ProgressEvent event) { if (!browser.isDisposed()) browser.execute("window.__museStart();"); }
            });
            session.afterInitialize(() -> {
                try { binding.opened(); loadPage(); } catch (Exception ex) { log.accept("MHP_PAGE_FAILURE"); showFailure(parent); }
            }, () -> showFailure(parent));
        } catch (Exception | org.eclipse.swt.SWTError ex) { log.accept("MHP_VIEW_FAILURE"); throw new IllegalStateException("MHP_VIEW_FAILURE"); }
    }
    private void showFailure(Composite parent) {
        if (parent.isDisposed()) return;
        if (function != null && !function.isDisposed()) function.dispose();
        if (browser != null && !browser.isDisposed()) browser.dispose();
        if (menu != null && !menu.isDisposed()) menu.dispose();
        org.eclipse.swt.widgets.Label label = new org.eclipse.swt.widgets.Label(parent, SWT.WRAP);
        try { label.setText(Assets.table(Platform.getNL()).get("hostStartFailed").getAsString()); }
        catch (IOException ex) { throw new IllegalStateException("MHP_L10N_FAILURE"); }
        parent.layout();
    }
    private void loadPage() throws IOException {
        if (session.isClosed()) return;
        Path assets = Assets.extract(MusePlugin.get().getBundle(), MusePlugin.get().getStateLocation().toFile().toPath().resolve("assets").resolve(MusePlugin.get().getBundle().getVersion().toString()));
        Path directory = MusePlugin.get().getStateLocation().toFile().toPath().resolve("pages"); Files.createDirectories(directory);
        page = directory.resolve(binding.id + ".html");
        if (kind.equals("whatsNew")) {
            long generation = ++renderGeneration; if (pendingRender != null) pendingRender.cancel(false);
            JsonObject context = session.hostContext(); org.eclipse.swt.widgets.Display display = browser.getDisplay();
            pendingRender = Assets.renderedHtml(session.contract, session.htmlPort, assets, context.get("locale").getAsString(), binding.state(), context.getAsJsonObject("theme"), binding.id, binding.session).orTimeout(100, TimeUnit.SECONDS);
            pendingRender.whenComplete((html, error) -> { if (!display.isDisposed()) display.asyncExec(() -> {
                if (browser.isDisposed() || generation != renderGeneration) return;
                try {
                    if (error != null) throw new IOException("MHP_RENDER_FAILURE");
                    Files.writeString(page, html, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
                    if (!browser.setUrl(page.toUri().toASCIIString())) throw new IOException("MHP_PAGE_FAILURE");
                } catch (IOException ex) { log.accept("MHP_PAGE_FAILURE"); showFailure(browser.getParent()); }
            }); });
            return;
        }
        Files.writeString(page, Assets.html(assets, Platform.getNL(), kind, binding.state(), WindowSession.tokens()), StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
        if (!browser.setUrl(page.toUri().toASCIIString())) throw new IOException("MHP_PAGE_FAILURE");
    }
    public void presentHtml(String html) throws IOException {
        if (page == null || browser == null || browser.isDisposed()) throw new IllegalStateException("MHP_PANEL_NOT_READY");
        Files.writeString(page, html, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
        if (!browser.setUrl(page.toUri().toASCIIString())) throw new IOException("MHP_PAGE_FAILURE");
    }
    public void deliverPayload(JsonElement payload) {
        if (browser.isDisposed() || !browser.execute("window.__museDeliver(" + Assets.scriptSafe(payload.toString()) + ");")) throw new IllegalStateException("MHP_PANEL_NOT_READY");
    }
    public void hidden() { if (binding != null && loaded) try { binding.hidden(); } catch (RuntimeException ex) { log.accept("MHP_SURFACE_FAILURE"); } }
    @Override public void saveState(IMemento memento) {
        if (binding == null) return;
        memento.putString("session", binding.session); memento.putString("kind", binding.kind);
        JsonElement state = binding.state(); if (state != null) memento.putString("state", state.toString());
    }
    @Override public void setFocus() { if (browser != null && !browser.isDisposed()) browser.setFocus(); }
    @Override public void dispose() {
        renderGeneration++; if (pendingRender != null) pendingRender.cancel(false);
        if (binding != null) {
            try { binding.close(session.dropBrowser(binding.id)); } catch (RuntimeException ex) { log.accept("MHP_SURFACE_FAILURE"); }
            session.remove(this);
        }
        if (function != null && !function.isDisposed()) function.dispose();
        if (browser != null && !browser.isDisposed()) browser.dispose();
        if (menu != null && !menu.isDisposed()) menu.dispose();
        if (page != null) try { Files.deleteIfExists(page); } catch (IOException ex) { log.accept("MHP_PAGE_CLEANUP_FAILURE"); }
        super.dispose();
    }
}
