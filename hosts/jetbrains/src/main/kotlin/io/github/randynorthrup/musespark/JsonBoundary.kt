package io.github.randynorthrup.musespark

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonPrimitive
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonToken
import java.io.StringReader
import java.net.URI

/** Validates the keywords used by the frozen export, failing closed on new keywords. */
class JsonBoundary {
  private val contract = parse(resource("/mhp/mhp-v1.1.schema.json")).asJsonObject
  val methods: JsonObject = contract.getAsJsonObject("methods").deepCopy()

  val panel: JsonObject = contract.getAsJsonObject("panel")
  private val bridge = contract.getAsJsonObject("embeddedBridge")
  val maximumFrameBytes = panel.getAsJsonObject("limits")["maximumEnvelopeBytes"].asInt
  val maximumQueuedBytes = panel.getAsJsonObject("limits")["maximumQueuedBytes"].asInt
  val maximumQueuedMessages = panel.getAsJsonObject("limits")["maximumQueuedMessages"].asInt

  fun validate(
    schema: JsonElement,
    value: JsonElement,
  ) {
    require(schemaMatches(schema, value, schema)) { "MHP_INVALID_PARAMS" }
  }

  fun call(frame: JsonObject): JsonObject {
    val method = frame["method"]?.asString ?: error("MHP_INVALID_REQUEST")
    val definition = methods[method]?.asJsonObject ?: error("MHP_METHOD_NOT_FOUND")
    validate(definition["call"], frame)
    return definition
  }

  fun result(
    method: String,
    frame: JsonObject,
  ) = validate(methods.getAsJsonObject(method)["result"], frame)

  fun errorCode(name: String): Int = contract.getAsJsonObject("errorCodes")[name].asInt

  fun failure(frame: JsonObject) = validate(contract["failure"], frame)

  fun state(value: JsonElement) = validate(bridge.getAsJsonObject("setState")["state"], value)

  fun payload(
    kind: String,
    direction: String,
    value: JsonElement,
  ) {
    val envelope = panel.getAsJsonObject("envelope")
    val branch =
      envelope
        .getAsJsonArray("oneOf")
        .first {
          it.asJsonObject
            .getAsJsonObject("properties")
            .getAsJsonObject("direction")["const"]
            .asString == direction
        }.asJsonObject
        .getAsJsonObject("properties")["payload"]
        .asJsonObject
    val branches = branch.getAsJsonArray("anyOf")
    val index =
      when (kind) {
        "tasks" -> 1
        "whatsNew" -> 2
        else -> 0
      }
    require(index < branches.size()) { "MHP_PANEL_INVALID_PAYLOAD" }
    validate(branches[index], value)
  }

  companion object {
    private const val MAXIMUM_JSON_DEPTH = 128

    fun resource(path: String): String =
      requireNotNull(JsonBoundary::class.java.getResourceAsStream(path)).use {
        it.readBytes().toString(Charsets.UTF_8)
      }

    /** Gson's tree parser accepts duplicate keys; read explicitly to refuse them. */
    fun parse(text: String): JsonElement =
      JsonReader(StringReader(text)).use { reader ->
        val value = read(reader, 0)
        require(reader.peek() == JsonToken.END_DOCUMENT) { "MHP_INVALID_REQUEST" }
        value
      }

    private fun read(
      reader: JsonReader,
      depth: Int,
    ): JsonElement {
      require(depth <= MAXIMUM_JSON_DEPTH) { "MHP_INVALID_REQUEST" }
      return when (reader.peek()) {
        JsonToken.BEGIN_OBJECT -> {
          val result = JsonObject()
          reader.beginObject()
          while (reader.hasNext()) {
            val name = reader.nextName()
            require(!result.has(name)) { "MHP_INVALID_REQUEST" }
            result.add(name, read(reader, depth + 1))
          }
          reader.endObject()
          result
        }
        JsonToken.BEGIN_ARRAY -> {
          val result = JsonArray()
          reader.beginArray()
          while (reader.hasNext()) result.add(read(reader, depth + 1))
          reader.endArray()
          result
        }
        JsonToken.STRING -> JsonPrimitive(reader.nextString())
        JsonToken.NUMBER -> JsonPrimitive(reader.nextString().toBigDecimal())
        JsonToken.BOOLEAN -> JsonPrimitive(reader.nextBoolean())
        JsonToken.NULL -> {
          reader.nextNull()
          JsonNull.INSTANCE
        }
        else -> error("MHP_INVALID_REQUEST")
      }
    }
  }
}

fun json(vararg fields: Pair<String, Any?>): JsonObject =
  JsonObject().also { result ->
    for ((key, value) in fields) result.add(key, jsonValue(value))
  }

fun jsonValue(value: Any?): JsonElement =
  when (value) {
    null -> JsonNull.INSTANCE
    is JsonElement -> value
    is String -> JsonPrimitive(value)
    is Boolean -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value)
    is Iterable<*> -> JsonArray().also { array -> value.forEach { array.add(jsonValue(it)) } }
    else -> error("MHP_INVALID_PARAMS")
  }

private val SCHEMA_KEYWORDS =
  setOf(
    "\$schema",
    "type",
    "properties",
    "required",
    "additionalProperties",
    "const",
    "pattern",
    "items",
    "uniqueItems",
    "contains",
    "enum",
    "propertyNames",
    "format",
    "anyOf",
    "minLength",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "readOnly",
    "minItems",
    "maxItems",
    "maxLength",
    "\$defs",
    "\$ref",
    "oneOf",
  )

