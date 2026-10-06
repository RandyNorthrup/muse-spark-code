package io.github.randynorthrup.musespark

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import java.io.Closeable
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class RequestCancellation {
  private val cancelled = AtomicBoolean()
  private var closeDialog: (() -> Unit)? = null

  @Synchronized
  fun onCancel(action: () -> Unit) {
    closeDialog = action
    if (cancelled.get()) action()
  }

  @Synchronized
  fun cancel() {
    cancelled.set(true)
    closeDialog?.invoke()
  }

  fun check() {
    check(!cancelled.get()) { "MHP_CANCELLED" }
  }
}

interface MhpPeer {
  fun request(
    method: String,
    params: JsonObject,
  ): CompletableFuture<JsonElement>

  fun notify(
    method: String,
    params: JsonObject,
  )
}

data class ConnectionEvents(
  val initialized: () -> Unit,
  val diagnostic: (String) -> Unit,
  val failed: (String) -> Unit = {},
  val stopped: () -> Unit = {},
  val completion: (Int, () -> Unit) -> Unit = { _, action -> action() },
  val epoch: Long = 0,
)

class MhpConnection(
  private val boundary: JsonBoundary,
  private val services: EditorServices,
  private val executor: Executor,
  private val send: (JsonObject, String?) -> Unit,
  private val panel: (JsonObject) -> Unit,
  private val events: ConnectionEvents,
) : Closeable,
  MhpPeer {
  private data class Pending(
    val method: String,
    val future: CompletableFuture<JsonElement>,
  )

  private val outbound = ConcurrentHashMap<String, Pending>()

  private data class Incoming(
    val cancellation: RequestCancellation,
    val bytes: Int,
  )

  private val inbound = ConcurrentHashMap<String, Incoming>()
  private val requestBudget = QueueBudget(boundary)
  private var metadataTask: CompletableFuture<JsonObject?>? = null
  private var initializing = false
  private var negotiated = false
  private var closed = false
  private var nextId = 1L

  @Synchronized
  fun receive(frame: JsonObject) {
    check(!closed) { "MHP_TRANSPORT_CLOSED" }
    when {
      frame.has("mhp") -> receivePanel(frame)
      frame.has("method") -> receiveCall(frame)
      else -> receiveResult(frame)
    }
  }

  private fun receivePanel(frame: JsonObject) {
    require(negotiated) { "MHP_INCOMPATIBLE_VERSION" }
    if (frame["kind"]?.asString == "panelError") {
      boundary.validate(boundary.panel["error"], frame)
      events.diagnostic(frame["code"].asString)
    } else {
      boundary.validate(boundary.panel["envelope"], frame)
      panel(frame)
    }
  }

  private fun receiveResult(frame: JsonObject) {
    val pending = outbound[frame["id"]?.toString()] ?: error("MHP_UNCORRELATED_RESULT")
    if (frame.has("error")) {
      boundary.failure(frame)
      outbound.remove(frame["id"].toString())
      pending.future.completeExceptionally(IllegalStateException("MHP_RUNTIME_REQUEST_FAILED"))
    } else {
      boundary.result(pending.method, frame)
      outbound.remove(frame["id"].toString())
      pending.future.complete(frame["result"])
    }
  }

  private fun receiveCall(frame: JsonObject) {
    val definition = boundary.call(frame)
    val method = frame["method"].asString
    require(method == "initialize" || method == "shutdown" || negotiated) { "MHP_INCOMPATIBLE_VERSION" }
    require(definition["direction"].asString != "hostToRuntime") { "MHP_INVALID_REQUEST" }
    when (method) {
      "$/cancelRequest" -> inbound[frame.getAsJsonObject("params")["id"].toString()]?.cancellation?.cancel()
      "initialize" -> initialize(frame)
      "shutdown" -> {
        sendMhpReply(boundary, send, method, frame["id"], jsonValue(null))
        close()
        events.stopped()
      }
      else -> dispatch(frame, definition)
    }
  }

  private fun initialize(frame: JsonObject) {
    require(!negotiated && !initializing) { "MHP_INVALID_REQUEST" }
    val params = frame.getAsJsonObject("params")
    val range = params.getAsJsonObject("protocolRange")
    if (params.getAsJsonArray("capabilities").any { it.asString == "hostMetadata" } &&
      compareVersion(range["minimum"].asString, METADATA_VERSION) <= 0 &&
      compareVersion(range["maximumExclusive"].asString, METADATA_VERSION) > 0
    ) {
      initializing = true
      // Never hold the connection monitor across the host's IDE-thread handoff.
      val task = CompletableFuture.supplyAsync { services.metadata }
      metadataTask = task
      task.orTimeout(METADATA_TIMEOUT_SECONDS, TimeUnit.SECONDS).whenComplete { metadata, failure ->
        events.completion(metadata?.toString()?.toByteArray(Charsets.UTF_8)?.size ?: 1) {
          synchronized(this) {
            if (!closed) {
              runCatching {
                if (failure != null) throw failure
                finishInitialize(frame, metadata)
              }.onFailure {
                sendMhpFailure(boundary, send, events, frame["id"], "MHP_INTERNAL_ERROR")
                close()
                events.failed("MHP_METADATA_FAILED")
              }
            }
          }
        }
      }
    } else {
      finishInitialize(frame, null)
    }
  }

  private fun finishInitialize(
    frame: JsonObject,
    metadata: JsonObject?,
  ) {
    val range = frame.getAsJsonObject("params").getAsJsonObject("protocolRange")
    val selected = if (metadata == null) PANEL_VERSION else METADATA_VERSION
    require(
      compareVersion(range["minimum"].asString, selected) <= 0 &&
        compareVersion(range["maximumExclusive"].asString, selected) > 0 &&
        compareVersion(range["maximumExclusive"].asString, MAXIMUM_VERSION) <= 0,
    ) { "MHP_INCOMPATIBLE_VERSION" }
    val result =
      json(
        "protocolVersion" to selected,
        "capabilities" to if (metadata == null) services.capabilities else services.capabilities + "hostMetadata",
      )
    metadata?.let { result.add("hostMetadata", it) }
    sendMhpReply(boundary, send, "initialize", frame["id"], result)
    initializing = false
    metadataTask = null
    negotiated = true
    events.initialized()
  }

  private fun dispatch(
    frame: JsonObject,
    definition: JsonObject,
  ) {
    val method = frame["method"].asString
    val id = frame["id"] ?: error("MHP_INVALID_REQUEST")
    require(!inbound.containsKey(id.toString())) { "MHP_DUPLICATE_REQUEST" }
    val bytes = frame.toString().toByteArray(Charsets.UTF_8).size
    require(bytes <= boundary.maximumFrameBytes) { "MHP_PANEL_TOO_LARGE" }
    requestBudget.reserve(bytes)
    val cancellation = RequestCancellation()
    inbound[id.toString()] = Incoming(cancellation, bytes)
    val finish: (Result<JsonElement>) -> Unit = { result ->
      events.completion(
        result
          .getOrNull()
          ?.toString()
          ?.toByteArray(Charsets.UTF_8)
          ?.size ?: 1,
      ) {
        synchronized(this) {
          if (!closed && inbound.remove(id.toString()) != null) {
            requestBudget.release(bytes)
            result.fold({ value ->
              runCatching {
                cancellation.check()
                sendMhpReply(boundary, send, method, id, value)
              }.onFailure { sendMhpFailure(boundary, send, events, id, technicalCode(it)) }
            }, { sendMhpFailure(boundary, send, events, id, technicalCode(it)) })
          }
        }
      }
    }
    runCatching {
      executor.execute {
        finish(
          runCatching {
            cancellation.check()
            require(definition["capability"].asString in services.capabilities) { "MHP_UNSUPPORTED_CAPABILITY" }
            services.request(method, frame.getAsJsonObject("params"), cancellation)
          },
        )
      }
    }.onFailure { finish(Result.failure(it)) }
  }

  @Synchronized
  override fun request(
    method: String,
    params: JsonObject,
  ): CompletableFuture<JsonElement> {
    check(negotiated && !closed) { "MHP_INCOMPATIBLE_VERSION" }
    require(outbound.size < boundary.maximumQueuedMessages) { "MHP_PANEL_BACKPRESSURE" }
    val id = "jetbrains-${events.epoch}-${nextId++}"
    val frame = json("jsonrpc" to "2.0", "id" to id, "method" to method, "params" to params)
    val definition = boundary.call(frame)
    require(definition["direction"].asString == "hostToRuntime") { "MHP_INVALID_REQUEST" }
    val future = CompletableFuture<JsonElement>()
    outbound[jsonValue(id).toString()] = Pending(method, future)
    runCatching { send(frame, null) }.onFailure { outbound.remove(jsonValue(id).toString()) }.getOrThrow()
    future.whenComplete { _, _ ->
      events.completion(1) {
        if (future.isCancelled && outbound.containsKey(jsonValue(id).toString())) {
          // Retain the bounded pending slot until its validated late reply arrives.
          runCatching { notify("$/cancelRequest", json("id" to id)) }
        }
      }
    }
    return future
  }

  @Synchronized
  override fun notify(
    method: String,
    params: JsonObject,
  ) {
    if (!negotiated || closed) return
    val frame = json("jsonrpc" to "2.0", "method" to method, "params" to params)
    val definition = boundary.call(frame)
    require(definition["kind"].asString == "notification" && definition["direction"].asString != "runtimeToHost") {
      "MHP_INVALID_REQUEST"
    }
    send(frame, null)
  }

  @Synchronized
  override fun close() {
    if (closed) return
    closed = true
    metadataTask?.cancel(false)
    metadataTask = null
    inbound.values.forEach {
      it.cancellation.cancel()
      requestBudget.release(it.bytes)
    }
    inbound.clear()
    outbound.values.forEach { it.future.completeExceptionally(IllegalStateException("MHP_TRANSPORT_CLOSED")) }
    outbound.clear()
  }

  companion object {
    const val PANEL_VERSION = "mhp/1.1.0"
    private const val METADATA_TIMEOUT_SECONDS = 2L
    private const val METADATA_VERSION = "mhp/1.2.0"
    private const val MAXIMUM_VERSION = "mhp/1.3.0"
    private val ERRORS =
      setOf(
        "MHP_UNSUPPORTED_CAPABILITY",
        "MHP_VERSION_CONFLICT",
        "MHP_DIRTY_BUFFER",
        "MHP_UNTRUSTED_WORKSPACE",
        "MHP_PERMISSION_DENIED",
        "MHP_CANCELLED",
        "MHP_INVALID_RANGE",
        "MHP_OVERLAPPING_EDITS",
        "MHP_INVALID_PARAMS",
      )

    fun technicalCode(failure: Throwable): String = failure.message?.takeIf { it in ERRORS } ?: "MHP_INTERNAL_ERROR"
  }
}

