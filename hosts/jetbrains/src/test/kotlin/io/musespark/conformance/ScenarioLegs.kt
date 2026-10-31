package io.musespark.conformance

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.codeInsight.daemon.DaemonCodeAnalyzer
import com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerEx
import com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerImpl
import com.intellij.codeInsight.daemon.impl.HighlightInfo
import com.intellij.codeInsight.daemon.impl.HighlightInfoType
import com.intellij.codeInsight.daemon.impl.UpdateHighlightersUtil
import com.intellij.ide.trustedProjects.TrustedProjects
import com.intellij.openapi.Disposable
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.module.Module
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.psi.PsiDocumentManager
import com.intellij.testFramework.PlatformTestUtil
import com.intellij.testFramework.PsiTestUtil
import com.intellij.testFramework.fixtures.CodeInsightTestFixture
import io.github.randynorthrup.musespark.DocumentServices
import io.github.randynorthrup.musespark.JsonBoundary
import io.github.randynorthrup.musespark.NativeHostServices
import io.github.randynorthrup.musespark.PanelCallbacks
import io.github.randynorthrup.musespark.PanelSurface
import io.github.randynorthrup.musespark.RequestCancellation
import io.github.randynorthrup.musespark.RuntimeProcess
import io.github.randynorthrup.musespark.json
import java.awt.GraphicsEnvironment
import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue

data class ConformanceLeg(
  val backend: String,
  val scenario: String,
)

data class ConformanceLayout(
  val contractFile: Path,
  val runtimeFile: Path,
  val observationsFile: Path,
  val runDriver: Path,
) {
  companion object {
    fun resolve(): ConformanceLayout {
      val root = repositoryRoot()
      val contract =
        System.getenv("MUSE_CONFORMANCE_CONTRACT")?.let(Path::of)
          ?: root.resolve("test/hostApi/scenarios/contract.json")
      val runtime =
        System.getenv("MUSE_CONFORMANCE_RUNTIME")?.let(Path::of)
          ?: root.resolve("dist/acp.js")
      val observations =
        System.getenv("MUSE_CONFORMANCE_OBSERVATIONS")?.let(Path::of)
          ?: root.resolve("hosts/jetbrains/build/conformance-observations.json")
      require(Files.isRegularFile(contract)) { "MHP_CONFORMANCE_HARNESS_FAILED" }
      val driver = root.resolve("test/unit/hostDrivers/runDriver.mjs")
      require(Files.isRegularFile(driver)) { "MHP_CONFORMANCE_HARNESS_FAILED" }
      observations.parent?.let { Files.createDirectories(it) }
      return ConformanceLayout(contract, runtime, observations, driver)
    }

    private fun repositoryRoot(): Path {
      // user.dir can name a deleted fixture directory when another suite ran
      // first in the same JVM; anchor on this class's compiled location too.
      val anchors =
        listOfNotNull(
          runCatching { Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize() }.getOrNull(),
          runCatching {
            Path.of(ConformanceLayout::class.java.protectionDomain.codeSource.location.toURI())
              .toAbsolutePath()
              .normalize()
          }.getOrNull(),
        )
      for (anchor in anchors) {
        var current: Path? = anchor
        repeat(8) {
          val candidate = current ?: return@repeat
          if (Files.isRegularFile(candidate.resolve("test/hostApi/scenarios/contract.json"))) return candidate
          current = candidate.parent
        }
      }
      error("MHP_CONFORMANCE_HARNESS_FAILED")
    }
  }
}

class ConformanceContract private constructor(
  private val backends: List<String>,
  private val scenarios: List<String>,
  private val waiting: List<WaitingLeg>,
) {
  private data class WaitingLeg(
    val backend: String,
    val scenario: String,
    val hosts: List<String>?,
  )

  fun runnableLegs(host: String): List<ConformanceLeg> {
    val legs = mutableListOf<ConformanceLeg>()
    for (backend in backends) {
      for (scenario in scenarios) {
        val waiting =
          waiting.any { leg ->
            leg.backend == backend &&
              leg.scenario == scenario &&
              (leg.hosts == null || host in leg.hosts)
          }
        if (!waiting) legs.add(ConformanceLeg(backend, scenario))
      }
    }
    return legs
  }

  companion object {
    fun read(file: Path): ConformanceContract {
      val root = JsonBoundary.parse(Files.readString(file)).asJsonObject
      val backends = root.getAsJsonArray("backends").map { it.asString }
      val scenarios = root.getAsJsonArray("scenarios").map { it.asJsonObject["id"].asString }
      val waiting =
        root.getAsJsonArray("waiting").map {
          val leg = it.asJsonObject
          WaitingLeg(
            leg["backend"].asString,
            leg["scenario"].asString,
            leg["hosts"]?.asJsonArray?.map { host -> host.asString },
          )
        }
      return ConformanceContract(backends, scenarios, waiting)
    }
  }
}

