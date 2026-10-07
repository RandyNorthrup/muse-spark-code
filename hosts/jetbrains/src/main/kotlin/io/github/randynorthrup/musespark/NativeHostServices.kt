package io.github.randynorthrup.musespark

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerEx
import com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerImpl
import com.intellij.ide.BrowserUtil
import com.intellij.ide.impl.ProjectUtil
import com.intellij.ide.trustedProjects.TrustedProjects
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.editor.Document
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ProjectRootManager
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.WindowManager
import com.intellij.psi.PsiDocumentManager
import com.intellij.util.text.minimatch.Minimatch
import com.intellij.util.text.minimatch.MinimatchOptions
import java.awt.KeyboardFocusManager
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

interface EditorServices {
  val capabilities: List<String>

  val metadata: JsonObject? get() = null

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
  private val openBrowser: (String) -> Unit = BrowserUtil::browse,
  private val checkEpoch: () -> Unit = {},
  private val workspaceRoot: Path? = null,
  private val chooseFile: (
    open: Boolean,
    title: String,
    suggestedName: String?,
  ) -> Path? = { open, title, suggestedName ->
    systemFileDialog(project, open, title, suggestedName)
  },
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
      "tab",
    )
  val documents = DocumentServices(project) { TrustedProjects.isProjectTrusted(project) }

  override val metadata: JsonObject
    get() =
      json(
        "host" to
          json(
            "id" to "jetbrains",
            "version" to
              com.intellij.openapi.application.ApplicationInfo
                .getInstance()
                .build
                .asString(),
          ),
        "locale" to
          JetBrainsPanelHost.locale(
            java.util.Locale
              .getDefault()
              .toLanguageTag(),
          ),
        "theme" to json("kind" to if (NativeTheme.dark()) "dark" else "light", "tokens" to NativeTheme.tokens),
        "folders" to folders(),
        "trusted" to TrustedProjects.isProjectTrusted(project),
      )

  override fun request(
    method: String,
    params: JsonObject,
    cancellation: RequestCancellation,
  ): JsonElement {
    checkEpoch()
    cancellation.check()
    val checkCurrent = {
      checkEpoch()
      cancellation.check()
    }
    return when {
      method.startsWith("documents/") || method.startsWith("editor/") -> documents.request(method, params, checkCurrent)
      method.startsWith("surfaces/") -> surfaces(method, params)
      method.startsWith("workspace/") -> workspace(method, params)
      method.startsWith("ui/") -> ui(method, params, cancellation)
      method == "tab/register" -> {
        checkCurrent()
        project.getService(NativeTab::class.java).register(params)
        jsonValue(null)
      }
      method == "commands/register" -> widgets.register(params, checkCurrent)
      method == "commands/run" -> widgets.run(params, checkCurrent)
      method == "diagnostics/get" -> diagnostics(params["uri"]?.asString)
      method == "diagnostics/settled" -> settled(params, checkCurrent)
      method == "window/state" ->
        json("focused" to focused())
      method == "window/attention" -> {
        notify(params["message"].asString, "information")
        jsonValue(null)
      }
      else -> error("MHP_UNSUPPORTED_CAPABILITY")
    }
  }

  fun folders(): JsonElement {
    val root = workspaceRoot ?: Path.of(requireNotNull(project.basePath) { "MHP_WORKSPACE_UNAVAILABLE" })
    val uri = root.toUri().toASCIIString()
    return jsonValue(
      listOf(json("uri" to uri, "name" to root.fileName.toString())) +
        ProjectRootManager
          .getInstance(project)
          .contentRoots
          .filter {
            it.fileSystem.protocol == "file" &&
              DocumentServices.uri(it) != uri
          }.map {
            json("uri" to DocumentServices.uri(it), "name" to it.name)
          },
    )
  }

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
        val include = compileWorkspaceGlob(params["include"].asString)
        val exclude = params["exclude"]?.asString?.let(::compileWorkspaceGlob)
        val limit = params["limit"].asLong.coerceAtMost(MAXIMUM_FIND_FILES).toInt()
        val found = mutableListOf<String>()
        if (limit != 0) {
          ProjectRootManager.getInstance(project).fileIndex.iterateContent { file ->
            val root =
              ProjectRootManager.getInstance(project).contentRoots.firstOrNull {
                file.path.startsWith(it.path + "/")
              }
            if (!file.isDirectory && root != null && documents.inWorkspace(file)) {
              val path = root.toNioPath().relativize(file.toNioPath()).joinToString("/")
              if (include(path) && exclude?.invoke(path) != true) found.add(DocumentServices.uri(file))
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
        checkEpoch()
        requireNotNull(ProjectUtil.openOrImport(Path.of(uri), project, params["newWindow"].asBoolean)) {
          "MHP_OPEN_FOLDER_FAILED"
        }
        jsonValue(null)
      }
      else -> error("MHP_UNSUPPORTED_CAPABILITY")
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
      result.addAll(fileDiagnostics(file, document))
    }
    return jsonValue(result)
  }

  private fun fileDiagnostics(
    file: VirtualFile,
    document: Document,
  ): List<JsonObject> {
    val result = mutableListOf<JsonObject>()
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
    return result
  }

  private fun settled(
    params: JsonObject,
    checkCurrent: () -> Unit,
  ): JsonElement {
    checkCurrent()
    val uri = params["uri"].asString
    val expected = params["expectedVersion"].asLong
    val (file, document) = documents.document(uri)
    if (document.modificationStamp != expected) return jsonValue(null)
    val psi = PsiDocumentManager.getInstance(project).getPsiFile(document)
    val daemon = DaemonCodeAnalyzerImpl.getInstance(project)
    // The daemon's completion predicate checks committed PSI, the exact document
    // stamp and dirty analysis scopes; cached highlights alone attest none of these.
    return if (psi == null || daemon !is DaemonCodeAnalyzerImpl || !daemon.isAllAnalysisFinished(psi)) {
      jsonValue(null)
    } else {
      val diagnostics = fileDiagnostics(file, document)
      checkCurrent()
      if (document.modificationStamp != expected || !daemon.isAllAnalysisFinished(psi)) {
        jsonValue(null)
      } else {
        json(
          "uri" to DocumentServices.uri(file),
          "version" to expected,
          "diagnostics" to diagnostics,
        )
      }
    }
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
        checkEpoch()
        openBrowser(target.toASCIIString())
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

// Reuse the platform matcher; its brace expander is a stub in SDK 253.
// These bounds mirror GLOB_MAX_LENGTH / GLOB_MAX_ALTERNATIVES in shared constants.
private const val WORKSPACE_GLOB_LIMIT = 256

private fun compileWorkspaceGlob(pattern: String): (String) -> Boolean {
  require(pattern.length <= WORKSPACE_GLOB_LIMIT) { "MHP_INVALID_PARAMS" }
  val remaining = java.util.ArrayDeque<String>()
  remaining.add(pattern)
  val alternatives = mutableListOf<String>()
  while (remaining.isNotEmpty()) {
    val current = remaining.removeFirst()
    val expanded = expandWorkspaceBrace(current)
    if (expanded == null) alternatives.add(current) else remaining.addAll(expanded)
    require(remaining.size + alternatives.size <= WORKSPACE_GLOB_LIMIT) { "MHP_INVALID_PARAMS" }
  }
  val options = MinimatchOptions(dot = true, nonegate = true, nocomment = true, noext = true, nobrace = true)
  val matchers = alternatives.map { Minimatch(it, options) }
  return { path -> matchers.any { it.match(path) } }
}

private fun expandWorkspaceBrace(pattern: String): List<String>? {
  var open = -1
  var depth = 0
  var inClass = false
  val commas = mutableListOf<Int>()
  for ((index, char) in pattern.withIndex()) {
    if (char in "[]") inClass = char == '['
    if (inClass) continue
    when (char) {
      '{' -> {
        if (depth == 0) open = index
        depth++
      }
      ',' -> if (depth == 1) commas.add(index)
      '}' -> if (depth > 0) depth--
    }
    if (char == '}' && depth == 0 && commas.isNotEmpty()) {
      val edges = listOf(open) + commas + index
      return edges.zipWithNext { start, end ->
        pattern.substring(0, open) + pattern.substring(start + 1, end) + pattern.substring(index + 1)
      }
    }
  }
  return null
}