private fun compareVersion(
  left: String,
  right: String,
): Int {
  val parts = left.removePrefix("mhp/").split('.').map(String::toBigInteger)
  val others = right.removePrefix("mhp/").split('.').map(String::toBigInteger)
  return parts.zip(others).map { (one, other) -> one.compareTo(other) }.firstOrNull { it != 0 } ?: 0
}

private fun sendMhpFailure(
  boundary: JsonBoundary,
  send: (JsonObject, String?) -> Unit,
  events: ConnectionEvents,
  id: JsonElement,
  code: String,
) {
  val numeric =
    when (code) {
      "MHP_UNSUPPORTED_CAPABILITY" -> "unsupportedCapability"
      "MHP_VERSION_CONFLICT" -> "versionConflict"
      "MHP_DIRTY_BUFFER" -> "dirtyBuffer"
      "MHP_UNTRUSTED_WORKSPACE" -> "untrustedWorkspace"
      "MHP_PERMISSION_DENIED" -> "permissionDenied"
      "MHP_CANCELLED" -> "cancelled"
      "MHP_INVALID_RANGE", "MHP_OVERLAPPING_EDITS", "MHP_INVALID_PARAMS" -> "invalidParams"
      else -> "internalError"
    }
  val frame =
    json(
      "jsonrpc" to "2.0",
      "id" to id,
      "error" to json("code" to boundary.errorCode(numeric), "message" to code),
    )
  boundary.failure(frame)
  runCatching { send(frame, null) }.onFailure { events.diagnostic("MHP_TRANSPORT_WRITE_FAILED") }
}

private fun sendMhpReply(
  boundary: JsonBoundary,
  send: (JsonObject, String?) -> Unit,
  method: String,
  id: JsonElement,
  result: JsonElement,
) {
  val response = json("jsonrpc" to "2.0", "id" to id, "result" to result)
  boundary.result(method, response)
  send(response, null)
}
