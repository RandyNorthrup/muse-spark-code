package io.github.randynorthrup.musespark

import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.jcef.JBCefApp
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.swing.JFrame

class NativeBrowserTest : BasePlatformTestCase() {
  override fun runInDispatchThread() = false

  fun testSharedPanelReadinessStateAndActualBrowserBridgeOrGuardedFallback() {
    val boundary = JsonBoundary()
    val ready = CountDownLatch(1)
    val posted = CountDownLatch(1)
    val surface =
      PanelSurface(
        "browser-surface",
        "browser-session",
        "chat",
        boundary,
        PanelCallbacks({ frame, _ ->
          if (frame["kind"].asString == "surface" && frame["event"].asString == "ready") ready.countDown()
          if (frame["kind"].asString == "panel" &&
            frame.getAsJsonObject("payload")["type"].asString == "cancelTurn"
          ) {
            posted.countDown()
          }
        }, { 0 }, { _, _ -> }, { _, _ -> }),
      )
    if (System.getProperty("muse.nativeUi") != "true") {
      verifyFallback(surface, boundary)
      return
    }
    assertTrue("The UI qualification requires the pinned JBR with JCEF", JBCefApp.isSupported())
    surface.open()
    val diagnostics = java.util.concurrent.CopyOnWriteArrayList<String>()
    val panel = JetBrainsPanelHost.onEdt { EmbeddedPanel(surface, boundary, "en", diagnostics::add) }
    val console = captureConsole(panel)
    val frame = show(panel)
    try {
      val subscribed = ready.await(WAIT_SECONDS, TimeUnit.SECONDS)
      assertTrue((console + diagnostics).joinToString(), subscribed)
      panel.evaluate(
        "window.museHost.setState({draft:'browser-kept'});window.museHost.postMessage({type:'cancelTurn'});",
      )
      assertTrue(posted.await(WAIT_SECONDS, TimeUnit.SECONDS))
      assertEquals(
        "browser-kept",
        surface.savedState
          ?.asJsonObject
          ?.get("draft")
          ?.asString,
      )
    } finally {
      JetBrainsPanelHost.onEdt {
        javax.imageio.ImageIO.write(
          java.awt.Robot().createScreenCapture(frame.bounds),
          "png",
          java.io.File("build/reports/panel-ui.png"),
        )
        frame.dispose()
        Disposer.dispose(panel)
      }
    }
  }

  private fun verifyFallback(
    surface: PanelSurface,
    boundary: JsonBoundary,
  ) {
    assertFalse(JBCefApp.isSupported())
    assertEquals(
      "MHP_JCEF_UNSUPPORTED",
      org.junit.Assert
        .assertThrows(Exception::class.java) {
          JetBrainsPanelHost.onEdt { EmbeddedPanel(surface, boundary, "en") {} }
        }.message,
    )
  }

  private fun show(panel: EmbeddedPanel): JFrame =
    JetBrainsPanelHost.onEdt {
      JFrame(JetBrainsPanelHost.PRODUCT_NAME).apply {
        contentPane.add(panel.component)
        setSize(WIDTH, HEIGHT)
        isVisible = true
      }
    }

  private fun captureConsole(panel: EmbeddedPanel): List<String> {
    val field = EmbeddedPanel::class.java.getDeclaredField("browser").apply { isAccessible = true }
    val browser = field.get(panel)
    require(browser is com.intellij.ui.jcef.JBCefBrowser)
    val messages = java.util.concurrent.CopyOnWriteArrayList<String>()
    browser.jbCefClient.addLoadHandler(
      object : org.cef.handler.CefLoadHandlerAdapter() {
        override fun onLoadError(
          browser: org.cef.browser.CefBrowser,
          frame: org.cef.browser.CefFrame,
          errorCode: org.cef.handler.CefLoadHandler.ErrorCode,
          errorText: String,
          failedUrl: String,
        ) {
          messages.add("$errorCode $errorText $failedUrl")
        }

        override fun onLoadEnd(
          browser: org.cef.browser.CefBrowser,
          frame: org.cef.browser.CefFrame,
          httpStatusCode: Int,
        ) {
          messages.add("loaded $httpStatusCode ${frame.url}")
          browser.getSource { source -> messages.add(source.take(MAXIMUM_SOURCE_CHARS)) }
        }
      },
      browser.cefBrowser,
    )
    browser.jbCefClient.addDisplayHandler(
      object : org.cef.handler.CefDisplayHandlerAdapter() {
        override fun onConsoleMessage(
          browser: org.cef.browser.CefBrowser,
          level: org.cef.CefSettings.LogSeverity,
          message: String,
          source: String,
          line: Int,
        ): Boolean {
          messages.add(message)
          return true
        }
      },
      browser.cefBrowser,
    )
    return messages
  }

  companion object {
    private const val MAXIMUM_SOURCE_CHARS = 2048
    private const val WAIT_SECONDS = 15L
    private const val WIDTH = 760
    private const val HEIGHT = 640
  }
}
