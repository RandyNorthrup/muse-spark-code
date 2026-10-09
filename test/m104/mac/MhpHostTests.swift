import Foundation
import XCTest

final class MhpHostTests: XCTestCase {
  func testClosedClientCannotRestartAnAuthenticatedCommandExchange() throws {
    let ready = expectation(description: "closed client refused")
    let listenerClosed = expectation(description: "listener cleanup")
    let request = BufferRequest(
      id: UUID().uuidString, command: .ask, text: "value",
      selection: BufferSelection(
        start: BufferPosition(line: 0, column: 0), end: BufferPosition(line: 0, column: 0)),
      contentUTI: "public.swift-source", digest: BufferEdit.digest("value"))
    let listener = CommandListener()
    let client = CommandClient()
    var closes = 0
    client.close()
    listener.start(
      request: request,
      ready: { result in
        guard case .success(let link) = result else {
          XCTFail("fixture listener failed")
          return
        }
        client.connect(
          link: link,
          completion: { result in
            if case .success = result {
              XCTFail("closed client exchanged the launch credential")
            } else if case .failure(let error) = result {
              XCTAssertEqual(error as? NativeFailure, .cancelled)
            }
            ready.fulfill()
          }, closed: { closes += 1 })
      }, completion: { _ in listenerClosed.fulfill() })
    wait(for: [ready], timeout: 1)
    client.close()
    listener.cancel()
    wait(for: [listenerClosed], timeout: 1)
    XCTAssertEqual(closes, 1)
  }
  func testCancelledBeforeStartupNeverCreatesACommandListener() throws {
    let ready = expectation(description: "cancelled startup")
    let completed = expectation(description: "cancelled command")
    let listener = CommandListener()
    listener.cancel()
    let request = BufferRequest(
      id: UUID().uuidString, command: .ask, text: "value",
      selection: BufferSelection(
        start: BufferPosition(line: 0, column: 0), end: BufferPosition(line: 0, column: 0)),
      contentUTI: "public.swift-source", digest: BufferEdit.digest("value"))
    listener.start(
      request: request,
      ready: { result in
        if case .success = result { XCTFail("cancelled listener opened a port") }
        ready.fulfill()
      },
      completion: { result in
        if case .failure(let error) = result {
          XCTAssertEqual(error as? NativeFailure, .cancelled)
        } else {
          XCTFail("cancelled listener completed successfully")
        }
        completed.fulfill()
      })
    wait(for: [ready, completed], timeout: 1)
    listener.cancel()
  }
  func testRepeatedListenerStartupPreservesTheFirstOwner() throws {
    let firstReady = expectation(description: "original listener")
    let secondReady = expectation(description: "repeated start rejected")
    let firstCompleted = expectation(description: "original cancellation")
    let secondCompleted = expectation(description: "repeated invocation rejected")
    let listener = CommandListener()
    let request = BufferRequest(
      id: UUID().uuidString, command: .ask, text: "value",
      selection: BufferSelection(
        start: BufferPosition(line: 0, column: 0), end: BufferPosition(line: 0, column: 0)),
      contentUTI: "public.swift-source", digest: BufferEdit.digest("value"))
    listener.start(
      request: request,
      ready: { result in
        if case .failure = result { XCTFail("original listener failed") }
        firstReady.fulfill()
      },
      completion: { result in
        if case .failure(let error) = result {
          XCTAssertEqual(error as? NativeFailure, .cancelled)
        } else {
          XCTFail("original cancellation lost")
        }
        firstCompleted.fulfill()
      })
    listener.start(
      request: request,
      ready: { result in
        if case .success = result { XCTFail("duplicate listener opened a port") }
        secondReady.fulfill()
      },
      completion: { result in
        if case .failure(let error) = result {
          XCTAssertEqual(error as? NativeFailure, .invalid)
        } else {
          XCTFail("duplicate invocation succeeded")
        }
        secondCompleted.fulfill()
      })
    wait(for: [firstReady, secondReady, secondCompleted], timeout: 1)
    listener.cancel()
    wait(for: [firstCompleted], timeout: 1)
  }
  func testRequestIdWindowEvictsOnlyCompletedIdsAndRetainsTypedIdentity() throws {
    let responses = expectation(description: "completed requests")
    responses.expectedFulfillmentCount = NativeMhp.maximumQueuedMessages + 2
    var errors: [String] = []
    let session = MhpSession(
      schema: try MhpSchema(),
      write: { data in
        guard let frame = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          frame["method"] == nil
        else { return }
        if let error = frame["error"] as? [String: Any], let message = error["message"] as? String {
          errors.append(message)
        }
        responses.fulfill()
      }, launch: { _ in }, failed: { XCTFail("id window closed session") },
      service: { _, _, _, reply in reply(.success(NSNull())) })
    try session.start(
      workspace: URL(fileURLWithPath: "/workspace"), locale: "en",
      theme: ["kind": "dark", "tokens": [String: String]()], trusted: false)
    session.receive(try bytes(initialized()))
    for id in 0..<NativeMhp.maximumQueuedMessages + 1 {
      session.receive(
        try bytes([
          "jsonrpc": "2.0", "id": id, "method": "ui/clipboard", "params": ["text": "value"],
        ]))
    }
    // receive is synchronous on the same queue: every preceding callback settles
    // before the next admission, exercising more completions than the window holds.
    session.receive(
      try bytes(["jsonrpc": "2.0", "id": 0, "method": "ui/clipboard", "params": ["text": "again"]]))
    wait(for: [responses], timeout: 1)
    XCTAssertTrue(errors.isEmpty)
    let count = expectation(description: "numeric duplicate and distinct string id")
    // Separate session avoids replacing the production response observer.
    session.close()
    var failures = 0
    let typed = MhpSession(
      schema: try MhpSchema(),
      write: { data in
        if let frame = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          frame["error"] != nil
        {
          failures += 1
        }
      }, launch: { _ in }, failed: { XCTFail("duplicate closed session") },
      service: { _, _, _, _ in count.fulfill() })
    count.expectedFulfillmentCount = 2
    try typed.start(
      workspace: URL(fileURLWithPath: "/workspace"), locale: "en",
      theme: ["kind": "dark", "tokens": [String: String]()], trusted: false)
    typed.receive(try bytes(initialized()))
    for id: Any in [1, "1", 1] {
      typed.receive(
        try bytes([
          "jsonrpc": "2.0", "id": id, "method": "ui/input",
          "params": ["title": "held", "prompt": "value"],
        ]))
    }
    wait(for: [count], timeout: 1)
    XCTAssertEqual(failures, 1)
    typed.close()
  }
  func testNativeFailuresAndMalformedResultsUseTheFrozenErrorCodes() throws {
    let sent = expectation(description: "all native failures")
    let faults: [NativeFailure] = [.denied, .changed, .invalid, .cancelled, .unavailable, .launch]
    sent.expectedFulfillmentCount = faults.count + 1
    var codes: [Int] = []
    let session = MhpSession(
      schema: try MhpSchema(),
      write: { data in
        if let frame = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let error = frame["error"] as? [String: Any], let code = error["code"] as? Int
        {
          codes.append(code)
          sent.fulfill()
        }
      }, launch: { _ in }, failed: { XCTFail("native failure closed session") },
      service: { _, params, _, reply in
        if let text = params["text"] as? String, let failure = NativeFailure(rawValue: text) {
          reply(.failure(failure))
        } else {
          reply(.success("invalid clipboard result"))
        }
      })
    try session.start(
      workspace: URL(fileURLWithPath: "/workspace"), locale: "en",
      theme: ["kind": "dark", "tokens": [String: String]()], trusted: false)
    session.receive(try bytes(initialized()))
    for (id, failure) in faults.enumerated() {
      session.receive(
        try bytes([
          "jsonrpc": "2.0", "id": id, "method": "ui/clipboard",
          "params": ["text": failure.rawValue],
        ]))
    }
    session.receive(
      try bytes([
        "jsonrpc": "2.0", "id": "invalid", "method": "ui/clipboard", "params": ["text": "value"],
      ]))
    wait(for: [sent], timeout: 1)
    XCTAssertEqual(codes, [-32006, -32003, -32602, -32800, -32002, -32603, -32603])
    try session.trust(false)
    session.close()
  }
  func testSnapshotVersionIsPinnedBeforeLaunching() throws {
    var contract = try MhpSchema().contract
    contract["protocol"] = "mhp/1.1.0"
    XCTAssertThrowsError(try MhpSchema(data: JSONSerialization.data(withJSONObject: contract)))
  }
  func testTrustNotificationRetainsTheInitializedSessionAndRefusesAfterClose() throws {
    var writes: [Data] = []
    let session = MhpSession(
      schema: try MhpSchema(), write: { writes.append($0) }, launch: { _ in },
      failed: { XCTFail("trust closed session") },
      service: { _, _, _, reply in reply(.success(NSNull())) })
    XCTAssertThrowsError(try session.trust(true))
    try session.start(
      workspace: URL(fileURLWithPath: "/tmp/workspace"), locale: "en",
      theme: ["kind": "dark", "tokens": [String: String]()], trusted: false)
    session.receive(try bytes(initialized()))
    for trusted in [true, false] {
      try session.trust(trusted)
      let frame = try XCTUnwrap(
        JSONSerialization.jsonObject(with: XCTUnwrap(writes.last)) as? [String: Any])
      try MhpSchema().check(frame, method: "workspace/didChangeTrust")
      XCTAssertEqual((frame["params"] as? [String: Any])?["trusted"] as? Bool, trusted)
    }
    session.close()
    XCTAssertThrowsError(try session.trust(true))
  }
  func testRequestFaultsPreserveUnrelatedNativeWork() throws {
    for scenario in ["duplicate", "wrong-direction", "invalid-params", "overflow", "unknown"] {
      var failures = 0
      var tokens: [MhpCancellation] = []
      var writes: [Data] = []
      let session = MhpSession(
        schema: try MhpSchema(), write: { writes.append($0) }, launch: { _ in },
        failed: { failures += 1 },
        service: { _, _, token, _ in tokens.append(token) })
      try session.start(
        workspace: URL(fileURLWithPath: "/tmp/workspace"), locale: "en",
        theme: ["kind": "dark", "tokens": [String: String]()], trusted: false)
      session.receive(try bytes(initialized()))
      let frame: [String: Any] = [
        "jsonrpc": "2.0", "id": "held", "method": "ui/input",
        "params": ["title": "prompt", "prompt": "value"],
      ]
      session.receive(try bytes(frame))
      switch scenario {
      case "duplicate": session.receive(try bytes(frame))
      case "wrong-direction":
        session.receive(
          try bytes(["jsonrpc": "2.0", "id": 1, "method": "shutdown", "params": [:]]))
      case "invalid-params":
        session.receive(
          try bytes([
            "jsonrpc": "2.0", "id": 2, "method": "ui/input",
            "params": ["title": "prompt", "prompt": "value", "extra": true],
          ]))
      case "overflow":
        for id in 0..<NativeMhp.maximumQueuedMessages {
          var next = frame
          next["id"] = id
          session.receive(try bytes(next))
        }
      default:
        session.receive(try bytes(["jsonrpc": "2.0", "id": 2, "method": "unknown", "params": [:]]))
      }
      XCTAssertEqual(failures, 0, scenario)
      XCTAssertTrue(tokens.allSatisfy { $0.isActive }, scenario)
      let reply = try XCTUnwrap(
        JSONSerialization.jsonObject(with: XCTUnwrap(writes.last)) as? [String: Any])
      try MhpSchema().checkFailure(reply)
      let error = try XCTUnwrap(reply["error"] as? [String: Any])
      XCTAssertEqual(
        error["code"] as? Int,
        scenario == "invalid-params" ? -32602 : scenario == "unknown" ? -32601 : -32600, scenario)
      session.close()
      XCTAssertTrue(tokens.allSatisfy { !$0.isActive }, scenario)
    }
  }
  func testFrozenUnionTypesAndArrayLimitsAreEnforced() throws {
    let schema = try MhpSchema()
    for value: Any in [NSNull(), "value"] {
      try schema.check(
        ["jsonrpc": "2.0", "id": 1, "result": value], method: "ui/input", result: true)
    }
    for value: Any in [true, 1, [], [:]] {
      XCTAssertThrowsError(
        try schema.check(
          ["jsonrpc": "2.0", "id": 1, "result": value], method: "ui/input", result: true))
    }
    let alternatives: [String: Any] = ["oneOf": [["type": "string"], ["type": "number"]]]
    XCTAssertThrowsError(try MhpSchema.validate(true, schema: alternatives, root: alternatives))
    let ambiguous: [String: Any] = ["oneOf": [["type": "number"], ["type": "integer"]]]
    XCTAssertThrowsError(try MhpSchema.validate(1, schema: ambiguous, root: ambiguous))
    let bounded: [String: Any] = ["type": "array", "maxItems": 1, "items": ["type": "string"]]
    XCTAssertThrowsError(try MhpSchema.validate(["a", "b"], schema: bounded, root: bounded))
  }
  func testUnboundPanelFaultsDoNotCloseTheCompanionRelay() throws {
    var writes: [Data] = []
    let session = MhpSession(
      schema: try MhpSchema(), write: { writes.append($0) }, launch: { _ in },
      failed: { XCTFail("panel fault closed unrelated relay") },
      service: { _, _, _, _ in XCTFail("panel dispatched") })
    try session.start(
      workspace: URL(fileURLWithPath: "/workspace"), locale: "en",
      theme: ["kind": "dark", "tokens": [String: String]()], trusted: false)
    session.receive(try bytes(initialized()))
    for (frame, code) in [
      (
        [
          "mhp": "1.4", "kind": "panel", "surface": "missing", "seq": 1, "direction": "toPanel",
          "payload": ["type": "ready"],
        ] as [String: Any], "MHP_PANEL_UNKNOWN_SURFACE"
      ),
      (
        [
          "mhp": "1.4", "kind": "panel", "surface": "missing", "seq": true, "direction": "toPanel",
          "payload": [:],
        ], "MHP_PANEL_INVALID_ENVELOPE"
      ),
      (
        [
          "mhp": "1.4", "kind": "surface", "surface": "missing", "sessionId": "session",
          "surfaceKind": "chat", "event": "ready",
        ], "MHP_PANEL_UNKNOWN_SURFACE"
      ),
      (
        [
          "mhp": "1.4", "kind": "surface", "surface": "missing", "sessionId": "session",
          "surfaceKind": "chat", "event": "bogus",
        ], "MHP_PANEL_INVALID_LIFECYCLE"
      ),
    ] {
      session.receive(try bytes(frame))
      let reply = try XCTUnwrap(
        JSONSerialization.jsonObject(with: XCTUnwrap(writes.last)) as? [String: Any])
      XCTAssertEqual(reply["kind"] as? String, "panelError")
      XCTAssertEqual(reply["code"] as? String, code)
    }
    let count = writes.count
    session.receive(
      try bytes([
        "mhp": "1.4", "kind": "panelError", "surface": NSNull(), "seq": NSNull(),
        "code": "MHP_PANEL_UNKNOWN_SURFACE",
      ]))
    XCTAssertEqual(writes.count, count, "remote channel faults must not echo")
    try session.trust(true)
    session.close()
  }
  func testMalformedRemotePanelErrorsPreserveHeldNativeRequests() throws {
    var writes: [Data] = []
    var held: ((Result<Any, Error>) -> Void)?
    var heldToken: MhpCancellation?
    let answered = expectation(description: "held input answered after channel faults")
    let schema = try MhpSchema()
    let session = MhpSession(
      schema: schema,
      write: { data in
        writes.append(data)
        if let frame = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          frame["id"] as? String == "held", frame["result"] != nil
        {
          answered.fulfill()
        }
      }, launch: { _ in }, failed: { XCTFail("remote panel error closed unrelated relay") },
      service: { method, _, token, reply in
        if method == "ui/input" {
          held = reply
          heldToken = token
        } else {
          reply(.success(NSNull()))
        }
      })
    defer { session.close() }
    try session.start(
      workspace: URL(fileURLWithPath: "/workspace"), locale: "en",
      theme: ["kind": "dark", "tokens": [String: String]()], trusted: false)
    session.receive(try bytes(initialized()))
    session.receive(
      try bytes([
        "jsonrpc": "2.0", "id": "held", "method": "ui/input",
        "params": ["title": "held", "prompt": "value"],
      ]))
    let count = writes.count
    let invalid: [[String: Any]] = [
      ["mhp": "1.4", "kind": "panelError", "code": "MHP_PANEL_UNKNOWN_SURFACE"],
      [
        "mhp": "1.4", "kind": "panelError", "surface": "unknown", "seq": 1,
        "code": "MHP_PANEL_UNKNOWN_SURFACE", "extra": true,
      ],
      ["mhp": "1.4", "kind": "panelError", "surface": "unknown", "seq": 1, "code": "new-code"],
    ]
    for frame in invalid {
      XCTAssertThrowsError(try schema.checkPanel(frame, kind: "error"))
      session.receive(try bytes(frame))
      XCTAssertTrue(try XCTUnwrap(heldToken).isActive)
      XCTAssertEqual(writes.count, count, "unbound remote faults must not echo")
    }
    session.receive(
      try bytes([
        "mhp": "1.4", "kind": "panel", "surface": "another-channel", "seq": 1,
        "direction": "toPanel", "payload": ["type": "ready"],
      ]))
    let channelReply = try XCTUnwrap(
      JSONSerialization.jsonObject(with: XCTUnwrap(writes.last)) as? [String: Any])
    XCTAssertEqual(channelReply["surface"] as? String, "another-channel")
    XCTAssertEqual(channelReply["code"] as? String, "MHP_PANEL_UNKNOWN_SURFACE")
    try session.trust(true)
    try XCTUnwrap(held)(.success("answer"))
    wait(for: [answered], timeout: 1)
    try schema.check(
      XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(writes.last)) as? [String: Any]),
      method: "ui/input", result: true)
  }
  private func bytes(_ frame: [String: Any]) throws -> Data {
    var data = try JSONSerialization.data(withJSONObject: frame)
    data.append(10)
    return data
  }
  private func initialized(_ version: String = "mhp/1.4.0") -> [String: Any] {
    [
      "jsonrpc": "2.0", "id": "xcode-initialize",
      "result": [
        "protocolVersion": version, "capabilities": ["lifecycle", "settings", "storage"],
      ],
    ]
  }
  func testEditorInitiatesWithReviewedMetadataBeforeAnyRuntimeRequest() throws {
    var sent: [Data] = []
    var launched = false
    let session = MhpSession(
      schema: try MhpSchema(), write: { sent.append($0) }, launch: { _ in launched = true },
      failed: { XCTFail("valid frame refused") },
      service: { _, _, _, reply in reply(.failure(NativeFailure.unavailable)) })
    try session.start(
      workspace: URL(fileURLWithPath: "/tmp/workspace"), locale: "de-DE",
      theme: ["kind": "light", "tokens": ["--muse-color": "red"]], trusted: false)
    let frame = try XCTUnwrap(
      JSONSerialization.jsonObject(with: XCTUnwrap(sent.first)) as? [String: Any])
    try MhpSchema().check(frame, method: "initialize")
    let params = try XCTUnwrap(frame["params"] as? [String: Any])
    XCTAssertEqual(params["locale"] as? String, "de-DE")
    XCTAssertEqual(params["trusted"] as? Bool, false)
    XCTAssertEqual(params["capabilities"] as? [String], ["lifecycle", "ui", "window"])
    session.receive(try bytes(initialized()))
    let uri = "http://127.0.0.1:1234/#k=" + String(repeating: "a", count: 64)
    session.receive(
      try bytes(["jsonrpc": "2.0", "id": 1, "method": "ui/openExternal", "params": ["uri": uri]]))
    XCTAssertTrue(launched)
    let reply = try XCTUnwrap(
      JSONSerialization.jsonObject(with: XCTUnwrap(sent.last)) as? [String: Any])
    try MhpSchema().check(reply, method: "ui/openExternal", result: true)
    session.close()
  }
  func testLegacyVersionAndRuntimeInitiationAreRefused() throws {
    for frame in [
      initialized("mhp/1.1.0"), initialized("mhp/1.2.0"),
      ["jsonrpc": "2.0", "id": 1, "method": "initialize", "params": [:]],
    ] {
      var failures = 0
      let session = MhpSession(
        schema: try MhpSchema(), write: { _ in }, launch: { _ in XCTFail("uninitialized launch") },
        failed: { failures += 1 }, service: { _, _, _, _ in XCTFail("uninitialized service") })
      try session.start(
        workspace: URL(fileURLWithPath: "/tmp/workspace"), locale: "en",
        theme: ["kind": "dark", "tokens": [String: String]()], trusted: true)
      session.receive(try bytes(frame))
      XCTAssertEqual(failures, 1)
      session.receive(try bytes(initialized()))
      XCTAssertEqual(failures, 1)
      session.close()
    }
  }
  func testStrictSchemaRejectsAdditionsBooleanIntegersAndMissingLifecycle() throws {
    let schema = try MhpSchema()
    var reply = initialized()
    reply["extra"] = true
    XCTAssertThrowsError(try schema.check(reply, method: "initialize", result: true))
    reply = initialized()
    reply["result"] = ["protocolVersion": NativeMhp.version, "capabilities": ["ui"]]
    XCTAssertThrowsError(try schema.check(reply, method: "initialize", result: true))
    reply["result"] = [
      "protocolVersion": NativeMhp.version, "capabilities": ["lifecycle", "lifecycle"],
    ]
    XCTAssertThrowsError(try schema.check(reply, method: "initialize", result: true))
    reply = initialized()
    reply["id"] = true
    XCTAssertThrowsError(try schema.check(reply, method: "initialize", result: true))
    reply["id"] = NSNumber(value: 9_007_199_254_740_992)
    XCTAssertThrowsError(try schema.check(reply, method: "initialize", result: true))
  }
  func testCancelledServiceLateReplyCannotAffectAnotherRequest() throws {
    let entered = expectation(description: "service")
    let sentReply = expectation(description: "two replies")
    sentReply.expectedFulfillmentCount = 2
    var replyCount = 0
    var held: ((Result<Any, Error>) -> Void)?
    var token: MhpCancellation?
    let session = MhpSession(
      schema: try MhpSchema(),
      write: { data in
        if let frame = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          frame["method"] == nil
        {
          replyCount += 1
          if replyCount <= 2 { sentReply.fulfill() }
        }
      }, launch: { _ in }, failed: { XCTFail("cancellation closed session") },
      service: { method, _, cancellation, reply in
        if method == "ui/input" {
          held = reply
          token = cancellation
          entered.fulfill()
        } else {
          reply(.success(NSNull()))
        }
      })
    try session.start(
      workspace: URL(fileURLWithPath: "/tmp/workspace"), locale: "en",
      theme: ["kind": "dark", "tokens": [String: String]()], trusted: false)
    session.receive(try bytes(initialized()))
    session.receive(
      try bytes([
        "jsonrpc": "2.0", "id": 1, "method": "ui/input",
        "params": ["title": "prompt", "prompt": "value"],
      ]))
    wait(for: [entered], timeout: 1)
    session.receive(
      try bytes(["jsonrpc": "2.0", "method": "$/cancelRequest", "params": ["id": 1]]))
    XCTAssertFalse(try XCTUnwrap(token).isActive)
    held?(.success("late value"))
    session.receive(
      try bytes(["jsonrpc": "2.0", "id": 2, "method": "ui/clipboard", "params": ["text": "value"]]))
    wait(for: [sentReply], timeout: 1)
    session.close()
    XCTAssertEqual(replyCount, 2)
  }
  func testPartialCoalescedFramesAndMalformedUTF8() throws {
    var failures = 0
    let session = MhpSession(
      schema: try MhpSchema(), write: { _ in }, launch: { _ in }, failed: { failures += 1 },
      service: { _, _, _, reply in reply(.success(NSNull())) })
    try session.start(
      workspace: URL(fileURLWithPath: "/tmp/workspace"), locale: "en",
      theme: ["kind": "dark", "tokens": [String: String]()], trusted: false)
    let frame = try bytes(initialized())
    session.receive(frame.prefix(1))
    session.receive(frame.dropFirst(1))
    XCTAssertEqual(failures, 0)
    session.receive(Data([0xFF, 10]))
    XCTAssertEqual(failures, 1)
    session.close()
  }
  func testUnadvertisedServiceRefusesBeforeSideEffect() throws {
    var replies: [Data] = []
    let session = MhpSession(
      schema: try MhpSchema(), write: { replies.append($0) }, launch: { _ in },
      failed: { XCTFail("unavailable service closed session") },
      service: { _, _, _, _ in XCTFail("unadvertised service dispatched") })
    try session.start(
      workspace: URL(fileURLWithPath: "/tmp/workspace"), locale: "en",
      theme: ["kind": "dark", "tokens": [String: String]()], trusted: false)
    session.receive(try bytes(initialized()))
    let calls: [(String, [String: Any])] = [
      ("editor/open", ["uri": "file:///workspace/file.swift"]),
      ("documents/list", [:]),
      ("tab/register", ["languages": ["swift"], "trigger": "invoke"]),
      ("voice/capture", ["action": "start"]),
      (
        "codeIntel/hover",
        ["uri": "file:///workspace/file.swift", "position": ["line": 0, "character": 0]]
      ),
    ]
    for (id, call) in calls.enumerated() {
      session.receive(try bytes(["jsonrpc": "2.0", "id": id, "method": call.0, "params": call.1]))
      let failure = try XCTUnwrap(
        JSONSerialization.jsonObject(with: XCTUnwrap(replies.last)) as? [String: Any])
      try MhpSchema().checkFailure(failure)
      XCTAssertEqual(
        (failure["error"] as? [String: Any])?["message"] as? String, "MHP_UNSUPPORTED_CAPABILITY",
        call.0)
    }
    session.close()
  }
}
