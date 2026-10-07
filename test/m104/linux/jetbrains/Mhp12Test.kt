package io.github.randynorthrup.musespark

import com.google.gson.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit

fun fixtureMetadata(): JsonObject =
  json(
    "host" to json("id" to "jetbrains", "version" to "253"),
    "locale" to "de",
    "theme" to json("kind" to "light", "tokens" to json("--muse-foreground" to "#000000")),
    "folders" to listOf(json("uri" to "file:///workspace", "name" to "workspace")),
    "trusted" to false,
  )

class Mhp12Test {
  @Test
  fun unavailableAuxiliaryKindsCannotBecomeChatBindings() {
    val boundary = JsonBoundary()
    for (kind in listOf("models", "traffic", "settings", "walkthrough", "diff", "usage", "maker")) {
      try {
        PanelSurface("unavailable", "session", kind, boundary, PanelCallbacks({ _, _ -> }, { 0 }, { _, _ -> }, { _, _ -> }))
        org.junit.Assert.fail("Unavailable $kind became a native binding")
      } catch (failure: IllegalArgumentException) {
        assertEquals("MHP_CAPABILITY_UNAVAILABLE", failure.message)
      }
    }
  }

  @Test
  fun frozenArrayMaximumRejectsOversizedPayloads() {
    val boundary = JsonBoundary()
    val bounded = json("type" to "array", "maxItems" to 1)
    boundary.validate(bounded, jsonValue(listOf(1)))
    assertThrows(Exception::class.java) { boundary.validate(bounded, jsonValue(listOf(1, 2))) }
  }

  @Test
  fun editorInitiatesWithMetadataAndWaitsForValidatedRuntimeSelection() {
    val sent = CopyOnWriteArrayList<JsonObject>()
    val ready = CountDownLatch(1)
    val initialized = CountDownLatch(1)
    val services =
      object : EditorServices {
        override val capabilities = listOf("lifecycle", "ui", "tab")
        override val metadata = fixtureMetadata()

        override fun request(
          method: String,
          params: JsonObject,
          cancellation: RequestCancellation,
        ) = jsonValue(null)
      }
    val peer =
      MhpConnection(JsonBoundary(), services, Executor(Runnable::run), { frame, _ ->
        sent.add(frame)
        ready.countDown()
      }, {}, ConnectionEvents({ initialized.countDown() }, {}))
    try {
      peer.start()
      assertTrue(ready.await(1, TimeUnit.SECONDS))
      val initial = sent.single()
      assertEquals("initialize", initial["method"].asString)
      val params = initial.getAsJsonObject("params")
      assertEquals(services.metadata["host"], params["host"])
      assertEquals("de", params["locale"].asString)
      assertEquals(false, params["trusted"].asBoolean)
      assertEquals(json("minimum" to "mhp/1.2.0", "maximumExclusive" to "mhp/1.3.0"), params["protocolRange"])
      assertEquals(1L, initialized.count)
      val legacy =
        json(
          "jsonrpc" to "2.0",
          "id" to initial["id"],
          "result" to
            json("protocolVersion" to "mhp/1.1.0", "capabilities" to listOf("lifecycle")),
        )
      assertThrows(Exception::class.java) { peer.receive(legacy) }
      assertEquals(1L, initialized.count)
      val unoffered =
        legacy.deepCopy().apply {
          add(
            "result",
            json("protocolVersion" to "mhp/1.2.0", "capabilities" to listOf("lifecycle", "hostMetadata")),
          )
        }
      assertThrows(Exception::class.java) { peer.receive(unoffered) }
      peer.receive(
        legacy.deepCopy().apply {
          add(
            "result",
            json("protocolVersion" to "mhp/1.2.0", "capabilities" to listOf("lifecycle", "settings", "storage")),
          )
        },
      )
      assertEquals(0L, initialized.count)
      assertThrows(Exception::class.java) { peer.request("tab/complete", json()) }
      assertThrows(Exception::class.java) { peer.start() }
    } finally {
      peer.close()
    }
  }
}
