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
import java.util.concurrent.ConcurrentHashMap
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
  private var attempt = 0L

  @Volatile private var disposed = false
  private val locale = locale(Locale.getDefault().toLanguageTag())
  private var nativeLifetime: Disposable? = null
  private var companion = false
  internal var connection: RuntimeConnection? = null
    private set
  private val status = JLabel(localizedText(locale, "connecting"))
  private val loading =
    JPanel(BorderLayout()).apply {
      add(status, BorderLayout.CENTER)
    }

  fun start(embedded: Boolean = JBCefApp.isSupported()) {
    if (disposed) return
    val starting = ++attempt
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
        SwingUtilities.invokeLater {
          if (disposed || starting != attempt) {
            AppExecutorUtil.getAppExecutorService().execute { process.close() }
          } else {
            runCatching { attach(process, embedded) }.onFailure {
              AppExecutorUtil.getAppExecutorService().execute { process.close() }
              stopSession("MHP_RUNTIME_START_FAILED")
            }
          }
        }
      } catch (_: Exception) {
        diagnostic("MHP_RUNTIME_START_FAILED")
        SwingUtilities.invokeLater { if (!disposed && starting == attempt) stopSession("MHP_RUNTIME_START_FAILED") }
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
    check(!disposed) { "MHP_TRANSPORT_CLOSED" }
    if (connection != null) stopSession()
    val lifetime = Disposer.newDisposable("Muse native session")
    Disposer.register(this, lifetime)
    nativeLifetime = lifetime
    lateinit var owner: RuntimeConnection
    val widgets = NativeWidgets(project, boundary) { id -> owner.notify("commands/execute", json("id" to id)) }
    Disposer.register(lifetime, widgets)
    val checkEpoch = {
      check(nativeLifetime === lifetime) { "MHP_TRANSPORT_CLOSED" }
      check(connection === owner) { "MHP_TRANSPORT_CLOSED" }
      check(owner.isOpen) { "MHP_TRANSPORT_CLOSED" }
    }
    val services =
      NativeHostServices(project, { method, params ->
        surfaceRequest(method, params, checkEpoch)
      }, widgets, NativeHostOptions(checkEpoch = checkEpoch, workspaceRoot = process.workspaceRoot))
    NativeTheme.install(project, lifetime) { if (!disposed) panels.values.forEach(EmbeddedPanel::updateTheme) }
    owner =
      RuntimeConnection(
        process,
        boundary,
        dispatch(services, embedded, checkEpoch),
        { frame ->
          onEdt { if (!disposed && nativeLifetime === lifetime) receivePanel(frame) }
        },
        ConnectionEvents({
          SwingUtilities.invokeLater {
            if (!disposed && nativeLifetime === lifetime) {
              status.text = PRODUCT_NAME
              if (nativeLifetime === lifetime) {
                installEditorEvents(project, services, requireNotNull(connection), lifetime)
              }
            }
          }
        }, diagnostic, { code ->
          diagnostic(code)
          SwingUtilities.invokeLater {
            if (!disposed && nativeLifetime === lifetime) stopSession(code)
          }
        }),
        budget,
      )
    connection = owner
    tab.bind(owner)
    owner.start()
  }

  private fun dispatch(
    services: NativeHostServices,
    embedded: Boolean,
    checkEpoch: () -> Unit,
  ): EditorServices {
    val metadata = services.metadata
    return object : EditorServices {
      override val capabilities = services.capabilities.filter { embedded || it != "surfaces" }

      override val metadata: JsonObject get() =
        run {
          checkEpoch()
          metadata.deepCopy()
        }

      override fun request(
        method: String,
        params: JsonObject,
        cancellation: RequestCancellation,
      ): JsonElement =
        onEdt {
          check(!disposed) { "MHP_TRANSPORT_CLOSED" }
          checkEpoch()
          cancellation.check()
          services.request(method, params, cancellation)
        }
    }
  }

  private fun surfaceRequest(
    method: String,
    params: JsonObject,
    checkEpoch: () -> Unit,
  ): JsonElement {
    checkEpoch()
    return when (method) {
      "surfaces/open" -> {
        toolWindow.contentManager.contents.firstOrNull { it.component == loading }?.let {
          toolWindow.contentManager.removeContent(it, true)
        }
        val session = params["sessionId"]?.asString ?: project.getService(PanelState::class.java).state.sessionId
        json("surfaceId" to open(params["kind"].asString, session, params["placement"].asString))
      }
      "surfaces/focus" -> {
        requireNotNull(locations[params["surfaceId"].asString]) { "MHP_PANEL_UNKNOWN_SURFACE" }.focus()
        jsonValue(null)
      }
      "surfaces/close" -> {
        val location = requireNotNull(locations.remove(params["surfaceId"].asString)) { "MHP_PANEL_UNKNOWN_SURFACE" }
        Disposer.dispose(location)
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
      "surfaces/presentHtml" -> {
        val id = params["surfaceId"].asString
        val panel = requireNotNull(panels[id]) { "MHP_PANEL_UNKNOWN_SURFACE" }
        val binding = requireNotNull(bindings[id]) { "MHP_PANEL_UNKNOWN_SURFACE" }
        require(binding.sessionId == params["sessionId"].asString) { "MHP_PANEL_UNKNOWN_SURFACE" }
        panel.present(params["html"].asString)
        jsonValue(null)
      }
      else -> error("MHP_UNSUPPORTED_CAPABILITY")
    }
  }

  private fun open(
    kind: String,
    session: String,
    placement: String,
  ): String {
    check(!disposed) { "MHP_TRANSPORT_CLOSED" }
    require(panels.size < boundary.maximumQueuedMessages) { "MHP_PANEL_BACKPRESSURE" }
    val id = UUID.randomUUID().toString()
    val owner = requireNotNull(connection) { "MHP_TRANSPORT_CLOSED" }
    val surface =
      PanelSurface(
        id,
        session,
        kind,
        boundary,
        PanelCallbacks(owner::send, owner::drop, { payload, seq ->
          panels[id]?.deliver(payload, seq) ?: error("MHP_PANEL_UNKNOWN_SURFACE")
        }, { code, count -> log.warn("$code:$count") }),
        budget,
      )
    // JCEF can report support yet fail construction, bridge setup or the initial
    // load: the readiness callback only fires after success, so recover here by
    // restarting in companion mode and fail this request for the retiring runtime.
    val panel =
      runCatching { EmbeddedPanel(surface, boundary, locale, diagnostic, ::useCompanion) }
        .onFailure { useCompanion() }
        .getOrThrow()
    panels[id] = panel
    runCatching {
      locations[id] =
        placements.show(panel, surfaceTitle(locale, kind), placement) {
          locations.remove(id)
          bindings.remove(id)
          panels.remove(id)?.let(Disposer::dispose)
        }
    }.onFailure {
      panels.remove(id)
      Disposer.dispose(panel)
    }.getOrThrow()
    surface.open()
    bindings[id] = surface
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
    return id
  }

  private fun receivePanel(frame: JsonObject) {
    val id = frame["surface"].asString
    runCatching { requireNotNull(bindings[id]) { "MHP_PANEL_UNKNOWN_SURFACE" }.receive(frame) }.onFailure { failure ->
      val code = failure.message?.takeIf { it in PANEL_ERRORS } ?: "MHP_PANEL_INVALID_PAYLOAD"
      val error =
        json(
          "mhp" to "1.5",
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
  ) = requireNotNull(connection) {
    "MHP_TRANSPORT_CLOSED"
  }.send(frame, surface)

  private fun stopSession(code: String? = null) {
    ++attempt
    val previous = connection
    connection = null
    previous?.close()
    locations.values.toList().forEach { location -> runCatching { Disposer.dispose(location) } }
    locations.clear()
    panels.values.toList().forEach(Disposer::dispose)
    panels.clear()
    bindings.clear()
    tab.bind(null)
    nativeLifetime?.let(Disposer::dispose)
    nativeLifetime = null
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
    if (disposed) return
    disposed = true
    ++attempt
    stopSession()
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
