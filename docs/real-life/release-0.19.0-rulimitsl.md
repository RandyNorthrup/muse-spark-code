# Real use — release 0.19.0 limits group (lane RULIMITSL, Linux)

Version: 0.19.0. Git SHA: `3bd3f54a5b` (group branch `realuse/0190-limits-l`:
release/0.19.0 with PRs #245 #229 #214 #239 #240 #234 #228 #225 #159 merged,
plus the schema-regen fix commit on top). Platform: Linux x86_64
(`linuxlt` rig). Backend driven: Muse Code (signed-in CLI) plus the
no-key / refused-key paths on the Model API backend.

Product used: the production build in `dist/` (`npm ci`, `npm run build`
green with bundle budgets), driven as `node dist/acp.js` — the packed
agent's own entry (REALUSE-common's "dist/acp.js as packed"). The two
universal packagers are blocked on this single-arch rig by design, not by
product code: `npm run package` needs `native/linux/arm64/muse-created`
(CI builds it on an arm64 runner, build.yml `linux-native-build`) and no
aarch64 toolchain exists here; `npm run package:acp` additionally needs
the Mac-only `native/darwin/muse-dictate`. No workaround was built; the
lead/CI packs both universals. Scratch workspace: `temp/scratch-limits/`
(gitignored).

## Behaviour 1 — no default headless request limit (PRs #239, #240)

`exec --backend modelApi --prompt-file prompt.txt --max-budget-usd 100`
(no `--max-requests`): exit 3, `Backend Unavailable; requests 0` — parsing
passed with no request limit demanded, the run stopped only at the missing
provider key. PASS. The completed Muse Code run below reported
`"limits":{"budgetUsd":null,"maxRequests":null}` in its own result JSON.

## Behaviour 2 — a set `--max-requests` stays within 1–500 (PRs #239, #228)

- `--max-requests 500` (with `--max-budget-usd 100`, Model API backend):
  parsing passed, run proceeded to the backend (exit 3, no key). PASS.
- `--max-requests 501` and `--max-requests 0`: exit 2, `Invalid number or
limit; ...`. PASS (refused).
- `action/action.yml`: `max-requests` is `required: false`, `default: ''`,
  described as "1-500 ... empty sets no request limit". PASS (contract as
  documented; the Action itself cannot run on this rig).

## Behaviour 3 — `--max-budget-usd` has no $20 ceiling (PR #228)

- `--max-budget-usd 100` and `--max-budget-usd 2500.75`: parsing passed,
  runs proceeded to the backend (exit 3, no key, `settled $0.000000;
uncertain $0.000000`). PASS — amounts far above $20 are honored as given.
- `--max-budget-usd=-5` and `--max-budget-usd 0`: exit 2, invalid
  (positive-number validation). PASS.

## Behaviour 4 — one real headless turn, unset limits (group headline)

`exec --prompt-file prompt.txt --output json` on the Muse Code backend:
exit 0, `status completed`, `stopReason end_turn`, model
`muse-wonder-1.0`, `finalMessage "ok"`, `limits` all null, error null.
The turn was not stopped after any request count. PASS. Model calls used:
1 of 40; spend $0.00 of $2.00 (Muse Code backend, `costUsd` null).

## Behaviour 5 — provider keys are never refused for looks (PR #159)

`providers add --preset openai --key-stdin` with piped wrong-looking keys:

- `test-key` → stderr `This looks like placeholder text, not a key. Use it
anyway?`, then the free key test ran and OpenAI refused the key
  (`Incorrect API key provided: [redacted] ... nothing reached a model and
nothing was charged`, with request id). PASS.
- `https://example.com/key` → `This looks like a web address, not a key.
Use it anyway?`, then the same provider refusal (URL userinfo redacted).
  PASS.
- Backslash text (path-shaped) → `This looks like a file path, not a key.
Use it anyway?`, then the same refusal. PASS.
- Raw non-UTF-8 bytes → `That input is not text (it is not valid UTF-8),
so it was not used.`, exit 1, no network probe. PASS.
- `providers list` afterwards: `No providers are configured.` — nothing
  was stored by any failing add. PASS.

The three key-test probes reached OpenAI's API with bogus keys and were
rejected at auth; the provider's own words confirm nothing was charged.
They are not model calls (no inference): model-call count stays 1 of 40.

## Behaviour 6 — per-provider retry limits + `modelApiMaxRetries` (PR #225)

Source carries each provider's documented values (Anthropic 2, OpenAI 2,
Gemini 4 with 1 s–60 s, Azure 10, xAI 4, Meta 4) and the machine-scoped
`museSpark.modelApiMaxRetries` setting (default null, minimum 0; `0`
never retries) is in `package.json`. Retry behaviour itself needs a
provider key and a failing request, which this rig cannot reach — NOT
EXERCISED LIVE, stated plainly. The refusal/no-retry classification is
covered by the lane's unit suite (`test/unit/providerRetryLimits.test.ts`).

