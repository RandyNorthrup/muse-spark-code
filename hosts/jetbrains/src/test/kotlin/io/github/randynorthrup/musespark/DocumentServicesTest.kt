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

  fun testRefusesDirtyAndStaleBuffersBeforeAnySideEffect() {
    val (services, file) = prepare()
    val document = myFixture.editor.document
    val uri = DocumentServices.uri(file)
    assertThrows(Exception::class.java) {
      services.request(
        "documents/applyEdits",
        edit(
          uri,
          document.modificationStamp + 1,
        ),
      )
    }
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
    assertThrows(Exception::class.java) {
      services.request("documents/applyEdits", edit(uri, document.modificationStamp, 5, 0))
    }
    assertThrows(Exception::class.java) {
      services.request("documents/applyEdits", edit(uri, document.modificationStamp, 0, 100))
    }
    assertEquals(original, document.text)
    services.request("documents/applyEdits", edit(uri, document.modificationStamp))
    assertEquals("changed\nbeta\n", document.text)
    val editor = FileEditorManager.getInstance(project).selectedEditor
    assertTrue(UndoManager.getInstance(project).isUndoAvailable(editor))
    UndoManager.getInstance(project).undo(editor)
    assertEquals(original, document.text)
  }
}
