import Foundation
import XcodeKit

final class SourceEditorExtension: NSObject, XCSourceEditorExtension {
  // XcodeKit requires an Objective-C Any-valued dictionary; every value below is a fixed string (§8).
  var commandDefinitions: [[XCSourceEditorCommandDefinitionKey: Any]] {
    NativeCommand.allCases.map { command in
      [
        .classNameKey: "$(PRODUCT_MODULE_NAME).SourceEditorCommand".replacingOccurrences(
          of: "$(PRODUCT_MODULE_NAME)", with: "MuseSparkEditor"),
        .identifierKey: "org.muse-spark-code.xcode.\(command.rawValue)", .nameKey: command.title,
      ]
    }
  }
}
