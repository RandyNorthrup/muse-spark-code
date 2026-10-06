package io.github.randynorthrup.musespark

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit

class MhpConnectionTest {
  private val boundary = JsonBoundary()
  private val sent = mutableListOf<JsonObject>()
  private val calls = mutableListOf<JsonObject>()
  private var choice: JsonElement = jsonValue(null)
  private val tasks = mutableListOf<Runnable>()
  private val services =
    object : EditorServices {
      override val capabilities = listOf("lifecycle", "ui", "tab")

      override fun request(
        method: String,
        params: JsonObject,
        cancellation: RequestCancellation,
      ): JsonElement {
        calls.add(params)
        return choice
      }
    }
  private val connection =
    MhpConnection(
      boundary,
      services,
      Executor { tasks.add(it) },
      { frame, _ -> sent.add(frame) },
      {},
      ConnectionEvents({}, {}),
    )

  private fun call(
    method: String,
    params: JsonObject,
    id: String = "request",
  ) = json("jsonrpc" to "2.0", "id" to id, "method" to method, "params" to params)

  private fun initialize(maximum: String = "mhp/1.2.0") {
    connection.receive(
      call(
        "initialize",
        json(
          "host" to json("id" to "jetbrains", "version" to "253"),
          "protocolRange" to json("minimum" to "mhp/1.0.0", "maximumExclusive" to maximum),
          "capabilities" to services.capabilities,
          "locale" to "en",
          "theme" to json("kind" to "dark", "tokens" to json()),
          "folders" to emptyList<String>(),
          "trusted" to true,
        ),
        "initialize",
      ),
    )
  }

  @Test
  fun metadataProposalRequiresCapabilityAndCompatibleMinorAndKeepsLegacyReplyExact() {
    val metadata =
      json(
        "host" to json("id" to "jetbrains", "version" to "253"),
        "locale" to "de",
        "theme" to json("kind" to "light", "tokens" to json("--muse-foreground" to "#000000")),
        "folders" to listOf(json("uri" to "file:///workspace", "name" to "workspace")),
        "trusted" to false,
      )
    for ((maximum, offered, expected) in listOf(
      Triple("mhp/1.2.0", false, false),
      Triple("mhp/1.3.0", false, false),
      Triple("mhp/1.2.0", true, false),
      Triple("mhp/1.3.0", true, true),
    )) {
      val replies = CopyOnWriteArrayList<JsonObject>()
      val replied = CountDownLatch(1)
      val peer =
        MhpConnection(
          boundary,
          object : EditorServices {
            override val capabilities = listOf("lifecycle")

            override val metadata = metadata

            override fun request(
              method: String,
              params: JsonObject,
              cancellation: RequestCancellation,
            ) = jsonValue(null)
          },
          Executor(Runnable::run),
          { frame, _ ->
            replies.add(frame)
            replied.countDown()
          },
          {},
          ConnectionEvents({}, {}),
        )
      peer.receive(
        call(
          "initialize",
          json(
            "host" to json("id" to "runtime", "version" to "1"),
            "protocolRange" to json("minimum" to "mhp/1.1.0", "maximumExclusive" to maximum),
            "capabilities" to if (offered) listOf("lifecycle", "hostMetadata") else listOf("lifecycle"),
            "locale" to "en",
            "theme" to json("kind" to "dark", "tokens" to json()),
            "folders" to emptyList<String>(),
            "trusted" to true,
          ),
        ),
      )
      assertTrue(replied.await(5, TimeUnit.SECONDS))
      val result = replies.single().getAsJsonObject("result")
      if (expected) {
        assertEquals("mhp/1.2.0", result["protocolVersion"].asString)
        assertEquals(metadata, result["hostMetadata"])
        assertEquals(jsonValue(listOf("lifecycle", "hostMetadata")), result["capabilities"])
      } else {
        assertEquals(json("protocolVersion" to "mhp/1.1.0", "capabilities" to listOf("lifecycle")), result)
      }
      peer.close()
    }
  }

  @Test
  fun negotiatesOnlyTheExplicitCarrierRangeBeforePanelTraffic() {
    assertThrows(Exception::class.java) { connection.receive(call("ui/confirm", json())) }
    assertThrows(Exception::class.java) { initialize("mhp/2.0.0") }
    initialize()
    assertEquals("mhp/1.1.0", sent.last().getAsJsonObject("result")["protocolVersion"].asString)
    assertThrows(Exception::class.java) { initialize() }
  }

