package io.github.randynorthrup.musespark

import com.google.gson.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PanelSurfaceTest {
  private val boundary = JsonBoundary()
  private val sent = mutableListOf<JsonObject>()
  private val rendered = mutableListOf<Long>()
  private val warnings = mutableListOf<Pair<String, Int>>()

  private fun surface(kind: String = "chat") =
    PanelSurface(
      "surface",
      "session",
      kind,
      boundary,
      PanelCallbacks(
        { frame, _ -> sent.add(frame) },
        { 0 },
        { _, seq -> rendered.add(seq) },
        { code, count ->
          warnings.add(code to count)
        },
      ),
    )

  private fun message(seq: Long = 1) =
    json(
      "mhp" to "1.5",
      "kind" to "panel",
      "surface" to "surface",
      "direction" to "toPanel",
      "seq" to seq,
      "payload" to json("type" to "attachmentsCleared"),
    )

  @Test
  fun waitsForAListenerAndRejectsReorderedWrongDirectionAndUnknownTraffic() {
    val surface = surface()
    surface.open()
    assertThrows(Exception::class.java) { surface.open() }
    assertThrows(Exception::class.java) { surface.receive(message()) }
    surface.subscribe()
    assertThrows(Exception::class.java) { surface.receive(message(2)) }
    val wrong =
      message().also {
        it.addProperty("direction", "toHost")
        it.add("payload", json("type" to "ready"))
      }
    assertEquals(
      "MHP_PANEL_WRONG_DIRECTION",
      assertThrows(Exception::class.java) { surface.receive(wrong) }.message,
    )
    val unknown = message().also { it.addProperty("surface", "other") }
    assertEquals(
      "MHP_PANEL_UNKNOWN_SURFACE",
      assertThrows(Exception::class.java) { surface.receive(unknown) }.message,
    )
    surface.receive(message())
    assertThrows(Exception::class.java) { surface.receive(message()) }
    assertEquals(listOf(1L), rendered)
  }

  @Test
  fun preservesSequencesStateAndExactlyOneReplayAcrossReload() {
    val surface = surface()
    surface.open()
    surface.subscribe()
    surface.post(json("type" to "ready"))
    surface.savedState = json("history" to "kept")
    surface.reload()
    assertThrows(Exception::class.java) { surface.post(json("type" to "ready")) }
    surface.subscribe()
    surface.post(json("type" to "ready"))
    surface.post(json("type" to "cancelTurn"))
    assertEquals(listOf(1L, 2L), sent.filter { it["kind"].asString == "panel" }.map { it["seq"].asLong })
    assertEquals(json("history" to "kept"), surface.savedState)
    surface.close()
    assertEquals(null, surface.savedState)
    assertThrows(Exception::class.java) { surface.savedState = json() }
    assertThrows(Exception::class.java) { surface.receive(message()) }
  }

  @Test
  fun reportsExactDropsAndRefusesBrowserBackpressureBeforeConsumingSequence() {
    val surface = surface()
    surface.open()
    surface.subscribe()
    repeat(boundary.maximumQueuedMessages) { surface.receive(message(it.toLong() + 1)) }
    assertThrows(Exception::class.java) { surface.receive(message(boundary.maximumQueuedMessages.toLong() + 1)) }
    surface.delivered(1)
    surface.receive(message(boundary.maximumQueuedMessages.toLong() + 1))
    surface.close()
    assertEquals(boundary.maximumQueuedMessages, sent.last()["droppedMessages"].asInt)
    assertEquals(listOf("MHP_PANEL_DROPPED" to boundary.maximumQueuedMessages), warnings)
  }

  @Test
  fun refusesCrossSurfaceVocabularyAndKeepsTasksReplayReadOnly() {
    val surface = surface("tasks")
    surface.open()
    surface.subscribe()
    assertThrows(Exception::class.java) { surface.post(json("type" to "cancelTurn")) }
    surface.reload()
    assertEquals(json("type" to "tasksReady"), sent.last()["stateRequest"])
  }
}
