package io.musespark.eclipse.tests;

import static org.junit.Assert.*;
import io.musespark.eclipse.RuntimeProcess;
import java.io.File;
import java.nio.file.*;
import java.util.*;
import org.junit.Test;

/** Executable selection is independent of the workbench and frozen schema. */
public class RuntimeLaunchTest {
    private static String name() { return File.separatorChar == '\\' ? "muse-spark-code-acp.exe" : "muse-spark-code-acp"; }
    private static Path executable(Path path) throws Exception {
        Files.writeString(path, "fixture only");
        assertTrue(path.toFile().setExecutable(true, true));
        return path.toRealPath();
    }
    private static void remove(Path root) throws Exception {
        try (var paths = Files.walk(root)) { for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(path); }
    }
    @Test public void absoluteExecutableWithSpacesAndMetacharactersStaysOneArgument() throws Exception {
        Path root = Files.createTempDirectory("mhp-launch-");
        try {
            Path directory = Files.createDirectory(root.resolve("runtime space & $marker;"));
            Path binary = executable(directory.resolve(name()));
            assertEquals(List.of(binary.toString(), "panel", "--stdio"), RuntimeProcess.panelCommand(binary.toString(), ""));
        } finally { remove(root); }
    }
    @Test public void pathDiscoveryIgnoresRelativeAndEmptyDirectoriesAndValidatesTheFile() throws Exception {
        Path root = Files.createTempDirectory("mhp-launch-");
        try {
            Path notExecutable = Files.createDirectory(root.resolve("invalid"));
            Files.createDirectory(notExecutable.resolve(name()));
            Path binary = executable(root.resolve(name()));
            String search = String.join(File.pathSeparator, "", ".", notExecutable.toString(), root.toString());
            assertEquals(List.of(binary.toString(), "panel", "--stdio"), RuntimeProcess.panelCommand(null, search));
            assertEquals(RuntimeProcess.panelCommand(null, search), RuntimeProcess.panelCommand(" ", search));
            assertThrows(IllegalArgumentException.class, () -> RuntimeProcess.panelCommand(null, File.pathSeparator + "."));
        } finally { remove(root); }
    }
    @Test public void commandStringsMissingFilesAndDirectoriesNeverBecomeLaunches() throws Exception {
        Path root = Files.createTempDirectory("mhp-launch-");
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
