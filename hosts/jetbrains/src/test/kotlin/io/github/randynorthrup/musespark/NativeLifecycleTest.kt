package io.github.randynorthrup.musespark

import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.toolWindow.ToolWindowHeadlessManagerImpl
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit

class NativeLifecycleTest : BasePlatformTestCase() {
  override fun createTempDirTestFixture(): com.intellij.testFramework.fixtures.TempDirTestFixture =
    com.intellij.testFramework.fixtures.impl
      .TempDirTestFixtureImpl()

  fun testRetiredQueuedEditorRequestsCannotMutateReplacementNativeStateBeforeCancellation() {
    val receipt = Files.createTempFile(Path.of("build"), "retired-native-", ".json")

    val original = tabFixture(receipt)
    val replacement =
      RuntimeProcess.start(
        listOf("/usr/bin/python3", "-c", "import time; time.sleep(120)"),
        Path.of(".").toAbsolutePath(),
        mapOf("PATH" to "/usr/bin:/bin"),
      )
    val host = JetBrainsPanelHost(project, ToolWindowHeadlessManagerImpl.MockToolWindow(project))
    Disposer.register(testRootDisposable, host)
    val lateAction = "MuseSpark.${project.locationHash}.retired-fixture"
    var oldOwner: RuntimeConnection? = null
    var newOwner: RuntimeConnection? = null
    try {
      host.attach(original, false)
      val tab = project.getService(NativeTab::class.java)
      com.intellij.testFramework.PlatformTestUtil.waitWithEventsDispatching("Original registration", {
        tab.enabled("invoke")
      }, 10)
      val owner = requireNotNull(host.connection)
      oldOwner = owner
      val (file, document) = retiredDocument()
      val calls = retiredCalls(file, document)
      runRetiredRequests(owner, calls) {
        host.attach(replacement, false)
        newOwner = requireNotNull(host.connection)
        assertTrue(requireNotNull(newOwner).epoch > owner.epoch)
        tab.register(json("languages" to listOf("plaintext"), "trigger" to "invoke"))
      }
      run {
        val preserved =
          listOf(
            !tab.enabled("automatic"),
            ActionManager.getInstance().getAction(lateAction) == null,
            document.text == "alpha",
          )
        assertEquals(
          "Replacement Tab, commands and document must all survive retired work",
          listOf(true, true, true),
          preserved,
        )
      }
    } finally {
      Disposer.dispose(host)
      oldOwner?.terminated?.get(10, TimeUnit.SECONDS)
      newOwner?.terminated?.get(10, TimeUnit.SECONDS)
      original.close()
      replacement.close()
      ActionManager
        .getInstance()
        .getAction(
          lateAction,
        )?.let { ActionManager.getInstance().unregisterAction(lateAction) }
      Files.deleteIfExists(receipt)
    }
  }

  private fun retiredDocument(): Pair<com.intellij.openapi.vfs.VirtualFile, com.intellij.openapi.editor.Document> {
    val file = myFixture.addFileToProject("retired.txt", "alpha").virtualFile
    com.intellij.testFramework.PsiTestUtil
      .addContentRoot(module, file.parent)
    com.intellij.ide.trustedProjects.TrustedProjects
      .setProjectTrusted(project, true)
    val document =
      requireNotNull(
        com.intellij.openapi.fileEditor.FileDocumentManager
          .getInstance()
          .getDocument(file),
      )
    com.intellij.openapi.fileEditor.FileDocumentManager
      .getInstance()
      .saveDocument(document)
    return file to document
  }

  private fun runRetiredRequests(
    owner: RuntimeConnection,
    calls: List<Pair<String, com.google.gson.JsonObject>>,
    replace: () -> Unit,
  ) {
    val protocol = privateField(owner, "protocol")
    require(protocol is MhpConnection)
    val requests = privateField(owner, "requests")
    require(requests is java.util.concurrent.ThreadPoolExecutor)
    // Hold exactly the monitor the old actor needs to cancel inbound tokens.
    // Workers are dispatched, but their EDT callbacks run only after replacement.
    synchronized(protocol) {
      val submitted = requests.taskCount
      calls.forEachIndexed { index, (method, params) ->
        protocol.receive(json("jsonrpc" to "2.0", "id" to "retired-$index", "method" to method, "params" to params))
      }
      replace()
      com.intellij.testFramework.PlatformTestUtil.waitWithEventsDispatching("Retired native callbacks", {
        requests.completedTaskCount >= submitted + calls.size
      }, 10)
    }
  }

