# RLF-FALLBACK certification — a refused turn continues on the fallback model (D261)

Lane RLF-FALLBACK, recovery release. Worktree
`/Users/user/lanes/RLF-FALLBACK`, branch `rec/rlf-fallback`, from
rv/int9 `72d8d5003` per the brief. Rig `macbook`. Built 2026-11-02;
verified and committed on resume the same day, after the shell fence
was fixed (the first run's shell was denied, so it built without
running anything; this record carries both runs).

**Verification status: GREEN — every gate below ran on the resume.**
The live refusal switch still needs its real run (a live refusal
cannot be ordered on demand), so the CHANGELOG line, the README
paragraph and the docs/acp.md paragraph drafted below stay out of
those files until then (see `docs/real-life/unproven.md`).

Expected call count, stated first: 0 model requests. Spent: 0. No
Muse request beyond this lane's own session, no paid call, no live
provider call anywhere in this lane.

## Research (2026-11-02, read first per the brief)

Claude Code's current docs (https://code.claude.com/docs):

- Model configuration keeps two separate mechanisms. Fallback model
  chains (`--fallback-model sonnet,haiku`, `fallbackModel` setting)
  fire on availability: the primary overloaded, unavailable, or
  another non-retryable server error — never auth, billing,
  rate-limit, request-size, transport, or org-policy errors. The
  switch lasts the turn only; the next message tries the primary
  again; chains cap at 3; the chain is never confirmed at startup.
- Automatic model fallback fires on content: a reply stopped with
  `refusal` from the classifier-bearing models continues on a fixed
  fallback, with a transcript notice, and the session stays on the
  fallback until the person changes it. The `switchModelsOnFlag`
  toggle ("Switch models when a message is flagged") runs it
  automatically or asks each time; non-interactive runs end the turn
  with the refusal.
- `cli-reference` documents `--fallback-model` with the same
  availability triggers.

Anthropic's refusals-and-fallback API page: a refusal is HTTP 200
with `stop_reason: "refusal"`, empty content and `stop_details`
(category + explanation); their server-side `fallbacks` parameter
fires only on safety declines (rate limit/overload/server errors
are returned as-is); manual retry re-sends the same request with
`model` set to the fallback and keeps using it for subsequent
turns; each attempt bills at its own model's rates.

D261 matches this where it applies: one person-named fallback
model, off by default (nothing falls back unseen); only the
`refusal` stop switches (availability errors stay on the request's
own retry path, D228); the turn continues once per refusal and the
session stays on the fallback; no startup confirmation.

## What landed (files and commits)

