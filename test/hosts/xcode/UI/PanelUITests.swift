import AppKit
import WebKit
import XCTest

@testable import MuseSpark

// App-hosted XCTest launches the actual SwiftUI app and inspects its live WKWebView.
// No separate XCTest UI runner, Accessibility permission or test-only product entitlement.
final class PanelUITests: XCTestCase {
  @MainActor private func webView(in view: NSView) -> WKWebView? {
    if let webView = view as? WKWebView { return webView }
    for child in view.subviews { if let match = webView(in: child) { return match } }
    return nil
  }
  @MainActor private func stopItem(in menu: NSMenu) -> NSMenuItem? {
    for item in menu.items {
      if item.title == "Stop" && item.action != nil { return item }
      if let submenu = item.submenu, let match = stopItem(in: submenu) { return match }
    }
    return nil
  }
  @MainActor func testAuthenticatedPanelRendersAndStopRemainsAvailable() async throws {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    XCTAssertEqual(
      ProcessInfo.processInfo.environment["MUSE_XCODE_RUNTIME"],
      root.appendingPathComponent("temp/m104x/fake-runtime").path)
    var panel: WKWebView?
    let deadline = Date().addingTimeInterval(20)
    while Date() < deadline {
      for window in NSApp.windows {
        if let content = window.contentView { panel = webView(in: content) ?? panel }
      }
      if let panel = panel,
        let title = try? await panel.evaluateJavaScript(
          "document.getElementById('authenticated')?.textContent"),
        let text = title as? String, text == "Authenticated panel ready"
      {
        break
      }
      try await Task.sleep(for: .milliseconds(100))
    }
    let view = try XCTUnwrap(panel)
    let rendered = try await view.evaluateJavaScript(
      "document.getElementById('authenticated')?.textContent")
    XCTAssertEqual(rendered as? String, "Authenticated panel ready")
    let snapshot = try await view.takeSnapshot(configuration: nil)
    let attachment = XCTAttachment(
      data: try XCTUnwrap(snapshot.tiffRepresentation), uniformTypeIdentifier: "public.tiff")
    attachment.lifetime = .keepAlways
    add(attachment)
    let menu = try XCTUnwrap(NSApp.mainMenu)
    let stop = try XCTUnwrap(stopItem(in: menu))
    let action = try XCTUnwrap(stop.action)
    XCTAssertTrue(NSApp.sendAction(action, to: stop.target, from: stop))
    let clearDeadline = Date().addingTimeInterval(5)
    while Date() < clearDeadline {
      if let value = try? await view.evaluateJavaScript("document.body.textContent"),
        let text = value as? String, text.isEmpty
      {
        break
      }
      try await Task.sleep(for: .milliseconds(100))
    }
    let cleared = try await view.evaluateJavaScript("document.body.textContent")
    XCTAssertEqual(cleared as? String, "")

  }
  @MainActor func testTabRefusesBeforeRuntimeLaunchOrPaidDispatch() async throws {
    let model = PanelModel()
    let listener = CommandListener()
    let finished = expectation(description: "Tab unavailable")
    let cursor = BufferPosition(line: 0, column: 1)
    let request = BufferRequest(
      id: UUID().uuidString, command: .tab, text: "abc",
      selection: BufferSelection(start: cursor, end: cursor), contentUTI: "public.swift-source",
      digest: BufferEdit.digest("abc"))
    listener.start(
      request: request,
      ready: { result in
        do {
          let url = try result.get().launchURL()
          DispatchQueue.main.async { model.openCommand(url) }
        } catch {
          XCTFail("listener failed")
          listener.cancel()
        }
      },
      completion: { result in
        do {
          let reply = try result.get()
          XCTAssertFalse(reply.approved)
          XCTAssertNil(reply.replacement)
          XCTAssertEqual(reply.error, NativeFailure.unavailable.rawValue)
        } catch { XCTFail("Tab did not return an explicit refusal") }
        finished.fulfill()
      })
    await fulfillment(of: [finished], timeout: 5)
    XCTAssertFalse(model.connected)
    XCTAssertNil(model.pending)
    model.stop()
  }

  @MainActor func testStoppedHandshakeCannotReviveSelectionOrSetAnError() async throws {
    let model = PanelModel()
    let listener = CommandListener()
    let ready = expectation(description: "callback ready")
    let finished = expectation(description: "cancelled")
    let range = BufferSelection(
      start: BufferPosition(line: 0, column: 0), end: BufferPosition(line: 0, column: 1))
    let request = BufferRequest(
      id: UUID().uuidString, command: .ask, text: "a", selection: range,
      contentUTI: "public.swift-source", digest: BufferEdit.digest("a"))
    listener.start(
      request: request,
      ready: { result in
        do {
          let url = try result.get().launchURL()
          DispatchQueue.main.async {
            model.openCommand(url)
            model.stop()
            listener.cancel()
            ready.fulfill()
          }
        } catch {
          XCTFail("listener failed")
          ready.fulfill()
          listener.cancel()
        }
      }, completion: { _ in finished.fulfill() })
    await fulfillment(of: [ready, finished], timeout: 5)
    try await Task.sleep(for: .milliseconds(100))
    XCTAssertNil(model.pending)
    XCTAssertNil(model.error)
    XCTAssertFalse(model.connected)
  }

}