data class LegContext(
  val fixture: CodeInsightTestFixture,
  val module: Module,
  val project: Project,
  val testRootDisposable: Disposable,
  val services: NativeHostServices,
  val node: Path,
  val runDriver: Path,
)

fun driveLeg(
  context: LegContext,
  leg: ConformanceLeg,
): Map<String, Any?> =
  when (leg.scenario) {
    "settings" -> settingsLeg(context)
    "panel-order" -> panelOrderLeg()
    "diagnostics" -> diagnosticsLeg(context)
    "checkpoint" -> checkpointLeg(context, leg.backend)
    "diff-hunks" -> hunksLeg(context)
    else -> error("no native driver for runnable scenario ${leg.scenario}")
  }

private fun runDriver(
  node: Path,
  runDriver: Path,
  driver: String,
  args: Map<String, String>,
): JsonObject {
  val process =
    ProcessBuilder(node.toString(), runDriver.toString(), driver, Gson().toJson(args))
      .apply {
        environment().clear()
        environment().putAll(RuntimeProcess.environment(System.getenv()))
      }.start()
  val finished = process.waitFor(DRIVER_SECONDS, TimeUnit.SECONDS)
  if (!finished) {
    process.destroyForcibly()
    error("MHP_CONFORMANCE_HARNESS_FAILED")
  }
  if (process.exitValue() != 0) error("MHP_CONFORMANCE_HARNESS_FAILED")
  return JsonBoundary.parse(process.inputStream.readBytes().toString(Charsets.UTF_8)).asJsonObject
}

private fun settingsLeg(context: LegContext): Map<String, Any?> {
  val workspace = Files.createTempDirectory("muse-jb-settings-ws")
  val data = Files.createTempDirectory("muse-jb-settings-data")
  try {
    val observed =
      runDriver(
        context.node,
        context.runDriver,
        "settings",
        mapOf("workspaceRoot" to workspace.toString(), "dataRoot" to data.toString()),
      )
    return mapOf("settingValue" to observed["settingValue"].asInt)
  } finally {
    deleteRecursively(workspace)
    deleteRecursively(data)
  }
}

private fun panelFrame(
  surface: String,
  seq: Long,
): JsonObject =
  json(
    "mhp" to "1.5",
    "kind" to "panel",
    "surface" to surface,
    "direction" to "toPanel",
    "seq" to seq,
    "payload" to json("type" to "attachmentsCleared"),
  )

private fun panelOrderLeg(): Map<String, Any?> {
  val boundary = JsonBoundary()
  val delivered = mutableListOf<Long>()
  val refusals = mutableListOf<String>()
  val surface =
    PanelSurface(
      "conformance-surface",
      "conformance-session",
      "chat",
      boundary,
      PanelCallbacks({ _, _ -> }, { 0 }, { _, seq -> delivered.add(seq) }, { _, _ -> }),
    )
  surface.open()
  surface.subscribe()
  for (seq in listOf(1L, 1L, 3L, 2L)) {
    try {
      surface.receive(panelFrame("conformance-surface", seq))
    } catch (error: IllegalArgumentException) {
      refusals.add(requireNotNull(error.message) { "MHP_CONFORMANCE_HARNESS_FAILED" })
    }
  }
  return mapOf("deliveredSequences" to delivered, "refusals" to refusals)
}

