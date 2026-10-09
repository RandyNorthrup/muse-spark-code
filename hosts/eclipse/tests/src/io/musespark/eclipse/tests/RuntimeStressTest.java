package io.musespark.eclipse.tests;

import static org.junit.Assert.*;
import io.musespark.eclipse.RuntimeProcess;
import java.io.*;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.junit.Test;

/** Process cases ported from the JetBrains stress suite, without an IDE transport. */
public class RuntimeStressTest {
    private static final long WAIT_SECONDS = 2;
    private static final long POLL_MILLIS = 10;
    private static final String WORKER = "import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); print('ready',flush=True); time.sleep(100)";
    private record Fixture(Process root, ProcessHandle child, RuntimeProcess owner) implements AutoCloseable {
        @Override public void close() throws Exception {
            try { owner.close(); }
            finally { child.destroyForcibly(); root.toHandle().destroyForcibly(); root.waitFor(WAIT_SECONDS, TimeUnit.SECONDS); }
        }
    }
    private static Fixture start(boolean detached) throws Exception {
        String source = "import subprocess,sys,time,signal; signal.signal(signal.SIGTERM,signal.SIG_IGN); child=subprocess.Popen([sys.executable,'-c',sys.argv[1]],stdout=subprocess.PIPE,start_new_session=" + (detached ? "True" : "False") + "); child.stdout.readline(); print(child.pid,flush=True); sys.stdin.readline(); import os; os._exit(0)";
        ProcessBuilder builder = new ProcessBuilder("python3", "-u", "-c", source, WORKER);
        builder.environment().clear(); builder.environment().put("PATH", "/usr/bin:/bin");
        Process root = builder.start();
        ProcessHandle child = ProcessHandle.of(Long.parseLong(new BufferedReader(new InputStreamReader(root.getInputStream())).readLine())).orElseThrow();
        return new Fixture(root, child, new RuntimeProcess(root, code -> fail(code)));
    }
    private static boolean running(ProcessHandle process) throws IOException {
        if (!process.isAlive()) return false;
        if (!System.getProperty("os.name").equals("Linux")) return true;
        try {
            String status = Files.readString(Path.of("/proc", Long.toString(process.pid()), "stat"));
            return !status.substring(status.lastIndexOf(')') + 1).trim().startsWith("Z ");
        } catch (NoSuchFileException ex) { return false; }
    }
    private static void stopped(ProcessHandle child) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(WAIT_SECONDS);
        while (running(child) && System.nanoTime() < deadline) Thread.sleep(POLL_MILLIS);
        assertFalse("retained worker survived its runtime: " + child.pid(), running(child));
    }
    @Test public void closeStopsAnAttachedRuntimeAndWorkerThatIgnoreGracefulStop() throws Exception {
        try (Fixture fixture = start(false)) {
            fixture.owner.close(); assertFalse(fixture.root.isAlive()); stopped(fixture.child);
        }
    }
    @Test public void sigkillOfRootStillStopsReparentedWorker() throws Exception { parentFirst(false, true); }
    @Test public void abruptExitOfRootStillStopsReparentedWorker() throws Exception { parentFirst(false, false); }
    @Test public void abruptExitOfRootStillStopsSeparateSessionWorker() throws Exception { parentFirst(true, false); }
    private static void parentFirst(boolean detached, boolean kill) throws Exception {
        try (Fixture fixture = start(detached)) {
            if (kill) fixture.root.toHandle().destroyForcibly();
            else { fixture.root.getOutputStream().write('\n'); fixture.root.getOutputStream().flush(); }
            assertTrue(fixture.root.waitFor(WAIT_SECONDS, TimeUnit.SECONDS));
            assertTrue("fixture must leave a live reparented worker", running(fixture.child));
            assertEquals(0, fixture.root.descendants().count());
            fixture.owner.close(); stopped(fixture.child);
        }
    }
    @Test public void trackerRetainsAWorkerCreatedAfterConstruction() throws Exception {
        ProcessBuilder builder = new ProcessBuilder("python3", "-u", "-c", "import sys,subprocess,os; sys.stdin.readline(); child=subprocess.Popen([sys.executable,'-c',sys.argv[1]],stdout=subprocess.PIPE); child.stdout.readline(); print(child.pid,flush=True); sys.stdin.readline(); os._exit(0)", WORKER);
        builder.environment().clear(); builder.environment().put("PATH", "/usr/bin:/bin"); Process root = builder.start();
        ProcessHandle child = null;
        try (RuntimeProcess owner = new RuntimeProcess(root, code -> fail(code))) {
            root.getOutputStream().write('\n'); root.getOutputStream().flush();
            child = ProcessHandle.of(Long.parseLong(new BufferedReader(new InputStreamReader(root.getInputStream())).readLine())).orElseThrow();
            var field = RuntimeProcess.class.getDeclaredField("descendants"); field.setAccessible(true);
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(WAIT_SECONDS);
            while (!((Map<?, ?>) field.get(owner)).containsKey(child.pid()) && System.nanoTime() < deadline) Thread.sleep(POLL_MILLIS);
            assertTrue("cadence must observe a worker after startup", ((Map<?, ?>) field.get(owner)).containsKey(child.pid()));
            root.getOutputStream().write('\n'); root.getOutputStream().flush(); assertTrue(root.waitFor(WAIT_SECONDS, TimeUnit.SECONDS));
            owner.close(); stopped(child);
        } finally { if (child != null) child.destroyForcibly(); root.toHandle().destroyForcibly(); }
    }
    @Test public void ideJvmExitStopsAnAttachedRuntimeAndWorker() throws Exception { jvmExit("alive"); }
    @Test public void ideJvmExitStopsAReparentedWorker() throws Exception { jvmExit("parent-first"); }
    @Test public void ideJvmExitStopsASeparateSessionReparentedWorker() throws Exception { jvmExit("detached-parent-first"); }
    private static void jvmExit(String mode) throws Exception {
        Path receipt = Files.createTempFile("eclipse-jvm-exit-", ".pid");
        String classpath = Path.of(RuntimeExitFixture.class.getProtectionDomain().getCodeSource().getLocation().toURI()) + File.pathSeparator + Path.of(RuntimeProcess.class.getProtectionDomain().getCodeSource().getLocation().toURI());
        ProcessBuilder builder = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin/java").toString(), "-cp", classpath, RuntimeExitFixture.class.getName(), receipt.toString(), mode);
        builder.environment().clear(); builder.environment().put("PATH", "/usr/bin:/bin");
        Process helper = builder.start();
        try {
            assertTrue("separate JVM exit stalled", helper.waitFor(WAIT_SECONDS, TimeUnit.SECONDS));
            assertEquals(new String(helper.getErrorStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8), 0, helper.exitValue());
            List<String> pids = Files.readAllLines(receipt); assertEquals(2, pids.size());
            for (String pid : pids) { ProcessHandle handle = ProcessHandle.of(Long.parseLong(pid)).orElse(null); if (handle != null) stopped(handle); }
        } finally {
            helper.destroyForcibly();
            for (String pid : Files.readAllLines(receipt)) ProcessHandle.of(Long.parseLong(pid)).ifPresent(ProcessHandle::destroyForcibly);
            Files.deleteIfExists(receipt);
        }
    }
    @Test public void reusedPidIdentityCannotSignalTheCurrentProcess() throws Exception {
        try (Fixture fixture = start(false)) {
            fixture.root.toHandle().destroyForcibly(); assertTrue(fixture.root.waitFor(WAIT_SECONDS, TimeUnit.SECONDS));
            Class<?> identity = Class.forName("io.musespark.eclipse.RuntimeProcess$Identity");
            var constructor = identity.getDeclaredConstructor(ProcessHandle.class, Instant.class); constructor.setAccessible(true);
            Object mismatched = constructor.newInstance(fixture.child, Instant.EPOCH);
            var current = identity.getDeclaredMethod("current"); current.setAccessible(true);
            assertNull("different start instant refuses the reused pid before signalling", current.invoke(mismatched));
            var field = RuntimeProcess.class.getDeclaredField("descendants"); field.setAccessible(true);
            Object captured = field.get(fixture.owner);
            if (!(captured instanceof Map<?, ?>)) throw new AssertionError("missing retained identities");
            // Reflection injects an OS-reused pid with a different start instant, never a live OS pid reuse.
            Map.class.getMethod("put", Object.class, Object.class).invoke(captured, fixture.child.pid(), mismatched);
            fixture.owner.close();
            assertTrue("mismatched start instant must refuse to kill the current pid", running(fixture.child));
        }
    }
}
