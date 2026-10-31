package io.musespark.eclipse.tests;

import static org.junit.Assert.*;
import com.google.gson.*;
import io.musespark.eclipse.*;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.eclipse.core.resources.*;
import org.eclipse.core.runtime.Platform;
import org.eclipse.swt.widgets.Display;
import org.eclipse.ui.*;
import org.eclipse.ui.texteditor.ITextEditor;
import org.junit.*;

// Drives test/hostApi/scenarios/contract.json against the production runtime
// (dist/acp.js) through the production session (WindowSession over a live
// panel --stdio process). The runner (node hosts/eclipse/run.mjs) sets
// MUSE_CONFORMANCE_CONTRACT, MUSE_CONFORMANCE_RUNTIME and
// MUSE_CONFORMANCE_OBSERVATIONS; without them the suite runs standalone
// against the checkout and writes target/conformance-observations.json.
// The handshake below proves the session and the runtime live. The runtime
// then exits: its initial surfaces/open cannot be satisfied in the
// view-less test workbench (the panel view needs a browser engine, and
// this rig has no WebKitGTK), and an unsatisfied initial surface is a
// fatal panel error by design. Host-owned legs therefore drive the
// session's local production operations directly (the same code the MHP
// entry routes to, without its liveness guard); the runtime-owned legs
// (checkpoint, diff-hunks, settings) spawn the node drivers in
// test/unit/hostDrivers. The runner validates the observations. No leg
// loads a page, so this suite needs no WebKitGTK.
public class ConformanceIT {
    private static final long DRIVER_SECONDS = 120;
    private WindowSession session;
    private Process runtime;
    private IProject project;
    private final List<ITextEditor> editors = new ArrayList<>();
    private Path dataHome;
    private Path node;
    private Path runDriver;

    @Before public void setup() throws Exception {
        Platform.getBundle("io.musespark.eclipse").start();
        Path root = repositoryRoot();
        Path runtimeScript = conformancePath("MUSE_CONFORMANCE_RUNTIME", root.resolve("dist/acp.js"));
        if (!Files.isRegularFile(runtimeScript)) throw new IllegalStateException("MHP_CONFORMANCE_RUNTIME_MISSING");
        runDriver = root.resolve("test/unit/hostDrivers/runDriver.mjs");
        if (!Files.isRegularFile(runDriver)) throw new IllegalStateException("MHP_CONFORMANCE_HARNESS_FAILED");
        node = nodeBinary();
        dataHome = Files.createTempDirectory("muse-eclipse-conformance-data");
        project = ResourcesPlugin.getWorkspace().getRoot().getProject("m104-conformance-" + UUID.randomUUID());
        project.create(null);
        project.open(null);
        // The runtime binds its workspace to its own working directory, so
        // it starts in the workspace root the initialize folders report.
        ProcessBuilder builder = new ProcessBuilder(node.toString(), runtimeScript.toString(), "panel", "--stdio");
        builder.directory(ResourcesPlugin.getWorkspace().getRoot().getLocation().toFile());
        Map<String, String> clean = Assets.environment(builder.environment());
        builder.environment().clear();
        builder.environment().putAll(clean);
        builder.environment().put(dataHomeVariable(), dataHome.toString());
        runtime = builder.start();
        session = new WindowSession(PlatformUI.getWorkbench().getActiveWorkbenchWindow(), runtime);
        CountDownLatch initialized = new CountDownLatch(1);
        session.afterInitialize(initialized::countDown);
        pump(() -> initialized.getCount() == 0);
    }

    @After public void cleanup() throws Exception {
        IWorkbenchPage page = PlatformUI.getWorkbench().getActiveWorkbenchWindow().getActivePage();
        for (ITextEditor editor : editors) page.closeEditor(editor, false);
        editors.clear();
        if (project != null) project.delete(true, true, null);
        if (session != null) session.close();
        if (runtime != null) { runtime.destroyForcibly(); runtime.waitFor(2, TimeUnit.SECONDS); }
        if (dataHome != null) deleteRecursively(dataHome);
    }