private fun completeHighlighting(context: LegContext) {
  // Headless tests never auto-run daemon passes, so the leg drives them
  // explicitly and waits for the finished pass at this document stamp.
  PsiDocumentManager.getInstance(context.project).commitAllDocuments()
  val editor =
    requireNotNull(
      FileEditorManager.getInstance(context.project).getSelectedEditor(context.fixture.file.virtualFile),
    ) { "MHP_CONFORMANCE_HARNESS_FAILED" }
  require(editor is TextEditor) { "MHP_CONFORMANCE_HARNESS_FAILED" }
  val version = editor.editor.document.modificationStamp
  val completed = AtomicBoolean()
  val connection = context.project.messageBus.connect()
  connection.subscribe(
    DaemonCodeAnalyzer.DAEMON_EVENT_TOPIC,
    object : DaemonCodeAnalyzer.DaemonListener {
      override fun daemonFinished(fileEditors: Collection<FileEditor>) {
        if (editor in fileEditors && editor.editor.document.modificationStamp == version) {
          completed.set(DaemonCodeAnalyzerEx.isHighlightingCompleted(editor, context.project))
        }
      }
    },
  )
  val daemon = DaemonCodeAnalyzer.getInstance(context.project)
  try {
    if (GraphicsEnvironment.isHeadless()) {
      require(daemon is DaemonCodeAnalyzerImpl) { "MHP_CONFORMANCE_HARNESS_FAILED" }
      daemon.runPasses(context.fixture.file, editor.editor.document, editor, intArrayOf(), false, null)
    } else {
      daemon.setUpdateByTimerEnabled(true)
      daemon.restart(context.fixture.file, "Conformance diagnostics leg")
    }
    PlatformTestUtil.waitWithEventsDispatching(
      "Diagnostic daemon did not finish",
      { completed.get() },
      DAEMON_WAIT_SECONDS,
    )
    assertEquals(version, context.fixture.file.viewProvider.modificationStamp)
    assertTrue(DaemonCodeAnalyzerEx.isHighlightingCompleted(editor, context.project))
  } finally {
    daemon.setUpdateByTimerEnabled(false)
    connection.disconnect()
  }
}

private fun diagnosticsLeg(context: LegContext): Map<String, Any?> {
  // A real file under the project path: production document services
  // map only `file://` URIs, not the light test filesystem.
  val projectDir = requireNotNull(context.project.basePath) { "MHP_WORKSPACE_NOT_FOUND" }
  val path = Files.writeString(Path.of(projectDir, DIAGNOSTIC_FILE), "fixture text")
  val file =
    requireNotNull(LocalFileSystem.getInstance().refreshAndFindFileByPath(path.toString())) {
      "MHP_CONFORMANCE_HARNESS_FAILED"
    }
  PsiTestUtil.addContentRoot(context.module, file.parent)
  context.fixture.configureFromExistingVirtualFile(file)
  completeHighlighting(context)
  val document = context.fixture.editor.document
  // The scenario's error text, published through the production highlight
  // pipeline (the channel the daemon itself publishes through) after the
  // daemon's passes complete, as the headless analogue of publishing
  // through the editor's own channel. The settled read-back below observes
  // it through production code only.
  val info =
    HighlightInfo.newHighlightInfo(HighlightInfoType.ERROR)
      .range(0, document.textLength)
      .descriptionAndTooltip("fixture error")
      .create()
  requireNotNull(info) { "MHP_CONFORMANCE_HARNESS_FAILED" }
  UpdateHighlightersUtil.setHighlightersToEditor(
    context.project,
    document,
    0,
    document.textLength,
    listOf(info),
    EditorColorsManager.getInstance().globalScheme,
    CONFORMANCE_HIGHLIGHT_GROUP,
  )
  val uri = DocumentServices.uri(context.fixture.file.virtualFile)
  val settled =
    context.services.request(
      "diagnostics/settled",
      json("uri" to uri, "expectedVersion" to document.modificationStamp),
      RequestCancellation(),
    )
  require(settled.isJsonObject) { "MHP_DIAGNOSTICS_UNAVAILABLE" }
  val errors =
    settled.asJsonObject.getAsJsonArray("diagnostics").map { it.asJsonObject }
      .filter { it["severity"].asString == "error" }
      .map { it["message"].asString }
  return mapOf("verifyErrors" to errors)
}

