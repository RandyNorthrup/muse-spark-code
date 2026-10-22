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
    @Test public void bootstrapAssetUrlsAreJavascriptStrings() throws Exception {
        String html = Assets.html(Path.of("/tmp/o'connor/assets"), "en", "chat", Json.object("draft", "SCRIPT_START IS_HTML HAS_STATE SCRIPT_NONCE SCRIPT_URL INITIAL_STATE"), new JsonObject());
        int start = html.indexOf('>', html.lastIndexOf("<script nonce=")) + 1; Path script = Files.createTempFile("m104-bootstrap-", ".mjs");
        try {
            Files.writeString(script, html.substring(start, html.lastIndexOf("</script>")));
            ProcessBuilder builder = new ProcessBuilder("node", "--check", script.toString()); Map<String, String> clean = Assets.environment(builder.environment()); builder.environment().clear(); builder.environment().putAll(clean); builder.redirectErrorStream(true);
            Process check = builder.start(); String output = new String(check.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8); assertEquals(output, 0, check.waitFor());
        } finally { Files.deleteIfExists(script); }
    }
    private static Assets.HtmlPort htmlPort(boolean supported, java.util.function.Function<JsonObject, java.util.concurrent.CompletableFuture<JsonObject>> render) {
        return new Assets.HtmlPort() {
            @Override public boolean supports(String protocol, String capability) { return supported && protocol.equals("mhp/1.5.0") && capability.equals("surfaceHtml"); }
            @Override public java.util.concurrent.CompletableFuture<JsonObject> render(JsonObject params) { return render.apply(params); }
        };
    }
    @Test public void proposedHtmlPortRequiresCapabilityAndValidatesCompleteBoundedResults() throws Exception {
        Contract contract = new Contract(); Path assets = Path.of("/tmp/o'connor/assets"); JsonObject theme = Json.object("kind", "dark", "tokens", new JsonObject());
        assertFalse(Assets.hasHtmlPort(null));
        Assets.HtmlPort absent = htmlPort(false, params -> { throw new AssertionError("unnegotiated renderer was called"); });
        assertThrows(IllegalArgumentException.class, () -> Assets.renderedHtml(contract, absent, assets, "en", null, theme, "surface", "session"));
        assertThrows(IllegalArgumentException.class, () -> Assets.renderedHtml(contract, htmlPort(true, params -> null), assets, "en", null, theme, "surface", "session"));
        for (JsonObject result : new JsonObject[] {null, Json.object("html", JsonNull.INSTANCE), Json.object("html", 1), Json.object("html", ""), Json.object("html", "<div>partial</div>"), Json.object("html", "<!DOCTYPE html><html><head></head><body></body></html>", "extra", true), Json.object("html", "<!DOCTYPE html><html><head></head><body>" + "x".repeat(contract.frameCap) + "</body></html>")}) {
            var future = Assets.renderedHtml(contract, htmlPort(true, params -> java.util.concurrent.CompletableFuture.completedFuture(result)), assets, "en", null, theme, "surface", "session");
            var failure = assertThrows(java.util.concurrent.ExecutionException.class, () -> future.get(2, TimeUnit.SECONDS)); assertTrue(failure.getCause().getMessage().startsWith("MHP_"));
        }
        for (boolean oversized : List.of(false, true)) {
            var future = Assets.renderedHtml(contract, htmlPort(true, params -> {
                String script = "<script nonce=\"" + params.get("nonce").getAsString() + "\" src=\"" + params.get("scriptUri").getAsString().replace("'", "&#39;") + "\"></script>";
                JsonObject result = Json.object("html", "<!DOCTYPE html><html><head></head><body>" + (oversized ? "x".repeat(contract.frameCap) : "release") + script + "</body></html>");
                if (!oversized) result.addProperty("extra", true);
                return java.util.concurrent.CompletableFuture.completedFuture(result);
            }), assets, "en", null, theme, "surface", "session");
            assertThrows(java.util.concurrent.ExecutionException.class, () -> future.get(2, TimeUnit.SECONDS));
        }
        java.util.concurrent.atomic.AtomicReference<JsonObject> request = new java.util.concurrent.atomic.AtomicReference<>();
        String html = Assets.renderedHtml(contract, htmlPort(true, params -> { request.set(params); return java.util.concurrent.CompletableFuture.completedFuture(Json.object("html", "<!DOCTYPE html><html lang=\"de\"><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'\"></head><body>release<script nonce=\"" + params.get("nonce").getAsString() + "\" src=\"" + params.get("scriptUri").getAsString().replace("&", "&amp;").replace("'", "&#39;") + "\"></script></body></html>")); }), assets, "de-DE", null, theme, "surface", "session").get(2, TimeUnit.SECONDS);
        assertEquals("de", request.get().get("locale").getAsString()); assertEquals("surface", request.get().get("surfaceId").getAsString()); assertEquals("session", request.get().get("sessionId").getAsString()); assertTrue(request.get().get("styleUri").getAsString().endsWith("whatsNew.css")); assertTrue(request.get().get("scriptUri").getAsString().endsWith("whatsNew.js"));
        assertTrue(html.contains("connect-src swt://browserfunction")); assertTrue(html.contains("base-uri 'none'")); assertEquals(1, html.split("http-equiv=\"Content-Security-Policy\"", -1).length - 1); assertTrue(html.indexOf("window.museHost") < html.indexOf("<body>"));
        assertTrue(html.contains("<script nonce=\"" + request.get().get("nonce").getAsString()));
    }
    @Test public void proposedHtmlPortRefusesInlineRemoteAndDuplicateScripts() throws Exception {
        Contract contract = new Contract(); JsonObject theme = Json.object("kind", "light", "tokens", new JsonObject());
        for (String script : List.of("", "<script>invalid()</script>", "<script src=\"https://example.com/remote.js\"></script>", "<script nonce=\"wrong\" src=\"file:///tmp/whatsNew.js\"></script>")) {
            var future = Assets.renderedHtml(contract, htmlPort(true, params -> java.util.concurrent.CompletableFuture.completedFuture(Json.object("html", "<!DOCTYPE html><html><head></head><body>" + script + "</body></html>"))), Path.of("/tmp/assets"), "en", null, theme, "surface", "session");
            assertThrows(java.util.concurrent.ExecutionException.class, () -> future.get(2, TimeUnit.SECONDS));
        }
        var duplicate = Assets.renderedHtml(contract, htmlPort(true, params -> {
            String script = "<script nonce=\"" + params.get("nonce").getAsString() + "\" src=\"" + params.get("scriptUri").getAsString() + "\"></script>";
            return java.util.concurrent.CompletableFuture.completedFuture(Json.object("html", "<!DOCTYPE html><html><head></head><body>" + script + script + "</body></html>"));
        }), Path.of("/tmp/assets"), "en", null, theme, "surface", "session"); assertThrows(java.util.concurrent.ExecutionException.class, () -> duplicate.get(2, TimeUnit.SECONDS));
    }
    @Test public void packagedChatAndTasksMountThroughTheNativeApiAdapter() throws Exception {
        Path assets = Files.createTempDirectory("m104-packaged-panel-"); Assets.extract(org.eclipse.core.runtime.Platform.getBundle("io.musespark.eclipse"), assets);
        try {
            for (String kind : List.of("chat", "tasks")) {
                Path page = assets.resolve(kind + ".html"); Files.writeString(page, Assets.html(assets, "en", kind, null, new JsonObject()));
                Shell shell = new Shell(Display.getDefault()); shell.setLayout(new FillLayout()); Browser browser = new Browser(shell, MuseView.browserStyle()); List<String> messages = new ArrayList<>();
                BrowserFunction function = new BrowserFunction(browser, "museNative", true, new String[0]) { @Override public Object function(Object[] arguments) { if (arguments[0].equals("post")) messages.add(arguments[1].toString()); return null; } };
                browser.addProgressListener(new ProgressAdapter() { @Override public void completed(ProgressEvent event) { browser.execute("window.__museStart();"); } });
                try {
                    shell.open(); assertTrue(browser.setUrl(page.toUri().toString())); long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(100); boolean mounted = false;
                    while (!mounted && System.nanoTime() < deadline) { if (!Display.getDefault().readAndDispatch()) { Display.getDefault().timerExec(100, () -> { }); Display.getDefault().sleep(); } try { mounted = Boolean.TRUE.equals(browser.evaluate("return document.getElementById('root').childElementCount > 0;")) && messages.stream().anyMatch(message -> message.contains(kind.equals("tasks") ? "tasksReady" : "ready")); } catch (RuntimeException ex) { } }
                    assertTrue(kind + " packaged panel did not mount", mounted); assertTrue(messages.stream().anyMatch(message -> message.contains(kind.equals("tasks") ? "tasksReady" : "ready"))); assertTrue(messages.stream().noneMatch(message -> message.contains("webviewError")));
                    assertEquals(Boolean.TRUE, browser.evaluate("return (() => { try { acquireVsCodeApi(); return false; } catch { return true; } })();"));
                } finally { function.dispose(); browser.dispose(); shell.dispose(); }
            }
        } finally { try (var paths = Files.walk(assets)) { for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(path); } }
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
            JsonObject manifest = Json.parse(Files.readString(directory.resolve("portable/modules.json"))).getAsJsonObject();
            boolean hasDeferred = false;
            for (JsonElement value : manifest.getAsJsonArray("modules")) {
                JsonObject module = value.getAsJsonObject(); String name = module.get("path").getAsString();
                assertTrue(name.startsWith("/assets/portable/"));
                Path asset = directory.resolve("portable").resolve(name.substring("/assets/portable/".length()));
                assertTrue("Missing packaged module " + name, Files.isRegularFile(asset));
                assertEquals(module.get("bytes").getAsLong(), Files.size(asset));
                for (JsonElement imported : module.getAsJsonArray("imports")) hasDeferred |= imported.getAsJsonObject().get("dynamic").getAsBoolean();
            }
            assertTrue("No deferred module in packaged portable graph", hasDeferred);
        } finally { try (var paths = Files.walk(directory)) { for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(path); } }
    }
    @Test public void realWebkitBrowserFunctionExchangesOrderedMessagesAndSavedState() throws Exception {
        Path directory = Files.createTempDirectory("m104-o'connor-browser-"); Path page = directory.resolve("page.html");
        Files.writeString(directory.resolve("main.css"), "body{color:black}");
        Files.writeString(directory.resolve("main.js"), "window.unsubscribe = window.museHost.onMessage(p => window.received = p); const api = acquireVsCodeApi(); window.addEventListener('message', event => window.legacyReceived = event.data); window.initialDraft = api.getState().draft; api.setState({draft:'persisted'}); window.museHost.postMessage({type:'ready'}); window.testReady=true;");
        Files.writeString(page, Assets.html(directory, "en", "chat", Json.object("draft", "SCRIPT_START IS_HTML HAS_STATE SCRIPT_NONCE SCRIPT_URL INITIAL_STATE"), new JsonObject()).replace("const listeners = new Set();", "window.addEventListener(\"error\", event => window.testError = event.message); const listeners = new Set();"));
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
            assertEquals("SCRIPT_START IS_HTML HAS_STATE SCRIPT_NONCE SCRIPT_URL INITIAL_STATE", browser.evaluate("return window.initialDraft;"));
            assertTrue("SWT shared embedded shim did not run: " + browser.evaluate("return window.testError || document.readyState;"), ready); assertEquals(List.of("ready", "ready", "getState", "state", "post"), operations);
            browser.execute("window.__museDeliver({type:'conversationCleared'});");
            while (Display.getDefault().readAndDispatch()) { }
            assertEquals("conversationCleared", browser.evaluate("return window.received.type;"));
            assertEquals("conversationCleared", browser.evaluate("return window.legacyReceived.type;"));
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
