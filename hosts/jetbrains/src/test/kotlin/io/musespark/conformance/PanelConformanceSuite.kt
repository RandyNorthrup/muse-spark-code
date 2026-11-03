package io.musespark.conformance

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.jcef.JBCefApp
import io.github.randynorthrup.musespark.ConnectionEvents
import io.github.randynorthrup.musespark.EditorServices
import io.github.randynorthrup.musespark.EmbeddedPanel
import io.github.randynorthrup.musespark.JetBrainsPanelHost
import io.github.randynorthrup.musespark.JsonBoundary
import io.github.randynorthrup.musespark.NativeHostServices
import io.github.randynorthrup.musespark.NativeWidgets
import io.github.randynorthrup.musespark.PanelCallbacks
import io.github.randynorthrup.musespark.PanelSurface
import io.github.randynorthrup.musespark.QueueBudget
import io.github.randynorthrup.musespark.RequestCancellation
import io.github.randynorthrup.musespark.RuntimeConnection
import io.github.randynorthrup.musespark.RuntimeProcess
import io.github.randynorthrup.musespark.json
import io.github.randynorthrup.musespark.jsonValue
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.swing.JFrame

// The real panel on the real runtime: the production connection
// (RuntimeConnection over RuntimeProcess panel --stdio) and the
// production surface composition JetBrainsPanelHost.open builds
// (PanelSurface + EmbeddedPanel in JCEF), in a frame instead of a tool
// window. The runtime opens its chat surface, the page shakes hands,
// takes the runtime's first frames (theme first) and renders. The
// suite fails on the panel's fatal card (MHP_PANEL_FATAL_CARD) or an
// unreadable page (MHP_PANEL_UNREADABLE), as the Visual Studio suite
// does, and on any panelError the host sends back. Runs only with
// -PnativeUi=true under a display (the conformance runner wraps
// xvfb-run); without it, JCEF is unsupported here by construction.
class PanelConformanceSuite : BasePlatformTestCase() {
  override fun runInDispatchThread() = false

  fun testRealPanelOnTheProductionRuntime() {
    if (System.getProperty("muse.nativeUi") != "true") {
      assertFalse(JBCefApp.isSupported())
      return
    }
    val layout = ConformanceLayout.resolve()
    require(Files.isRegularFile(layout.runtimeFile)) { "MHP_CONFORMANCE_RUNTIME_MISSING" }
    val surfaces = Surfaces(JsonBoundary())
    val node =
      requireNotNull(RuntimeProcess.executable(System.getenv("PATH") ?: "", "node")) { "MHP_RUNTIME_NOT_FOUND" }
    val workspace = Path.of(requireNotNull(project.basePath) { "MHP_WORKSPACE_NOT_FOUND" })
    Files.createDirectories(workspace)
    val environment =
      System.getenv().toMutableMap().apply {
        put("XDG_DATA_HOME", Files.createTempDirectory("muse-jb-panel-data").toString())
      }
    val runtime =
      RuntimeProcess.start(
        listOf(node.toString(), layout.runtimeFile.toString(), "panel", "--stdio"),
        workspace,
        environment,
      )
    val initialized = CountDownLatch(1)
    val connection =
      RuntimeConnection(
        runtime,
        surfaces.boundary,
        editorServices(surfaces),
        surfaces::receive,
        ConnectionEvents({ initialized.countDown() }, surfaces.diagnostics::add, surfaces.diagnostics::add),
        surfaces.budget,
      )
    surfaces.connection = connection
    try {
      connection.start()
      assertTrue("the production runtime did not shake hands", initialized.await(60, TimeUnit.SECONDS))
      assertTrue("MHP_PANEL_NOT_READY: the runtime opened no surface", surfaces.opened.await(60, TimeUnit.SECONDS))
      assertThePersonSeesTheReadablePage(surfaces)
      assertTrue("MHP_PANEL_NOT_READY: the runtime exited", runtime.process.isAlive)
    } finally {
      runCatching { connection.close() }
      runCatching { runtime.close() }
    }
  }

