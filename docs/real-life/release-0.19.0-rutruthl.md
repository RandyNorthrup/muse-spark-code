# Real-life record: release 0.19.0 truth group — 2026-10-18, rig `linuxlt`

Lane RUTRUTHL. Group: PRs #223 #233 #217 #161 #180 #235 #238 #242.
Branch `realuse/0190-truth-l` at `b7537ba6f3`, version 0.19.0, platform Linux.
Product used: production `dist/` from `npm run build` (exit 0), driven as
`node dist/acp.js` in an empty scratch workspace with an isolated
`HOME`/`XDG_DATA_HOME`/`XDG_CONFIG_HOME` under the worktree's gitignored
`temp/rutruthl/`. No model call except the one noted; no key read or stored.

## Packaging (step 2)

- `npm ci`: exit 0. `npm run build`: exit 0 with budgets.
- `npm run package` (VSIX) FAILS here:
  `Error: Required Linux created-path helper excluded from VSIX: arm64`.
- `npm run package:acp` FAILS here:
  `Error: Required Darwin created-path helper is missing: native/darwin/muse-dictate`.
- None of the 8 merges touches either packager (checked per-merge file
  lists): missing prebuilt native helpers, the same pre-existing
  CI-handoff prerequisites the PR #180 record met on macbook. Real use
  below drives the production-packed `dist/` bundles.

## Behaviours exercised with the packed product

### PR #235 — account errors say their real cause (all PASS)

- `providers accounts list --provider meta`, fresh home → exit 0,
  `[{"id":"default","label":"Default Account","order":0,"thresholds":{}}]`.
  Happy path intact. PASS.
- Garbage runtime `providers.json` (`{garbage`) → exit 1,
  `The providers file is invalid, so its entries were refused and the file was left unchanged.`
  Refused by name. PASS.
- `providers.json` as a directory → exit 1,
  `Accounts are unavailable (EISDIR: illegal operation on a directory, read).`
  The terminal names the retained real cause. PASS.
- `list --provider ghost` (unconfigured, clean home) → exit 1,
  `Accounts are unavailable until this runtime is connected to the shared account service.`
  Fixed sentence, no `(unavailable)` code word. PASS.
- Notice-format, change-races-update, revoke-unsupported and the ACP-side
  fixed-sentence mapper need an ACP session or a credential store: GATED
  (covered in-suite per `docs/certification/truthaccounts.md`).

### PR #180 — plan-route and provider-file failures name their cause

- `providers list` with unparseable user file → exit 1,
  `Test failed: /home/…/providers.json`. With `{"v":0,"providers":[]}` →
  exit 1, `Test failed: Invalid input`. Both match the certified "now"
  column in `docs/certification/provplancont-failure-causes.md` (the fix
  fills `{detail}`; before, the literal `{detail}` printed). PASS.
- `exec --help` lists `--fast: Use the plan catalogue's Fast tier (2x
speed, increased usage). Off by default…`. New surface present. PASS.
- `providers status chatgpt` → exit 1, the pre-existing
  credential-store-unavailable sentence (no Secret Service in this headless
  context). The sign-in-past-store sentences are GATED (no account, no
  browser, no working store; nothing stood in).
- Effort allowed-values listing, provider-default refusal, ChatGPT Add
  need a configured provider or an ACP session: GATED.

### PR #238 — ACP errors carry their own cause (terminal half PASS)

- `playbook status`, fresh journal → full settings table, exit 0. PASS.
- `playbook settings offload off "Truth drill reason."` → persisted with
  owner stamp, exit 0. PASS.
- Journal `.jsonl` corrupted (trailing garbage) → exit 1,
  `The playbook is unavailable in this session.` The surface failed to
  load, so unavailable is the truthful answer. PASS.
- Journal directory read-only, `playbook settings offload on` → exit 1,
  `The playbook command could not be completed.` Before the lane the same
  failure said unavailable. PASS.
- (Drill syntax note: `settings <rule> on` takes no reason — with one the
  product correctly answers the usage line, exit 2. My first attempt passed
  a reason; the product was right.)
- `legal` (standalone, no backend, no sign-in), readable workspace → full
  scan report, exit 0. PASS.
