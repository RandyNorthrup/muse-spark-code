import Foundation
import Network

// Private XcodeKit/app frames. Nothing here is a Muse, Meta or MHP frame.
struct NativeFrame: Codable {
  let version: Int
  let kind: String
  let credential: String?
  let request: BufferRequest?
  let reply: BufferReply?

  init(
    kind: String, credential: String? = nil, request: BufferRequest? = nil,
    reply: BufferReply? = nil
  ) {
    version = 1
    self.kind = kind
    self.credential = credential
    self.request = request
    self.reply = reply
  }
  static func decode(_ data: Data) throws -> NativeFrame {
    guard data.count <= NativeLimits.maxFrameBytes else { throw NativeFailure.invalid }
    // Codable rejects types and missing fields; explicitly reject additions at every boundary.
    // Foundation JSONSerialization exposes Any; narrow keys here, then decode every value with Codable (§8).
    func fields(_ object: Any?, _ allowed: Set<String>) throws {
      guard let object = object as? [String: Any], Set(object.keys).isSubset(of: allowed) else {
        throw NativeFailure.invalid
      }
    }
    let value = try JSONSerialization.jsonObject(with: data)
    try fields(value, ["version", "kind", "credential", "request", "reply"])
    if let object = value as? [String: Any] {
      if let request = object["request"] as? [String: Any] {
        try fields(request, ["id", "command", "text", "selection", "contentUTI", "digest"])
        try fields(request["selection"], ["start", "end"])
        if let selection = request["selection"] as? [String: Any] {
          try fields(selection["start"], ["line", "column"])
          try fields(selection["end"], ["line", "column"])
        }
      }
      if let reply = object["reply"] {
        try fields(reply, ["id", "digest", "approved", "replacement", "error"])
      }
    }
    let frame = try JSONDecoder().decode(NativeFrame.self, from: data)
    guard frame.version == 1 else { throw NativeFailure.invalid }
    switch frame.kind {
    case "exchange":
      guard let credential = frame.credential, CallbackLink.validToken(credential),
        frame.request == nil, frame.reply == nil
      else { throw NativeFailure.invalid }
    case "context":
      guard let credential = frame.credential, CallbackLink.validToken(credential),
        let request = frame.request, frame.reply == nil
      else { throw NativeFailure.invalid }
      try request.validate()
    case "reply":
      guard let credential = frame.credential, CallbackLink.validToken(credential),
        frame.request == nil, let reply = frame.reply, UUID(uuidString: reply.id) != nil,
        CallbackLink.validToken(reply.digest),
        reply.replacement?.utf8.count ?? 0 <= NativeLimits.maxFrameBytes,
        !reply.approved || (reply.replacement != nil && reply.error == nil)
      else {
        throw NativeFailure.invalid
      }
    case "ack":
      guard frame.credential == nil, frame.request == nil, frame.reply == nil else {
        throw NativeFailure.invalid
      }
    default: throw NativeFailure.invalid
    }
    return frame
  }
  func encoded() throws -> Data {
    let data = try JSONEncoder().encode(self)
    _ = try Self.decode(data)
    var size = UInt32(data.count).bigEndian
    return withUnsafeBytes(of: &size) { Data($0) } + data
  }
}

final class FramedConnection {
  let connection: NWConnection
  init(_ connection: NWConnection) { self.connection = connection }
  func send(_ frame: NativeFrame, completion: @escaping (Error?) -> Void) {
    do {
      connection.send(
        content: try frame.encoded(), completion: .contentProcessed { completion($0) })
    } catch { completion(NativeFailure.invalid) }
  }
  func receive(completion: @escaping (Result<NativeFrame, Error>) -> Void) {
    read(count: MemoryLayout<UInt32>.size) { result in
      switch result {
      case .failure(let error): completion(.failure(error))
      case .success(let header):
        let count = header.reduce(0) { ($0 << 8) | Int($1) }
        guard count > 0, count <= NativeLimits.maxFrameBytes else {
          completion(.failure(NativeFailure.invalid))
          return
        }
        self.read(count: count) { body in
          completion(body.flatMap { bytes in Result { try NativeFrame.decode(bytes) } })
        }
      }
    }
  }
  private func read(
    count: Int, collected: Data = Data(), completion: @escaping (Result<Data, Error>) -> Void
  ) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: count - collected.count) {
      data, _, ended, error in
      if let error = error {
        completion(.failure(error))
        return
      }
      let bytes = collected + (data ?? Data())
      if bytes.count == count {
        completion(.success(bytes))
      } else if ended {
        completion(.failure(NativeFailure.cancelled))
      } else {
        self.read(count: count, collected: bytes, completion: completion)
      }
    }
  }
}