private fun checkpointLeg(
  context: LegContext,
  backend: String,
): Map<String, Any?> {
  // The product restores Model API turns only; a runnable Muse Code leg has
  // no driver and must wait in the contract instead. The driver speaks
  // BackendKind, not contract ids.
  require(backend == "modelapi") { "MHP_CONFORMANCE_HARNESS_FAILED" }
  val driverBackend = "modelApi"
  val workspace = Files.createTempDirectory("muse-jb-checkpoint-ws")
  val data = Files.createTempDirectory("muse-jb-checkpoint-data")
  try {
    val observed =
      runDriver(
        context.node,
        context.runDriver,
        "checkpoint",
        mapOf(
          "workspaceRoot" to workspace.toString(),
          "dataRoot" to data.toString(),
          "sessionId" to UUID.randomUUID().toString(),
          "backend" to driverBackend,
        ),
      )
    return mapOf("text" to observed["text"].asString, "checkpoints" to observed["checkpoints"].asInt)
  } finally {
    deleteRecursively(workspace)
    deleteRecursively(data)
  }
}

private fun hunksLeg(context: LegContext): Map<String, Any?> {
  TrustedProjects.setProjectTrusted(context.project, true)
  // A real file on disk: the node half of this leg reverts through the
  // filesystem, which a light test file cannot reach.
  val projectDir = requireNotNull(context.project.basePath) { "MHP_WORKSPACE_NOT_FOUND" }
  val linesPath = Path.of(projectDir, "lines.txt")
  Files.writeString(linesPath, "l1\nl2\nl3\n")
  val virtualFile =
    requireNotNull(
      LocalFileSystem.getInstance().refreshAndFindFileByPath(linesPath.toString()),
    ) { "MHP_CONFORMANCE_HARNESS_FAILED" }
  PsiTestUtil.addContentRoot(context.module, virtualFile.parent)
  context.fixture.configureFromExistingVirtualFile(virtualFile)
  val uri = DocumentServices.uri(virtualFile)
  val document =
    requireNotNull(FileDocumentManager.getInstance().getDocument(virtualFile)) {
      "MHP_CONFORMANCE_HARNESS_FAILED"
    }
  // The leg runs once per backend; the open document keeps the previous
  // run's reverted text, so the scenario's start text is set and saved
  // explicitly (production edits refuse a dirty buffer).
  WriteCommandAction.runWriteCommandAction(context.project) {
    document.setText("l1\nl2\nl3\n")
  }
  FileDocumentManager.getInstance().saveDocument(document)
  context.services.request(
    "documents/applyEdits",
    json(
      "uri" to uri,
      "expectedVersion" to document.modificationStamp,
      "undoLabel" to "Conformance forward edit",
      "edits" to
        listOf(
          json(
            "range" to
              json(
                "start" to json("line" to 0, "character" to 0),
                "end" to json("line" to 0, "character" to 2),
              ),
            "newText" to "l1c",
          ),
          json(
            "range" to
              json(
                "start" to json("line" to 1, "character" to 0),
                "end" to json("line" to 1, "character" to 2),
              ),
            "newText" to "l2c",
          ),
        ),
    ),
    RequestCancellation(),
  )
  val saved =
    context.services.request(
      "documents/save",
      json("uri" to uri, "expectedVersion" to document.modificationStamp),
      RequestCancellation(),
    )
  require(!saved.asJsonObject["dirty"].asBoolean) { "MHP_CONFORMANCE_HARNESS_FAILED" }
  val observed =
    runDriver(
      context.node,
      context.runDriver,
      "hunks",
      mapOf("workspaceRoot" to projectDir),
    )
  val hunks = observed.getAsJsonObject("hunks")
  return mapOf(
    "hunks" to mapOf("one" to hunks["one"].asString, "two" to hunks["two"].asString),
    "text" to observed["text"].asString,
  )
}

private fun deleteRecursively(root: Path) {
  if (!Files.exists(root)) return
  Files.walk(root).sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
}

private const val DRIVER_SECONDS = 120L
private const val DAEMON_WAIT_SECONDS = 5
private const val CONFORMANCE_HIGHLIGHT_GROUP = 0x5E771
private const val DIAGNOSTIC_FILE = "diagnostic.txt"
