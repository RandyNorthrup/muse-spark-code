package io.github.randynorthrup.musespark

import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.jcef.JBCefApp
import java.util.concurrent.TimeUnit
import javax.swing.JFrame

class NativeBrowserTest : BasePlatformTestCase() {
  override fun runInDispatchThread() = false

  fun testReplacementWhatsNewHtmlInstallsTheBridgeAndLoadsItsAssets() {
    val boundary = JsonBoundary()
    val sent = java.util.concurrent.CopyOnWriteArrayList<com.google.gson.JsonObject>()
    val surface =
      PanelSurface(
        "replacement",
        "session",
        "whatsNew",
        boundary,
        PanelCallbacks({ frame, _ -> sent.add(frame) }, { 0 }, { _, _ -> }, { _, _ -> }),
      )
    if (System.getProperty("muse.nativeUi") != "true") {
      verifyFallback(surface, boundary)
      return
    }
    surface.open()
    val panel = JetBrainsPanelHost.onEdt { EmbeddedPanel(surface, boundary, "en", {}) }
    val console = captureConsole(panel)
    val frame = show(panel)
    try {
      awaitDom(panel, console, "initial", "typeof window.museHost === 'object'", "")
      val html =
        """
        <!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'">
        <link rel="stylesheet" href="/assets/portable/whatsNew.css"></head>
        <body data-bridge="native" data-surface="whatsNew">
        <a id="replacement-link" data-link="7" href="https://example.com">replacement</a>
        <script nonce="runtime-nonce" src="/assets/portable/whatsNew.js"></script>
        <script nonce="runtime-nonce" src="/assets/portable/loader.js"></script></body></html>
        """.trimIndent()
      loadReplacement(panel, html)
      awaitDom(
        panel,
        console,
        "replacement",
        "typeof window.museHost === 'object' && document.querySelector('#replacement-link') && " +
          "document.querySelectorAll('script[src],link[rel=stylesheet]').length === 0 && " +
          "document.querySelector('style')",
        "document.querySelector('#replacement-link').click();",
      )
      val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(WAIT_SECONDS)
      while (sent.none { it["payload"]?.asJsonObject?.get("type")?.asString == "openLink" } &&
        System.nanoTime() < deadline
      ) {
        Thread.sleep(POLL_MILLIS)
      }
      val clicked =
        sent
          .single {
            it["payload"]?.asJsonObject?.get("type")?.asString == "openLink"
          }.getAsJsonObject("payload")
      assertEquals(7, clicked["index"].asInt)
    } finally {
      JetBrainsPanelHost.onEdt {
        frame.dispose()
        Disposer.dispose(panel)
      }
    }
  }

  private fun loadReplacement(
    panel: EmbeddedPanel,
    html: String,
  ) {
    val replacementLoaded = java.util.concurrent.CountDownLatch(1)
    val browser =
      EmbeddedPanel::class.java
        .getDeclaredField("browser")
        .apply { isAccessible = true }
        .get(panel)
    require(browser is com.intellij.ui.jcef.JBCefBrowser)
    browser.jbCefClient.addLoadHandler(
      object : org.cef.handler.CefLoadHandlerAdapter() {
        override fun onLoadEnd(
          browser: org.cef.browser.CefBrowser,
          frame: org.cef.browser.CefFrame,
          httpStatusCode: Int,
        ) {
          browser.getSource { source -> if (source.contains("id=\"replacement-link\"")) replacementLoaded.countDown() }
        }
      },
      browser.cefBrowser,
    )
    JetBrainsPanelHost.onEdt { panel.present(html) }
    assertTrue("The replacement document must finish loading", replacementLoaded.await(WAIT_SECONDS, TimeUnit.SECONDS))
  }

  fun testSharedPanelReadinessStateAndActualBrowserBridgeOrGuardedFallback() {
    val boundary = JsonBoundary()
    val surface =
      PanelSurface(
        "browser-surface",
        "browser-session",
        "chat",
        boundary,
        PanelCallbacks({ _, _ -> }, { 0 }, { _, _ -> }, { _, _ -> }),
      )
    if (System.getProperty("muse.nativeUi") != "true") {
      verifyFallback(surface, boundary)
      return
    }
    assertTrue("The UI qualification requires the pinned JBR with JCEF", JBCefApp.isSupported())
    NativePanelFixture(boundary).use { fixture ->
      fixture.start()
      val diagnostics = java.util.concurrent.CopyOnWriteArrayList<String>()
      val panel = JetBrainsPanelHost.onEdt { EmbeddedPanel(fixture.surface, boundary, "en", diagnostics::add) }
      fixture.panel = panel
      val console = captureConsole(panel)
      val frame = show(panel)
      try {
        assertTrue((console + diagnostics).joinToString(), fixture.ready.await(WAIT_SECONDS, TimeUnit.SECONDS))
        exerciseControls(panel, console, fixture, frame)
        panel.evaluate("window.museHost.setState({draft:'browser-kept'});")
        awaitDom(panel, console, "saved", "window.museHost.getState()?.draft === 'browser-kept'", "")
        assertEquals(
          "browser-kept",
          fixture.surface.savedState
            ?.asJsonObject
            ?.get("draft")
            ?.asString,
        )
        capture(frame, "build/reports/panel-ui.png")
      } finally {
        JetBrainsPanelHost.onEdt {
          frame.dispose()
          Disposer.dispose(panel)
        }
      }
    }
  }

