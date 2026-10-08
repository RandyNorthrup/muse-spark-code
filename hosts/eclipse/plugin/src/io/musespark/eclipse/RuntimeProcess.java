package io.musespark.eclipse;

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
