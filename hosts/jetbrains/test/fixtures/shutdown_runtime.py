"""Fake-only workers for the IDE JVM exit regression; no MHP/model calls."""
import os
import pathlib
import signal
import subprocess
import sys
import time
receipt = pathlib.Path(sys.argv[1])
worker_code = "import time; time.sleep(120)"
if sys.argv[2] == "detached-cooperative":
    worker_code = """import pathlib,signal,sys,time
receipt = pathlib.Path(sys.argv[1])
def stop(signum, frame):
    receipt.with_suffix('.signal').write_text('child-signalled')
    sys.exit(0)
signal.signal(signal.SIGTERM, stop)
receipt.with_suffix('.workerready').write_text('ready')
time.sleep(120)
"""
worker = subprocess.Popen([sys.executable, "-c", worker_code, str(receipt)], start_new_session=sys.argv[2].startswith("detached"))
if sys.argv[2] != "detached-cooperative":
    receipt.write_text(f"{os.getpid()}\n{worker.pid}\n")
if sys.argv[2] == "detached-parent-first":
    while not pathlib.Path(sys.argv[1]).with_suffix(".release").exists():
        time.sleep(0.01)
if sys.argv[2] in ("parent-first", "detached-parent-first"):
    os._exit(0)
def stop_supervisor(signum, frame):
    # Allow an already-signalled child to acknowledge before checking the cleanup order.
    time.sleep(0.05)
    receipt.with_suffix(".stopped").write_text("child-first" if receipt.with_suffix(".signal").exists() else "supervisor-first")
    worker.terminate()
    worker.wait()
    sys.exit(0)

signal.signal(signal.SIGTERM, stop_supervisor if sys.argv[2] == "detached-cooperative" else signal.SIG_IGN)
if sys.argv[2] == "detached-cooperative":
    while not receipt.with_suffix(".workerready").exists():
        time.sleep(0.01)
    receipt.write_text(f"{os.getpid()}\n{worker.pid}\n")
time.sleep(120)
