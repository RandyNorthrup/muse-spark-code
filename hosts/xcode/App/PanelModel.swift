import AppKit
import Foundation
import WebKit

@MainActor
final class PanelModel: ObservableObject {
  @Published var workspace: URL?
  @Published var runtime = RuntimeLauncher.findRuntime()
  @Published var launch: LaunchLink?
  @Published var connected = false
  @Published var error: String?
  @Published var pending: BufferRequest?
  @Published var replacement = ""
  @Published var question = ""
  private let launcher = RuntimeLauncher()
  private var client: CommandClient?
  private var invocation = UUID()
  weak var webView: WKWebView?

  func chooseWorkspace() {
    let picker = NSOpenPanel()
    picker.canChooseDirectories = true
    picker.canChooseFiles = true
    picker.allowsMultipleSelection = false
    if picker.runModal() == .OK, let url = picker.url {
      do {
        workspace = try RuntimeLauncher.workspace(url)
        start()
      } catch { self.error = UI_TEXT.xcodeWorkspaceRequired }
    }
  }
  func chooseRuntime() {
    let picker = NSOpenPanel()
    picker.canChooseDirectories = false
    picker.canChooseFiles = true
    picker.allowsMultipleSelection = false
    if picker.runModal() == .OK, let url = picker.url {
      guard FileManager.default.isExecutableFile(atPath: url.path) else {
        error = UI_TEXT.xcodeRuntimeNeeded
        return
      }
      runtime = url
    }
  }
  func start() {
    stop()
    guard let workspace = workspace else {
      error = UI_TEXT.xcodeWorkspaceRequired
      return
    }
    guard let runtime = runtime else {
      error = UI_TEXT.xcodeRuntimeNeeded
      return
    }
    let id = UUID()
    invocation = id
    error = nil
    do {
      try launcher.start(
        executable: runtime, workspace: workspace,
        launched: { [weak self] result in
          DispatchQueue.main.async {
            guard let self = self, self.invocation == id else { return }
            switch result {
            case .success(let link):
              self.launch = link
              self.connected = true
            case .failure: self.error = UI_TEXT.xcodeStartFailed
            }
          }
        },
        exited: { [weak self] in
          DispatchQueue.main.async {
            guard let self = self, self.invocation == id else { return }
            self.connected = false
            self.launch = nil
            self.webView?.loadHTMLString("", baseURL: nil)
            self.error = UI_TEXT.xcodeStartFailed
          }
        })
    } catch { self.error = UI_TEXT.xcodeStartFailed }
  }
  func stop() {
    invocation = UUID()
    launcher.stop()
    if let request = pending {
      reply(request, approved: false, replacement: nil, error: .cancelled)
    }
    client?.close()
    client = nil
    pending = nil
    replacement = ""
    question = ""
    connected = false
    launch = nil
    webView?.stopLoading()
    webView?.loadHTMLString("", baseURL: nil)
  }
  func openCommand(_ url: URL) {
    guard pending == nil, client == nil else {
      error = UI_TEXT.xcodeEditRefused
      return
    }
    do {
      var link = try CallbackLink(url: url)
      let client = CommandClient()
      self.client = client
      client.connect(
        link: link,
        completion: { [weak self] result in
          DispatchQueue.main.async {
            guard let self = self, self.client === client else {
              client.close()
              return
            }
            switch result {
            case .failure:
              self.error = UI_TEXT.xcodeEditRefused
              client.close()
              self.client = nil
            case .success(let request):
              if request.command == .tab {
                // Never invent a completion or spend outside the shared Tab engine.
                self.error = UI_TEXT.xcodeUnavailable
                self.reply(request, approved: false, replacement: nil, error: .unavailable)
              } else if request.command == .open {
                self.reply(request, approved: false, replacement: nil, error: nil)
                if !self.connected { self.start() }
              } else {
                self.pending = request
                self.replacement = ""
                switch request.command {
                case .explain: self.question = NativeModelText.explainSelection
                case .fix: self.question = NativeModelText.fixSelection
                default: self.question = ""
                }
              }
            }
          }
        },
        closed: { [weak self, weak client] in
          DispatchQueue.main.async {
            guard let self = self, let client = client, self.client === client else { return }
            self.client = nil
            self.pending = nil
            self.replacement = ""
            self.question = ""
          }
        })
      link.clear()
      NSApp.activate(ignoringOtherApps: true)
    } catch { self.error = UI_TEXT.xcodeEditRefused }
  }
  func sendSelection() {
    guard let request = pending, connected, let webView = webView else {
      error = UI_TEXT.xcodeStartFailed
      return
    }
    // The user writes the instruction. Selection contents are user input, not a native system prompt.
    guard !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    guard let selected = try? request.selectedText else {
      error = UI_TEXT.xcodeEditRefused
      return
    }
    let message = PanelPrompt(
      type: "sendMessage", localId: UUID().uuidString,
      text: question + "\n\n" + selected, attachmentIds: [])
    do {
      let data = try JSONEncoder().encode(message)
      let encoded = data.base64EncodedString()
      let script = """
        const bytes = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
        const message = new TextDecoder().decode(bytes);
        const response = await window.fetch('/post', {method:'POST', headers:{'Content-Type':'application/json','X-Muse-Panel':'1'}, body:message});
        if (!response.ok) throw new Error('ENATIVE_UNAVAILABLE');
        return true;
        """
      webView.callAsyncJavaScript(script, arguments: ["payload": encoded], in: nil, in: .page) {
        [weak self] result in
        DispatchQueue.main.async {
          guard let self = self, self.pending?.id == request.id else { return }
          if case .failure = result {
            self.error = UI_TEXT.xcodeUnavailable
            return
          }
          if request.command != .fix {
            self.reply(request, approved: false, replacement: nil, error: nil)
          }
        }
      }
    } catch { self.error = UI_TEXT.xcodeUnavailable }
  }
  func approve() {
    guard let request = pending, request.command == .fix else { return }
    reply(request, approved: true, replacement: replacement, error: nil)
  }
  func deny() {
    guard let request = pending else { return }
    reply(request, approved: false, replacement: nil, error: .denied)
  }
  private func reply(
    _ request: BufferRequest, approved: Bool, replacement: String?, error: NativeFailure?
  ) {
    let client = client
    self.client = nil
    let response = BufferReply(
      id: request.id, digest: request.digest, approved: approved,
      replacement: replacement, error: error?.rawValue)
    client?.reply(response) { accepted in
      DispatchQueue.main.async { [weak self] in
        if !accepted { self?.error = UI_TEXT.xcodeEditRefused }
      }
    }
    pending = nil
    self.replacement = ""
    question = ""
  }
  func openFile() {
    guard let workspace = workspace else {
      error = UI_TEXT.xcodeWorkspaceRequired
      return
    }
    let picker = NSOpenPanel()
    picker.directoryURL = workspace
    picker.canChooseDirectories = false
    picker.allowsMultipleSelection = false
    if picker.runModal() == .OK, let file = picker.url { openInXcode(file, line: 1) }
  }
  func openInXcode(_ file: URL, line: Int) {
    guard let workspace = workspace, file.isFileURL, line > 0,
      file.resolvingSymlinksInPath().path.hasPrefix(workspace.resolvingSymlinksInPath().path + "/")
    else {
      error = UI_TEXT.linkOutsideWorkspace
      return
    }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
    process.arguments = ["xed", "--line", String(line), "--", file.path]
    process.environment = RuntimeLauncher.environment(ProcessInfo.processInfo.environment)
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    process.terminationHandler = { [weak self] process in
      if process.terminationStatus != 0 {
        DispatchQueue.main.async { self?.error = UI_TEXT.xcodeEditRefused }
      }
    }
    do { try process.run() } catch { self.error = UI_TEXT.xcodeEditRefused }
  }
}
private struct PanelPrompt: Encodable {
  let type: String
  let localId: String
  let text: String
  let attachmentIds: [String]
}
