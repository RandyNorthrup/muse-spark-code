package io.github.randynorthrup.musespark

import java.io.Closeable
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit

class RuntimeProcess private constructor(
  val process: Process,
) : Closeable {
  override fun close() {
    // Snapshot descendants before the parent exits; do not lose them on reparenting.
    val descendants = process.descendants().toList().asReversed()
    descendants.forEach { it.destroy() }
    process.destroy()
    if (!process.waitFor(STOP_SECONDS, TimeUnit.SECONDS)) process.destroyForcibly()
    descendants.filter { it.isAlive }.forEach { it.destroyForcibly() }
    process.inputStream.close()
    process.outputStream.close()
    process.errorStream.close()
  }

  fun drainStderr(diagnostic: (String) -> Unit) {
    Thread({
      runCatching {
        process.errorStream.use { stream ->
          val buffer = ByteArray(STDERR_BUFFER_BYTES)
          var reported = false
          while (stream.read(buffer) != -1) {
            if (!reported) {
              diagnostic("MHP_RUNTIME_STDERR")
              reported = true
            }
          }
        }
      }.onFailure { diagnostic("MHP_STDERR_CLOSED") }
    }, "Muse stderr").apply {
      isDaemon = true
      start()
    }
  }

  companion object {
    private const val STDERR_BUFFER_BYTES = 4096
    private const val STOP_SECONDS = 2L
    private val CREDENTIAL_NAMES =
      setOf(
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "OPENAI_KEY",
        "ANTHROPIC_KEY",
        "META_KEY",
      )

    fun environment(source: Map<String, String>): Map<String, String> =
      source.filterKeys { name ->
        val upper = name.uppercase()
        !upper.endsWith("_API_KEY") && upper !in CREDENTIAL_NAMES
      }

    fun executable(
      path: String,
      name: String,
    ): Path? =
      path.split(java.io.File.pathSeparatorChar).firstNotNullOfOrNull { directory ->
        val candidate = Path.of(directory).resolve(name)
        candidate.takeIf { Files.isRegularFile(it) && Files.isExecutable(it) }?.toAbsolutePath()
      }

    fun start(
      command: List<String>,
      cwd: Path,
      sourceEnvironment: Map<String, String>,
    ): RuntimeProcess {
      require(command.isNotEmpty() && Path.of(command.first()).isAbsolute) { "MHP_RUNTIME_NOT_FOUND" }
      val builder = ProcessBuilder(command).directory(cwd.toFile())
      builder.environment().clear()
      builder.environment().putAll(environment(sourceEnvironment))
      return RuntimeProcess(builder.start())
    }
  }
}