  fun testUnavailableRendererCallsTheCompanionAndDisposalCancelsItsDeadline() {
    val boundary = JsonBoundary()
    val surface =
      PanelSurface(
        "deadline",
        "session",
        "chat",
        boundary,
        PanelCallbacks({ _, _ -> }, { 0 }, { _, _ -> }, { _, _ -> }),
      )
    if (System.getProperty("muse.nativeUi") != "true") {
      verifyFallback(surface, boundary)
      return
    }
    val unavailable = java.util.concurrent.CountDownLatch(1)
    surface.open()
    val panel = JetBrainsPanelHost.onEdt { EmbeddedPanel(surface, boundary, "en", {}, unavailable::countDown) }
    val timer =
      EmbeddedPanel::class.java
        .getDeclaredField("readiness")
        .apply { isAccessible = true }
        .get(panel)
    require(timer is javax.swing.Timer)
    try {
      JetBrainsPanelHost.onEdt {
        timer.initialDelay = 1
        timer.restart()
      }
      assertTrue(unavailable.await(WAIT_SECONDS, TimeUnit.SECONDS))
    } finally {
      JetBrainsPanelHost.onEdt { Disposer.dispose(panel) }
      assertFalse(timer.isRunning)
    }
  }

  private fun exerciseControls(
    panel: EmbeddedPanel,
    console: List<String>,
    fixture: NativePanelFixture,
    frame: JFrame,
  ) {
    for ((index, label) in listOf("Allow once", "Deny").withIndex()) {
      awaitDom(
        panel,
        console,
        "compose-$index",
        "document.querySelector('textarea.composer-input')",
        """
        const input = document.querySelector('textarea.composer-input');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(input, 'fake message $index');
        input.dispatchEvent(new Event('input', {bubbles:true}));
      """,
      )
      awaitDom(
        panel,
        console,
        "send-$index",
        "document.querySelector('button[aria-label=\"Send\"]:not(:disabled)')",
        "document.querySelector('button[aria-label=\"Send\"]').click();",
      )
      val button =
        "Array.from(document.querySelectorAll('button'))" +
          ".find(b => b.textContent.trim() === '$label' && !b.disabled)"
      if (index == 0) {
        awaitDom(panel, console, "pending", button, "")
        capture(frame, "build/reports/panel-approval.png")
      }
      awaitDom(panel, console, "approve-$index", button, "($button).click();")
      awaitDom(panel, console, "settled-$index", "!($button)", "")
    }
    awaitDom(
      panel,
      console,
      "stop",
      "document.querySelector('button[aria-label=\"Stop\"]')",
      "document.querySelector('button[aria-label=\"Stop\"]').click();",
    )
    awaitDom(
      panel,
      console,
      "answer",
      "document.body.textContent.includes('The shared panel is rendering in JetBrains.')",
      "",
    )
    assertEquals(
      listOf("fake message 0", "fake message 1"),
      fixture.posted.filter { it["type"].asString == "sendMessage" }.map { it["text"].asString },
    )
    assertEquals(
      listOf("fixture-once", "fixture-deny"),
      fixture.posted.filter { it["type"].asString == "decideApproval" }.map { it["choiceId"].asString },
    )
    assertEquals(1, fixture.posted.count { it["type"].asString == "cancelTurn" })
  }

  private fun awaitDom(
    panel: EmbeddedPanel,
    console: List<String>,
    id: String,
    condition: String,
    action: String,
  ) {
    val marker = "MHP_UI_$id"
    panel.evaluate(
      """
      (() => { const timer = setInterval(() => {
        if ($condition) { clearInterval(timer); $action console.log('$marker'); }
      }, $POLL_MILLIS); })();
    """,
    )
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(WAIT_SECONDS)
    while (marker !in console && System.nanoTime() < deadline) Thread.sleep(POLL_MILLIS)
    if (marker !in console) {
      panel.evaluate(
        "console.log('MHP_UI_DOM_$id '+document.body.innerText+" +
          "' launch='+document.documentElement.dataset.launch);",
      )
      Thread.sleep(POLL_MILLIS)
    }
    assertTrue(marker + " " + console.joinToString(), marker in console)
  }

  private fun capture(
    frame: JFrame,
    path: String,
  ) {
    Thread.sleep(PAINT_MILLIS)
    JetBrainsPanelHost.onEdt {
      javax.imageio.ImageIO.write(java.awt.Robot().createScreenCapture(frame.bounds), "png", java.io.File(path))
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
          JetBrainsPanelHost.onEdt { EmbeddedPanel(surface, boundary, "en", {}) }
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
    private const val POLL_MILLIS = 20L
    private const val PAINT_MILLIS = 750L
    private const val MAXIMUM_SOURCE_CHARS = 2048
    private const val WAIT_SECONDS = 15L
    private const val WIDTH = 760
    private const val HEIGHT = 640
  }
}
