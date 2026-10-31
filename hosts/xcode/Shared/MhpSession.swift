import Foundation

// A request's native callback carries cancellation independently of the UI queue.
final class MhpCancellation {
  private let lock = NSLock()
  private var alive = true
  private var onCancel: (() -> Void)?
  var isActive: Bool {
    lock.lock()
    defer { lock.unlock() }
    return alive
  }
  func withActive<T>(_ operation: () throws -> T) throws -> T {
    lock.lock()
    defer { lock.unlock() }
    guard alive else { throw NativeFailure.cancelled }
    return try operation()
  }
  func whenCancelled(_ callback: @escaping () -> Void) {
    lock.lock()
    if alive { onCancel = callback }
    let cancelled = !alive
    lock.unlock()
    if cancelled { callback() }
  }
  func cancel() {
    lock.lock()
    alive = false
    let callback = onCancel
    onCancel = nil
    lock.unlock()
    callback?()
  }
}

// The pipe reader calls receive synchronously: frames cannot accumulate in an
// unbounded dispatch queue. All protocol state belongs to this serial queue.
final class MhpSession {
  typealias Service = (
    String, [String: Any], MhpCancellation, @escaping (Result<Any, Error>) -> Void
  ) -> Void
  private let queue = DispatchQueue(label: "muse.xcode.mhp")
  private let schema: MhpSchema
  private let write: (Data) -> Void
  private let launch: (LaunchLink) -> Void
  private let failed: () -> Void
  private let service: Service
  private var buffer = Data()
  private var started = false
  private var initialized = false
  private var closed = false
  private var pending: [String: MhpCancellation] = [:]
  private var retired: [String] = []
  private let capabilities = ["lifecycle", "ui", "window"]

