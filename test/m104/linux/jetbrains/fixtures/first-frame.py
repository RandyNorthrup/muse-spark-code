"""Authored MHP bootstrap peer with a detached, stdio-inheriting worker."""
import json
import os
from pathlib import Path
import subprocess
import sys

initial = json.loads(sys.stdin.readline())
assert initial["method"] == "initialize"
worker = subprocess.Popen(
    [sys.executable, "-c", "import time; time.sleep(120)"], start_new_session=True
)
Path(sys.argv[1]).write_text(str(worker.pid))
print(json.dumps({"jsonrpc": "2.0", "id": initial["id"], "result": {
    "protocolVersion": "mhp/1.2.0", "capabilities": ["lifecycle", "tab"]}}), flush=True)
request = json.loads(sys.stdin.readline())
assert request["method"] == "tab/complete"
os._exit(0)
