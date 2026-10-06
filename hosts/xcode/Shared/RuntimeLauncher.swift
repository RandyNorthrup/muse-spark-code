import Darwin
import Foundation

final class RuntimeLauncher {
  private let lock = NSLock()
  private var pid: pid_t = 0
  private var generation = UUID()
  private var output: FileHandle?
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
  var isRunning: Bool {
    lock.lock()
    defer { lock.unlock() }
    return pid > 0
  }

  func start(
    executable: URL, workspace: URL,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    launched: @escaping (Result<LaunchLink, Error>) -> Void, exited: @escaping () -> Void
  ) throws {
    stop()
    guard executable.isFileURL, executable.path.hasPrefix("/"),
      FileManager.default.isExecutableFile(atPath: executable.path)
    else { throw NativeFailure.launch }
    let workspace = try Self.workspace(workspace)
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
      posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0),
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
    lock.unlock()
    let completionLock = NSLock()
    var delivered = false
    func deliver(_ result: Result<LaunchLink, Error>) {
      completionLock.lock()
      guard !delivered else {
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
    queue.async {
      var buffer = Data()
      var settled = false
      defer { try? handle.close() }
      var bytes = [UInt8](repeating: 0, count: NativeLimits.maxLaunchBytes + 1)
      while true {
        let count = Darwin.read(readFD, &bytes, bytes.count)
        if count < 0 && errno == EINTR { continue }
        if count <= 0 { break }
        if settled { continue }  // Drain stdout, never retain or log runtime output.
        buffer.append(contentsOf: bytes.prefix(count))
        guard buffer.count <= NativeLimits.maxLaunchBytes else {
          settled = true
          self.clearLaunchTimer(expected: id)
          buffer.removeAll()
          _ = self.stop(expected: id)
          deliver(.failure(NativeFailure.launch))
          continue
        }
        if let newline = buffer.firstIndex(of: 10) {
          let line = String(data: buffer[..<newline], encoding: .utf8)
          buffer.removeAll()
          settled = true
          self.clearLaunchTimer(expected: id)
          guard let line = line else {
            _ = self.stop(expected: id)
            deliver(.failure(NativeFailure.launch))
            continue
          }
          let parsed = Result { try LaunchLink(line) }
          if case .failure = parsed { _ = self.stop(expected: id) }
          deliver(parsed)
        }
      }
      if !settled {
        self.clearLaunchTimer(expected: id)
        deliver(.failure(NativeFailure.launch))
      }
    }
    let childPID = child
    DispatchQueue.global(qos: .utility).async {
      var status: Int32 = 0
      while waitpid(childPID, &status, 0) < 0 && errno == EINTR {}
      self.lock.lock()
      let current = self.generation == id
      if current {
        self.pid = 0
        self.output = nil
      }
      self.lock.unlock()
      // A leader may leave children behind; cleanup belongs to the same invocation.
      kill(-childPID, SIGKILL)
      if current { exited() }
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
    lock.unlock()
    timer?.cancel()
    guard child > 0 else { return false }
    kill(-child, SIGTERM)
    // Closing can race the reader/reaper; group termination remains unconditional (§8).
    try? handle?.close()
    DispatchQueue.global(qos: .utility).asyncAfter(
      deadline: .now() + .seconds(NativeLimits.stopGraceSeconds)
    ) {
      kill(-child, SIGKILL)
    }
    return true
  }
  deinit { stop() }
}
