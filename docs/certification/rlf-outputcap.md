# RLF-OUTPUTCAP — The 32,768 ceiling stops binding the person (2026-11-02)

Rig `macbook` (MacBookPro.ivettnet, the owner's MacBook), branch
`rec/rlf-outputcap`, base `72d8d5003` (rv/int9). Brief D, research
RSCH-MUSE-D (D121). No `src/RLF-OUTPUTCAP/*` branches exist in the bare
repo, so this is fresh work from the base; the `muse-code-2026-11-02.md`
research file is not on this rig.

Verdict: `MODEL_API_MAX_OUTPUT_TOKENS` (32,768) is now a default only.
Headless `exec --max-output-tokens` accepts up to the selected model's
own documented maximum (131,072 for a Meta model) and refuses a larger
value where the model is known with the sentence naming that maximum;
the session budget fit and the judge reservation fit against the same
model policy maximum. The provider's `>= 16` minimum stays. The
reservation money tables state the M=131,072 figures, pinned by a
real-code test.

## 1. Changes

- `src/runtime/exec/execArgs.ts` — parsing no longer refuses a
  `--max-output-tokens` above 32,768. Any positive safe integer parses;
  the model's own maximum refuses above it at the run's output cap. The
  parse floor stays 1 (a provider that permits fewer than 16 keeps 1–15).
- `src/runtime/exec/runLedger.ts` — `resolveExecOutputCap` returns the
  model policy's maximum where the record names one (131,072 for Meta),
  else the legacy default; the `Math.min` clamp to 32,768 is gone.
  `createExecOutputCap` refuses a person-set flag above a _known_ model
  maximum with `execOutputCapExceeded` naming that maximum
  (`--max-output-tokens exceeds the output cap of 131072 tokens.` for
  Meta). Before the model resolves to a known maximum the flag only
  lowers the cached cap; the model bind enforces the limit. The
  below-minimum refusal (`EXEC_MIN_OUTPUT_TOKENS`) is unchanged.
- `src/core/backends/modelapi/sessionBudget.ts` — `fitRequest` and
  `fitProviderRequest` default an omitted allowance to
  `modelPolicyFor(modelId).output.maxTokens`, with the legacy default
  only where the record names none (no new bundle edge: the module
  already imported `./modelPolicy`).
- `src/host/judge/judgeEntry.ts` — the Muse Code same-judge reservation
  passes the model policy's maximum for a Meta model (mirroring
  `modelPolicyFor`'s Meta check without importing the Model API
  bundle's policy module), else the legacy default.
- `src/shared/constants.ts`, `src/shared/l10n/en.ts` — comments only:
  32,768 is a default, never a maximum below the provider's limit; the
  `execOutputCapExceeded` note now says the cap is the model's own
  maximum. No key or slot changed, so no table work.
- `scripts/lib/reference.mjs`, `src/shared/reference/referenceSource.ts`
  - regenerated reference — the `--max-output-tokens` contract drops
    `maximum: 32768` (parsing sets no ceiling of ours, like
    `--max-requests`); the description sentence stays true (the effective
    cap never exceeds the policy cap) and is unchanged in every table.
- `README.md`, `docs/ci.md` — the exec ceiling statement and the
  reservation money tables now state M=131,072: contributor $0.117965
  ($0.127965 with images), standard $1.703936 ($1.713936). Computed from
  `MODEL_API_PRICES_PER_MILLION` and `MODEL_API_CONTEXT_WINDOW` with the
  table's own formula (verified: it reproduces the old M=32,768 figures
  exactly); the +$0.01 images adder is untouched.
- `CHANGELOG.md`, `PLAN.md` (§6 `RLFOUTPUTCAP`), `docs/roadmap/entries.json`
  - regenerated `ROADMAP.md`.

Left as defaults on purpose (the brief keeps 32,768 "at most a default"):
`ModelApiHost`'s request-body default (the golden fixtures pin 32,768
bodies), the backend manager default, the no-policy ledger default, the
context reserves, and the below-32,768 budget-warning comparison.

## 2. Tests

Real-code suites, repository timeouts, `--maxWorkers=3`:

- `test/unit/execArgs.test.ts` (67) — parse accepts 131072 and 200000,
  still refuses `0`/`1.5`/`many` and the floor-1 cases still pass.
- `test/unit/runLedger.test.ts` (53) — Meta policy resolves 131072
  (bind and pre-resolution name); flag 131072 rides through; 131073
  throws the sentence naming 131072; a 16384 provider policy refuses a
  20000 flag naming 16384; the worst-case reservation at M=131,072 is
  $0.117965/$1.703936 through the real bind→admit wiring.
- `test/unit/sessionBudgetFit.test.ts` (4) — an omitted allowance fits
  up to 131072 for a Meta model under an ample budget.
- `test/unit/providerOutputCap.test.ts` (4) — pins
  `modelPolicyFor('muse-spark-1.3-contributor').output.maxTokens` at
  131,072 and `undefined` for an unrecorded model.
