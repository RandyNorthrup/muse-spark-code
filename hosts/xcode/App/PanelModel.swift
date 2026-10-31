import AppKit
import Foundation
import WebKit

@MainActor
final class PanelModel: ObservableObject {
  @Published var workspace: URL?
  @Published var runtime = RuntimeLauncher.findRuntime()
  @Published var launch: LaunchLink?
  @Published var launchGeneration = UUID()
  @Published var connected = false
  @Published var error: String?
  @Published var pending: BufferRequest?
  @Published var replacement = ""
  @Published var question = ""
  @Published private(set) var trusted = false
  private let launcher = RuntimeLauncher()
  let nativeUi = NativeUi()
  private var client: CommandClient?
  private var invocation = UUID()
  weak var webView: WKWebView?

  private let navigationProcessFactory: () -> Process
  private var navigationProcesses: [UUID: Process] = [:]
  init(navigationProcessFactory: @escaping () -> Process = { Process() }) {
    self.navigationProcessFactory = navigationProcessFactory
  }

  static func themeKind(dark: Bool, contrast: Bool) -> String {
    if contrast { return dark ? "highContrastDark" : "highContrastLight" }
    return dark ? "dark" : "light"
  }

  func chooseWorkspace() {
    let picker = NSOpenPanel()
    picker.canChooseDirectories = true
    picker.canChooseFiles = true
    picker.allowsMultipleSelection = false
    if picker.runModal() == .OK, let url = picker.url {
      do {
        workspace = try RuntimeLauncher.workspace(url)
        trusted = false
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
        theme: [
          "kind": Self.themeKind(
            dark: NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua,
            contrast: NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast),
          "tokens": [String: String](),
        ],
        trusted: trusted,
        service: { [weak self] method, params, token, reply in
          DispatchQueue.main.async {
            guard let self = self, self.invocation == id, token.isActive else { return }
            self.nativeUi.handle(
              method, params: params, token: token, window: self.webView?.window, reply: reply)
          }
        },
        launched: { [weak self] result in
          DispatchQueue.main.async {
            guard let self = self, self.invocation == id else { return }
            switch result {
            case .success(let link):
              self.launchGeneration = UUID()
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
            self.nativeUi.close()
            self.launch = nil
            self.webView?.loadHTMLString("", baseURL: nil)
            self.error = UI_TEXT.xcodeStartFailed
          }
        })
    } catch { self.error = UI_TEXT.xcodeStartFailed }
  }
  func stop() {
    invocation = UUID()
    // Process reaps the child on termination. Keep ownership until its handler
    // runs, including after Stop; the retired generation cannot publish errors.
    for process in navigationProcesses.values {
      if process.isRunning { process.terminate() }
    }
    launcher.stop()
    nativeUi.close()
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
  func setTrust(_ value: Bool) {
    guard value != trusted, workspace != nil else { return }
    guard connected || !launcher.isRunning else {
      error = UI_TEXT.xcodeUnavailable
      return
    }
    if value {
      let alert = NSAlert()
      alert.messageText = UI_TEXT.worktreeTrustConfirm
      alert.informativeText = UI_TEXT.worktreeTrustDetail
      alert.addButton(withTitle: UI_TEXT.worktreeTrustAction)
      alert.addButton(withTitle: UI_TEXT.questionCancel)
      guard alert.runModal() == .alertFirstButtonReturn else { return }
    }
    do {
      if connected { try launcher.trust(value) }
      trusted = value
    } catch { self.error = UI_TEXT.xcodeUnavailable }
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
        const message = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
        if (!window.musePanel) throw new Error('ENATIVE_UNAVAILABLE');
        window.musePanel.postMessage(message);
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
    guard let workspace = workspace else {
      error = UI_TEXT.xcodeWorkspaceRequired
      return
    }
    let target: URL
    do { target = try RuntimeLauncher.navigationFile(file, workspace: workspace, line: line) } catch
    {
      self.error = UI_TEXT.linkOutsideWorkspace
      return
    }
    let process = navigationProcessFactory()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
    process.arguments = ["xed", "--line", String(line), "--", target.path]
    process.environment = RuntimeLauncher.environment(ProcessInfo.processInfo.environment)
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    let id = UUID()
    let generation = invocation
    navigationProcesses[id] = process
    process.terminationHandler = { [weak self] process in
      DispatchQueue.main.async {
        guard let self = self, self.navigationProcesses.removeValue(forKey: id) === process else {
          return
        }
        process.terminationHandler = nil
        if self.invocation == generation, process.terminationStatus != 0 {
          self.error = UI_TEXT.openFileFailed
        }
      }
    }
    do { try process.run() } catch {
      process.terminationHandler = nil
      navigationProcesses.removeValue(forKey: id)
      self.error = UI_TEXT.openFileFailed
    }
  }
}
private struct PanelPrompt: Encodable {
  let type: String
  let localId: String
  let text: String
  let attachmentIds: [String]
}
