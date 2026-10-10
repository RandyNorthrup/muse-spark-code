package io.musespark.eclipse;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/** Same retained pid/start-instant model as the JetBrains runtime owner. */
public final class RuntimeProcess implements AutoCloseable {
    private static final long SNAPSHOT_MILLIS = 10;
    private static final long STOP_SECONDS = 2;
    private static final long STOP_MILLIS = TimeUnit.SECONDS.toMillis(STOP_SECONDS);
    private record Identity(ProcessHandle handle, Instant started) {
        ProcessHandle current() {
            ProcessHandle current = ProcessHandle.of(handle.pid()).orElse(null);
            return current != null && started.equals(current.info().startInstant().orElse(null)) ? current : null;
        }
    }
    private final Process process;
    private final Identity root;
    private final Map<Long, Identity> descendants = new ConcurrentHashMap<>();
    private final AtomicBoolean closed = new AtomicBoolean();
    private final AtomicBoolean trackingStopped = new AtomicBoolean();
    private final Consumer<String> log;
    private final Thread tracker;
    private final Thread shutdown;
    private static final String AGENT_PACKAGE = "muse-spark-code-acp";
    private static final String RUNTIME_PATH_INVALID = "MHP_RUNTIME_PATH_INVALID";
    /** Resolve a complete command before launch; PATH never falls back to the workspace. */
    public static List<String> panelCommand(String configured, String searchPath) throws IOException {
        return panelCommand(configured, searchPath, File.separatorChar == '\\');
    }
    /** Platform selector exposed for cross-platform launch contract tests. */
    public static List<String> panelCommand(String configured, String searchPath, boolean windows) throws IOException {
        if (configured != null && !configured.isBlank()) {
            if (configured.stripLeading().startsWith("[")) {
                var pair = Json.parse(configured);
                if (!pair.isJsonArray() || pair.getAsJsonArray().size() != 2) throw new IllegalArgumentException(RUNTIME_PATH_INVALID);
                for (var value : pair.getAsJsonArray())
                    if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) throw new IllegalArgumentException(RUNTIME_PATH_INVALID);
                Path node = nativeNode(Path.of(pair.getAsJsonArray().get(0).getAsString()), windows);
                Path script = agentScript(Path.of(pair.getAsJsonArray().get(1).getAsString()));
                return List.of(node.toString(), script.toString(), "panel", "--stdio");
            }
            Path candidate = Path.of(configured);
            if (!candidate.isAbsolute()) throw new IllegalArgumentException(RUNTIME_PATH_INVALID);
            return runtimeCommand(candidate, searchPath, windows);
        }
        for (Path directory : pathDirectories(searchPath)) {
            Path nativeRuntime = directory.resolve(AGENT_PACKAGE + (windows ? ".exe" : ""));
            if (Files.isRegularFile(nativeRuntime) && Files.isExecutable(nativeRuntime)) return runtimeCommand(nativeRuntime, searchPath, windows);
            Path shim = directory.resolve(AGENT_PACKAGE + ".cmd");
            if (windows && Files.isRegularFile(shim)) return runtimeCommand(shim, searchPath, true);
        }
        throw new IllegalArgumentException(RUNTIME_PATH_INVALID);
    }
    private static List<Path> pathDirectories(String searchPath) {
        List<Path> directories = new ArrayList<>();
        for (String directory : (searchPath == null ? "" : searchPath).split(java.util.regex.Pattern.quote(File.pathSeparator))) {
            if (directory.isBlank()) continue;
            try {
                Path path = Path.of(directory); if (path.isAbsolute()) directories.add(path);
            } catch (java.nio.file.InvalidPathException ex) { /* An unusable PATH entry never becomes a workspace search. */ }
        }
        return directories;
    }
    private static List<String> runtimeCommand(Path candidate, String searchPath, boolean windows) throws IOException {
        Path executable = candidate.toRealPath();
        if (!Files.isRegularFile(executable)) throw new IllegalArgumentException(RUNTIME_PATH_INVALID);
        if (windows && executable.getFileName().toString().equalsIgnoreCase(AGENT_PACKAGE + ".cmd")) {
            // npm puts its Windows shim in the prefix and its package beneath
            // node_modules. Never read the shim or ask a shell to interpret it.
            Path prefix = executable.getParent();
            Path expectedPackage = prefix.resolve("node_modules").resolve(AGENT_PACKAGE);
            // toRealPath also detects Windows junctions that NOFOLLOW_LINKS may
            // report as directories. Nothing below the canonical prefix relocates.
            for (Path directory = expectedPackage.resolve("dist"); !directory.equals(prefix); directory = directory.getParent()) {
                if (!Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS) || !directory.toRealPath().equals(directory))
                    throw new IllegalArgumentException(RUNTIME_PATH_INVALID);
            }
            Path script = agentScript(expectedPackage.resolve("dist/acp.js"));
            List<Path> nodeDirectories = new ArrayList<>();
            nodeDirectories.add(prefix); nodeDirectories.addAll(pathDirectories(searchPath));
            for (Path directory : nodeDirectories) {
                Path node = directory.resolve("node.exe");
                if (Files.isRegularFile(node) && Files.isExecutable(node))
                    return List.of(nativeNode(node, true).toString(), script.toString(), "panel", "--stdio");
            }
            throw new IllegalArgumentException(RUNTIME_PATH_INVALID);
        }
        if (!Files.isExecutable(executable) || (windows && !executable.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".exe")))
            throw new IllegalArgumentException(RUNTIME_PATH_INVALID);
        return List.of(executable.toString(), "panel", "--stdio");
    }
    private static Path nativeNode(Path candidate, boolean windows) throws IOException {
        if (!candidate.isAbsolute()) throw new IllegalArgumentException(RUNTIME_PATH_INVALID);
        Path node = candidate.toRealPath();
        if (!Files.isRegularFile(node) || !Files.isExecutable(node) || !node.getFileName().toString().equalsIgnoreCase(windows ? "node.exe" : "node"))
            throw new IllegalArgumentException(RUNTIME_PATH_INVALID);
        return node;
    }
    private static Path agentScript(Path candidate) throws IOException {
        if (!candidate.isAbsolute() || !candidate.endsWith(Path.of("dist", "acp.js")))
            throw new IllegalArgumentException(RUNTIME_PATH_INVALID);
        Path pkg = candidate.getParent().getParent().toRealPath();
        Path script = candidate.toRealPath();
        Path manifest = pkg.resolve("package.json").toRealPath();
        if (!Files.isRegularFile(script) || !script.equals(pkg.resolve("dist/acp.js")) || !Files.isRegularFile(manifest) || !manifest.equals(pkg.resolve("package.json")))
            throw new IllegalArgumentException(RUNTIME_PATH_INVALID);
        var identity = Json.parse(Files.readString(manifest));
        if (!identity.isJsonObject()) throw new IllegalArgumentException(RUNTIME_PATH_INVALID);
        var name = identity.getAsJsonObject().get("name");
        if (name == null || !name.isJsonPrimitive() || !name.getAsJsonPrimitive().isString() || !AGENT_PACKAGE.equals(name.getAsString()))
            throw new IllegalArgumentException(RUNTIME_PATH_INVALID);
        return script;
    }
    public RuntimeProcess(Process process, Consumer<String> log) {
        this.process = process; this.log = log;
        ProcessHandle handle = process.toHandle();
        Instant started = handle.info().startInstant().orElse(null);
        root = started == null ? null : new Identity(handle, started);
        tracker = new Thread(() -> {
            while (!trackingStopped.get()) {
                snapshotDescendants();
                try { Thread.sleep(SNAPSHOT_MILLIS); }
                catch (InterruptedException ex) { break; }
            }
        }, "Muse runtime descendants");
        tracker.setDaemon(true);
        shutdown = new Thread(this::forceStop, "Muse runtime JVM shutdown");
        snapshotDescendants();
        Runtime.getRuntime().addShutdownHook(shutdown);
        tracker.start();
    }
    public synchronized void snapshotDescendants() {
        try { captureDescendants(); }
        catch (RuntimeException ex) { log.accept("MHP_PROCESS_SNAPSHOT_FAILURE"); }
    }
    private void captureDescendants() {
        descendants.entrySet().removeIf(entry -> {
            ProcessHandle current = entry.getValue().current(); return current == null || !current.isAlive();
        });
        ProcessHandle currentRoot = root == null ? null : root.current();
        List<ProcessHandle> parents = currentRoot != null && currentRoot.isAlive() ? List.of(currentRoot) : descendants.values().stream().map(Identity::current).filter(Objects::nonNull).toList();
        for (ProcessHandle parent : parents) {
            try (var children = parent.descendants()) {
                children.forEach(child -> child.info().startInstant().ifPresent(started -> descendants.put(child.pid(), new Identity(child, started))));
            }
        }
    }
    private void signal(Identity identity, boolean force) {
        try {
            ProcessHandle current = identity == null ? null : identity.current();
            if (current != null) { if (force) current.destroyForcibly(); else current.destroy(); }
        } catch (RuntimeException ex) { log.accept("MHP_PROCESS_CLEANUP_FAILURE"); }
    }
    private void forceStop() {
        snapshotDescendants();
        trackingStopped.set(true);
        List<Identity> captured = new ArrayList<>(descendants.values());
        Collections.reverse(captured);
        captured.forEach(child -> signal(child, true));
        signal(root, true);
        tracker.interrupt();
    }
    @Override public void close() {
        if (!closed.compareAndSet(false, true)) return;
        snapshotDescendants();
        try {
            try {
                // Give the supervising runtime its bounded stop opportunity before its children.
                signal(root, false);
                process.waitFor(STOP_SECONDS, TimeUnit.SECONDS);
            } finally { forceStop(); }
            if (!process.waitFor(STOP_SECONDS, TimeUnit.SECONDS)) log.accept("MHP_PROCESS_EXIT_TIMEOUT");
            tracker.join(STOP_MILLIS);
        } catch (InterruptedException ex) {
            log.accept("MHP_PROCESS_WAIT_INTERRUPTED"); Thread.currentThread().interrupt();
        } finally {
            try { Runtime.getRuntime().removeShutdownHook(shutdown); }
            catch (IllegalStateException ex) { /* The JVM is already running the hook. */ }
        }
    }
}
