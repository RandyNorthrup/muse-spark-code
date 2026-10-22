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
  private var thrownCode: String? = null
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
        thrownCode?.let { throw IllegalArgumentException(it) }
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

  private fun initialize() {
    connection.initialize(
      json(
        "host" to json("id" to "jetbrains", "version" to "253"),
        "protocolRange" to json("minimum" to "mhp/1.5.0", "maximumExclusive" to "mhp/1.6.0"),
        "capabilities" to services.capabilities,
        "locale" to "en",
        "theme" to json("kind" to "dark", "tokens" to json()),
        "folders" to emptyList<String>(),
        "trusted" to true,
      ),
    )
    connection.receive(
      json(
        "jsonrpc" to "2.0",
        "id" to sent.last()["id"],
        "result" to
          json("protocolVersion" to "mhp/1.5.0", "capabilities" to services.capabilities),
      ),
    )
  }

  @Test
  fun everySchemaErrorHasParityWithEclipseAndKeepsItsCodeOnTheWire() {
    initialize()
    val schema =
      JsonBoundary.parse(requireNotNull(javaClass.getResource("/mhp/mhp-v1.1.schema.json")).readText()).asJsonObject
    val expected =
      schema.getAsJsonObject("errorCodes").entrySet().associate { (name, value) ->
        "MHP_" + name.replace(Regex("[A-Z]")) { "_${it.value}" }.uppercase(java.util.Locale.ROOT) to value.asInt
      } +
        mapOf(
          "MHP_CAPABILITY_UNAVAILABLE" to -32002,
          "MHP_DIRTY_DOCUMENT" to -32004,
          "MHP_INVALID_RANGE" to -32602,
          "MHP_OVERLAPPING_EDITS" to -32602,
          "account/path/private failure" to -32603,
        )
    val failures = mutableListOf<String>()
    for ((code, numeric) in expected) {
      val failure = IllegalArgumentException(code)
      val technical = MhpConnection.technicalCode(failure)
      if (io.musespark.eclipse.MhpErrors
          .technicalCode(failure) != technical ||
        io.musespark.eclipse.MhpErrors
          .numeric(technical) != numeric ||
        MhpErrors.numeric(technical) != numeric
      ) {
        failures.add("$code mapper: $technical")
      }
      thrownCode = code
      connection.receive(call("ui/openFile", json("title" to "fixture"), code))
      tasks.removeAt(0).run()
      val error = sent.last().getAsJsonObject("error")
      val message = if (code.startsWith("MHP_")) code else "MHP_INTERNAL_ERROR"
      if (numeric != error["code"].asInt || message != error["message"].asString) failures.add("$code wire: $error")
    }
    assertTrue(failures.toString(), failures.isEmpty())
  }

  @Test
  fun negotiatesOnlyTheExplicitCarrierRangeBeforePanelTraffic() {
    assertThrows(Exception::class.java) { connection.receive(call("ui/confirm", json())) }
    assertThrows(Exception::class.java) { connection.request("tab/complete", json()) }
    initialize()
    assertEquals("initialize", sent.last()["method"].asString)
    assertThrows(Exception::class.java) { initialize() }
    assertThrows(Exception::class.java) { connection.receive(call("initialize", json())) }
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
        ConnectionEvents({ initialized.countDown() }, {}, { replied.countDown() }),
      )
    try {
      val receive = CompletableFuture.runAsync { peer.start() }
      assertTrue(entered.await(5, TimeUnit.SECONDS))
      receive.get(1, TimeUnit.SECONDS)
      if (shutdown) {
        CompletableFuture.runAsync { peer.close() }.get(1, TimeUnit.SECONDS)
      } else {
        assertTrue(replied.await(5, TimeUnit.SECONDS))
      }
      assertThrows(IllegalStateException::class.java) { peer.receive(call("ui/input", json(), "late")) }
      release.countDown()
      assertTrue(finished.await(5, TimeUnit.SECONDS))
      assertTrue(sent.isEmpty())
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
  fun closedEpochDropsQueuedInboundReplyInsteadOfSendingIntoReplacement() {
    initialize()
    connection.receive(call("ui/input", json("title" to "Old", "prompt" to "Old request")))
    connection.close()
    sent.clear()
    tasks.removeAt(0).run()
    assertTrue("Closed epoch must not emit a cancellation reply", sent.isEmpty())
  }

  @Test
  fun runtimeFailureTextCannotBecomeAnIdeLoggerException() {
    initialize()
    val future =
      connection.request(
        "tab/complete",
        json(
          "uri" to "file:///workspace/a.kt",
          "position" to json("line" to 0, "character" to 0),
          "version" to 1,
          "context" to json("prefix" to "", "suffix" to "", "trigger" to "invoke"),
        ),
      )
    connection.receive(
      json(
        "jsonrpc" to "2.0",
        "id" to sent.last()["id"],
        "error" to
          json(
            "code" to boundary.errorCode("internalError"),
            "message" to "FIXTURE_ONLY_PRIVATE_ACCOUNT_FILE_CONTENTS",
          ),
      ),
    )
    val failure = assertThrows(java.util.concurrent.ExecutionException::class.java) { future.get() }
    assertEquals("MHP_RUNTIME_REQUEST_FAILED", failure.cause?.message)
    assertFalse(failure.stackTraceToString().contains("FIXTURE_ONLY_PRIVATE_ACCOUNT_FILE_CONTENTS"))
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
