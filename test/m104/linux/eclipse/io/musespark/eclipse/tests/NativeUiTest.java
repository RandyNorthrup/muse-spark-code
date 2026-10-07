package io.musespark.eclipse.tests;

import static org.junit.Assert.*;
import com.google.gson.*;
import io.musespark.eclipse.*;
import java.nio.file.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.eclipse.swt.SWT;
import org.eclipse.swt.widgets.*;
import org.eclipse.ui.PlatformUI;
import org.junit.*;

public class NativeUiTest {
    private WindowSession session;
    private Path fixture;
    @Before public void setup() throws Exception {
        fixture = Files.createTempFile("m104-native-ui-", ".py");
        try (var input = getClass().getResourceAsStream("/fixtures/runtime.py")) { Files.write(fixture, input.readAllBytes()); }
        ProcessBuilder builder = new ProcessBuilder("python3", fixture.toString());
        var clean = Assets.environment(builder.environment()); builder.environment().clear(); builder.environment().putAll(clean);
        session = new WindowSession(PlatformUI.getWorkbench().getActiveWorkbenchWindow(), builder.start());
        AtomicBoolean ready = new AtomicBoolean(); session.afterInitialize(() -> ready.set(true));
        long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(2);
        while (!ready.get() && System.nanoTime() < deadline) { if (!Display.getDefault().readAndDispatch()) Thread.sleep(1); }
        assertTrue(ready.get());
    }
    @After public void cleanup() throws Exception { if (session != null) session.close(); if (fixture != null) Files.deleteIfExists(fixture); }
    private JsonObject prompt() {
        JsonArray choices = new JsonArray(); choices.add(Json.object("id", 99, "title", "Allow once")); choices.add(Json.object("id", "opaque-denial", "title", "Deny"));
        return Json.object("title", "Paid native fixture", "message", "$0.50 request; $1.00 shared daily budget. Subscription pays none.", "choices", choices);
    }
    private static Button button(Composite parent, String text) {
        for (Control control : parent.getChildren()) { if (control instanceof Button candidate && candidate.getText().equals(text)) return candidate; if (control instanceof Composite child) { Button found = button(child, text); if (found != null) return found; } }
        return null;
    }
    private void choose(String title) {
        Display display = Display.getDefault(); display.timerExec(20, new Runnable() {
            @Override public void run() {
                for (Shell shell : display.getShells()) if (shell.getText().equals("Paid native fixture")) { Button choice = button(shell, title); assertNotNull(choice); choice.notifyListeners(SWT.Selection, new Event()); return; }
                display.timerExec(20, this);
            }
        });
    }
    @Test public void pricedPromptReturnsExactOpaqueAndNumericIdentifiers() throws Exception {
        choose("Deny"); assertEquals(new JsonPrimitive("opaque-denial"), session.uiRequest("ui/confirm", prompt()));
        choose("Allow once"); assertEquals(new JsonPrimitive(99), session.uiRequest("ui/confirm", prompt()));
    }
    @Test public void cancellationAndWindowRetirementCannotReturnConsent() {
        AtomicBoolean cancelled = new AtomicBoolean(); Display.getDefault().timerExec(20, () -> cancelled.set(true));
        IllegalArgumentException failure = assertThrows(IllegalArgumentException.class, () -> session.ui.request("ui/confirm", prompt(), cancelled::get));
        assertEquals("MHP_CANCELLED", failure.getMessage());
        Display.getDefault().timerExec(20, session::close);
        failure = assertThrows(IllegalArgumentException.class, () -> session.ui.request("ui/confirm", prompt(), () -> false));
        assertEquals("MHP_CLOSED", failure.getMessage());
    }
    @Test public void nativeClipboardAndRegisteredCommandAreOwnedByTheWindow() throws Exception {
        for (String kind : new String[] {"models", "traffic", "settings", "walkthrough", "diff", "usage", "maker"}) {
            var failure = assertThrows(IllegalArgumentException.class, () -> session.uiRequest("surfaces/open", Json.object("kind", kind, "placement", "tab", "sessionId", "fixture")));
            assertEquals("MHP_CAPABILITY_UNAVAILABLE", failure.getMessage());
        }
        assertThrows(IllegalArgumentException.class, () -> NativeUi.externalTarget("file:///fixture"));
        assertThrows(IllegalArgumentException.class, () -> NativeUi.externalTarget("javascript:fixture"));
        assertEquals("https", NativeUi.externalTarget("https://example.invalid").getScheme());
        session.uiRequest("ui/clipboard", Json.object("text", "native fixture"));
        org.eclipse.swt.dnd.Clipboard clipboard = new org.eclipse.swt.dnd.Clipboard(Display.getDefault());
        try { assertEquals("native fixture", clipboard.getContents(org.eclipse.swt.dnd.TextTransfer.getInstance())); } finally { clipboard.dispose(); }
        session.uiRequest("commands/register", Json.object("id", "fixture", "title", "Native fixture command")); assertTrue(session.hasCommand("fixture"));
        session.close(); assertFalse(session.hasCommand("fixture"));
        assertThrows(IllegalArgumentException.class, () -> session.uiRequest("ui/clipboard", Json.object("text", "stale")));
        assertThrows(IllegalArgumentException.class, () -> session.uiRequest("ui/openExternal", Json.object("uri", "file:///etc/passwd")));
    }
    @Test public void nativeNoticeAdmissionIsBoundedAndDisposedUiCannotMutate() throws Exception {
        var field = NativeUi.class.getDeclaredField("notices"); field.setAccessible(true); Object notices = field.get(session.ui);
        // Fill only the admission bookkeeping; the denial must precede native control allocation.
        var put = notices.getClass().getMethod("put", Object.class, Object.class);
        try {
            for (int index = 0; index < session.contract.queueMessages; index++) put.invoke(notices, "fixture:" + index, null);
            var failure = assertThrows(IllegalArgumentException.class, () -> session.uiRequest("ui/status", Json.object("id", "overflow", "text", "fixture", "visible", true)));
            assertEquals("MHP_PANEL_BACKPRESSURE", failure.getMessage());
        } finally { session.uiRequest("ui/status", Json.object("id", "overflow", "text", "fixture", "visible", false)); notices.getClass().getMethod("clear").invoke(notices); }
        session.ui.close(); assertFalse(session.isClosed());
        var failure = assertThrows(IllegalArgumentException.class, () -> session.uiRequest("ui/clipboard", Json.object("text", "stale fixture")));
        assertEquals("MHP_CLOSED", failure.getMessage());
    }
    @Test public void nativeNoticesKeepTypedIdsAndCanonicalNumericLifetimes() throws Exception {
        session.uiRequest("surfaces/open", Json.object("kind", "chat", "placement", "side", "sessionId", "fixture"));
        var field = NativeUi.class.getDeclaredField("notices"); field.setAccessible(true);
        Object registered = field.get(session.ui);
        if (!(registered instanceof java.util.Map<?, ?> notices)) throw new AssertionError("Native notice registry unavailable");
        JsonPrimitive numeric = new JsonPrimitive(1), string = new JsonPrimitive("1");
        for (JsonPrimitive id : new JsonPrimitive[] {numeric, string}) {
            session.uiRequest("ui/status", Json.object("id", id, "text", "Native status fixture", "visible", true));
            session.uiRequest("ui/progress", Json.object("id", id, "title", "Native progress fixture", "done", false));
        }
        assertEquals(4, notices.size());
        JsonElement equivalent = JsonParser.parseString("1e0");
        session.uiRequest("ui/status", Json.object("id", equivalent, "text", "Updated native fixture", "visible", true));
        session.uiRequest("ui/progress", Json.object("id", equivalent, "title", "Updated native fixture", "done", false));
        assertEquals(4, notices.size());
        session.uiRequest("ui/status", Json.object("id", equivalent, "text", "Updated native fixture", "visible", false));
        session.uiRequest("ui/progress", Json.object("id", equivalent, "title", "Updated native fixture", "done", true));
        assertEquals(2, notices.size());
        session.uiRequest("ui/status", Json.object("id", string, "text", "Native status fixture", "visible", false));
        session.uiRequest("ui/progress", Json.object("id", string, "title", "Native progress fixture", "done", true));
        assertTrue(notices.isEmpty());
    }
    @Test public void runtimeSurfaceCloseAndWindowRetirementDisposeNativeBrowsers() throws Exception {
        String id = session.uiRequest("surfaces/open", Json.object("kind", "tasks", "placement", "tab", "sessionId", "fixture")).getAsJsonObject().get("surfaceId").getAsString();
        MuseView view = null;
        for (var reference : session.window.getActivePage().getViewReferences()) if (reference.getView(false) instanceof MuseView candidate && candidate.binding().id.equals(id)) view = candidate;
        assertNotNull(view); var field = MuseView.class.getDeclaredField("browser"); field.setAccessible(true); var browser = (org.eclipse.swt.browser.Browser) field.get(view);
        session.uiRequest("surfaces/close", Json.object("surfaceId", id)); assertTrue(browser.isDisposed());
        String retired = id; assertThrows(IllegalArgumentException.class, () -> session.uiRequest("surfaces/state", Json.object("surfaceId", retired)));
        id = session.uiRequest("surfaces/open", Json.object("kind", "chat", "placement", "side", "sessionId", "fixture")).getAsJsonObject().get("surfaceId").getAsString();
        for (var reference : session.window.getActivePage().getViewReferences()) if (reference.getView(false) instanceof MuseView candidate && candidate.binding().id.equals(id)) view = candidate;
        browser = (org.eclipse.swt.browser.Browser) field.get(view); session.close(); assertTrue(browser.isDisposed());
    }
}
