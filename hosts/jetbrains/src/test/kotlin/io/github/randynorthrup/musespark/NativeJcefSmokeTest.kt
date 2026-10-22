package io.github.randynorthrup.musespark

import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.swing.JFrame

class NativeJcefSmokeTest : BasePlatformTestCase() {
  override fun runInDispatchThread() = false

  fun testTheIdeBrowserCanLoadItsOwnHtmlWithoutPluginGuards() {
    if (System.getProperty("muse.nativeUi") != "true") {
      assertFalse(JBCefApp.isSupported())
      return
    }
    val loaded = CountDownLatch(1)
    val browser = JetBrainsPanelHost.onEdt { JBCefBrowser() }
    browser.jbCefClient.addLoadHandler(
      object : CefLoadHandlerAdapter() {
        override fun onLoadEnd(
          browser: CefBrowser,
          frame: CefFrame,
          httpStatusCode: Int,
        ) {
          loaded.countDown()
        }
      },
      browser.cefBrowser,
    )
    val frame =
      JetBrainsPanelHost.onEdt {
        JFrame("Native browser fixture").apply {
          add(browser.component)
          setSize(640, 480)
          isVisible = true
          browser.loadHTML("<html><body>Native browser fixture</body></html>")
        }
      }
    try {
      assertTrue("Native JCEF load failed independently of the plugin", loaded.await(15, TimeUnit.SECONDS))
    } finally {
      JetBrainsPanelHost.onEdt {
        frame.dispose()
        Disposer.dispose(browser)
      }
    }
  }
}
