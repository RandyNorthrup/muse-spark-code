import AppKit
import WebKit
import XCTest

@testable import MuseSpark

final class NativeUiTests: XCTestCase {
  @MainActor func testClosedFileChoiceCannotWriteOverAReplacementDialog() async throws {
    let panel = FileServicePanel()
    let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    panel.selected = file
    defer { try? FileManager.default.removeItem(at: file) }
    let ui = NativeUi(filePanelFactory: { _ in panel })
    let window = NSWindow()
    window.isReleasedWhenClosed = false
    defer {
      ui.close()
      window.close()
    }
    var replies = 0
    let oldToken = MhpCancellation()
    ui.handle(
      "ui/saveText", params: ["title": "Export", "suggestedName": "report.md", "text": "old"],
      token: oldToken, window: window
    ) { _ in replies += 1 }
    let late = panel.complete
    ui.close()
    ui.handle(
      "ui/saveText", params: ["title": "Export", "suggestedName": "report.md", "text": "new"],
      token: MhpCancellation(), window: window
    ) { _ in replies += 1 }
    late?(.OK)
    XCTAssertEqual(replies, 0)
    XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    oldToken.cancel()
    let drained = expectation(description: "old dialog cancellation")
    DispatchQueue.main.async { drained.fulfill() }
    await fulfillment(of: [drained], timeout: 1)
    XCTAssertEqual(panel.cancels, 1)
    panel.respond(.OK)
    XCTAssertEqual(replies, 1)
    XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "new")
  }
  @MainActor func testFileDialogRejectsOverlappingFileAndPermissionSheets() throws {
    let panel = FileServicePanel()
    let ui = NativeUi(filePanelFactory: { _ in panel })
    let window = NSWindow()
    window.isReleasedWhenClosed = false
    defer {
      ui.close()
      window.close()
    }
    ui.handle("ui/openFile", params: ["title": "Import"], token: MhpCancellation(), window: window)
    { _ in }
    var failures = 0
    for method in ["ui/openFile", "ui/input"] {
      ui.handle(
        method, params: ["title": "Choose", "prompt": "Value"], token: MhpCancellation(),
        window: window
      ) {
        if case .failure = $0 { failures += 1 }
      }
    }
    XCTAssertEqual(failures, 2)
    XCTAssertNil(window.attachedSheet)
  }

  @MainActor func testFileServicesChooseOpaqueUrisAndWriteTheApprovedExport() throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    let selected = folder.appendingPathComponent("chosen.md")
    let panel = FileServicePanel()
    panel.selected = selected
    let ui = NativeUi(filePanelFactory: { _ in panel })
    let window = NSWindow()
    window.isReleasedWhenClosed = false
    defer {
      ui.close()
      window.close()
    }
    // Foundation service results are checked at the owning MHP boundary (§8).
    var replies: [Any] = []
    ui.handle("ui/openFile", params: ["title": "Import"], token: MhpCancellation(), window: window)
    {
      if case .success(let result) = $0 {
        replies.append(result)
      } else {
        XCTFail("picker refused")
      }
    }
    panel.respond(.OK)
    XCTAssertEqual(replies.first as? String, selected.absoluteString)
    ui.handle(
      "ui/saveText",
      params: ["title": "Export", "suggestedName": "report.md", "text": "scrubbed report"],
      token: MhpCancellation(), window: window
    ) {
      if case .success(let result) = $0 {
        replies.append(result)
      } else {
        XCTFail("export refused")
      }
    }
    panel.respond(.OK)
    XCTAssertEqual(replies.last as? Bool, true)
    XCTAssertEqual(try String(contentsOf: selected, encoding: .utf8), "scrubbed report")
    XCTAssertEqual(panel.nameFieldStringValue, "report.md")
  }
  @MainActor func testFileDialogDenialAndFailureNeverReportSuccess() throws {
    let panel = FileServicePanel()
    panel.selected = FileManager.default.temporaryDirectory.appendingPathComponent(
      UUID().uuidString
    )
    .appendingPathComponent("absent-parent/report.md")
    let ui = NativeUi(filePanelFactory: { _ in panel })
    let window = NSWindow()
    window.isReleasedWhenClosed = false
    defer {
      ui.close()
      window.close()
    }
    var results: [Bool] = []
    var failures = 0
    for response in [NSApplication.ModalResponse.cancel, .OK] {
      ui.handle(
        "ui/saveText", params: ["title": "Export", "suggestedName": "report.md", "text": "report"],
        token: MhpCancellation(), window: window
      ) {
        switch $0 {
        case .success(let value): if let saved = value as? Bool { results.append(saved) }
        case .failure: failures += 1
        }
      }
      panel.respond(response)
    }
    XCTAssertEqual(results, [false])
    XCTAssertEqual(failures, 1)
  }
  @MainActor func testCancelledFileDialogCannotWriteOrReplyFromALateChoice() async throws {
    let panel = FileServicePanel()
    let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    panel.selected = file
    defer { try? FileManager.default.removeItem(at: file) }
    let ui = NativeUi(filePanelFactory: { _ in panel })
    let window = NSWindow()
    window.isReleasedWhenClosed = false
    defer {
      ui.close()
      window.close()
    }
    let token = MhpCancellation()
    var replies = 0
    ui.handle(
      "ui/saveText", params: ["title": "Export", "suggestedName": "report.md", "text": "report"],
      token: token, window: window
    ) { _ in replies += 1 }
    token.cancel()
    panel.complete?(.OK)
    let drained = expectation(description: "file cancellation")
    DispatchQueue.main.async { drained.fulfill() }
    await fulfillment(of: [drained], timeout: 1)
    XCTAssertEqual(replies, 0)
    XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    XCTAssertEqual(panel.cancels, 1)
  }
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

@MainActor private final class FileServicePanel: NSSavePanel {
  var selected: URL?
  var complete: ((NSApplication.ModalResponse) -> Void)?
  var cancels = 0
  override var url: URL? { selected }
  override func beginSheetModal(
    for window: NSWindow, completionHandler handler: @escaping (NSApplication.ModalResponse) -> Void
  ) { complete = handler }
  override func cancel(_ sender: Any?) { cancels += 1 }
  func respond(_ response: NSApplication.ModalResponse) {
    let reply = complete
    complete = nil
    reply?(response)
  }
}
