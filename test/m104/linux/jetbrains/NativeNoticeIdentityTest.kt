package io.github.randynorthrup.musespark

import com.intellij.openapi.progress.util.ProgressWindow
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class NativeNoticeIdentityTest : BasePlatformTestCase() {
  private fun windows(widgets: NativeWidgets): List<ProgressWindow> {
    val registered =
      widgets.javaClass
        .getDeclaredField("progresses")
        .apply { isAccessible = true }
        .get(widgets)
    require(registered is Map<*, *>)
    return registered.values.map { value ->
      require(value is ProgressWindow)
      value
    }
  }

  fun testEquivalentNumericNoticeIdsKeepOneNativeLifetime() {
    val widgets = NativeWidgets(project, JsonBoundary()) {}
    try {
      widgets.progress(json("id" to 1, "title" to "Numeric fixture", "done" to false))
      val numeric = windows(widgets).single()
      val equivalent =
        com.google.gson.JsonParser
          .parseString("1e0")
      widgets.progress(json("id" to equivalent, "title" to "Updated fixture", "done" to false))
      assertEquals(listOf(numeric), windows(widgets))
      widgets.progress(json("id" to equivalent, "title" to "Updated fixture", "done" to true))
      assertFalse(numeric.isRunning)
      assertTrue(windows(widgets).isEmpty())
    } finally {
      widgets.dispose()
      com.intellij.testFramework.PlatformTestUtil
        .dispatchAllEventsInIdeEventQueue()
    }
  }

  fun testNumericAndStringNoticeIdsOwnIndependentNativeLifetimes() {
    val widgets = NativeWidgets(project, JsonBoundary()) {}
    try {
      widgets.progress(json("id" to 1, "title" to "Numeric fixture", "done" to false))
      val numeric = windows(widgets).single()
      widgets.progress(json("id" to "1", "title" to "String fixture", "done" to false))
      assertEquals(2, windows(widgets).size)
      val string = windows(widgets).single { it !== numeric }
      assertTrue(numeric.isRunning)
      assertTrue(string.isRunning)

      widgets.progress(json("id" to 1, "title" to "Numeric fixture", "done" to true))
      assertFalse(numeric.isRunning)
      assertEquals(listOf(string), windows(widgets))
      assertTrue(string.isRunning)

      widgets.progress(json("id" to "1", "title" to "String fixture", "done" to true))
      assertFalse(string.isRunning)
      assertTrue(windows(widgets).isEmpty())
    } finally {
      widgets.dispose()
      com.intellij.testFramework.PlatformTestUtil
        .dispatchAllEventsInIdeEventQueue()
    }
  }
}
