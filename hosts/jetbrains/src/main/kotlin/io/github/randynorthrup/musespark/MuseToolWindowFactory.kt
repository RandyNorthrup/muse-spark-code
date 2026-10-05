package io.github.randynorthrup.musespark

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.util.concurrency.AppExecutorUtil
import java.awt.BorderLayout
import java.nio.file.Path
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.SwingUtilities

class MuseToolWindowFactory : ToolWindowFactory {
  override fun createToolWindowContent(
    project: Project,
    toolWindow: ToolWindow,
  ) {
    val host = JetBrainsPanelHost(project, toolWindow)
    Disposer.register(project, host)
    host.start()
  }
}

class JetBrainsPanelHost(
  private val project: Project,
  private val toolWindow: ToolWindow,
) : Disposable {
  private val log = Logger.getInstance(JetBrainsPanelHost::class.java)
  private val boundary = JsonBoundary()
  private val budget = QueueBudget(boundary)
  private val panels = mutableMapOf<String, EmbeddedPanel>()
  private val bindings = mutableMapOf<String, PanelSurface>()
  private val locale = locale(Locale.getDefault().toLanguageTag())
  private var runtime: RuntimeProcess? = null
  private var pipe: MhpPipe? = null
  private var connection: MhpConnection? = null
  private val executor =
    ThreadPoolExecutor(
      1,
      1,
      0,
      TimeUnit.SECONDS,
      ArrayBlockingQueue(boundary.maximumQueuedMessages),
      java.util.concurrent.ThreadFactory { runnable ->
        Thread(runnable, "Muse host request").apply { isDaemon = true }
      },
    )
  private val loading = JPanel(BorderLayout()).apply { add(JLabel(uiText("connecting")), BorderLayout.CENTER) }

  fun start() {
    toolWindow.contentManager.addContent(ContentFactory.getInstance().createContent(loading, PRODUCT_NAME, false))
    AppExecutorUtil.getAppExecutorService().execute {
      try {
        val environment = System.getenv()
        val executable =
          requireNotNull(
            RuntimeProcess.executable(environment["PATH"] ?: "", "muse-spark-code-acp"),
          ) { "MHP_RUNTIME_NOT_FOUND" }
        val embedded = JBCefApp.isSupported()
        val cwd = Path.of(requireNotNull(project.basePath) { "MHP_WORKSPACE_NOT_FOUND" })
        val process =
          RuntimeProcess.start(
            listOf(executable.toString(), "panel", if (embedded) "--stdio" else "--companion"),
            cwd,
            environment,
          )
        runtime = process
        val services = NativeHostServices(project, ::surfaceRequest)
        val dispatch =
          object : EditorServices {
            override val capabilities =
              if (embedded) {
                services.capabilities
              } else {
                services.capabilities.filter {
                  it !=
                    "surfaces"
                }
              }

            override fun request(
              method: String,
              params: JsonObject,
              cancellation: RequestCancellation,
            ): JsonElement =
              onEdt {
                cancellation.check()
                services.request(method, params, cancellation)
              }
          }
        val mhp =
          MhpConnection(
            boundary,
            dispatch,
            executor,
            ::send,
            ::receivePanel,
            ConnectionEvents({
              onEdt {
                if (embedded) open("chat", project.getService(PanelState::class.java).state.sessionId)
                installEditorEvents(project, services, requireNotNull(connection), this)
              }
            }, ::diagnostic),
          )
        connection = mhp
        pipe =
          MhpPipe(process.process.inputStream, process.process.outputStream, boundary, mhp::receive, { code ->
            diagnostic(code)
            mhp.close()
            SwingUtilities.invokeLater { failed(code) }
          }, budget).also(MhpPipe::start)
        process.drainStderr(::diagnostic)
      } catch (_: Exception) {
        diagnostic("MHP_RUNTIME_START_FAILED")
        SwingUtilities.invokeLater { failed("MHP_RUNTIME_START_FAILED") }
      }
    }
  }

  private fun failed(code: String) {
    loading.removeAll()
    loading.add(JLabel(uiText("crashTitle") + ": " + code), BorderLayout.CENTER)
    loading.revalidate()
    loading.repaint()
  }

  private fun surfaceRequest(
    method: String,
    params: JsonObject,
  ): JsonElement =
    when (method) {
      "surfaces/open" -> {
        val session = params["sessionId"]?.asString ?: project.getService(PanelState::class.java).state.sessionId
        json("surfaceId" to open(params["kind"].asString, session))
      }
      "surfaces/focus" -> {
        val panel = requireNotNull(panels[params["surfaceId"].asString]) { "MHP_PANEL_UNKNOWN_SURFACE" }
        toolWindow.contentManager.contents
          .firstOrNull {
            it.component == panel.component
          }?.let(toolWindow.contentManager::setSelectedContent)
        toolWindow.activate(null)
        jsonValue(null)
      }
      "surfaces/state" -> {
        val panel = requireNotNull(panels[params["surfaceId"].asString]) { "MHP_PANEL_UNKNOWN_SURFACE" }
        json(
          "visible" to panel.component.isShowing,
          "focused" to
            SwingUtilities.isDescendingFrom(
              java.awt.KeyboardFocusManager
                .getCurrentKeyboardFocusManager()
                .focusOwner ?: loading,
              panel.component,
            ),
        )
      }
      else -> error("MHP_METHOD_NOT_FOUND")
    }

  private fun open(
    kind: String,
    session: String,
  ): String {
    val id = UUID.randomUUID().toString()
    val surface =
      PanelSurface(
        id,
        session,
        kind,
        boundary,
        PanelCallbacks(::send, { pipe?.drop(it) ?: 0 }, { payload, seq ->
          panels[id]?.deliver(payload, seq) ?: error("MHP_PANEL_UNKNOWN_SURFACE")
        }, { code, count -> log.warn("$code:$count") }),
        budget,
      )
    surface.open()
    bindings[id] = surface
    val panel = EmbeddedPanel(surface, boundary, locale, ::diagnostic)
    panels[id] = panel
    val content = ContentFactory.getInstance().createContent(panel.component, title(kind), false)
    content.setDisposer {
      panels.remove(id)
      bindings.remove(id)
      Disposer.dispose(panel)
    }
    toolWindow.contentManager.addContent(content)
    toolWindow.contentManager.setSelectedContent(content)
    return id
  }

  private fun receivePanel(frame: JsonObject) {
    val id = frame["surface"].asString
    val surface = synchronized(bindings) { bindings[id] } ?: error("MHP_PANEL_UNKNOWN_SURFACE")
    runCatching { surface.receive(frame) }.onFailure { failure ->
      val code = failure.message?.takeIf { it in PANEL_ERRORS } ?: "MHP_PANEL_INVALID_PAYLOAD"
      val error =
        json(
          "mhp" to "1.1",
          "kind" to "panelError",
          "surface" to id,
          "seq" to frame["seq"],
          "code" to code,
        )
      boundary.validate(boundary.panel["error"], error)
      send(error, null)
    }
  }

  private fun send(
    frame: JsonObject,
    surface: String?,
  ) = requireNotNull(pipe) {
    "MHP_TRANSPORT_CLOSED"
  }.send(frame, surface)

  private fun diagnostic(code: String) {
    log.warn(code)
  }

  private fun uiText(key: String): String =
    JsonBoundary.parse(JsonBoundary.resource("/pages/ui.$locale.json")).asJsonObject[key].asString

  private fun title(kind: String): String =
    when (kind) {
      "tasks" -> uiText("tasksTabTitle").replace("{conversation}", uiText("untitledConversation"))
      "whatsNew" -> uiText("whatsNewTitle")
      else -> PRODUCT_NAME
    }

  override fun dispose() {
    panels.values.toList().forEach(Disposer::dispose)
    panels.clear()
    bindings.clear()
    connection?.close()
    pipe?.close()
    executor.shutdownNow()
    runtime?.let { process -> AppExecutorUtil.getAppExecutorService().execute { process.close() } }
    runtime = null
  }

  companion object {
    const val PRODUCT_NAME = "Muse Spark Code (Unofficial)"
    private val PANEL_ERRORS =
      setOf(
        "MHP_PANEL_UNKNOWN_SURFACE",
        "MHP_PANEL_OUT_OF_ORDER",
        "MHP_PANEL_NOT_READY",
        "MHP_PANEL_TOO_LARGE",
        "MHP_PANEL_BACKPRESSURE",
        "MHP_PANEL_WRONG_DIRECTION",
        "MHP_PANEL_INVALID_PAYLOAD",
      )

    fun locale(language: String): String {
      val locales =
        setOf("en", "zh-cn", "zh-tw", "ja", "ko", "de", "fr", "es", "pt-br", "ru", "it", "tr", "pl", "cs", "hu")
      val normalized = language.lowercase()
      return normalized.takeIf { it in locales } ?: normalized.substringBefore('-').takeIf { it in locales }
        ?: "en"
    }

    fun <T> onEdt(action: () -> T): T {
      if (ApplicationManager.getApplication().isDispatchThread) return action()
      var result: Result<T>? = null
      ApplicationManager.getApplication().invokeAndWait({ result = runCatching(action) }, ModalityState.any())
      return requireNotNull(result).getOrThrow()
    }
  }
}
