package io.github.randynorthrup.musespark

import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.command.undo.UndoManager
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import org.junit.Assert.assertThrows

class DocumentServicesTest : BasePlatformTestCase() {
  override fun createTempDirTestFixture(): com.intellij.testFramework.fixtures.TempDirTestFixture =
    com.intellij.testFramework.fixtures.impl
      .TempDirTestFixtureImpl()

  private fun prepare(): Pair<DocumentServices, com.intellij.openapi.vfs.VirtualFile> {
    val file = myFixture.addFileToProject("guard.txt", "alpha\nbeta\n").virtualFile
    com.intellij.testFramework.PsiTestUtil
      .addContentRoot(module, file.parent)
    myFixture.configureFromExistingVirtualFile(file)
    FileDocumentManager.getInstance().saveAllDocuments()
    return DocumentServices(project) { true } to file
  }

  fun testWireIntegersCannotWrapIntoValidEditCoordinates() {
    val document =
      com.intellij.openapi.editor.EditorFactory
        .getInstance()
        .createDocument("alpha")
    for (value in listOf(4294967296L, 9007199254740991L, -1L)) {
      for (position in listOf(json("line" to value, "character" to 0), json("line" to 0, "character" to value))) {
        assertEquals(
          "MHP_INVALID_RANGE",
          org.junit.Assert
            .assertThrows(IllegalArgumentException::class.java) {
              DocumentServices.offset(document, position)
            }.message,
        )
      }
    }
    assertEquals("alpha", document.text)
  }

  private fun edit(
    uri: String,
    version: Long,
    start: Int = 0,
    end: Int = 5,
  ) = json(
    "uri" to uri,
    "expectedVersion" to version,
    "undoLabel" to "Fixture edit",
    "edits" to
      listOf(
        json(
          "range" to
            json(
              "start" to json("line" to 0, "character" to start),
              "end" to json("line" to 0, "character" to end),
            ),
          "newText" to "changed",
        ),
      ),
  )

  fun testRetiredEpochCannotEditAfterWriteCommandStarts() {
    val (services, file) = prepare()
    val document = myFixture.editor.document
    var current = true
    val connection = project.messageBus.connect()
    connection.subscribe(
      com.intellij.openapi.command.CommandListener.TOPIC,
      object : com.intellij.openapi.command.CommandListener {
        override fun commandStarted(event: com.intellij.openapi.command.CommandEvent) {
          if (event.commandName == "Fixture edit") current = false
        }
      },
    )
    try {
      val failure =
        org.junit.Assert.assertThrows(Exception::class.java) {
          services.request("documents/applyEdits", edit(DocumentServices.uri(file), document.modificationStamp)) {
            check(current) { "MHP_TRANSPORT_CLOSED" }
          }
        }
      assertEquals("MHP_TRANSPORT_CLOSED", failure.message)
      assertEquals("alpha\nbeta\n", document.text)
    } finally {
      connection.disconnect()
    }
  }

  fun testEpochIsRecheckedBeforeEachEditWhenADocumentListenerRetiresIt() {
    val (services, file) = prepare()
    val document = myFixture.editor.document
    var current = true
    document.addDocumentListener(
      object : com.intellij.openapi.editor.event.DocumentListener {
        override fun documentChanged(event: com.intellij.openapi.editor.event.DocumentEvent) {
          current = false
        }
      },
      testRootDisposable,
    )
    val params = edit(DocumentServices.uri(file), document.modificationStamp, 0, 1)
    params.getAsJsonArray("edits").add(
      edit(DocumentServices.uri(file), document.modificationStamp, 4, 5)
        .getAsJsonArray("edits")[0],
    )
    val failure =
      org.junit.Assert.assertThrows(Exception::class.java) {
        services.request("documents/applyEdits", params) { check(current) { "MHP_TRANSPORT_CLOSED" } }
      }
    assertEquals("MHP_TRANSPORT_CLOSED", failure.message)
    assertEquals("alphchanged\nbeta\n", document.text)
  }

  fun testRefusesDirtyAndStaleBuffersBeforeAnySideEffect() {
    val (services, file) = prepare()
    val document = myFixture.editor.document
    val uri = DocumentServices.uri(file)
    assertEquals(
      "MHP_VERSION_CONFLICT",
      org.junit.Assert
        .assertThrows(Exception::class.java) {
          services.request("documents/applyEdits", edit(uri, document.modificationStamp + 1))
        }.message,
    )
    WriteCommandAction.runWriteCommandAction(project) { document.insertString(0, "unsaved ") }
    val before = document.text
    assertThrows(
      Exception::class.java,
    ) { services.request("documents/applyEdits", edit(uri, document.modificationStamp)) }
    assertEquals(before, document.text)
    assertEquals(before, services.request("documents/read", json("uri" to uri)).asJsonObject["text"].asString)
  }

