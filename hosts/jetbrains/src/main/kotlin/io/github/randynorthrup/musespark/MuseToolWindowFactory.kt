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
import java.util.concurrent.ConcurrentHashMap
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
  private val diagnostic: (String) -> Unit = log::warn
  private val boundary = JsonBoundary()
  private val tab = project.getService(NativeTab::class.java)
  private val budget = QueueBudget(boundary)
  private val panels = ConcurrentHashMap<String, EmbeddedPanel>()
  private val bindings = ConcurrentHashMap<String, PanelSurface>()
  private val locations = ConcurrentHashMap<String, SurfaceLocation>()
  private val placements = PanelPlacement(project, toolWindow)
  private val lifetimeMonitor = Any()

  @Volatile private var disposed = false
  private val locale = locale(Locale.getDefault().toLanguageTag())
  private var runtime: RuntimeProcess? = null
  private var nativeLifetime: Disposable? = null
  private var companion = false
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
  private val status = JLabel(localizedText(locale, "connecting"))
  private val loading =
    JPanel(BorderLayout()).apply {
      add(status, BorderLayout.CENTER)
    }

  fun start(embedded: Boolean = JBCefApp.isSupported()) {
    companion = !embedded
    if (toolWindow.contentManager.contents.none { it.component == loading }) {
      toolWindow.contentManager.addContent(ContentFactory.getInstance().createContent(loading, PRODUCT_NAME, false))
    }
    AppExecutorUtil.getAppExecutorService().execute {
      try {
        val environment = System.getenv()
        val executable =
          requireNotNull(
            RuntimeProcess.executable(
              environment.entries.firstOrNull { it.key.equals("PATH", ignoreCase = true) }?.value ?: "",
              "muse-spark-code-acp",
            ),
          ) { "MHP_RUNTIME_NOT_FOUND" }
        val cwd = Path.of(requireNotNull(project.basePath) { "MHP_WORKSPACE_NOT_FOUND" })
        val process = RuntimeProcess.start(RuntimeProcess.panelCommand(executable, embedded), cwd, environment)
        synchronized(lifetimeMonitor) {
          if (disposed) {
            process.close()
            return@execute
          }
          runtime = process
          attach(process, embedded)
        }
      } catch (_: Exception) {
        pipe?.close()
        tab.bind(null)
        connection?.close()
        runtime?.close()
        diagnostic("MHP_RUNTIME_START_FAILED")
        SwingUtilities.invokeLater { stopSession("MHP_RUNTIME_START_FAILED") }
      }
    }
  }

  private fun useCompanion() {
    if (disposed || companion) return
    companion = true
    stopSession()
    status.text = localizedText(locale, "connecting")
    if (toolWindow.contentManager.contents.none { it.component == loading }) {
      toolWindow.contentManager.addContent(ContentFactory.getInstance().createContent(loading, PRODUCT_NAME, false))
    }
    loading.revalidate()
    loading.repaint()
    AppExecutorUtil.getAppExecutorService().execute {
      SwingUtilities.invokeLater { if (!disposed) start(false) }
    }
  }

  internal fun attach(
    process: RuntimeProcess,
    embedded: Boolean,
  ) {
    runtime = process
    val lifetime = Disposer.newDisposable("Muse native session")
    Disposer.register(this, lifetime)
    nativeLifetime = lifetime
    val widgets = NativeWidgets(project, boundary) { id -> connection?.notify("commands/execute", json("id" to id)) }
    Disposer.register(lifetime, widgets)
    val services = NativeHostServices(project, ::surfaceRequest, widgets)
    NativeTheme.install(project, lifetime) { if (!disposed) panels.values.forEach(EmbeddedPanel::updateTheme) }
    val mhp =
      MhpConnection(
        boundary,
        dispatch(services, embedded),
        executor,
        ::send,
        ::receivePanel,
        ConnectionEvents({
          SwingUtilities.invokeLater {
            if (!disposed && nativeLifetime === lifetime) {
              if (embedded) {
                toolWindow.contentManager.contents.firstOrNull { it.component == loading }?.let {
                  toolWindow.contentManager.removeContent(it, true)
                }
                runCatching { open("chat", project.getService(PanelState::class.java).state.sessionId, "side") }
                  .onFailure {
                    diagnostic("MHP_JCEF_UNAVAILABLE")
                    useCompanion()
                  }
              } else {
                status.text = PRODUCT_NAME
              }
              if (nativeLifetime ===
                lifetime
              ) {
                installEditorEvents(project, services, requireNotNull(connection), lifetime)
              }
            }
          }
        }, diagnostic),
      )
    connection = mhp
    tab.bind(mhp)
    pipe =
      MhpPipe(process.process.inputStream, process.process.outputStream, boundary, mhp::receive, { code ->
        diagnostic(code)
        mhp.close()
        SwingUtilities.invokeLater {
          synchronized(lifetimeMonitor) {
            if (!disposed && runtime === process) {
              stopSession(code)
            }
          }
        }
      }, budget).also(MhpPipe::start)
    process.drainStderr(diagnostic)
  }

  private fun dispatch(
    services: NativeHostServices,
    embedded: Boolean,
  ): EditorServices =
    object : EditorServices {
      override val capabilities = services.capabilities.filter { embedded || it != "surfaces" }

      override val metadata: JsonObject get() = onEdt { services.metadata }

      override fun request(
        method: String,
        params: JsonObject,
        cancellation: RequestCancellation,
      ): JsonElement =
        onEdt {
          check(!disposed) { "MHP_TRANSPORT_CLOSED" }
          cancellation.check()
          services.request(method, params, cancellation)
        }
    }

  private fun surfaceRequest(
    method: String,
    params: JsonObject,
  ): JsonElement =
    when (method) {
      "surfaces/open" -> {
        val session = params["sessionId"]?.asString ?: project.getService(PanelState::class.java).state.sessionId
        json("surfaceId" to open(params["kind"].asString, session, params["placement"].asString))
      }
      "surfaces/focus" -> {
        requireNotNull(locations[params["surfaceId"].asString]) { "MHP_PANEL_UNKNOWN_SURFACE" }.focus()
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
    placement: String,
  ): String {
    check(!disposed) { "MHP_TRANSPORT_CLOSED" }
    require(panels.size < boundary.maximumQueuedMessages) { "MHP_PANEL_BACKPRESSURE" }
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
    val panel = EmbeddedPanel(surface, boundary, locale, diagnostic, ::useCompanion)
    panels[id] = panel
    panel.component.addHierarchyListener { event ->
      if ((
          event.changeFlags and
            java.awt.event.HierarchyEvent.SHOWING_CHANGED
              .toLong()
        ) != 0L &&
        !panel.component.isShowing
      ) {
        runCatching(surface::hidden).onFailure { diagnostic("MHP_PANEL_HIDDEN_REFUSED") }
      }
    }
    locations[id] =
      placements.show(panel, surfaceTitle(locale, kind), placement) {
        locations.remove(id)
        bindings.remove(id)
        panels.remove(id)?.let(Disposer::dispose)
      }
    return id
  }

  private fun receivePanel(frame: JsonObject) {
    val id = frame["surface"].asString
    runCatching { requireNotNull(bindings[id]) { "MHP_PANEL_UNKNOWN_SURFACE" }.receive(frame) }.onFailure { failure ->
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

  private fun stopSession(code: String? = null) {
    locations.values.toList().forEach { location -> runCatching { Disposer.dispose(location) } }
    locations.clear()
    panels.values.toList().forEach(Disposer::dispose)
    panels.clear()
    bindings.clear()
    tab.bind(null)
    connection?.close()
    connection = null
    pipe?.close()
    pipe = null
    nativeLifetime?.let(Disposer::dispose)
    nativeLifetime = null
    val previous = runtime
    runtime = null
    previous?.let { process -> AppExecutorUtil.getAppExecutorService().execute { process.close() } }
    if (code != null && !disposed) {
      if (toolWindow.contentManager.contents.none { it.component == loading }) {
        toolWindow.contentManager.addContent(ContentFactory.getInstance().createContent(loading, PRODUCT_NAME, false))
      }
      status.text = localizedText(locale, "crashTitle") + ": " + code
      loading.revalidate()
      loading.repaint()
    }
  }

  override fun dispose() {
    synchronized(lifetimeMonitor) {
      if (disposed) return
      disposed = true
      stopSession()
      executor.shutdownNow()
    }
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
      ApplicationManager.getApplication().invokeAndWait({
        result = runCatching(action)
      }, ModalityState.defaultModalityState())
      return requireNotNull(result).getOrThrow()
    }
  }
}

private fun localizedText(
  locale: String,
  key: String,
): String = JsonBoundary.parse(JsonBoundary.resource("/pages/ui.$locale.json")).asJsonObject[key].asString

private fun surfaceTitle(
  locale: String,
  kind: String,
): String =
  when (kind) {
    "tasks" ->
      localizedText(
        locale,
        "tasksTabTitle",
      ).replace("{conversation}", localizedText(locale, "untitledConversation"))
    "whatsNew" -> localizedText(locale, "whatsNewTitle")
    else -> JetBrainsPanelHost.PRODUCT_NAME
  }
