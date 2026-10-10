package io.github.randynorthrup.musespark

import com.google.gson.JsonObject
import com.intellij.codeHighlighting.Pass
import com.intellij.codeInsight.daemon.DaemonCodeAnalyzer
import com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerEx
import com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerImpl
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.util.Disposer
import com.intellij.psi.PsiDocumentManager
import com.intellij.testFramework.PlatformTestUtil
import com.intellij.testFramework.PsiTestUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.GraphicsEnvironment
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean
import javax.swing.JFrame

class NativeHostServicesTest : BasePlatformTestCase() {
  override fun createTempDirTestFixture(): com.intellij.testFramework.fixtures.TempDirTestFixture =
    com.intellij.testFramework.fixtures.impl
      .TempDirTestFixtureImpl()

  private fun services(): NativeHostServices {
    val widgets = NativeWidgets(project, JsonBoundary()) {}
    Disposer.register(testRootDisposable, widgets)
    return NativeHostServices(project, { _, _ -> error("fixture-unused") }, widgets)
  }

  fun testWorkspaceGlobsIncludeRootNestedAndHiddenFilesAndApplyExclusionsAtEveryDepth() {
    val paths = listOf("main.ts", "src/main.ts", "src/deep/more.kt", ".hidden.ts", "secret.txt", "src/secret.txt")
    val files = paths.associateWith { myFixture.addFileToProject(it, "fixture").virtualFile }
    PsiTestUtil.addContentRoot(module, requireNotNull(files["main.ts"]).parent)
    val services = services()

    fun find(
      include: String,
      exclude: String? = null,
      limit: Int = 100,
    ): Set<String> {
      val params = json("include" to include, "limit" to limit)
      exclude?.let { params.addProperty("exclude", it) }
      return services
        .request(
          "workspace/findFiles",
          params,
          RequestCancellation(),
        ).asJsonArray
        .map { it.asString }
        .toSet()
    }

    fun uris(vararg names: String) = names.map { DocumentServices.uri(requireNotNull(files[it])) }.toSet()
    assertEquals(uris("main.ts", "src/main.ts", ".hidden.ts"), find("**/*.ts"))
    assertEquals(uris(*paths.toTypedArray()), find("**/*"))
    assertEquals(uris("main.ts", "src/main.ts", "src/deep/more.kt", ".hidden.ts"), find("**/*", "**/secret.txt"))
    assertEquals(uris("main.ts", ".hidden.ts"), find("**/*.ts", "src/**"))
    assertEquals(uris("main.ts", "src/main.ts", "src/deep/more.kt", ".hidden.ts"), find("**/*.{ts,kt}"))
    assertEquals(uris("main.ts", "src/main.ts"), find("**/[m]*.ts"))
    assertEquals(uris("main.ts", ".hidden.ts"), find("*.ts"))
    assertEquals(emptySet<String>(), find("**/*", limit = 0))
    assertEquals(1, find("**/*", limit = 1).size)
  }

  fun testWorkspaceGlobLimitsRejectOversizedOrExplosivePatterns() {
    val services = services()
    for (pattern in listOf("x".repeat(257), "{a,b}".repeat(9))) {
      assertEquals(
        "MHP_INVALID_PARAMS",
        org.junit.Assert
          .assertThrows(Exception::class.java) {
            services.request("workspace/findFiles", json("include" to pattern, "limit" to 1), RequestCancellation())
          }.message,
      )
    }
  }

  private fun showDiagnosticEditor() {
    if (GraphicsEnvironment.isHeadless()) return
    val editor = requireNotNull(FileEditorManager.getInstance(project).getSelectedEditor(myFixture.file.virtualFile))
    // Native daemon passes apply and clear their scopes only on a showing editor.
    val frame =
      JFrame("Native diagnostics fixture").apply {
        add(editor.component)
        setSize(640, 480)
        isVisible = true
      }
    Disposer.register(testRootDisposable) { frame.dispose() }
    assertTrue(editor.component.isShowing)
  }

