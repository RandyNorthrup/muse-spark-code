import Darwin
import Foundation

final class RuntimeLauncher {
  private let lock = NSLock()
  private var pid: pid_t = 0
  private var generation = UUID()
  private var output: FileHandle?
  private var input: FileHandle?
  private var session: MhpSession?
  private var onExit: (() -> Void)?
  private var queuedWrites = 0
  private var queuedBytes = 0
  private let writer = DispatchQueue(label: "muse.xcode.runtime.write")
  private var launchTimer: DispatchWorkItem?
  private let queue = DispatchQueue(label: "muse.xcode.runtime")

  static func environment(_ input: [String: String]) -> [String: String] {
    input.filter { name, _ in
      let upper = name.uppercased()
      return !upper.hasSuffix("_API_KEY") && !NativeLimits.forbiddenEnvironment.contains(upper)
    }
  }
  static func workspace(_ selected: URL) throws -> URL {
    guard selected.isFileURL else { throw NativeFailure.invalid }
    var selectedDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: selected.path, isDirectory: &selectedDirectory),
      selectedDirectory.boolValue
    else { throw NativeFailure.invalid }
    let root =
      ["xcodeproj", "xcworkspace"].contains(selected.pathExtension)
      ? selected.deletingLastPathComponent() : selected
    var directory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: root.path, isDirectory: &directory),
      directory.boolValue
    else {
      throw NativeFailure.invalid
    }
    return root.standardizedFileURL
  }
  static func findRuntime() -> URL? {
    let directories =
      (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init)
      + ["/opt/homebrew/bin", "/usr/local/bin", NSHomeDirectory() + "/.local/bin"]
    return directories.map {
      URL(fileURLWithPath: $0).appendingPathComponent("muse-spark-code-acp")
    }
    .first { FileManager.default.isExecutableFile(atPath: $0.path) }
  }
  static func navigationFile(_ file: URL, workspace: URL, line: Int) throws -> URL {
    guard file.isFileURL, workspace.isFileURL, line > 0, line <= NativeMhp.maximumInteger,
      file.host == nil || file.host == "" || file.host == "localhost",
      file.user == nil, file.password == nil, file.query == nil, file.fragment == nil
    else { throw NativeFailure.invalid }
    let root = try Self.workspace(workspace).resolvingSymlinksInPath().standardizedFileURL
    let target = file.resolvingSymlinksInPath().standardizedFileURL
    guard target.pathComponents.starts(with: root.pathComponents) else {
      throw NativeFailure.denied
    }
    let values = try target.resourceValues(forKeys: [.isRegularFileKey])
    guard values.isRegularFile == true else { throw NativeFailure.invalid }
    return target
  }
  var isRunning: Bool {
    lock.lock()
    defer { lock.unlock() }
    return pid > 0
  }

  func start(
    executable: URL, workspace: URL,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    locale: String = NativeText.locale,
    theme: [String: Any] = ["kind": "dark", "tokens": [String: String]()],
    trusted: Bool = false,
    service: @escaping MhpSession.Service = { _, _, _, reply in
      reply(.failure(NativeFailure.unavailable))
    },
    launched: @escaping (Result<LaunchLink, Error>) -> Void, exited: @escaping () -> Void
  ) throws {
    stop()
    guard executable.isFileURL, executable.path.hasPrefix("/"),
      FileManager.default.isExecutableFile(atPath: executable.path)
    else { throw NativeFailure.launch }
    let workspace = try Self.workspace(workspace)
    let schema = try MhpSchema()
    var sockets: [Int32] = [0, 0]
    guard socketpair(AF_UNIX, SOCK_STREAM, 0, &sockets) == 0 else { throw NativeFailure.launch }
    let inputHandle = FileHandle(fileDescriptor: sockets[0], closeOnDealloc: true)
    defer { Darwin.close(sockets[1]) }
    var noSignal: Int32 = 1
    guard
      setsockopt(
        sockets[0], SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size)) == 0,
      fcntl(sockets[0], F_SETFL, O_NONBLOCK) == 0
    else { throw NativeFailure.launch }
    var descriptors: [Int32] = [0, 0]
    guard pipe(&descriptors) == 0 else { throw NativeFailure.launch }
    let readFD = descriptors[0]
    let writeFD = descriptors[1]
    var actions: posix_spawn_file_actions_t?
    var attributes: posix_spawnattr_t?
    guard posix_spawn_file_actions_init(&actions) == 0 else {
      Darwin.close(readFD)
      Darwin.close(writeFD)
      throw NativeFailure.launch
    }
    defer { posix_spawn_file_actions_destroy(&actions) }
    guard posix_spawnattr_init(&attributes) == 0 else {
      Darwin.close(readFD)
      Darwin.close(writeFD)
      throw NativeFailure.launch
    }
    defer { posix_spawnattr_destroy(&attributes) }
    var child: pid_t = 0
    let words: [String] = [executable.path, "panel", "--companion"]
    var arguments: [UnsafeMutablePointer<CChar>?] =
      words.map { word in word.withCString { strdup($0) } } + [nil]
    var variables: [UnsafeMutablePointer<CChar>?] =
      Self.environment(environment).map { entry in
        "\(entry.key)=\(entry.value)".withCString { strdup($0) }
      } + [nil]
    defer {
      for argument in arguments.compactMap({ $0 }) { free(argument) }
      for variable in variables.compactMap({ $0 }) { free(variable) }
    }
    // A fresh process group is established atomically before exec. Stop also reaches grandchildren.
    let configured = [
      posix_spawnattr_setflags(
        &attributes, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT)),
      posix_spawnattr_setpgroup(&attributes, 0),
      posix_spawn_file_actions_adddup2(&actions, writeFD, STDOUT_FILENO),
      posix_spawn_file_actions_addclose(&actions, readFD),
      posix_spawn_file_actions_addclose(&actions, writeFD),
      posix_spawn_file_actions_adddup2(&actions, sockets[1], STDIN_FILENO),
      posix_spawn_file_actions_addclose(&actions, sockets[0]),
      posix_spawn_file_actions_addclose(&actions, sockets[1]),
      posix_spawn_file_actions_addopen(&actions, STDERR_FILENO, "/dev/null", O_WRONLY, 0),
      posix_spawn_file_actions_addchdir_np(&actions, workspace.path),
    ].allSatisfy { $0 == 0 }
    guard configured else {
      Darwin.close(readFD)
      Darwin.close(writeFD)
      throw NativeFailure.launch
    }
    let result = posix_spawn(&child, executable.path, &actions, &attributes, &arguments, &variables)
    Darwin.close(writeFD)
    guard result == 0 else {
      Darwin.close(readFD)
      throw NativeFailure.launch
    }
    let id = UUID()
    let handle = FileHandle(fileDescriptor: readFD, closeOnDealloc: true)
    lock.lock()
    pid = child
    generation = id
    output = handle
    input = inputHandle
    onExit = exited
    queuedWrites = 0
    queuedBytes = 0
    lock.unlock()
    let completionLock = NSLock()
    var delivered = false
    func deliver(_ result: Result<LaunchLink, Error>) {
      completionLock.lock()
      let isSuccess: Bool
      if case .success = result { isSuccess = true } else { isSuccess = false }
      guard !delivered || isSuccess else {
        completionLock.unlock()
        return
      }
      delivered = true
      completionLock.unlock()
      launched(result)
    }
    let deadline = DispatchWorkItem {
      if self.stop(expected: id) { deliver(.failure(NativeFailure.timeout)) }
    }
    lock.lock()
    launchTimer = deadline
    lock.unlock()
    DispatchQueue.global(qos: .utility).asyncAfter(
      deadline: .now() + .seconds(NativeLimits.launchTimeoutSeconds), execute: deadline)
    let peer = MhpSession(
      schema: schema,
      write: { [weak self] data in self?.send(data, handle: inputHandle, expected: id) },
      launch: { [weak self] link in
        guard let self = self, self.isCurrent(id) else { return }
        self.clearLaunchTimer(expected: id)
        deliver(.success(link))
      },
      failed: { [weak self] in
        DispatchQueue.global(qos: .utility).async {
          _ = self?.stop(expected: id)
          deliver(.failure(NativeFailure.launch))
        }
      }, service: service)
    lock.lock()
    session = peer
    lock.unlock()
    do {
      try peer.start(workspace: workspace, locale: locale, theme: theme, trusted: trusted)
    } catch {
      _ = stop(expected: id)
      throw NativeFailure.launch
    }
    queue.async {
      defer { try? handle.close() }
      var bytes = [UInt8](repeating: 0, count: NativeLimits.maxFrameBytes)
      while self.isCurrent(id) {
        let count = Darwin.read(readFD, &bytes, bytes.count)
        if count < 0 && errno == EINTR { continue }
        if count <= 0 { break }
        peer.receive(Data(bytes.prefix(count)))
      }
      self.clearLaunchTimer(expected: id)
      _ = self.stop(expected: id)
      deliver(.failure(NativeFailure.launch))
    }
    let childPID = child
    DispatchQueue.global(qos: .utility).async {
      var status: Int32 = 0
      while waitpid(childPID, &status, 0) < 0 && errno == EINTR {}
      self.lock.lock()
      let current = self.generation == id
      self.lock.unlock()
      if current { _ = self.stop(expected: id) }
      // A leader may leave children behind; cleanup belongs to the same invocation.
      kill(-childPID, SIGKILL)
    }
  }
  private func isCurrent(_ id: UUID) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return generation == id && pid > 0
  }
  private func send(_ data: Data, handle: FileHandle, expected: UUID) {
    lock.lock()
    guard generation == expected, pid > 0 else {
      lock.unlock()
      return
    }
    guard queuedWrites < NativeMhp.maximumQueuedMessages,
      queuedBytes + data.count <= NativeMhp.maximumQueuedBytes
    else {
      lock.unlock()
      DispatchQueue.global(qos: .utility).async { _ = self.stop(expected: expected) }
      return
    }
    queuedWrites += 1
    queuedBytes += data.count
    lock.unlock()
    writer.async {
      defer {
        self.lock.lock()
        if self.generation == expected {
          self.queuedWrites -= 1
          self.queuedBytes -= data.count
        }
        self.lock.unlock()
      }
      let deadline = Date().addingTimeInterval(TimeInterval(NativeLimits.launchTimeoutSeconds))
      var offset = 0
      while offset < data.count, self.isCurrent(expected), Date() < deadline {
        let count = data.withUnsafeBytes { raw -> Int in
          guard let base = raw.baseAddress else { return -1 }
          return Darwin.write(handle.fileDescriptor, base.advanced(by: offset), data.count - offset)
        }
        if count > 0 {
          offset += count
          continue
        }
        if count < 0 && errno == EINTR { continue }
        if count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK) {
          var descriptor = pollfd(fd: handle.fileDescriptor, events: Int16(POLLOUT), revents: 0)
          _ = poll(
            &descriptor, 1, Int32(NativeMhp.requestTimeoutMs / NativeMhp.maximumQueuedMessages))
          continue
        }
        break
      }
      if offset != data.count { _ = self.stop(expected: expected) }
    }
  }
  private func clearLaunchTimer(expected: UUID) {
    lock.lock()
    let timer = generation == expected ? launchTimer : nil
    if generation == expected { launchTimer = nil }
    lock.unlock()
    timer?.cancel()
  }
  func stop() { _ = stop(expected: nil) }
  func trust(_ trusted: Bool) throws {
    lock.lock()
    let peer = session
    lock.unlock()
    guard let peer = peer else { throw NativeFailure.unavailable }
    try peer.trust(trusted)
  }
  private func stop(expected: UUID?) -> Bool {
    lock.lock()
    if let expected = expected, expected != generation {
      lock.unlock()
      return false
    }
    let child = pid
    pid = 0
    generation = UUID()
    let handle = output
    output = nil
    let timer = launchTimer
    launchTimer = nil
    let peer = session
    session = nil
    let exited = onExit
    onExit = nil
    // Keep the descriptor alive until its sole writer has observed retirement.
    let input = input
    self.input = nil
    lock.unlock()
    timer?.cancel()
    peer?.close()
    writer.async { try? input?.close() }
    guard child > 0 else { return false }
    kill(-child, SIGTERM)
    // Closing can race the reader/reaper; group termination remains unconditional (§8).
    try? handle?.close()
    exited?()
    DispatchQueue.global(qos: .utility).asyncAfter(
      deadline: .now() + .seconds(NativeLimits.stopGraceSeconds)
    ) {
      kill(-child, SIGKILL)
    }
    return true
  }
  deinit { stop() }
}