// All listener state lives on one queue. Launch code is consumed once; bearer is per invocation.
final class CommandListener {
  private let queue = DispatchQueue(label: "muse.xcode.command")
  private var listener: NWListener?
  private var channels: [FramedConnection] = []
  private var code = ""
  private var bearer = ""
  private var exchanged = false
  private var finished = false
  private var timer: DispatchWorkItem?
  private var launchTimer: DispatchWorkItem?
  private var completion: ((Result<BufferReply, Error>) -> Void)?

  func start(
    request: BufferRequest, ready: @escaping (Result<CallbackLink, Error>) -> Void,
    completion: @escaping (Result<BufferReply, Error>) -> Void
  ) {
    queue.async {
      guard !self.finished else {
        ready(.failure(NativeFailure.cancelled))
        completion(.failure(NativeFailure.cancelled))
        return
      }
      guard self.completion == nil else {
        ready(.failure(NativeFailure.invalid))
        completion(.failure(NativeFailure.invalid))
        return
      }
      self.completion = completion
      do {
        try request.validate()
        self.code = try CallbackLink.randomToken()
        self.bearer = try CallbackLink.randomToken()
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        let listener = try NWListener(using: parameters)
        self.listener = listener
        let timer = DispatchWorkItem { self.finish(.failure(NativeFailure.timeout)) }
        self.timer = timer
        self.queue.asyncAfter(
          deadline: .now() + .seconds(NativeLimits.commandTimeoutSeconds), execute: timer)
        let launchTimer = DispatchWorkItem {
          if !self.exchanged { self.finish(.failure(NativeFailure.timeout)) }
        }
        self.launchTimer = launchTimer
        self.queue.asyncAfter(
          deadline: .now() + .seconds(NativeLimits.launchTimeoutSeconds), execute: launchTimer)
        listener.stateUpdateHandler = { state in
          if case .ready = state, let port = listener.port {
            ready(Result { try CallbackLink(port: port.rawValue, code: self.code) })
          } else if case .failed = state {
            ready(.failure(NativeFailure.launch))
            self.finish(.failure(NativeFailure.launch))
          }
        }
        listener.newConnectionHandler = { connection in
          guard !self.finished, self.channels.count < NativeLimits.maxConnections else {
            connection.cancel()
            return
          }
          let channel = FramedConnection(connection)
          self.channels.append(channel)
          connection.stateUpdateHandler = { state in
            if case .cancelled = state {
              self.channels.removeAll { $0.connection === connection }
            }
          }
          connection.start(queue: self.queue)
          let deadline = DispatchWorkItem { connection.cancel() }
          self.queue.asyncAfter(
            deadline: .now() + .seconds(NativeLimits.launchTimeoutSeconds), execute: deadline)
          channel.receive { result in
            deadline.cancel()
            guard case .success(let frame) = result, frame.kind == "exchange",
              frame.credential == self.code, !self.exchanged
            else {
              connection.cancel()
              return
            }
            self.exchanged = true
            self.code = ""
            self.launchTimer?.cancel()
            self.launchTimer = nil
            channel.send(NativeFrame(kind: "context", credential: self.bearer, request: request)) {
              error in
              if error != nil {
                self.finish(.failure(NativeFailure.cancelled))
                return
              }
              channel.receive { result in
                guard case .success(let frame) = result, frame.kind == "reply",
                  frame.credential == self.bearer, let reply = frame.reply,
                  reply.id == request.id, reply.digest == request.digest
                else {
                  self.finish(.failure(NativeFailure.invalid))
                  return
                }
                channel.send(NativeFrame(kind: "ack")) { _ in self.finish(.success(reply)) }
              }
            }
          }
        }
        listener.start(queue: self.queue)
      } catch {
        ready(.failure(NativeFailure.launch))
        self.finish(.failure(NativeFailure.launch))
      }
    }
  }
  func cancel() { fail(.cancelled) }
  func fail(_ failure: NativeFailure) { queue.async { self.finish(.failure(failure)) } }
  private func finish(_ result: Result<BufferReply, Error>) {
    guard !finished else { return }
    finished = true
    timer?.cancel()
    timer = nil
    launchTimer?.cancel()
    launchTimer = nil
    listener?.stateUpdateHandler = nil
    listener?.newConnectionHandler = nil
    listener?.cancel()
    listener = nil
    for channel in channels {
      channel.connection.stateUpdateHandler = nil
      channel.connection.cancel()
    }
    channels.removeAll()
    code = ""
    bearer = ""
    let callback = completion
    completion = nil
    callback?(result)
  }
}

