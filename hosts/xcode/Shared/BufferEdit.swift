import CryptoKit
import Foundation

struct BufferPosition: Codable, Equatable {
  let line: Int
  let column: Int
}
struct BufferSelection: Codable, Equatable {
  let start: BufferPosition
  let end: BufferPosition
}
enum NativeCommand: String, Codable, CaseIterable {
  case ask, explain, fix, tab, open
  var title: String {
    switch self {
    case .ask: return UI_TEXT.xcodeAsk
    case .explain: return UI_TEXT.xcodeExplain
    case .fix: return UI_TEXT.xcodeFix
    case .tab: return UI_TEXT.xcodeTab
    case .open: return UI_TEXT.xcodeOpenPanel
    }
  }
}
struct BufferRequest: Codable {
  let id: String
  let command: NativeCommand
  let text: String
  let selection: BufferSelection
  let contentUTI: String
  let digest: String

  func validate() throws {
    guard UUID(uuidString: id) != nil, text.utf8.count <= NativeLimits.maxFrameBytes,
      digest == BufferEdit.digest(text), !contentUTI.isEmpty
    else { throw NativeFailure.invalid }
    _ = try BufferEdit.range(in: text, selection: selection)
    if command == .tab && selection.start != selection.end { throw NativeFailure.invalid }
  }
  var selectedText: String {
    get throws {
      return (text as NSString).substring(
        with: try BufferEdit.range(in: text, selection: selection))
    }
  }
}
struct BufferReply: Codable {
  let id: String
  let digest: String
  let approved: Bool
  let replacement: String?
  let error: String?
}
enum NativeFailure: String, Error, LocalizedError {
  case invalid = "ENATIVE_INVALID"
  case unavailable = "ENATIVE_UNAVAILABLE"
  case launch = "ENATIVE_LAUNCH"
  case denied = "ENATIVE_DENIED"
  case timeout = "ENATIVE_TIMEOUT"
  case cancelled = "ENATIVE_CANCELLED"
  case changed = "ENATIVE_CHANGED"
  var errorDescription: String? {
    switch self {
    case .unavailable: return UI_TEXT.xcodeUnavailable
    case .launch: return UI_TEXT.xcodeStartFailed
    case .denied: return UI_TEXT.xcodeDenied
    default: return UI_TEXT.xcodeEditRefused
    }
  }
}
enum BufferEdit {
  static func commit(
    _ reply: BufferReply, request: BufferRequest, current: String,
    currentSelection: BufferSelection,
    cancellation: MhpCancellation, write: (String) -> Void
  ) throws {
    try cancellation.withActive {
      let updated = try apply(
        reply, request: request, current: current, currentSelection: currentSelection)
      write(updated)
    }
  }
  static func digest(_ text: String) -> String {
    SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
  }
  static func range(in text: String, selection: BufferSelection) throws -> NSRange {
    // XcodeKit columns and NSString both count UTF-16. Preserve every line ending.
    let units = Array(text.utf16)
    var starts = [0]
    var ends: [Int] = []
    var cursor = 0
    while cursor < units.count {
      if units[cursor] == 10 || units[cursor] == 13 || units[cursor] == 0x2028
        || units[cursor] == 0x2029
      {
        ends.append(cursor)
        if units[cursor] == 13 && cursor + 1 < units.count && units[cursor + 1] == 10 {
          cursor += 1
        }
        starts.append(cursor + 1)
      }
      cursor += 1
    }
    ends.append(units.count)
    func offset(_ position: BufferPosition) throws -> Int {
      guard position.line >= 0, position.line < starts.count, position.column >= 0,
        position.column <= ends[position.line] - starts[position.line]
      else {
        throw NativeFailure.invalid
      }
      let offset = starts[position.line] + position.column
      if offset > 0 && offset < units.count,
        (0xD800...0xDBFF).contains(units[offset - 1]),
        (0xDC00...0xDFFF).contains(units[offset])
      {
        throw NativeFailure.invalid
      }
      return offset
    }
    let start = try offset(selection.start)
    let end = try offset(selection.end)
    guard end >= start else { throw NativeFailure.invalid }
    return NSRange(location: start, length: end - start)
  }
  static func apply(
    _ reply: BufferReply, request: BufferRequest, current: String, currentSelection: BufferSelection
  ) throws -> String {
    try request.validate()
    guard currentSelection == request.selection, reply.id == request.id,
      reply.digest == request.digest,
      digest(current) == request.digest
    else { throw NativeFailure.changed }
    guard reply.approved, reply.error == nil, let replacement = reply.replacement else {
      throw NativeFailure.denied
    }
    guard replacement.utf8.count <= NativeLimits.maxFrameBytes else { throw NativeFailure.invalid }
    return (current as NSString).replacingCharacters(
      in: try range(in: current, selection: request.selection), with: replacement)
  }
}
