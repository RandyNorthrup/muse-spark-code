package io.github.randynorthrup.musespark

import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Component
import java.awt.Container
import java.awt.Window
import javax.swing.JButton
import javax.swing.JDialog
import javax.swing.Timer

class NativeDialogsTest : BasePlatformTestCase() {
  override fun runInDispatchThread() = false

  fun testOpaquePaidChoicesWithDuplicateTitlesAndCancellation() {
    val owner = Disposer.newDisposable()
    try {
      val widgets = NativeWidgets(project, JsonBoundary()) {}
      Disposer.register(owner, widgets)
      val services = NativeHostServices(project, { _, _ -> error("fixture-unused-surface") }, widgets)
      val params =
        json(
          "title" to TITLE,
          "message" to "USD 0.25; shared daily budget USD 10",
          "choices" to (0..2).map { json("id" to "choice-$it", "title" to "<html>Same title") },
        )
      if (System.getProperty("muse.nativeUi") != "true") {
        org.junit.Assert.assertThrows(java.awt.HeadlessException::class.java) {
          JetBrainsPanelHost.onEdt { services.request("ui/confirm", params, RequestCancellation()) }
        }
        return
      }
      for (index in 0..2) {
        var plainTitle = false
        val result =
          JetBrainsPanelHost.onEdt {
            val timer =
              chooser { dialog ->
                buttons(dialog)
                  .filter { it.text == "<html>Same title" }[index]
                  .also {
                    plainTitle = it.getClientProperty("html.disable") == true
                  }.doClick()
              }
            try {
              services.request("ui/confirm", params, RequestCancellation())
            } finally {
              timer.stop()
            }
          }
        assertTrue(plainTitle)
        assertEquals("choice-$index", result.asString)
      }
      val cancellation = RequestCancellation()
      assertEquals(
        "MHP_CANCELLED",
        org.junit.Assert
          .assertThrows(Exception::class.java) {
            JetBrainsPanelHost.onEdt {
              val timer = chooser { cancellation.cancel() }
              try {
                services.request("ui/confirm", params, cancellation)
              } finally {
                timer.stop()
              }
            }
          }.message,
      )
    } finally {
      JetBrainsPanelHost.onEdt { Disposer.dispose(owner) }
    }
  }

  fun testShowSettingExplicitlyRefusesUnavailableRuntimeSettings() {
    val owner = Disposer.newDisposable()
    try {
      val widgets = NativeWidgets(project, JsonBoundary()) {}
      Disposer.register(owner, widgets)
      val services = NativeHostServices(project, { _, _ -> error("fixture-unused") }, widgets)
      val before = Window.getWindows().toSet()
      val timer =
        Timer(POLL_MILLIS) {
          Window.getWindows().filter { it !in before && it is JDialog && it.isShowing }.forEach { it.dispose() }
        }.apply { start() }
      try {
        assertEquals(
          "MHP_UNSUPPORTED_CAPABILITY",
          org.junit.Assert
            .assertThrows(Exception::class.java) {
              JetBrainsPanelHost.onEdt {
                services.request(
                  "ui/showSetting",
                  json("key" to "museSpark.showWhatsNewOnUpdate"),
                  RequestCancellation(),
                )
              }
            }.message,
        )
      } finally {
        timer.stop()
      }
    } finally {
      JetBrainsPanelHost.onEdt { Disposer.dispose(owner) }
    }
  }

  fun testCompanionUsesTheIdeBrowserWithTheExactRuntimeUrlAndExplicitLaunchMode() {
    val widgets = JetBrainsPanelHost.onEdt { NativeWidgets(project, JsonBoundary()) {} }
    try {
      val opened = mutableListOf<String>()
      val services =
        NativeHostServices(
          project,
          { _, _ -> error("fixture-unused") },
          widgets,
          NativeHostOptions(openBrowser = opened::add),
        )
      val target = "http://127.0.0.1:43123/#k=fixture-only"
      val frame =
        json(
          "jsonrpc" to "2.0",
          "id" to "open",
          "method" to "ui/openExternal",
          "params" to json("uri" to target),
        )
      JsonBoundary().call(frame)
      assertTrue(
        JetBrainsPanelHost
          .onEdt {
            services.request("ui/openExternal", frame.getAsJsonObject("params"), RequestCancellation())
          }.isJsonNull,
      )
      assertEquals(listOf(target), opened)
      assertEquals(
        listOf("/fixture/runtime", "panel", "--companion"),
        RuntimeProcess.panelCommand(
          java.nio.file.Path
            .of("/fixture/runtime"),
          false,
        ),
      )
      assertEquals(
        listOf("/fixture/runtime", "panel", "--stdio"),
        RuntimeProcess.panelCommand(
          java.nio.file.Path
            .of("/fixture/runtime"),
          true,
        ),
      )
    } finally {
      JetBrainsPanelHost.onEdt { Disposer.dispose(widgets) }
    }
  }

  private fun chooser(action: (JDialog) -> Unit): Timer =
    Timer(POLL_MILLIS) {
      Window.getWindows().firstOrNull { it is JDialog && it.title == TITLE && it.isShowing }?.let { dialog ->
        require(dialog is JDialog)
        action(dialog)
      }
    }.apply { start() }

  private fun buttons(component: Component): List<JButton> =
    when (component) {
      is JButton -> listOf(component)
      is Container -> component.components.flatMap(::buttons)
      else -> emptyList()
    }

  companion object {
    private const val TITLE = "Native paid fixture"
    private const val POLL_MILLIS = 25
  }
}