final class CommandClient {
  private let queue = DispatchQueue(label: "muse.xcode.client")
  private var channel: FramedConnection?
  private var bearer = ""
  private var timeout: DispatchWorkItem?
  private var contextCompletion: ((Result<BufferRequest, Error>) -> Void)?
  private var closed: (() -> Void)?
  private var stopped = false
  func connect(
    link: CallbackLink, completion: @escaping (Result<BufferRequest, Error>) -> Void,
    closed: @escaping () -> Void = {}
  ) {
    queue.async {
      guard !self.stopped else {
        completion(.failure(NativeFailure.cancelled))
        closed()
        return
      }
      self.contextCompletion = completion
      self.closed = closed
      guard let port = NWEndpoint.Port(rawValue: link.port) else {
        self.shutdown()
        return
      }
      let connection = NWConnection(host: .ipv4(.loopback), port: port, using: .tcp)
      let channel = FramedConnection(connection)
      self.channel = channel
      connection.stateUpdateHandler = { [weak self] state in
        if case .failed = state { self?.shutdown() }
        if case .cancelled = state { self?.shutdown() }
      }
      connection.start(queue: self.queue)
      let deadline = DispatchWorkItem { self.shutdown() }
      self.timeout = deadline
      self.queue.asyncAfter(
        deadline: .now() + .seconds(NativeLimits.commandTimeoutSeconds), execute: deadline)
      channel.send(NativeFrame(kind: "exchange", credential: link.code)) { error in
        if error != nil {
          self.shutdown()
          return
        }
        channel.receive { result in
          guard case .success(let frame) = result, frame.kind == "context",
            let request = frame.request, let bearer = frame.credential
          else {
            self.shutdown()
            return
          }
          self.bearer = bearer
          let callback = self.contextCompletion
          self.contextCompletion = nil
          callback?(.success(request))
        }
      }
    }
  }
  func reply(_ reply: BufferReply, completion: @escaping (Bool) -> Void) {
    queue.async {
      guard let channel = self.channel else {
        completion(false)
        return
      }
      channel.send(NativeFrame(kind: "reply", credential: self.bearer, reply: reply)) { error in
        if error != nil {
          self.shutdown()
          completion(false)
          return
        }
        channel.receive { result in
          self.shutdown()
          if case .success(let frame) = result {
            completion(frame.kind == "ack")
          } else {
            completion(false)
          }
        }
      }
    }
  }
  func close() { queue.async { self.shutdown() } }
  private func shutdown() {
    stopped = true
    timeout?.cancel()
    timeout = nil
    bearer = ""
    channel?.connection.stateUpdateHandler = nil
    channel?.connection.cancel()
    channel = nil
    let callback = contextCompletion
    contextCompletion = nil
    callback?(.failure(NativeFailure.cancelled))
    let notify = closed
    closed = nil
    notify?()
  }
  deinit {
    timeout?.cancel()
    channel?.connection.cancel()
  }
}
