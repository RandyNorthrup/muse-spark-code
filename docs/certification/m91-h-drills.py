"""M91-H fake-only guard drills. Run on the Kubuntu rig, never on Windows."""

import hashlib
import re
import subprocess
import sys
from pathlib import Path

if sys.platform != "linux":
    raise SystemExit("Run this certification on the Kubuntu rig.")

ROOT = Path(__file__).resolve().parents[2]
HANDLERS = "src/core/backends/modelapi/hookHandlers.ts"
HOOKS = "src/core/backends/modelapi/hooks.ts"
HOST = "src/core/backends/modelapi/ModelApiHost.ts"
SIDE = "src/host/review/museCodeHookModels.ts"
HTTP = "test/unit/hookHttpHandlers.test.ts"
MODEL = "test/unit/hookModelHandlers.test.ts"
MCP = "test/unit/hookMcpToolHandlers.test.ts"
MUSE = "test/unit/museCodeHookModels.test.ts"


def run(command):
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    output = re.sub(r"\x1b\[[0-9;]*m", "", result.stdout + result.stderr)
    return result.returncode, output


for files in ([HTTP, MCP, "test/unit/hookHttpRequest.test.ts"],
              [MODEL, MUSE, "test/unit/paidHookModels.test.ts"]):
    code, output = run(["npx", "vitest", "run", *files, "--maxWorkers=1"])
    if code != 0:
        print(output, flush=True)
        raise SystemExit("Baseline failed; no mutation was applied.")
    print("BASELINE " + ", ".join(files) + " green", flush=True)

# Each tuple names an actual source guard and an independently asserted failure.
DRILLS = [
    ("scope", HOOKS, [("if (source !== 'user')", "if (false)")], HTTP,
     "refuses managed HTTP handlers"),
    ("mixed-fields", HOOKS, [("value[field] !== undefined && !fields.includes(field)", "false")], HTTP,
     "refuses managed HTTP handlers"),
    ("https", HANDLERS, [("url.protocol !== 'https:' || url.username !== '' || url.password !== ''", "false")], HTTP,
     "refuses off-list hosts"),
    ("allowlist", HANDLERS, [("if (!isHttpHostAllowed(host, policy.httpAllowlist()))", "if (false)")], HTTP,
     "refuses off-list hosts"),
    ("wildcard", HANDLERS, [("name.endsWith(`.${suffix}`)", "(name === suffix || name.endsWith(`.${suffix}`))")], HTTP,
     "matches subdomains only"),
    ("ip-literal", HANDLERS, [("if (isIpLiteral(name))", "if (false)")], HTTP,
     "refuses IP literals"),
    ("network", HANDLERS, [("if (!policy.isNetworkAllowed())", "if (false)")], HTTP,
     "refuses off-list hosts"),
    ("redirect", HANDLERS, [("if (isRedirect(result.status))", "if (false)"),
                            ("if (!isAnswer(result.status))", "if (false)")], HTTP,
     "refuses redirects"),
    ("payload", HANDLERS, [("if (Buffer.byteLength(payloadJson) > HOOK_STDIN_MAX_BYTES)", "if (false)")], HTTP,
     "refuses an oversized payload"),
    ("typed-grant", HOOKS, [("answer.approvalDecision === 'allow' ? undefined : answer.approvalDecision", "answer.approvalDecision")], HTTP,
     "typed handlers cannot grant"),
    ("paid-switch", HANDLERS, [("if (!policy.isHookModelsOn())", "if (false)")], MODEL,
     "refuses with the paid feature off"),
    ("price", HANDLERS, [("if (modelApiPaidTier(modelId) === undefined)", "if (false)")], MODEL,
     "refuses a model with no verified price"),
    ("consent", HANDLERS, [("if (!isAllowed)", "if (false)")], MODEL,
     "asks the paid-use popup before any model request"),
    ("daily-budget", "src/core/backends/modelapi/hookModelEntry.ts",
     [("context.deps.hookModelDailyBudget?.reserve(", "undefined && context.deps.hookModelDailyBudget?.reserve(")], MODEL,
     "sends no hook request when daily-budget admission refuses it"),
    ("settlement", "src/core/backends/modelapi/sessionBudget.ts",
     [("costUsd = estimateCostUsd(", "costUsd = reservedUsd + 0 * estimateCostUsd(")], MODEL,
     "reserves the shared daily budget before a request, and settles actual cost"),
    ("mcp-approval", HOST, [("if (!approval.isApproved)", "if (false)")], MCP,
     "denial on the helper card"),
    ("read-only-tools", HOST, [(".filter((tool) => HOOK_MODEL_READ_TOOLS.has(tool.name))", ".filter(() => true)")], MODEL,
     "agent helpers expose only read tools"),
    ("side-reuse", SIDE, [("if (side.host === job.host && side.modelId === job.modelId)", "if (false)")], MUSE,
     "runs one turn of a hidden side session"),
    ("side-tools", SIDE, [("!HOOK_TURN_ITEM_KINDS.has(event.item.kind)", "false")], MUSE,
     "fails the hook when the turn uses a tool"),
]

for name, relative, replacements, suite, expected in DRILLS:
    path = ROOT / relative
    original = path.read_bytes()
    digest = hashlib.sha256(original).hexdigest()
    changed = original.decode("utf-8")
    for before, after in replacements:
        if before not in changed:
            raise SystemExit(f"Mutation anchor missing: {name}: {before}")
        changed = changed.replace(before, after)
    try:
        path.write_bytes(changed.encode("utf-8"))
        code, output = run(["npx", "vitest", "run", suite, "--maxWorkers=1"])
        if code == 0 or not re.search(r"FAIL[^\n]*" + re.escape(expected), output):
            print(output, flush=True)
            raise SystemExit(f"Drill did not fail as intended: {name}")
    finally:
        path.write_bytes(original)
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise SystemExit(f"Restoration mismatch: {name}")
    print(f"DRILL {name}: exit={code}; {expected}; restored SHA256={digest}", flush=True)

path = ROOT / "l10n/ui.de.json"
original = path.read_bytes()
try:
    path.write_bytes(original.replace(b'"hookModelPaidOff"', b'"hookModelPaidOffRemoved"'))
    code, output = run(["npm", "run", "check:l10n"])
    if code == 0 or "hookModelPaidOff" not in output:
        raise SystemExit("Localization parity drill did not fire.")
finally:
    path.write_bytes(original)
    if path.read_bytes() != original:
        raise SystemExit("Localization restoration mismatch.")
print("DRILL localization: missing translated key rejected; byte-exact restoration", flush=True)

for files in ([HTTP, MCP, "test/unit/hookHttpRequest.test.ts"],
              [MODEL, MUSE, "test/unit/paidHookModels.test.ts"]):
    code, output = run(["npx", "vitest", "run", *files, "--maxWorkers=1"])
    if code != 0:
        print(output, flush=True)
        raise SystemExit("Restored green failed.")
    print("RESTORED " + ", ".join(files) + " green", flush=True)

code, output = run(["npm", "run", "check:l10n"])
print(output, flush=True)
raise SystemExit(code)
