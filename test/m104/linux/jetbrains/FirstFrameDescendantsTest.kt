package io.github.randynorthrup.musespark

import org.junit.Assert.assertFalse
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

class FirstFrameDescendantsTest {
  @Test
  fun firstReplyRetainsADetachedWorkerWithoutAPeriodicObservation() {
    val receipt = Files.createTempFile(Path.of("build"), "first-frame-", ".pid")
    val runtime =
      RuntimeProcess.start(
        listOf(
          "/usr/bin/python3",
          "-u",
          Path.of("..", "..", "test", "m104", "linux", "jetbrains", "fixtures", "first-frame.py").toAbsolutePath().toString(),
          receipt.toAbsolutePath().toString(),
        ),
        Path.of(".").toAbsolutePath(),
        mapOf("PATH" to "/usr/bin:/bin"),
      )
    val tracker =
      runtime.javaClass
        .getDeclaredField("tracker")
        .apply { isAccessible = true }
        .get(runtime)
    require(tracker is Thread)
    tracker.interrupt()
    tracker.join(TimeUnit.SECONDS.toMillis(1))
    assertFalse(tracker.isAlive)
    val ready = CompletableFuture<Unit>()
    val owner =
      RuntimeConnection(
        runtime,
        JsonBoundary(),
        object : EditorServices {
          override val capabilities = listOf("lifecycle")
          override val metadata = fixtureMetadata()

          override fun request(
            method: String,
            params: com.google.gson.JsonObject,
            cancellation: RequestCancellation,
          ) = error("Fixture has no editor requests")
        },
        {},
        ConnectionEvents({ ready.complete(Unit) }, {}, {}),
      )
    var worker = 0L
    var identity: RuntimeProcess.Identity? = null
    try {
      owner.start()
      ready.get(WAIT_SECONDS, TimeUnit.SECONDS)
      worker = Files.readString(receipt).toLong()
      val handle = requireNotNull(ProcessHandle.of(worker).orElse(null))
      identity = RuntimeProcess.Identity(handle, requireNotNull(handle.info().startInstant().orElse(null)))
      owner.request(
        "tab/complete",
        json(
          "uri" to "file:///workspace/a.kt",
          "position" to json("line" to 0, "character" to 0),
          "version" to 1,
          "context" to json("prefix" to "", "suffix" to "", "trigger" to "invoke"),
        ),
      )
      owner.terminated.get(WAIT_SECONDS, TimeUnit.SECONDS)
      assertFalse(runtime.process.isAlive)
      assertFalse("First-frame worker escaped cleanup", running(worker))
    } finally {
      // A deliberately removed retention guard must not leave its authored worker alive.
      identity?.current()?.destroyForcibly()
      owner.close()
      runtime.close()
      owner.terminated.get(WAIT_SECONDS, TimeUnit.SECONDS)
      Files.deleteIfExists(receipt)
    }
  }

  private fun running(pid: Long): Boolean {
    val handle = ProcessHandle.of(pid).orElse(null) ?: return false
    val stat = Path.of("/proc/$pid/stat")
    return handle.isAlive && (!Files.exists(stat) || Files.readString(stat).substringAfterLast(") ").first() != 'Z')
  }

  companion object {
    private const val WAIT_SECONDS = 10L
  }
}
