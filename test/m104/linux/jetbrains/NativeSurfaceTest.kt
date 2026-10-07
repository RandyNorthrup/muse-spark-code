package io.github.randynorthrup.musespark

import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.toolWindow.ToolWindowHeadlessManagerImpl
import java.lang.reflect.InvocationTargetException

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
}
