package io.github.randynorthrup.musespark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class MhpBoundaryTest {
  private val boundary = JsonBoundary()

  @Test
  fun rejectsMalformedDuplicateAndConcatenatedJson() {
    for (text in listOf("{\"a\":1,\"a\":2}", "{}{}", "/*comment*/{}", "{\"a\":NaN}")) {
      assertThrows(Exception::class.java) { JsonBoundary.parse(text) }
    }
  }

  @Test
  fun validatesExportedMethodsResultsAndState() {
    val call =
      json(
        "jsonrpc" to "2.0",
        "id" to "read",
        "method" to "documents/read",
        "params" to json("uri" to "file:///workspace/a.kt"),
      )
    boundary.call(call)
    call.getAsJsonObject("params").addProperty("apiKey", "fixture-only")
    assertThrows(Exception::class.java) { boundary.call(call) }
    assertThrows(Exception::class.java) {
      boundary.result(
        "documents/read",
        json(
          "jsonrpc" to "2.0",
          "id" to "read",
          "result" to json(),
        ),
      )
    }
    boundary.state(json("nested" to listOf(json("count" to 1), null)))
    assertThrows(Exception::class.java) { boundary.state(jsonValue(Double.POSITIVE_INFINITY)) }
  }

  @Test
  fun validatesFrozenNullableTypeArraysWithoutAcceptingUndeclaredTypes() {
    for (value in listOf(null, "fixture input")) {
      boundary.result("ui/input", json("jsonrpc" to "2.0", "id" to "input", "result" to value))
    }
    for (value in listOf(true, 1, emptyList<String>(), json())) {
      assertThrows(Exception::class.java) {
        boundary.result("ui/input", json("jsonrpc" to "2.0", "id" to "input", "result" to value))
      }
    }
  }

  @Test
  fun validatesSurfaceSpecificPayloadsAndSafeSequences() {
    boundary.payload("chat", "toHost", json("type" to "ready"))
    boundary.payload("tasks", "toHost", json("type" to "tasksReady"))
    assertThrows(Exception::class.java) {
      boundary.payload(
        "tasks",
        "toHost",
        json(
          "type" to "sendMessage",
          "localId" to "x",
          "text" to "hello",
          "attachmentIds" to emptyList<String>(),
        ),
      )
    }
    val envelope =
      json(
        "mhp" to "1.5",
        "kind" to "panel",
        "surface" to "x",
        "direction" to "toHost",
        "seq" to 0,
        "payload" to json("type" to "ready"),
      )
    assertThrows(Exception::class.java) { boundary.validate(boundary.panel["envelope"], envelope) }
  }

  @Test
  fun boundsOriginalUtf8BeforeParsingAndHandlesCrlf() {
    fun input(value: String) = ByteArrayInputStream(value.toByteArray(Charsets.UTF_8))
    assertEquals("{}", MhpPipe.readLine(input("{}\r\n"), 2))
    assertThrows(Exception::class.java) { MhpPipe.readLine(input(" {}\n"), 2) }
    assertThrows(Exception::class.java) { MhpPipe.readLine(input("éé\n"), 2) }
    assertThrows(Exception::class.java) { MhpPipe.readLine(input("{}"), 2) }
    assertThrows(Exception::class.java) { MhpPipe.readLine(ByteArrayInputStream(byteArrayOf(-1, 10)), 2) }
  }

  @Test
  fun boundsWriterQueueAndDropsOnlyTheClosingSurface() {
    val failures = mutableListOf<String>()
    val pipe = MhpPipe(ByteArrayInputStream(byteArrayOf()), ByteArrayOutputStream(), boundary, {}, failures::add)
    repeat(boundary.maximumQueuedMessages) { pipe.send(json("id" to it), if (it == 0) "other" else "chat") }
    assertEquals(boundary.maximumQueuedMessages - 1, pipe.drop("chat"))
    assertEquals(1, pipe.drop("other"))
    repeat(boundary.maximumQueuedMessages) { pipe.send(json("id" to it), "chat") }
    assertThrows(Exception::class.java) { pipe.send(json("id" to "overflow")) }
    assertEquals(listOf("MHP_PANEL_BACKPRESSURE"), failures)
    assertEquals(0, pipe.drop("chat"))
    pipe.close()
    assertThrows(Exception::class.java) { pipe.send(json()) }
  }

  @Test
  fun refusesRemoteAssetsTraversalAndNavigation() {
    val policy = AssetPolicy("surface")
    assertTrue(policy.navigationAllowed("file:///jbcefbrowser/312651496#url=${policy.page}"))
    for (url in listOf(
      policy.page,
      "https://example.com/",
      policy.base + "../main.js",
      policy.base + "%2e%2e/main.js",
      "https://muse.invalid:443/surface/main.js",
      policy.base + "main.js?fetch=remote",
      "file:///etc/passwd",
      "file:///etc/passwd#url=${policy.page}",
      "file://remote/jbcefbrowser/1#url=${policy.page}",
      "file:///jbcefbrowser/1?leak=true#url=${policy.page}",
      "file:///jbcefbrowser/1#url=https://remote.invalid/",
    )) {
      assertFalse(policy.navigationAllowed(url))
    }
    assertTrue(policy.csp("nonce").contains("connect-src 'none'"))
    assertTrue(policy.csp("nonce").contains("frame-src 'none'"))
    assertTrue(policy.csp("nonce").contains("script-src 'nonce-nonce'"))
    assertFalse(policy.csp("nonce").contains("https:"))
  }

  @Test
  fun stripsEveryCredentialVariableBeforeStartingAnyChild() {
    val values =
      mapOf(
        "PATH" to "/bin",
        "meta_api_key" to "fixture-only",
        "CUSTOM_API_KEY" to "fixture-only",
        "AWS_ACCESS_KEY_ID" to "fixture-only",
        "AWS_SECRET_ACCESS_KEY" to "fixture-only",
        "AWS_SESSION_TOKEN" to "fixture-only",
        "OPENAI_KEY" to "fixture-only",
        "ANTHROPIC_KEY" to "fixture-only",
        "META_KEY" to "fixture-only",
      )
    assertEquals(mapOf("PATH" to "/bin"), RuntimeProcess.environment(values))
  }
}
