package io.github.randynorthrup.musespark

import com.intellij.execution.configurations.GeneralCommandLine
import java.io.Closeable
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class RuntimeProcess private constructor(
  val process: Process,
  private val containment: Closeable,
) : Closeable {
  private var stderr: Thread? = null
  private val closed = AtomicBoolean()
  private val containmentClosed = AtomicBoolean()
  private val forceStop = {
    if (containmentClosed.compareAndSet(false, true)) containment.close()
    process.toHandle().destroyForcibly()
  }
  private val shutdown = Thread({ runCatching(forceStop) }, "Muse runtime JVM shutdown")

  init {
    Runtime.getRuntime().addShutdownHook(shutdown)
  }

  override fun close() {
    if (!closed.compareAndSet(false, true)) return
    // Process.destroy also closes buffered streams; signal only through handles.
    val stderrClose =
      Thread({ runCatching { process.errorStream.close() } }, "Muse stderr close").apply {
        isDaemon = true
        start()
      }
    val descendants = process.descendants().toList().asReversed()
    try {
      try {
        descendants.forEach { it.destroy() }
        process.toHandle().destroy()
        process.waitFor(STOP_SECONDS, TimeUnit.SECONDS)
      } finally {
        forceStop()
      }
      process.waitFor(STOP_SECONDS, TimeUnit.SECONDS)
      descendants.filter { it.isAlive }.forEach { it.destroyForcibly() }
      stderr?.join(STOP_MILLIS)
      stderrClose.join(STOP_MILLIS)
    } finally {
      // During JVM exit the registered hook is already running; it never touches streams.
      runCatching { Runtime.getRuntime().removeShutdownHook(shutdown) }
    }
  }

  fun drainStderr(diagnostic: (String) -> Unit) {
    stderr =
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
    private const val STOP_MILLIS = 2000L
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
      windows: Boolean = com.intellij.openapi.util.SystemInfo.isWindows,
    ): Path? =
      path.split(java.io.File.pathSeparatorChar).firstNotNullOfOrNull { directory ->
        val names = if (windows) listOf("$name.exe", "$name.cmd", "$name.bat", name) else listOf(name)
        names.firstNotNullOfOrNull { filename ->
          val candidate = Path.of(directory).resolve(filename)
          candidate.takeIf { Files.isRegularFile(it) && (windows || Files.isExecutable(it)) }?.toAbsolutePath()
        }
      }

    fun panelCommand(
      executable: Path,
      embedded: Boolean,
    ): List<String> = listOf(executable.toString(), "panel", if (embedded) "--stdio" else "--companion")

    fun start(
      command: List<String>,
      cwd: Path,
      sourceEnvironment: Map<String, String>,
    ): RuntimeProcess {
      require(command.isNotEmpty() && Path.of(command.first()).isAbsolute) { "MHP_RUNTIME_NOT_FOUND" }
      val windows = com.intellij.openapi.util.SystemInfo.isWindows
      // Prepare the native signal function before starting a child or registering its shutdown hook.
      val kill =
        if (windows) {
          null
        } else {
          com.sun.jna.NativeLibrary
            .getInstance("c")
            .getFunction("kill")
        }
      val job = if (windows) WindowsJob() else null
      val launch =
        if (windows) {
          require(command.all { !it.contains('"') && !it.contains('\n') && !it.contains('\r') }) {
            "MHP_RUNTIME_CONTAINMENT_UNAVAILABLE"
          }
          val shell = Path.of(System.getenv("SystemRoot") ?: "C:\\Windows").resolve("System32/cmd.exe")
          listOf(
            shell.toString(),
            "/d",
            "/s",
            "/c",
            "set /p muse_start= >nul & " + command.joinToString(" ") { "\"$it\"" },
          )
        } else {
          // The launcher establishes the session before exec; its PID is the stable group ID.
          listOf(
            "/usr/bin/perl",
            "-MPOSIX",
            "-e",
            "POSIX::setsid() >= 0 or die; exec {\$ARGV[0]} @ARGV; die;",
            "--",
          ) + command
        }
      val builder =
        GeneralCommandLine(launch)
          .withWorkDirectory(cwd.toFile())
          .withParentEnvironmentType(GeneralCommandLine.ParentEnvironmentType.NONE)
          .withEnvironment(environment(sourceEnvironment))
      val process = runCatching { builder.createProcess() }.onFailure { job?.close() }.getOrThrow()
      val containment =
        job ?: Closeable {
          requireNotNull(kill).invokeInt(arrayOf(-Math.toIntExact(process.pid()), KILL_SIGNAL))
        }
      return runCatching {
        if (job != null) {
          job.assign(process.pid())
          // cmd cannot launch the runtime until containment is attached.
          process.outputStream.write("start\n".toByteArray(Charsets.UTF_8))
          process.outputStream.flush()
        }
        RuntimeProcess(process, containment)
      }.onFailure {
        containment.close()
        process.destroyForcibly()
      }.getOrThrow()
    }

    private const val KILL_SIGNAL = 9
  }
}

/** A suspended-by-stdin launcher is assigned before it can create runtime children. */
private class WindowsJob : Closeable {
  private val kernel =
    com.sun.jna.NativeLibrary
      .getInstance("kernel32")
  private val job =
    requireNotNull(kernel.getFunction("CreateJobObjectW").invokePointer(arrayOf(null, null))) {
      "MHP_RUNTIME_CONTAINMENT_UNAVAILABLE"
    }

  init {
    runCatching {
      // JOBOBJECT_EXTENDED_LIMIT_INFORMATION on the IDE's supported 64-bit Windows JVM.
      com.sun.jna.Memory(JOB_INFORMATION_BYTES).use { limits ->
        limits.clear()
        limits.setInt(LIMIT_FLAGS_OFFSET, KILL_ON_JOB_CLOSE)
        check(
          kernel.getFunction("SetInformationJobObject").invokeInt(
            arrayOf(job, EXTENDED_LIMIT_INFORMATION, limits, JOB_INFORMATION_BYTES.toInt()),
          ) != 0,
        ) { "MHP_RUNTIME_CONTAINMENT_UNAVAILABLE" }
      }
    }.onFailure { kernel.getFunction("CloseHandle").invokeInt(arrayOf(job)) }.getOrThrow()
  }

  fun assign(pid: Long) {
    val handle =
      requireNotNull(
        kernel.getFunction("OpenProcess").invokePointer(arrayOf<Any>(PROCESS_ACCESS, false, Math.toIntExact(pid))),
      ) {
        "MHP_RUNTIME_CONTAINMENT_UNAVAILABLE"
      }
    try {
      check(kernel.getFunction("AssignProcessToJobObject").invokeInt(arrayOf(job, handle)) != 0) {
        "MHP_RUNTIME_CONTAINMENT_UNAVAILABLE"
      }
    } finally {
      kernel.getFunction("CloseHandle").invokeInt(arrayOf(handle))
    }
  }

  override fun close() {
    kernel.getFunction("TerminateJobObject").invokeInt(arrayOf(job, 1))
    kernel.getFunction("CloseHandle").invokeInt(arrayOf(job))
  }

  companion object {
    private const val JOB_INFORMATION_BYTES = 144L
    private const val LIMIT_FLAGS_OFFSET = 16L
    private const val KILL_ON_JOB_CLOSE = 0x2000
    private const val EXTENDED_LIMIT_INFORMATION = 9
    private const val PROCESS_ACCESS = 0x0101
  }
}
