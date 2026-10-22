package io.github.randynorthrup.musespark

import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit

/** A separate IDE-like JVM exits while its runtime is still attached. */
object RuntimeExitFixture {
  @JvmStatic
  fun main(arguments: Array<String>) {
    val receipt = Path.of(arguments[0])
    val mode = arguments[1]
    val runtime =
      RuntimeProcess.start(
        listOf(
          "/usr/bin/python3",
          "-u",
          Path.of("test/fixtures/shutdown_runtime.py").toAbsolutePath().toString(),
          receipt.toString(),
          mode,
        ),
        Path.of(".").toAbsolutePath(),
        mapOf("PATH" to "/usr/bin:/bin"),
      )
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(WAIT_SECONDS)
    while (Files.size(receipt) == 0L && System.nanoTime() < deadline) Thread.sleep(POLL_MILLIS)
    check(Files.size(receipt) > 0L) { "FAKE_RUNTIME_RECEIPT_MISSING" }
    if (mode == "detached-parent-first") {
      Thread.sleep(SNAPSHOT_SETTLE_MILLIS)
      Files.writeString(
        receipt.resolveSibling(receipt.fileName.toString().substringBeforeLast('.') + ".release"),
        "exit",
      )
    }
    if (mode == "parent-first" ||
      mode == "detached-parent-first"
    ) {
      check(runtime.process.waitFor(WAIT_SECONDS, TimeUnit.SECONDS))
    }
    System.exit(0)
  }

  private const val SNAPSHOT_SETTLE_MILLIS = 100L
  private const val WAIT_SECONDS = 10L
  private const val POLL_MILLIS = 10L
}
