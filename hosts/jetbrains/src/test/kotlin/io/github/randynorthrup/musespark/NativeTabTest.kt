package io.github.randynorthrup.musespark

import com.intellij.codeInsight.inline.completion.testInlineCompletion
import com.intellij.ide.trustedProjects.TrustedProjects
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class NativeTabTest : BasePlatformTestCase() {
  override fun runInDispatchThread() = false

  override fun createTempDirTestFixture(): com.intellij.testFramework.fixtures.TempDirTestFixture =
    com.intellij.testFramework.fixtures.impl
      .TempDirTestFixtureImpl()

  fun testRealInlineLifecycleAcceptsWithTabRejectsWithEscapeAndHonoursRuntimeBudget() {
    val receipt = Files.createTempFile(Path.of("build"), "tab-receipt-", ".jsonl")
    val runtime =
      RuntimeProcess.start(
        listOf(
          "/usr/bin/python3",
          "-u",
          Path.of("test/fixtures/tab_runtime.py").toAbsolutePath().toString(),
          receipt.toAbsolutePath().toString(),
        ),
        Path.of(".").toAbsolutePath(),
        mapOf("PATH" to "/usr/bin:/bin"),
      )
    val boundary = JsonBoundary()
    val registered = CountDownLatch(1)
    val requests =
      java.util.concurrent.atomic
        .AtomicInteger()
    val executor = Executors.newSingleThreadExecutor()
    val widgets = JetBrainsPanelHost.onEdt { NativeWidgets(project, boundary) {} }
    val services = NativeHostServices(project, { _, _ -> jsonValue(null) }, widgets)
    lateinit var pipe: MhpPipe
    val peer =
      MhpConnection(boundary, services, executor, { frame, surface ->
        pipe.send(frame, surface)
        if (frame["method"]?.asString == "tab/complete") requests.incrementAndGet()
        if (frame["id"]?.asString == "register") registered.countDown()
      }, {}, ConnectionEvents({}, {}))
    project.getService(NativeTab::class.java).bind(peer)
    pipe = MhpPipe(runtime.process.inputStream, runtime.process.outputStream, boundary, peer::receive, {})
    try {
      pipe.start()
      peer.initialize(
        fixtureMetadata().apply {
          add("protocolRange", json("minimum" to "mhp/1.5.0", "maximumExclusive" to "mhp/1.6.0"))
          add("capabilities", jsonValue(services.capabilities))
        },
      )
      assertTrue(registered.await(WAIT_SECONDS, TimeUnit.SECONDS))
      assertTrue(project.getService(NativeTab::class.java).enabled("invoke"))
      assertFalse(project.getService(NativeTab::class.java).enabled("automatic"))
      prepareEditor()
      exerciseInline(requests)
      assertReceipts(receipt)
    } finally {
      project.getService(NativeTab::class.java).bind(null)
      peer.close()
      pipe.close()
      runtime.close()
      executor.shutdownNow()
      JetBrainsPanelHost.onEdt { Disposer.dispose(widgets) }
      Files.deleteIfExists(receipt)
    }
  }

  private fun exerciseInline(requests: java.util.concurrent.atomic.AtomicInteger) {
    myFixture.testInlineCompletion {
      callInlineCompletion()
      delay()
      assertInlineHidden()
      assertFileContent("alpha<caret>")
      callInlineCompletion()
      delay()
      assertInlineRender("beta")
      insertWithTab()
      assertFileContent("alphabeta<caret>")
      callInlineCompletion()
      delay()
      assertInlineRender("beta")
      escape()
      assertInlineHidden()
      callInlineCompletion()
      delay()
      assertInlineHidden()
      assertEquals(4, requests.get())
      JetBrainsPanelHost.onEdt { TrustedProjects.setProjectTrusted(project, false) }
      callInlineCompletion()
      delay()
      assertInlineHidden()
      assertEquals(4, requests.get())
    }
  }

  private fun prepareEditor() {
    JetBrainsPanelHost.onEdt {
      TrustedProjects.setProjectTrusted(project, true)
      val file = myFixture.addFileToProject("native-tab.txt", "alpha")
      com.intellij.testFramework.PsiTestUtil
        .addContentRoot(module, file.virtualFile.parent)
      myFixture.configureFromExistingVirtualFile(file.virtualFile)
      myFixture.editor.caretModel.moveToOffset(myFixture.editor.document.textLength)
    }
  }

  private fun assertReceipts(receipt: Path) {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(WAIT_SECONDS)
    while (Files.readAllLines(receipt).size < 3 && System.nanoTime() < deadline) Thread.sleep(POLL_MILLIS)
    val frames = Files.readAllLines(receipt).map { JsonBoundary.parse(it).asJsonObject }
    assertEquals(listOf("tab/rejected", "tab/accepted", "tab/rejected"), frames.map { it["method"].asString })
    assertEquals("misranged", frames[0].getAsJsonObject("params")["id"].asString)
    assertTrue(frames[1].getAsJsonObject("params")["id"].asJsonPrimitive.isNumber)
    assertEquals(31, frames[1].getAsJsonObject("params")["id"].asInt)
    assertEquals("completion-3", frames[2].getAsJsonObject("params")["id"].asString)
  }

  companion object {
    private const val WAIT_SECONDS = 5L
    private const val POLL_MILLIS = 20L
  }
}