- `test/unit/localServerCaptures.test.ts` (18) — the LM Studio
  `09-max-completion-tokens` capture (request
  `max_completion_tokens: 32`, stream ending `finish_reason: length`
  at exactly 32 completion tokens) decodes to status `incomplete`
  with `incomplete_details.reason: max_output_tokens` and one
  `response.incomplete` terminal event. No live calls.
- `vitest related` for the exec pair: 48/49 files green (806 tests).
  The one file is `providerHeadersStore.test.ts` (3 tests), which this
  brief forbids running on the MacBook — it fails here with
  `StoreUnavailableError: store-unavailable` (sandbox has no Keychain).
  Never run again this lane.
- `vitest related` for the budget/judge pair: 106/115 files green, 3
  skipped. Failures: the same forbidden credential suite (3) plus five
  real-git/real-process team files (24 tests). Each of the five was run
  alone on this tree and on a clean `72d8d5003` worktree: identical
  failures both sides (same tests, same `git exit 71 ... couldn't spawn
xcodebuild` errors — this rig's `xcode-select` points at the missing
  `/Applications/Xcode.app`). Pre-existing rig failure, not this change.
- `judgeCliDispatch.test.ts`: 6/6 green alone and in both clean related
  runs; it failed 1 test once while two full vitest runs overlapped on
  this laptop, and passes everywhere else.

## 3. Red/green drills

1. Restored the `Math.min(32_768, …)` clamp in `resolveExecOutputCap`:
   `runLedger.test.ts` fails 2 (the Meta-cap and worst-case tests),
   restored → 53/53 green.
2. Restored the plain 32,768 default in `fitRequest`: exit 1,
   `sessionBudgetFit.test.ts` fails 1 (the omitted-allowance test),
   restored → 4/4 green.
3. Re-added a `> 32768` parse refusal: exit 1, `execArgs.test.ts`
   fails 1 (the model-ceiling test), restored → 67/67 green.
4. Broke the chat decoder's length mapping (`reason: 'stream_ended'`):
   exit 1, `localServerCaptures.test.ts` fails 1 (the new
   incomplete-reason test), restored → 18/18 green.

## 4. The `response.incomplete(max_output_tokens)` proof item

Satisfied by an existing captured fixture — no live calls were needed
or made. `docs/certification/m95-captures/lmstudio/09-max-completion-tokens.json`
is a real recorded exchange (captured 2026-10-10T18:29:56Z, unbilled
local run): its request sets `max_completion_tokens: 32` and its
32-event stream ends `finish_reason: length` at exactly 32 completion
tokens. The new test in `localServerCaptures.test.ts` feeds the
capture's own frames through the real `decodeChatStream` and asserts
status `incomplete`, `incomplete_details.reason: max_output_tokens`,
and exactly one `response.incomplete` terminal event. The brief's
"else" (a fresh capture on `muse-spark-1.3-contributor`) does not
trigger. Notes: no Meta Responses capture in the tree ends in a
genuine incomplete stop (all captured `incomplete_details` there are
null), and no model key exists in this lane (`META_API_KEY` unset, the
environment carries no key, and the OS store is off-limits on this
machine) — but the clause's first branch holds, so nothing is open.
The `>= 16` minimum stays covered by its own 2026-10-10 400 receipt
(`test/fixtures/m106/output-incomplete.json`).

## 5. Gates (final tree)

- prettier --check (touched files + docs): clean.
- eslint --max-warnings 0 (touched files): clean (fixed 2: boolean
  name, function scoping in tests).
- typecheck: exit 0. check:l10n: 0 problems. check:reference: current.
  check:host-api: 0 problems. check:plan: 0 drift. check:roadmap:
  current. check:catches: baseline matches. duplication: 0 clones.
  cycles: none. deadcode (knip): exit 0. build: exit 0, 547 ok, no
  budget OVER.
- security:audit: exit 0 (2 advisories noted, 0 exceptions).
- security:sast: NOT RUN on this rig — exit 1, `semgrep is not
installed`, and installing it fails building `cryptography` from
  source (no Rust/Cargo toolchain on this MacBook). Machine facts run
  SAST on the mac mini / linuxlt.

## 6. Notes for the lead

- `DEVELOPER_DIR=/Library/Developer/CommandLineTools` is required for
  every git invocation on this rig (bare git exits 71); used for all
  runs and the commit below.
- The install was refreshed (`npm ci`, lock unchanged): the worktree's
  `node_modules` predated the pinned `qrcode-generator`.
- Pre-existing finding (out of scope, not changed): README says VS Code
  and interactive ACP send the record's 131,072 maximum, but the
  interactive default resolves to 32,768 (golden fixtures agree); this
  lane changes headless/budget/judge only.
- Follow-up candidate (out of scope): the `sessionBudgetOutputLimited`
  warning fires only for caps fitted below 32,768, so a budget fit in
  32,769–131,072 that fills up warns nothing.
