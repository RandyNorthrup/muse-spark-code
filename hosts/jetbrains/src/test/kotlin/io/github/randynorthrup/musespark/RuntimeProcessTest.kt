package io.github.randynorthrup.musespark

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class RuntimeProcessTest {
  @Test
  fun realFakeRuntimeNegotiatesReloadsPreservesPaidChoicesAndExitsWithoutCredentials() {
    val boundary = JsonBoundary()
    val delivered = CountDownLatch(1)
    val diagnostics = CopyOnWriteArrayList<String>()
    val frames = CopyOnWriteArrayList<String>()
    val executor = Executors.newSingleThreadExecutor()
    val runtime = startFixture()
    lateinit var pipe: MhpPipe
    lateinit var connection: MhpConnection
    val surface =
      PanelSurface(
        "native-surface",
        "native-session",
        "chat",
        boundary,
        PanelCallbacks({ frame, id ->
          frames.add(frame.toString())
          pipe.send(frame, id)
        }, { pipe.drop(it) }, { _, _ -> delivered.countDown() }, { _, _ -> }),
      )
    connection =
      MhpConnection(
        boundary,
        paidFixture(),
        executor,
        { frame, id ->
          frames.add(frame.toString())
          pipe.send(frame, id)
        },
        surface::receive,
        ConnectionEvents({
          surface.open()
          surface.subscribe()
          surface.post(json("type" to "ready"))
        }, diagnostics::add),
      )
    pipe =
      MhpPipe(runtime.process.inputStream, runtime.process.outputStream, boundary, connection::receive, {
        connection.close()
      })
    try {
      runtime.drainStderr(diagnostics::add)
      pipe.start()
      connection.start()
      assertTrue(delivered.await(WAIT_SECONDS, TimeUnit.SECONDS))
      surface.delivered(1)
      checkReload(surface)
      assertTrue(runtime.process.waitFor(WAIT_SECONDS, TimeUnit.SECONDS))
      assertEquals(0, runtime.process.exitValue())
      assertFalse(frames.joinToString().contains("fixture-only"))
      assertTrue(diagnostics.contains("MHP_RUNTIME_STDERR"))
      assertTrue(diagnostics.all { it.startsWith("MHP_") })
    } finally {
      connection.close()
      pipe.close()
      runtime.close()
      executor.shutdownNow()
    }
  }

  @Test
  fun reusedPidWithDifferentStartInstantCannotBeSignalled() {
    val handle = ProcessHandle.current()
    val started = handle.info().startInstant().orElseThrow()
    assertEquals(handle.pid(), RuntimeProcess.Identity(handle, started).current()?.pid())
    assertEquals(null, RuntimeProcess.Identity(handle, started.plusSeconds(1)).current())
  }

  @Test
  fun runtimeStopsItsSeparateSessionWorkerBeforeForceCleanup() {
    val receipt = Files.createTempFile(Path.of("build"), "cooperative-stop-", ".pid")
    val stopped = receipt.resolveSibling(receipt.fileName.toString().substringBeforeLast('.') + ".stopped")
    val runtime =
      RuntimeProcess.start(
        listOf(
          "/usr/bin/python3",
          "-u",
          Path.of("test/fixtures/shutdown_runtime.py").toAbsolutePath().toString(),
          receipt.toAbsolutePath().toString(),
          "detached-cooperative",
        ),
        Path.of(".").toAbsolutePath(),
        mapOf("PATH" to "/usr/bin:/bin"),
      )
    try {
      val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(WAIT_SECONDS)
      while (Files.size(receipt) == 0L && System.nanoTime() < deadline) Thread.sleep(POLL_MILLIS)
      assertTrue("Worker receipt missing", Files.size(receipt) > 0L)
      runtime.close()
      assertEquals("supervisor-first", Files.readString(stopped))
      assertFalse(runtime.process.isAlive)
    } finally {
      runtime.close()
      if (Files.size(receipt) > 0L) {
        Files.readAllLines(receipt).map(String::toLong).forEach { pid ->
          ProcessHandle.of(pid).ifPresent { it.destroyForcibly() }
        }
      }
      for (suffix in listOf(".stopped", ".signal", ".workerready")) {
        Files.deleteIfExists(receipt.resolveSibling(receipt.fileName.toString().substringBeforeLast('.') + suffix))
      }
      Files.deleteIfExists(receipt)
    }
  }

  private fun checkReload(surface: PanelSurface) {
    surface.savedState = json("draft" to "kept")
    surface.reload()
    surface.subscribe()
    surface.post(json("type" to "ready"))
    assertEquals(json("draft" to "kept"), surface.savedState)
  }

  private fun startFixture(): RuntimeProcess {
    val script = Path.of("test/fixtures/runtime.py").toAbsolutePath()
    return RuntimeProcess.start(
      listOf("/usr/bin/python3", "-u", script.toString()),
      Path.of(".").toAbsolutePath(),
      mapOf(
        "PATH" to "/usr/bin:/bin",
        "PUBLIC_MARKER" to "public-fixture",
        "CANARY_API_KEY" to "fixture-only",
        "META_KEY" to "fixture-only",
      ),
    )
  }

  private fun paidFixture(): EditorServices =
    object : EditorServices {
      override val metadata = fixtureMetadata()
      override val capabilities = listOf("lifecycle", "ui", "surfaces")

      override fun request(
        method: String,
        params: JsonObject,
        cancellation: RequestCancellation,
      ): JsonElement {
        assertEquals("ui/confirm", method)
        cancellation.check()
        assertTrue(params["message"].asString.contains("USD 0.25"))
        assertTrue(params["message"].asString.contains("shared daily budget USD 10"))
        assertEquals(
          listOf("once", "always", "deny"),
          params.getAsJsonArray("choices").map { it.asJsonObject["id"].asString },
        )
        return jsonValue("once")
      }
    }

  @Test
  fun discoversWindowsNpmLaunchersWithoutRequiringUnixExecuteBits() {
    val root = Files.createTempDirectory(Path.of("build"), "windows-path-")
    try {
      val launcher = Files.writeString(root.resolve("muse-spark-code-acp.cmd"), "fixture only")
      assertEquals(launcher.toAbsolutePath(), RuntimeProcess.executable(root.toString(), "muse-spark-code-acp", true))
      assertEquals(null, RuntimeProcess.executable(root.toString(), "muse-spark-code-acp", false))
    } finally {
      Files.deleteIfExists(root.resolve("muse-spark-code-acp.cmd"))
      Files.delete(root)
    }
  }

  companion object {
    private const val POLL_MILLIS = 10L
    private const val WAIT_SECONDS = 10L
  }
}
