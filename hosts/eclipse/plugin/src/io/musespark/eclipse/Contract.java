package io.musespark.eclipse;

import com.google.gson.*;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.util.*;
import java.util.regex.Pattern;

/** Validates the closed JSON Schema vocabulary exported by lane 0, without translating wire shapes. */
public final class Contract {
    private final JsonObject schema;
    public final int selectionCap;
    public final int chunkBytes;
    public final int frameCap;
    public final int queueBytes;
    public final int queueMessages;
    public Contract() throws IOException {
        JsonObject config = Json.resource("/target/assets/config.json").getAsJsonObject();
        selectionCap = config.get("selectionChars").getAsInt(); chunkBytes = config.get("chunkBytes").getAsInt();
        schema = Json.resource("/target/assets/mhp.json").getAsJsonObject();
        JsonObject limits = schema.getAsJsonObject("panel").getAsJsonObject("limits");
        for (JsonElement definition : schema.getAsJsonObject("methods").asMap().values()) {
            verifyVocabulary(definition.getAsJsonObject().get("call"));
            if (definition.getAsJsonObject().has("result")) verifyVocabulary(definition.getAsJsonObject().get("result"));
        }
        verifyVocabulary(schema.get("failure"));
        for (String kind : List.of("envelope", "binding", "lifecycle", "error", "stateRequest", "queueBudget")) verifyVocabulary(schema.getAsJsonObject("panel").get(kind));
        verifyVocabulary(schema.getAsJsonObject("embeddedBridge").getAsJsonObject("setState").get("state"));
        frameCap = limits.get("maximumEnvelopeBytes").getAsInt();
        queueBytes = limits.get("maximumQueuedBytes").getAsInt();
        queueMessages = limits.get("maximumQueuedMessages").getAsInt();
    }
    public static void verifyVocabulary(JsonElement specification) {
        if (specification.isJsonPrimitive()) return;
        JsonObject node = specification.getAsJsonObject();
        Set<String> supported = Set.of("$schema", "$defs", "$ref", "type", "properties", "required", "additionalProperties", "propertyNames", "items", "minItems", "maxItems", "uniqueItems", "contains", "const", "enum", "anyOf", "oneOf", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "readOnly", "minLength", "maxLength", "pattern", "format", "not");
        for (String key : node.keySet()) if (!supported.contains(key)) throw new IllegalStateException("MHP_SCHEMA_UNSUPPORTED");
        for (String key : List.of("properties", "$defs")) if (node.has(key)) for (JsonElement child : node.getAsJsonObject(key).asMap().values()) verifyVocabulary(child);
        for (String key : List.of("anyOf", "oneOf")) if (node.has(key)) for (JsonElement child : node.getAsJsonArray(key)) verifyVocabulary(child);
        for (String key : List.of("additionalProperties", "propertyNames", "items", "contains", "not")) if (node.has(key)) verifyVocabulary(node.get(key));
    }
    public JsonObject method(String name) {
        JsonElement value = schema.getAsJsonObject("methods").get(name);
        if (value == null) throw new IllegalArgumentException("MHP_METHOD_NOT_FOUND");
        return value.getAsJsonObject();
    }
    public void call(JsonObject value) { validate(method(value.get("method").getAsString()).get("call"), value); }
    public void result(String method, JsonObject value) { validate(method(method).get("result"), value); }
    public void panel(String kind, JsonElement value) { validate(schema.getAsJsonObject("panel").get(kind), value); }
    public void failure(JsonObject value) { validate(schema.get("failure"), value); }
    public void state(JsonElement value) { validate(schema.getAsJsonObject("embeddedBridge").getAsJsonObject("setState").get("state"), value); }
    public void payload(String kind, String direction, JsonElement value) {
        JsonObject envelope = schema.getAsJsonObject("panel").getAsJsonObject("envelope");
        int index = direction.equals("toHost") ? 0 : 1;
        JsonElement union = envelope.getAsJsonArray("oneOf").get(index).getAsJsonObject().getAsJsonObject("properties").get("payload");
        JsonArray choices = union.getAsJsonObject().getAsJsonArray("anyOf");
        int branch = kind.equals("tasks") ? 1 : kind.equals("whatsNew") ? 2 : 0;
        if (branch >= choices.size()) throw new IllegalArgumentException("MHP_PANEL_INVALID_PAYLOAD");
        validate(choices.get(branch), value);
    }
    public void validate(JsonElement specification, JsonElement value) {
        if (!matches(specification, specification, value, 0)) throw new IllegalArgumentException("MHP_INVALID_REQUEST");
    }
    private boolean matches(JsonElement node, JsonElement root, JsonElement value, int depth) {
        if (depth > 100) return false;
        if (node.isJsonPrimitive()) return node.getAsBoolean();
        JsonObject rule = node.getAsJsonObject();
        if (rule.has("$ref")) {
            JsonElement target = root;
            String reference = rule.get("$ref").getAsString();
            if (!reference.equals("#")) for (String segment : reference.substring(2).split("/")) target = target.getAsJsonObject().get(segment.replace("~1", "/").replace("~0", "~"));
            return matches(target, root, value, depth + 1);
        }
        if (rule.has("not") && matches(rule.get("not"), root, value, depth + 1)) return false;
        for (String union : List.of("anyOf", "oneOf")) if (rule.has(union)) {
            int count = 0;
            for (JsonElement alternative : rule.getAsJsonArray(union)) if (matches(alternative, root, value, depth + 1)) count++;
            if (count == 0 || union.equals("oneOf") && count != 1) return false;
        }
        if (rule.has("const") && !rule.get("const").equals(value)) return false;
        if (rule.has("enum") && !rule.getAsJsonArray("enum").asList().contains(value)) return false;
        if (rule.has("type")) {
            JsonElement types = rule.get("type");
            boolean valid = types.isJsonArray() ? types.getAsJsonArray().asList().stream().anyMatch(type -> hasType(type.getAsString(), value)) : hasType(types.getAsString(), value);
            if (!valid) return false;
        }
        if (value.isJsonObject()) {
            JsonObject object = value.getAsJsonObject();
            if (rule.has("required")) for (JsonElement key : rule.getAsJsonArray("required")) if (!object.has(key.getAsString())) return false;
            JsonObject properties = rule.has("properties") ? rule.getAsJsonObject("properties") : new JsonObject();
            for (Map.Entry<String, JsonElement> entry : object.entrySet()) {
                if (rule.has("propertyNames") && !matches(rule.get("propertyNames"), root, new JsonPrimitive(entry.getKey()), depth + 1)) return false;
                JsonElement child = properties.get(entry.getKey());
                if (child == null) child = rule.get("additionalProperties");
                if (child != null && !matches(child, root, entry.getValue(), depth + 1)) return false;
            }
        }
        if (value.isJsonArray()) {
            JsonArray array = value.getAsJsonArray();
            if (rule.has("maxItems") && array.size() > rule.get("maxItems").getAsInt()) return false;
            if (rule.has("minItems") && array.size() < rule.get("minItems").getAsInt()) return false;
            if (rule.has("uniqueItems") && rule.get("uniqueItems").getAsBoolean() && new HashSet<>(array.asList()).size() != array.size()) return false;
            boolean contains = !rule.has("contains");
            for (JsonElement child : array) {
                if (rule.has("items") && !matches(rule.get("items"), root, child, depth + 1)) return false;
                if (rule.has("contains") && matches(rule.get("contains"), root, child, depth + 1)) contains = true;
            }
            if (!contains) return false;
        }
        if (value.isJsonPrimitive()) {
            JsonPrimitive primitive = value.getAsJsonPrimitive();
            if (primitive.isString()) {
                String text = primitive.getAsString();
                if (rule.has("minLength") && text.length() < rule.get("minLength").getAsInt() || rule.has("maxLength") && text.length() > rule.get("maxLength").getAsInt()) return false;
                if (rule.has("pattern") && !Pattern.compile(rule.get("pattern").getAsString()).matcher(text).find()) return false;
                if (rule.has("format")) {
                    try { if (!new URI(text).isAbsolute()) return false; } catch (java.net.URISyntaxException ex) { return false; }
                }
            }
            if (primitive.isNumber()) {
                BigDecimal number = primitive.getAsBigDecimal();
                if (rule.has("minimum") && number.compareTo(rule.get("minimum").getAsBigDecimal()) < 0 || rule.has("maximum") && number.compareTo(rule.get("maximum").getAsBigDecimal()) > 0) return false;
                if (rule.has("exclusiveMinimum") && number.compareTo(rule.get("exclusiveMinimum").getAsBigDecimal()) <= 0 || rule.has("exclusiveMaximum") && number.compareTo(rule.get("exclusiveMaximum").getAsBigDecimal()) >= 0) return false;
            }
        }
        return true;
    }
    private static boolean hasType(String type, JsonElement value) {
        return switch (type) {
            case "object" -> value.isJsonObject();
            case "array" -> value.isJsonArray();
            case "null" -> value.isJsonNull();
            case "string" -> value.isJsonPrimitive() && value.getAsJsonPrimitive().isString();
            case "boolean" -> value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean();
            case "number", "integer" -> value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber() && (!type.equals("integer") || value.getAsBigDecimal().stripTrailingZeros().scale() <= 0);
            default -> throw new IllegalStateException("MHP_SCHEMA_UNSUPPORTED");
        };
    }

}
