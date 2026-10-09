"""Credential-free MHP peer for the native connection stress suite."""
import json
import os
import pathlib
import signal
import subprocess
import sys
import time

mode, receipt_name, release_name = sys.argv[1:]
receipt = pathlib.Path(receipt_name)
release = pathlib.Path(release_name)
worker = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"], start_new_session=mode == "detached-die")
receipt.write_text(str(worker.pid))

def send(value):
    print(json.dumps(value), flush=True)

def read():
    line = sys.stdin.readline()
    return json.loads(line) if line else None

def call(method, params, identity):
    send({"jsonrpc": "2.0", "id": identity, "method": method, "params": params})
    while True:
        frame = read()
        if frame is None:
            sys.exit(0)
        if frame.get("id") == identity:
            return frame

caps = ["lifecycle", "commands", "tab"]
if mode == "metadata":
    caps.append("hostMetadata")
if mode == "metadata":
    while not release.exists():
        time.sleep(0.01)
initialized = call("initialize", {
    "host": {"id": "fake-runtime", "version": "1"},
    "protocolRange": {"minimum": "mhp/1.1.0", "maximumExclusive": "mhp/1.3.0" if mode == "metadata" else "mhp/1.2.0"},
    "capabilities": caps, "locale": "en",
    "theme": {"kind": "dark", "tokens": {}}, "folders": [], "trusted": True,
}, "initialize")
if mode == "metadata" and "error" in initialized:
    time.sleep(120)  # A rejected handshake keeps its pipe open; the host must terminate it.
call("commands/register", {"id": "stress-fixture", "title": "Stress fixture"}, "command")
call("tab/register", {"languages": ["plaintext"], "trigger": "invoke"}, "tab")

if mode == "blocked" or mode == "shutdown":
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    while not release.exists():
        time.sleep(0.01)
    receipt.with_suffix(".ready").write_text("ready")
    time.sleep(120)  # A real OS pipe, deliberately never consumed again.
elif mode == "flood":
    while not release.exists():
        time.sleep(0.01)
    for i in range(10000):
        send({"jsonrpc": "2.0", "id": f"flood-{i}", "method": "ui/input", "params": {"title": "Flood", "prompt": "x" * 65536}})
elif mode == "overflow":
    while not release.exists():
        time.sleep(0.01)
    document = json.loads(receipt.with_suffix(".document").read_text())
    result = call("documents/applyEdits", {**document, "undoLabel": "Overflow fixture", "edits": [{"range": {"start": {"line": 4294967296, "character": 4294967296}, "end": {"line": 4294967296, "character": 4294967301}}, "newText": "WRAPPED"}]}, "overflow")
    receipt.with_suffix(".result").write_text(json.dumps(result))
    while True:
        frame = read()
        if frame is None:
            break
        if frame.get("method") == "tab/complete":
            send({"jsonrpc": "2.0", "id": frame["id"], "result": []})
else:
    pending = None
    while True:
        frame = read()
        if frame is None:
            break
        method = frame.get("method")
        if method == "tab/complete":
            if mode in ("die", "detached-die"):
                os._exit(0)  # Leave the worker reparented, still in the launch group.
            if mode == "late" and pending is None:
                pending = frame["id"]
                receipt.with_suffix(".pending").write_text("pending")
            elif mode == "tab-error":
                send({"jsonrpc": "2.0", "id": frame["id"], "error": {"code": -32603, "message": "FIXTURE_ONLY_PRIVATE_ACCOUNT_FILE_CONTENTS"}})
            else:
                send({"jsonrpc": "2.0", "id": frame["id"], "result": []})
        elif method == "$/cancelRequest" and pending is not None:
            time.sleep(0.05)
            send({"jsonrpc": "2.0", "id": pending, "result": []})
            pending = "settled"
