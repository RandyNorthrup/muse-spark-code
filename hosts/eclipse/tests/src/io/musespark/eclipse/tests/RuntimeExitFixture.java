package io.musespark.eclipse.tests;

import io.musespark.eclipse.RuntimeProcess;
import java.io.*;
import java.nio.file.*;
import java.util.concurrent.TimeUnit;

/** Separate JVM proves teardown runs when the IDE exits without an explicit close. */
public final class RuntimeExitFixture {
    private RuntimeExitFixture() { }
    public static void main(String[] arguments) throws Exception {
        Path receipt = Path.of(arguments[0]);
        boolean parentFirst = !arguments[1].equals("alive");
        String source = "import subprocess,sys,os; child=subprocess.Popen([sys.executable,'-c',\"import time,signal; signal.signal(signal.SIGTERM,signal.SIG_IGN); print('ready',flush=True); time.sleep(100)\"],stdout=subprocess.PIPE,start_new_session=" + (arguments[1].equals("detached-parent-first") ? "True" : "False") + "); child.stdout.readline(); print(child.pid,flush=True); sys.stdin.readline(); os._exit(0)";
        ProcessBuilder builder = new ProcessBuilder("python3", "-u", "-c", source);
        builder.environment().clear(); builder.environment().put("PATH", "/usr/bin:/bin");
        Process root = builder.start();
        String child = new BufferedReader(new InputStreamReader(root.getInputStream())).readLine();
        new RuntimeProcess(root, code -> { throw new IllegalStateException(code); });
        Files.writeString(receipt, root.pid() + "\n" + child + "\n");
        if (parentFirst) {
            root.getOutputStream().write('\n'); root.getOutputStream().flush();
            if (!root.waitFor(2, TimeUnit.SECONDS)) throw new IllegalStateException("fixture root did not exit");
        }
    }
}
