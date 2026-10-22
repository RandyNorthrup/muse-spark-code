package io.musespark.eclipse.tests;

import static org.junit.Assert.*;
import com.google.gson.*;
import io.musespark.eclipse.*;
import org.junit.Test;

public class ContractTest {
    @Test public void strictJsonRejectsDuplicatesBatchesAndTrailingObjects() throws Exception {
        Contract contract = new Contract();
        for (String source : new String[] {"{\"method\":\"shutdown\",\"method\":\"initialize\"}", "{}{}", "{x:1}", "{\"x\":NaN}", "{\"x\":1,}"}) assertThrows(IllegalArgumentException.class, () -> Json.parse(source));
        assertThrows(IllegalArgumentException.class, () -> contract.call(Json.object("jsonrpc", "2.0", "method", "shutdown", "id", "x", "params", Json.object("extra", true))));
    }
    @Test public void exportedSchemaRejectsInvalidVersionsRangesAndSecrets() throws Exception {
        Contract contract = new Contract();
        JsonObject frame = edit(); contract.call(frame);
        for (String field : new String[] {"expectedVersion", "undoLabel", "edits"}) { JsonObject malformed = frame.deepCopy(); malformed.getAsJsonObject("params").remove(field); assertThrows(IllegalArgumentException.class, () -> contract.call(malformed)); }
        for (Number version : new Number[] {-1, 0.5, 9007199254740992L}) { JsonObject malformed = frame.deepCopy(); malformed.getAsJsonObject("params").addProperty("expectedVersion", version); assertThrows(IllegalArgumentException.class, () -> contract.call(malformed)); }
        JsonObject input = Json.object("jsonrpc", "2.0", "method", "ui/input", "id", "x", "params", Json.object("title", "x", "prompt", "x", "password", true));
        assertThrows(IllegalArgumentException.class, () -> contract.call(input));
        JsonObject terminal = Json.object("jsonrpc", "2.0", "method", "terminal/create", "id", "x", "params", Json.object("cwd", "file:///workspace", "executable", "test", "args", new JsonArray(), "env", Json.object("PRIVATE_API_KEY", "test-only-marker")));
        assertThrows(IllegalArgumentException.class, () -> contract.call(terminal));
        assertThrows(IllegalArgumentException.class, () -> contract.result("auth/github", Json.object("jsonrpc", "2.0", "id", "x", "result", Json.object("authenticated", true, "token", "test-only-marker"))));
    }
    @Test public void recursiveStateAndAllSchemaKeywordsAreEnforced() throws Exception {
        assertThrows(IllegalStateException.class, () -> Contract.verifyVocabulary(Json.parse("{\"type\":\"string\",\"futureKeyword\":true}")));
        Contract contract = new Contract(); contract.state(Json.parse("{\"nested\":[null,true,3,{\"text\":\"x\"}]}"));
        JsonObject frame = Json.object("jsonrpc", "2.0", "id", "x", "method", "initialize", "params", Json.object("host", Json.object("id", "eclipse", "version", "4.38"), "protocolRange", Json.object("minimum", "mhp/1.0.0", "maximumExclusive", "mhp/1.2.0"), "capabilities", new String[] {"lifecycle"}, "locale", "en", "folders", new JsonArray(), "trusted", false, "theme", Json.object("kind", "dark", "tokens", Json.object("--muse-editor-background", "#000000"))));
        contract.call(frame);
        for (String[] capabilities : new String[][] {{}, {"ui"}, {"lifecycle", "lifecycle"}, {"secrets"}}) { JsonObject malformed = frame.deepCopy(); malformed.getAsJsonObject("params").add("capabilities", Json.GSON.toJsonTree(capabilities)); assertThrows(IllegalArgumentException.class, () -> contract.call(malformed)); }
        JsonObject malformed = frame.deepCopy(); malformed.getAsJsonObject("params").getAsJsonObject("theme").add("tokens", Json.object("--vscode-editor-background", "black")); assertThrows(IllegalArgumentException.class, () -> contract.call(malformed));
        assertThrows(IllegalArgumentException.class, () -> contract.validate(Json.parse("{\"type\":\"string\",\"format\":\"uri\"}"), new JsonPrimitive("relative")));
        assertThrows(IllegalArgumentException.class, () -> contract.validate(Json.parse("{\"type\":\"string\",\"maxLength\":1}"), new JsonPrimitive("xx")));
    }
    @Test public void inputAnnotationsAndExclusiveNumericBoundsKeepTheirSemantics() throws Exception {
        Contract contract = new Contract();
        JsonElement rules = Json.parse("{\"type\":\"number\",\"readOnly\":true,\"exclusiveMinimum\":0,\"exclusiveMaximum\":2}");
        Contract.verifyVocabulary(rules);
        contract.validate(rules, new JsonPrimitive(1));
        for (Number number : new Number[] {-1, 0, 2, 3}) assertThrows(IllegalArgumentException.class, () -> contract.validate(rules, new JsonPrimitive(number)));
        for (String field : new String[] {"apiKey", "token", "unrelated"}) {
            assertThrows(IllegalArgumentException.class, () -> contract.payload("chat", "toHost", Json.object("type", "ready", field, "fixture-only")));
        }
        contract.state(Json.object("unrelated", Json.object("nested", true)));
    }
    private static JsonObject edit() {
        JsonArray edits = new JsonArray(); edits.add(Json.object("range", Json.object("start", Json.object("line", 0, "character", 0), "end", Json.object("line", 0, "character", 0)), "newText", "x"));
        return Json.object("jsonrpc", "2.0", "id", "x", "method", "documents/applyEdits", "params", Json.object("uri", "file:///workspace/file.txt", "expectedVersion", 1, "undoLabel", "test", "edits", edits));
    }
}