    @Test public void contractAgainstProductionRuntime() throws Exception {
        Path root = repositoryRoot();
        Path contractFile = conformancePath("MUSE_CONFORMANCE_CONTRACT", root.resolve("test/hostApi/scenarios/contract.json"));
        if (!Files.isRegularFile(contractFile)) throw new IllegalStateException("MHP_CONFORMANCE_HARNESS_FAILED");
        String observationsPath = System.getenv("MUSE_CONFORMANCE_OBSERVATIONS");
        Path observationsFile = observationsPath != null ? Path.of(observationsPath) : Path.of(System.getProperty("user.dir"), "target", "conformance-observations.json");
        if (observationsFile.getParent() != null) Files.createDirectories(observationsFile.getParent());
        JsonObject contract = Json.parse(Files.readString(contractFile)).getAsJsonObject();
        // The harness schema keys observations "backend/scenario" under one
        // "observations" object; a missing or extra leg fails the harness.
        Map<String, Map<String, Object>> observed = new LinkedHashMap<>();
        boolean ranAny = false;
        for (JsonElement backendElement : contract.getAsJsonArray("backends")) {
            String backend = backendElement.getAsString();
            for (JsonElement scenarioElement : contract.getAsJsonArray("scenarios")) {
                String scenario = scenarioElement.getAsJsonObject().get("id").getAsString();
                if (waiting(contract, backend, scenario)) continue;
                ranAny = true;
                try {
                    observed.put(backend + "/" + scenario, driveLeg(backend, scenario));
                } catch (Exception ex) {
                    throw new IllegalStateException(backend + "/" + scenario + ": " + ex.getMessage(), ex);
                }
            }
        }
        assertTrue("the contract has no runnable eclipse legs", ranAny);
        Files.writeString(observationsFile, Json.GSON.toJson(Map.of("observations", observed)));
    }

    private static boolean waiting(JsonObject contract, String backend, String scenario) {
        for (JsonElement element : contract.getAsJsonArray("waiting")) {
            JsonObject leg = element.getAsJsonObject();
            if (!leg.get("backend").getAsString().equals(backend) || !leg.get("scenario").getAsString().equals(scenario)) continue;
            if (!leg.has("hosts") || leg.get("hosts").isJsonNull()) return true;
            for (JsonElement host : leg.getAsJsonArray("hosts")) if (host.getAsString().equals("eclipse")) return true;
        }
        return false;
    }

    private Map<String, Object> driveLeg(String backend, String scenario) throws Exception {
        return switch (scenario) {
            case "settings" -> settingsLeg();
            case "panel-order" -> panelOrderLeg();
            case "diagnostics" -> diagnosticsLeg();
            case "checkpoint" -> checkpointLeg(backend);
            case "diff-hunks" -> hunksLeg();
            default -> throw new IllegalStateException("no native driver for runnable scenario " + scenario);
        };
    }

    private Map<String, Object> settingsLeg() throws Exception {
        Path workspace = Files.createTempDirectory("muse-eclipse-settings-ws");
        Path data = Files.createTempDirectory("muse-eclipse-settings-data");
        try {
            JsonObject observed = runDriver("settings", Map.of("workspaceRoot", workspace.toString(), "dataRoot", data.toString()));
            return Map.of("settingValue", observed.get("settingValue").getAsInt());
        } finally {
            deleteRecursively(workspace);
            deleteRecursively(data);
        }
    }

    private static Map<String, Object> panelOrderLeg() throws Exception {
        Contract contract = new Contract();
        List<JsonObject> sent = new ArrayList<>();
        List<Long> delivered = new ArrayList<>();
        List<String> refusals = new ArrayList<>();
        PanelSurface surface = new PanelSurface(contract, "surface", "session", "chat", sent::add, id -> 0, code -> { throw new IllegalStateException(code); });
        surface.opened();
        surface.ready();
        for (long seq : new long[] {1, 1, 3, 2}) {
            try {
                surface.receive(Json.object("mhp", "1.5", "kind", "panel", "surface", "surface", "direction", "toPanel", "seq", seq, "payload", Json.object("type", "attachmentsCleared")));
                delivered.add(seq);
            } catch (IllegalArgumentException refused) {
                refusals.add(refused.getMessage());
            }
        }
        return Map.of("deliveredSequences", delivered, "refusals", refusals);
    }

