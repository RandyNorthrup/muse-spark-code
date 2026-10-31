"""Runtime tree ownership without a device-stack/native-FFI Python import.

Windows' bundled .NET compiler builds the private job launcher. The launcher
owns a kill-on-close job before creating the suspended runtime, which
inherits that job. Killing the launcher releases every descendant.
POSIX owns a session.
"""

import os
from pathlib import Path
import signal
import subprocess
import tempfile
import threading
import time

COMPILE_TIMEOUT_S = 20.0
CLEANUP_TIMEOUT_S = 2.0
CLEANUP_RETRY_S = 0.05


class _OwnedProcess:
    def __init__(self, process, directory=None):
        self._process = process
        self._directory = directory
        self.stdout = process.stdout
        self._close_lock = threading.Lock()

    def poll(self):
        return self._process.poll()

    def wait(self, timeout=None):
        return self._process.wait(timeout=timeout)

    def _signal(self, sig):
        if os.name == "nt":
            # The launcher owns the job handle; exit closes it in the OS.
            self._process.terminate()
        else:
            try:
                os.killpg(self._process.pid, sig)
            except ProcessLookupError:
                pass

    def terminate(self):
        self._signal(signal.SIGTERM)

    def kill(self):
        self._signal(getattr(signal, "SIGKILL", signal.SIGTERM))

    def close(self):
        with self._close_lock:
            if self.stdout is not None:
                self.stdout.close()
            deadline = time.monotonic() + CLEANUP_TIMEOUT_S
            while self._directory is not None:
                try:
                    self._directory.cleanup()
                    self._directory = None
                except PermissionError:
                    # Windows can signal process exit just before releasing
                    # the executable's image mapping. Keep ownership and retry.
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(CLEANUP_RETRY_S)


def spawn_runtime(argv, **kwargs):
    """Establish tree ownership before the target runtime can spawn helpers."""
    directory = None
    try:
        if os.name == "nt":
            directory = tempfile.TemporaryDirectory(prefix="muse-spark-thonny-job-")
            launcher = Path(directory.name) / "job.exe"
            source = Path(__file__).with_name("windows_job.cs")
            compiler = Path(os.environ["SystemRoot"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
            subprocess.run([str(compiler), "/nologo", "/target:exe", "/out:" + str(launcher), str(source)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=COMPILE_TIMEOUT_S, creationflags=subprocess.CREATE_NO_WINDOW)
            argv = [str(launcher), *argv]
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        else:
            kwargs["start_new_session"] = True
        return _OwnedProcess(subprocess.Popen(argv, **kwargs), directory)
    except BaseException:
        if directory is not None:
            directory.cleanup()
        raise