  private fun editorServices(surfaces: Surfaces): EditorServices {
    val widgets = JetBrainsPanelHost.onEdt { NativeWidgets(project, surfaces.boundary) {} }
    Disposer.register(testRootDisposable, widgets)
    val services = NativeHostServices(project, surfaces::request, widgets)
    // First-touch IDE initialization exceeds the connection's metadata
    // budget on a cold rig; pay it here first (ConformanceSuite does).
    JetBrainsPanelHost.onEdt { services.metadata }
    return object : EditorServices {
      override val capabilities = services.capabilities
      override val metadata: JsonObject get() = services.metadata

      override fun request(
        method: String,
        params: JsonObject,
        cancellation: RequestCancellation,
      ): JsonElement = JetBrainsPanelHost.onEdt { services.request(method, params, cancellation) }
    }
  }

  // What the person sees: the page rendered, no fatal card over it (it
  // sits over a page that had already rendered), and text painted in a
  // colour that is not its own surface's.
  private fun assertThePersonSeesTheReadablePage(surfaces: Surfaces) {
    val panel = surfaces.panels.values.single()
    var shown = ""
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60)
    while (!shown.contains(RENDERED_TEXT) && System.nanoTime() < deadline) {
      shown = runCatching { visibleText(panel) }.getOrDefault("")
      if (!shown.contains(RENDERED_TEXT)) Thread.sleep(500)
    }
    assertTrue(
      "MHP_PANEL_NOT_RENDERED: $shown delivered=${surfaces.delivered} " +
        "errors=${surfaces.panelErrors} diagnostics=${surfaces.diagnostics}",
      shown.contains(RENDERED_TEXT),
    )
    Thread.sleep(CARD_SETTLE_MILLIS)
    if (visibleText(panel).contains(FATAL_CARD_TEXT)) fail("MHP_PANEL_FATAL_CARD")
    val paint = JsonBoundary.parse(panel.inspector.inspect(PAINT_FACTS).get(10, TimeUnit.SECONDS)).asJsonObject
    val theme = paint["theme"]?.takeIf { !it.isJsonNull }?.asString ?: ""
    val unpainted = paint["foreground"].asString.isEmpty() || paint["text"].asString == paint["surface"].asString
    if (theme.isEmpty() || unpainted) fail("MHP_PANEL_UNREADABLE $paint")
    assertTrue("the theme frame was not delivered: ${surfaces.delivered}", "theme" in surfaces.delivered)
    assertTrue("panel errors sent to the runtime: ${surfaces.panelErrors}", surfaces.panelErrors.isEmpty())
  }

  private fun visibleText(panel: EmbeddedPanel): String =
    panel.inspector.inspect(VISIBLE_TEXT).get(10, TimeUnit.SECONDS)

  // The surfaces the runtime opens, composed as JetBrainsPanelHost.open
  // composes them, and the panelError the host sends for a refused frame.
  private inner class Surfaces(
    val boundary: JsonBoundary,
  ) {
    val budget = QueueBudget(boundary)
    val panels = ConcurrentHashMap<String, EmbeddedPanel>()
    val bindings = ConcurrentHashMap<String, PanelSurface>()
    val delivered = CopyOnWriteArrayList<String>()
    val panelErrors = CopyOnWriteArrayList<String>()
    val diagnostics = CopyOnWriteArrayList<String>()
    val opened = CountDownLatch(1)
    lateinit var connection: RuntimeConnection

    private fun deliver(
      id: String,
      payload: JsonElement,
      seq: Long,
    ) {
      if (payload.isJsonObject) {
        payload.asJsonObject["type"]
          ?.takeIf { it.isJsonPrimitive }
          ?.asString
          ?.let(delivered::add)
      }
      panels[id]?.deliver(payload, seq) ?: error("MHP_PANEL_UNKNOWN_SURFACE")
    }

    private fun open(
      kind: String,
      session: String,
    ): String {
      val id = UUID.randomUUID().toString()
      val callbacks =
        PanelCallbacks(
          connection::send,
          connection::drop,
          { payload, seq -> deliver(id, payload, seq) },
          { code, count -> diagnostics.add("$code:$count") },
        )
      val surface = PanelSurface(id, session, kind, boundary, callbacks, budget)
      val panel = EmbeddedPanel(surface, boundary, JetBrainsPanelHost.locale("en"), diagnostics::add)
      Disposer.register(testRootDisposable, panel)
      panels[id] = panel
      val frame =
        JFrame("Muse conformance panel").apply {
          add(panel.component)
          setSize(900, 700)
          isVisible = true
        }
      Disposer.register(testRootDisposable) { frame.dispose() }
      surface.open()
      bindings[id] = surface
      opened.countDown()
      return id
    }

    private fun panel(params: JsonObject): EmbeddedPanel =
      requireNotNull(panels[params["surfaceId"].asString]) { "MHP_PANEL_UNKNOWN_SURFACE" }

    fun request(
      method: String,
      params: JsonObject,
    ): JsonElement =
      when (method) {
        "surfaces/open" ->
          json("surfaceId" to open(params["kind"].asString, params["sessionId"]?.asString ?: "conformance"))
        "surfaces/close" -> {
          val id = params["surfaceId"].asString
          bindings.remove(id)
          panels.remove(id)?.let(Disposer::dispose) ?: error("MHP_PANEL_UNKNOWN_SURFACE")
          jsonValue(null)
        }
        "surfaces/focus" -> jsonValue(null).also { panel(params) }
        "surfaces/state" -> json("visible" to panel(params).component.isShowing, "focused" to false)
        "surfaces/presentHtml" -> {
          val panel = panel(params)
          require(bindings[params["surfaceId"].asString]?.sessionId == params["sessionId"].asString) {
            "MHP_PANEL_UNKNOWN_SURFACE"
          }
          panel.present(params["html"].asString)
          jsonValue(null)
        }
        else -> error("MHP_UNSUPPORTED_CAPABILITY")
      }

    fun receive(incoming: JsonObject) {
      JetBrainsPanelHost.onEdt {
        val id = incoming["surface"].asString
        runCatching { requireNotNull(bindings[id]) { "MHP_PANEL_UNKNOWN_SURFACE" }.receive(incoming) }
          .onFailure { failure -> refuse(id, incoming, failure) }
      }
    }

    private fun refuse(
      id: String,
      incoming: JsonObject,
      failure: Throwable,
    ) {
      val code = failure.message?.takeIf { it in PANEL_ERRORS } ?: "MHP_PANEL_INVALID_PAYLOAD"
      panelErrors.add(code)
      val error =
        json("mhp" to "1.6", "kind" to "panelError", "surface" to id, "seq" to incoming["seq"], "code" to code)
      boundary.validate(boundary.panel["error"], error)
      connection.send(error, null)
    }
  }

  private companion object {
    const val RENDERED_TEXT = "Muse Spark"
    const val FATAL_CARD_TEXT = "The Panel Hit an Error"
    const val CARD_SETTLE_MILLIS = 2_000L
    const val VISIBLE_TEXT = "document.body ? document.body.innerText : ''"
    const val PAINT_FACTS =
      "JSON.stringify((() => { const root = document.documentElement, style = getComputedStyle(root), " +
        "body = getComputedStyle(document.body); return { theme: root.dataset.msTheme, " +
        "foreground: style.getPropertyValue('--vscode-foreground').trim(), text: body.color, " +
        "surface: body.backgroundColor }; })())"
    val PANEL_ERRORS =
      setOf(
        "MHP_PANEL_UNKNOWN_SURFACE",
        "MHP_PANEL_OUT_OF_ORDER",
        "MHP_PANEL_NOT_READY",
        "MHP_PANEL_TOO_LARGE",
        "MHP_PANEL_BACKPRESSURE",
        "MHP_PANEL_WRONG_DIRECTION",
        "MHP_PANEL_INVALID_PAYLOAD",
      )
  }
}
