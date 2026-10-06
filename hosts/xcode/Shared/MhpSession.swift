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
    guard initialized, let method = frame["method"] as? String,
      let definition = schema.methods[method], definition["direction"] as? String != "hostToRuntime"
    else { throw NativeFailure.invalid }
    try schema.check(frame, method: method)
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
    guard pending[key] == nil, !retired.contains(key),
      pending.count < NativeMhp.maximumQueuedMessages
    else { throw NativeFailure.invalid }
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
        try schema.check(frame, method: method, result: true)
      case .failure(let error):
        let code =
          error as? NativeFailure == .cancelled || error as? NativeFailure == .timeout
          ? "cancelled" : "unsupportedCapability"
        guard let codes = schema.contract["errorCodes"] as? [String: Int], let number = codes[code]
        else {
          throw NativeFailure.invalid
        }
        frame = [
          "jsonrpc": NativeMhp.jsonRpcVersion, "id": id,
          "error": [
            "code": number,
            "message": code == "cancelled" ? "MHP_CANCELLED" : "MHP_UNSUPPORTED_CAPABILITY",
          ],
        ]
        try schema.checkFailure(frame)
      }
      try send(frame)
    } catch { fail() }
    token.cancel()
  }
}
