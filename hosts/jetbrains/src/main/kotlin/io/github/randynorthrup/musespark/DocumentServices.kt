package io.github.randynorthrup.musespark

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.Document
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ProjectRootManager
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import java.net.URI
import java.nio.file.Path

class DocumentServices(
  private val project: Project,
  private val trusted: () -> Boolean,
) {
  private val documents get() = FileDocumentManager.getInstance()

  fun request(
    method: String,
    params: JsonObject,
    checkCurrent: () -> Unit = {},
  ): JsonElement =
    when (method) {
      "documents/list" ->
        jsonValue(
          (
            FileEditorManager.getInstance(project).openFiles.mapNotNull(documents::getDocument) +
              documents.unsavedDocuments
          ).distinct().mapNotNull { document ->
            documents.getFile(document)?.takeIf(::inWorkspace)?.let { snapshot(it, document) }
          },
        )
      "documents/read" -> {
        val (file, document) = document(params["uri"].asString)
        json("document" to snapshot(file, document), "text" to document.text)
      }
      "documents/applyEdits" -> apply(params, checkCurrent)
      "documents/save" -> save(params, checkCurrent)
      "documents/saveAll" -> {
        require(trusted()) { "MHP_UNTRUSTED_WORKSPACE" }
        // Do not save another project's buffers.
        val ours = documents.unsavedDocuments.filter { documents.getFile(it)?.let(::inWorkspace) == true }
        ours.forEach {
          checkCurrent()
          documents.saveDocument(it)
        }
        json("saved" to ours.none(documents::isDocumentUnsaved))
      }
      "editor/active" -> active()
      "editor/open" -> open(params, checkCurrent)
      "editor/insertAtCursor", "editor/replaceSelection" -> {
        val range =
          if (params.has("range")) {
            params["range"]
          } else {
            json("start" to params["position"], "end" to params["position"])
          }
        apply(
          json(
            "uri" to params["uri"],
            "expectedVersion" to params["expectedVersion"],
            "undoLabel" to params["undoLabel"],
            "edits" to listOf(json("range" to range, "newText" to params["text"])),
          ),
          checkCurrent,
        )
      }
      else -> error("MHP_METHOD_NOT_FOUND")
    }

  private fun save(
    params: JsonObject,
    checkCurrent: () -> Unit,
  ): JsonElement {
    val (file, document) = document(params["uri"].asString)
    require(trusted()) { "MHP_UNTRUSTED_WORKSPACE" }
    require(file.isWritable) { "MHP_PERMISSION_DENIED" }
    require(document.modificationStamp == params["expectedVersion"].asLong) { "MHP_VERSION_CONFLICT" }
    checkCurrent()
    documents.saveDocument(document)
    require(!documents.isDocumentUnsaved(document)) { "MHP_SAVE_FAILED" }
    return snapshot(file, document)
  }

  private fun open(
    params: JsonObject,
    checkCurrent: () -> Unit,
  ): JsonElement {
    val (file, document) = document(params["uri"].asString)
    val range = params["range"]?.asJsonObject
    val start = range?.getAsJsonObject("start")?.let { offset(document, it) } ?: 0
    val end = range?.getAsJsonObject("end")?.let { offset(document, it) } ?: start
    require(start <= end) { "MHP_INVALID_RANGE" }
    checkCurrent()
    val editor =
      requireNotNull(
        FileEditorManager.getInstance(project).openTextEditor(OpenFileDescriptor(project, file, start), true),
      ) {
        "MHP_EDITOR_UNAVAILABLE"
      }
    if (range != null) {
      checkCurrent()
      editor.selectionModel.setSelection(start, end)
    }
    return jsonValue(null)
  }

  fun active(): JsonElement {
    val active =
      FileEditorManager.getInstance(project).selectedTextEditor?.let { editor ->
        documents.getFile(editor.document)?.takeIf(::inWorkspace)?.let { file -> editor to file }
      } ?: return jsonValue(null)
    val (editor, file) = active
    val selection = editor.selectionModel
    val start = if (selection.hasSelection()) selection.selectionStart else editor.caretModel.offset
    val end = if (selection.hasSelection()) selection.selectionEnd else start
    val excerpt = editor.document.text.substring(start, end)
    return json(
      "uri" to uri(file),
      "version" to editor.document.modificationStamp,
      "range" to range(editor.document, start, end),
      "excerpt" to excerpt.take(MAXIMUM_SELECTION_CHARS),
      "truncated" to (excerpt.length > MAXIMUM_SELECTION_CHARS),
    )
  }

  fun snapshot(
    file: VirtualFile,
    document: Document,
  ): JsonObject =
    json(
      "uri" to uri(file),
      "version" to document.modificationStamp,
      "dirty" to documents.isDocumentUnsaved(document),
      "languageId" to file.fileType.name.lowercase(),
    )

  fun document(value: String): Pair<VirtualFile, Document> {
    val uri = URI(value)
    require(uri.scheme == "file" && uri.authority.isNullOrEmpty()) { "MHP_PERMISSION_DENIED" }
    val path = Path.of(uri).toRealPath()
    val file =
      requireNotNull(LocalFileSystem.getInstance().refreshAndFindFileByNioFile(path)) { "MHP_DOCUMENT_NOT_FOUND" }
    require(inWorkspace(file)) { "MHP_PERMISSION_DENIED" }
    return file to requireNotNull(documents.getDocument(file)) { "MHP_DOCUMENT_NOT_FOUND" }
  }

  fun inWorkspace(file: VirtualFile): Boolean =
    runCatching {
      val path = file.toNioPath().toRealPath()
      ProjectRootManager.getInstance(project).contentRoots.any { root ->
        runCatching { path.startsWith(root.toNioPath().toRealPath()) }.getOrDefault(false)
      }
    }.getOrDefault(false)

  private data class Edit(
    val start: Int,
    val end: Int,
    val text: String,
  )

  private fun apply(
    params: JsonObject,
    checkCurrent: () -> Unit,
  ): JsonObject {
    val (file, document) = document(params["uri"].asString)
    require(trusted()) { "MHP_UNTRUSTED_WORKSPACE" }
    require(file.isWritable) { "MHP_PERMISSION_DENIED" }
    val edits =
      params
        .getAsJsonArray("edits")
        .map { value ->
          val edit = value.asJsonObject
          val range = edit.getAsJsonObject("range")
          Edit(
            offset(document, range.getAsJsonObject("start")),
            offset(document, range.getAsJsonObject("end")),
            edit["newText"].asString,
          )
        }.sortedWith(compareBy<Edit> { it.start }.thenBy { it.end })
    require(edits.all { it.start <= it.end }) { "MHP_INVALID_RANGE" }
    require(
      edits.zipWithNext().all { (left, right) ->
        left.end <= right.start && !(left.start == left.end && left.start == right.start)
      },
    ) { "MHP_OVERLAPPING_EDITS" }
    WriteCommandAction.runWriteCommandAction(
      project,
      params["undoLabel"].asString,
      null,
      Runnable {
        checkCurrent()
        require(document.modificationStamp == params["expectedVersion"].asLong) { "MHP_VERSION_CONFLICT" }
        require(!documents.isDocumentUnsaved(document)) { "MHP_DIRTY_BUFFER" }
        for (edit in edits.asReversed()) {
          checkCurrent()
          document.replaceString(edit.start, edit.end, edit.text)
        }
      },
    )
    return snapshot(file, document)
  }

  companion object {
    private const val MAXIMUM_SELECTION_CHARS = 16_384

    fun uri(file: VirtualFile): String = file.toNioPath().toUri().toASCIIString()

    fun offset(
      document: Document,
      position: JsonObject,
    ): Int {
      val line = checkedCoordinate(position["line"])
      val character = checkedCoordinate(position["character"])
      require(line >= 0 && line < document.lineCount) { "MHP_INVALID_RANGE" }
      val start = document.getLineStartOffset(line)
      require(character >= 0 && character <= document.getLineEndOffset(line) - start) { "MHP_INVALID_RANGE" }
      return start + character
    }

    private fun checkedCoordinate(value: JsonElement): Int {
      val number = value.asBigDecimal
      require(
        number >= java.math.BigDecimal.ZERO && number <= Int.MAX_VALUE.toBigDecimal() &&
          number.stripTrailingZeros().scale() <= 0,
      ) { "MHP_INVALID_RANGE" }
      return number.intValueExact()
    }

    fun position(
      document: Document,
      offset: Int,
    ): JsonObject {
      val line = document.getLineNumber(offset)
      return json("line" to line, "character" to offset - document.getLineStartOffset(line))
    }

    fun range(
      document: Document,
      start: Int,
      end: Int,
    ): JsonObject = json("start" to position(document, start), "end" to position(document, end))
  }
}
