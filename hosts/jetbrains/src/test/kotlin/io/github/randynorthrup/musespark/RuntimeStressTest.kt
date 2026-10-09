package io.github.randynorthrup.musespark

import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.HeavyPlatformTestCase
import com.intellij.testFramework.PlatformTestUtil
import com.intellij.toolWindow.ToolWindowHeadlessManagerImpl
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.swing.JLabel
import javax.swing.SwingUtilities

/** Real process pipes and native project lifetimes, including a replacement generation. */
class RuntimeStressTest : HeavyPlatformTestCase() {
  override fun runInDispatchThread() = false

  private var projectClosing: Fixture? = null

  override fun tearDown() {
    val fixture = projectClosing
    try {
      super.tearDown() // Heavy fixture closes the actual IDE project and its registered host.
      fixture?.assertStopped()
    } finally {
      try {
        fixture?.close()
      } finally {
        fixture?.emergencyCleanup()
      }
    }
  }

  fun testIdeJvmExitKillsAnAttachedRuntimeAndItsWorker() = exitFixture("alive")

  fun testIdeJvmExitKillsAWorkerWhoseRuntimeParentAlreadyExited() = exitFixture("parent-first")

  fun testR3IdeJvmExitKillsSeparateSessionWorkerWhoseRuntimeParentExited() = exitFixture("detached-parent-first")

  private fun exitFixture(mode: String) {
    val receipt = Files.createTempFile(Path.of("build"), "jvm-exit-", ".pid")
    val sdk = Path.of(System.getProperty("idea.home.path"))
    val classpath =
      listOf(
        Path.of("build/classes/kotlin/test").toAbsolutePath(),
        Path.of("build/classes/kotlin/main").toAbsolutePath(),
        sdk.resolve("lib/*"),
      ).joinToString(java.io.File.pathSeparator)
    val builder =
      ProcessBuilder(
        Path.of(System.getProperty("java.home"), "bin/java").toString(),
        "-Didea.home.path=$sdk",
        "-Djna.boot.library.path=${sdk.resolve("lib/jna/amd64")}",
        "-Djna.noclasspath=true",
        "-cp",
        classpath,
        "io.github.randynorthrup.musespark.RuntimeExitFixture",
        receipt.toAbsolutePath().toString(),
        mode,
      )
    builder.environment().clear()
    builder.environment()["PATH"] = "/usr/bin:/bin"
    val helper = builder.start()
    try {
      assertTrue("Separate JVM exit stalled", helper.waitFor(WAIT_SECONDS, TimeUnit.SECONDS))
      assertEquals(helper.errorStream.readAllBytes().toString(Charsets.UTF_8), 0, helper.exitValue())
      val pids = Files.readAllLines(receipt).map(String::toLong)
      assertEquals(2, pids.size)
      waitUntil("IDE JVM exit stops its contained workers") { pids.none(::running) }
    } finally {
      helper.destroyForcibly()
      if (Files.size(receipt) > 0) {
        Files.readAllLines(receipt).map(String::toLong).forEach { pid ->
          ProcessHandle.of(pid).ifPresent { it.destroyForcibly() }
        }
      }
      Files.deleteIfExists(receipt.resolveSibling(receipt.fileName.toString().substringBeforeLast('.') + ".release"))
      Files.deleteIfExists(receipt)
    }
  }

  fun testAggregateMailboxBytesFailBeforeTheActorCanDrainThem() {
    val receipt = Files.createTempFile(Path.of("build"), "mailbox-budget-", ".pid")
    val releasePath = receipt.resolveSibling(receipt.fileName.toString() + ".release")
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val failed = CountDownLatch(1)
    val runtime =
      RuntimeProcess.start(
        listOf(
          "/usr/bin/python3",
          "-u",
          Path.of("test/fixtures/stress_runtime.py").toAbsolutePath().toString(),
          "normal",
          receipt.toAbsolutePath().toString(),
          releasePath.toAbsolutePath().toString(),
        ),
        Path.of(".").toAbsolutePath(),
        mapOf("PATH" to "/usr/bin:/bin"),
      )
    val owner =
      RuntimeConnection(
        runtime,
        JsonBoundary(),
        object : EditorServices {
          override val metadata = fixtureMetadata()
          override val capabilities = listOf("lifecycle", "commands", "tab", "documents")

          override fun request(
            method: String,
            params: com.google.gson.JsonObject,
            cancellation: RequestCancellation,
          ) = jsonValue(null)
        },
        {},
        ConnectionEvents({
          entered.countDown()
          // Deliberately hold the actor to test admission separately from the downstream pipe.
          release.await(WAIT_SECONDS, TimeUnit.SECONDS)
        }, {}, { code -> if (code == "MHP_PANEL_BACKPRESSURE") failed.countDown() }),
      )
    try {
      owner.start()
      assertTrue(entered.await(WAIT_SECONDS, TimeUnit.SECONDS))
      val notification = documentNotification()
      notification.addProperty("text", "x".repeat(JsonBoundary().maximumFrameBytes / 2))
      repeat(4) { owner.notify("documents/didChange", notification) }
      assertTrue("Mailbox aggregate bytes must fail admission", failed.await(1, TimeUnit.SECONDS))
    } finally {
      release.countDown()
      owner.close()
      owner.terminated.get(WAIT_SECONDS, TimeUnit.SECONDS)
      Files.deleteIfExists(receipt)
    }
  }

