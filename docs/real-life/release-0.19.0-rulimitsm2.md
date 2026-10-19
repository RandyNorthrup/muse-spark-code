# Real use — 0.19.0 limits group, macOS round 2 (lane RULIMITSM2)

Version 0.19.0. Proved tree `416490137` (branch `realuse/0190-limits-m2`:
release/0.19.0 with the limits merges plus the Linux round-2 fix commit
`036961608`, which removed the invented 500 maximum on a set
`--max-requests`). No source change in this round: the fix is verified
as-is on macOS. Platform: macmini, macOS 15.7.4 Intel x86_64,
Node v24.21.0, VS Code 1.139.1, Swift 6.2.4, Muse Code CLI 1.4.10 (the
product pins `@muse-code/sdk` 1.4.4; every run logs the schema
fingerprint mismatch pinned `sha256:7c94…` vs served `sha256:5d3b…` and
proceeds).

Product: production bundles from `npm run build` in this worktree (exit
0, budgets hold), driven as `node dist/acp.js`. HOME and all sign-in
variables untouched; the lane sandbox home carries the machine's own
Muse Code sign-in. Scratch workspaces in `temp/` (gitignored):
`temp/scratch-limits-m2/` (exec proof), `temp/scratch-acp-m2/` (fresh
empty folder for the ACP sessions), `temp/scratch-keys/` (key bytes),
`temp/ws-panel` (dev-host window). The macOS-only helper the packed
agent spawns was built the way the build workflow builds it on this OS
(`sh native/darwin/build.sh`, exit 0; gitignored artifact) — without it
no Muse Code session starts at all (see FAIL 1).

The first macOS round (branch `realuse/0190-limits-m`, record
`docs/real-life/release-0.19.0-rulimitsm.md`, NOT merged here) proved
1–500 as a PASS. That bound was ours, not a provider's: this round
re-proves every case against the corrected rule (absent = no limit;
any positive safe integer accepted; 0/negatives refused as not a
count).

## Behaviour 1 — absent `--max-requests` is no limit

`exec --backend modelApi --prompt-file prompt.txt --max-budget-usd 100
--output json`: `"limits":{"budgetUsd":"100","maxRequests":null,
"timeoutSeconds":1800}`, run reached the backend (exit 3, only the
missing provider key; the sandbox has no usable credential store).
PASS: parsing demanded no request limit.

## Behaviour 2 — 501 and 1000000 reach the backend; 0 and -5 refuse

- `--max-requests 501` → `"maxRequests":501`, backend reached (exit 3).
  PASS (round 1 called this exact case exit-2 PASS; it is correct now).
- `--max-requests 1000000` → `"maxRequests":1000000`, backend reached.
  PASS.
- `--max-requests 0` → exit 2, `Invalid number or limit`. PASS.
- `--max-requests=-5` → exit 2, `Invalid number or limit`. PASS
  (bare `-5` is the parser's ambiguous-flag case; `=` form refused as
  not a count).

## Behaviour 3 — Action input the same

`action/lib/tools.mjs` `parseActionInputs` driven directly
(`MUSE_INPUT_BACKEND=modelApi`, budget `100`): `1`/`500`/`501`/
`1000000` → that `maxRequests`; unset → `null`; `0` → `InputError:
MUSE_INPUT_MAX_REQUESTS must be a positive integer`; `-1`/`abc`/
`30.5` → `InputError: ... must be an integer`. PASS.

## Behaviour 4 — `--max-budget-usd` above 20 accepted

`--max-budget-usd 2500.75` → `"budgetUsd":"2500.75"`, backend reached.
`--max-budget-usd 100.50` with no `--max-requests` →
`"maxRequests":null`. PASS: no $20 ceiling.

## Behaviour 5 — no tool-round cap

No 50-round constant exists: `EXEC_MAX_REQUESTS` is gone from
`src/shared/constants.ts`, and the only `maxToolCalls` in
`src/core/backends/modelapi/ModelApiHost.ts` is the provider's own
per-request `max_tool_calls` field, gated on the selected model's
capability record plus the person-set web-search bound — not a harness
round cap. PASS by code read plus the completed turns below (no turn
stopped on a count).

## Behaviour 6 — one real headless turn, unset limits

`exec --prompt-file prompt.txt --output json` on the Muse Code backend:
exit 0, `completed`/`end_turn`, model `muse-wonder-1.0`,
finalMessage `ok`, all limits null. PASS.

## Behaviour 7 — contributor tier named on every request (§0)

- CLI-direct diagnostic probe (not a product turn): `muse exec --model
muse-spark-1.3-contributor --contributor-mode on --prompt-file
prompt.txt` → `ok`. The entitlement exists.
- Packed exec `--model muse-spark-1.3-contributor` → exit 2, `This
model is not available for this run.` The served session's own config
  refuses it; the product passes no per-process contributor flag.
- ACP `session/set_config_option` model →
  `muse-spark-1.3-contributor` → `Invalid params:
muse-spark-1.3-contributor`. Offered models are `muse-wonder-1.0`
  (current), `muse-wonder-full-1.0`, `muse-spark-1.3`, `muse-spark-1.2`.
- Same finding as the Linux round, live again here: the refusal is the
  provider's own tier gate, surfaced exactly, never a PASS.
