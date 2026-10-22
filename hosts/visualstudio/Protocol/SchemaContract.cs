using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Protocol
{
  // Validate the committed export itself: no hand-maintained copy of wire types.
  public sealed class SchemaContract
  {
    public const int MaximumFrameBytes = 16777216;
    public const int MaximumJsonDepth = 64;
    private static readonly TimeSpan PatternTimeout = TimeSpan.FromSeconds(1);
    private static readonly Lazy<SchemaContract> Installed = new Lazy<SchemaContract>(() => ReadInstalled(false));
    private static readonly Lazy<SchemaContract> InstalledPanel = new Lazy<SchemaContract>(() => ReadInstalled(true));
    public JObject Export { get; }
    public string Version => Export.Value<string>("protocol") ?? throw Invalid();
    public JObject Methods => Export["methods"] as JObject ?? throw Invalid();

    public SchemaContract(JObject export) { Export = export; }

    public static SchemaContract Load(bool panel = false) => (panel ? InstalledPanel : Installed).Value;
    private static SchemaContract ReadInstalled(bool panel)
    {
      var assembly = Assembly.GetExecutingAssembly();
      var name = assembly.GetManifestResourceNames().Single(n => n.EndsWith(panel ? "mhp-v1.1.schema.json" : "mhp-v1.schema.json", StringComparison.Ordinal));
      using (var stream = assembly.GetManifestResourceStream(name) ?? throw Invalid())
      using (var reader = new StreamReader(stream))
        return new SchemaContract(ParseObject(reader.ReadToEnd()));
    }

    public static JObject ParseObject(string json)
    {
      if (Encoding.UTF8.GetByteCount(json) > MaximumFrameBytes) throw new MhpException("invalidParams", "MHP_PANEL_TOO_LARGE");
      JsonSyntax.Validate(json);
      using (var reader = new JsonTextReader(new StringReader(json)) { MaxDepth = MaximumJsonDepth, DateParseHandling = DateParseHandling.None })
      {
        var token = JToken.Load(reader, new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });
        if (reader.Read() || !(token is JObject obj)) throw Invalid();
        return obj;
      }
    }

    public JObject Method(string method) => Methods[method] as JObject ?? throw new MhpException("methodNotFound", "MHP_METHOD_NOT_FOUND");

    public void ValidateCall(string method, JObject frame) => Validate(frame, Method(method)["call"] ?? throw Invalid());
    public void ValidateResult(string method, JObject frame) => Validate(frame, Method(method)["result"] ?? throw Invalid());
    public void ValidateFailure(JObject frame) => Validate(frame, Export["failure"] ?? throw Invalid());
    public void ValidatePanel(JToken frame, string kind) => Validate(frame, Export["panel"]?[kind] ?? throw Invalid());
    public void ValidatePayload(JToken payload, string direction, string surfaceKind)
    {
      var envelope = Export["panel"]?["envelope"]?["oneOf"] as JArray ?? throw Invalid();
      var rules = envelope.Single(s => s["properties"]?["direction"]?.Value<string>("const") == direction)["properties"]?["payload"] ?? throw Invalid();
      var groups = rules["anyOf"] as JArray ?? throw Invalid();
      // These group positions are the frozen export's shared chat/tasks/news/presentation unions.
      var group = surfaceKind == "tasks" ? 1 : 0;
      if (IsPresentationSurface(surfaceKind)) group = direction == "toHost" ? 3 : 2;
      if (surfaceKind == "whatsNew")
      {
        if (direction != "toHost") throw Invalid();
        group = 2;
      }
      Validate(payload, groups[group]);
    }

    public static bool IsPresentationSurface(string kind) => kind == "plans" || kind == "manager" || kind == "roles" || kind == "traffic" || kind == "diff" || kind == "walkthrough";

    public static void Validate(JToken value, JToken schema)
    {
      try { Check(value, schema, schema); }
      // A keyword of an unexpected JSON type (a cast, a format or a regex timeout) refuses the value; it never escapes as a crash.
      catch (Exception error) when (IsValidationFault(error)) { throw Invalid(); }
    }

    private static bool IsValidationFault(Exception error) => !(error is MhpException) && !(error is OutOfMemoryException) && !(error is System.Threading.ThreadAbortException);

    private static void Check(JToken value, JToken schema, JToken root)
    {
      if (schema.Type == JTokenType.Boolean) { if (!schema.Value<bool>()) throw Invalid(); return; }
      if (!(schema is JObject rules)) throw Invalid();
      var reference = rules.Value<string>("$ref");
      if (reference != null)
      {
        if (reference == "#") { Check(value, root, root); return; }
        if (!reference.StartsWith("#/", StringComparison.Ordinal)) throw Invalid();
        var target = root;
        foreach (var part in reference.Substring(2).Split('/')) target = target[part.Replace("~1", "/").Replace("~0", "~")] ?? throw Invalid();
        Check(value, target, root);
      }
      if (rules["anyOf"] is JArray alternatives && !alternatives.Any(s => Matches(value, s, root))) throw Invalid();
      if (rules["oneOf"] is JArray variants && variants.Count(s => Matches(value, s, root)) != 1) throw Invalid();
      if (rules["const"] is JToken constant && !Equal(value, constant)) throw Invalid();
      if (rules["enum"] is JArray values && !values.Any(v => Equal(value, v))) throw Invalid();
      if (rules["type"] is JToken type && !HasType(value, type)) throw Invalid();
      if (value is JObject obj) CheckObject(obj, rules, root);
      if (value is JArray array) CheckArray(array, rules, root);
      if (value.Type == JTokenType.String)
      {
        var text = value.Value<string>() ?? throw Invalid();
        if (rules["minLength"] != null && text.Length < rules.Value<int>("minLength")) throw Invalid();
        if (rules["maxLength"] != null && text.Length > rules.Value<int>("maxLength")) throw Invalid();
        if (rules.Value<string>("pattern") is string pattern && !Regex.IsMatch(text, pattern, RegexOptions.CultureInvariant | RegexOptions.ECMAScript, PatternTimeout)) throw Invalid();
        if (rules.Value<string>("format") == "uri" && !Uri.TryCreate(text, UriKind.Absolute, out _)) throw Invalid();
      }
      if (value.Type == JTokenType.Integer || value.Type == JTokenType.Float)
      {
        var number = value.Value<double>();
        if (double.IsInfinity(number) || double.IsNaN(number)) throw Invalid();
        if (rules["minimum"] != null && number < rules.Value<double>("minimum")) throw Invalid();
        if (rules["maximum"] != null && number > rules.Value<double>("maximum")) throw Invalid();
        if (rules["exclusiveMinimum"] != null && number <= rules.Value<double>("exclusiveMinimum")) throw Invalid();
        if (rules["exclusiveMaximum"] != null && number >= rules.Value<double>("exclusiveMaximum")) throw Invalid();
      }
    }

    private static void CheckObject(JObject value, JObject rules, JToken root)
    {
      if (rules["required"] is JArray required)
        foreach (var key in required.Values<string>()) if (key == null || value.Property(key, StringComparison.Ordinal) == null) throw Invalid();
      var properties = rules["properties"] as JObject;
      foreach (var property in value.Properties())
      {
        if (rules["propertyNames"] is JToken names) Check(new JValue(property.Name), names, root);
        var definition = properties?[property.Name];
        if (definition != null) Check(property.Value, definition, root);
        else if (rules["additionalProperties"] is JToken extra) Check(property.Value, extra, root);
      }
    }

    private static void CheckArray(JArray value, JObject rules, JToken root)
    {
      if (rules["minItems"] != null && value.Count < rules.Value<int>("minItems")) throw Invalid();
      if (rules["maxItems"] != null && value.Count > rules.Value<int>("maxItems")) throw Invalid();
      if (rules.Value<bool?>("uniqueItems") == true && value.GroupBy(v => v.ToString(Formatting.None), StringComparer.Ordinal).Any(g => g.Count() > 1)) throw Invalid();
      if (rules["contains"] is JToken contains && !value.Any(v => Matches(v, contains, root))) throw Invalid();
      if (rules["items"] is JToken items) foreach (var item in value) Check(item, items, root);
    }

    private static bool Matches(JToken value, JToken schema, JToken root)
    {
      try { Check(value, schema, root); return true; }
      catch (MhpException) { return false; }
      // Any other failure inside one alternative is that alternative's refusal, never the validator's exit.
      catch (Exception error) when (IsValidationFault(error)) { return false; }
    }

    // JSON Schema 2020-12 §6.1.1: `type` is one name or a non-empty array of unique names (the frozen
    // export uses ["string","null"] for ui/input's result and ["string","number","boolean"] for an elicitation default).
    private static bool HasType(JToken value, JToken type)
    {
      if (type.Type == JTokenType.String) return IsType(value, type.Value<string>() ?? throw Invalid());
      if (!(type is JArray names) || names.Count == 0 || names.Any(name => name.Type != JTokenType.String)) throw Invalid();
      var listed = names.Select(name => name.Value<string>() ?? "").ToList();
      // Every member is checked before any is tested, so member order never decides a malformed schema.
      if (listed.Distinct(StringComparer.Ordinal).Count() != listed.Count || !listed.All(TypeNames.Contains)) throw Invalid();
      return listed.Any(name => IsType(value, name));
    }

    private static readonly System.Collections.Generic.HashSet<string> TypeNames = new System.Collections.Generic.HashSet<string>(StringComparer.Ordinal) { "object", "array", "string", "boolean", "null", "integer", "number" };

    private static bool Equal(JToken left, JToken right)
    {
      if ((left.Type == JTokenType.Integer || left.Type == JTokenType.Float) && (right.Type == JTokenType.Integer || right.Type == JTokenType.Float))
        return left.Value<double>() == right.Value<double>();
      return JToken.DeepEquals(left, right);
    }

    private static bool IsType(JToken value, string type)
    {
      switch (type)
      {
        case "object": return value.Type == JTokenType.Object;
        case "array": return value.Type == JTokenType.Array;
        case "string": return value.Type == JTokenType.String;
        case "boolean": return value.Type == JTokenType.Boolean;
        case "null": return value.Type == JTokenType.Null;
        case "integer": return value.Type == JTokenType.Integer || value.Type == JTokenType.Float && value.Value<double>() % 1 == 0;
        case "number": return value.Type == JTokenType.Integer || value.Type == JTokenType.Float;
        default: throw Invalid();
      }
    }

    private static MhpException Invalid() => new MhpException("invalidParams", "MHP_INVALID_PARAMS");
  }

  public sealed class MhpException : Exception
  {
    public string CodeKey { get; }
    public MhpException(string codeKey, string identifier) : base(identifier) { CodeKey = codeKey; }
  }
}
