package io.github.randynorthrup.musespark

import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.toolWindow.ToolWindowHeadlessManagerImpl
import com.intellij.ui.jcef.JBCefApp
import java.lang.reflect.InvocationTargetException
import java.nio.file.Path

class NativeSurfaceTest : BasePlatformTestCase() {
  fun testRuntimeCloseDisposesOnlyItsCorrelatedPlacement() {
    val host = JetBrainsPanelHost(project, ToolWindowHeadlessManagerImpl.MockToolWindow(project))
    Disposer.register(testRootDisposable, host)
    var closed = 0
    val location =
      object : SurfaceLocation {
        override fun focus() {
          fail("Close must not focus")
        }

        override fun dispose() {
          closed++
        }
      }
    val locations =
      host.javaClass
        .getDeclaredField("locations")
        .apply { isAccessible = true }
        .get(host)
    locations.javaClass.getMethod("put", Any::class.java, Any::class.java).invoke(locations, "native", location)
    val request =
      host.javaClass
        .getDeclaredMethod(
          "surfaceRequest",
          String::class.java,
          com.google.gson.JsonObject::class.java,
          Function0::class.java,
        ).apply {
          isAccessible =
            true
        }
    var checks = 0
    val current = {
      checks++
      Unit
    }
    try {
      assertEquals(jsonValue(null), request.invoke(host, "surfaces/close", json("surfaceId" to "native"), current))
      assertEquals(1, closed)
      assertEquals(1, checks)
      try {
        request.invoke(host, "surfaces/close", json("surfaceId" to "native"), current)
        fail("A closed surface cannot be reused")
      } catch (failure: InvocationTargetException) {
        assertEquals("MHP_PANEL_UNKNOWN_SURFACE", failure.cause?.message)
      }
    } finally {
      Disposer.dispose(host)
    }
  }

  fun testPresentHtmlRefusesUnknownSurfacesWithTypedRefusal() {
    val host = JetBrainsPanelHost(project, ToolWindowHeadlessManagerImpl.MockToolWindow(project))
    Disposer.register(testRootDisposable, host)
    val request =
      host.javaClass
        .getDeclaredMethod(
          "surfaceRequest",
          String::class.java,
          com.google.gson.JsonObject::class.java,
          Function0::class.java,
        ).apply {
          isAccessible =
            true
        }
    val current = {}
    try {
      request.invoke(
        host,
        "surfaces/presentHtml",
        json("surfaceId" to "missing", "sessionId" to "fixture", "html" to "<p>fixture</p>"),
        current,
      )
      fail("Runtime HTML for an unknown surface must be refused")
    } catch (failure: InvocationTargetException) {
      assertEquals("MHP_PANEL_UNKNOWN_SURFACE", failure.cause?.message)
    } finally {
      Disposer.dispose(host)
    }
  }

  fun testJcefConstructionFailureStartsTheCompanion() {
    if (System.getProperty("muse.nativeUi") == "true") return
    assertFalse(JBCefApp.isSupported())
    val host = JetBrainsPanelHost(project, ToolWindowHeadlessManagerImpl.MockToolWindow(project))
    Disposer.register(testRootDisposable, host)
    val runtime =
      RuntimeProcess.start(
        listOf("/usr/bin/python3", "-c", "import time; time.sleep(120)"),
        Path.of(".").toAbsolutePath(),
        mapOf("PATH" to "/usr/bin:/bin"),
      )
    try {
      host.attach(runtime, true)
      val request =
        host.javaClass
          .getDeclaredMethod(
            "surfaceRequest",
            String::class.java,
            com.google.gson.JsonObject::class.java,
            Function0::class.java,
          ).apply {
            isAccessible =
              true
          }
      val failure =
        org.junit.Assert.assertThrows(Exception::class.java) {
          JetBrainsPanelHost.onEdt {
            request.invoke(
              host,
              "surfaces/open",
              json("kind" to "chat", "sessionId" to "fixture", "placement" to "tab"),
              {},
            )
          }
        }
      assertTrue(failure.toString(), failure.cause?.message == "MHP_JCEF_UNSUPPORTED")
      assertTrue(
        "Construction failure must restart in companion mode",
        host.javaClass.getDeclaredField("companion").apply { isAccessible = true }.get(host) as Boolean,
      )
      assertTrue(
        (host.javaClass.getDeclaredField("bindings").apply { isAccessible = true }.get(host) as Map<*, *>).isEmpty(),
      )
      assertTrue(
        (host.javaClass.getDeclaredField("panels").apply { isAccessible = true }.get(host) as Map<*, *>).isEmpty(),
      )
    } finally {
      JetBrainsPanelHost.onEdt { Disposer.dispose(host) }
      runtime.close()
    }
  }
}
