package io.github.randynorthrup.musespark

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.WindowManager
import java.awt.datatransfer.StringSelection
import java.io.File
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import javax.swing.JFileChooser
import javax.swing.JList
import javax.swing.JOptionPane
import javax.swing.JScrollPane
import javax.swing.ListSelectionModel

internal class NativeUiServices(
  private val project: Project,
  private val widgets: NativeWidgets,
  private val options: NativeHostOptions,
) {
  private val checkEpoch = options.checkEpoch
  private val chooseFile =
    options.chooseFile ?: { open, title, suggestedName ->
      systemFileDialog(project, open, title, suggestedName)
    }

  fun request(
    method: String,
    params: JsonObject,
    cancellation: RequestCancellation,
  ): JsonElement =
    when (method) {
      "ui/notify" -> {
        notify(params["message"].asString, params["severity"].asString)
        jsonValue(null)
      }
      "ui/confirm" -> confirm(params, cancellation)
      "ui/pick" -> pick(params, cancellation)
      "ui/input" -> input(params, cancellation)
      "ui/openExternal" -> {
        val target = URI(params["uri"].asString)
        require(target.scheme in setOf("http", "https")) { "MHP_PERMISSION_DENIED" }
        checkEpoch()
        options.openBrowser(target.toASCIIString())
        jsonValue(null)
      }
      "ui/clipboard" -> {
        checkEpoch()
        CopyPasteManager.getInstance().setContents(StringSelection(params["text"].asString))
        jsonValue(null)
      }
      "ui/status" -> widgets.status(params, checkEpoch)
      "ui/progress" -> widgets.progress(params, checkEpoch)
      "ui/openFile" -> openFile(params, cancellation)
      "ui/saveText" -> saveFile(params, cancellation, checkEpoch)
      "ui/showSetting" -> showSetting(cancellation, checkEpoch)
      else -> error("MHP_UNSUPPORTED_CAPABILITY")
    }

  private fun confirm(
    params: JsonObject,
    cancellation: RequestCancellation,
  ): JsonElement {
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
    return choices.firstOrNull { it["id"].asString == pane.value }?.get("id") ?: jsonValue(null)
  }

  private fun openFile(
    params: JsonObject,
    cancellation: RequestCancellation,
  ): JsonElement {
    cancellation.check()
    val picked = chooseFile(true, params["title"].asString, null)?.toUri()?.toASCIIString()
    cancellation.check()
    return jsonValue(picked)
  }

  private fun saveFile(
    params: JsonObject,
    cancellation: RequestCancellation,
    checkCurrent: () -> Unit,
  ): JsonElement {
    cancellation.check()
    val target = chooseFile(false, params["title"].asString, params["suggestedName"].asString)
    if (target == null) return jsonValue(false)
    cancellation.check()
    checkCurrent()
    runCatching { Files.writeString(target, params["text"].asString) }.getOrThrow()
    return jsonValue(true)
  }

  private fun showSetting(
    cancellation: RequestCancellation,
    checkCurrent: () -> Unit,
  ): JsonElement {
    checkCurrent()
    cancellation.check()
    // The IDE's generic settings dialog cannot edit the runtime's requested key.
    error("MHP_UNSUPPORTED_CAPABILITY")
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
      checkEpoch()
      cancellation.check()
      dialog.isVisible = true
    } finally {
      dialog.dispose()
    }
    checkEpoch()
    cancellation.check()
  }

  fun notify(
    message: String,
    severity: String,
  ) {
    val type =
      when (severity) {
        "error" -> NotificationType.ERROR
        "warning" -> NotificationType.WARNING
        else -> NotificationType.INFORMATION
      }
    checkEpoch()
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
    private const val NOTIFICATION_GROUP = "Muse Spark Code (Unofficial)"
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

private fun systemFileDialog(
  project: Project,
  open: Boolean,
  title: String,
  suggestedName: String?,
): Path? {
  val chooser =
    JFileChooser().apply {
      dialogTitle = title
      if (open) {
        fileSelectionMode = JFileChooser.FILES_ONLY
      } else {
        selectedFile = File(suggestedName ?: "")
      }
    }
  val frame = WindowManager.getInstance().getFrame(project)
  val approved =
    if (open) {
      chooser.showOpenDialog(frame) == JFileChooser.APPROVE_OPTION
    } else {
      chooser.showSaveDialog(frame) == JFileChooser.APPROVE_OPTION
    }
  return if (approved) chooser.selectedFile?.toPath() else null
}