  fun testR2BlockedStdinFailsWithAWriteDeadlineAndReconnects() =
    exercise("blocked") { fixture ->
      fixture.release()
      fixture.waitFor(".ready")
      fixture.owner.notify("documents/didChange", documentNotification())
      fixture.failed("MHP_TRANSPORT_WRITE_TIMEOUT")
    }

  fun testR2BlockedStdinCannotFreezeProjectDisposal() =
    exercise("blocked") { fixture ->
      fixture.release()
      fixture.waitFor(".ready")
      fixture.owner.notify("documents/didChange", documentNotification())
      closePromptly(fixture)
    }

  fun testOutputFloodFailsBoundedAdmissionAndReconnects() =
    exercise("flood") { fixture ->
      fixture.release()
      fixture.failed("MHP_PANEL_BACKPRESSURE")
    }

  fun testR2ParentFirstDeathKillsReparentedWorkerAndReconnects() =
    exercise("die") { fixture ->
      val request = fixture.owner.request("tab/complete", tabParams())
      fixture.failed("MHP_TRANSPORT_ENDED")
      assertTrue(request.isCompletedExceptionally)
    }

  fun testR3ParentFirstDeathKillsSeparateSessionWorkerAndReconnects() =
    exercise("detached-die") { fixture ->
      val request = fixture.owner.request("tab/complete", tabParams())
      fixture.failed("MHP_TRANSPORT_ENDED")
      assertTrue(request.isCompletedExceptionally)
    }

  fun testShutdownHangCannotFreezeProjectCloseAndReconnects() =
    exercise("shutdown") { fixture ->
      fixture.release()
      fixture.waitFor(".ready")
      closePromptly(fixture)
    }

  fun testR1LateCancelledTabReplyKeepsTheNativeSessionAndReplacementAlive() =
    exercise("late") { fixture ->
      val pending = fixture.owner.request("tab/complete", tabParams())
      fixture.waitFor(".pending")
      assertTrue(pending.cancel(true))
      assertEquals(
        jsonValue(emptyList<String>()),
        fixture.owner.request("tab/complete", tabParams()).get(WAIT_SECONDS, TimeUnit.SECONDS),
      )
      assertTrue(project.getService(NativeTab::class.java).enabled("invoke"))
      assertNotNull(JetBrainsPanelHost.onEdt { ActionManager.getInstance().getAction(actionId()) })
    }

  fun testR2OutOfRangeWireEditCannotChangeTheNativeDocumentAndReconnects() =
    exercise("overflow") { fixture ->
      val document =
        JetBrainsPanelHost.onEdt {
          val file = getVirtualFile(createTempFile("overflow.txt", "alpha"))
          com.intellij.testFramework.PsiTestUtil
            .addContentRoot(module, file.parent)
          com.intellij.ide.trustedProjects.TrustedProjects
            .setProjectTrusted(project, true)
          val buffer = requireNotNull(FileDocumentManager.getInstance().getDocument(file))
          FileDocumentManager.getInstance().saveDocument(buffer)
          Files.writeString(
            fixture.receipt.resolveSibling(
              fixture.receipt.fileName
                .toString()
                .substringBeforeLast('.') + ".document",
            ),
            json("uri" to DocumentServices.uri(file), "expectedVersion" to buffer.modificationStamp).toString(),
          )
          buffer
        }
      fixture.release()
      val result = JsonBoundary.parse(Files.readString(fixture.waitFor(".result"))).asJsonObject
      assertEquals("MHP_INVALID_RANGE", result.getAsJsonObject("error")["message"].asString)
      assertEquals("alpha", JetBrainsPanelHost.onEdt { document.text })
      assertEquals(
        jsonValue(emptyList<String>()),
        fixture.owner.request("tab/complete", tabParams()).get(WAIT_SECONDS, TimeUnit.SECONDS),
      )
    }

