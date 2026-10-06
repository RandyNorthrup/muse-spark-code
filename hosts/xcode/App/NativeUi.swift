import AppKit
import Foundation

// MHP has already validated the heterogeneous JSON. Choice ids are returned
// unchanged; native UI neither grants a permission nor remembers paid consent.
@MainActor
final class NativeUi: ObservableObject {
  @Published var notice: String?
  @Published var statuses: [String: String] = [:]
  @Published var progress: [String: String] = [:]
  private var alert: NSAlert?

  func close() {
    if let alert = alert, let parent = alert.window.sheetParent {
      parent.endSheet(alert.window, returnCode: .cancel)
    }
    alert = nil
    notice = nil
    statuses.removeAll()
    progress.removeAll()
  }
  func handle(
    _ method: String, params: [String: Any], token: MhpCancellation,
    window: NSWindow?, reply: @escaping (Result<Any, Error>) -> Void
  ) {
    guard token.isActive else { return }
    switch method {
    case "ui/notify":
      notice = params["message"] as? String
      reply(.success(NSNull()))
    case "ui/clipboard":
      guard let text = params["text"] as? String else {
        reply(.failure(NativeFailure.invalid))
        return
      }
      NSPasteboard.general.clearContents()
      if NSPasteboard.general.setString(text, forType: .string) {
        reply(.success(NSNull()))
      } else {
        reply(.failure(NativeFailure.unavailable))
      }
    case "ui/openExternal":
      guard let uri = params["uri"] as? String, let url = URL(string: uri),
        ["http", "https"].contains(url.scheme ?? ""), url.user == nil, url.password == nil
      else {
        reply(.failure(NativeFailure.invalid))
        return
      }
      if NSWorkspace.shared.open(url) {
        reply(.success(NSNull()))
      } else {
        reply(.failure(NativeFailure.launch))
      }
    case "window/state": reply(.success(["focused": NSApp.isActive]))
    case "window/attention":
      notice = params["message"] as? String
      NSApp.requestUserAttention(.informationalRequest)
      reply(.success(NSNull()))
    case "ui/status", "ui/progress":
      guard let id = params["id"],
        let key = try? JSONSerialization.data(withJSONObject: id, options: [.fragmentsAllowed])
      else {
        reply(.failure(NativeFailure.invalid))
        return
      }
      // A native command action needs A's commands/execute composition. Refuse
      // instead of presenting an inert clickable status item.
      guard params["command"] == nil else {
        reply(.failure(NativeFailure.unavailable))
        return
      }
      let name = String(decoding: key, as: UTF8.self)
      if method == "ui/status" {
        guard statuses[name] != nil || statuses.count < NativeMhp.maximumQueuedMessages else {
          reply(.failure(NativeFailure.unavailable))
          return
        }
        statuses[name] = params["visible"] as? Bool == true ? params["text"] as? String : nil
      } else {
        guard progress[name] != nil || progress.count < NativeMhp.maximumQueuedMessages else {
          reply(.failure(NativeFailure.unavailable))
          return
        }
        progress[name] =
          params["done"] as? Bool == true
          ? nil : params["message"] as? String ?? params["title"] as? String
      }
      reply(.success(NSNull()))
    case "ui/confirm", "ui/input", "ui/pick":
      present(method, params: params, token: token, window: window, reply: reply)
    default: reply(.failure(NativeFailure.unavailable))
    }
  }
  private func present(
    _ method: String, params: [String: Any], token: MhpCancellation,
    window: NSWindow?, reply: @escaping (Result<Any, Error>) -> Void
  ) {
    guard alert == nil, let window = window, token.isActive else {
      reply(.failure(NativeFailure.unavailable))
      return
    }
    let sheet = NSAlert()
    sheet.messageText = params["title"] as? String ?? ""
    sheet.informativeText = params["message"] as? String ?? params["prompt"] as? String ?? ""
    let choices = params[method == "ui/confirm" ? "choices" : "items"] as? [[String: Any]] ?? []
    var buttons: [NSButton] = []
    var input: NSTextField?
    var picker: NSPopUpButton?
    if method == "ui/confirm" {
      for choice in choices { sheet.addButton(withTitle: choice["title"] as? String ?? "") }
    } else {
      sheet.addButton(withTitle: UI_TEXT.fallbackContinue)
      if method == "ui/input" {
        let field = NSTextField(string: params["value"] as? String ?? "")
        field.frame.size.width = CGFloat(NativeLimits.windowHeight)
        field.setAccessibilityLabel(sheet.informativeText)
        input = field
        sheet.accessoryView = field
      } else if params["multiple"] as? Bool != true {
        let select = NSPopUpButton()
        select.addItems(withTitles: choices.compactMap { $0["title"] as? String })
        select.setAccessibilityLabel(sheet.messageText)
        picker = select
        sheet.accessoryView = select
      } else {
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        for choice in choices {
          let button = NSButton(
            checkboxWithTitle: choice["title"] as? String ?? "", target: nil, action: nil)
          buttons.append(button)
          stack.addArrangedSubview(button)
        }
        sheet.accessoryView = stack
      }
    }
    sheet.addButton(withTitle: UI_TEXT.questionCancel).keyEquivalent = "\u{1b}"
    alert = sheet
    token.whenCancelled { [weak self, weak sheet] in
      DispatchQueue.main.async {
        guard let sheet = sheet, let parent = sheet.window.sheetParent else { return }
        parent.endSheet(sheet.window, returnCode: .cancel)
        if self?.alert === sheet { self?.alert = nil }
      }
    }
    sheet.beginSheetModal(for: window) { [weak self] response in
      if self?.alert === sheet { self?.alert = nil }
      guard token.isActive else { return }
      let index = response.rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
      if method == "ui/confirm", index >= 0, index < choices.count, let id = choices[index]["id"] {
        reply(.success(id))
      } else if method == "ui/input", index == 0, let input = input {
        reply(.success(input.stringValue))
      } else if method == "ui/pick", index == 0 {
        if let picker = picker {
          let index = picker.indexOfSelectedItem
          guard index >= 0, index < choices.count, let id = choices[index]["id"] else {
            reply(.success(NSNull()))
            return
          }
          reply(.success([id]))
          return
        }
        let selected = buttons.enumerated().filter { $0.element.state == .on }.compactMap {
          choices[$0.offset]["id"]
        }
        guard params["multiple"] as? Bool == true || selected.count <= 1 else {
          reply(.failure(NativeFailure.invalid))
          return
        }
        reply(.success(selected))
      } else {
        reply(.success(NSNull()))
      }
    }
  }
}
