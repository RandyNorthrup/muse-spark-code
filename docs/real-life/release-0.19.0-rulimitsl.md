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
