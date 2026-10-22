package io.github.randynorthrup.musespark

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import java.util.ArrayDeque

data class PanelCallbacks(
  val send: (JsonObject, String?) -> Unit,
  val drop: (String) -> Int,
  val deliver: (JsonElement, Long) -> Unit,
  val diagnostic: (String, Int) -> Unit,
)

class PanelSurface(
  val id: String,
  val sessionId: String,
  val kind: String,
  private val boundary: JsonBoundary,
  private val callbacks: PanelCallbacks,
  private val budget: QueueBudget = QueueBudget(boundary),
) {
  init {
    require(kind in setOf("chat", "tasks", "whatsNew")) { "MHP_CAPABILITY_UNAVAILABLE" }
  }

  private var nextToHost = 1L
  private var nextToPanel = 1L
  private var ready = false
  private var closed = false
  private var opened = false
  private var state: JsonElement? = null
  private var reloading = false

  private data class Delivery(
    val payload: JsonElement,
    val seq: Long,
    val bytes: Int,
  )

  private val pending = ArrayDeque<Delivery>()

  @Synchronized
  fun open() {
    require(!opened) { "MHP_PANEL_INVALID_LIFECYCLE" }
    lifecycle("opened")
    opened = true
  }

  @Synchronized
  fun subscribe() {
    check(opened && !closed) { "MHP_PANEL_UNKNOWN_SURFACE" }
    if (ready) return
    lifecycle("ready")
    ready = true
    pending.forEach { callbacks.deliver(it.payload, it.seq) }
  }

  @Synchronized
  fun post(payload: JsonElement) {
    check(!closed && ready) { "MHP_PANEL_NOT_READY" }
    boundary.payload(kind, "toHost", payload)
    // The lifecycle owns a reload replay; the page must not send it twice.
    if (reloading && payload == replayRequest()) {
      reloading = false
      return
    }
    val frame =
      json(
        "mhp" to "1.5",
        "kind" to "panel",
        "surface" to id,
        "direction" to "toHost",
        "seq" to nextToHost,
        "payload" to payload,
      )
    boundary.validate(boundary.panel["envelope"], frame)
    callbacks.send(frame, id)
    nextToHost++
  }

  @Synchronized
  fun receive(frame: JsonObject) {
    boundary.validate(boundary.panel["envelope"], frame)
    check(!closed && frame["surface"].asString == id) { "MHP_PANEL_UNKNOWN_SURFACE" }
    require(frame["direction"].asString == "toPanel") { "MHP_PANEL_WRONG_DIRECTION" }
    require(frame["seq"].asLong == nextToPanel) { "MHP_PANEL_OUT_OF_ORDER" }
    require(ready) { "MHP_PANEL_NOT_READY" }
    val payload = frame["payload"]
    boundary.payload(kind, "toPanel", payload)
    val bytes = frame.toString().toByteArray(Charsets.UTF_8).size
    require(bytes <= boundary.maximumFrameBytes) { "MHP_PANEL_TOO_LARGE" }
    budget.reserve(bytes)
    pending.addLast(Delivery(payload, nextToPanel, bytes))
    callbacks.deliver(payload, nextToPanel)
    nextToPanel++
  }

  @Synchronized
  fun delivered(sequence: Long) {
    require(pending.firstOrNull()?.seq == sequence) { "MHP_PANEL_OUT_OF_ORDER" }
    budget.release(pending.removeFirst().bytes)
  }

  @Synchronized
  fun reload() {
    check(!closed) { "MHP_PANEL_UNKNOWN_SURFACE" }
    lifecycle("reloaded", "stateRequest" to replayRequest())
    ready = false
    reloading = true
  }

  @Synchronized
  fun hidden() = lifecycle("hidden")

  var savedState: JsonElement?
    @Synchronized get() = state?.deepCopy()

    @Synchronized set(value) {
      check(!closed) { "MHP_PANEL_UNKNOWN_SURFACE" }
      val replacement = requireNotNull(value) { "MHP_PANEL_INVALID_PAYLOAD" }
      boundary.state(replacement)
      state = replacement.deepCopy()
    }

  @Synchronized
  fun close() {
    if (closed) return
    val dropped = callbacks.drop(id) + pending.size
    state = null
    pending.forEach { budget.release(it.bytes) }
    pending.clear()
    try {
      lifecycle("closed", "droppedMessages" to dropped)
    } finally {
      closed = true
      ready = false
      if (dropped != 0) callbacks.diagnostic("MHP_PANEL_DROPPED", dropped)
    }
  }

  private fun replayRequest(): JsonElement =
    when (kind) {
      "tasks" -> json("type" to "tasksReady")
      "usage" -> json("type" to "readUsage")
      "whatsNew" -> jsonValue(null)
      else -> json("type" to "ready")
    }

  private fun lifecycle(
    event: String,
    vararg extra: Pair<String, Any?>,
  ) {
    check(!closed) { "MHP_PANEL_UNKNOWN_SURFACE" }
    val frame =
      json(
        "mhp" to "1.5",
        "kind" to "surface",
        "surface" to id,
        "sessionId" to sessionId,
        "surfaceKind" to kind,
        "event" to event,
        *extra,
      )
    boundary.validate(boundary.panel["lifecycle"], frame)
    callbacks.send(frame, null)
  }
}