  fun testR2RawTabFailureExposesOnlyFixedTextAndReconnects() =
    exercise("tab-error") { fixture ->
      val failure =
        org.junit.Assert.assertThrows(java.util.concurrent.ExecutionException::class.java) {
          fixture.owner.request("tab/complete", tabParams()).get(WAIT_SECONDS, TimeUnit.SECONDS)
        }
      assertEquals("MHP_RUNTIME_REQUEST_FAILED", failure.cause?.message)
      assertFalse(failure.stackTraceToString().contains("FIXTURE_ONLY_PRIVATE_ACCOUNT_FILE_CONTENTS"))
    }

  fun testR1MetadataEdtHandoffCannotDeadlockDisposal() = metadataLifetime(true)

  fun testR2MetadataDeadlineTearsDownTheWholeConnectingAttemptAndReconnects() = metadataLifetime(false)

  private fun metadataLifetime(dispose: Boolean) {
    val receipt = Files.createTempFile(Path.of("build"), "metadata-owner-", ".pid")
    val releasePath = receipt.resolveSibling(receipt.fileName.toString() + ".release")
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val failed = CountDownLatch(1)
    val runtime =
      RuntimeProcess.start(
        listOf(
          "/usr/bin/python3",
          "-u",
          Path.of("test/fixtures/stress_runtime.py").toAbsolutePath().toString(),
          "normal",
          receipt.toAbsolutePath().toString(),
          releasePath.toAbsolutePath().toString(),
        ),
        Path.of(".").toAbsolutePath(),
        mapOf("PATH" to "/usr/bin:/bin"),
      )
    val owner =
      RuntimeConnection(
        runtime,
        JsonBoundary(),
        object : EditorServices {
          override val capabilities = listOf("lifecycle")
          override val metadata: com.google.gson.JsonObject
            get() {
              entered.countDown()
              release.await(WAIT_SECONDS, TimeUnit.SECONDS)
              return fixtureMetadata()
            }

          override fun request(
            method: String,
            params: com.google.gson.JsonObject,
            cancellation: RequestCancellation,
          ) = jsonValue(null)
        },
        {},
        ConnectionEvents({}, {}, { code -> if (code == "MHP_METADATA_FAILED") failed.countDown() }),
      )
    try {
      owner.start()
      assertTrue(entered.await(WAIT_SECONDS, TimeUnit.SECONDS))
      waitUntil("metadata worker receipt") { Files.size(receipt) > 0 }
      if (dispose) owner.close()
      owner.terminated.get(WAIT_SECONDS, TimeUnit.SECONDS)
      if (!dispose) assertEquals(0L, failed.count)
      release.countDown()
      assertFalse(owner.isOpen)
      assertFalse(runtime.process.isAlive)
      waitUntil("metadata descendant cleanup") { !running(Files.readString(receipt).toLong()) }
    } finally {
      release.countDown()
      owner.close()
      runtime.close()
      Files.deleteIfExists(receipt)
      Files.deleteIfExists(releasePath)
    }
    exercise("normal") {}
  }

  private fun exercise(
    mode: String,
    scenario: (Fixture) -> Unit,
  ) {
    val original = Fixture(mode)
    try {
      scenario(original)
      original.close()
      original.assertStopped()
      val replacement = Fixture("normal")
      try {
        assertTrue(replacement.owner.epoch > original.owner.epoch)
        assertTrue(original.owner.request("tab/complete", tabParams()).isCompletedExceptionally)
        assertEquals(
          jsonValue(emptyList<String>()),
          replacement.owner.request("tab/complete", tabParams()).get(WAIT_SECONDS, TimeUnit.SECONDS),
        )
      } finally {
        try {
          replacement.close()
          replacement.assertStopped()
        } finally {
          replacement.emergencyCleanup()
        }
      }
      projectClosing =
        Fixture(mode).also { fixture ->
          when (mode) {
            "blocked", "shutdown" -> {
              fixture.release()
              fixture.waitFor(".ready")
              fixture.owner.notify("documents/didChange", documentNotification())
            }
            "late", "die", "detached-die" -> fixture.owner.request("tab/complete", tabParams())
            "flood" -> fixture.release()
          }
        }
    } finally {
      try {
        original.close()
      } finally {
        original.emergencyCleanup()
      }
    }
  }

  private fun closePromptly(fixture: Fixture) {
    val before = System.nanoTime()
    JetBrainsPanelHost.onEdt { Disposer.dispose(fixture.host) }
    assertTrue("IDE disposal waited on process I/O", System.nanoTime() - before < TimeUnit.SECONDS.toNanos(1))
  }