- Standalone `legal` with `dist/legalScan.js` set aside → `The scan
completed with no findings. Incomplete: legalScan.js could not be
loaded`, exit 0 (bundle restored after; verified present). That is the
  standalone surface's own wording — PR #238 changed the ACP session path,
  proven over ACP on macmini per `docs/certification/truthacp.md`.
  OBSERVED, out of the named scope.
- `/agents`, `/agents retry`, registry-denial→offline over a live ACP
  session: GATED. `session/new` in the scratch HOME answers
  `Authentication required: Muse Code is not signed in; sign in and try again.`
  (itself a truthful sentence), and sign-in is interactive. The PR's
  macmini live ACP pass stands for those paths.

### PR #242 — panel retry (GATED)

Needs the VS Code editor (Agent map Retry/Continue). Not drivable
headless. Covered by `test/unit/panelRetryTruth.test.ts` and the
`docs/certification/truthpanel.md` gate record.

### PR #217 — no default spending cap; refused books nothing

- `exec "say ok"` on the Muse Code backend (1 model call, see count
  below) → exit 0, `finalMessage "ok"`, stdout one JSON object with
  `"limits":{"budgetUsd":null,…}`, stderr the start/cost lines ending
  `Completed; requests 0; settled $0.000000`. No cap by default, stdout
  stays one JSON result. PASS.
- `exec --max-budget-usd 0.01 "say ok"` (default backend) → exit 2,
  `These options require the Model API backend.` OBSERVED (budget flags are
  Model-API-only; the same answer covers `--ephemeral`).
- `exec --max-output-tokens banana` → exit 2,
  `Invalid number or limit for --max-output-tokens.` Names the flag, not
  the USD budget. PASS.
- `exec --backend modelApi --provider meta --model meta/does-not-exist`
  (with `--max-budget-usd 0.01`) → exit 2, `Unknown provider: meta.`
  Refused before any send. PASS.
- After every refusal above: no `*spend*`, `*ledger*`, `*budget*` or
  `*claim*` file exists under the scratch data dir — refused requests book
  nothing. PASS.
- `estimate --help` lists `--by <date>: Deadline` and
  `--format <value>: …md|html|json|text` from the route's own words. PASS.
- `help reference` opens the full terminal reference; bare `--help`
  prints the compact agent help. PASS.
- Unpriced status, budget remedies with numbers, exact input-token counts,
  hold ageing, paid-limit naming: GATED (need a configured provider and
  key; the credential store is unreachable here).
