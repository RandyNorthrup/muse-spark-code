import AppKit
import WebKit
import XCTest

@testable import MuseSpark

final class NativeUiTests: XCTestCase {
  func testAppAndEditorExtensionPackageTheLinkedStarDescription() throws {
    let sentence = "Enjoying Muse Spark Code? A star on GitHub helps other people find it."
    let link = "<a href=\"https://github.com/RandyNorthrup/muse-spark-code\">\(sentence)</a>"
    let app = try XCTUnwrap(Bundle.main.url(forResource: "description", withExtension: "html"))
    let editor = Bundle.main.bundleURL.appendingPathComponent(
      "Contents/PlugIns/MuseSparkEditor.appex/Contents/Resources/description.html")
    for file in [app, editor] {
      let html = try String(contentsOf: file, encoding: .utf8)
        .replacingOccurrences(of: "\\s+>", with: ">", options: .regularExpression)
      XCTAssertTrue(html.contains(link))
    }
  }
  @MainActor func testNativeAppearanceIncludesBothHighContrastKinds() throws {
    let schema = try MhpSchema()
    for (dark, contrast, expected) in [
      (false, false, "light"), (true, false, "dark"),
      (false, true, "highContrastLight"), (true, true, "highContrastDark"),
    ] {
      let kind = PanelModel.themeKind(dark: dark, contrast: contrast)
      XCTAssertEqual(kind, expected)
      let session = MhpSession(
        schema: schema, write: { _ in }, launch: { _ in },
        failed: {
          XCTFail("appearance rejected")
        }, service: { _, _, _, _ in })
      try session.start(
        workspace: URL(fileURLWithPath: "/workspace"), locale: "en",
        theme: ["kind": kind, "tokens": [String: String]()], trusted: false)
      session.close()
    }
  }
  @MainActor func testTrustCannotDivergeWhileInitializationIsPending() throws {
    let model = PanelModel()
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    let runtime = root.appendingPathComponent("temp/m104pf/trust-runtime.sh")
    try "#!/bin/sh\nsleep 30\n".write(to: runtime, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: runtime.path)
    defer {
      model.stop()
      try? FileManager.default.removeItem(at: runtime)
    }
    model.workspace = root
    model.runtime = runtime
    model.start()
    model.setTrust(true)
    XCTAssertFalse(model.trusted)
    XCTAssertEqual(model.error, UI_TEXT.xcodeUnavailable)
  }
  @MainActor private func picker(in view: NSView) -> NSPopUpButton? {
    if let picker = view as? NSPopUpButton { return picker }
    for child in view.subviews { if let found = picker(in: child) { return found } }
    return nil
  }
  @MainActor func testSinglePickerReturnsTheSelectedOpaqueNumericId() async throws {
    let ui = NativeUi()
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 100, height: 100), styleMask: [.titled],
      backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    defer {
      ui.close()
      window.close()
    }
    let answered = expectation(description: "selected opaque id")
    ui.handle(
      "ui/pick",
      params: [
        "title": "Choose",
        "items": [["id": "first", "title": "First"], ["id": 42, "title": "Second"]],
        "multiple": false,
      ], token: MhpCancellation(), window: window
    ) { result in
      XCTAssertEqual(try? result.get() as? [Int], [42])
      answered.fulfill()
    }
    let sheet = try XCTUnwrap(window.attachedSheet)
    let content = try XCTUnwrap(sheet.contentView)
    try XCTUnwrap(picker(in: content)).selectItem(at: 1)
    try XCTUnwrap(button("Continue", in: content)).performClick(nil)
    await fulfillment(of: [answered], timeout: 1)
  }
  @MainActor private func button(_ title: String, in view: NSView) -> NSButton? {
    if let button = view as? NSButton, button.title == title { return button }
    for child in view.subviews { if let found = button(title, in: child) { return found } }
    return nil
  }
  @MainActor func testPaidChoiceReturnsOpaqueDenyIdOnceAndCancelsSheet() async throws {
    let ui = NativeUi()
    let token = MhpCancellation()
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 100, height: 100), styleMask: [.titled],
      backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    defer {
      ui.close()
      window.close()
    }
    let answered = expectation(description: "opaque denied answer")
    ui.handle(
      "ui/confirm",
      params: [
        "title": "Paid use", "message": "Price $0.01; daily budget $1.00",
        "choices": [
          ["id": "opaque-once", "title": "Allow once"], ["id": "opaque-deny", "title": "Deny"],
        ],
      ], token: token, window: window
    ) { result in
      XCTAssertEqual(try? result.get() as? String, "opaque-deny")
      answered.fulfill()
    }
    let sheet = try XCTUnwrap(window.attachedSheet)
    let deny = try XCTUnwrap(button("Deny", in: try XCTUnwrap(sheet.contentView)))
    deny.performClick(nil)
    await fulfillment(of: [answered], timeout: 1)
    XCTAssertNil(window.attachedSheet)
  }
  @MainActor func testCancelledPermissionCannotReturnLateAnswer() async throws {
    let ui = NativeUi()
    let token = MhpCancellation()
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 100, height: 100), styleMask: [.titled],
      backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    defer {
      ui.close()
      window.close()
    }
    var replies = 0
    ui.handle(
      "ui/input", params: ["title": "Input", "prompt": "Value"], token: token, window: window
    ) { _ in replies += 1 }
    XCTAssertNotNil(window.attachedSheet)
    token.cancel()
    await Task.yield()
    // The native cancellation callback has to run on the AppKit queue.
    let drained = expectation(description: "UI cancellation drained")
    DispatchQueue.main.async { drained.fulfill() }
    await fulfillment(of: [drained], timeout: 1)
    XCTAssertNil(window.attachedSheet)
    XCTAssertEqual(replies, 0)
  }
  @MainActor func testStatusProgressAndCloseUseActualPublishedState() throws {
    let ui = NativeUi()
    let token = MhpCancellation()
    var replies = 0
    let reply: (Result<Any, Error>) -> Void = { result in
      if case .failure = result { XCTFail("native service failed") }
      replies += 1
    }
    ui.handle(
      "ui/status", params: ["id": "one", "text": "status", "visible": true], token: token,
      window: nil, reply: reply)
    ui.handle(
      "ui/progress", params: ["id": "two", "title": "work", "message": "working", "done": false],
      token: token, window: nil, reply: reply)
    ui.handle(
      "ui/notify", params: ["severity": "information", "message": "notice"], token: token,
      window: nil, reply: reply)
    XCTAssertEqual(Array(ui.statuses.values), ["status"])
    XCTAssertEqual(Array(ui.progress.values), ["working"])
    XCTAssertEqual(ui.notice, "notice")
    ui.close()
    XCTAssertEqual(replies, 3)
    XCTAssertTrue(ui.statuses.isEmpty)
    XCTAssertTrue(ui.progress.isEmpty)
    XCTAssertNil(ui.notice)
  }
  @MainActor func testSameOriginFreshLaunchReloadsAndOldClearCannotEraseNewLink() async throws {
    let model = PanelModel()
    let view = WKWebView(frame: .zero)
    let coordinator = PanelWebView.Coordinator(model: model)
    model.connected = true
    model.launch = try LaunchLink("http://127.0.0.1:1234/#k=" + String(repeating: "a", count: 64))
    coordinator.load(view)
    let previous = coordinator.loadedGeneration
    model.launchGeneration = UUID()
    model.launch = try LaunchLink("http://127.0.0.1:1234/#k=" + String(repeating: "b", count: 64))
    let newest = model.launchGeneration
    await Task.yield()
    XCTAssertNotNil(model.launch)
    coordinator.load(view)
    XCTAssertEqual(coordinator.loadedGeneration, newest)
    XCTAssertNotEqual(coordinator.loadedGeneration, previous)
    XCTAssertNil(coordinator.loadedOrigin?.fragment)
    model.stop()
    view.stopLoading()
  }
}
