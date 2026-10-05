package io.musespark.eclipse.tests;

import static org.junit.Assert.*;
import com.google.gson.*;
import io.musespark.eclipse.*;
import java.nio.file.*;
import java.util.*;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.eclipse.swt.SWT;
import org.eclipse.swt.browser.*;
import org.eclipse.swt.layout.FillLayout;
import org.eclipse.swt.widgets.*;
import org.junit.Test;

public class BrowserTest {
    @Test public void assetCspAndNavigationRefuseRemoteAndSiblingFiles() throws Exception {
        Path page = Path.of("/tmp/panel/page.html");
        assertTrue(Assets.navigationAllowed(page, page.toUri().toString()));
        assertTrue(Assets.navigationAllowed(page, page.toUri() + "#fragment"));
        for (String target : List.of("https://example.com", "http://127.0.0.1:99", "javascript:alert(1)", "file:///tmp/panel/other.html", "file:///tmp/panel/../secret", "about:blank")) assertFalse(Assets.navigationAllowed(page, target));
        assertEquals("de", Assets.locale("de-DE")); assertEquals("pt-br", Assets.locale("pt_BR")); assertEquals("en", Assets.locale("unavailable"));
        assertThrows(IllegalArgumentException.class, () -> Assets.html(page.getParent(), "en", "whatsNew", null, new JsonObject()));
        String html = Assets.html(page.getParent(), "de", "chat", Json.object("draft", "</script>"), new JsonObject());
        assertTrue(html.contains("default-src 'none'")); assertTrue(html.contains("connect-src swt://browserfunction")); assertTrue(html.contains("form-action 'none'"));
        assertFalse(html.contains("unsafe-eval")); assertFalse(html.contains("unsafe-inline")); assertFalse(html.contains("</script>\"}")); assertTrue(html.contains("window.museHost")); assertTrue(html.contains("data-host=\"embedded\""));
        assertTrue(Assets.scriptSafe("</script>\u2028").startsWith("\\u003c"));
        assertEquals(SWT.WEBKIT, MuseView.browserStyle()); assertEquals(SWT.EDGE, MuseView.browserStyle("win32"));
    }
    @Test public void credentialNamesAreRemovedBeforeRuntimeSpawn() {
        Map<String, String> environment = Assets.environment(Map.of("PRIVATE_API_KEY", "test-only-marker", "openai_api_key", "test-only-marker", "META_KEY", "test-only-marker", "AWS_SESSION_TOKEN", "test-only-marker", "PATH", "/bin", "LANG", "en_US.UTF-8"));
        assertEquals(Map.of("PATH", "/bin", "LANG", "en_US.UTF-8"), environment);
    }
    @Test public void nativePropertiesPreserveEveryTranslationCharacter() throws Exception {
        JsonArray languages = Json.resource("/target/assets/config.json").getAsJsonObject().getAsJsonArray("languages");
        for (JsonElement entry : languages) {
            String language = entry.getAsString(); String[] parts = language.split("-");
            String suffix = language.equals("en") ? "" : "_" + parts[0] + (parts.length > 1 ? "_" + parts[1].toUpperCase(Locale.ROOT) : "");
            Properties properties = new Properties();
            java.net.URL resource = org.eclipse.core.runtime.Platform.getBundle("io.musespark.eclipse").getEntry("target/l10n/plugin" + suffix + ".properties");
            assertNotNull(resource); try (java.io.InputStream stream = resource.openStream()) { properties.load(stream); }
            assertEquals(language, Assets.table(language).get("trustGrantedNotice").getAsString(), properties.getProperty("trust"));
        }
    }
    @Test public void packagedAssetsIncludeStylesAndLazyChunks() throws Exception {
        Path directory = Files.createTempDirectory("m104-assets-");
        try {
            Assets.extract(org.eclipse.core.runtime.Platform.getBundle("io.musespark.eclipse"), directory);
            assertTrue(Files.isRegularFile(directory.resolve("main.js"))); assertTrue(Files.isRegularFile(directory.resolve("main.css")));
            try (var files = Files.walk(directory)) { assertTrue(files.anyMatch(path -> path.getFileName().toString().startsWith("chunk-"))); }
        } finally { try (var paths = Files.walk(directory)) { for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(path); } }
    }
    @Test public void realWebkitBrowserFunctionExchangesOrderedMessagesAndSavedState() throws Exception {
        Path directory = Files.createTempDirectory("m104-browser-"); Path page = directory.resolve("page.html");
        Files.writeString(directory.resolve("main.css"), "body{color:black}");
        Files.writeString(directory.resolve("main.js"), "window.unsubscribe = window.museHost.onMessage(p => window.received = p); window.museHost.setState({draft:'persisted'}); window.museHost.postMessage({type:'ready'}); window.testReady=true;");
        Files.writeString(page, Assets.html(directory, "en", "chat", Json.object("draft", "initial"), new JsonObject()).replace("const listeners = new Set();", "window.addEventListener(\"error\", event => window.testError = event.message); const listeners = new Set();"));
        Shell shell = new Shell(Display.getDefault()); shell.setLayout(new FillLayout()); Browser browser = new Browser(shell, MuseView.browserStyle());
        List<String> operations = new ArrayList<>();
        BrowserFunction function = new BrowserFunction(browser, "museNative", true, new String[0]) {
            @Override public Object function(Object[] arguments) { operations.add(arguments[0].toString()); Json.parse(arguments[1].toString()); return null; }
        };
        browser.addProgressListener(new ProgressAdapter() {
            @Override public void completed(ProgressEvent event) { browser.execute("window.__museStart();"); }
        });
        try {
            shell.open(); assertTrue(browser.setUrl(page.toUri().toString()));
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(100);
            boolean ready = false;
            while (!ready && System.nanoTime() < deadline) {
                if (!Display.getDefault().readAndDispatch()) { Display.getDefault().timerExec(100, () -> { }); Display.getDefault().sleep(); }
                try { ready = Boolean.TRUE.equals(browser.evaluate("return window.testReady === true;")); } catch (RuntimeException ex) { }
            }
            assertTrue("SWT shared embedded shim did not run: " + browser.evaluate("return window.testError || document.readyState;"), ready); assertEquals(List.of("ready", "state", "post"), operations);
            browser.execute("window.__museDeliver({type:'conversationCleared'});");
            while (Display.getDefault().readAndDispatch()) { }
            assertEquals("conversationCleared", browser.evaluate("return window.received.type;"));
            assertEquals("persisted", browser.evaluate("return window.museHost.getState().draft;"));
            browser.execute("window.unsubscribe(); window.received=null; window.__museDeliver({type:'conversationCleared'});");
            assertNull(browser.evaluate("return window.received;"));
            assertEquals(Boolean.TRUE, browser.evaluate("return (() => {try {window.museHost.setState({invalid:NaN}); return false;} catch {return true;}})();"));
            assertEquals(Boolean.TRUE, browser.evaluate("return (() => {try {window.museHost.setState({invalid:undefined}); return false;} catch {return true;}})();"));
            assertEquals(Boolean.TRUE, browser.evaluate("return (() => {try {window.museHost.setState(new Date()); return false;} catch {return true;}})();"));
        } finally {
            function.dispose(); browser.dispose(); shell.dispose();
            Files.deleteIfExists(page); Files.deleteIfExists(directory.resolve("main.css")); Files.deleteIfExists(directory.resolve("main.js")); Files.deleteIfExists(directory);
        }
    }
}