  private fun completeHighlighting() {
    PsiDocumentManager.getInstance(project).commitAllDocuments()
    val editor = requireNotNull(FileEditorManager.getInstance(project).getSelectedEditor(myFixture.file.virtualFile))
    require(editor is TextEditor)
    val version = editor.editor.document.modificationStamp
    val completed = AtomicBoolean()
    val connection = project.messageBus.connect()
    connection.subscribe(
      DaemonCodeAnalyzer.DAEMON_EVENT_TOPIC,
      object : DaemonCodeAnalyzer.DaemonListener {
        override fun daemonFinished(fileEditors: Collection<FileEditor>) {
          if (editor in fileEditors && editor.editor.document.modificationStamp == version) {
            completed.set(DaemonCodeAnalyzerEx.isHighlightingCompleted(editor, project))
          }
        }
      },
    )
    val daemon = DaemonCodeAnalyzer.getInstance(project)
    try {
      if (GraphicsEnvironment.isHeadless()) {
        // Headless unit tests have no active editor for the timer's editor tracker.
        require(daemon is DaemonCodeAnalyzerImpl)
        daemon.runPasses(myFixture.file, editor.editor.document, editor, intArrayOf(), false, null)
      } else {
        daemon.setUpdateByTimerEnabled(true)
        daemon.restart(myFixture.file, "Native diagnostics fixture")
      }
      PlatformTestUtil.waitWithEventsDispatching(
        "Diagnostic daemon did not finish",
        { completed.get() },
        DAEMON_WAIT_SECONDS,
      )
      assertEquals(version, myFixture.file.viewProvider.modificationStamp)
      assertTrue(DaemonCodeAnalyzerEx.isHighlightingCompleted(editor, project))
    } finally {
      daemon.setUpdateByTimerEnabled(false)
      connection.disconnect()
    }
  }

  private fun brokenXml(): NativeHostServices {
    val file = myFixture.addFileToProject("diagnostics.xml", "<root><child></root>").virtualFile
    PsiTestUtil.addContentRoot(module, file.parent)
    myFixture.configureFromExistingVirtualFile(file)
    showDiagnosticEditor()
    completeHighlighting()
    // Drain fixture/VFS events before the SDK's non-cancellable highlighting check.
    com.intellij.testFramework.PlatformTestUtil
      .dispatchAllEventsInIdeEventQueue()
    assertTrue(myFixture.doHighlighting().any { it.severity >= com.intellij.lang.annotation.HighlightSeverity.ERROR })
    return services()
  }

  fun testDiagnosticsGetReportsSettledDaemonErrorsWithExactUriAndUtf16Range() {
    val services = brokenXml()
    val uri = DocumentServices.uri(myFixture.file.virtualFile)
    val diagnostics = services.request("diagnostics/get", json("uri" to uri), RequestCancellation()).asJsonArray
    val errors = diagnostics.map { it.asJsonObject }.filter { it["severity"].asString == "error" }
    assertFalse(errors.isEmpty())
    val highlights =
      myFixture.doHighlighting().filter {
        it.severity >= com.intellij.lang.annotation.HighlightSeverity.ERROR && it.description != null
      }
    assertEquals(highlights.map { it.description }.toSet(), errors.map { it["message"].asString }.toSet())
    highlights.forEach { info ->
      val diagnostic = errors.first { it["message"].asString == info.description }
      assertEquals(uri, diagnostic["uri"].asString)
      assertEquals(
        DocumentServices.range(myFixture.editor.document, info.startOffset, info.endOffset),
        diagnostic["range"],
      )
    }
    assertEquals(diagnostics, services.request("diagnostics/get", json(), RequestCancellation()))
    JsonBoundary().result("diagnostics/get", json("jsonrpc" to "2.0", "id" to "get", "result" to diagnostics))
  }

  private fun fileServices(choice: Path?): NativeHostServices {
    val widgets = NativeWidgets(project, JsonBoundary()) {}
    Disposer.register(testRootDisposable, widgets)
    return NativeHostServices(
      project,
      { _, _ -> error("fixture-unused") },
      widgets,
      options = NativeHostOptions(chooseFile = { _, _, _ -> choice }),
    )
  }