## Behaviour 7 — Tab has no daily budget unless set (PR #239)

`museSpark.tabDailyBudgetUsd` default `0` with no maximum in the packed
manifest; spend is reported without a cap when unset. The GUI surfaces
(status bar, consent popup, Account & usage) cannot be driven on a
headless rig — NOT EXERCISED LIVE beyond the manifest default.

## Behaviour 8 — first-use commands load lazily, no behaviour change (#245)

Production `dist/commands.js` (29,821 bytes) built and registered as a
deferred bundle; `npm run build` holds the activation budget. First-use
command flows cannot be clicked through without VS Code — NOT EXERCISED
LIVE beyond the bundle's presence and the green budget gate.

## Not exercised live (stated plainly)

- No 50-tool-round cap (#234): proving an absence needs 50+ tool rounds in
  one turn, beyond the 40-call envelope. Covered by the lane's unit suite.
- Waits instead of timeouts (#214: git, serve handshake, shell, web fetch,
  vault, browser check, legal scan): needs slow fixtures / long clocks;
  the headline (no request/timeout stop on a real turn) is Behaviour 4.
- Paid/Model API inference on any provider: no key on this rig.

## FAIL found and fixed

`npm run package:acp` failed at `exec-schema.mjs --check` with `Exec
schema drift: result`: the published `docs/schemas/exec-*-v2.schema.json`
still stated the earlier unbounded request maximum after PR #239
reinstated the 1–500 set-value bound in source. Fix: regenerated with
`npm run schema:exec` (now `maxRequests` maximum 500, matching the code
and the CHANGELOG), plus a `[0.19.0]` CHANGELOG line. Commit `3bd3f54a5b`.
Re-ran `--check`: `Exec schemas match.` PASS.

# Round 2 (lane RULIMITSL2, same rig `linuxlt`)

Branch `realuse/0190-limits-l2`. HOME and all sign-in variables untouched;
the machine's own Muse Code sign-in was used throughout. Scratch
workspaces: `temp/scratch-limits2/` (exec proof), `temp/scratch-acp/`
(fresh empty folder for the ACP sessions). All scripts below live in
`temp/` (gitignored); reusable coverage went into the repo suites.

## Fix: the invented 500 maximum is removed (commit `0369616081`)

500 was ours, not a provider published limit: no provider documents a
request-count maximum. With no value there is no limit; any positive safe
integer the person sets is accepted as is; 0 and negatives stay refused
as not a count. Changed, all in one commit (17 files):

- `src/shared/constants.ts`: `EXEC_MAX_REQUESTS` deleted.
- `src/runtime/exec/execArgs.ts`: `--max-requests` parses against
  `1–Number.MAX_SAFE_INTEGER`.
- `src/runtime/exec/runLedger.ts`: the ledger refuses only
  non-safe-integer and `< 1`.
- `src/runtime/exec/execProtocol.ts`: `limitsSchema.maxRequests` is
  `counter ≥ 1` with no upper check.
- `action/lib/tools.mjs`: new `positiveCount` (any positive safe
  integer; empty still means no limit); `action/lib/result.mjs`:
  `isLimits` drops the 500 ceiling; `action/action.yml` description
  now reads "any positive integer".
- `scripts/lib/reference.mjs`: the reference gate now demands 501 and
  1000000 parse and 0/`-1`/`abc` refuse (was: 500 parses, 501
  refuses); `src/shared/reference/referenceSource.ts` drops the
  deleted constant.
- `docs/ci.md`, `README.md`: 1–500 wording replaced with the
  no-maximum rule. No l10n change was needed: no locale table named
  the 500 bound for this option.
- `docs/schemas/exec-*-v2.schema.json`: regenerated with
  `npm run schema:exec` — `maxRequests` is now
  `minimum 1, maximum 9007199254740991` (the safe-integer
  expression of "no maximum", not a cap). `--check` passes.
- Tests: `execArgs` (501/1000000 accepted, 0/`-1` refused),
  `runLedger` (new: 501 and 1000000 admitted), `actionMaxRequests`
  (same, plus `isExecResult` keeps accepting null).
- `[0.19.0]` CHANGELOG: the three 1–500 lines rewritten true
  (headless run, Action, schemas); the D121 line already said the
  500 cap was gone.

Gates on the final tree: vitest `execArgs + runLedger +
actionMaxRequests` 99 passed with the repository's own timeout;
`check:reference` pass; `schema:exec --check` match; typecheck exit
0; eslint exit 0 with zero warnings on the changed files; prettier
clean; `npm run build` exit 0 with budgets.

Proof by driving the real code (production `dist/`, built above):

- `exec --backend modelApi --max-budget-usd 100 --max-requests 501`:
  parsing passed, `"limits":{"maxRequests":501}`, run reached the
  backend (exit 3, only the Linux credential store missing — the
  rig has no Secret Service). Round 1 recorded this exact case as
  exit-2 PASS; it is a FAIL of ours, now fixed.
- `--max-requests 1000000` → `"maxRequests":1000000`; `--max-requests
0` and `-5` → exit 2, `Invalid number or limit`.
- Action libs driven directly: 1/500/501/1000000 accepted, unset →
  null, 0/`-1`/`abc`/`30.5` → `InputError`; `isExecResult` true for
  501/1000000/null, false for 0.

Other caps the limits group touched or kept (tool rounds, Tab
budget, retries, output/data, budget USD), each checked against the
real code: the 50-tool-round cap is absent from `ModelApiHost` and
constants; Tab keeps default `0` with no ceiling (the `$0.05` dust
floor is the documented person-set display floor, D73); retries are
each provider's documented values with the person-set
`modelApiMaxRetries` (default null); `--max-budget-usd` has no
ceiling (only zero refuses). What remains bounded is mechanism or
integrity, not consumption: prompt/untrusted-file/schema-expansion
bytes, loopback/https-only SDK bounds, and the person-set run
deadline (default 1800 s, 10–21600; Action 1–360 min). The deadline
still has a default, so it is flagged, not changed: redefining it
is new scope for its own milestone.

## Real use: contributor model named, provider tier gate answered

Every packed-product request named
`--model muse-spark-1.3-contributor` (exec) or set it over ACP
(`session/set_config_option`). Results:

- Headless exec on the Muse Code backend with the contributor
  model (with and without `--allow-contributor-models`): exit 2,
  `This model is not available for this run.` — the served
  session's own config refuses it.
- The same account drives the contributor model fine through the
  provider CLI itself (`muse exec --model
muse-spark-1.3-contributor --contributor-mode on` answered `ok`),
  so the entitlement exists. The packed product spawns
  `muse serve` without the CLI's per-process `--contributor-mode`
  flag and passes no equivalent anywhere in `src/` (only the
  listing filter `allowsContributorModels`), so the contributor
  tier is unreachable through the packed product with the
  installed CLI 1.4.10 (whose schema the pinned SDK already
  trails — the run logs a fingerprint mismatch,
  pinned `sha256:7c94…` vs served `sha256:5d3b…`). Finding for
  the lead, not a limits FAIL: the refusal is the provider's own
  tier gate, surfaced exactly, never mistaken for a PASS.
- Headless exec with the provider-offered model: exit 0,
  `completed`/`end_turn`, model `muse-wonder-1.0`, finalMessage
  `ok`, all limits null (session
  `01a15026-c5fa-7063-90d8-73b8de5f3eea`).
- Two ACP sessions with the packed agent (`node dist/acp.js`,
  second run with `--allow-contributor-models`): offered models
  `muse-wonder-1.0, muse-wonder-full-1.0, muse-spark-1.3,
muse-spark-1.2`, current `muse-wonder-1.0`; setting the
  contributor model → `Invalid params:
muse-spark-1.3-contributor`. Turn 1 answered exactly `ok`
  (`end_turn`); turn 2 created `hello.txt` byte-exact (`xxd`:
  `6865 6c6c 6f20 776f 726c 64`, 11 bytes, no newline).
  Zero permission prompts fired in either session. Limits-group
  error paths inside a live session: the model-availability
  refusal above fired for real; request-cap/budget admission
  needs the Model API backend with a key, which this rig has
  not — stated plainly, as in round 1.
- Provider-line audit (§0): every provider line in the product's
  own records says `muse-wonder-1.0`, never the lane model — the
  tier gate above is why. Model calls: 5 product turns (1 exec +
  4 ACP) plus 1 CLI-direct diagnostic probe, all answered `ok`;
  spend $0.00 of $2.00 (Muse Code backend, `costUsd` null; no
  Model API inference, no key read).

## Not done here (blocked, with the exact errors)

- Panel (§2): VS Code (`/usr/bin/code`) and `xvfb-run` are
  present, but there is no packed `.vsix` to install. `node
scripts/package-vsix.mjs` stops at `Required Linux created-path
helper excluded from VSIX: arm64` (CI builds it on an arm64
  runner; no compiler at all on this rig, and the helper script
  builds host-arch only). `node scripts/package-acp.mjs` stops
  at `Required Darwin created-path helper is missing:
native/darwin/muse-dictate` (Mac-only). No workaround was
  built; nothing was hand-packed.
- The brief's premise "with #246 every platform has its own
  .vsix" does not hold on this branch: PR #246
  (`8212bed320`) is not an ancestor here and
  `scripts/package-vsix.mjs` has no target option — the
  universal still demands both Linux helpers. Per-platform
  packaging (or a merge step listing it) belongs to the lead.
- `check:catches` on group-touched files: left to the join, per
  the brief.
