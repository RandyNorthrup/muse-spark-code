package io.github.randynorthrup.musespark

import com.google.gson.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit

class MetadataProposalTest {
  private val boundary = JsonBoundary()
  private val metadata =
    json(
      "host" to json("id" to "jetbrains", "version" to "253"),
      "locale" to "en",
      "theme" to json("kind" to "dark", "tokens" to json("--muse-foreground" to "#ffffff")),
      "folders" to emptyList<String>(),
      "trusted" to false,
    )

  @Test
  fun supportsTheExactNewMinorOnlyWhenMetadataIsAvailableAndValid() {
    for (available in listOf(true, false)) {
      val sent = CopyOnWriteArrayList<JsonObject>()
      val replied = CountDownLatch(1)
      val peer =
        MhpConnection(
          boundary,
          object : EditorServices {
            override val capabilities = listOf("lifecycle")
            override val metadata = if (available) this@MetadataProposalTest.metadata else null

            override fun request(
              method: String,
              params: JsonObject,
              cancellation: RequestCancellation,
            ) = jsonValue(null)
          },
          Executor(Runnable::run),
          { frame, _ ->
            sent.add(frame)
            replied.countDown()
          },
          {},
          ConnectionEvents({}, {}),
        )
      val request =
        json(
          "jsonrpc" to "2.0",
          "id" to "metadata",
          "method" to "initialize",
          "params" to
            json(
              "host" to json("id" to "runtime", "version" to "1"),
              "protocolRange" to json("minimum" to "mhp/1.2.0", "maximumExclusive" to "mhp/1.3.0"),
              "capabilities" to listOf("lifecycle", "hostMetadata"),
              "locale" to "en",
              "theme" to json("kind" to "dark", "tokens" to json()),
              "folders" to emptyList<String>(),
              "trusted" to true,
            ),
        )
      peer.receive(request)
      org.junit.Assert.assertTrue(replied.await(5, TimeUnit.SECONDS))
      if (available) {
        assertEquals(metadata, sent.single().getAsJsonObject("result")["hostMetadata"])
      } else {
        assertEquals(boundary.errorCode("internalError"), sent.single().getAsJsonObject("error")["code"].asInt)
      }
      peer.close()
    }
  }

  @Test
  fun rejectsMissingMetadataUnflaggedMetadataBadTokensAndAdditionalFields() {
    val good =
      json(
        "jsonrpc" to "2.0",
        "id" to "metadata",
        "result" to
          json(
            "protocolVersion" to "mhp/1.2.0",
            "capabilities" to listOf("lifecycle", "hostMetadata"),
            "hostMetadata" to metadata,
          ),
      )
    boundary.result("initialize", good)
    val variants =
      listOf<(JsonObject) -> Unit>(
        { it.getAsJsonObject("result").remove("hostMetadata") },
        { it.getAsJsonObject("result").add("capabilities", jsonValue(listOf("lifecycle"))) },
        { it.getAsJsonObject("result").addProperty("protocolVersion", "mhp/1.1.0") },
        { it.getAsJsonObject("result").getAsJsonObject("hostMetadata").addProperty("account", "fixture-only") },
        {
          it
            .getAsJsonObject("result")
            .getAsJsonObject("hostMetadata")
            .getAsJsonObject("theme")
            .add("tokens", json("foreign" to "#ffffff"))
        },
      )
    for (mutate in variants) {
      val bad = good.deepCopy()
      mutate(bad)
      assertThrows(Exception::class.java) { boundary.result("initialize", bad) }
    }
  }
}
