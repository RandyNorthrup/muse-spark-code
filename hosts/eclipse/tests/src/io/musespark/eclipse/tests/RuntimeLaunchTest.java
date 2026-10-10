package io.musespark.eclipse.tests;

import static org.junit.Assert.*;
import io.musespark.eclipse.RuntimeProcess;
import java.io.File;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.junit.Test;

/** Executable selection is independent of the workbench and frozen schema. */
public class RuntimeLaunchTest {
    private static String name() { return File.separatorChar == '\\' ? "muse-spark-code-acp.exe" : "muse-spark-code-acp"; }
    private static Path temporaryDirectory() throws Exception {
        String directory = System.getenv("TMPDIR");
        return Files.createTempDirectory(Path.of(directory == null ? System.getProperty("java.io.tmpdir") : directory), "mhp-launch-");
    }
    private static Path executable(Path path) throws Exception {
        Files.writeString(path, "fixture only");
        assertTrue(path.toFile().setExecutable(true, true));
        return path.toRealPath();
    }
    private static void remove(Path root) throws Exception {
        try (var paths = Files.walk(root)) { for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(path); }
    }
    @Test public void absoluteExecutableWithSpacesAndMetacharactersStaysOneArgument() throws Exception {
        Path root = temporaryDirectory();
        try {
            Path directory = Files.createDirectory(root.resolve("runtime space & $marker;"));
            Path binary = executable(directory.resolve(name()));
            assertEquals(List.of(binary.toString(), "panel", "--stdio"), RuntimeProcess.panelCommand(binary.toString(), ""));
        } finally { remove(root); }
    }
    @Test public void pathDiscoveryIgnoresRelativeAndEmptyDirectoriesAndValidatesTheFile() throws Exception {
        Path root = temporaryDirectory();
        try {
            Path notExecutable = Files.createDirectory(root.resolve("invalid"));
            Files.createDirectory(notExecutable.resolve(name()));
            Path binary = executable(root.resolve(name()));
            String search = String.join(File.pathSeparator, "", ".", "\u0000", notExecutable.toString(), root.toString());
            assertEquals(List.of(binary.toString(), "panel", "--stdio"), RuntimeProcess.panelCommand(null, search));
            assertEquals(RuntimeProcess.panelCommand(null, search), RuntimeProcess.panelCommand(" ", search));
            assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(null, File.pathSeparator + "."));
        } finally { remove(root); }
    }
    private static Path npmScript(Path prefix) throws Exception {
        Path pkg = Files.createDirectories(prefix.resolve("node_modules/muse-spark-code-acp/dist"));
        Files.writeString(pkg.getParent().resolve("package.json"), "{\"name\":\"muse-spark-code-acp\",\"bin\":{\"muse-spark-code-acp\":\"dist/acp.js\"}}");
        Files.writeString(pkg.resolve("acp.js"), "fixture only");
        return pkg.resolve("acp.js").toRealPath();
    }
    private static String pair(Path node, Path script) {
        return io.musespark.eclipse.Json.GSON.toJson(List.of(node.toString(), script.toString()));
    }
    @Test public void windowsNpmShimDiscoversNodeInSeparateAbsolutePathDirectory() throws Exception {
        Path root = temporaryDirectory();
        try {
            Path prefix = Files.createDirectory(root.resolve("npm space & $marker"));
            Files.writeString(prefix.resolve("muse-spark-code-acp.cmd"), "@echo malicious shim contents must never be read");
            Path script = npmScript(prefix);
            Path nodeDirectory = Files.createDirectory(root.resolve("node space & $marker"));
            Path node = executable(nodeDirectory.resolve("node.exe"));
            String search = String.join(File.pathSeparator, "", ".", prefix.toString(), nodeDirectory.toString());
            assertEquals(List.of(node.toString(), script.toString(), "panel", "--stdio"), RuntimeProcess.panelCommand(null, search, true));
            assertEquals(List.of(node.toString(), script.toString(), "panel", "--stdio"), RuntimeProcess.panelCommand(prefix.resolve("muse-spark-code-acp.cmd").toString(), search, true));
        } finally { remove(root); }
    }
    @Test public void windowsNpmShimUsesItsAdjacentNodeWithoutPath() throws Exception {
        Path root = temporaryDirectory();
        try {
            Path shim = Files.writeString(root.resolve("muse-spark-code-acp.cmd"), "fixture only");
            Path script = npmScript(root);
            Path node = executable(root.resolve("node.exe"));
            assertEquals(List.of(node.toString(), script.toString(), "panel", "--stdio"), RuntimeProcess.panelCommand(shim.toString(), "", true));
        } finally { remove(root); }
    }
    private static void directoryLink(Path link, Path target) throws Exception {
        if (File.separatorChar != '\\') {
            Files.createSymbolicLink(link, target);
            return;
        }
        Process junction = new ProcessBuilder("cmd.exe", "/c", "mklink", "/J", link.toString(), target.toString()).redirectErrorStream(true).start();
        try {
            assertTrue("fixture junction did not finish", junction.waitFor(2, TimeUnit.SECONDS));
            assertEquals(new String(junction.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8), 0, junction.exitValue());
        } finally { junction.destroyForcibly(); junction.waitFor(2, TimeUnit.SECONDS); }
    }
    private static void assertLinkedNpmDirectoryRefused(Path relative) throws Exception {
        Path root = temporaryDirectory();
        Path link = null;
        try {
            Path prefix = Files.createDirectory(root.resolve("npm prefix"));
            Path outside = Files.createDirectory(root.resolve("outside prefix"));
            Path script = npmScript(outside);
            Path shim = Files.writeString(prefix.resolve("muse-spark-code-acp.cmd"), "fixture only");
            Path node = executable(prefix.resolve("node.exe"));
            link = prefix.resolve(relative);
            Files.createDirectories(link.getParent());
            directoryLink(link, outside.resolve(relative));
            assertEquals("MHP_RUNTIME_PATH_INVALID", assertThrows(IllegalArgumentException.class,
                () -> RuntimeProcess.panelCommand(shim.toString(), "", true)).getMessage());
            assertEquals("MHP_RUNTIME_PATH_INVALID", assertThrows(IllegalArgumentException.class,
                () -> RuntimeProcess.panelCommand(null, prefix.toString(), true)).getMessage());
            // Explicit pairs retain their documented canonical package semantics.
            Path linkedScript = prefix.resolve("node_modules/muse-spark-code-acp/dist/acp.js");
            assertEquals(List.of(node.toString(), script.toString(), "panel", "--stdio"), RuntimeProcess.panelCommand(pair(node, linkedScript), "", true));
        } finally {
            // Remove the junction itself before walking either owned fixture tree.
            if (link != null) Files.deleteIfExists(link);
            remove(root);
        }
    }
    @Test public void windowsShimRefusesLinkedPackageDirectory() throws Exception {
        assertLinkedNpmDirectoryRefused(Path.of("node_modules", "muse-spark-code-acp"));
    }
    @Test public void windowsShimRefusesLinkedNodeModulesAncestor() throws Exception {
        assertLinkedNpmDirectoryRefused(Path.of("node_modules"));
    }
    @Test public void explicitNodeScriptPairPreservesAbsolutePathsAndFixedArguments() throws Exception {
        Path root = temporaryDirectory();
        try {
            Path node = executable(root.resolve("node.exe"));
            Path script = npmScript(root);
            assertEquals(List.of(node.toString(), script.toString(), "panel", "--stdio"), RuntimeProcess.panelCommand(pair(node, script), "", true));
            assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(pair(Path.of("node.exe"), script), "", true));
            assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(pair(node, Path.of("dist/acp.js")), "", true));
            Path nodeDirectory = Files.createDirectories(root.resolve("node directory/node.exe"));
            assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(pair(nodeDirectory, script), "", true));
            String extra = io.musespark.eclipse.Json.GSON.toJson(List.of(node.toString(), script.toString(), "--extra"));
            assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(extra, "", true));
            String nested = io.musespark.eclipse.Json.GSON.toJson(List.of(List.of(node.toString()), script.toString()));
            assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(nested, "", true));
            Path portableNode = executable(root.resolve("node"));
            assertEquals(List.of(portableNode.toString(), script.toString(), "panel", "--stdio"), RuntimeProcess.panelCommand(pair(portableNode, script), "", false));
            for (String invalid : List.of("[\"node.exe\",\"acp.js\"]", "[]", "[true, false]", "[\"node.exe\",\"acp.js\",\"--extra\"]", "[\"node.exe\",\"acp.js\",]"))
                assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(invalid, "", true));
            assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(pair(executable(root.resolve("runtime.cmd")), script), "", true));
            assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(pair(root, script), "", true));
            if (File.separatorChar != '\\') {
                assertTrue(node.toFile().setExecutable(false, false));
                assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(pair(node, script), "", true));
            }
        } finally { remove(root); }
    }
    @Test public void windowsShimRefusesSpoofedPackageOrMissingNodeAndScript() throws Exception {
        Path root = temporaryDirectory();
        try {
            Path shim = Files.writeString(root.resolve("muse-spark-code-acp.cmd"), "fixture only");
            Path script = npmScript(root);
            Path node = executable(root.resolve("node.exe"));
            Path manifest = script.getParent().getParent().resolve("package.json");
            for (String invalid : List.of("{\"name\":\"other\"}", "{\"name\":true}", "[]", "not json", "{\"name\":\"other\",\"name\":\"muse-spark-code-acp\"}")) {
                Files.writeString(manifest, invalid);
                assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(shim.toString(), root.toString(), true));
                assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(pair(node, script), "", true));
            }
            Files.writeString(manifest, "{\"name\":\"muse-spark-code-acp\"}");
            Files.delete(script);
            assertThrows(java.io.IOException.class, () -> RuntimeProcess.panelCommand(shim.toString(), root.toString(), true));
            Files.createDirectory(script);
            assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(shim.toString(), root.toString(), true));
            Files.delete(script); Files.writeString(script, "fixture only"); Files.delete(node);
            assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(shim.toString(), "", true));
            executable(node);
            if (File.separatorChar != '\\') {
                Path outside = Files.writeString(root.resolve("outside.js"), "fixture only");
                Files.delete(script); Files.createSymbolicLink(script, outside);
                assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(shim.toString(), root.toString(), true));
                Files.delete(script); Files.writeString(script, "fixture only");
                Path outsideManifest = Files.writeString(root.resolve("outside.json"), Files.readString(manifest));
                Files.delete(manifest); Files.createSymbolicLink(manifest, outsideManifest);
                assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(shim.toString(), root.toString(), true));
                Files.delete(manifest); Files.writeString(manifest, Files.readString(outsideManifest));
            }
            Files.delete(manifest); Files.createDirectory(manifest);
            assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(shim.toString(), root.toString(), true));
            Files.delete(manifest); Files.writeString(manifest, "{\"name\":\"muse-spark-code-acp\"}");
            Path unrelated = Files.writeString(root.resolve("acp.js"), "fixture only");
            assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(pair(executable(node), unrelated), "", true));
        } finally { remove(root); }
    }
    @Test public void npmLayoutStartsNodeWithTheScriptAndFixedArgumentsWithoutAShell() throws Exception {
        Path root = temporaryDirectory();
        Process child = null;
        try {
            Path prefix = Files.createDirectory(root.resolve("npm space & $marker;"));
            Path shim = Files.writeString(prefix.resolve("muse-spark-code-acp.cmd"), "exit 99");
            Path script = npmScript(prefix);
            Files.writeString(script, "process.stdout.write(JSON.stringify(process.argv.slice(1)))");
            String nodeName = File.separatorChar == '\\' ? "node.exe" : "node";
            Path sourceNode = Arrays.stream(System.getenv("PATH").split(java.util.regex.Pattern.quote(File.pathSeparator)))
                .filter(directory -> !directory.isBlank() && Path.of(directory).isAbsolute())
                .map(directory -> Path.of(directory).resolve(nodeName))
                .filter(path -> Files.isRegularFile(path) && Files.isExecutable(path)).findFirst().orElseThrow();
            Path node = prefix.resolve("node.exe");
            Files.copy(sourceNode.toRealPath(), node); assertTrue(node.toFile().setExecutable(true, true));
            ProcessBuilder installed = new ProcessBuilder(RuntimeProcess.panelCommand(shim.toString(), "", true)).directory(root.toFile()).redirectErrorStream(true);
            installed.environment().clear();
            for (String variable : List.of("SystemRoot", "WINDIR", "PATH")) {
                String value = System.getenv(variable); if (value != null) installed.environment().put(variable, value);
            }
            for (String variable : List.of("HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "TMPDIR", "TEMP", "TMP")) installed.environment().put(variable, root.toString());
            installed.environment().put("LANG", "en_US.UTF-8");
            child = installed.start();
            assertTrue("argument fixture did not exit", child.waitFor(2, TimeUnit.SECONDS));
            assertEquals(0, child.exitValue());
            assertEquals(io.musespark.eclipse.Json.GSON.toJsonTree(List.of(script.toString(), "panel", "--stdio")), io.musespark.eclipse.Json.parse(new String(child.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)));
            // Replay with the real built CLI, privately staged in npm's layout.
            // EOF avoids initialization, backend startup and credential-store reads.
            Path repository = Path.of(System.getProperty("user.dir")).toAbsolutePath();
            while (repository != null && !Files.isRegularFile(repository.resolve("scripts/package-acp.mjs"))) repository = repository.getParent();
            assertNotNull("build repository not found", repository);
            Path pkg = script.getParent().getParent();
            try (var bundles = Files.list(repository.resolve("dist"))) {
                for (Path bundle : bundles.filter(path -> Files.isRegularFile(path) && (path.toString().endsWith(".js") || path.toString().endsWith(".json"))).toList())
                    Files.copy(bundle, pkg.resolve("dist").resolve(bundle.getFileName()), StandardCopyOption.REPLACE_EXISTING);
            }
            var manifest = io.musespark.eclipse.Json.parse(Files.readString(pkg.resolve("package.json"))).getAsJsonObject();
            manifest.add("version", io.musespark.eclipse.Json.parse(Files.readString(repository.resolve("package.json"))).getAsJsonObject().get("version"));
            Files.writeString(pkg.resolve("package.json"), manifest.toString());
            List<String> shimCommand = RuntimeProcess.panelCommand(shim.toString(), "", true);
            List<String> directCommand = RuntimeProcess.panelCommand(pair(node, script), "", true);
            assertEquals(shimCommand, directCommand); installed.command(directCommand);
            child = installed.start(); child.getOutputStream().close();
            assertTrue("production panel did not retire on EOF", child.waitFor(2, TimeUnit.SECONDS));
            assertEquals(new String(child.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8), 0, child.exitValue());
        } finally {
            if (child != null) { child.destroyForcibly(); child.waitFor(2, TimeUnit.SECONDS); }
            remove(root);
        }
    }
    @Test public void nativeWindowsExecutableRemainsSupported() throws Exception {
        Path root = temporaryDirectory();
        try {
            Path binary = executable(root.resolve("muse-spark-code-acp.exe"));
            assertEquals(List.of(binary.toString(), "panel", "--stdio"), RuntimeProcess.panelCommand(null, root.toString(), true));
        } finally { remove(root); }
    }
    @Test public void commandStringsMissingFilesAndDirectoriesNeverBecomeLaunches() throws Exception {
        Path root = temporaryDirectory();
        try {
            assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand("runtime --option", root.toString()));
            assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(root.toString(), ""));
            assertThrows(java.io.IOException.class, () -> RuntimeProcess.panelCommand(root.resolve("missing").toString(), ""));
            Path batch = executable(root.resolve("runtime.cmd"));
            if (File.separatorChar == '\\') assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(batch.toString(), ""));
            else {
                assertTrue(batch.toFile().setExecutable(false, false));
                assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(batch.toString(), ""));
            }
        } finally { remove(root); }
    }
}
