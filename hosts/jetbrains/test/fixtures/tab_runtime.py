"""Fake-only Tab peer: a bad cached range, then two USD 0.50 simulated admissions."""
import json
import os
import sys

assert not any(name.upper().endswith("_API_KEY") for name in os.environ)


def send(value):
    print(json.dumps(value), flush=True)


initial = json.loads(sys.stdin.readline())
assert initial["method"] == "initialize"
send({"jsonrpc": "2.0", "id": initial["id"], "result": {
    "protocolVersion": "mhp/1.5.0", "capabilities": ["lifecycle", "tab"]}})
send({"jsonrpc": "2.0", "id": "register", "method": "tab/register",
      "params": {"languages": ["TEXT"], "trigger": "invoke"}})
assert json.loads(sys.stdin.readline())["result"] is None
count = 0
for line in sys.stdin:
    frame = json.loads(line)
    method = frame.get("method")
    if method == "tab/complete":
        count += 1
        params = frame["params"]
        assert params["uri"].startswith("file:///")
        assert isinstance(params["version"], int)
        assert params["context"]["trigger"] in ("invoke", "automatic")
        if count == 1:
            wrong = dict(params["position"], character=params["position"]["character"] + 1)
            result = [{"id": "misranged", "text": "BAD", "range": {"start": wrong, "end": wrong}}]
        else:
            result = [{"id": 31 if count == 2 else f"completion-{count}", "text": "beta",
                       "range": {"start": params["position"], "end": params["position"]}}] if count <= 3 else []
        send({"jsonrpc": "2.0", "id": frame["id"], "result": result})
    if method in ("tab/accepted", "tab/rejected"):
        with open(sys.argv[1], "a", encoding="utf-8") as output:
            output.write(json.dumps(frame) + "\n")
