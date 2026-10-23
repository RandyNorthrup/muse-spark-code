import Foundation

// Runtime reads mirror UI_TEXT; generated JSON uses the repository's installed-language tables.
@dynamicMemberLookup
struct NativeText {
  static var locale: String {
    ProcessInfo.processInfo.environment["MUSE_UI_LANGUAGE"]
      ?? Locale.preferredLanguages.first ?? "en"
  }
  subscript(dynamicMember key: String) -> String {
    let language = Self.locale
    let installed = language.lowercased()
    let scriptLanguage =
      installed.hasPrefix("zh-hans")
      ? "zh-cn"
      : installed.hasPrefix("zh-hant") ? "zh-tw" : installed
    let candidates = [scriptLanguage, String(scriptLanguage.prefix(2)), "en"]
    for candidate in candidates {
      let normalized = candidate
      if let url = Bundle(for: NativeTextBundle.self).url(
        forResource: "ui.\(normalized)", withExtension: "json"),
        let data = try? Data(contentsOf: url),
        let table = try? JSONDecoder().decode([String: String].self, from: data),
        let text = table[key]
      {
        return text
      }
    }
    // Missing packaged text is an explicit failure, not an empty success.
    return "ENATIVE_TEXT:\(key)"
  }
}
private final class NativeTextBundle: NSObject {}
// Required shared UI_TEXT name (AGENTS rule 5); native naming lint deferral is in PLAN §7.
let UI_TEXT = NativeText()
