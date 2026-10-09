import AppKit
import Foundation
import XcodeKit

final class SourceEditorCommand: NSObject, XCSourceEditorCommand {
  private var listener: CommandListener?
  func perform(
    with invocation: XCSourceEditorCommandInvocation, completionHandler: @escaping (Error?) -> Void
  ) {
    guard
      let command = NativeCommand(
        rawValue: invocation.commandIdentifier.components(separatedBy: ".").last ?? ""),
      invocation.buffer.selections.count == 1,
      let selection = invocation.buffer.selections.firstObject as? XCSourceTextRange
    else {
      completionHandler(NativeFailure.invalid)
      return
    }
    let text = invocation.buffer.completeBuffer
    let request = BufferRequest(
      id: UUID().uuidString, command: command, text: text,
      selection: BufferSelection(
        start: BufferPosition(line: selection.start.line, column: selection.start.column),
        end: BufferPosition(line: selection.end.line, column: selection.end.column)),
      contentUTI: invocation.buffer.contentUTI, digest: BufferEdit.digest(text))
    let listener = CommandListener()
    let admission = MhpCancellation()
    self.listener = listener
    invocation.cancellationHandler = {
      admission.cancel()
      listener.cancel()
    }
    listener.start(
      request: request,
      ready: { result in
        guard case .success(let link) = result else { return }
        DispatchQueue.main.async {
          do {
            try admission.withActive {
              let configuration = NSWorkspace.OpenConfiguration()
              configuration.activates = true
              NSWorkspace.shared.open(try link.launchURL(), configuration: configuration) {
                _, error in
                if error != nil { listener.fail(.launch) }
              }
            }
          } catch { listener.fail(.launch) }
        }
      },
      completion: { result in
        DispatchQueue.main.async {
          defer {
            admission.cancel()
            if self.listener === listener { self.listener = nil }
            invocation.cancellationHandler = {}
          }
          do {
            let reply = try result.get()
            if let error = reply.error { throw NativeFailure(rawValue: error) ?? .invalid }
            if command == .fix || command == .tab {
              // One completeBuffer mutation is one XcodeKit command/undo transaction.
              guard invocation.buffer.selections.count == 1,
                let selected = invocation.buffer.selections.firstObject as? XCSourceTextRange
              else {
                throw NativeFailure.changed
              }
              let currentSelection = BufferSelection(
                start: BufferPosition(line: selected.start.line, column: selected.start.column),
                end: BufferPosition(line: selected.end.line, column: selected.end.column))
              try BufferEdit.commit(
                reply, request: request,
                current: invocation.buffer.completeBuffer, currentSelection: currentSelection,
                cancellation: admission
              ) { invocation.buffer.completeBuffer = $0 }
            }
            completionHandler(nil)
          } catch NativeFailure.cancelled { completionHandler(nil) } catch {
            completionHandler(error)
          }
        }
      })
  }
}
