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
        "mhp" to "1.1",
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
    val pipe = MhpPipe(ByteArrayInputStream(byteArrayOf()), ByteArrayOutputStream(), boundary, {}, {})
    repeat(boundary.maximumQueuedMessages) { pipe.send(json("id" to it), if (it == 0) "other" else "chat") }
    assertThrows(Exception::class.java) { pipe.send(json("id" to "overflow")) }
    assertEquals(boundary.maximumQueuedMessages - 1, pipe.drop("chat"))
    assertEquals(1, pipe.drop("other"))
    pipe.close()
    assertThrows(Exception::class.java) { pipe.send(json()) }
  }

  @Test
  fun refusesRemoteAssetsTraversalAndNavigation() {
    val policy = AssetPolicy("surface") { "resource".toByteArray() }
    assertTrue(policy.navigationAllowed(policy.page))
    assertTrue(policy.asset(policy.base + "main.js") != null)
    for (url in listOf(
      "https://example.com/",
      policy.base + "../main.js",
      policy.base + "%2e%2e/main.js",
      "https://muse.invalid:443/surface/main.js",
      policy.base + "main.js?fetch=remote",
      "file:///etc/passwd",
    )) {
      assertFalse(policy.navigationAllowed(url))
      assertEquals(null, policy.asset(url))
    }
    assertTrue(policy.csp("nonce").contains("connect-src 'none'"))
    assertTrue(policy.csp("nonce").contains("frame-src 'none'"))
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