  private fun tabFixture(receipt: Path) =
    RuntimeProcess.start(
      listOf(
        "/usr/bin/python3",
        "-u",
        Path.of("test/fixtures/tab_runtime.py").toAbsolutePath().toString(),
        receipt.toAbsolutePath().toString(),
      ),
      Path.of(".").toAbsolutePath(),
      mapOf("PATH" to "/usr/bin:/bin"),
    )

  private fun retiredCalls(
    file: com.intellij.openapi.vfs.VirtualFile,
    document: com.intellij.openapi.editor.Document,
  ): List<Pair<String, com.google.gson.JsonObject>> =
    listOf(
      "tab/register" to json("languages" to listOf("plaintext"), "trigger" to "automatic"),
      "commands/register" to json("id" to "retired-fixture", "title" to "Retired fixture"),
      "documents/applyEdits" to
        json(
          "uri" to DocumentServices.uri(file),
          "expectedVersion" to document.modificationStamp,
          "undoLabel" to "Retired edit",
          "edits" to
            listOf(
              json(
                "range" to DocumentServices.range(document, 0, document.textLength),
                "newText" to "RETIRED",
              ),
            ),
        ),
    )

  private fun privateField(
    owner: Any,
    name: String,
  ): Any =
    owner.javaClass
      .getDeclaredField(name)
      .apply { isAccessible = true }
      .get(owner)

  fun testTransportFailureDisposesNativeSessionUnbindsTabAndKillsTheRuntimeTree() {
    val receipt = Files.createTempFile(Path.of("build"), "failed-runtime-", ".pid")
    val release = receipt.resolveSibling(receipt.fileName.toString() + ".release")
    val runtime =
      RuntimeProcess.start(
        listOf(
          "/usr/bin/python3",
          "-u",
          Path.of("test/fixtures/failed_runtime.py").toAbsolutePath().toString(),
          receipt.toAbsolutePath().toString(),
          release.toAbsolutePath().toString(),
        ),
        Path.of(".").toAbsolutePath(),
        mapOf("PATH" to "/usr/bin:/bin"),
      )
    var host: JetBrainsPanelHost? = null
    var child: ProcessHandle? = null
    val action = "MuseSpark.${project.locationHash}.failure-fixture"
    try {
      host =
        JetBrainsPanelHost.onEdt {
          // Light fixtures have no initialized native tool-window pane, even under Xvfb.
          val window = ToolWindowHeadlessManagerImpl.MockToolWindow(project)
          JetBrainsPanelHost(project, window).also {
            Disposer.register(testRootDisposable, it)
            it.attach(runtime, false)
          }
        }
      val tab = project.getService(NativeTab::class.java)
      com.intellij.testFramework.PlatformTestUtil.waitWithEventsDispatching(
        "Tab registration",
        { tab.enabled("invoke") },
        10,
      )
      child = ProcessHandle.of(Files.readString(receipt).toLong()).orElseThrow()
      assertTrue(child.isAlive)
      assertNotNull(JetBrainsPanelHost.onEdt { ActionManager.getInstance().getAction(action) })
      Files.writeString(release, "fail")
      com.intellij.testFramework.PlatformTestUtil.waitWithEventsDispatching("Native teardown", {
        !tab.enabled("invoke") && JetBrainsPanelHost.onEdt { ActionManager.getInstance().getAction(action) == null }
      }, 10)
      assertTrue(runtime.process.waitFor(10, TimeUnit.SECONDS))
      com.intellij.testFramework.PlatformTestUtil
        .waitWithEventsDispatching("Worker teardown", { !child.isAlive }, 10)
      assertFalse(tab.enabled("invoke"))
      assertNull(JetBrainsPanelHost.onEdt { ActionManager.getInstance().getAction(action) })
    } finally {
      JetBrainsPanelHost.onEdt { host?.let(Disposer::dispose) }
      runtime.close()
      child?.destroyForcibly()
      Files.deleteIfExists(receipt)
      Files.deleteIfExists(release)
    }
  }
}
