package io.github.randynorthrup.musespark

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerEx
import com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerImpl
import com.intellij.ide.BrowserUtil
import com.intellij.ide.impl.ProjectUtil
import com.intellij.ide.trustedProjects.TrustedProjects
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.openapi.editor.Document
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ProjectRootManager
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.WindowManager
import com.intellij.psi.PsiDocumentManager
import com.intellij.util.text.minimatch.Minimatch
import com.intellij.util.text.minimatch.MinimatchOptions
import java.awt.KeyboardFocusManager
import java.net.URI
import java.nio.file.Path

interface EditorServices {
  val capabilities: List<String>

  val metadata: JsonObject? get() = null

  fun request(
    method: String,
    params: JsonObject,
    cancellation: RequestCancellation,
  ): JsonElement
}

data class NativeHostOptions(
  val openBrowser: (String) -> Unit = BrowserUtil::browse,
  val checkEpoch: () -> Unit = {},
  val workspaceRoot: Path? = null,
  val chooseFile: ((Boolean, String, String?) -> Path?)? = null,
)

class NativeHostServices(
  private val project: Project,
  private val surfaces: (String, JsonObject) -> JsonElement,
  widgets: NativeWidgets,
  options: NativeHostOptions = NativeHostOptions(),
) : EditorServices {
  private val widgets = widgets
  private val checkEpoch = options.checkEpoch
  private val workspaceRoot = options.workspaceRoot
  private val ui = NativeUiServices(project, widgets, options)
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
      method.startsWith("ui/") -> ui.request(method, params, cancellation)
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
        ui.notify(params["message"].asString, "information")
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

  companion object {
    private const val MAXIMUM_FIND_FILES = 10_000L
  }
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
