import AppKit
import Foundation
import XCTest

// These core tests never display/activate a window, click UI, or request privacy
// access. Heterogeneous service values are narrowed after the frozen MHP check.
final class EditorServiceTests: XCTestCase {
  func testRetiredCommandCannotCommitAnApprovedBufferReply() throws {
    let text = "a😀\r\nsecond\n"
    let selection = BufferSelection(
      start: BufferPosition(line: 1, column: 0), end: BufferPosition(line: 1, column: 6))
    let request = BufferRequest(
      id: UUID().uuidString, command: .fix, text: text, selection: selection,
      contentUTI: "public.swift-source", digest: BufferEdit.digest(text))
    let reply = BufferReply(
      id: request.id, digest: request.digest, approved: true, replacement: "changed", error: nil)
    let token = MhpCancellation()
    token.cancel()
    var writes = 0
    XCTAssertThrowsError(
      try BufferEdit.commit(
        reply, request: request, current: text, currentSelection: selection, cancellation: token
      ) { _ in writes += 1 }
    ) { error in
      XCTAssertEqual(error as? NativeFailure, .cancelled)
    }
    XCTAssertEqual(writes, 0)
    let active = MhpCancellation()
    var current = text
    try BufferEdit.commit(
      reply, request: request, current: current, currentSelection: selection, cancellation: active
    ) {
      current = $0
      writes += 1
    }
    XCTAssertEqual(current, "a😀\r\nchanged\n")
    XCTAssertEqual(writes, 1)
    XCTAssertThrowsError(
      try BufferEdit.commit(
        reply, request: request, current: current, currentSelection: selection, cancellation: active
      ) { _ in writes += 1 })
    XCTAssertEqual(writes, 1, "stale buffers never enter the write callback")
  }
  func testCancellationWaitsForAnAlreadyAdmittedCommandTransaction() throws {
    let token = MhpCancellation()
    let cancelling = DispatchSemaphore(value: 0)
    let finished = DispatchSemaphore(value: 0)
    try token.withActive {
      DispatchQueue.global().async {
        cancelling.signal()
        token.cancel()
        finished.signal()
      }
      XCTAssertEqual(cancelling.wait(timeout: .now() + 1), .success)
      XCTAssertEqual(finished.wait(timeout: .now() + .milliseconds(100)), .timedOut)
    }
    XCTAssertEqual(finished.wait(timeout: .now() + 1), .success)
    XCTAssertFalse(token.isActive)
    XCTAssertThrowsError(try token.withActive { XCTFail("cancelled transaction admitted") })
  }
  func testNavigationResolvesOnlyRegularWorkspaceFiles() throws {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("temp/m104pf4/navigation-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let workspace = root.appendingPathComponent("workspace")
    let sibling = root.appendingPathComponent("workspace-other")
    try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: sibling, withIntermediateDirectories: true)
    let file = workspace.appendingPathComponent("source.swift")
    let outside = sibling.appendingPathComponent("outside.swift")
    try "source".write(to: file, atomically: true, encoding: .utf8)
    try "outside".write(to: outside, atomically: true, encoding: .utf8)
    XCTAssertEqual(
      try RuntimeLauncher.navigationFile(file, workspace: workspace, line: 1),
      file.resolvingSymlinksInPath())
    XCTAssertThrowsError(try RuntimeLauncher.navigationFile(outside, workspace: workspace, line: 1))
    let link = workspace.appendingPathComponent("link.swift")
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: outside)
    XCTAssertThrowsError(try RuntimeLauncher.navigationFile(link, workspace: workspace, line: 1))
    for line in [0, -1, Int.max] {
      XCTAssertThrowsError(
        try RuntimeLauncher.navigationFile(file, workspace: workspace, line: line))
    }
    for invalid in [
      workspace, workspace.appendingPathComponent("missing.swift"),
      URL(string: "https://example.invalid/source.swift")!,
      URL(string: "file://remote" + file.path)!,
      URL(string: "file://user:password@localhost" + file.path)!,
      URL(string: file.absoluteString + "?value=1")!,
      URL(string: file.absoluteString + "#fragment")!,
    ] {
      XCTAssertThrowsError(
        try RuntimeLauncher.navigationFile(invalid, workspace: workspace, line: 1))
    }
    let localLink = workspace.appendingPathComponent("local.swift")
    try FileManager.default.createSymbolicLink(at: localLink, withDestinationURL: file)
    XCTAssertEqual(
      try RuntimeLauncher.navigationFile(localLink, workspace: workspace, line: 1),
      file.resolvingSymlinksInPath())
  }
  @MainActor func testFocusRequiresTheBoundWindowAndApplicationActivity() throws {
    _ = NSApplication.shared
    let window = FocusWindow(contentRect: .zero, styleMask: [], backing: .buffered, defer: true)
    window.isReleasedWhenClosed = false
    defer { window.close() }
    var active = true
    let ui = NativeUi(applicationActive: { active })
    var focused: [Bool] = []
    let state: (NSWindow?) -> Void = { window in
      ui.handle("window/state", params: [:], token: MhpCancellation(), window: window) { result in
        if case .success(let value) = result, let object = value as? [String: Any],
          let value = object["focused"] as? Bool
        {
          focused.append(value)
        } else {
          XCTFail("invalid focus result")
        }
      }
    }
    state(nil)
    state(window)
    window.reportsKey = true
    state(window)
    active = false
    state(window)
    XCTAssertEqual(focused, [false, false, true, false])
    XCTAssertFalse(window.isVisible)
  }
  @MainActor func testPermissionAndFileServicesWithoutAnOwnerNeverOpenDialogs() throws {
    let ui = NativeUi(filePanelFactory: { _ in
      XCTFail("unowned dialog created")
      return NSSavePanel()
    })
    let schema = try MhpSchema()
    let requests: [(String, [String: Any])] = [
      ("ui/input", ["title": "Input", "prompt": "Value"]),
      (
        "ui/confirm",
        [
          "title": "Paid use", "message": "$1.00 shared budget",
          "choices": [["id": "deny", "title": "Deny"]],
        ]
      ),
      ("ui/pick", ["title": "Pick", "items": [["id": 1, "title": "Choice"]], "multiple": false]),
      ("ui/openFile", ["title": "Open"]),
      ("ui/saveText", ["title": "Save", "suggestedName": "report.md", "text": "export"]),
    ]
    var replies = 0
    for (method, params) in requests {
      try schema.check(
        ["jsonrpc": "2.0", "id": 1, "method": method, "params": params], method: method)
      ui.handle(method, params: params, token: MhpCancellation(), window: nil) { result in
        guard case .failure(let error) = result else {
          XCTFail("unowned permission succeeded")
          return
        }
        XCTAssertEqual(error as? NativeFailure, .unavailable)
        replies += 1
      }
    }
    XCTAssertEqual(replies, requests.count)
  }
  @MainActor func testCancelledServiceCannotPublishOrAnswerInAnotherOwner() {
    let ui = NativeUi(applicationActive: { true })
    let token = MhpCancellation()
    token.cancel()
    for method in ["ui/notify", "ui/status", "ui/progress", "window/state", "ui/openFile"] {
      ui.handle(
        method, params: ["id": "stale", "message": "late", "visible": true, "text": "late"],
        token: token, window: nil
      ) { _ in XCTFail("retired service answered") }
    }
    XCTAssertNil(ui.notice)
    XCTAssertTrue(ui.statuses.isEmpty)
    XCTAssertTrue(ui.progress.isEmpty)
  }
}

@MainActor private final class FocusWindow: NSWindow {
  var reportsKey = false
  override var isKeyWindow: Bool { reportsKey }
}