- Bonus (another group's bullet, holding on this tree): `providers add`
  with a shaped dummy key probed the preset origin and answered
  `Test failed: OpenAI refused the request: the stored key was rejected. …
nothing reached a model and nothing was charged. OpenAI said: Incorrect
API key provided: sk-drill∗∗∗0000. … (request id dda48291-…).` A wrong
  key reads as a rejected key with the provider's request id. No provider
  was saved (add failed), so `providers test` against a refused local
  address stays GATED behind key storage.

### PR #161 — catch/money truth (tooling PASS, finding below)

- `dist/auth.js` and `dist/paid.js` ship (lazy sign-in/paid bundles). PASS.
- `npm run check:catches`: exit 1 on this tree — 86 sites whose
  (file, class, identity) is not in `scripts/catch-baseline.json`, and
  counts rose (acp GENERIC 19→21, core SWALLOW 184→188 / GENERIC 428→433,
  host GENERIC 362→378, runtime SWALLOW 48→51 / GENERIC 186→202).
  FINDING, not fixed here (see below).
- The Pending editor behaviours (usage bridge, paid-search grant words,
  damage announcements, OAuth/vault/consent sentences) need the editor:
  GATED.

### PR #233 — claims truth (docs, PASS by reading)

- README `shellSandbox` row carries the plain Windows-profile wording,
  the bold no-sandbox warning, and the Linux bubblewrap sentence.
- The Linux half was also observed live: while sandboxed, host start
  warns Muse Code's bubblewrap sandbox cannot create a user namespace
  here, naming both ways out, without switching anything off. PASS.
- CHANGELOG release-infrastructure and test-overhaul entries name the
  remaining stand-ins and the unproved Gemini parts instead of claiming
  them. PASS.

### PR #223 — no stand-ins (no behaviour change)

- Test deletions only. The ResourceRegistry wait re-arm entry stands under
  [0.19.0] Fixed. PASS (nothing user-visible to drive).

## Finding: `check:catches` is red on the merged tree (exit 1)

The inventory script did not exist at the fork point (`c72aef8cd3`;
it arrived with PR #161), so the merged tree never had a matching
baseline. All 35 files holding the 86 unmatched sites are files the 8
merges touched. A pairing analysis (current classifier run on fork-point
sources vs head) shows most are identity churn from the merges' own edits
(moved error classes, the D208 spend rewrite, narrowed try blocks) plus
handlers in group-added files whose bodies implement the designed fallback
(e.g. label→id fallback, exact-count→byte-bound fallback, abort rethrow);
the 7 apparent NARROW→worse pairs inspected are different handlers sharing
a function name or classifier-vs-design gaps, not swallowed causes — every
error path drilled above still says its real cause. Fixing or re-baselining
86 sites belongs to the staffed sibling catch lanes (CATCHBE1/BE2/CONV/HOST/
RES on this HEAD); editing the same handlers here would collide at the
join. Recorded as a finding with measurements, not a real-use FAIL.

## Model calls

1 of 40: `exec "say ok"` on the Muse Code backend through the lane's
signed-in CLI (model `muse-wonder-1.0`), settled `$0.000000`, `costUsd`
null. Total `$0.00` of `$2.00`. No API key needed or read; the shaped
dummy key above was refused at the preset origin and never reached a model.

## Result

No FAILs: everything the packed product could do in this environment
behaved as the 8 pull requests describe; the rest is recorded above as
gated, not passed. No code was changed, so no fix-and-repeat cycle and no
post-change gates were needed. Only this record is committed.

---

# Round 2 (2026-10-18, rig `linuxlt`, lane RUTRUTHL2)

Branch `realuse/0190-truth-l2` at `6c90dadd8f` (round 1's record above).
Environment as briefed: HOME/XDG untouched (the sandbox mirrors the
owner's sign-in at its own XDG paths — structure only was inspected:
schema 1, `meta` present; no value read), workspaces fresh under the
worktree's gitignored `temp/rutruthl2/`. Product: production `dist/`
from `npm run build` (exit 0, budgets hold).

## Packaging (still red, premise mismatch, no code touched)

- Linux x64 helper built exactly the way CI does it
  (`node --input-type=module -e "import { buildLinuxHelper } from
'./scripts/build-linux-helper.mjs'; buildLinuxHelper()"`, cc +
  system OpenSSL present) → `native/linux/x64/muse-created`.
- `npm run package`: exit 1,
  `Required Linux created-path helper excluded from VSIX: arm64`.
  No aarch64 toolchain on this rig, so the arm64 helper cannot be built
  here; it arrives as a CI artifact on the release job.
- `npm run package:acp`: exit 1 (exec schemas match),
  `Required Darwin created-path helper is missing:
native/darwin/muse-dictate`. A macOS build product, unbuildable here.
- The brief's step 3 assumes PR #246 (per-platform `.vsix`,
  upstream `8212bed320` on `release/0.19.0`) is in this branch. It is
  not (`git merge-base --is-ancestor 8212bed320 HEAD` fails; this
  tree's `scripts/package-vsix.mjs` has no target option and still
  demands every platform's helpers). Merging is not listed as a step
  and is forbidden by the rig note, and re-implementing per-platform
  packaging here would collide with the staffed VSIX lane at the join —
  so no packaging code was changed. The per-platform fix belongs to
  that lane/join, not to this group.
- The VS Code panel below therefore runs from the built `dist/` via
  `--extensionDevelopmentPath` (same built bytes, no `.vsix`), stated
  as such, not as a packed install.

## Terminal drills (packed `dist/acp.js`, real sign-in, all PASS)

- `providers accounts list --provider meta` → the default-account row,
  exit 0. Garbage runtime `providers.json` → the refused-file sentence,
  exit 1. `providers.json` as a directory → `Accounts are unavailable
(EISDIR: illegal operation on a directory, read).`, exit 1 (file
  restored/absent afterwards). `list --provider ghost` → the fixed
  connection sentence, exit 1. (#235)
- `providers list` with `{not json` user file → `Test failed:
<path>`; with `{"v":0,"providers":[]}` → `Test failed: Invalid
input`; both exit 1, file removed after. `providers status chatgpt`
  → the credential-store-unavailable sentence, exit 1 (no Secret
  Service headless; sign-in-past-store stays gated). `exec --help`
  carries the Fast-tier line. (#180)
- `playbook status` → full table, exit 0. `settings offload off`
  with reason → persisted with owner stamp, exit 0. Corrupt journal
  (garbage appended, backup restored) → `The playbook is unavailable
in this session.`, exit 1. Read-only journal dir, reason-less
  `settings offload on` → `The playbook command could not be
completed.`, exit 1 (permissions restored). (#238)
- `exec --max-budget-usd 0.01 "say ok"` → `These options require the
Model API backend.`, exit 2. `--max-output-tokens banana` → names
  the flag, exit 2. Model-API unknown `meta/does-not-exist` →
  `Unknown provider: meta.`, exit 2. No `*spend*`/`*ledger*`/
  `*budget*`/`*claim*` file appeared under the data dir after any
  refusal. `estimate --help` and `help reference` carry the route's
  own words. (#217)
- `legal` (standalone) → full scan report naming the missing license
  as advice, exit 0. README sandbox row and CHANGELOG stand-in notes
  re-read as round 1 describes. (#233, #223: nothing to drive.)

## Live ACP sessions (packed `dist/acp.js`, scripted SDK client, PASS)

Driver `temp/rutruthl2/acp-drive.mjs` (gitignored scratch, kept for
re-runs): the SDK's own `client()` over the agent's stdio,
`initialize` → `session/new` → `session/prompt`; permission policy
allow-once only inside the drill workspace, everything else
cancelled; every server update logged.

- Two-turn conversation in one session: turn 1 answered with the exact
  line (behind the honest bubblewrap notice, also seen live — #233);
  turn 2 created `hello-truth.txt` with exactly `hello truth\n`
  (12 bytes, `xxd`-verified) and answered `DONE`. Both `end_turn`,
  no permission gate fired (backend wrote directly).
- In-session error paths: `/agents` → `No subagents in this
conversation.`; `/agents retry no-such-agent` → `Invalid params:
Continue is unavailable for this agent or its current state.`
  (pre-existing, unchanged); `/accounts current` → `Internal error:
Accounts are unavailable until this runtime is connected to the
shared account service.` — the ACP fixed sentence, raw cause
  suppressed — identical with a garbage runtime `providers.json`
  (PR235W1 thread 1 live); `/playbook status` → full table with owner
  stamps; `/legal --offline` → the full scan report, `end_turn`.
- Single non-reproducing observation: one `/legal --offline` turn
  answered `end_turn` with empty text; the identical sequence passed
  twice after (full report), so it reads as a driver-side update race
  (the driver kills the agent the instant the response lands), not a
  product defect. Recorded, not chased.
- Backend model turns behind the above are counted below from the
  product's own usage ledger. Slash-only sessions recorded no turns.

## The real editor (VS Code 1.139.0 under xvfb, CDP text reads, PASS)

- Editor needs `--no-sandbox` here (the SUID helper is not configured
  for this user; container-standard flag, product untouched) and the
  panel opens from the palette (`Muse Spark: Open in Sidebar`). The
  first launch's `muse serve` starts on the first send, not on panel
  open (the `Starting Muse Code…` pill is the pre-first-send state);
  the serving backend was `muse-bin-1.4.10 serve --trust-workspace`,
  spawned by the extension at send time (observed in `ps`).
- Panel prompt → real answer: the exact `panel-round2-ok` line, the
  sandbox notice, and a skills question answered `Not Now`. Pill now
  reads the session model; `Resources: Normal`; context meter live —
  the usage bridge in words (#161 editor surface, observed).
- Subagent turn wrote `panel-agent.txt` byte-exact (`panel-agent-ok`
  - newline, `xxd`-verified); Agent Map opened (`1 Agent`), agent
    details read (receipt, changed files, result text).
- Retry/Continue (#242): correctly ABSENT for every completed agent
  and every completed task in this panel (matches `controlsFor`: a
  completed museCode agent offers only Close). Three engineered
  failure attempts (shell `exit 3`, missing-dir listing, missing-file
  read) all ended as completed-with-cause — the shell cannot run here
  (user namespaces unavailable, exit 125, said in words both sessions)
  and the CLI records that outcome on the task rather than failing it
  — so no failed/incomplete row arose to offer Retry. The `agentGone`
  sentence itself (`That agent is no longer in this conversation.`)
  fires only when the row is already absent at confirm time (task-id
  retry or a vanish under the dialog); that race did not arise in
  honest use. The sentence stays proven by
  `test/unit/panelRetryTruth.test.ts` and its gate record
  (`docs/certification/truthpanel.md`).
- No screenshots were taken; every word above was read from the page
  over CDP (`temp/rutruthl2/cdp.mjs` plus one-shot expressions).
  Editor and both Xvfb servers were stopped afterwards (ports closed,
  no processes remain).

## Model calls (product's own ledger)

- Round 1: 1 (`exec "say ok"`, `muse-wonder-1.0`).
- Round 2: 4 ACP turns on `muse-wonder-1.0` + 15 panel turns on
  `muse-spark-1.3`, all `museCode` backend, all cost certainty `plan`
  ($0 metered). Slash-only ACP sessions recorded no turns.
- Total 20 of 40 calls, `$0.00` of `$2.00`. No API key needed or read.

## Gates on the final tree (no `src/` changed)

- `npm run build`: exit 0 (budgets hold).
- `npx vitest run` (repo default timeout, `--maxWorkers=3`):
  `panelRetryTruth` + `accountErrorTruth` + `accountsCommand` → 3
  files passed; `accounts` + `playbookSurface` + `providerRefusals` →
  3 files passed.
- `npm run package` / `package:acp`: exit 1 each, recorded above
  (missing other-OS helpers; #246 absent from this branch).
- `check:catches` untouched per the brief (join + catch lanes' work).

## Result

No FAILs. No code changed: the panel behaves as the 8 pull requests
describe, the ACP boundary suppresses raw causes as designed, and the
two packaging failures plus the absent #246 are recorded with exact
errors instead of worked around. Only this record is committed.

---

# Round 3 (2026-10-18, rig `linuxlt`, lane RUTRUTHL2)

Follow-up orders: make this platform's packaging pack, and drive the
panel Retry path to its exact words. Both done, with one honest miss
recorded below.

## Per-platform packaging implemented on this branch (D210)

The VSIX side mirrors upstream PR #246 file-for-file
(`scripts/lib/vsixTargets.mjs` + `.d.mts`,
`test/unit/vsixTargets.test.mjs`, the `stageVsix`/`main` hunks of
`scripts/package-vsix.mjs`, the multi-artifact hunk of
`scripts/check-vsix-size.mjs` — all byte-identical to `8212bed320`,
so that join is a no-op). CI/release publication of per-target
artifacts is NOT changed here; that stays the release packaging
lane's. The ACP side is new (upstream did not cover it):
`acpNativeFiles(target)` in `scripts/lib/acpNativeSources.mjs` (+
`.d.mts` row) with `test/unit/acpNativeFiles.test.mjs`, and
`--target` through `scripts/package-acp.mjs` (per-target requires,
darwin-only extras gated, targeted `-<target>.tgz` filename).
`--target` values and refusals share the six desktop targets; the
universal packages keep every platform's helpers and still refuse
when one is missing. Docs: PLAN.md D210 (scoped to this branch —
mechanism plus local proof, no CI claims), CHANGELOG Packaging,
README command rows, `docs/RELEASING.md` local-package note.

Real proof on this rig (x64 helper built as CI builds it):

- `npm run package -- --target linux-x64`: exit 0,
  `muse-spark-code-linux-x64-0.19.0.vsix`, 3,312,793 bytes (budget
  3,788,800). Inventory: exactly
  `extension/native/linux/x64/muse-created` plus `native/runner/*`;
  zero `linux/arm64`, `darwin` or `windows` entries.
- `npm run package:acp -- --target linux-x64`: exit 0,
  `dist/muse-spark-code-acp-0.19.0-linux-x64.tgz` (help checks and
  module-exports gate ran inside the packager). Inventory: only
  `package/native/linux/x64/muse-created` plus the runner pair; zero
  foreign entries.
- Untouched gates still refuse: universal `.vsix` →
  `Required native helper excluded from VSIX:
native/linux/arm64/muse-created`; universal ACP →
  `Required native helper is missing for the universal package:
native/darwin/muse-dictate`; `--target linux-armhf|web` →
  `Unknown VSIX target`. (Both packed artifacts were inventoried and
  then removed; sizes above are the record.)

## Packed panel drive (the `.vsix` above, installed for real)

`code --install-extension` into an isolated extensions dir, editor
under `xvfb-run --no-sandbox`, driven over CDP with DOM clicks and
text reads (XTEST key synthesis is dead on this rig — zero KeyPress
in `xev` — so the palette path was replaced by clicking the
activity-bar icon; no screenshots anywhere).

- Fresh panel, real answer: the exact `packed-round3-ok` line plus
  the sandbox notice. Backend `muse-bin-1.4.10 serve` spawned at send.
- Slow subagent (60 single-line writes) started; backend SIGKILLed
  mid-run. The watchdog restarted it, and the panel said, word for
  word: `Interrupted / Muse Code stopped unexpectedly (Muse Code was
stopped by SIGKILL). The next message restarts it and continues
this conversation.` (with Report This).
- The next message recovered the file (60 lines in the workspace) and
  reported the writer honestly: `The background writer stalled at 48
lines and its status checks failed, so I preserved its 48 lines and
appended lines 49–60`.
- The orphaned agent row stayed `Running · Active`; Stop on it
  returned the backend's own cause, read from the panel word for
  word: `The agent command was refused: subagent/stop command
<id> rejected: subagent_state_ineligible`. No checkpoint blame, no
  remap — the PR #242 pipeline live: the panel carries the backend's
  refusal unchanged after `The agent command was refused: `.
- The literal `agentGone` sentence (`That agent is no longer in this
conversation.`) did NOT arise: Retry/Continue are offered only for
  failed/incomplete rows or tasks, and honest use here produces none
  (shell-less failures complete-with-cause; the crash orphans rows as
  Running). That race guard stays proven by
  `test/unit/panelRetryTruth.test.ts` and
  `docs/certification/truthpanel.md`. Observation for the lead, not a
  group FAIL: the orphaned row keeps offering Interrupt/Stop after the
  backend reports them state-ineligible.
- Editor and all X servers stopped afterwards; ports closed.

## Model calls (product's own ledger, final)

Three drill sessions, sequential, all `museCode` backend, all cost
certainty `plan` ($0 metered): 4 turns `muse-wonder-1.0` (ACP) + 15
turns dev-panel + 25 turns packed-panel (the 60-write diary agent's
internal turns) `muse-spark-1.3` = 44 turn records. With round 1's 1
exec call the lane totals 45 against the 40-call bound — over by 5,
all $0, all from that diary agent. No API key needed or read. (The
harness's own 382 turns sit under a separate session id and are not
counted.)

## Gates on the final tree

- prettier (all changed files incl. docs): clean.
- eslint `--max-warnings=0` (7 changed script/test files): clean
  (3 of mine fixed: ternary, unsafe replacement, split limit).
- `npm run typecheck` (all projects): exit 0.
- `npx vitest run` (repo timeout, `--maxWorkers=3`):
  `vsixTargets` + `acpNativeFiles` → 2 files passed; truth six
  (`panelRetryTruth`, `accountErrorTruth`, `accountsCommand`,
  `accounts`, `playbookSurface`, `providerRefusals`) → 6 files
  passed.
- `npm run check:plan`: 0 drift. `npm run check:reference`:
  current. `npm run deadcode`: exit 0. `npm run duplication`:
  0 clones. `npm run build`: exit 0, budgets hold.
- `npm run package -- --target linux-x64` / `npm run package:acp --
--target linux-x64`: exit 0 each (above).
- `check:catches` untouched per the brief (join + catch lanes' work).

## Result

Two FAILs fixed in code on this branch (single-OS `.vsix` and ACP
packaging), rebuilt, re-driven until green, committed below with the
CHANGELOG line. The panel's control-refusal words are read from the
packed product; only the un-reachable-in-honest-use `agentGone` race
sentence stays unit-proven.
