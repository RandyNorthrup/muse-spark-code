package io.github.randynorthrup.musespark

import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.toolWindow.ToolWindowHeadlessManagerImpl
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit

class NativeLifecycleTest : BasePlatformTestCase() {
  fun testTransportFailureDisposesNativeSessionUnbindsTabAndKillsTheRuntimeTree() {
    val receipt = Files.createTempFile(Path.of("build"), "failed-runtime-", ".pid")
    val release = receipt.resolveSibling(receipt.fileName.toString() + ".release")
    val runtime =
      RuntimeProcess.start(
        listOf(
          "/usr/bin/python3",
          "-u",
          Path.of("test/fixtures/failed_runtime.py").toAbsolutePath().toString(),
          receipt.toAbsolutePath().toString(),
          release.toAbsolutePath().toString(),
        ),
        Path.of(".").toAbsolutePath(),
        mapOf("PATH" to "/usr/bin:/bin"),
      )
    var host: JetBrainsPanelHost? = null
    var child: ProcessHandle? = null
    val action = "MuseSpark.${project.locationHash}.failure-fixture"
    try {
      host =
        JetBrainsPanelHost.onEdt {
          // Light fixtures have no initialized native tool-window pane, even under Xvfb.
          val window = ToolWindowHeadlessManagerImpl.MockToolWindow(project)
          JetBrainsPanelHost(project, window).also {
            Disposer.register(testRootDisposable, it)
            it.attach(runtime, false)
          }
        }
      val tab = project.getService(NativeTab::class.java)
      com.intellij.testFramework.PlatformTestUtil.waitWithEventsDispatching(
        "Tab registration",
        { tab.enabled("invoke") },
        10,
      )
      child = ProcessHandle.of(Files.readString(receipt).toLong()).orElseThrow()
      assertTrue(child.isAlive)
      assertNotNull(JetBrainsPanelHost.onEdt { ActionManager.getInstance().getAction(action) })
      Files.writeString(release, "fail")
      com.intellij.testFramework.PlatformTestUtil.waitWithEventsDispatching("Native teardown", {
        !tab.enabled("invoke") && JetBrainsPanelHost.onEdt { ActionManager.getInstance().getAction(action) == null }
      }, 10)
      assertTrue(runtime.process.waitFor(10, TimeUnit.SECONDS))
      com.intellij.testFramework.PlatformTestUtil
        .waitWithEventsDispatching("Worker teardown", { !child.isAlive }, 10)
      assertFalse(tab.enabled("invoke"))
      assertNull(JetBrainsPanelHost.onEdt { ActionManager.getInstance().getAction(action) })
    } finally {
      JetBrainsPanelHost.onEdt { host?.let(Disposer::dispose) }
      runtime.close()
      child?.destroyForcibly()
      Files.deleteIfExists(receipt)
      Files.deleteIfExists(release)
    }
  }
}