  init(
    schema: MhpSchema, write: @escaping (Data) -> Void, launch: @escaping (LaunchLink) -> Void,
    failed: @escaping () -> Void, service: @escaping Service
  ) {
    self.schema = schema
    self.write = write
    self.launch = launch
    self.failed = failed
    self.service = service
  }
  func start(workspace: URL, locale: String, theme: [String: Any], trusted: Bool) throws {
    try queue.sync {
      guard !started, !closed else { throw NativeFailure.invalid }
      let frame: [String: Any] = [
        "jsonrpc": NativeMhp.jsonRpcVersion, "id": "xcode-initialize", "method": "initialize",
        "params": [
          "host": ["id": "xcode", "version": NativeMhp.productVersion],
          "protocolRange": [
            "minimum": NativeMhp.minimumVersion,
            "maximumExclusive": NativeMhp.maximumVersionExclusive,
          ],
          "capabilities": capabilities, "locale": locale, "theme": theme,
          "folders": [["uri": workspace.absoluteString, "name": workspace.lastPathComponent]],
          "trusted": trusted,
        ],
      ]
      try schema.check(frame, method: "initialize")
      started = true
      try send(frame)
    }
  }
  func receive(_ data: Data) {
    queue.sync {
      guard !closed else { return }
      // Process each newline before retaining another frame, including coalesced reads.
      for byte in data {
        if byte == 10 {
          let line = buffer
          buffer.removeAll(keepingCapacity: true)
          do { try accept(line) } catch { fail() }
          if closed { return }
        } else {
          guard buffer.count < NativeMhp.maximumEnvelopeBytes else {
            fail()
            return
          }
          buffer.append(byte)
        }
      }
    }
  }
  func close() { queue.sync { finish() } }
  func trust(_ trusted: Bool) throws {
    try queue.sync {
      guard initialized, !closed else { throw NativeFailure.unavailable }
      let frame: [String: Any] = [
        "jsonrpc": NativeMhp.jsonRpcVersion,
        "method": "workspace/didChangeTrust", "params": ["trusted": trusted],
      ]
      try schema.check(frame, method: "workspace/didChangeTrust")
      try send(frame)
    }
  }
  private func finish() {
    closed = true
    buffer.removeAll()
    for token in pending.values { token.cancel() }
    pending.removeAll()
    retired.removeAll()
  }
  private func fail() {
    guard !closed else { return }
    finish()
    failed()
  }
  private func send(_ frame: [String: Any]) throws {
    var data = try JSONSerialization.data(withJSONObject: frame, options: [.sortedKeys])
    guard data.count <= NativeMhp.maximumEnvelopeBytes else { throw NativeFailure.invalid }
    data.append(10)
    write(data)
  }
  private func accept(_ line: Data) throws {
    guard started, String(data: line, encoding: .utf8) != nil,
      let frame = try JSONSerialization.jsonObject(with: line) as? [String: Any]
    else { throw NativeFailure.invalid }
    if frame["kind"] != nil {
      guard initialized else { throw NativeFailure.invalid }
      try acceptPanel(frame)
      return
    }
    if frame["method"] == nil {
      guard !initialized, frame["id"] as? String == "xcode-initialize" else {
        throw NativeFailure.invalid
      }
      if frame["error"] != nil {
        try schema.checkFailure(frame)
        throw NativeFailure.unavailable
      }
      try schema.check(frame, method: "initialize", result: true)
      initialized = true
      return
    }
    guard initialized else { throw NativeFailure.invalid }
    guard let method = frame["method"] as? String else {
      try refusal(frame, code: "invalidRequest", message: "MHP_INVALID_REQUEST")
      return
    }
    guard let definition = schema.methods[method] else {
      try refusal(frame, code: "methodNotFound", message: "MHP_METHOD_NOT_FOUND")
      return
    }
    do { try schema.check(frame, method: method) } catch {
      try refusal(frame, code: "invalidParams", message: "MHP_INVALID_PARAMS")
      return
    }
    guard definition["direction"] as? String != "hostToRuntime" else {
      try refusal(frame, code: "invalidRequest", message: "MHP_WRONG_DIRECTION")
      return
    }
    guard let params = frame["params"] as? [String: Any] else { throw NativeFailure.invalid }
    if method == "$/cancelRequest", let id = params["id"] {
      let key = try key(id)
      if let token = pending[key] {
        complete(
          key: key, id: id, method: nil, token: token, result: .failure(NativeFailure.cancelled))
      }
      return
    }
    if definition["kind"] as? String == "notification" {
      guard method == "settings/didChange" else { throw NativeFailure.invalid }
      return
    }
    guard let id = frame["id"] else { throw NativeFailure.invalid }
    let key = try key(id)
    guard pending[key] == nil, !retired.contains(key) else {
      try refusal(frame, code: "invalidRequest", message: "MHP_DUPLICATE_ID")
      return
    }
    guard pending.count < NativeMhp.maximumQueuedMessages else {
      try refusal(frame, code: "invalidRequest", message: "MHP_REQUEST_LIMIT")
      return
    }
    let token = MhpCancellation()
    pending[key] = token
    queue.asyncAfter(deadline: .now() + .milliseconds(NativeMhp.requestTimeoutMs)) { [weak self] in
      self?.complete(
        key: key, id: id, method: method, token: token, result: .failure(NativeFailure.timeout))
    }
    if !capabilities.contains(definition["capability"] as? String ?? "") {
      complete(
        key: key, id: id, method: nil, token: token, result: .failure(NativeFailure.unavailable))
      return
    }
    if method == "ui/openExternal", let uri = params["uri"] as? String,
      let link = try? LaunchLink(uri)
    {
      launch(link)
      complete(key: key, id: id, method: method, token: token, result: .success(NSNull()))
      return
    }
    service(method, params, token) { result in
      self.queue.async {
        self.complete(key: key, id: id, method: method, token: token, result: result)
      }
    }
  }
  private func acceptPanel(_ frame: [String: Any]) throws {
    if frame["kind"] as? String == "panelError" {
      // No stdio surface is bound here. Drop invalid remote channel faults too;
      // they must never retire unrelated JSON-RPC requests or echo another error.
      do { try schema.checkPanel(frame, kind: "error") } catch { return }
      return
    }
    var surface: Any = NSNull()
    var seq: Any = NSNull()
    var code = "MHP_PANEL_UNKNOWN_SURFACE"
    if frame["kind"] as? String == "panel" {
      do {
        try schema.checkPanel(frame, kind: "envelope", headerOnly: true)
        surface = frame["surface"] ?? NSNull()
        seq = frame["seq"] ?? NSNull()
      } catch { code = "MHP_PANEL_INVALID_ENVELOPE" }
    } else {
      do {
        try schema.checkPanel(frame, kind: "lifecycle")
        surface = frame["surface"] ?? NSNull()
      } catch { code = "MHP_PANEL_INVALID_LIFECYCLE" }
    }
    // This companion host has no stdio panel bindings. Fault only that channel;
    // the authenticated WKWebView owns its independent panel delivery.
    let response: [String: Any] = [
      "mhp": NativeMhp.wireVersion, "kind": "panelError", "surface": surface, "seq": seq,
      "code": code,
    ]
    try schema.checkPanel(response, kind: "error")
    try send(response)
  }
  private func refusal(_ frame: [String: Any], code: String, message: String) throws {
    try sendFailure(id: schema.replyId(frame), code: code, message: message)
  }
  private func sendFailure(id: Any, code: String, message: String) throws {
    guard let codes = schema.contract["errorCodes"] as? [String: Int], let number = codes[code]
    else { throw NativeFailure.invalid }
    let frame: [String: Any] = [
      "jsonrpc": NativeMhp.jsonRpcVersion, "id": id, "error": ["code": number, "message": message],
    ]
    try schema.checkFailure(frame)
    try send(frame)
  }
  private func key(_ id: Any) throws -> String {
    return String(
      decoding: try JSONSerialization.data(withJSONObject: id, options: [.fragmentsAllowed]),
      as: UTF8.self)
  }
  private func complete(
    key: String, id: Any, method: String?, token: MhpCancellation, result: Result<Any, Error>
  ) {
    guard !closed, pending[key] === token else { return }
    pending.removeValue(forKey: key)
    retired.append(key)
    if retired.count > NativeMhp.maximumQueuedMessages { retired.removeFirst() }
    do {
      let frame: [String: Any]
      switch result {
      case .success(let value):
        guard let method = method else { throw NativeFailure.invalid }
        frame = ["jsonrpc": NativeMhp.jsonRpcVersion, "id": id, "result": value]
        do { try schema.check(frame, method: method, result: true) } catch {
          try sendFailure(id: id, code: "internalError", message: "MHP_HOST_FAILED")
          token.cancel()
          return
        }
      case .failure(let error):
        let failure: (String, String)
        switch error as? NativeFailure {
        case .cancelled, .timeout: failure = ("cancelled", "MHP_CANCELLED")
        case .unavailable: failure = ("unsupportedCapability", "MHP_UNSUPPORTED_CAPABILITY")
        case .denied: failure = ("permissionDenied", "MHP_PERMISSION_DENIED")
        case .changed: failure = ("versionConflict", "MHP_VERSION_CONFLICT")
        case .invalid: failure = ("invalidParams", "MHP_INVALID_PARAMS")
        default: failure = ("internalError", "MHP_HOST_FAILED")
        }
        try sendFailure(id: id, code: failure.0, message: failure.1)
        token.cancel()
        return
      }
      try send(frame)
    } catch { fail() }
    token.cancel()
  }
}