| Change                                                       | Files                                                                                                                                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D261 + question close + milestone + roadmap entry source     | `PLAN.md` (§2 decision, §3 close, §6 `RLFFALLBACK` status); `docs/roadmap/entries.json`; generated `ROADMAP.md`                                                                                                                                  |
| Pure switch decision + tests                                 | `src/core/backends/modelapi/refusalFallback.ts`; `test/unit/refusalFallback.test.ts` (11 tests)                                                                                                                                                  |
| Turn-loop switch, deps, setter, child inherit                | `src/core/backends/modelapi/ModelApiHost.ts` (`fallbackModel` dep, `didRefusalFallback`, `setFallbackModel`, incomplete carve-out, refusal branch, `spawnChild` inherit)                                                                         |
| Setting path through the manager                             | `src/host/backend/modelApiBackendManager.ts` (`fallbackModel` dep + host mapping; the resume found `extension.ts` alone did not typecheck)                                                                                                       |
| Session contract                                             | `src/core/agent/agentBackend.ts` (`setFallbackModel?`, Model API only)                                                                                                                                                                           |
| VS Code setting, off by default, machine scope               | `package.json`, `package.nls.json`, `package.nls.*.json` × 14, `src/shared/constants.ts` (`SETTING_DEFAULTS`, `MACHINE_SCOPED_SETTINGS`, `ACP_CONFIG_IDS.fallbackModel`), `src/host/settings.ts`, `src/extension.ts`                             |
| Words in English + 14 tables                                 | `src/shared/l10n/en.ts` (4 keys), `l10n/ui.*.json` × 14, generated `desktop/crates/l10n`                                                                                                                                                         |
| `exec --fallback-model` + tests                              | `src/runtime/cliOptions.ts`, `src/runtime/exec/execArgs.ts`, `src/runtime/cliHelp.ts`, `src/runtime/exec/runExec.ts`; `test/unit/execArgs.test.ts` (+5 tests)                                                                                    |
| ACP `fallbackModel` option + tests                           | `src/acp/fallbackOption.ts`, `src/acp/agent.ts` (option, `setConfigOption`, `initialFallbackModelId`, `applyFallbackModel`); `test/unit/acpFallbackOption.test.ts` (6 tests)                                                                     |
| Setting shape test                                           | `test/unit/manifest.test.ts` (+1 test)                                                                                                                                                                                                           |
| Reference catalogue source + generated files                 | `src/shared/featureCatalog.ts` (`refusal-fallback`), `src/shared/reference/referenceSource.ts` (capabilities); generated `docs/reference.md`, `reference.generated.*`                                                                            |
| Bundle-split registration                                    | `scripts/check-bundle-split.mjs` (`refusalFallback.ts` in `LAZY_ONLY`)                                                                                                                                                                           |
| Backlog + this record                                        | `docs/real-life/unproven.md` (lane section); `docs/certification/rlf-fallback.md`                                                                                                                                                                |
| Incidental repair (pre-existing, found in this lane's reads) | `src/shared/l10n/en.ts` `turnTransientFailed`: HEAD bytes `ce 93 c3 87 c3 96` (mojibake for the curly apostrophe) repaired to `’`. All 14 tables were already clean, no test pins the literal, and a repo-wide search found no other occurrence. |

Semantics, as built: `refusalFallbackTarget` switches only on the
`refusal` incomplete reason (only the Anthropic codec produces it,
so only Anthropic-shaped providers switch), with a non-blank named
model that is not the running model, once per turn. The
incomplete-with-calls throw is carved out exactly when the switch
will fire (calls were already answered, never executed, by
`adoptOutput`); the loop then switches through `setModel`
(PreModelSwitch hooks stay in force), notices the transcript, and
continues. The retry replays through the fallback model's own
codec, settles usage at its price, and spends the same budgets and
caps. A second refusal, an unresolvable name, a kept hook, or no
named model ends the turn with its true sentence. Subagent turns
inherit and fall back at most once each; compaction and hook model
calls never switch; Muse Code, external agents and team engine
workers are untouched.

Resume-run repairs (the first run never compiled or tested):

- `src/host/backend/modelApiBackendManager.ts`: the new dep is
  threaded through the manager (`typecheck` failed without it).
- `test/unit/execArgs.test.ts`: the end-to-end argv gains
  `--max-budget-usd 1` (the budget gate refuses Model API exec
  without it).
- `test/unit/manifest.test.ts`: the description assertion follows
  the file's literal-key convention (a dynamic index does not
  typecheck).
- `PLAN.md` §6 status phrase `built, verification pending` is not
  in the reader's `STATUS_PHRASES`; the sibling convention `built
and certified` is used, with the pending live run in the prose.
- Seven `unicorn` lint errors fixed (ternaries, condition order,
  `String#repeat`, the private helper placed with the class's
  private methods before its public section).
- `package.nls.<lang>.json` × 14 gain the translated setting
  description (`check:l10n` failed without them).
- `scripts/check-bundle-split.mjs` lists the new module in
  `LAZY_ONLY` (`build` failed without it).

## Proof: real-code tests (run, green)

- `test/unit/refusalFallback.test.ts` (11 tests): the real decision
  on real inputs — switches on `refusal` with a named different
  model, trims, stands on other stops / blank / same model / second
  refusal.
- `test/unit/acpFallbackOption.test.ts` (6 tests): the real option
  builder and value resolver — off plus session models, current on
  the fallback or off, unknown and agent-limited ids refused.
- `test/unit/execArgs.test.ts` (+5 tests, 72 in file): the real
  parser — off when absent, carried when set, blank as off,
  `--provider` qualification, Model API only, end to end through
  the real command line.
- `test/unit/manifest.test.ts` (+1 test, 42 in file): the setting
  is machine scope with a blank default, and its description says
  off and names the exec flag.
- Table-driven guards already in the tree cover the rest:
  every-setting default parity, machine-scope consistency, every
  parser flag on help, the reference coverage checks.

Focused runs (repo timeouts, `--maxWorkers=3`):

- `refusalFallback` + `acpFallbackOption` + `execArgs`: exit 0,
  89 passed.
- `manifest`: exit 0, 42 passed.
- `cliHelp` + `cliHelpConsistency` + `commandHelp`: exit 0,
  134 passed.
- Post-drill green re-runs: exit 0 (89 and 42 passed).

`vitest related` per changed source file (repo timeouts,
`--maxWorkers=3`; the OS-credential-store and vault suites
excluded per the brief — one early run pulled
`providerHeadersStore` in transitively and it failed with
`store-unavailable` before any write, nothing stored):