- Provider-line audit (§0): across this lane's CLI session records for
  today's runs, 0 packed-product provider lines name the lane model.
  Requests name `muse-wonder-1.0` (43 `"model"`/`"model_id"` lines); the
  wire responses are tagged `muse-wonder-1.0-contributor` (8 lines: the
  provider serves the contributor tier of the asked model). The lane
  model names appear only in the CLI-direct probe's own records
  (requested and served, answered `ok`).

## Behaviour 8 — two-turn ACP conversation, file byte-exact

Packed agent over stdio (`node dist/acp.js`, fresh empty workspace,
Manual mode, zero permission prompts fired — file edits ask nothing):
session `01a150d0-799c-76f2-af17-655d545ed26c`. Turn 1
(`Reply with exactly … ok`) → `ok`, `end_turn`. Turn 2 (create
`hello.txt`, exact bytes `hello world`) → Write tool call completed,
`ok`, `end_turn`. `xxd hello.txt`: `6865 6c6c 6f20 776f 726c 64`,
11 bytes, no newline. PASS.

## Behaviour 9 — provider keys never refused for looks (PR #159)

With a scratch no-secret `providers.json` holding the in-repo groq
preset row (lane sandbox config dir; removed afterwards):

- Raw bytes `FF FE` piped to `auth set --provider groq` → `That input
is not text (it is not valid UTF-8), so it was not used.`, exit 1, no
  store, no network. PASS.
- `test-key` → `This looks like placeholder text, not a key. Use it
anyway?`, then `This computer's credential store cannot be used
(store-unavailable)`, exit 1. PASS (nothing stored; the sandbox
  blocks the store).
- `providers list` during: the groq row with no key; after removing
  the scratch file: `No providers are configured.` PASS.

Observation (not a limits FAIL): the store-unavailable sentence names
Linux Secret Service wording on macOS too.

## Behaviour 10 — the real panel (dev-host, unpacked)

§2 as specified (install the packed `.vsix`) stays blocked (below).
Supplementary, as in the Linux round: the same production `dist/`
bundles as a dev-host extension (`--extensionDevelopmentPath`, fresh
empty folder, isolated profile in `temp/`, CDP text reads only, no
screenshots; process killed afterwards):

- Palette lists the extension's commands, first-use flows included
  (`Manage Skills`, `Memory`, `MCP Servers`, `Install Bundled Skills
for Muse Code`, …). `Muse Spark: Open in Sidebar` creates the
  extension's webview (`purpose=webviewView`,
  `extensionId=RandyNorthrup.muse-spark-code`). `Muse Spark: Show
Memory` runs with no toast.
- Open limitation, same as the platform lane's: the chat webview stays
  bootstrap-only in this headless run (8 nodes, no `#root`, 0 text
  chars), so no panel turn was sent and the model picker could not be
  read from the panel. The ACP `configOptions` above show the same 4
  serve models. No model call was spent on the panel.

## FAILs found

1. **Packed Muse Code sessions all failed before any model was
   reached** (`session/new` → `-32603 Internal error`, exec
   `backend_unavailable`): the agent spawns
   `native/darwin/muse-dictate`, and this worktree had never built it
   (`sh native/darwin/build.sh` had not been run here). Exact detail:
   `spawn /Users/randy/lanes/RULIMITSM2/native/darwin/muse-dictate
ENOENT`. Not a code defect: fixed by building the gitignored helper
   the sanctioned way (exit 0, only a `SecAccessCreate` deprecation
   warning), then every session and turn above passed on a rebuild-free
   retry. Round-1 macOS had built it in its own worktree, which is why
   it never saw this.
2. No FAIL in limits code: the 500-removal verifies as committed.

## Not exercised live (stated plainly)

- `npm run package`: `Required Linux created-path helper excluded
from VSIX: x64` (the universal still demands both Linux helpers;
  PR #246 per-platform packaging is not on this branch).
- `npm run package:acp`: `Required Linux created-path helper is
missing: native/linux/x64/muse-created` (past the schema gate; the
  darwin helper now builds, the Linux ones cannot build on macOS).
  Per the brief's rule 3 the per-platform fix belongs with #246/the
  lead; no workaround built. Same conclusion as the Linux round.
- Model API inference and in-session request-cap/budget admission:
  no provider key on this rig.
- `check:catches` on group-touched files: the join's, per the brief.

## Calls and gates

Model calls: 4 of 40 (1 CLI-direct contributor probe, 2 ACP turns, 1
packed exec turn, all answered `ok`); spend $0.00 of $2.00
(subscription backend, `costUsd` null; no Model API inference, no key
read). Refusals made no model call.

Gates on the final tree (true exit codes, repository's own timeout,
never raised): `npm run build` 0 (budgets hold); vitest
`execArgs + runLedger + actionMaxRequests` 99 passed; `schema:exec
--check` match; `check:reference` pass; typecheck 0; eslint 0 with
zero warnings on tracked files (49 errors, all in the lane's own
gitignored `temp/` probe scripts, none in the repo); prettier clean;
`deadcode` 0; `cycles` 0; duplication 0 clones; `check:l10n` 0
problems; `check:host-api` 0 problems; `check:plan` 0 drift; SAST 0;
`security:audit` 0 (2 advisories, 1 documented exception).
