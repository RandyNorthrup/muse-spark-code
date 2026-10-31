import CoreFoundation
import Foundation

// JSONSerialization requires heterogeneous Any values. Every value is narrowed
// and checked against A's reviewed JSON Schema before a native side effect (§8).
final class MhpSchema {
  let contract: [String: Any]
  let methods: [String: [String: Any]]
  init(data: Data? = nil) throws {
    let bytes: Data
    if let data = data {
      bytes = data
    } else {
      guard let url = Bundle(for: MhpSchema.self).url(forResource: "mhp", withExtension: "json")
      else { throw NativeFailure.unavailable }
      bytes = try Data(contentsOf: url)
    }
    guard let contract = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
      contract["protocol"] as? String == NativeMhp.version,
      let methods = contract["methods"] as? [String: [String: Any]]
    else { throw NativeFailure.invalid }
    self.contract = contract
    self.methods = methods
  }
  func check(_ frame: [String: Any], method: String, result: Bool = false) throws {
    guard let schema = methods[method]?[result ? "result" : "call"] as? [String: Any]
    else { throw NativeFailure.invalid }
    try Self.validate(frame, schema: schema, root: schema)
  }
  func checkFailure(_ frame: [String: Any]) throws {
    guard let schema = contract["failure"] as? [String: Any] else { throw NativeFailure.invalid }
    try Self.validate(frame, schema: schema, root: schema)
  }
  func checkPanel(_ frame: [String: Any], kind: String, headerOnly: Bool = false) throws {
    guard let panel = contract["panel"] as? [String: Any],
      var rules = panel[kind] as? [String: Any]
    else { throw NativeFailure.invalid }
    if headerOnly, let variants = rules["oneOf"] as? [[String: Any]] {
      rules["oneOf"] = variants.map { variant in
        var variant = variant
        var properties = variant["properties"] as? [String: [String: Any]] ?? [:]
        properties["payload"] = [:]
        variant["properties"] = properties
        return variant
      }
    }
    try Self.validate(frame, schema: rules, root: rules)
  }
  func replyId(_ frame: [String: Any]) -> Any {
    guard let id = frame["id"], let failure = contract["failure"] as? [String: Any],
      let properties = failure["properties"] as? [String: [String: Any]],
      let rules = properties["id"], (try? Self.validate(id, schema: rules, root: failure)) != nil
    else { return NSNull() }
    return id
  }
  static func validate(_ value: Any, schema: [String: Any], root: [String: Any]) throws {
    if let ref = schema["$ref"] as? String {
      guard ref.hasPrefix("#/") else { throw NativeFailure.invalid }
      var target: Any = root
      for key in ref.dropFirst(2).split(separator: "/") {
        guard let next = (target as? [String: Any])?[String(key)] else {
          throw NativeFailure.invalid
        }
        target = next
      }
      guard let resolved = target as? [String: Any] else { throw NativeFailure.invalid }
      try validate(value, schema: resolved, root: root)
      return
    }
    if let alternatives = schema["anyOf"] as? [[String: Any]] {
      guard alternatives.contains(where: { (try? validate(value, schema: $0, root: root)) != nil })
      else { throw NativeFailure.invalid }
    }
    if let alternatives = schema["oneOf"] as? [[String: Any]] {
      guard
        alternatives.filter({ (try? validate(value, schema: $0, root: root)) != nil }).count == 1
      else { throw NativeFailure.invalid }
    }
    if let types = schema["type"] as? [String] {
      guard types.contains(where: { matches(value, type: $0) }) else { throw NativeFailure.invalid }
    } else if let type = schema["type"] as? String, !matches(value, type: type) {
      throw NativeFailure.invalid
    }
    if let expected = schema["const"], !equal(value, expected) { throw NativeFailure.invalid }
    if let choices = schema["enum"] as? [Any], !choices.contains(where: { equal(value, $0) }) {
      throw NativeFailure.invalid
    }
    if let text = value as? String {
      if let limit = schema["minLength"] as? Int, text.utf16.count < limit {
        throw NativeFailure.invalid
      }
      if let limit = schema["maxLength"] as? Int, text.utf16.count > limit {
        throw NativeFailure.invalid
      }
      if let pattern = schema["pattern"] as? String {
        let expression = try NSRegularExpression(
          pattern: pattern.replacingOccurrences(of: "\\d", with: "[0-9]")
            .replacingOccurrences(of: "\\w", with: "[A-Za-z0-9_]"))
        guard
          expression.firstMatch(in: text, range: NSRange(location: 0, length: text.utf16.count))
            != nil
        else { throw NativeFailure.invalid }
      }
      if schema["format"] as? String == "uri", URL(string: text)?.scheme == nil {
        throw NativeFailure.invalid
      }
    }
    if let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() {
      if let bound = schema["minimum"] as? Double, number.doubleValue < bound {
        throw NativeFailure.invalid
      }
      if let bound = schema["maximum"] as? Double, number.doubleValue > bound {
        throw NativeFailure.invalid
      }
      if let bound = schema["exclusiveMinimum"] as? Double, number.doubleValue <= bound {
        throw NativeFailure.invalid
      }
      if let bound = schema["exclusiveMaximum"] as? Double, number.doubleValue >= bound {
        throw NativeFailure.invalid
      }
    }
    if let values = value as? [Any] {
      if let count = schema["minItems"] as? Int, values.count < count {
        throw NativeFailure.invalid
      }
      if let count = schema["maxItems"] as? Int, values.count > count {
        throw NativeFailure.invalid
      }
      if let items = schema["items"] as? [String: Any] {
        for item in values { try validate(item, schema: items, root: root) }
      }
      if schema["uniqueItems"] as? Bool == true {
        for (index, item) in values.enumerated() {
          guard !values.prefix(index).contains(where: { equal($0, item) }) else {
            throw NativeFailure.invalid
          }
        }
      }
      if let contains = schema["contains"] as? [String: Any],
        !values.contains(where: { (try? validate($0, schema: contains, root: root)) != nil })
      {
        throw NativeFailure.invalid
      }
    }
    if let object = value as? [String: Any] {
      let properties = schema["properties"] as? [String: [String: Any]] ?? [:]
      for key in schema["required"] as? [String] ?? [] {
        guard object[key] != nil else { throw NativeFailure.invalid }
      }
      for (key, member) in object {
        if let names = schema["propertyNames"] as? [String: Any] {
          try validate(key, schema: names, root: root)
        }
        if let property = properties[key] {
          try validate(member, schema: property, root: root)
        } else if let additional = schema["additionalProperties"] as? [String: Any] {
          try validate(member, schema: additional, root: root)
        } else if schema["additionalProperties"] as? Bool == false {
          throw NativeFailure.invalid
        }
      }
    }
  }
  private static func matches(_ value: Any, type: String) -> Bool {
    switch type {
    case "null": return value is NSNull
    case "object": return value is [String: Any]
    case "array": return value is [Any]
    case "string": return value is String
    case "boolean":
      return (value as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() } ?? false
    case "number", "integer":
      guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {
        return false
      }
      return number.doubleValue.isFinite
        && (type != "integer" || number.doubleValue.rounded() == number.doubleValue)
    default: return false
    }
  }
  private static func equal(_ left: Any, _ right: Any) -> Bool {
    if let lhs = left as? NSNumber, let rhs = right as? NSNumber,
      (CFGetTypeID(lhs) == CFBooleanGetTypeID()) != (CFGetTypeID(rhs) == CFBooleanGetTypeID())
    {
      return false
    }
    return (left as? NSObject)?.isEqual(right) == true
  }
}
