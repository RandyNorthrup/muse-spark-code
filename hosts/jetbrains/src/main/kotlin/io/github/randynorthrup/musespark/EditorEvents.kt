package io.github.randynorthrup.musespark

import com.intellij.codeInsight.daemon.DaemonCodeAnalyzer
import com.intellij.openapi.Disposable
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.event.CaretEvent
import com.intellij.openapi.editor.event.CaretListener
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.editor.event.SelectionEvent
import com.intellij.openapi.editor.event.SelectionListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileDocumentManagerListener
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

fun installEditorEvents(
  project: Project,
  services: NativeHostServices,
  connection: MhpPeer,
  parent: Disposable,
) {
  val events = EditorFactory.getInstance().eventMulticaster
  val files = FileDocumentManager.getInstance()
  val bus = project.messageBus.connect(parent)

  fun notify(
    method: String,
    params: com.google.gson.JsonObject,
  ) {
    runCatching { connection.notify(method, params) }
  }

  fun selection() = notify("editor/didChangeSelection", json("selection" to services.documents.active()))
  events.addDocumentListener(
    object : DocumentListener {
      override fun documentChanged(event: DocumentEvent) {
        val file = files.getFile(event.document) ?: return
        if (services.documents.inWorkspace(file)) {
          notify(
            "documents/didChange",
            json("document" to services.documents.snapshot(file, event.document), "text" to event.document.text),
          )
        }
      }
    },
    parent,
  )
  events.addCaretListener(
    object : CaretListener {
      override fun caretPositionChanged(event: CaretEvent) {
        if (event.editor.project == project) selection()
      }
    },
    parent,
  )
  events.addSelectionListener(
    object : SelectionListener {
      override fun selectionChanged(event: SelectionEvent) {
        if (event.editor.project == project) selection()
      }
    },
    parent,
  )
  bus.subscribe(
    FileEditorManagerListener.FILE_EDITOR_MANAGER,
    object : FileEditorManagerListener {
      override fun selectionChanged(event: FileEditorManagerEvent) = selection()

      override fun fileClosed(
        source: FileEditorManager,
        file: VirtualFile,
      ) {
        if (services.documents.inWorkspace(file)) {
          notify(
            "documents/didClose",
            json("uri" to DocumentServices.uri(file)),
          )
        }
      }
    },
  )
  // File-document events are application-wide, not on the project's bus.
  com.intellij.openapi.application.ApplicationManager
    .getApplication()
    .messageBus
    .connect(parent)
    .subscribe(
      FileDocumentManagerListener.TOPIC,
      object : FileDocumentManagerListener {
        override fun afterDocumentSaved(document: com.intellij.openapi.editor.Document) {
          val file = files.getFile(document) ?: return
          if (services.documents.inWorkspace(
              file,
            )
          ) {
            notify("documents/didSave", services.documents.snapshot(file, document))
          }
        }
      },
    )
  bus.subscribe(
    DaemonCodeAnalyzer.DAEMON_EVENT_TOPIC,
    object : DaemonCodeAnalyzer.DaemonListener {
      override fun daemonFinished() {
        FileEditorManager.getInstance(project).openFiles.filter(services.documents::inWorkspace).forEach { file ->
          val uri = DocumentServices.uri(file)
          notify("diagnostics/didChange", json("uri" to uri, "diagnostics" to services.diagnostics(uri)))
        }
      }
    },
  )
  // Trust has no stable public listener on the oldest supported platform.
  val trusted =
    java.util.concurrent.atomic.AtomicBoolean(
      com.intellij.ide.trustedProjects.TrustedProjects
        .isProjectTrusted(project),
    )
  val poll =
    com.intellij.util.concurrency.AppExecutorUtil.getAppScheduledExecutorService().scheduleWithFixedDelay({
      if (!project.isDisposed) {
        val current =
          com.intellij.ide.trustedProjects.TrustedProjects
            .isProjectTrusted(project)
        if (current && !trusted.getAndSet(current)) notify("workspace/didGrantTrust", json("trusted" to true))
        if (!current) trusted.set(false)
      }
    }, 1, 1, java.util.concurrent.TimeUnit.SECONDS)
  com.intellij.openapi.util.Disposer
    .register(parent) { poll.cancel(false) }
}