  fun testAppliesEditsWithExactlyOneUndoAndValidatesAllRanges() {
    val (services, file) = prepare()
    val document = myFixture.editor.document
    val uri = DocumentServices.uri(file)
    val original = document.text
    assertEquals(
      "MHP_INVALID_RANGE",
      org.junit.Assert
        .assertThrows(Exception::class.java) {
          services.request("documents/applyEdits", edit(uri, document.modificationStamp, 5, 0))
        }.message,
    )
    assertEquals(
      "MHP_INVALID_RANGE",
      org.junit.Assert
        .assertThrows(Exception::class.java) {
          services.request("documents/applyEdits", edit(uri, document.modificationStamp, 0, 100))
        }.message,
    )
    assertEquals(original, document.text)
    services.request("documents/applyEdits", edit(uri, document.modificationStamp))
    assertEquals("changed\nbeta\n", document.text)
    val editor = FileEditorManager.getInstance(project).selectedEditor
    assertTrue(UndoManager.getInstance(project).isUndoAvailable(editor))
    UndoManager.getInstance(project).undo(editor)
    assertEquals(original, document.text)
  }

  fun testRefusesUntrustedOutsideWorkspaceAndOverlappingEdits() {
    val (services, file) = prepare()
    val document = myFixture.editor.document
    val params = edit(DocumentServices.uri(file), document.modificationStamp)
    val untrusted = DocumentServices(project) { false }
    assertEquals(
      "MHP_UNTRUSTED_WORKSPACE",
      org.junit.Assert
        .assertThrows(Exception::class.java) {
          untrusted.request("documents/applyEdits", params)
        }.message,
    )
    val edits = params.getAsJsonArray("edits")
    edits.add(edits[0].deepCopy())
    assertEquals(
      "MHP_OVERLAPPING_EDITS",
      org.junit.Assert
        .assertThrows(Exception::class.java) {
          services.request("documents/applyEdits", params)
        }.message,
    )
    val outside =
      java.nio.file.Files
        .createTempFile(
          java.nio.file.Path
            .of("build"),
          "outside-",
          ".txt",
        )
    try {
      assertEquals(
        "MHP_PERMISSION_DENIED",
        org.junit.Assert
          .assertThrows(Exception::class.java) {
            services.request("documents/read", json("uri" to outside.toAbsolutePath().toUri().toASCIIString()))
          }.message,
      )
    } finally {
      java.nio.file.Files
        .delete(outside)
    }
    assertEquals("alpha\nbeta\n", document.text)
  }

  fun testOpensAndSelectsTheWholeUtf16RangeAndRefusesReversedRanges() {
    val (services, file) = prepare()
    val params =
      json(
        "uri" to DocumentServices.uri(file),
        "range" to DocumentServices.range(myFixture.editor.document, 1, 5),
      )
    services.request("editor/open", params)
    assertEquals("lpha", myFixture.editor.selectionModel.selectedText)
    params.add("range", DocumentServices.range(myFixture.editor.document, 5, 1))
    assertEquals(
      "MHP_INVALID_RANGE",
      org.junit.Assert
        .assertThrows(Exception::class.java) {
          services.request("editor/open", params)
        }.message,
    )
  }

  fun testReportsReadOnlyAndVetoedSavesAsFailures() {
    val (services, file) = prepare()
    val document = myFixture.editor.document
    val scope =
      com.intellij.openapi.util.Disposer
        .newDisposable()
    try {
      WriteCommandAction.runWriteCommandAction(project) { file.isWritable = false }
      assertEquals(
        "MHP_PERMISSION_DENIED",
        org.junit.Assert
          .assertThrows(Exception::class.java) {
            services.request(
              "documents/save",
              json(
                "uri" to DocumentServices.uri(file),
                "expectedVersion" to document.modificationStamp,
              ),
            )
          }.message,
      )
      WriteCommandAction.runWriteCommandAction(project) { file.isWritable = true }
      WriteCommandAction.runWriteCommandAction(project) { document.insertString(0, "pending ") }
      com.intellij.openapi.fileEditor.FileDocumentSynchronizationVetoer.EP_NAME.point.registerExtension(
        object : com.intellij.openapi.fileEditor.FileDocumentSynchronizationVetoer() {
          override fun maySaveDocument(
            document: com.intellij.openapi.editor.Document,
            isSaveExplicit: Boolean,
          ) = false
        },
        scope,
      )
      assertEquals(
        "MHP_SAVE_FAILED",
        org.junit.Assert
          .assertThrows(Exception::class.java) {
            services.request(
              "documents/save",
              json(
                "uri" to DocumentServices.uri(file),
                "expectedVersion" to document.modificationStamp,
              ),
            )
          }.message,
      )
      assertEquals("pending alpha\nbeta\n", document.text)
    } finally {
      com.intellij.openapi.util.Disposer
        .dispose(scope)
      WriteCommandAction.runWriteCommandAction(project) { file.isWritable = true }
      FileDocumentManager.getInstance().saveDocument(document)
    }
  }
}
