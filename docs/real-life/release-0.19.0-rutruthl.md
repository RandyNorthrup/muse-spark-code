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
(moved error classes, the D121 spend rewrite, narrowed try blocks) plus
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
