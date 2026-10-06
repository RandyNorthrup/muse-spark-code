"""Fake-only workers for the IDE JVM exit regression; no MHP/model calls."""
import os
import pathlib
import signal
import subprocess
import sys
import time
worker = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
pathlib.Path(sys.argv[1]).write_text(f"{os.getpid()}\n{worker.pid}\n")
if sys.argv[2] == "parent-first":
    os._exit(0)
signal.signal(signal.SIGTERM, signal.SIG_IGN)
time.sleep(120)
