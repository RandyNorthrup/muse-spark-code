#!/usr/bin/env python3
"""Authored MHP fake; never starts a provider, shell tool or paid call."""
import json
import sys

print(json.dumps({"jsonrpc": "2.0", "id": "fake-init", "method": "initialize", "params": {
    "host": {"id": "eclipse", "version": "4.38"},
    "protocolRange": {"minimum": "mhp/1.0.0", "maximumExclusive": "mhp/1.2.0"},
    "capabilities": ["lifecycle", "workspace", "documents", "editor", "diagnostics", "window", "tab"],
    "locale": "en", "theme": {"kind": "light", "tokens": {}}, "folders": [], "trusted": False
}}), flush=True)
for line in sys.stdin:
    frame = json.loads(line)
    if frame.get("method") != "tab/complete":
        continue
    position = frame["params"]["position"]
    result = [{"id": "fake-completion", "text": "-complete", "range": {"start": position, "end": position}}]
    print(json.dumps({"jsonrpc": "2.0", "id": frame["id"], "result": result}), flush=True)
