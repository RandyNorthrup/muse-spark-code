package io.github.randynorthrup.musespark

import com.google.gson.JsonObject
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.ArrayDeque

class MhpPipe(
  private val input: InputStream,
  private val output: OutputStream,
  private val boundary: JsonBoundary,
  private val receive: (JsonObject) -> Unit,
  private val stopped: (String) -> Unit,
  private val budget: QueueBudget = QueueBudget(boundary),
) : Closeable {
  private data class Queued(
    val bytes: ByteArray,
    val surface: String?,
  )

  private val monitor = Object()
  private val queue = ArrayDeque<Queued>()
  private var inFlight: Queued? = null
  private var lastSurface: String? = null
  private var closed = false
  private val writer = Thread(::writeLoop, "Muse MHP writer").apply { isDaemon = true }
  private val reader = Thread(::readLoop, "Muse MHP reader").apply { isDaemon = true }

  fun start() {
    writer.start()
    reader.start()
  }

  /** Admission includes the writer's in-flight frame. There is exactly one byte writer. */
  fun send(
    frame: JsonObject,
    surface: String? = null,
  ) {
    val bytes = frame.toString().toByteArray(Charsets.UTF_8)
    require(bytes.size <= boundary.maximumFrameBytes) { "MHP_PANEL_TOO_LARGE" }
    synchronized(monitor) {
      check(!closed) { "MHP_TRANSPORT_CLOSED" }
      budget.reserve(bytes.size)
      queue.addLast(Queued(bytes, surface))
      monitor.notifyAll()
    }
  }

  fun drop(surface: String): Int =
    synchronized(monitor) {
      val pending = queue.filter { it.surface == surface }
      queue.removeAll(pending.toSet())
      pending.forEach { budget.release(it.bytes.size) }
      pending.size
    }

  private fun writeLoop() {
    try {
      while (true) {
        val frame =
          synchronized(monitor) {
            while (queue.isEmpty() && !closed) monitor.wait()
            if (closed) return
            // Control frames are barriers. Rotate only among preceding panel frames.
            val eligible = queue.takeWhile { it.surface != null }
            val chosen = eligible.firstOrNull { it.surface != lastSurface } ?: queue.first
            queue.remove(chosen)
            inFlight = chosen
            lastSurface = chosen.surface
            chosen
          }
        output.write(frame.bytes)
        output.write('\n'.code)
        output.flush()
        synchronized(monitor) {
          if (inFlight != null) budget.release(frame.bytes.size)
          inFlight = null
          monitor.notifyAll()
        }
      }
    } catch (_: Exception) {
      fail("MHP_TRANSPORT_WRITE_FAILED")
    }
  }

  private fun readLoop() {
    try {
      while (true) {
        val line = readLine(input, boundary.maximumFrameBytes) ?: break
        val frame = JsonBoundary.parse(line)
        require(frame.isJsonObject) { "MHP_INVALID_REQUEST" }
        receive(frame.asJsonObject)
      }
      fail("MHP_TRANSPORT_ENDED")
    } catch (_: Exception) {
      fail("MHP_TRANSPORT_READ_FAILED")
    }
  }

  private fun fail(code: String) {
    val report = synchronized(monitor) { !closed }
    close()
    if (report) stopped(code)
  }

  override fun close() {
    synchronized(monitor) {
      if (closed) return
      closed = true
      queue.forEach { budget.release(it.bytes.size) }
      queue.clear()
      inFlight?.let { budget.release(it.bytes.size) }
      inFlight = null
      monitor.notifyAll()
    }
    runCatching { input.close() }
    runCatching { output.close() }
  }

  companion object {
    fun readLine(
      input: InputStream,
      maximumBytes: Int,
    ): String? {
      val bytes = ByteArrayOutputStream()
      while (true) {
        val byte = input.read()
        if (byte == -1) {
          if (bytes.size() == 0) return null
          error("MHP_TRUNCATED_FRAME")
        }
        if (byte == '\n'.code) break
        // A trailing CR belongs to CRLF, not to the capped JSON body.
        require(bytes.size() <= maximumBytes) { "MHP_PANEL_TOO_LARGE" }
        bytes.write(byte)
      }
      var body = bytes.toByteArray()
      if (body.lastOrNull() == '\r'.code.toByte()) body = body.copyOf(body.size - 1)
      require(body.isNotEmpty() && body.size <= maximumBytes) { "MHP_PANEL_TOO_LARGE" }
      return Charsets.UTF_8
        .newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(body))
        .toString()
    }
  }
}
