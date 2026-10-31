package io.github.randynorthrup.musespark

/** Shared by every surface and the stdio writer in one editor window. */
class QueueBudget(
  private val boundary: JsonBoundary,
) {
  private var bytes = 0
  private var messages = 0

  @Synchronized
  fun reserve(size: Int) {
    require(size >= 0 && messages < boundary.maximumQueuedMessages && size <= boundary.maximumQueuedBytes - bytes) {
      "MHP_PANEL_BACKPRESSURE"
    }
    bytes += size
    messages++
  }

  @Synchronized
  fun release(size: Int) {
    bytes -= size
    messages--
  }
}
