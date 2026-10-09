import AppKit
import SwiftUI

@main
struct MuseSparkApp: App {
  @StateObject private var model = PanelModel()
  @NSApplicationDelegateAdaptor(ApplicationDelegate.self) private var delegate
  var body: some Scene {
    Window(UI_TEXT.xcodeTitle, id: "muse-panel") {
      VStack(spacing: 0) {
        HStack {
          Button(UI_TEXT.xcodeOpenWorkspace) { model.chooseWorkspace() }.accessibilityIdentifier(
            "open-workspace")
          Button(UI_TEXT.xcodeChooseRuntime) { model.chooseRuntime() }.help(UI_TEXT.xcodeRuntime)
          Button(UI_TEXT.xcodeOpenPanel) { model.start() }
          Button(UI_TEXT.stopTitle) { model.stop() }.accessibilityIdentifier("stop")
          Button(UI_TEXT.xcodeOpenFile) { model.openFile() }
          Toggle(
            UI_TEXT.worktreeTrustAction,
            isOn: Binding(get: { model.trusted }, set: { model.setTrust($0) })
          )
          .disabled(model.workspace == nil)
          Spacer()
          if let workspace = model.workspace { Text(workspace.lastPathComponent).lineLimit(1) }
        }.padding()
        if let error = model.error {
          Text(error).foregroundStyle(.red).textSelection(.enabled).padding()
            .accessibilityIdentifier("host-error")
        }
        NativeUiStatus(ui: model.nativeUi)
        if let pending = model.pending {
          VStack(alignment: .leading) {
            Text(pending.command.title).font(.headline)
            Text((try? pending.selectedText) ?? UI_TEXT.xcodeEditRefused).lineLimit(2)
              .textSelection(.enabled)
            TextField(UI_TEXT.composerLabel, text: $model.question).accessibilityIdentifier(
              "selection-question")
            HStack {
              Button(UI_TEXT.composerLabel) { model.sendSelection() }.disabled(
                !model.connected || model.question.isEmpty)
              Button(UI_TEXT.questionCancel) { model.deny() }
            }
            if pending.command == .fix {
              Text(UI_TEXT.xcodeReplacement)
              TextEditor(text: $model.replacement).frame(minHeight: 100).accessibilityIdentifier(
                "replacement")
              Button(UI_TEXT.xcodeApprove) { model.approve() }.accessibilityIdentifier(
                "approve-buffer")
            }
          }.padding()
        }
        PanelWebView(model: model).accessibilityIdentifier("companion-panel")
      }
      .frame(
        minWidth: CGFloat(NativeLimits.windowHeight), minHeight: CGFloat(NativeLimits.windowHeight)
      )
      .onOpenURL { model.openCommand($0) }
      .onAppear {
        delegate.terminate = { model.stop() }
        let environment = ProcessInfo.processInfo.environment
        if let path = environment["MUSE_XCODE_RUNTIME"] {
          model.runtime = URL(fileURLWithPath: path)
        }
        if let path = environment["MUSE_XCODE_WORKSPACE"] {
          do { model.workspace = try RuntimeLauncher.workspace(URL(fileURLWithPath: path)) } catch {
            model.error = UI_TEXT.xcodeWorkspaceRequired
          }
        }
        let arguments = ProcessInfo.processInfo.arguments
        if let index = arguments.firstIndex(of: "--runtime"), index + 1 < arguments.count {
          model.runtime = URL(fileURLWithPath: arguments[index + 1])
        }
        if let index = arguments.firstIndex(of: "--workspace"), index + 1 < arguments.count {
          do {
            model.workspace = try RuntimeLauncher.workspace(
              URL(fileURLWithPath: arguments[index + 1]))
          } catch {
            model.workspace = nil
            model.error = UI_TEXT.xcodeWorkspaceRequired
          }
        }
        if model.workspace != nil { model.start() }
      }
    }
    .defaultSize(
      width: CGFloat(NativeLimits.windowWidth), height: CGFloat(NativeLimits.windowHeight)
    )
    .commands {
      CommandMenu(UI_TEXT.xcodeTitle) {
        Button(UI_TEXT.stopTitle) { model.stop() }.keyboardShortcut(".", modifiers: .command)
        Button(UI_TEXT.xcodeOpenWorkspace) { model.chooseWorkspace() }
      }
    }
    MenuBarExtra(UI_TEXT.xcodeTitle, systemImage: "sparkles") {
      NativeMenu(model: model)
    }
  }
}

private struct NativeUiStatus: View {
  @ObservedObject var ui: NativeUi
  var body: some View {
    VStack(alignment: .leading) {
      if let notice = ui.notice {
        Text(notice).textSelection(.enabled).accessibilityAddTraits(.updatesFrequently)
      }
      ForEach(ui.statuses.keys.sorted(), id: \.self) { id in
        if let text = ui.statuses[id] { Text(text).textSelection(.enabled) }
      }
      ForEach(ui.progress.keys.sorted(), id: \.self) { id in
        if let text = ui.progress[id] { Text(text).accessibilityAddTraits(.updatesFrequently) }
      }
    }.padding()
  }
}
@MainActor
final class ApplicationDelegate: NSObject, NSApplicationDelegate {
  var terminate: (() -> Void)?
  func applicationWillTerminate(_ notification: Notification) { terminate?() }
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

private struct NativeMenu: View {
  @ObservedObject var model: PanelModel
  @Environment(\.openWindow) private var openWindow
  var body: some View {
    Button(UI_TEXT.stopTitle) { model.stop() }
    Button(UI_TEXT.xcodeOpenPanel) {
      openWindow(id: "muse-panel")
      NSApp.activate(ignoringOtherApps: true)
      if !model.connected { model.start() }
    }
  }
}
