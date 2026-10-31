package io.github.randynorthrup.musespark

import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class NativeWidgetsTest : BasePlatformTestCase() {
  fun testNativeCommandRegistrationIsBoundedReplacesByIdAndDisposesEveryAction() {
    val boundary = JsonBoundary()
    val widgets = NativeWidgets(project, boundary) {}
    val manager = ActionManager.getInstance()
    val prefix = "MuseSpark.${project.locationHash}.fixture-"
    try {
      repeat(boundary.maximumQueuedMessages) { index ->
        widgets.register(json("id" to "fixture-$index", "title" to "Fixture action $index"))
        assertNotNull(manager.getAction("$prefix$index"))
      }
      val original = manager.getAction("${prefix}0")
      widgets.register(json("id" to "fixture-0", "title" to "Replacement fixture"))
      assertNotSame(original, manager.getAction("${prefix}0"))
      assertEquals(
        "MHP_PANEL_BACKPRESSURE",
        org.junit.Assert
          .assertThrows(Exception::class.java) {
            widgets.register(json("id" to "fixture-overflow", "title" to "Overflow fixture"))
          }.message,
      )
      assertNull(manager.getAction("${prefix}overflow"))
    } finally {
      widgets.dispose()
    }
    repeat(boundary.maximumQueuedMessages) { assertNull(manager.getAction("$prefix$it")) }
  }
}
