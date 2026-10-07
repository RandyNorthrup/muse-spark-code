"""Authored MHP 1.2 qualification peer: no backend, browser, key or paid dispatch."""
import json
import os
import selectors
import sys
from pathlib import Path

receipt = Path(sys.argv[1])
selector = selectors.SelectSelector()
selector.register(sys.stdin, selectors.EVENT_READ)
line = sys.stdin.readline() if selector.select(2) else ""
selector.close()
initialized = False
if line:
    frame = json.loads(line)
    initialized = (
        frame.get("method") == "initialize"
        and frame.get("params", {}).get("protocolRange", {}).get("minimum")
        == "mhp/1.2.0"
    )
    if initialized:
        print(json.dumps({"jsonrpc": "2.0", "id": frame["id"], "result": {
            "protocolVersion": "mhp/1.2.0", "capabilities": ["lifecycle"]}}), flush=True)
receipt.write_text(json.dumps({"initialized": initialized, "credential_variable_present": any(
    name.upper().endswith("_API_KEY") or name.upper() in {
        "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
        "OPENAI_KEY", "ANTHROPIC_KEY", "META_KEY"} for name in os.environ)}))
sys.exit(0 if initialized else 1)
