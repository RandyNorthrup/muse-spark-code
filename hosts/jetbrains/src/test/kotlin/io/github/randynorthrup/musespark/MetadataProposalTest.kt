package io.github.randynorthrup.musespark

import org.junit.Assert.assertThrows
import org.junit.Test

/** The rejected hostMetadata proposal must not extend A's frozen 1.5 schema. */
class MetadataProposalTest {
  @Test
  fun rejectsLegacyVersionAndResultMetadata() {
    val boundary = JsonBoundary()
    val result = json("protocolVersion" to "mhp/1.5.0", "capabilities" to listOf("lifecycle"))
    val frame = json("jsonrpc" to "2.0", "id" to "init", "result" to result)
    boundary.result("initialize", frame)
    result.add("hostMetadata", json())
    assertThrows(Exception::class.java) { boundary.result("initialize", frame) }
    result.remove("hostMetadata")
    result.addProperty("protocolVersion", "mhp/1.2.0")
    assertThrows(Exception::class.java) { boundary.result("initialize", frame) }
    result.addProperty("protocolVersion", "mhp/1.1.0")
    assertThrows(Exception::class.java) { boundary.result("initialize", frame) }
  }
}