  fun testFileRequestsMapNativeChoicesToMhpResults() {
    val picked = Files.createTempFile("m104-pick-", ".md")
    val target = Files.createTempDirectory("m104-save-").resolve("fixture.md")
    try {
      val selecting = fileServices(picked)
      assertEquals(
        picked.toUri().toASCIIString(),
        selecting.request("ui/openFile", json("title" to "fixture"), RequestCancellation()).asString,
      )
      val declining = fileServices(null)
      assertTrue(
        declining.request("ui/openFile", json("title" to "fixture"), RequestCancellation()).isJsonNull,
      )
      val saving = fileServices(target)
      assertEquals(
        jsonValue(true),
        saving.request(
          "ui/saveText",
          json("title" to "fixture", "suggestedName" to "fixture.md", "text" to "saved fixture"),
          RequestCancellation(),
        ),
      )
      assertEquals("saved fixture", Files.readString(target))
      assertEquals(
        jsonValue(false),
        declining.request(
          "ui/saveText",
          json("title" to "fixture", "suggestedName" to "fixture.md", "text" to "saved fixture"),
          RequestCancellation(),
        ),
      )
    } finally {
      Files.deleteIfExists(picked)
      Files.deleteIfExists(target)
      Files.deleteIfExists(target.parent)
    }
  }

  fun testSettledDiagnosticsAttestTheCheckedDocumentVersion() {
    val services = brokenXml()
    val uri = DocumentServices.uri(myFixture.file.virtualFile)
    val version = myFixture.editor.document.modificationStamp
    val settled =
      services
        .request("diagnostics/settled", json("uri" to uri, "expectedVersion" to version), RequestCancellation())
        .asJsonObject
    assertEquals(uri, settled["uri"].asString)
    assertEquals(version, settled["version"].asLong)
    assertTrue(settled.getAsJsonArray("diagnostics").any { it.asJsonObject["severity"].asString == "error" })
    assertTrue(
      services
        .request("diagnostics/settled", json("uri" to uri, "expectedVersion" to (version + 1)), RequestCancellation())
        .isJsonNull,
    )
  }

  fun testSettledDiagnosticsStayPendingAfterAnEditUntilHighlightingCompletes() {
    val services = brokenXml()
    com.intellij.openapi.command.WriteCommandAction.runWriteCommandAction(project) {
      myFixture.editor.document.setText("<root><new></root>")
    }
    val uri = DocumentServices.uri(myFixture.file.virtualFile)
    val version = myFixture.editor.document.modificationStamp
    val params = json("uri" to uri, "expectedVersion" to version)
    assertTrue(
      "An edit invalidates cached highlighting",
      services.request("diagnostics/settled", params, RequestCancellation()).isJsonNull,
    )
    com.intellij.psi.PsiDocumentManager
      .getInstance(project)
      .commitAllDocuments()
    assertTrue(
      "Committed PSI is still pending analysis",
      services.request("diagnostics/settled", params, RequestCancellation()).isJsonNull,
    )
    completeHighlighting()
    val report = services.request("diagnostics/settled", params, RequestCancellation()).asJsonObject
    assertEquals(version, report["version"].asLong)
    assertTrue(report.getAsJsonArray("diagnostics").any { it.asJsonObject["severity"].asString == "error" })
  }

  fun testSettledDiagnosticsRefuseDirtyDiagnosticScopesEvenAtTheSameCommittedVersion() {
    val services = brokenXml()
    val document = myFixture.editor.document
    val version = document.modificationStamp
    val params = json("uri" to DocumentServices.uri(myFixture.file.virtualFile), "expectedVersion" to version)
    assertFalse(services.request("diagnostics/settled", params, RequestCancellation()).isJsonNull)
    val daemon = DaemonCodeAnalyzer.getInstance(project)
    require(daemon is DaemonCodeAnalyzerImpl)
    daemon.restart(myFixture.file, "Invalidate diagnostics without editing")
    assertTrue(PsiDocumentManager.getInstance(project).isCommitted(document))
    assertEquals(version, document.modificationStamp)
    assertEquals(version, myFixture.file.viewProvider.modificationStamp)
    for (pass in listOf(Pass.UPDATE_ALL, Pass.LOCAL_INSPECTIONS)) {
      assertNotNull(daemon.fileStatusMap.getFileDirtyScope(document, myFixture.file, pass))
    }
    assertTrue(
      "Cached errors at the same committed version cannot attest dirty diagnostic scopes",
      services.request("diagnostics/settled", params, RequestCancellation()).isJsonNull,
    )
    completeHighlighting()
    val report = services.request("diagnostics/settled", params, RequestCancellation()).asJsonObject
    assertEquals(version, report["version"].asLong)
    assertTrue(report.getAsJsonArray("diagnostics").any { it.asJsonObject["severity"].asString == "error" })
  }