  private fun actionId() = "MuseSpark.${project.locationHash}.stress-fixture"

  private inner class Fixture(
    mode: String,
    awaitRegistration: Boolean = true,
  ) : AutoCloseable {
    val receipt = Files.createTempFile(Path.of("build"), "runtime-stress-", ".pid")
    private val releasePath = receipt.resolveSibling(receipt.fileName.toString() + ".release")
    private val runtime =
      RuntimeProcess.start(
        listOf(
          "/usr/bin/python3",
          "-u",
          Path.of("test/fixtures/stress_runtime.py").toAbsolutePath().toString(),
          mode,
          receipt.toAbsolutePath().toString(),
          releasePath.toAbsolutePath().toString(),
        ),
        Path.of(".").toAbsolutePath(),
        mapOf("PATH" to "/usr/bin:/bin"),
      )
    private val window = ToolWindowHeadlessManagerImpl.MockToolWindow(project)
    val host =
      JetBrainsPanelHost.onEdt {
        JetBrainsPanelHost(project, window).also {
          Disposer.register(project, it)
          it.attach(runtime, false)
        }
      }
    val owner = requireNotNull(host.connection)

    private var workerPid = 0L

    init {
      waitUntil("Worker receipt") { Files.size(receipt) > 0 }
      workerPid = Files.readString(receipt).toLong()
      if (awaitRegistration) {
        waitUntil(
          "Native registration",
        ) { project.getService(NativeTab::class.java).enabled("invoke") }
      }
    }

    fun release() {
      Files.writeString(releasePath, "release")
    }

    fun waitFor(suffix: String): Path {
      val path = receipt.resolveSibling(receipt.fileName.toString().substringBeforeLast('.') + suffix)
      waitUntil("Runtime receipt $suffix") { Files.exists(path) && Files.size(path) > 0 }
      return path
    }

    fun failed(code: String) {
      waitUntil("Native visible failure $code") {
        host.connection == null &&
          window.contentManager.contents.any { content ->
            (content.component as? javax.swing.JPanel)?.components?.filterIsInstance<JLabel>()?.any {
              it.text.endsWith(
                code,
              )
            } ==
              true
          }
      }
      assertFalse(project.getService(NativeTab::class.java).enabled("invoke"))
      assertNull(JetBrainsPanelHost.onEdt { ActionManager.getInstance().getAction(actionId()) })
    }

    fun assertStopped() {
      owner.terminated.get(WAIT_SECONDS, TimeUnit.SECONDS)
      assertFalse(runtime.process.isAlive)
      waitUntil("Contained worker stopped") { !running(workerPid) }
    }

    fun emergencyCleanup() {
      // Only after assertions: a deliberate containment red drill must not orphan its fake worker.
      ProcessHandle.of(workerPid).ifPresent { it.destroyForcibly() }
      runtime.close()
    }

    override fun close() {
      JetBrainsPanelHost.onEdt { if (!Disposer.isDisposed(host)) Disposer.dispose(host) }
      owner.terminated.get(WAIT_SECONDS, TimeUnit.SECONDS)
      for (suffix in listOf(".pid", ".pid.release", ".ready", ".pending", ".document", ".result")) {
        Files.deleteIfExists(receipt.resolveSibling(receipt.fileName.toString().substringBeforeLast('.') + suffix))
      }
    }
  }

  private fun waitUntil(
    label: String,
    condition: () -> Boolean,
  ) {
    JetBrainsPanelHost.onEdt { PlatformTestUtil.waitWithEventsDispatching(label, condition, WAIT_SECONDS.toInt()) }
  }

  private fun running(pid: Long): Boolean {
    val handle = ProcessHandle.of(pid).orElse(null) ?: return false
    val stat = Path.of("/proc/$pid/stat")
    return handle.isAlive && (!Files.exists(stat) || Files.readString(stat).substringAfterLast(") ").first() != 'Z')
  }

  private fun tabParams() =
    json(
      "uri" to "file:///workspace/a.kt",
      "position" to json("line" to 0, "character" to 0),
      "version" to 1,
      "context" to json("prefix" to "", "suffix" to "", "trigger" to "invoke"),
    )

  private fun documentNotification() =
    json(
      "document" to
        json(
          "uri" to "file:///workspace/a.kt",
          "version" to 1,
          "dirty" to true,
          "languageId" to "plaintext",
        ),
      "text" to "x".repeat(1024 * 1024),
    )

  companion object {
    private const val WAIT_SECONDS = 10L
  }
}
