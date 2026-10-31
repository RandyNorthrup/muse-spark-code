package io.musespark.eclipse;

import com.google.gson.*;
import java.io.*;
import java.nio.file.*;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.nio.charset.StandardCharsets;

/** Asset-only file document: no listening socket and no remote content. */
public final class Assets {
    public interface HtmlPort {
        boolean supports(String protocol, String capability);
        CompletableFuture<JsonObject> render(JsonObject params);
    }
    private record Page(String nonce, String css, String script, String bootstrap, String csp, String document) { }
    private Assets() { }
    public static String locale(String requested) throws IOException {
        JsonArray languages = Json.resource("/target/assets/config.json").getAsJsonObject().getAsJsonArray("languages");
        String normalized = requested.toLowerCase(Locale.ROOT).replace('_', '-');
        if (languages.asList().contains(new JsonPrimitive(normalized))) return normalized;
        String base = normalized.split("-")[0];
        return languages.asList().contains(new JsonPrimitive(base)) ? base : "en";
    }
    public static JsonObject table(String requested) throws IOException { return Json.resource("/target/l10n/ui." + locale(requested) + ".json").getAsJsonObject(); }
    public static String scriptSafe(String value) { return value.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"); }
    public static String html(Path assets, String locale, String kind, JsonElement state, JsonObject tokens) throws IOException {
        if (kind.equals("whatsNew")) throw new IllegalArgumentException("MHP_CAPABILITY_UNAVAILABLE");
        return page(assets, locale, kind, state, tokens).document;
    }
    private static Page page(Path assets, String locale, String kind, JsonElement state, JsonObject tokens) throws IOException {
        byte[] random = new byte[Json.resource("/target/assets/config.json").getAsJsonObject().get("nonceBytes").getAsInt()]; new SecureRandom().nextBytes(random);
        String nonce = Base64.getUrlEncoder().withoutPadding().encodeToString(random);
        locale = locale(locale); JsonElement table = table(locale);
        String css = assets.resolve(kind.equals("whatsNew") ? "whatsNew.css" : "main.css").toUri().toASCIIString();
        String script = assets.resolve(kind.equals("whatsNew") ? "whatsNew.js" : "main.js").toUri().toASCIIString();
        String bootstrap = """
            (() => {
              const listeners = new Set(); let started = false; let saved = INITIAL_STATE; let hasState = HAS_STATE;
              const encode = (value) => {
                const ancestors = new Set();
                const check = (item) => {
                  if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
                  if (typeof item === 'number' && Number.isFinite(item)) return;
                  if (typeof item !== 'object' || ancestors.has(item)) throw new TypeError('MHP_INVALID_STATE');
                  const prototype = Object.getPrototypeOf(item);
                  if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) throw new TypeError('MHP_INVALID_STATE');
                  if (Reflect.ownKeys(item).some(key => typeof key !== 'string')) throw new TypeError('MHP_INVALID_STATE');
                  ancestors.add(item);
                  for (const child of Array.isArray(item) ? item : Object.values(item)) check(child);
                  ancestors.delete(item);
                };
                check(value); return JSON.stringify(value);
              };
              window.__museDeliver = (payload) => { for (const listener of [...listeners]) listener(payload); };
              const invoke = (operation, value) => { const error = museNative(operation, encode(value)); if (error) throw new Error(error); };
              window.__museStart = () => {
                if (started) return;
                if (typeof museNative !== 'function') throw new Error('MHP_BRIDGE_NOT_READY');
                started = true; SCRIPT_START
              };
              window.museHost = Object.freeze({
                postMessage(payload) { invoke('post', payload); },
                onMessage(listener) { if (typeof listener !== 'function') throw new TypeError('MHP_INVALID_REQUEST'); listeners.add(listener); if (started && !IS_HTML) invoke('ready', null); return () => listeners.delete(listener); },
                getState() { const fresh = museNative('getState', 'null'); if (fresh) { const state = JSON.parse(fresh); saved = state.value; hasState = state.present; } return hasState ? JSON.parse(JSON.stringify(saved)) : undefined; },
                setState(state) { invoke('state', state); saved = JSON.parse(encode(state)); hasState = true; }
              });
              let acquired = false;
              window.acquireVsCodeApi = () => {
                if (acquired) throw new Error('MHP_API_ALREADY_ACQUIRED'); acquired = true;
                window.museHost.onMessage(payload => window.dispatchEvent(new MessageEvent('message', {data: payload})));
                return window.museHost;
              };
            })();
            """.replace("SCRIPT_START", "const script = document.createElement('script'); script.type = 'module'; script.nonce = 'SCRIPT_NONCE'; script.src = SCRIPT_URL; " + (kind.equals("whatsNew") ? "script.onload = () => invoke('ready', null); " : "") + "document.body.append(script);").replace("IS_HTML", kind.equals("whatsNew") ? "true" : "false").replace("HAS_STATE", state == null ? "false" : "true").replace("SCRIPT_NONCE", nonce).replace("SCRIPT_URL", scriptSafe(Json.GSON.toJson(script))).replace("INITIAL_STATE", state == null ? "null" : scriptSafe(state.toString()));
        StringBuilder style = new StringBuilder(":root{");
        for (Map.Entry<String, JsonElement> token : tokens.entrySet()) {
            if (!token.getKey().matches("--muse-[A-Za-z][\\w-]*") || !token.getValue().getAsString().matches("#[0-9a-fA-F]{6}")) throw new IllegalArgumentException("MHP_INVALID_THEME");
            style.append(token.getKey()).append(':').append(token.getValue().getAsString()).append(';');
        }
        style.append('}');
        String document = "<!DOCTYPE html><html lang=\"" + locale + "\"><head><meta charset=\"UTF-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src file: data:; font-src file:; style-src file: 'nonce-" + nonce + "'; script-src 'nonce-" + nonce + "'; connect-src swt://browserfunction; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><link rel=\"stylesheet\" href=\"" + css + "\"><style nonce=\"" + nonce + "\">" + style + "</style></head><body data-host=\"embedded\" data-surface=\"" + kind + "\"><div id=\"root\"></div><script id=\"muse-l10n\" type=\"application/json\">" + scriptSafe(Json.object("locale", locale, "table", table).toString()) + "</script><script nonce=\"" + nonce + "\">" + bootstrap + "</script></body></html>";
        int cspStart = document.indexOf("<meta http-equiv="); int cspEnd = document.indexOf("<meta name=\"viewport\"");
        return new Page(nonce, css, script, bootstrap, document.substring(cspStart, cspEnd), document);
    }
    public static boolean hasHtmlPort(HtmlPort port) { return port != null && port.supports("mhp/1.5.0", "surfaceHtml"); }
    public static CompletableFuture<String> renderedHtml(Contract contract, HtmlPort port, Path assets, String locale, JsonElement state, JsonObject theme, String surface, String session) throws IOException {
        if (!hasHtmlPort(port)) throw new IllegalArgumentException("MHP_CAPABILITY_UNAVAILABLE");
        Page page = page(assets, locale, "whatsNew", state, theme.getAsJsonObject("tokens"));
        JsonObject params = Json.object("surfaceId", surface, "sessionId", session, "surfaceKind", "whatsNew", "locale", locale(locale), "nonce", page.nonce, "styleUri", page.css, "scriptUri", page.script, "theme", theme);
        CompletableFuture<JsonObject> pending = port.render(params);
        if (pending == null) throw new IllegalArgumentException("MHP_INVALID_REQUEST");
        return pending.thenApply(result -> {
            if (result == null) throw new IllegalArgumentException("MHP_INVALID_REQUEST");
            contract.validate(Json.object("type", "object", "properties", Json.object("html", Json.object("type", "string", "minLength", 1)), "required", new String[] {"html"}, "additionalProperties", false), result);
            String html = result.get("html").getAsString(); int head = html.indexOf("<head>");
            if (html.getBytes(StandardCharsets.UTF_8).length > contract.frameCap || head < 0 || !html.substring(0, head).matches("(?is)\\s*<!doctype html>\\s*<html(?:\\s[^<>]*)?>\\s*") || !html.trim().endsWith("</html>")) throw new IllegalArgumentException("MHP_INVALID_HTML");
            String scriptUri = page.script.replace("&", "&amp;").replace("\"", "&quot;").replace("'", "&#39;");
            String allowedScript = "<script nonce=\"" + page.nonce + "\" src=\"" + scriptUri + "\"></script>";
            java.util.regex.Matcher scripts = java.util.regex.Pattern.compile("(?i)<script\\b").matcher(html); int count = 0;
            while (scripts.find()) { if (!html.startsWith(allowedScript, scripts.start())) throw new IllegalArgumentException("MHP_INVALID_HTML"); count++; }
            if (count != 1) throw new IllegalArgumentException("MHP_INVALID_HTML");
            // The native policy is installed first; the shared renderer's VS Code CSP cannot allow SWT's private bridge.
            html = html.replace(allowedScript, "");
            html = html.replaceAll("<meta http-equiv=\"Content-Security-Policy\"[^>]*>", "");
            return html.replace("<head>", "<head><meta charset=\"UTF-8\">" + page.csp + "<script nonce=\"" + page.nonce + "\">" + page.bootstrap + "</script>");
        });
    }
    public static Path extract(org.osgi.framework.Bundle bundle, Path destination) throws IOException {
        Files.createDirectories(destination);
        String prefix = "/target/assets/webview/";
        Enumeration<java.net.URL> entries = bundle.findEntries("target/assets/webview", "*", true);
        if (entries == null) throw new IOException("MHP_RESOURCE_MISSING");
        while (entries.hasMoreElements()) {
            java.net.URL entry = entries.nextElement();
            String path = entry.getPath();
            if (!path.startsWith(prefix) || path.endsWith("/")) continue;
            Path target = destination.resolve(path.substring(prefix.length())).normalize();
            if (!target.startsWith(destination.normalize())) throw new IOException("MHP_RESOURCE_INVALID");
            Files.createDirectories(target.getParent());
            try (InputStream input = entry.openStream()) { Files.copy(input, target, StandardCopyOption.REPLACE_EXISTING); }
        }
        return destination;
    }
    public static boolean navigationAllowed(Path page, String target) {
        try { java.net.URI uri = java.net.URI.create(target); return uri.getScheme().equals("file") && Paths.get(new java.net.URI(uri.getScheme(), uri.getAuthority(), uri.getPath(), null, null)).normalize().equals(page.toAbsolutePath().normalize()); }
        catch (RuntimeException | java.net.URISyntaxException ex) { return false; }
    }
    public static Map<String, String> environment(Map<String, String> source) {
        Map<String, String> result = new HashMap<>(source);
        Set<String> named = new HashSet<>();
        try { Json.resource("/target/assets/config.json").getAsJsonObject().getAsJsonArray("credentialNames").forEach(name -> named.add(name.getAsString())); }
        catch (IOException ex) { throw new IllegalStateException("MHP_RESOURCE_MISSING"); }
        result.keySet().removeIf(key -> key.toUpperCase(Locale.ROOT).endsWith("_API_KEY") || named.contains(key.toUpperCase(Locale.ROOT)));
        return result;
    }
}