  fun testRunInvokesRegisteredCommandsAndRefusesUnknown() {
    val executed = mutableListOf<String>()
    val widgets = NativeWidgets(project, JsonBoundary()) { executed.add(it) }
    Disposer.register(testRootDisposable, widgets)
    val services = NativeHostServices(project, { _, _ -> error("fixture-unused") }, widgets)
    val cancellation = RequestCancellation()
    services.request("commands/register", json("id" to "fixture-run", "title" to "Fixture run"), cancellation)
    assertEquals(
      jsonValue(null),
      services.request("commands/run", json("id" to "fixture-run", "args" to emptyList<String>()), cancellation),
    )
    assertEquals(listOf("fixture-run"), executed)
    assertEquals(
      "MHP_CAPABILITY_UNAVAILABLE",
      org.junit.Assert
        .assertThrows(Exception::class.java) {
          services.request("commands/run", json("id" to "missing", "args" to emptyList<String>()), cancellation)
        }.message,
    )
  }

  fun testUnhandledUiMethodsKeepTheirTypedCapabilityRefusal() {
    val services = services()
    assertEquals(
      "MHP_UNSUPPORTED_CAPABILITY",
      org.junit.Assert
        .assertThrows(Exception::class.java) {
          services.request("ui/unhandled-fixture", json(), RequestCancellation())
        }.message,
    )
  }

  fun testDiagnosticsDidChangePublishesSettledErrorsAndClearsAfterCorrection() {
    val services = brokenXml()
    val sent = mutableListOf<JsonObject>()
    val peer =
      MhpConnection(JsonBoundary(), services, Executor(Runnable::run), { frame, _ -> sent.add(frame) }, {
      }, ConnectionEvents({}, {}))
    Disposer.register(testRootDisposable) { peer.close() }
    peer.initialize(
      fixtureMetadata().apply {
        add("protocolRange", json("minimum" to "mhp/1.5.0", "maximumExclusive" to "mhp/1.6.0"))
        add("capabilities", jsonValue(services.capabilities))
      },
    )
    peer.receive(
      json(
        "jsonrpc" to "2.0",
        "id" to sent.last()["id"],
        "result" to
          json("protocolVersion" to "mhp/1.5.0", "capabilities" to services.capabilities),
      ),
    )
    installEditorEvents(project, services, peer, testRootDisposable)

    fun publish(): JsonObject {
      sent.clear()
      project.messageBus.syncPublisher(DaemonCodeAnalyzer.DAEMON_EVENT_TOPIC).daemonFinished()
      return sent.single { it["method"]?.asString == "diagnostics/didChange" }.getAsJsonObject("params")
    }
    val broken = publish()
    assertEquals(DocumentServices.uri(myFixture.file.virtualFile), broken["uri"].asString)
    assertTrue(broken.getAsJsonArray("diagnostics").any { it.asJsonObject["severity"].asString == "error" })
    com.intellij.openapi.command.WriteCommandAction.runWriteCommandAction(project) {
      myFixture.editor.document.setText("<root/>")
    }
    myFixture.doHighlighting()
    val fixed = publish()
    assertEquals(broken["uri"], fixed["uri"])
    assertEquals(jsonValue(emptyList<String>()), fixed["diagnostics"])
  }

  companion object {
    private const val DAEMON_WAIT_SECONDS = 5
  }
}