private fun schemaMatches(
  schema: JsonElement,
  value: JsonElement,
  root: JsonElement,
): Boolean {
  if (schema.isJsonPrimitive) return schema.asBoolean
  val rule = schema.asJsonObject
  require(rule.keySet().all { it in SCHEMA_KEYWORDS }) { "MHP_SCHEMA_KEYWORD_UNSUPPORTED" }
  return schemaStructure(rule, value, root) &&
    when {
      value.isJsonObject -> schemaObject(rule, value.asJsonObject, root)
      value.isJsonArray -> schemaArray(rule, value.asJsonArray, root)
      value.isJsonPrimitive && value.asJsonPrimitive.isString -> schemaString(rule, value.asString)
      value.isJsonPrimitive && value.asJsonPrimitive.isNumber -> schemaNumber(rule, value)
      else -> true
    }
}

private fun schemaStructure(
  rule: JsonObject,
  value: JsonElement,
  root: JsonElement,
): Boolean {
  val refMatches = rule["\$ref"]?.let { schemaReference(it.asString, value, root) } ?: true
  val constant = rule["const"]?.let { value == it } ?: true
  val enumeration = rule["enum"]?.let { value in it.asJsonArray } ?: true
  val union = rule["anyOf"]?.let { it.asJsonArray.any { child -> schemaMatches(child, value, root) } } ?: true
  val exclusive =
    rule["oneOf"]?.let { it.asJsonArray.count { child -> schemaMatches(child, value, root) } == 1 } ?: true
  val type =
    rule["type"]?.let { types ->
      if (types.isJsonArray) types.asJsonArray.any { hasType(it.asString, value) } else hasType(types.asString, value)
    } ?: true
  return listOf(refMatches, constant, enumeration, union, exclusive, type).all { it }
}

private fun schemaReference(
  reference: String,
  value: JsonElement,
  root: JsonElement,
): Boolean {
  require(reference == "#" || reference.startsWith("#/")) { "MHP_SCHEMA_REFERENCE_UNSUPPORTED" }
  val target =
    if (reference == "#") {
      root
    } else {
      reference.drop(2).split('/').fold(root) { node, key ->
        node.asJsonObject[key.replace("~1", "/").replace("~0", "~")]
      }
    }
  return schemaMatches(target, value, root)
}

private fun schemaObject(
  rule: JsonObject,
  value: JsonObject,
  root: JsonElement,
): Boolean {
  val properties = rule["properties"]?.asJsonObject ?: JsonObject()
  val required = rule["required"]?.let { it.asJsonArray.all { key -> value.has(key.asString) } } ?: true
  return required &&
    value.entrySet().all { (key, item) ->
      val name = rule["propertyNames"]?.let { schemaMatches(it, JsonPrimitive(key), root) } ?: true
      val child = properties[key] ?: rule["additionalProperties"]
      name && (child == null || schemaMatches(child, item, root))
    }
}

private fun schemaArray(
  rule: JsonObject,
  value: JsonArray,
  root: JsonElement,
): Boolean {
  val count = rule["minItems"]?.let { value.size() >= it.asInt } ?: true
  val maximum = rule["maxItems"]?.let { value.size() <= it.asInt } ?: true
  val unique = rule["uniqueItems"]?.let { !it.asBoolean || value.toSet().size == value.size() } ?: true
  val contains = rule["contains"]?.let { value.any { child -> schemaMatches(it, child, root) } } ?: true
  val items = rule["items"]?.let { value.all { child -> schemaMatches(it, child, root) } } ?: true
  return listOf(count, maximum, unique, contains, items).all { it }
}

private fun schemaString(
  rule: JsonObject,
  text: String,
): Boolean {
  val minimum = rule["minLength"]?.let { text.length >= it.asInt } ?: true
  val maximum = rule["maxLength"]?.let { text.length <= it.asInt } ?: true
  val pattern = rule["pattern"]?.let { Regex(it.asString).containsMatchIn(text) } ?: true
  val format =
    rule["format"]?.let {
      require(it.asString == "uri") { "MHP_SCHEMA_FORMAT_UNSUPPORTED" }
      runCatching { URI(text).isAbsolute }.getOrDefault(false)
    } ?: true
  return listOf(minimum, maximum, pattern, format).all { it }
}

private fun schemaNumber(
  rule: JsonObject,
  value: JsonElement,
): Boolean {
  val number = value.asBigDecimal
  val minimum = rule["minimum"]?.let { number >= it.asBigDecimal } ?: true
  val maximum = rule["maximum"]?.let { number <= it.asBigDecimal } ?: true
  val exclusiveMinimum = rule["exclusiveMinimum"]?.let { number > it.asBigDecimal } ?: true
  val exclusiveMaximum = rule["exclusiveMaximum"]?.let { number < it.asBigDecimal } ?: true
  return minimum && maximum && exclusiveMinimum && exclusiveMaximum
}

private fun hasType(
  type: String,
  value: JsonElement,
): Boolean =
  when (type) {
    "object" -> value.isJsonObject
    "array" -> value.isJsonArray
    "null" -> value.isJsonNull
    "string" -> value.isJsonPrimitive && value.asJsonPrimitive.isString
    "boolean" -> value.isJsonPrimitive && value.asJsonPrimitive.isBoolean
    "number" -> value.isJsonPrimitive && value.asJsonPrimitive.isNumber
    "integer" ->
      value.isJsonPrimitive && value.asJsonPrimitive.isNumber &&
        value.asBigDecimal.stripTrailingZeros().scale() <= 0
    else -> error("MHP_SCHEMA_TYPE_UNSUPPORTED")
  }
