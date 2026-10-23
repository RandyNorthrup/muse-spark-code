package io.github.randynorthrup.musespark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class PipeTest {
  private val boundary = JsonBoundary()

  @Test
  fun rotatesSurfacesInOrderWithoutCrossingLifecycleBarriers() {
    val input = PipedInputStream()
    val keepAlive = PipedOutputStream(input)
    val written = CountDownLatch(6)
    val output =
      object : ByteArrayOutputStream() {
        override fun flush() {
          written.countDown()
        }
      }
    val pipe = MhpPipe(input, output, boundary, {}, {})
    for ((id, surface) in listOf("a1" to "a", "a2" to "a", "b1" to "b", "b2" to "b", "control" to null, "a3" to "a")) {
      pipe.send(json("id" to id), surface)
    }
    try {
      pipe.start()
      assertTrue(written.await(WAIT_SECONDS, TimeUnit.SECONDS))
      val ids =
        output
          .toString(
            Charsets.UTF_8,
          ).trim()
          .lines()
          .map { JsonBoundary.parse(it).asJsonObject["id"].asString }
      assertEquals(listOf("a1", "b1", "a2", "b2", "control", "a3"), ids)
    } finally {
      pipe.close()
      keepAlive.close()
    }
  }

  @Test
  fun countsInFlightFramesAndReleasesAllReservationsWhenClosed() {
    val entered = CountDownLatch(1)
    val unblock = CountDownLatch(1)
    val input = PipedInputStream()
    val keepAlive = PipedOutputStream(input)
    val budget = QueueBudget(boundary)
    val output =
      object : OutputStream() {
        override fun write(value: Int) {
          entered.countDown()
          assertTrue(unblock.await(WAIT_SECONDS, TimeUnit.SECONDS))
        }

        override fun close() {
          unblock.countDown()
        }
      }
    val failures = mutableListOf<String>()
    val pipe = MhpPipe(input, output, boundary, {}, failures::add, budget)
    repeat(boundary.maximumQueuedMessages) { pipe.send(json("id" to it), "a") }
    try {
      pipe.start()
      assertTrue(entered.await(WAIT_SECONDS, TimeUnit.SECONDS))
      assertThrows(Exception::class.java) { pipe.send(json("id" to "overflow"), "b") }
      assertEquals(listOf("MHP_PANEL_BACKPRESSURE"), failures)
      assertEquals(0, pipe.drop("a"))
      pipe.close()
      repeat(boundary.maximumQueuedMessages) { budget.reserve(1) }
      assertThrows(Exception::class.java) { budget.reserve(1) }
      repeat(boundary.maximumQueuedMessages) { budget.release(1) }
    } finally {
      pipe.close()
      keepAlive.close()
    }
  }

  @Test
  fun boundsAggregateBytesWithoutIntegerOverflow() {
    val budget = QueueBudget(boundary)
    budget.reserve(boundary.maximumQueuedBytes)
    assertThrows(Exception::class.java) { budget.reserve(1) }
    assertThrows(Exception::class.java) { budget.reserve(Int.MAX_VALUE) }
    budget.release(boundary.maximumQueuedBytes)
    budget.reserve(1)
    budget.release(1)
  }

  companion object {
    private const val WAIT_SECONDS = 10L
  }
}
