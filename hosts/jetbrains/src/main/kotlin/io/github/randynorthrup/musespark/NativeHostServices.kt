package io.github.randynorthrup.musespark

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerEx
import com.intellij.ide.BrowserUtil
import com.intellij.ide.impl.ProjectUtil
import com.intellij.ide.trustedProjects.TrustedProjects
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ProjectRootManager
import com.intellij.openapi.wm.WindowManager
import java.awt.KeyboardFocusManager
import java.awt.datatransfer.StringSelection
import java.net.URI
import java.nio.file.FileSystems
import java.nio.file.Path
import javax.swing.JList
import javax.swing.JOptionPane
import javax.swing.JScrollPane
import javax.swing.ListSelectionModel

interface EditorServices {
  val capabilities: List<String>

  fun request(
    method: String,
    params: JsonObject,
    cancellation: RequestCancellation,
  ): JsonElement
}

class NativeHostServices(
  private val project: Project,
  private val surfaces: (String, JsonObject) -> JsonElement,
  private val widgets: NativeWidgets,
) : EditorServices {
  override val capabilities =
    listOf(
      "lifecycle",
      "workspace",
      "documents",
      "editor",
      "diagnostics",
      "ui",
      "surfaces",
      "window",
      "commands",
    )
  val documents = DocumentServices(project) { TrustedProjects.isProjectTrusted(project) }

  override fun request(
    method: String,
    params: JsonObject,
    cancellation: RequestCancellation,
  ): JsonElement =
    when {
      method.startsWith("documents/") || method.startsWith("editor/") -> documents.request(method, params)
      method.startsWith("surfaces/") -> surfaces(method, params)
      method.startsWith("workspace/") -> workspace(method, params)
      method.startsWith("ui/") -> ui(method, params, cancellation)
      method == "commands/register" -> widgets.register(params)
      method == "diagnostics/get" -> diagnostics(params["uri"]?.asString)
      method == "window/state" ->
        json("focused" to focused())
      method == "window/attention" -> {
        notify(params["message"].asString, "information")
        jsonValue(null)
      }
      else -> error("MHP_UNSUPPORTED_CAPABILITY")
    }

  fun folders(): JsonElement =
    jsonValue(
      ProjectRootManager.getInstance(project).contentRoots.map {
        json("uri" to DocumentServices.uri(it), "name" to it.name)
      },
    )

  private fun focused(): Boolean {
    val frame = WindowManager.getInstance().getFrame(project) ?: return false
    val active = KeyboardFocusManager.getCurrentKeyboardFocusManager().activeWindow
    return generateSequence(active) { it.owner }.any { it == frame }
  }

  private fun workspace(
    method: String,
    params: JsonObject,
  ): JsonElement =
    when (method) {
      "workspace/folders" -> folders()
      "workspace/trust" -> json("trusted" to TrustedProjects.isProjectTrusted(project))
      "workspace/findFiles" -> {
        val include = FileSystems.getDefault().getPathMatcher("glob:${params["include"].asString}")
        val exclude = params["exclude"]?.asString?.let { FileSystems.getDefault().getPathMatcher("glob:$it") }
        val limit = params["limit"].asLong.coerceAtMost(MAXIMUM_FIND_FILES).toInt()
        val found = mutableListOf<String>()
        if (limit != 0) {
          ProjectRootManager.getInstance(project).fileIndex.iterateContent { file ->
            val root =
              ProjectRootManager.getInstance(project).contentRoots.firstOrNull {
                file.path.startsWith(it.path + "/")
              }
            if (!file.isDirectory && root != null && documents.inWorkspace(file)) {
              val path = root.toNioPath().relativize(file.toNioPath())
              if (include.matches(path) && exclude?.matches(path) != true) found.add(DocumentServices.uri(file))
            }
            found.size < limit
          }
        }
        jsonValue(found)
      }
      "workspace/openFolder" -> {
        require(TrustedProjects.isProjectTrusted(project)) { "MHP_UNTRUSTED_WORKSPACE" }
        val uri = URI(params["uri"].asString)
        require(uri.scheme == "file" && uri.authority.isNullOrEmpty()) { "MHP_PERMISSION_DENIED" }
        requireNotNull(ProjectUtil.openOrImport(Path.of(uri), project, params["newWindow"].asBoolean)) {
          "MHP_OPEN_FOLDER_FAILED"
        }
        jsonValue(null)
      }
      else -> error("MHP_METHOD_NOT_FOUND")
    }

  fun diagnostics(uri: String?): JsonElement {
    val candidates =
      if (uri ==
        null
      ) {
        FileEditorManager
          .getInstance(project)
          .openFiles
          .toList()
      } else {
        listOf(documents.document(uri).first)
      }
    val result = mutableListOf<JsonObject>()
    for (file in candidates.filter(documents::inWorkspace)) {
      val document =
        FileDocumentManager
          .getInstance()
          .getDocument(file) ?: continue
      DaemonCodeAnalyzerEx.processHighlights(
        document,
        project,
        HighlightSeverity.INFORMATION,
        0,
        document.textLength,
      ) { info ->
        val message = info.description
        if (message != null) {
          result.add(
            json(
              "uri" to DocumentServices.uri(file),
              "range" to DocumentServices.range(document, info.startOffset, info.endOffset),
              "severity" to
                when {
                  info.severity >= HighlightSeverity.ERROR -> "error"
                  info.severity >= HighlightSeverity.WARNING -> "warning"
                  else -> "information"
                },
              "message" to message,
            ),
          )
        }
        true
      }
    }
    return jsonValue(result)
  }

  private fun ui(
    method: String,
    params: JsonObject,
    cancellation: RequestCancellation,
  ): JsonElement =
    when (method) {
      "ui/notify" -> {
        notify(params["message"].asString, params["severity"].asString)
        jsonValue(null)
      }
      "ui/confirm" -> {
        val choices = params.getAsJsonArray("choices").map { it.asJsonObject }
        val buttons =
          choices
            .map {
              javax.swing.JButton(it["title"].asString).apply { putClientProperty("html.disable", true) }
            }.toTypedArray()
        val pane =
          JOptionPane(
            plainMessage(params["message"].asString),
            JOptionPane.QUESTION_MESSAGE,
            JOptionPane.DEFAULT_OPTION,
            null,
            buttons,
            null,
          )
        buttons.forEachIndexed {
          index,
          button,
          ->
          button.addActionListener { pane.value = choices[index]["id"].asString }
        }
        modal(pane, params["title"].asString, cancellation)
        choices.firstOrNull { it["id"].asString == pane.value }?.get("id") ?: jsonValue(null)
      }
      "ui/pick" -> pick(params, cancellation)
      "ui/input" -> input(params, cancellation)
      "ui/openExternal" -> {
        val target = URI(params["uri"].asString)
        require(target.scheme in setOf("http", "https")) { "MHP_PERMISSION_DENIED" }
        BrowserUtil.browse(target.toASCIIString())
        jsonValue(null)
      }
      "ui/clipboard" -> {
        CopyPasteManager.getInstance().setContents(StringSelection(params["text"].asString))
        jsonValue(null)
      }
      "ui/status" -> widgets.status(params)
      "ui/progress" -> widgets.progress(params)
      else -> error("MHP_METHOD_NOT_FOUND")
    }

  private fun pick(
    params: JsonObject,
    cancellation: RequestCancellation,
  ): JsonElement {
    val items = params.getAsJsonArray("items").map { it.asJsonObject }
    val list = JList(items.map { it["title"].asString }.toTypedArray())
    list.cellRenderer = javax.swing.DefaultListCellRenderer().apply { putClientProperty("html.disable", true) }
    list.selectionMode =
      if (params["multiple"].asBoolean) {
        ListSelectionModel.MULTIPLE_INTERVAL_SELECTION
      } else {
        ListSelectionModel.SINGLE_SELECTION
      }
    val pane = JOptionPane(JScrollPane(list), JOptionPane.PLAIN_MESSAGE, JOptionPane.OK_CANCEL_OPTION)
    modal(pane, params["title"].asString, cancellation)
    return if (pane.value == JOptionPane.OK_OPTION) {
      jsonValue(list.selectedIndices.map { items[it]["id"] })
    } else {
      jsonValue(null)
    }
  }

  private fun input(
    params: JsonObject,
    cancellation: RequestCancellation,
  ): JsonElement {
    val pane =
      JOptionPane(plainMessage(params["prompt"].asString), JOptionPane.QUESTION_MESSAGE, JOptionPane.OK_CANCEL_OPTION)
    pane.wantsInput = true
    pane.initialSelectionValue = params["value"]?.asString ?: ""
    modal(pane, params["title"].asString, cancellation)
    return jsonValue(if (pane.value == JOptionPane.OK_OPTION) pane.inputValue?.toString() else null)
  }

  private fun modal(
    pane: JOptionPane,
    title: String,
    cancellation: RequestCancellation,
  ) {
    val dialog = pane.createDialog(WindowManager.getInstance().getFrame(project), title)
    cancellation.onCancel { javax.swing.SwingUtilities.invokeLater { dialog.dispose() } }
    try {
      cancellation.check()
      dialog.isVisible = true
    } finally {
      dialog.dispose()
    }
    cancellation.check()
  }

  private fun notify(
    message: String,
    severity: String,
  ) {
    val type =
      when (severity) {
        "error" -> NotificationType.ERROR
        "warning" -> NotificationType.WARNING
        else -> NotificationType.INFORMATION
      }
    NotificationGroupManager
      .getInstance()
      .getNotificationGroup(
        NOTIFICATION_GROUP,
      ).createNotification(
        com.intellij.openapi.util.text.StringUtil
          .escapeXmlEntities(message),
        type,
      ).notify(project)
  }

  companion object {
    const val NOTIFICATION_GROUP = "Muse Spark Code (Unofficial)"
    private const val MAXIMUM_FIND_FILES = 10_000L
  }
}

private fun plainMessage(text: String): JScrollPane =
  JScrollPane(
    javax.swing.JTextArea(text).apply {
      isEditable = false
      lineWrap = true
      wrapStyleWord = true
      columns = MODAL_COLUMNS
      rows = lineCount.coerceAtMost(MODAL_ROWS)
    },
  )

private const val MODAL_COLUMNS = 64
private const val MODAL_ROWS = 12
