"""Fake-only peer that remains alive with a child after a malformed frame."""
import json
import pathlib
import signal
import subprocess
import sys
import time

receipt = pathlib.Path(sys.argv[1])
release = pathlib.Path(sys.argv[2])
worker = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
receipt.write_text(str(worker.pid))

def stop_parent(_signal, _frame):
    worker.terminate()
    worker.wait(timeout=5)
    sys.exit(0)

signal.signal(signal.SIGTERM, stop_parent)

def send(value):
    print(json.dumps(value), flush=True)

def call(method, params, identity):
    send({"jsonrpc": "2.0", "id": identity, "method": method, "params": params})
    while True:
        frame = json.loads(sys.stdin.readline())
        if frame.get("id") == identity:
            assert "result" in frame
            return

initial = json.loads(sys.stdin.readline())
assert initial["method"] == "initialize"
send({"jsonrpc": "2.0", "id": initial["id"], "result": {
    "protocolVersion": "mhp/1.5.0", "capabilities": initial["params"]["capabilities"]}})
call("commands/register", {"id": "failure-fixture", "title": "Failure fixture"}, "command")
call("tab/register", {"languages": ["plaintext"], "trigger": "invoke"}, "tab")
while not release.exists():
    time.sleep(0.01)
print('{invalid', flush=True)
time.sleep(120)
