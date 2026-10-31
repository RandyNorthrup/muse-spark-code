package io.musespark.conformance

import com.google.gson.Gson
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import io.github.randynorthrup.musespark.ConnectionEvents
import io.github.randynorthrup.musespark.JsonBoundary
import io.github.randynorthrup.musespark.MhpConnection
import io.github.randynorthrup.musespark.MhpPipe
import io.github.randynorthrup.musespark.NativeHostServices
import io.github.randynorthrup.musespark.NativeWidgets
import io.github.randynorthrup.musespark.QueueBudget
import io.github.randynorthrup.musespark.RuntimeProcess
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertTrue
import org.junit.Assert.fail

// Drives test/hostApi/scenarios/contract.json against the production runtime
// (dist/acp.js) through the production bridge (RuntimeProcess, MhpPipe,
// MhpConnection). The runner (node hosts/jetbrains/run.mjs) sets
// MUSE_CONFORMANCE_CONTRACT, MUSE_CONFORMANCE_RUNTIME and
// MUSE_CONFORMANCE_OBSERVATIONS; without them the suite runs standalone
// against the checkout and writes build/conformance-observations.json.
// Host-owned legs drive the production native services directly; the
// runtime-owned legs (checkpoint, diff-hunks, settings) spawn the node
// drivers in test/unit/hostDrivers. The handshake below proves the bridge
// and the runtime live; the runner validates the observations.
class ConformanceSuite : BasePlatformTestCase() {
  fun testContractAgainstProductionRuntime() {
    val layout = ConformanceLayout.resolve()
    val contract = ConformanceContract.read(layout.contractFile)
    val legs = contract.runnableLegs(HOST)
    assertTrue("the contract has no runnable $HOST legs", legs.isNotEmpty())
    val boundary = JsonBoundary()
    val widgets = NativeWidgets(project, boundary) {}
    Disposer.register(testRootDisposable, widgets)
    val services =
      NativeHostServices(project, { _, _ ->
        error("no surface call is expected during conformance")
      }, widgets)
    driveAll(layout, boundary, services, legs)
  }

  private fun driveAll(
    layout: ConformanceLayout,
    boundary: JsonBoundary,
    services: NativeHostServices,
    legs: List<ConformanceLeg>,
  ) {
    // First-touch IDE initialization (colour schemes, trusted-project
    // storage) exceeds the connection's 2 s metadata budget on a cold
    // rig, so the suite pays it on the test thread before the
    // handshake; the background collection inside start() then observes
    // the same values through production code.
    services.metadata
    val node =
      requireNotNull(
        RuntimeProcess.executable(
          System.getenv("PATH") ?: "",
          "node",
        ),
      ) { "MHP_RUNTIME_NOT_FOUND" }
    val runtimeScript = layout.runtimeFile
    require(Files.isRegularFile(runtimeScript)) { "MHP_CONFORMANCE_RUNTIME_MISSING" }
    val dataHome = Files.createTempDirectory("muse-jb-conformance-data")
    val workspace = requireNotNull(project.basePath) { "MHP_WORKSPACE_NOT_FOUND" }
    // A previous suite's fixture teardown can delete this directory first.
    Files.createDirectories(Path.of(workspace))
    val runtime =
      RuntimeProcess.start(
        listOf(node.toString(), runtimeScript.toString(), "panel", "--stdio"),
        Path.of(workspace),
        dataIsolatedEnvironment(dataHome),
      )
    val executor = Executors.newSingleThreadExecutor()
    try {
      lateinit var pipe: MhpPipe
      val initialized = CountDownLatch(1)
      val connection =
        MhpConnection(
          boundary,
          services,
          executor,
          { frame, id -> pipe.send(frame, id) },
          { fail("no panel frame is expected during conformance") },
          ConnectionEvents({ initialized.countDown() }, {}),
        )
      Disposer.register(testRootDisposable) { connection.close() }
      pipe =
        MhpPipe(
          runtime.process.inputStream,
          runtime.process.outputStream,
          boundary,
          connection::receive,
          {},
          QueueBudget(boundary),
        )
      pipe.start()
      connection.start()
      assertTrue(
        "the production runtime did not shake hands",
        initialized.await(HANDSHAKE_SECONDS, TimeUnit.SECONDS),
      )
      val context =
        LegContext(
          fixture = myFixture,
          module = module,
          project = project,
          testRootDisposable = testRootDisposable,
          services = services,
          node = node,
          runDriver = layout.runDriver,
        )
      // The harness schema keys observations "backend/scenario" under one
      // "observations" object; a missing or extra leg fails the harness.
      val observed = mutableMapOf<String, Map<String, Any?>>()
      for (leg in legs) {
        observed["${leg.backend}/${leg.scenario}"] =
          try {
            driveLeg(context, leg)
          } catch (error: Exception) {
            throw IllegalStateException("${leg.backend}/${leg.scenario}: ${error.message}", error)
          }
      }
      Files.writeString(layout.observationsFile, Gson().toJson(mapOf("observations" to observed)))
    } finally {
      executor.shutdownNow()
      runtime.close()
    }
  }

  companion object {
    private const val HOST = "jetbrains"
    private const val HANDSHAKE_SECONDS = 60L

    // The runtime's user data stays in temp: the settings leg writes a
    // setting, and no conformance run touches the person's real store.
    private fun dataIsolatedEnvironment(dataHome: Path): Map<String, String> {
      val environment = System.getenv().toMutableMap()
      if (com.intellij.openapi.util.SystemInfo.isWindows) {
        environment["LOCALAPPDATA"] = dataHome.toString()
        environment["TEMP"] = dataHome.toString()
        environment["TMP"] = dataHome.toString()
      } else if (com.intellij.openapi.util.SystemInfo.isMac) {
        environment["HOME"] = dataHome.toString()
      } else {
        environment["XDG_DATA_HOME"] = dataHome.toString()
      }
      return environment
    }
  }
}
