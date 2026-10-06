import Foundation
import XCTest

final class MhpHostTests: XCTestCase {
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
  func testDuplicateIdsInvalidCallsAndQueueOverflowCancelNativeWork() throws {
    for scenario in ["duplicate", "wrong-direction", "invalid-params", "overflow"] {
      var failures = 0
      var tokens: [MhpCancellation] = []
      let session = MhpSession(
        schema: try MhpSchema(), write: { _ in }, launch: { _ in }, failed: { failures += 1 },
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
      default:
        for id in 0..<NativeMhp.maximumQueuedMessages {
          var next = frame
          next["id"] = id
          session.receive(try bytes(next))
        }
      }
      XCTAssertEqual(failures, 1, scenario)
      XCTAssertTrue(tokens.allSatisfy { !$0.isActive }, scenario)
      session.close()
    }
  }
  private func bytes(_ frame: [String: Any]) throws -> Data {
    var data = try JSONSerialization.data(withJSONObject: frame)
    data.append(10)
    return data
  }
  private func initialized(_ version: String = "mhp/1.2.0") -> [String: Any] {
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
      initialized("mhp/1.1.0"), ["jsonrpc": "2.0", "id": 1, "method": "initialize", "params": [:]],
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
    session.receive(
      try bytes([
        "jsonrpc": "2.0", "id": 1, "method": "editor/open",
        "params": ["uri": "file:///tmp/workspace/file.swift"],
      ]))
    let failure = try XCTUnwrap(
      JSONSerialization.jsonObject(with: XCTUnwrap(replies.last)) as? [String: Any])
    try MhpSchema().checkFailure(failure)
    XCTAssertEqual(
      (failure["error"] as? [String: Any])?["message"] as? String, "MHP_UNSUPPORTED_CAPABILITY")
    session.close()
  }
}