    // A host-owned leg runs once per backend; the previous run's editor
    // and file are closed and removed so each run starts from the
    // scenario's start state.
    private void resetFile(String name) throws Exception {
        IWorkbenchPage page = PlatformUI.getWorkbench().getActiveWorkbenchWindow().getActivePage();
        for (ITextEditor editor : new ArrayList<>(editors)) page.closeEditor(editor, false);
        editors.clear();
        IFile file = project.getFile(name);
        if (file.exists()) file.delete(true, null);
    }

    private Map<String, Object> diagnosticsLeg() throws Exception {
        resetFile("diagnostic.txt");
        IFile file = project.getFile("diagnostic.txt");
        file.create(new ByteArrayInputStream("fixture text".getBytes(StandardCharsets.UTF_8)), true, null);
        ITextEditor editor = session.documents.open(file.getLocationURI().toString());
        editors.add(editor);
        String uri = file.getLocationURI().toString();
        org.eclipse.core.resources.IMarker marker = file.createMarker(org.eclipse.core.resources.IMarker.PROBLEM);
        marker.setAttribute(org.eclipse.core.resources.IMarker.LINE_NUMBER, 1);
        marker.setAttribute(org.eclipse.core.resources.IMarker.SEVERITY, org.eclipse.core.resources.IMarker.SEVERITY_ERROR);
        marker.setAttribute(org.eclipse.core.resources.IMarker.MESSAGE, "fixture error");
        long version = session.documents.descriptor(editor).get("version").getAsLong();
        JsonObject params = Json.object("uri", uri, "expectedVersion", version);
        JsonElement settled = JsonNull.INSTANCE;
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
        while (!settled.isJsonObject() && System.nanoTime() < deadline) {
            // The first call schedules the attesting build and reports null;
            // the read below observes the settled post-build snapshot.
            // The suite drives the production operation directly (see the
            // class comment); uiRequest would refuse once the runtime exits.
            // The UI-thread suite must not use request(), which would hop
            // back onto this same thread and deadlock.
            settled = session.diagnosticsSettled(params, false);
            if (!settled.isJsonObject()) Thread.sleep(500);
        }
        if (!settled.isJsonObject()) throw new IllegalStateException("MHP_DIAGNOSTICS_UNAVAILABLE");
        List<String> errors = new ArrayList<>();
        for (JsonElement element : settled.getAsJsonObject().getAsJsonArray("diagnostics")) {
            JsonObject diagnostic = element.getAsJsonObject();
            if (diagnostic.get("severity").getAsString().equals("error")) errors.add(diagnostic.get("message").getAsString());
        }
        return Map.of("verifyErrors", errors);
    }

    private Map<String, Object> checkpointLeg(String backend) throws Exception {
        // The product restores Model API turns only; a runnable Muse Code leg
        // has no driver and must wait in the contract instead. The driver
        // speaks BackendKind, not contract ids.
        if (!backend.equals("modelapi")) throw new IllegalStateException("MHP_CONFORMANCE_HARNESS_FAILED");
        backend = "modelApi";
        Path workspace = Files.createTempDirectory("muse-eclipse-checkpoint-ws");
        Path data = Files.createTempDirectory("muse-eclipse-checkpoint-data");
        try {
            JsonObject observed = runDriver("checkpoint", Map.of("workspaceRoot", workspace.toString(), "dataRoot", data.toString(), "sessionId", UUID.randomUUID().toString(), "backend", backend));
            return Map.of("text", observed.get("text").getAsString(), "checkpoints", observed.get("checkpoints").getAsInt());
        } finally {
            deleteRecursively(workspace);
            deleteRecursively(data);
        }
    }

