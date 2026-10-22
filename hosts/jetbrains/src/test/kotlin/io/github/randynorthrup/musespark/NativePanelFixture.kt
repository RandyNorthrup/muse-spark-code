package io.github.randynorthrup.musespark

import com.google.gson.JsonObject
import java.nio.file.Path
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit

class NativePanelFixture(
  private val boundary: JsonBoundary,
) : AutoCloseable {
  val ready = CountDownLatch(1)
  val posted = CopyOnWriteArrayList<JsonObject>()
  var panel: EmbeddedPanel? = null
  private val initialized = CountDownLatch(1)
  private val runtime =
    RuntimeProcess.start(
      listOf("/usr/bin/python3", "-u", Path.of("test/fixtures/panel_ui.py").toAbsolutePath().toString()),
      Path.of(".").toAbsolutePath(),
      mapOf("PATH" to "/usr/bin:/bin"),
    )
  private lateinit var pipe: MhpPipe
  val surface =
    PanelSurface(
      "browser-surface",
      "browser-session",
      "chat",
      boundary,
      PanelCallbacks({ frame, id ->
        pipe.send(frame, id)
        if (frame["kind"].asString == "surface" && frame["event"].asString == "ready") ready.countDown()
        if (frame["kind"].asString == "panel") posted.add(frame.getAsJsonObject("payload"))
      }, { 0 }, { payload, seq -> requireNotNull(panel).deliver(payload, seq) }, { _, _ -> }),
    )
  private val peer =
    MhpConnection(
      boundary,
      object : EditorServices {
        override val metadata = fixtureMetadata()
        override val capabilities = listOf("lifecycle", "ui", "surfaces")

        override fun request(
          method: String,
          params: JsonObject,
          cancellation: RequestCancellation,
        ) = jsonValue(null)
      },
      Executor(Runnable::run),
      { frame, id -> pipe.send(frame, id) },
      surface::receive,
      ConnectionEvents({ initialized.countDown() }, {}),
    )

  fun start() {
    pipe = MhpPipe(runtime.process.inputStream, runtime.process.outputStream, boundary, peer::receive, {})
    pipe.start()
    peer.start()
    check(initialized.await(WAIT_SECONDS, TimeUnit.SECONDS)) { "MHP_FAKE_INITIALIZE_FAILED" }
    surface.open()
  }

  override fun close() {
    peer.close()
    pipe.close()
    runtime.close()
  }

  companion object {
    private const val WAIT_SECONDS = 5L
  }
}
