package io.musespark.eclipse.tests;

import static org.junit.Assert.*;
import com.google.gson.*;
import io.musespark.eclipse.*;
import java.io.*;
import org.junit.Test;

public class Mhp13Test {
    @Test public void editorInitiatesMetadataAndAcceptsIndependentRuntimeCapabilities() throws Exception {
        try (MhpPeer peer = new MhpPeer(new Contract(), new ByteArrayInputStream(new byte[0]), new ByteArrayOutputStream(), new MhpPeer.Host() {
            @Override public JsonElement request(String method, JsonObject params, java.util.function.BooleanSupplier cancelled) { fail("No service before initialization"); return JsonNull.INSTANCE; }
            @Override public void panel(JsonObject frame) { fail("No panel before initialization"); }
            @Override public void shutdown() { }
        }, code -> fail(code))) {
            JsonObject metadata = Json.object("host", Json.object("id", "eclipse", "version", "4.38"), "protocolRange", Json.object("minimum", "mhp/1.5.0", "maximumExclusive", "mhp/1.6.0"), "capabilities", new String[] {"lifecycle", "workspace"}, "locale", "de", "theme", Json.object("kind", "dark", "tokens", new JsonObject()), "folders", new JsonArray(), "trusted", false);
            var future = peer.initialize(metadata);
            assertFalse(future.isDone());
            assertThrows(IllegalStateException.class, () -> peer.initialize(metadata));
            assertThrows(IllegalArgumentException.class, () -> peer.accept(Json.object("jsonrpc", "2.0", "id", "eclipse-init", "result", Json.object("protocolVersion", "mhp/1.1.0", "capabilities", new String[] {"lifecycle"})).toString()));
            assertFalse(future.isDone());
            assertThrows(IllegalArgumentException.class, () -> peer.accept(Json.object("jsonrpc", "2.0", "id", "eclipse-init", "result", Json.object("protocolVersion", "mhp/1.2.0", "capabilities", new String[] {"lifecycle", "settings", "storage"})).toString()));
            assertFalse(future.isDone());
            peer.accept(Json.object("jsonrpc", "2.0", "id", "eclipse-init", "result", Json.object("protocolVersion", "mhp/1.5.0", "capabilities", new String[] {"lifecycle", "settings", "storage"})).toString());
            assertTrue(future.isDone());
            peer.notify("workspace/didGrantTrust", Json.object("trusted", true));
            assertThrows(IllegalStateException.class, () -> peer.notify("documents/didClose", Json.object("uri", "file:///x")));
        }
    }
    @Test public void schemaHonorsArrayMaximumAndNullableType() throws Exception {
        Contract contract = new Contract();
        JsonElement nullable = Json.parse("{\"type\":[\"string\",\"null\"]}");
        contract.validate(nullable, JsonNull.INSTANCE); contract.validate(nullable, new JsonPrimitive("x"));
        assertThrows(IllegalArgumentException.class, () -> contract.validate(nullable, new JsonPrimitive(1)));
        JsonElement bounded = Json.parse("{\"type\":\"array\",\"maxItems\":1}");
        contract.validate(bounded, Json.parse("[1]"));
        assertThrows(IllegalArgumentException.class, () -> contract.validate(bounded, Json.parse("[1,2]")));
    }
}