    private Map<String, Object> hunksLeg() throws Exception {
        resetFile("lines.txt");
        IFile file = project.getFile("lines.txt");
        file.create(new ByteArrayInputStream("l1\nl2\nl3\n".getBytes(StandardCharsets.UTF_8)), true, null);
        ITextEditor editor = session.documents.open(file.getLocationURI().toString());
        editors.add(editor);
        String uri = file.getLocationURI().toString();
        long version = session.documents.descriptor(editor).get("version").getAsLong();
        JsonArray edits = new JsonArray();
        edits.add(Json.object("range", Json.object("start", Json.object("line", 0, "character", 0), "end", Json.object("line", 0, "character", 2)), "newText", "l1c"));
        edits.add(Json.object("range", Json.object("start", Json.object("line", 1, "character", 0), "end", Json.object("line", 1, "character", 2)), "newText", "l2c"));
        // The production document operations directly (see the class
        // comment); uiRequest would refuse once the runtime exits.
        session.documents.request("documents/applyEdits", Json.object("uri", uri, "expectedVersion", version, "undoLabel", "Conformance forward edit", "edits", edits));
        long savedVersion = session.documents.descriptor(editor).get("version").getAsLong();
        JsonElement saved = session.documents.request("documents/save", Json.object("uri", uri, "expectedVersion", savedVersion));
        if (saved.getAsJsonObject().get("dirty").getAsBoolean()) throw new IllegalStateException("MHP_SAVE_FAILED");
        String projectDir = project.getLocation().toFile().toString();
        JsonObject observed = runDriver("hunks", Map.of("workspaceRoot", projectDir));
        JsonObject hunks = observed.getAsJsonObject("hunks");
        return Map.of("hunks", Map.of("one", hunks.get("one").getAsString(), "two", hunks.get("two").getAsString()), "text", observed.get("text").getAsString());
    }

    private JsonObject runDriver(String driver, Map<String, String> args) throws Exception {
        ProcessBuilder builder = new ProcessBuilder(node.toString(), runDriver.toString(), driver, Json.GSON.toJson(args));
        Map<String, String> clean = Assets.environment(builder.environment());
        builder.environment().clear();
        builder.environment().putAll(clean);
        Process child = builder.start();
        boolean finished = child.waitFor(DRIVER_SECONDS, TimeUnit.SECONDS);
        if (!finished) {
            child.destroyForcibly();
            throw new IllegalStateException("MHP_CONFORMANCE_HARNESS_FAILED");
        }
        if (child.exitValue() != 0) throw new IllegalStateException("MHP_CONFORMANCE_HARNESS_FAILED");
        return Json.parse(new String(child.getInputStream().readAllBytes(), StandardCharsets.UTF_8)).getAsJsonObject();
    }

    private static Path conformancePath(String variable, Path fallback) {
        String configured = System.getenv(variable);
        return configured != null ? Path.of(configured) : fallback;
    }

    private static Path repositoryRoot() {
        Path current = Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
        for (int level = 0; level < 6 && current != null; level++) {
            if (Files.isRegularFile(current.resolve("test/hostApi/scenarios/contract.json"))) return current;
            current = current.getParent();
        }
        throw new IllegalStateException("MHP_CONFORMANCE_HARNESS_FAILED");
    }

    private static Path nodeBinary() {
        String search = System.getenv("PATH");
        String name = System.getProperty("os.name").startsWith("Windows") ? "node.exe" : "node";
        if (search != null) for (String directory : search.split(java.util.regex.Pattern.quote(java.io.File.pathSeparator))) {
            Path candidate = Path.of(directory, name);
            if (Files.isRegularFile(candidate) && Files.isExecutable(candidate)) return candidate.toAbsolutePath();
        }
        throw new IllegalStateException("MHP_RUNTIME_NOT_FOUND");
    }

    private static String dataHomeVariable() {
        if (System.getProperty("os.name").startsWith("Windows")) return "LOCALAPPDATA";
        if (System.getProperty("os.name").startsWith("Mac")) return "HOME";
        return "XDG_DATA_HOME";
    }

    private static void pump(java.util.function.BooleanSupplier complete) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(100);
        boolean settled = complete.getAsBoolean();
        while (!settled && System.nanoTime() < deadline) { Display.getDefault().timerExec(100, () -> { }); if (!Display.getDefault().readAndDispatch()) Display.getDefault().sleep(); settled = complete.getAsBoolean(); }
        assertTrue("production runtime operation did not settle", settled);
    }

    private static void deleteRecursively(Path root) throws Exception {
        if (!Files.exists(root)) return;
        List<Path> paths = new ArrayList<>();
        try (var walk = Files.walk(root)) { walk.forEach(paths::add); }
        paths.sort(Comparator.reverseOrder());
        for (Path path : paths) Files.deleteIfExists(path);
    }
}
