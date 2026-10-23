import Foundation
import Security

// Redacted descriptions prevent accidental interpolation from disclosing a launch code.
struct LaunchLink: CustomStringConvertible {
  let url: URL
  let origin: URL
  var description: String { "CompanionLaunchLink" }
  init(_ line: String) throws {
    guard line.utf8.count <= NativeLimits.maxLaunchBytes,
      let parts = URLComponents(string: line), parts.scheme == "http",
      parts.host == "127.0.0.1" || parts.host == "[::1]",
      let port = parts.port, port > 0, port <= NativeLimits.maxPort,
      parts.user == nil, parts.password == nil, parts.query == nil,
      parts.path == "/", let fragment = parts.fragment,
      fragment.hasPrefix("k="), fragment.count == NativeLimits.companionCodeBytes * 2 + 2,
      CallbackLink.validToken(String(fragment.dropFirst(2))),
      let url = parts.url
    else { throw NativeFailure.launch }
    var root = parts
    root.fragment = nil
    guard let origin = root.url else { throw NativeFailure.launch }
    self.url = url
    self.origin = origin
  }
  static func sameOrigin(_ candidate: URL, origin: URL) -> Bool {
    guard let parts = URLComponents(url: candidate, resolvingAgainstBaseURL: false),
      let root = URLComponents(url: origin, resolvingAgainstBaseURL: false)
    else { return false }
    return parts.scheme == root.scheme && parts.host == root.host && parts.port == root.port
      && parts.user == nil && parts.password == nil
  }
}
struct CallbackLink: CustomStringConvertible {
  let port: UInt16
  private(set) var code: String
  var description: String { "NativeCallbackLink" }
  init(port: UInt16, code: String) throws {
    guard port > 0, Self.validToken(code) else { throw NativeFailure.invalid }
    self.port = port
    self.code = code
  }
  init(url: URL) throws {
    guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
      parts.scheme == "muse-spark-xcode", parts.host == "command", parts.path.isEmpty,
      parts.user == nil, parts.password == nil, parts.port == nil, parts.query == nil,
      let fragment = parts.fragment
    else { throw NativeFailure.invalid }
    let fields = fragment.split(separator: ":", omittingEmptySubsequences: false)
    guard fields.count == 2, let port = UInt16(fields[0]) else { throw NativeFailure.invalid }
    try self.init(port: port, code: String(fields[1]))
  }
  func launchURL() throws -> URL {
    // Components cannot fail: scheme/host are fixed and fragment is decimal + hex.
    var parts = URLComponents()
    parts.scheme = "muse-spark-xcode"
    parts.host = "command"
    parts.fragment = "\(port):\(code)"
    guard let url = parts.url else { throw NativeFailure.invalid }
    return url
  }
  mutating func clear() { code = "" }
  static func validToken(_ value: String) -> Bool {
    value.count == NativeLimits.bearerBytes * 2
      && value.allSatisfy { "0123456789abcdef".contains($0) }
  }
  static func randomToken() throws -> String {
    var bytes = [UInt8](repeating: 0, count: NativeLimits.bearerBytes)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      throw NativeFailure.launch
    }
    return bytes.map { String(format: "%02x", $0) }.joined()
  }
}