- `refusalFallback.ts` + `fallbackOption.ts`: 67 passed, 4 failed —
  3 `providerHeadersStore` (`store-unavailable`, forbidden suite,
  excluded afterwards) and 1 `acpUpdateNotSent` load flake (passes
  in isolation and beside the lane's suites).
- `agentBackend.ts` + `settings.ts` + `modelApiBackendManager.ts`:
  129 passed, 37 failed — all environmental, zero in this lane's
  area: rig-broken git/Xcode (`xcodebuild` missing, exit 71) in the
  team/git suites, `EPERM` sandbox denials, 5 s timeouts under load,
  and the `acpUpdateNotSent` flake. Proven pre-existing on a clean
  HEAD clone: `scheduleFireFailures` fails all 6 with timeouts
  there too, and `conformanceDrivers` fails the same 2 tests;
  `schedulePauseAfterFailures` passes there (11.7 s) and only timed
  out under the 146-file batch load here.
- `cliHelp.ts` + `cliOptions.ts` + `featureCatalog.ts` +
  `referenceSource.ts`: 53 passed, 1 failed (the `acpUpdateNotSent`
  flake).
- `acp/agent.ts` + `execArgs.ts` + `runExec.ts`: 49 passed,
  1 failed (the `acpUpdateNotSent` flake).
- `ModelApiHost.ts`: 54 passed, 0 failed (423 tests).
- `extension.ts` + `constants.ts` + `en.ts`: see below.

## Red/green drills (all ran; every red exits 1)

1. Decision fires on `refusal` only: `refusalFallback.ts`
   `'refusal'` → `'DRILL-BROKEN'`; `refusalFallback.test.ts`
   exits 1 (2 failed: the switch and trim tests). Reverted.
2. One fallback per turn: dropped the `didFallback` check;
   exits 1 (1 failed: the second-refusal test). Reverted.
3. Off by default: manifest default `""` → `"DRILL-BROKEN"`;
   `manifest.test.ts` exits 1 (2 failed: the D261 test and the
   every-setting default-parity guard). Reverted.
4. Model API only: dropped `'fallback-model'` from the exec
   modelApi-only list; `execArgs.test.ts` exits 1 (1 failed: the
   museCode test). Reverted.
5. ACP refuses unknown ids: the unknown arm returns ok;
   `acpFallbackOption.test.ts` exits 1 (1 failed: the unknown-id
   test). Reverted.

Post-drill green re-runs exit 0 (see above).

## Gates (every exit code)

| Gate                                                             | Exit                                                |
| ---------------------------------------------------------------- | --------------------------------------------------- |
| `npm run desktop:l10n`, `reference:generate`, `roadmap:generate` | 0, 0, 0                                             |
| prettier `--check` on touched files                              | 0                                                   |
| eslint `--max-warnings 0` on touched files                       | 0                                                   |
| `npm run typecheck`                                              | 0                                                   |
| `node scripts/check-l10n.mjs`                                    | 0                                                   |
| `npm run check:reference`                                        | 0                                                   |
| `npm run check:host-api`                                         | 0                                                   |
| `npm run check:plan`                                             | 0 (251 milestones, 0 drift)                         |
| `npm run check:roadmap`                                          | 0 (ROADMAP.md current)                              |
| `npm run check:catches`                                          | 0 (baseline matches; the one new catch is REPORTED) |
| `npm run duplication`                                            | 0 (0 clones)                                        |
| `npm run cycles`                                                 | 0 (no circular dependency)                          |
| `npm run deadcode`                                               | 0                                                   |
| `npm run build`                                                  | 0 (every budget holds; none raised)                 |

Note: this rig's `git` needs
`DEVELOPER_DIR=/Library/Developer/CommandLineTools` (its Xcode
install is broken); `node_modules` was stale here and needed
`npm ci` before the first suite ran.

## Held prose (for the real run's landing change)

CHANGELOG `[Unreleased]`, one line: "A refused Model API turn can
continue on your fallback model: name one in the Fallback model
setting (off until you do) and a refused turn continues on it,
once per turn, saying so; usage counts each model as itself."

README (Model API turn-behaviour section), one paragraph: "A turn
the provider refuses can continue on your fallback model. Name one
in `museSpark.modelApiFallbackModel` (blank, and off, until you
do); a refused turn then continues on it, once per turn, saying so
in the conversation, and usage counts each model as itself. `exec
--fallback-model` names one for a single headless run, and editors
using ACP set it per session. Without a fallback, a refused turn
ends with the refusal, as before."

docs/acp.md (session options), one paragraph: "The `fallbackModel`
session option names the model a refused turn continues on (off by
default). When a reply stops with the provider's refusal, the turn
continues on that model once, with a notice naming it; the session
then stays on it until the model option changes it. Each request is
billed at the model that ran it. The option is offered on the Model
API backend only."
