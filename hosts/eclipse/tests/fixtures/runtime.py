#!/usr/bin/env python3
"""Authored MHP fake; never starts a provider, shell tool or paid call."""
import json
import sys

initial = json.loads(sys.stdin.readline())
assert initial["method"] == "initialize"
assert initial["params"]["protocolRange"]["minimum"] == "mhp/1.5.0"
print(json.dumps({"jsonrpc": "2.0", "id": initial["id"], "result": {
    "protocolVersion": "mhp/1.5.0", "capabilities": initial["params"]["capabilities"]}}), flush=True)
for line in sys.stdin:
    frame = json.loads(line)
    if len(sys.argv) == 3 and sys.argv[1] == "--receipts":
        with open(sys.argv[2], "a", encoding="utf-8") as receipts:
            receipts.write(json.dumps(frame) + "\n")
    if frame.get("method") != "tab/complete":
        continue
    position = frame["params"]["position"]
    result = [{"id": "fake-completion", "text": "-complete", "range": {"start": position, "end": position}}]
    print(json.dumps({"jsonrpc": "2.0", "id": frame["id"], "result": result}), flush=True)