  @Test
  fun carriesAllPaidChoicesPriceBudgetAndCancellationWithoutTurningThemIntoGrants() {
    initialize()
    val params =
      json(
        "title" to "Fixture paid request",
        "message" to "Price: USD 0.01; shared daily budget: USD 5.00",
        "choices" to
          listOf(
            json("id" to "once", "title" to "Allow once"),
            json("id" to "always", "title" to "Always"),
            json("id" to "deny", "title" to "Deny"),
          ),
      )
    for ((index, id) in listOf("once", "always", "deny", null).withIndex()) {
      choice = jsonValue(id)
      connection.receive(call("ui/confirm", params, "choice-$index"))
      tasks.removeAt(0).run()
      assertEquals(choice, sent.last()["result"])
      assertEquals(params, calls.last())
    }
    connection.receive(call("ui/confirm", params, "cancel"))
    connection.receive(json("jsonrpc" to "2.0", "method" to "$/cancelRequest", "params" to json("id" to "cancel")))
    val before = calls.size
    tasks.removeAt(0).run()
    assertEquals(before, calls.size)
    assertEquals(boundary.errorCode("cancelled"), sent.last().getAsJsonObject("error")["code"].asInt)
  }

  @Test
  fun validatesCorrelatedResultsAndCancelsPendingWorkOnClose() {
    initialize()
    val params =
      json(
        "uri" to "file:///workspace/a.kt",
        "position" to json("line" to 0, "character" to 0),
        "version" to 1,
        "context" to json("prefix" to "", "suffix" to "", "trigger" to "invoke"),
      )
    val future = connection.request("tab/complete", params)
    val id = sent.last()["id"]
    assertThrows(
      Exception::class.java,
    ) { connection.receive(json("jsonrpc" to "2.0", "id" to id, "result" to "invalid")) }
    assertFalse(future.isDone)
    connection.receive(json("jsonrpc" to "2.0", "id" to id, "result" to emptyList<String>()))
    assertTrue(future.isDone)
    assertThrows(Exception::class.java) {
      connection.receive(
        json(
          "jsonrpc" to "2.0",
          "id" to id,
          "result" to emptyList<String>(),
        ),
      )
    }
    val second = connection.request("tab/complete", params)
    connection.close()
    assertTrue(second.isCompletedExceptionally)
  }

  @Test
  fun cancelledTabLateSuccessAndFailureLeaveOtherRequestsAndPanelsAlive() {
    initialize()
    val params =
      json(
        "uri" to "file:///workspace/a.kt",
        "position" to json("line" to 0, "character" to 0),
        "version" to 1,
        "context" to json("prefix" to "", "suffix" to "", "trigger" to "invoke"),
      )
    for (failed in listOf(false, true)) {
      val cancelled = connection.request("tab/complete", params)
      val id = sent.last()["id"]
      val other = connection.request("tab/complete", params)
      val otherId = sent.last()["id"]
      assertTrue(cancelled.cancel(true))
      assertEquals("$/cancelRequest", sent.last()["method"].asString)
      assertEquals(id, sent.last().getAsJsonObject("params")["id"])
      val late =
        if (failed) {
          json(
            "jsonrpc" to "2.0",
            "id" to id,
            "error" to json("code" to boundary.errorCode("cancelled"), "message" to "MHP_CANCELLED"),
          )
        } else {
          json("jsonrpc" to "2.0", "id" to id, "result" to emptyList<String>())
        }
      assertThrows(Exception::class.java) {
        connection.receive(json("jsonrpc" to "2.0", "id" to id, "result" to "invalid"))
      }
      connection.receive(late)
      assertTrue(cancelled.isCancelled)
      assertFalse(other.isDone)
      connection.receive(json("jsonrpc" to "2.0", "id" to otherId, "result" to emptyList<String>()))
      assertTrue(other.isDone)
      choice = jsonValue("Still connected")
      connection.receive(call("ui/input", json("title" to "Other panel", "prompt" to "Still connected")))
      tasks.removeAt(0).run()
      assertTrue(sent.last().toString(), sent.last().has("result"))
      assertThrows(Exception::class.java) { connection.receive(late) }
    }
    val retained = mutableListOf<JsonElement>()
    repeat(boundary.maximumQueuedMessages) {
      val pending = connection.request("tab/complete", params)
      retained.add(sent.last()["id"])
      pending.cancel(true)
    }
    assertThrows(Exception::class.java) { connection.request("tab/complete", params) }
    retained.forEach { connection.receive(json("jsonrpc" to "2.0", "id" to it, "result" to emptyList<String>())) }
    assertFalse(connection.request("tab/complete", params).isDone)
    connection.close()
  }

