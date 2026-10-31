package io.github.randynorthrup.musespark

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import java.io.Closeable
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** One generation's actor. Only its private transport tasks perform stream I/O. */
class RuntimeConnection(
  private val runtime: RuntimeProcess,
  private val boundary: JsonBoundary,
  services: EditorServices,
  panel: (JsonObject) -> Unit,
  private val events: ConnectionEvents,
  budget: QueueBudget = QueueBudget(boundary),
) : Closeable,
  MhpPeer {
  val epoch = epochs.incrementAndGet()
  private val closing = AtomicBoolean()
  val isOpen: Boolean get() = !closing.get()
  val terminated = CompletableFuture<Unit>()
  private val waiting = ConcurrentHashMap.newKeySet<CompletableFuture<JsonElement>>()

  private data class Message(
    val bytes: Int,
    val surface: String?,
    val action: () -> Unit,
  )

  private val mailbox = ArrayBlockingQueue<Message>(boundary.maximumQueuedMessages)
  private val mailboxBudget = QueueBudget(boundary)
  private val requests =
    ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, ArrayBlockingQueue(boundary.maximumQueuedMessages), { task ->
      Thread(task, "Muse host request $epoch").apply { isDaemon = true }
    })
  private val completion: (Int, () -> Unit) -> Unit = { bytes, action -> post(bytes, action = action) }
  private val protocol: MhpConnection =
    MhpConnection(
      boundary,
      services,
      requests,
      { frame, surface -> pipe.send(frame, surface) },
      { frame ->
        val bytes = frameBytes(frame)
        mailboxBudget.reserve(bytes)
        runCatching {
          requests.execute {
            try {
              panel(frame)
            } finally {
              mailboxBudget.release(bytes)
            }
          }
        }.onFailure {
          mailboxBudget.release(bytes)
          stop("MHP_PANEL_BACKPRESSURE")
        }
      },
      events.copy(
        initialized = {
          runtime.snapshotDescendants()
          events.initialized()
        },
        diagnostic = { events.diagnostic(safeDiagnostic(it)) },
        failed = ::stop,
        completion = completion,
        epoch = epoch,
      ),
    )
  private val pipe: MhpPipe =
    MhpPipe(runtime.process.inputStream, runtime.process.outputStream, boundary, { frame ->
      post(frameBytes(frame)) { protocol.receive(frame) }
    }, ::stop, budget)

  @Volatile private var reason = "MHP_TRANSPORT_CLOSED"
  private val owner = Thread(::run, "Muse connection $epoch").apply { isDaemon = true }

  fun start() {
    owner.start()
    pipe.start()
    post(1, action = protocol::start)
    runtime.drainStderr { events.diagnostic(safeDiagnostic(it)) }
    runtime.process.onExit().thenRun { stop("MHP_TRANSPORT_ENDED") }
  }

  @Synchronized
  private fun post(
    bytes: Int = 1,
    surface: String? = null,
    action: () -> Unit,
  ): Boolean {
    if (closing.get()) return false
    if (bytes > boundary.maximumFrameBytes || runCatching { mailboxBudget.reserve(bytes) }.isFailure) {
      stop("MHP_PANEL_BACKPRESSURE")
    } else {
      check(mailbox.offer(Message(bytes, surface, action))) { "MHP_PANEL_BACKPRESSURE" }
    }
    return !closing.get()
  }

  private fun run() {
    runCatching {
      while (!closing.get()) {
        val message = mailbox.poll(POLL_MILLIS, TimeUnit.MILLISECONDS) ?: continue
        consume(message)
      }
    }.onFailure { failure ->
      stop(if (failure.message == "MHP_PANEL_BACKPRESSURE") "MHP_PANEL_BACKPRESSURE" else "MHP_TRANSPORT_READ_FAILED")
    }
    Thread.interrupted()
    closing.set(true)
    protocol.close()
    requests.shutdownNow()
    while (true) {
      val message = mailbox.poll() ?: break
      mailboxBudget.release(message.bytes)
    }
    waiting.forEach { it.completeExceptionally(IllegalStateException(reason)) }
    waiting.clear()
    // Request pipe closure without acquiring any stream lock, then kill containment.
    runCatching(pipe::close).onFailure { events.diagnostic("MHP_TRANSPORT_CLOSED") }
    val cleanup = runCatching(runtime::close)
    runCatching {
      pipe.joinWorkers()
      requests.awaitTermination(JOIN_SECONDS, TimeUnit.SECONDS)
    }
    if (cleanup.isSuccess) {
      terminated.complete(Unit)
    } else {
      terminated.completeExceptionally(IllegalStateException("MHP_RUNTIME_STOP_FAILED"))
    }
  }

  private fun consume(message: Message) {
    try {
      if (!closing.get()) message.action()
    } finally {
      mailboxBudget.release(message.bytes)
    }
  }

  override fun request(
    method: String,
    params: JsonObject,
  ): CompletableFuture<JsonElement> {
    val result = CompletableFuture<JsonElement>()
    waiting.add(result)
    result.whenComplete { _, _ -> waiting.remove(result) }
    val snapshot = params.deepCopy()
    if (!post(frameBytes(snapshot)) {
        if (!result.isCancelled) {
          val pending = protocol.request(method, snapshot)
          result.whenComplete { _, _ -> if (result.isCancelled) pending.cancel(true) }
          pending.whenComplete { value, failure ->
            if (failure == null) result.complete(value) else result.completeExceptionally(failure)
          }
        }
      }
    ) {
      result.completeExceptionally(IllegalStateException("MHP_TRANSPORT_CLOSED"))
    }
    return result
  }

  override fun notify(
    method: String,
    params: JsonObject,
  ) {
    val snapshot = params.deepCopy()
    post(frameBytes(snapshot)) { protocol.notify(method, snapshot) }
  }

  fun send(
    frame: JsonObject,
    surface: String?,
  ) {
    // Admission is nonblocking and counts both queued and in-flight frames.
    check(!closing.get()) { "MHP_TRANSPORT_CLOSED" }
    val snapshot = frame.deepCopy()
    check(post(frameBytes(snapshot), surface) { pipe.send(snapshot, surface) }) { "MHP_TRANSPORT_CLOSED" }
  }

  fun drop(surface: String): Int {
    var dropped = 0
    mailbox.filter { it.surface == surface }.forEach { message ->
      if (mailbox.remove(message)) {
        mailboxBudget.release(message.bytes)
        dropped++
      }
    }
    return dropped + pipe.drop(surface)
  }

  @Synchronized
  private fun stop(code: String) {
    if (!closing.get()) {
      reason = safeDiagnostic(code)
      closing.set(true)
      // The owner never waits on IDE work or stream I/O, so wakeup is bounded.
      owner.interrupt()
      events.failed(reason)
    }
  }

  override fun close() = stop("MHP_TRANSPORT_CLOSED")

  companion object {
    private const val POLL_MILLIS = 100L
    private const val JOIN_SECONDS = 2L
    private val epochs = AtomicLong()
    private val diagnostics =
      setOf(
        "MHP_TRANSPORT_CLOSED",
        "MHP_TRANSPORT_ENDED",
        "MHP_TRANSPORT_READ_FAILED",
        "MHP_TRANSPORT_WRITE_FAILED",
        "MHP_TRANSPORT_WRITE_TIMEOUT",
        "MHP_PANEL_BACKPRESSURE",
        "MHP_METADATA_FAILED",
        "MHP_RUNTIME_STDERR",
        "MHP_STDERR_CLOSED",
      )

    fun safeDiagnostic(value: String): String = value.takeIf { it in diagnostics } ?: "MHP_RUNTIME_REQUEST_FAILED"
  }
}

private fun frameBytes(frame: JsonObject): Int = frame.toString().toByteArray(Charsets.UTF_8).size
