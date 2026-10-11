import Foundation
import Network
import XCTest

final class NativeHostTests: XCTestCase {
  private var directory: URL!
  override func setUpWithError() throws {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    directory = root.appendingPathComponent("temp/m104x/unit-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }
  override func tearDownWithError() throws { try FileManager.default.removeItem(at: directory) }
  private func request(
    _ text: String = "first\nsecond\n", command: NativeCommand = .fix,
    selection: BufferSelection? = nil
  ) -> BufferRequest {
    BufferRequest(
      id: UUID().uuidString, command: command, text: text,
      selection: selection
        ?? BufferSelection(
          start: BufferPosition(line: 1, column: 0),
          end: BufferPosition(line: 1, column: 6)),
      contentUTI: "public.swift-source", digest: BufferEdit.digest(text))
  }
  private func reply(
    _ request: BufferRequest, approved: Bool = true, replacement: String? = "changed"
  ) -> BufferReply {
    BufferReply(
      id: request.id, digest: request.digest, approved: approved, replacement: replacement,
      error: nil)
  }
  private func script(_ body: String) throws -> URL {
    let url = directory.appendingPathComponent("runtime-\(UUID().uuidString).sh")
    try ("#!/bin/sh\n" + body).write(to: url, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
    return url
  }
  private var handshake: String {
    "IFS= read -r initialize\nprintf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":\"xcode-initialize\",\"result\":{\"protocolVersion\":\"mhp/1.5.0\",\"capabilities\":[\"lifecycle\",\"settings\",\"storage\"]}}'\nprintf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ui/openExternal\",\"params\":{\"uri\":\"http://127.0.0.1:1234/#k=\(String(repeating: "a", count: 64))\"}}'\n"
  }
  func testApprovedEditReplacesOnlySelection() throws {
    let request = request()
    XCTAssertEqual(
      try BufferEdit.apply(
        reply(request), request: request, current: request.text, currentSelection: request.selection
      ), "first\nchanged\n")
  }
  func testUnapprovedEditDoesNotApply() {
    let request = request()
    XCTAssertThrowsError(
      try BufferEdit.apply(
        reply(request, approved: false), request: request, current: request.text,
        currentSelection: request.selection))
  }
  func testChangedBufferRefusesEdit() {
    let request = request()
    XCTAssertThrowsError(
      try BufferEdit.apply(
        reply(request), request: request, current: request.text + "dirty",
        currentSelection: request.selection))
  }
  func testReplyCannotTargetAnotherInvocation() {
    let request = request()
    let other = self.request()
    XCTAssertThrowsError(
      try BufferEdit.apply(
        reply(other), request: request, current: request.text, currentSelection: request.selection))
  }
  func testMissingReplacementRefusesApprovedEdit() {
    let request = request()
    XCTAssertThrowsError(
      try BufferEdit.apply(
        reply(request, replacement: nil), request: request, current: request.text,
        currentSelection: request.selection))
  }
  func testDeletionIsAnApprovedEmptyReplacement() throws {
    let request = request()
    XCTAssertEqual(
      try BufferEdit.apply(
        reply(request, replacement: ""), request: request, current: request.text,
        currentSelection: request.selection), "first\n\n")
  }
  func testCRLFAndUnicodeStayExact() throws {
    let text = "😀 keep\r\nreplace\r\n"
    let request = request(
      text,
      selection: BufferSelection(
        start: BufferPosition(line: 1, column: 0), end: BufferPosition(line: 1, column: 7)))
    XCTAssertEqual(
      try BufferEdit.apply(
        reply(request, replacement: "new😀"), request: request, current: text,
        currentSelection: request.selection), "😀 keep\r\nnew😀\r\n")
  }
  func testSurrogatePairCannotBeSplit() {
    XCTAssertThrowsError(
      try BufferEdit.range(
        in: "😀",
        selection: BufferSelection(
          start: BufferPosition(line: 0, column: 1), end: BufferPosition(line: 0, column: 2))))
  }
  func testCursorInsertion() throws {
    let request = request(
      "abc", command: .tab,
      selection: BufferSelection(
        start: BufferPosition(line: 0, column: 1), end: BufferPosition(line: 0, column: 1)))
    XCTAssertEqual(
      try BufferEdit.apply(
        reply(request, replacement: "X"), request: request, current: "abc",
        currentSelection: request.selection), "aXbc")
  }
  func testInvalidPositionsRefuse() {
    for position in [
      BufferPosition(line: -1, column: 0), BufferPosition(line: 100, column: 0),
      BufferPosition(line: 0, column: -1), BufferPosition(line: 0, column: 100),
    ] {
      XCTAssertThrowsError(
        try BufferEdit.range(in: "x", selection: BufferSelection(start: position, end: position)))
    }
  }
  func testReversedRangeRefuses() {
    XCTAssertThrowsError(
      try BufferEdit.range(
        in: "abc",
        selection: BufferSelection(
          start: BufferPosition(line: 0, column: 2), end: BufferPosition(line: 0, column: 1))))
  }
  func testChangedSelectionRefusesEdit() {
    let source = request()
    let moved = BufferSelection(
      start: BufferPosition(line: 0, column: 0), end: BufferPosition(line: 0, column: 0))
    XCTAssertThrowsError(
      try BufferEdit.apply(
        reply(source), request: source, current: source.text, currentSelection: moved))
  }
  func testLegacyAndUnicodeLineEndings() throws {
    for ending in ["\r", "\u{2028}", "\u{2029}"] {
      let text = "first" + ending + "second" + ending
      let source = request(text)
      XCTAssertEqual(
        try BufferEdit.apply(
          reply(source), request: source, current: text, currentSelection: source.selection),
        "first" + ending + "changed" + ending)
    }
  }
  func testTabRequiresCursor() { XCTAssertThrowsError(try request(command: .tab).validate()) }
  func testSnapshotDigestIsValidated() {
    let source = request()
    let bad = BufferRequest(
      id: source.id, command: .fix, text: source.text, selection: source.selection,
      contentUTI: source.contentUTI, digest: "incorrect")
    XCTAssertThrowsError(try bad.validate())
  }
  func testLaunchLinkRejectsForeignOrCredentialRoutes() {
    let code = String(repeating: "a", count: NativeLimits.bearerBytes * 2)
    for url in [
      "https://127.0.0.1:1234/#k=\(code)", "http://localhost:1234/#k=\(code)",
      "http://127.0.0.2:1234/#k=\(code)", "http://user@127.0.0.1:1234/#k=\(code)",
      "http://127.0.0.1:1234/?bearer=x#k=\(code)", "http://127.0.0.1:0/#k=\(code)",
      "http://127.0.0.1:65536/#k=\(code)", "http://127.0.0.1:1234/post#k=\(code)",
      "http://127.0.0.1:1234/#k=short",
    ] {
      XCTAssertThrowsError(try LaunchLink(url), url.components(separatedBy: "#")[0])
    }
  }
  func testLaunchLinkAllowsOnlyItsOwnOriginAndRedactsDescription() throws {
    let code = try CallbackLink.randomToken()
    let link = try LaunchLink("http://127.0.0.1:1234/#k=\(code)")
    XCTAssertTrue(
      LaunchLink.sameOrigin(URL(string: "http://127.0.0.1:1234/post")!, origin: link.origin))
    XCTAssertFalse(
      LaunchLink.sameOrigin(URL(string: "http://127.0.0.1:1235/post")!, origin: link.origin))
    XCTAssertFalse(
      LaunchLink.sameOrigin(URL(string: "http://127.0.0.2:1234/post")!, origin: link.origin))
    XCTAssertFalse(
      LaunchLink.sameOrigin(URL(string: "https://127.0.0.1:1234/post")!, origin: link.origin))
    XCTAssertFalse(
      LaunchLink.sameOrigin(URL(string: "http://user@127.0.0.1:1234/post")!, origin: link.origin))
    XCTAssertFalse(String(describing: link).contains(code))
    XCTAssertNil(URLComponents(url: link.origin, resolvingAgainstBaseURL: false)?.fragment)
  }
  func testIPv6LaunchLink() throws {
    let code = try CallbackLink.randomToken()
    XCTAssertNoThrow(try LaunchLink("http://[::1]:1234/#k=\(code)"))
  }
  func testCallbackLinkStrictAndRedacted() throws {
    for invalid in [
      String(repeating: "g", count: NativeLimits.bearerBytes * 2),
      String(repeating: "A", count: NativeLimits.bearerBytes * 2),
      String(repeating: "ａ", count: NativeLimits.bearerBytes * 2),
    ] {
      XCTAssertThrowsError(try CallbackLink(port: 1234, code: invalid))
    }
    let code = try CallbackLink.randomToken()
    var link = try CallbackLink(port: 1234, code: code)
    XCTAssertEqual(try CallbackLink(url: link.launchURL()).port, 1234)
    XCTAssertFalse(String(describing: link).contains(code))
    for value in [
      "muse-spark-xcode://command#0:\(code)", "muse-spark-xcode://command?token=x#1234:\(code)",
      "muse-spark-xcode://other#1234:\(code)", "muse-spark-xcode://command#1234:short",
    ] {
      XCTAssertThrowsError(try CallbackLink(url: URL(string: value)!))
    }
    link.clear()
    XCTAssertTrue(link.code.isEmpty)
  }
  func testFramesRoundTripAndRejectAdditions() throws {
    let frame = NativeFrame(
      kind: "context", credential: try CallbackLink.randomToken(), request: request())
    let wire = try frame.encoded()
    XCTAssertEqual(try NativeFrame.decode(wire.dropFirst(4)).request?.text, frame.request?.text)
    let altered = Data("{\"version\":1,\"kind\":\"ack\",\"unknown\":true}".utf8)
    XCTAssertThrowsError(try NativeFrame.decode(altered))
    XCTAssertThrowsError(try NativeFrame.decode(Data("{\"version\":2,\"kind\":\"ack\"}".utf8)))
    XCTAssertThrowsError(
      try NativeFrame.decode(Data("{\"version\":1,\"kind\":\"ack\",\"credential\":\"x\"}".utf8)))
    XCTAssertThrowsError(
      try NativeFrame.decode(
        Data(
          ("{\"version\":1,\"kind\":\"ack\"}"
            + String(repeating: " ", count: NativeLimits.maxFrameBytes)).utf8)))
  }
  func testNestedFrameAdditionsRejected() throws {
    let frame = NativeFrame(
      kind: "context", credential: try CallbackLink.randomToken(), request: request())
    var object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: frame.encoded().dropFirst(4)) as? [String: Any])
    var request = try XCTUnwrap(object["request"] as? [String: Any])
    request["newField"] = true
    object["request"] = request
    XCTAssertThrowsError(try NativeFrame.decode(JSONSerialization.data(withJSONObject: object)))
  }
  func testEnvironmentScrubsCredentialsCaseInsensitively() {
    let input = [
      "META_API_KEY": "marker", "custom_api_key": "marker", "OPENAI_KEY": "marker",
      "AWS_SESSION_TOKEN": "marker", "PATH": "/usr/bin", "MUSE_NORMAL": "allowed",
    ]
    let clean = RuntimeLauncher.environment(input)
    XCTAssertEqual(clean, ["PATH": "/usr/bin", "MUSE_NORMAL": "allowed"])
  }
  func testProjectAndWorkspaceResolveToTheirFolder() throws {
    for bundle in ["Sample.xcodeproj", "Sample.xcworkspace"] {
      try FileManager.default.createDirectory(
        at: directory.appendingPathComponent(bundle), withIntermediateDirectories: false)
    }
    XCTAssertEqual(
      try RuntimeLauncher.workspace(directory.appendingPathComponent("Sample.xcodeproj")),
      directory.standardizedFileURL)
    XCTAssertEqual(
      try RuntimeLauncher.workspace(directory.appendingPathComponent("Sample.xcworkspace")),
      directory.standardizedFileURL)
    XCTAssertThrowsError(try RuntimeLauncher.workspace(URL(string: "https://example.invalid")!))
    XCTAssertThrowsError(
      try RuntimeLauncher.workspace(directory.appendingPathComponent("Missing.xcodeproj")))
    XCTAssertThrowsError(
      try RuntimeLauncher.workspace(directory.appendingPathComponent("Missing.xcworkspace")))
  }
  func testRuntimeLaunchUsesWorkspaceAndScrubbedEnvironment() throws {
    let receipt = directory.appendingPathComponent("receipt")
    let runtime = try script(
      "printf '%s\\n' \"$PWD|$1|$2|${META_API_KEY-unset}|${OPENAI_KEY-unset}\" > '\(receipt.path)'\n\(handshake)sleep 30\n"
    )
    let started = expectation(description: "launch")
    let launcher = RuntimeLauncher()
    try launcher.start(
      executable: runtime, workspace: directory,
      environment: [
        "PATH": "/bin:/usr/bin", "META_API_KEY": "private-marker", "OPENAI_KEY": "private-marker",
      ],
      launched: { result in
        if case .failure = result { XCTFail("runtime did not launch") }
        started.fulfill()
      }, exited: {})
    wait(for: [started], timeout: 5)
    launcher.stop()
    XCTAssertEqual(
      try String(contentsOf: receipt, encoding: .utf8).trimmingCharacters(in: .newlines),
      "\(directory.path)|panel|--companion|unset|unset")
  }
  func testMalformedRuntimeOutputRefusedWithoutLogging() throws {
    let runtime = try script("printf 'not a launch link\\n'\n")
    let failed = expectation(description: "failure")
    let launcher = RuntimeLauncher()
    try launcher.start(
      executable: runtime, workspace: directory,
      launched: { result in
        if case .success = result { XCTFail("invalid output accepted") }
        failed.fulfill()
      }, exited: {})
    wait(for: [failed], timeout: 5)
    XCTAssertFalse(launcher.isRunning)
  }
  func testRuntimeEOFEndsTheOwningConnectionAfterLaunch() throws {
    let runtime = try script(handshake + "IFS= read -r reply\nexit 0\n")
    let started = expectation(description: "validated launch")
    let closed = expectation(description: "connection ended")
    let launcher = RuntimeLauncher()
    try launcher.start(
      executable: runtime, workspace: directory,
      launched: { result in
        if case .failure = result { XCTFail("valid launch failed") }
        started.fulfill()
      }, exited: { closed.fulfill() })
    wait(for: [started, closed], timeout: 5)
    XCTAssertFalse(launcher.isRunning)
    launcher.stop()
  }
  func testMissingRuntimeExplicitlyFails() {
    XCTAssertThrowsError(
      try RuntimeLauncher().start(
        executable: directory.appendingPathComponent("missing"), workspace: directory,
        launched: { _ in }, exited: {}))
  }
  func testStopIsOutOfBandAndKillsProcessGroup() throws {
    let receipt = directory.appendingPathComponent("child")
    let runtime = try script(
      "trap '' TERM\nsleep 30 &\nprintf '%s' $! > '\(receipt.path)'\n\(handshake)wait\n"
    )
    let started = expectation(description: "launch")
    let launcher = RuntimeLauncher()
    try launcher.start(
      executable: runtime, workspace: directory, launched: { _ in started.fulfill() }, exited: {})
    wait(for: [started], timeout: 5)
    let pid = try XCTUnwrap(Int32(String(contentsOf: receipt, encoding: .utf8)))
    let group = getpgid(pid)
    guard group > 0, group != getpgrp() else { throw NativeFailure.launch }
    // Test-only cleanup also runs when the Stop guard is deliberately broken.
    defer { kill(-group, SIGKILL) }
    launcher.stop()
    launcher.stop()
    XCTAssertFalse(launcher.isRunning)
    let gone = expectation(description: "child stopped")
    DispatchQueue.global().asyncAfter(
      deadline: .now() + .seconds(NativeLimits.stopGraceSeconds + 1)
    ) {
      XCTAssertNotEqual(kill(pid, 0), 0)
      gone.fulfill()
    }
    wait(for: [gone], timeout: 5)
  }
  func testAuthenticatedCommandRoundTripAndApproval() throws {
    let listener = CommandListener()
    let client = CommandClient()
    let source = request()
    let finished = expectation(description: "approved command")
    let ack = expectation(description: "acknowledged")
    listener.start(
      request: source,
      ready: { result in
        do {
          let link = try result.get()
          client.connect(
            link: link,
            completion: { context in
              do {
                let request = try context.get()
                XCTAssertEqual(request.text, source.text)
                client.reply(self.reply(request)) { accepted in
                  XCTAssertTrue(accepted)
                  ack.fulfill()
                }
              } catch {
                XCTFail("context refused")
                ack.fulfill()
              }
            })
        } catch {
          XCTFail("listener did not start")
          ack.fulfill()
        }
      },
      completion: { result in
        do {
          let applied = try BufferEdit.apply(
            result.get(), request: source, current: source.text, currentSelection: source.selection)
          XCTAssertEqual(applied, "first\nchanged\n")
        } catch { XCTFail("edit failed") }
        finished.fulfill()
      })
    wait(for: [finished, ack], timeout: 5)
  }
  func testCancellationCompletesExactlyOnce() {
    let listener = CommandListener()
    let finished = expectation(description: "cancelled")
    listener.start(
      request: request(),
      ready: { _ in
        listener.cancel()
        listener.cancel()
      },
      completion: { result in
        if case .success = result { XCTFail("cancellation accepted") }
        finished.fulfill()
      })
    wait(for: [finished], timeout: 5)
  }
  func testWrongLaunchCodeCannotReadBuffer() throws {
    let listener = CommandListener()
    let client = CommandClient()
    let refused = expectation(description: "wrong code rejected")
    let cancelled = expectation(description: "cleanup")
    listener.start(
      request: request(),
      ready: { result in
        do {
          let link = try result.get()
          let wrong = try CallbackLink(port: link.port, code: CallbackLink.randomToken())
          client.connect(
            link: wrong,
            completion: { result in
              if case .success = result { XCTFail("buffer leaked") }
              refused.fulfill()
              listener.cancel()
            })
        } catch {
          XCTFail("listener failed")
          refused.fulfill()
          listener.cancel()
        }
      }, completion: { _ in cancelled.fulfill() })
    wait(for: [refused, cancelled], timeout: 5)
  }
  func testUnexchangedLaunchCodeExpires() throws {
    let listener = CommandListener()
    defer { listener.cancel() }
    let finished = expectation(description: "expired launch")
    listener.start(
      request: request(),
      ready: { result in
        if case .failure = result { XCTFail("listener failed before expiry") }
      },
      completion: { result in
        if case .success = result { XCTFail("expired launch succeeded") }
        finished.fulfill()
      })
    wait(for: [finished], timeout: TimeInterval(NativeLimits.launchTimeoutSeconds + 2))
  }
  func testConsumedLaunchCodeCannotBeReplayed() throws {
    let listener = CommandListener()
    let first = CommandClient()
    let second = CommandClient()
    let rejected = expectation(description: "replay rejected")
    let finished = expectation(description: "cleanup")
    listener.start(
      request: request(),
      ready: { result in
        do {
          let link = try result.get()
          first.connect(
            link: link,
            completion: { context in
              guard case .success = context else {
                XCTFail("first exchange failed")
                listener.cancel()
                return
              }
              second.connect(
                link: link,
                completion: { replay in
                  if case .success = replay { XCTFail("launch code replay leaked context") }
                  rejected.fulfill()
                  listener.cancel()
                  first.close()
                })
            })
        } catch {
          XCTFail("listener failed")
          rejected.fulfill()
          listener.cancel()
        }
      }, completion: { _ in finished.fulfill() })
    wait(for: [rejected, finished], timeout: 5)
  }
  func testWrongBearerCannotApproveEdit() throws {
    let listener = CommandListener()
    let finished = expectation(description: "wrong bearer refused")
    listener.start(
      request: request(),
      ready: { result in
        do {
          let link = try result.get()
          let queue = DispatchQueue(label: "muse.test.wrong-bearer")
          let connection = NWConnection(
            host: .ipv4(.loopback), port: try XCTUnwrap(NWEndpoint.Port(rawValue: link.port)),
            using: .tcp)
          let channel = FramedConnection(connection)
          connection.start(queue: queue)
          channel.send(NativeFrame(kind: "exchange", credential: link.code)) { error in
            guard error == nil else {
              XCTFail("exchange failed")
              listener.cancel()
              return
            }
            channel.receive { result in
              do {
                let frame = try result.get()
                let request = try XCTUnwrap(frame.request)
                let token = try CallbackLink.randomToken()
                channel.send(
                  NativeFrame(kind: "reply", credential: token, reply: self.reply(request))
                ) { _ in }
              } catch {
                XCTFail("context unavailable")
                listener.cancel()
              }
            }
          }
        } catch {
          XCTFail("listener failed")
          listener.cancel()
        }
      },
      completion: { result in
        if case .success = result { XCTFail("wrong bearer approved an edit") }
        finished.fulfill()
      })
    wait(for: [finished], timeout: 5)
  }
  func testTokensNeverCreateDiskArtifacts() throws {
    let listener = CommandListener()
    let client = CommandClient()
    let finished = expectation(description: "private command")
    let acknowledged = expectation(description: "ack")
    let before = try FileManager.default.contentsOfDirectory(atPath: directory.path)
    listener.start(
      request: request(),
      ready: { result in
        do {
          let link = try result.get()
          client.connect(
            link: link,
            completion: { context in
              do {
                let request = try context.get()
                client.reply(self.reply(request)) { _ in acknowledged.fulfill() }
              } catch {
                XCTFail("context unavailable")
                listener.cancel()
                acknowledged.fulfill()
              }
            })
        } catch {
          XCTFail("listener failed")
          listener.cancel()
          acknowledged.fulfill()
        }
      }, completion: { _ in finished.fulfill() })
    wait(for: [finished, acknowledged], timeout: 5)
    XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), before)
  }
  func testRuntimeDoesNotInheritUnrelatedDescriptors() throws {
    let receipt = directory.appendingPathComponent("descriptors")
    let handle = try FileHandle(forReadingFrom: script("exit 0\n"))
    let descriptor = fcntl(handle.fileDescriptor, F_DUPFD, 512)
    guard descriptor >= 0 else { throw NativeFailure.launch }
    defer {
      Darwin.close(descriptor)
      try? handle.close()
    }
    let runtime = try script(
      "if [ -e /dev/fd/\(descriptor) ]; then printf inherited; else printf closed; fi > '\(receipt.path)'\n\(handshake)sleep 30\n"
    )
    let started = expectation(description: "descriptor-safe launch")
    let launcher = RuntimeLauncher()
    try launcher.start(
      executable: runtime, workspace: directory, launched: { _ in started.fulfill() }, exited: {})
    wait(for: [started], timeout: 5)
    launcher.stop()
    XCTAssertEqual(try String(contentsOf: receipt, encoding: .utf8), "closed")
  }

  func testNativeLanguageReadsAreRuntimeScopedAndResolveChineseScripts() {
    let previous = ProcessInfo.processInfo.environment["MUSE_UI_LANGUAGE"]
    defer {
      if let previous = previous {
        setenv("MUSE_UI_LANGUAGE", previous, 1)
      } else {
        unsetenv("MUSE_UI_LANGUAGE")
      }
    }
    for (language, expected) in [
      ("zh-Hans-CN", "打开面板"), ("zh-Hant-TW", "開啟面板"), ("de-DE", "Panel öffnen"),
      ("en-US", "Open Panel"),
    ] {
      setenv("MUSE_UI_LANGUAGE", language, 1)
      XCTAssertEqual(UI_TEXT.xcodeOpenPanel, expected)
    }
  }

  func testListenerBindsOnlyIPv4Loopback() {
    let listener = CommandListener()
    let bound = expectation(description: "loopback bind")
    let finished = expectation(description: "cleanup")
    listener.start(
      request: request(),
      ready: { result in
        do {
          let link = try result.get()
          let process = Process()
          let output = Pipe()
          process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
          process.arguments = [
            "-nP", "-a", "-p", String(getpid()), "-iTCP:\(link.port)", "-sTCP:LISTEN", "-Fn",
          ]
          process.environment = RuntimeLauncher.environment(ProcessInfo.processInfo.environment)
          process.standardOutput = output
          process.standardError = FileHandle.nullDevice
          try process.run()
          let bytes = output.fileHandleForReading.readDataToEndOfFile()
          process.waitUntilExit()
          let text = String(decoding: bytes, as: UTF8.self)
          XCTAssertEqual(process.terminationStatus, 0)
          XCTAssertTrue(text.contains("n127.0.0.1:\(link.port)"))
          XCTAssertFalse(text.contains("n*:"))
        } catch { XCTFail("could not inspect the test listener") }
        bound.fulfill()
        listener.cancel()
      }, completion: { _ in finished.fulfill() })
    wait(for: [bound, finished], timeout: 5)
  }

}
