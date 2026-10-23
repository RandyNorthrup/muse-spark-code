"""Fake-only MHP peer; no provider, credential store or network access."""

import json
import os
import sys


def send(value):
    print(json.dumps(value), flush=True)


def receive():
    return json.loads(sys.stdin.readline())


assert os.environ.get("PUBLIC_MARKER") == "public-fixture"
assert not any(name.upper().endswith("_API_KEY") for name in os.environ)
assert "META_KEY" not in os.environ
sys.stderr.write("fixture-only account/path text must never enter the host log\n")
sys.stderr.flush()
initial = receive()
assert initial["method"] == "initialize"
assert initial["params"]["protocolRange"]["minimum"] == "mhp/1.5.0"
send({"jsonrpc": "2.0", "id": initial["id"], "result": {
    "protocolVersion": "mhp/1.5.0", "capabilities": ["lifecycle", "ui", "surfaces"]}})
opened = receive()
assert opened["event"] == "opened"
assert receive()["event"] == "ready"
ready = receive()
assert ready["seq"] == 1 and ready["payload"] == {"type": "ready"}
send({
    "mhp": "1.5", "kind": "panel", "surface": opened["surface"],
    "direction": "toPanel", "seq": 1, "payload": {"type": "attachmentsCleared"},
})
reloaded = receive()
assert reloaded["event"] == "reloaded"
assert reloaded["stateRequest"] == {"type": "ready"}
assert receive()["event"] == "ready"
send({
    "jsonrpc": "2.0", "id": "paid", "method": "ui/confirm",
    "params": {
        "title": "Paid fixture", "message": "USD 0.25; shared daily budget USD 10",
        "choices": [
            {"id": "once", "title": "Allow once"},
            {"id": "always", "title": "Allow always in this workspace"},
            {"id": "deny", "title": "Deny"},
        ],
    },
})
assert receive()["result"] == "once"
