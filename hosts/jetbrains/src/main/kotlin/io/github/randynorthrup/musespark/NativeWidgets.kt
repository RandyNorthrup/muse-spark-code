package io.github.randynorthrup.musespark

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CustomShortcutSet
import com.intellij.openapi.actionSystem.KeyboardShortcut
import com.intellij.openapi.progress.util.ProgressWindow
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.openapi.wm.WindowManager
import com.intellij.util.Consumer
import java.awt.event.MouseEvent
import javax.swing.KeyStroke

class NativeWidgets(
  private val project: Project,
  private val boundary: JsonBoundary,
  private val execute: (String) -> Unit,
) : Disposable {
  private val statuses = mutableMapOf<String, RegisteredStatus>()
  private val progresses = mutableMapOf<String, ProgressWindow>()
  private val commands = mutableSetOf<String>()

  fun register(
    params: JsonObject,
    checkCurrent: () -> Unit = {},
  ): JsonElement {
    checkCurrent()
    val id = "MuseSpark.${project.locationHash}.${params["id"].asString}"
    require(id in commands || commands.size < boundary.maximumQueuedMessages) { "MHP_PANEL_BACKPRESSURE" }
    val manager = ActionManager.getInstance()
    if (id in commands) manager.unregisterAction(id)
    val action =
      object : DumbAwareAction(params["title"].asString) {
        override fun update(event: AnActionEvent) {
          event.presentation.isEnabled = event.project == project && !project.isDisposed
        }

        override fun actionPerformed(event: AnActionEvent) {
          if (event.project == project && !project.isDisposed) execute(params["id"].asString)
        }
      }
    checkCurrent()
    manager.registerAction(id, action)
    commands.add(id)
    val key = params["suggestedKey"]?.asString?.let(KeyStroke::getKeyStroke)
    val root = WindowManager.getInstance().getFrame(project)?.rootPane
    if (key != null && root != null) {
      action.registerCustomShortcutSet(CustomShortcutSet(KeyboardShortcut(key, null)), root, this)
    }
    return jsonValue(null)
  }

  fun status(
    params: JsonObject,
    checkCurrent: () -> Unit = {},
  ): JsonElement {
    checkCurrent()
    val bar = requireNotNull(WindowManager.getInstance().getStatusBar(project)) { "MHP_UI_UNAVAILABLE" }
    val id = params["id"].asString
    val widgetId = "MuseSpark.$id"
    if (!params["visible"].asBoolean) {
      statuses.remove(id)?.let { Disposer.dispose(it.lifetime) }
    } else {
      require(id in statuses || statuses.size < boundary.maximumQueuedMessages) { "MHP_PANEL_BACKPRESSURE" }
      val widget =
        statuses.getOrPut(id) {
          registerStatus(widgetId)
        }
      widget.widget.labelText = params["text"].asString
      widget.widget.command = params["command"]?.asString
      checkCurrent()
      bar.updateWidget(widgetId)
    }
    return jsonValue(null)
  }

  fun progress(
    params: JsonObject,
    checkCurrent: () -> Unit = {},
  ): JsonElement {
    checkCurrent()
    val id = params["id"].asString
    if (params["done"].asBoolean) {
      progresses.remove(id)?.let {
        it.stop()
        it.dispose()
      }
    } else {
      require(id in progresses || progresses.size < boundary.maximumQueuedMessages) { "MHP_PANEL_BACKPRESSURE" }
      val indicator =
        progresses.getOrPut(id) {
          ProgressWindow(false, project).apply {
            start()
            background()
          }
        }
      indicator.title = params["title"].asString
      indicator.text = params["message"]?.asString ?: ""
      indicator.isIndeterminate = !params.has("fraction")
      params["fraction"]?.let { indicator.fraction = it.asDouble }
    }
    return jsonValue(null)
  }

  private fun registerStatus(id: String): RegisteredStatus {
    val widget = RuntimeStatus(id, execute)
    val lifetime = Disposer.newDisposable()
    val factory = RuntimeStatusFactory(project, widget)
    StatusBarWidgetFactory.EP_NAME.point.registerExtension(factory, lifetime)
    return RegisteredStatus(widget, lifetime)
  }

  override fun dispose() {
    statuses.values.forEach { Disposer.dispose(it.lifetime) }
    statuses.clear()
    progresses.values.forEach {
      it.stop()
      it.dispose()
    }
    progresses.clear()
    commands.forEach(ActionManager.getInstance()::unregisterAction)
    commands.clear()
  }
}

private data class RegisteredStatus(
  val widget: RuntimeStatus,
  val lifetime: Disposable,
)

private class RuntimeStatusFactory(
  private val owner: Project,
  private val widget: RuntimeStatus,
) : StatusBarWidgetFactory {
  override fun getId() = widget.ID()

  override fun getDisplayName() = widget.labelText

  override fun isAvailable(project: Project) = project == owner && !owner.isDisposed

  override fun createWidget(project: Project): StatusBarWidget = widget

  override fun isConfigurable() = false
}

private class RuntimeStatus(
  private val id: String,
  private val execute: (String) -> Unit,
) : StatusBarWidget,
  StatusBarWidget.TextPresentation {
  var labelText = ""
  var command: String? = null

  override fun ID() = id

  override fun getPresentation(): StatusBarWidget.WidgetPresentation = this

  override fun getText() = labelText

  override fun getAlignment() = 0f

  override fun getTooltipText() = labelText

  override fun getClickConsumer(): Consumer<MouseEvent> = Consumer { command?.let(execute) }

  override fun install(statusBar: StatusBar) = Unit

  override fun dispose() = Unit
}
