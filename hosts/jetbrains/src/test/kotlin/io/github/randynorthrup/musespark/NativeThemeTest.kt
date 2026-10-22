package io.github.randynorthrup.musespark

import com.intellij.testFramework.fixtures.BasePlatformTestCase

class NativeThemeTest : BasePlatformTestCase() {
  fun testMapsEverySharedPanelThemeTokenToNativeValues() {
    val css = NativeTheme.css()
    val stylesheet = JsonBoundary.resource("/webview/main.css")
    val tokens = Regex("--vscode-[a-zA-Z][a-zA-Z0-9-]*").findAll(stylesheet).map { it.value }.toSet()
    assertTrue(tokens.isNotEmpty())
    for (token in tokens) {
      assertTrue("Missing $token", css.contains("$token:"))
      assertTrue(css.contains(token.replace("--vscode-", "--muse-") + ":"))
    }
    assertFalse(css.contains("palette."))
  }
}
