"""Fake-only panel runtime. Frozen MHP/shared UI shapes; no model or credentials."""
import json
import os
import sys

assert not any(name.upper().endswith("_API_KEY") for name in os.environ)
sequence = {}
turns = {}
receipt = sys.argv[1] if len(sys.argv) > 1 else None


def send(value):
    print(json.dumps(value), flush=True)


def panel(surface, payload):
    sequence[surface] = sequence.get(surface, 0) + 1
    send({"mhp": "1.5", "kind": "panel", "surface": surface,
          "direction": "toPanel", "seq": sequence[surface], "payload": payload})


def event(surface, value):
    panel(surface, {"type": "agentEvent", "event": value})


def record(value):
    if receipt:
        with open(receipt, "a", encoding="utf-8") as output:
            output.write(json.dumps(value) + "\n")


initial = json.loads(sys.stdin.readline())
assert initial["method"] == "initialize"
send({"jsonrpc": "2.0", "id": initial["id"], "result": {
    "protocolVersion": "mhp/1.5.0", "capabilities": ["lifecycle", "ui", "surfaces"]}})
settings = {
    "preferredLocation": "panel", "initialPermissionMode": "manual", "autosave": False,
    "attachOpenFile": False, "useCtrlEnterToSend": False, "hideOnboarding": True,
    "focusView": False, "respectGitIgnore": True, "confidentialWorkspace": False,
    "allowDangerouslySkipPermissions": False, "archiveInactiveSessions": 0,
    "modelApiReplyUsage": False, "museCodeAutoReviewer": False,
    "schedules": False, "estimator.optimize": "cost",
}
for line in sys.stdin:
    frame = json.loads(line)
    if frame.get("kind") != "panel":
        continue
    surface, payload = frame["surface"], frame["payload"]
    kind = payload["type"]
    if kind == "ready":
        panel(surface, {"type": "init", "emptyStateHint": "Fake runtime fixture",
                        "composerPlaceholder": "Message the fake runtime", "settings": settings})
        panel(surface, {"type": "surfaceState", "sessionId": "native-ui-session"})
        panel(surface, {"type": "authState", "status": "signedIn", "backend": "museCode"})
        panel(surface, {"type": "sessionInfo", "sessionId": "native-ui-session", "modelId": "fake-only"})
    elif kind == "sendMessage":
        record({"type": kind, "text": payload["text"]})
        number = turns.get(surface, 0) + 1
        turns[surface] = number
        turn = f"turn-{number}"
        panel(surface, {"type": "turnAccepted", "localId": payload["localId"], "turnId": turn, "disposition": "started"})
        event(surface, {"type": "turnStarted", "turnId": turn})
        item = {"itemId": f"answer-{number}", "kind": "agentMessage", "status": "running", "turnId": turn}
        event(surface, {"type": "itemStarted", "item": item})
        event(surface, {"type": "textDelta", "itemId": item["itemId"], "field": "text",
                        "delta": "The shared panel is rendering in JetBrains. This is a fake runtime."})
        tool = f"tool-{number}"
        event(surface, {"type": "itemStarted", "item": {"itemId": tool, "kind": "toolCall",
                       "status": "running", "turnId": turn, "tool": "write_file", "args": "{}"}})
        approval = f"approval-{number}"
        event(surface, {"type": "approvalRequested", "approvalId": approval, "itemId": tool,
                       "toolName": "write_file", "rawArgs": "{}",
                       "requirementId": {"approvalId": approval, "sourceIndex": 0},
                       "subject": {"kind": "fileAccess", "path": "fixture.txt", "access": "write"},
                       "availableChoices": [
                           {"choiceId": "fixture-once", "label": "Allow once", "decision": "approved", "scope": "once"},
                           {"choiceId": "fixture-deny", "label": "Deny", "decision": "abort", "scope": "once"}],
                       "isJudgeEscalated": False, "isProtectedWrite": False})
    elif kind == "decideApproval":
        record(payload)
        event(surface, {"type": "approvalResolved", "approvalId": payload["approvalId"],
                        "itemId": f"tool-{turns[surface]}",
                        "decision": "approved" if payload["choiceId"] == "fixture-once" else "abort", "resolvedBy": "user"})
        event(surface, {"type": "itemCompleted", "item": {"itemId": f"tool-{turns[surface]}",
                       "kind": "toolCall", "tool": "write_file", "args": "{}",
                       "status": "completed" if payload["choiceId"] == "fixture-once" else "failed"}})
        if payload["choiceId"] == "fixture-once":
            event(surface, {"type": "turnCompleted", "turnId": f"turn-{turns[surface]}", "terminal": "completed"})
    elif kind == "cancelTurn":
        record(payload)
        event(surface, {"type": "turnCompleted", "turnId": f"turn-{turns[surface]}", "terminal": "cancelled"})
