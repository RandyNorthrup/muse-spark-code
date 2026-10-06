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
