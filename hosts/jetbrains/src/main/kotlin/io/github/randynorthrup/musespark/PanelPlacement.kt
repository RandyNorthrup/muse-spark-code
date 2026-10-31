package io.github.randynorthrup.musespark

import com.intellij.diff.util.FileEditorBase
import com.intellij.openapi.Disposable
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.ToolWindow
import com.intellij.testFramework.LightVirtualFile
import com.intellij.ui.content.ContentFactory
import javax.swing.Action

interface SurfaceLocation : Disposable {
  fun focus()
}

class PanelPlacement(
  private val project: Project,
  private val toolWindow: ToolWindow,
) {
  fun show(
    panel: EmbeddedPanel,
    title: String,
    placement: String,
    close: () -> Unit,
  ): SurfaceLocation =
    when (placement) {
      "side" -> side(panel, title, close)
      "tab" -> tab(panel, title, close)
      "window" -> window(panel, title, close)
      else -> error("MHP_INVALID_PARAMS")
    }

  private fun side(
    panel: EmbeddedPanel,
    title: String,
    close: () -> Unit,
  ): SurfaceLocation {
    val content = ContentFactory.getInstance().createContent(panel.component, title, false)
    content.setDisposer { close() }
    toolWindow.contentManager.addContent(content)
    return object : SurfaceLocation {
      override fun focus() {
        toolWindow.contentManager.setSelectedContent(content)
        toolWindow.activate(null)
      }

      override fun dispose() {
        toolWindow.contentManager.removeContent(content, true)
      }
    }.also { it.focus() }
  }

  private fun tab(
    panel: EmbeddedPanel,
    title: String,
    close: () -> Unit,
  ): SurfaceLocation {
    val file = PanelFile(title, panel, close)
    val manager = FileEditorManager.getInstance(project)
    return object : SurfaceLocation {
      override fun focus() {
        manager.openFile(file, true)
      }

      override fun dispose() {
        manager.closeFile(file)
      }
    }.also { it.focus() }
  }

  private fun window(
    panel: EmbeddedPanel,
    title: String,
    close: () -> Unit,
  ): SurfaceLocation {
    val dialog = PanelDialog(project, panel, title, close)
    dialog.show()
    return object : SurfaceLocation {
      override fun focus() {
        dialog.toFront()
        panel.component.requestFocusInWindow()
      }

      override fun dispose() {
        dialog.close(DialogWrapper.CANCEL_EXIT_CODE)
      }
    }
  }
}

private class PanelDialog(
  project: Project,
  private val panel: EmbeddedPanel,
  name: String,
  private val onClose: () -> Unit,
) : DialogWrapper(project, false, IdeModalityType.MODELESS) {
  init {
    title = name
    init()
  }

  override fun createCenterPanel() = panel.component

  override fun createActions(): Array<Action> = emptyArray()

  override fun dispose() {
    onClose()
    super.dispose()
  }
}

class PanelFile(
  name: String,
  val panel: EmbeddedPanel,
  val onClose: () -> Unit,
) : LightVirtualFile(name)

class PanelFileEditorProvider :
  FileEditorProvider,
  DumbAware {
  override fun accept(
    project: Project,
    file: VirtualFile,
  ) = file is PanelFile

  override fun createEditor(
    project: Project,
    file: VirtualFile,
  ): FileEditor {
    require(file is PanelFile) { "MHP_PANEL_UNKNOWN_SURFACE" }
    return PanelFileEditor(file)
  }

  override fun getEditorTypeId() = "muse-spark-panel"

  override fun getPolicy() = FileEditorPolicy.HIDE_DEFAULT_EDITOR
}

private class PanelFileEditor(
  private val file: PanelFile,
) : FileEditorBase() {
  override fun getComponent() = file.panel.component

  override fun getPreferredFocusedComponent() = component

  override fun getName() = file.name

  override fun getFile(): VirtualFile = file

  override fun deselectNotify() {
    file.panel.surface.hidden()
  }

  override fun dispose() {
    if (isDisposed) return
    try {
      file.onClose()
    } finally {
      super.dispose()
    }
  }
}
