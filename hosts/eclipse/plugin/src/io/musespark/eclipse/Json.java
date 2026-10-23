package io.musespark.eclipse;

import com.google.gson.*;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Strict JSON boundary: no duplicate members, batches or lenient syntax. */
public final class Json {
    public static final Gson GSON = new Gson();
    private Json() { }
    public static JsonObject object(Object... pairs) {
        JsonObject result = new JsonObject();
        for (int i = 0; i < pairs.length; i += 2) { if (!(pairs[i] instanceof String key)) throw new IllegalArgumentException("MHP_INVALID_REQUEST"); result.add(key, GSON.toJsonTree(pairs[i + 1])); }
        return result;
    }
    public static JsonElement parse(String source) {
        try (JsonReader reader = new JsonReader(new StringReader(source))) {
            reader.setStrictness(Strictness.STRICT);
            JsonElement value = read(reader, 0);
            if (reader.peek() != JsonToken.END_DOCUMENT) throw new IllegalArgumentException("MHP_INVALID_REQUEST");
            return value;
        } catch (IOException | IllegalStateException ex) {
            throw new IllegalArgumentException("MHP_INVALID_REQUEST");
        }
    }
    private static JsonElement read(JsonReader reader, int depth) throws IOException {
        if (depth > 100) throw new IllegalArgumentException("MHP_INVALID_REQUEST");
        return switch (reader.peek()) {
            case BEGIN_OBJECT -> {
                JsonObject object = new JsonObject();
                reader.beginObject();
                while (reader.hasNext()) {
                    String key = reader.nextName();
                    if (object.has(key)) throw new IllegalArgumentException("MHP_INVALID_REQUEST");
                    object.add(key, read(reader, depth + 1));
                }
                reader.endObject();
                yield object;
            }
            case BEGIN_ARRAY -> {
                JsonArray array = new JsonArray();
                reader.beginArray();
                while (reader.hasNext()) array.add(read(reader, depth + 1));
                reader.endArray();
                yield array;
            }
            case STRING -> new JsonPrimitive(reader.nextString());
            case NUMBER -> new JsonPrimitive(new java.math.BigDecimal(reader.nextString()));
            case BOOLEAN -> new JsonPrimitive(reader.nextBoolean());
            case NULL -> { reader.nextNull(); yield JsonNull.INSTANCE; }
            default -> throw new IllegalArgumentException("MHP_INVALID_REQUEST");
        };
    }
    public static JsonElement resource(String path) throws IOException {
        try (InputStream stream = Json.class.getResourceAsStream(path)) {
            if (stream == null) throw new IOException("MHP_RESOURCE_MISSING");
            return parse(new String(stream.readAllBytes(), StandardCharsets.UTF_8));
        }
    }
}