  @Test
  fun metadataHandoffDoesNotHoldTheMonitorAndShutdownWins() = stalledMetadata(true)

  @Test
  fun metadataHandoffHasADeadlineAndRejectsLateInitialization() = stalledMetadata(false)

  private fun stalledMetadata(shutdown: Boolean) {
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val finished = CountDownLatch(1)
    val sent = CopyOnWriteArrayList<JsonObject>()
    val initialized = CountDownLatch(1)
    val replied = CountDownLatch(1)
    val peer =
      MhpConnection(
        boundary,
        stalledServices(entered, release, finished),
        Executor(Runnable::run),
        { frame, _ ->
          sent.add(frame)
          replied.countDown()
        },
        {},
        ConnectionEvents({ initialized.countDown() }, {}),
      )
    try {
      val receive =
        CompletableFuture.runAsync {
          peer.receive(
            call(
              "initialize",
              json(
                "host" to json("id" to "runtime", "version" to "1"),
                "protocolRange" to json("minimum" to "mhp/1.1.0", "maximumExclusive" to "mhp/1.3.0"),
                "capabilities" to listOf("lifecycle", "hostMetadata"),
                "locale" to "en",
                "theme" to json("kind" to "dark", "tokens" to json()),
                "folders" to emptyList<String>(),
                "trusted" to true,
              ),
              "initialize",
            ),
          )
        }
      assertTrue(entered.await(5, TimeUnit.SECONDS))
      receive.get(1, TimeUnit.SECONDS)
      if (shutdown) {
        CompletableFuture.runAsync { peer.receive(call("shutdown", json(), "shutdown")) }.get(1, TimeUnit.SECONDS)
        assertEquals("shutdown", sent.single()["id"].asString)
      } else {
        assertTrue(replied.await(5, TimeUnit.SECONDS))
        assertTrue(sent.single().has("error"))
      }
      assertThrows(IllegalStateException::class.java) { peer.receive(call("shutdown", json(), "late-shutdown")) }
      release.countDown()
      assertTrue(finished.await(5, TimeUnit.SECONDS))
      assertEquals(1, sent.size)
      assertEquals(1L, initialized.count)
    } finally {
      release.countDown()
      peer.close()
    }
  }

  private fun stalledServices(
    entered: CountDownLatch,
    release: CountDownLatch,
    finished: CountDownLatch,
  ): EditorServices =
    object : EditorServices {
      override val capabilities = listOf("lifecycle")
      override val metadata: JsonObject
        get() {
          entered.countDown()
          release.await(10, TimeUnit.SECONDS)
          finished.countDown()
          return json(
            "host" to json("id" to "jetbrains", "version" to "253"),
            "locale" to "en",
            "theme" to json("kind" to "dark", "tokens" to json()),
            "folders" to emptyList<String>(),
            "trusted" to true,
          )
        }

      override fun request(
        method: String,
        params: JsonObject,
        cancellation: RequestCancellation,
      ) = jsonValue(null)
    }

  @Test
  fun refusesUnsupportedGroupsAndRequestsInTheWrongDirectionBeforeDispatch() {
    initialize()
    connection.receive(call("documents/list", json()))
    tasks.removeAt(0).run()
    assertTrue(calls.isEmpty())
    assertEquals(boundary.errorCode("unsupportedCapability"), sent.last().getAsJsonObject("error")["code"].asInt)
    assertThrows(Exception::class.java) { connection.request("documents/list", json()) }
  }

  @Test
  fun boundsRetainedRequestBytesAndRejectsDuplicateIdsBeforeDispatch() {
    initialize()
    val prompt = "x".repeat(JsonBoundary().maximumFrameBytes / 2)
    val params = json("title" to "Input fixture", "prompt" to prompt)
    connection.receive(call("ui/input", params, "large-1"))
    assertThrows(Exception::class.java) { connection.receive(call("ui/input", params, "large-1")) }
    connection.receive(call("ui/input", params, "large-2"))
    connection.receive(call("ui/input", params, "large-3"))
    assertThrows(Exception::class.java) { connection.receive(call("ui/input", params, "large-4")) }
    assertEquals(0, calls.size)
    connection.close()
  }
}
