# DEFAULTS — D78 interactive defaults and daily paid admission

Base: `23f38dd6`, branch `feat/defaults-on`, worktree `mx-defaults`.
Owner brief: DEFAULTS.md and common.md, 2026-10-04. No live calls or public
pushes are authorized. The lane uses rig snapshots, leaving its index alone.

## Readiness and reuse

Reviewed D48, D62/D65, M73's passing M75 record, Q11/M67, existing hook trust
checks, paid gates/consent/tallies, and M82's durable journal/final admission.
Inventory succeeded: TypeScript/React, existing strict gates and pinned lock.
No dependencies, HTTP/MSP shapes, model text or golden fixtures are added.
The new daily adapter is necessary because PaidUsage is window-local; it
reuses the journal rather than treating globalState updates as atomic.

The explicit initial-budget port seeds a newly opened daily scope at zero;
it does not manufacture a conversation. All windows/workspaces/keys in the profile share that scope.
Reservations own their dispatch day's liability, even after midnight or a
crash. Known usage settles it; a known nonsend or explicit refusal refunds it;
unknown sent usage keeps its full reservation. The cap uses M82's conservative
input estimator and verified tariffs, with its existing billing assumptions;
it is an admission budget, not a provider invoice or an audit of earlier
versions' spending. Tab's separate daily ledger is excluded.

The generic feature-delivery validator reported `input-error`: this existing
PLAN has no quality-ledger fence. Its structural check is deferred under the
lane's canonical-plan instruction; D78 and the DEFAULTS milestone remain the
acceptance ledger. Full quality, browser/integration and hosted gates belong
to the lead under common.md; this lane must not run the aggregate locally.

## Changes and acceptance

| Setting                    | Before                                 | After                                                                           |
| -------------------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| modelApiObservationPacking | false                                  | true                                                                            |
| modelApiHooks              | false                                  | true; inert without configured files; trusted only                              |
| modelApiReplyUsage         | false                                  | true; display only                                                              |
| modelApiWebSearch          | false                                  | true availability; finite-cap transport refused                                 |
| modelApiImageGeneration    | false                                  | true availability; consent and daily admission                                  |
| modelApiVoice              | false                                  | true availability; free system engine remains selected                          |
| modelApiAutoReviewer       | false                                  | true availability; consent and daily admission                                  |
| modelApiSubagents          | false                                  | true availability; consent, tariff revision and daily admission                 |
| modelApiScheduledPrompts   | false                                  | true availability; explicit run and daily admission                             |
| modelApiBestOfN            | false                                  | true availability; separate explicit action, ordinary turns remain single-model |
| modelApiRepoMap            | false                                  | false; Q11 paired evaluation specified in D78                                   |
| paidDailyBudgetUsd         | absent                                 | 5; machine-scoped, 0.50–500                                                     |
| dictationEngine            | voice availability selected the engine | system; Model API engine choice separate                                        |

Default availability causes no startup price confirmation. Explicit false
remains false; OFF-to-ON still confirms. First paid use retains the existing
three-choice modal with price and daily budget. Always remains per workspace,
revocable and subject to current tariff and every final admission. Native VS
Code modals/settings preserve keyboard access and responsive host behavior;
no webview markup or styles change. English plus all fourteen manifest and
UI translations move with code. README, PRIVACY, CHANGELOG and AGENTS follow D78.

## Verification history

- macmini baseline defaults drill: snapshot `9f224ba6`, settings suite exit 1,
  two `expected false to be true` failures before the flip.
- macmini typecheck: snapshot `37c59349`, all five projects exit 0. Later
  scheduled-compaction classification/style changes require fresh final proof.
- macmini scoped suite: snapshot `a821fb78`, 197 tests, 196 pass, one new test
  used the text map for binary image output. The real paid path and held
  first-use checks passed; fix uses the fixture's binary map.
- Preliminary lint found 31 style findings; repaired without suppressions.
  Local lint was stopped after ownership verification (mx-defaults PID 4880,
  about 1 GB, seven minutes) and moved to rigs to free the coding host.
- macmini transfer later failed before gates: remote unpacker could not
  create a temporary object directory. No cleanup or service changes made;
  subsequent runs use Kubuntu.

Kubuntu static candidate `352af2dd` passed scoped ESLint, all five typechecks,
knip, jscpd (0 clones), localization (14 tables, 122 manifest strings, 0
problems), host API (275 APIs, 0 problems), and production build including
split/global/notices checks. Runtime: Node v24.18.0, npm 12.0.1. Bundle sizes:
extension 558.0/600 KiB, Model API 428.0/475, checkpoint store 109.1/225,
webview 860.8/900, ACP 786.7/850. The 475 KiB Model API cap is already main's
D6 gate; this lane changes no cap. The first build caught an activation
import of backend-only session-budget arithmetic. The repair keeps token
estimation in the lazy backend's existing final guard and passes its numeric
bound through internal callback metadata, with no HTTP fields.

Kubuntu candidate `5c5edab6` passed 838 tests in all fourteen owning files,
including sessionBudgetJournal's real shared-disk cases, the entire host
suite, packing/hooks, first-use modal, daily race/refusal/corruption/reset,
request-byte controls, explicit false, current tariffs, grant withdrawal and
ACP flag/display preservation. The baseline is green before the drills.

## Red / restored drills

All ran through rig-test.sh on Kubuntu, whole owning files, no filtered or
skipped tests. Every mutation exited 1 for the intended assertion; each file
was restored byte-exact with SHA-256 comparison in finally, and the identical
test command then exited 0. Logs remain under this worktree's ignored
`temp/defaults-red-<name>.log` and `temp/defaults-restored-<name>.log`.

| Drill           | Mutation                                 | Observed failure                                                              | Restored source SHA-256 prefix |
| --------------- | ---------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------ |
| default         | Packing default true → false             | Settings expected false to be true; manifest/fallback disagreement            | B3283B7CDD80CB95               |
| consent         | Replace awaited popup answer with once   | Real host and direct first-use tests expected modal once, got 0               | 7AAEE96E7D519F0A               |
| daily-refusal   | Bypass over-cap raise/refusal            | Reserve promise resolved instead of rejecting                                 | E1184B01292934FD               |
| fail-closed     | Bypass image daily reservation           | Corrupt-ledger image promise resolved instead of rejecting                    | 8A91FEDCDE0BD4A9               |
| explicit-false  | Treat false as missing setting           | Explicit false expected true to be false                                      | BA2F4400FC4168CE               |
| final-admission | Remove synchronous claim check           | Cap changed during key retrieval; image promise resolved instead of rejecting | 8A91FEDCDE0BD4A9               |
| tariff          | Bypass current subagent tariff condition | Old grant unexpectedly remembered, expected true to be false                  | E2D67E652666A720               |

Restored counts: default 43; consent, daily-refusal, fail-closed and final
admission 11 each; explicit-false 12; tariff 19. Full hashes were compared,
not only the prefixes above. No mutant remains. Docs/manifest/translation
Prettier check exited 0 on the coding host.

## Final integration binding

Feature commit `e748d7512a6f73335e1a1cb2575f8cc1a7cf54e3`, merged with
`origin/main` at `30de7c89` into `7c4f9551548eb651a447e9941ca9075d212640d1`.
The named integrate/m72 branch is absent locally; current main retains its
M72 integration. Git merged CHANGELOG, PLAN and README cleanly by meaning;
no feature or translation conflict was dropped. origin/main is an ancestor
of the merged tree. No public push was made.

Kubuntu snapshot `72e60738` of that merged tree passed scoped ESLint, all
five typecheck projects, deadcode, jscpd (0 clones), localization (0
problems), host API (0 problems), and the complete production build's size,
split, host-global and notice checks. Sizes remain extension 558.0 KiB,
Model API 428.0, webview 860.8, checkpoint store 109.1; ACP is now 786.8
after main's CI merge. All caps remain unchanged.

Kubuntu snapshot `f94fb145` passed 928 tests in sixteen whole owning files,
including the two headless/Action runtime suites after main's merge. No
tests were skipped or filtered. The lane's fifty-five changed files passed
Prettier check on Windows. Gitleaks scanned committed changes from
`23f38dd6..HEAD`: four non-merge patches, 315,699 bytes, exit 0, no leaks.
Drilled source hashes remain unchanged by the merge and formatting checks.

**Hook setup finding.** The feature and merge commits used normal Git, but
this new worktree lacked the ignored `.husky/_/pre-commit` dispatcher, so
their hooks did not run. No bypass flag or HUSKY skip was used. `npm run
prepare` installed the dispatcher in this worktree; core.hooksPath remains
the existing relative `.husky/_`. The same source lint/format checks and a
committed-change secret scan passed explicitly. History was not rewritten;
the final evidence commit uses the installed hooks. This setup miss is
reported rather than claimed as an earlier passing hook.

Next owner/lead actions: review the source and receipts, run the prohibited
aggregate/platform/hosted gates on the final reviewed tree, integrate M91's
actual goldens and M94's separate ledger, and obtain verified search/voice
billing bounds before offering either transport under a finite daily cap.

## Remaining external gates and deliberate limits

- Hosted search has no captured hard query bound; voice has no verified
  billed-duration bound/receipt. Both retain M82's finite-cap refusal. Shipping
  either as usable under this cap needs new verified billing evidence and an
  owner-approved implementation; this lane is forbidden live calls.
- M91 hooks golden fixtures and M94 Tab are absent from this lane's base and
  current origin/main. No fixture is rewritten. The ordinary single-model
  packing-on/hooks-off control compares whole request JSON byte-exact with and
  without daily admission; actual M91 integrated goldens remain the lead's gate.
- Repo-map prompt injection stays off; D78 records its exact baseline/map-only
  M75 task counts, floors, model, token bound and spend bound. No eval run here.
- ACP/headless flags and budgets, Muse Code subscription/explicit paid opt-ins,
  and confidential-workspace policy remain unchanged. Aggregate certification
  and public publication are not claimed by scoped fake-only tests.

## FIXDEF — RVDEF follow-up (2026-10-04)

Started from the reviewed `401eb14f9e0054b0409c6df4874c0adf4bb37090`, clean
`feat/defaults-on` worktree. Read FIXDEF.md, common.md and RVDEF.report.md.
D78 now records the repair scope. No dependency, external wire field, model
text, translation key, golden fixture or gate threshold changes are needed.

| Finding                                           | Repair                                                                                                                                                                                                                                                                         | Regression                                                                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1: a held raise clears a later Stop              | Separate monotonic day marker; raises never remove it. The marker and final admission dominate even a numeric replacement already handed to the OS.                                                                                                                            | Real disk, two windows: hold raise, commit Stop, actually land the late numeric write, retain Stop; tomorrow resets.                                                                                          |
| P2: unused packing changes the tools/cache prefix | `recall_output` is offered only with placeholders in this request's projected input. Replay and sticky packing remain unchanged.                                                                                                                                               | Real host/fake transport compares whole JSON across packing false/true with hooks and paid features off. Packing suite checks recall appears with the first packed output.                                    |
| P2: daily admission ignores cancellation          | Image and token callers pass their signal; image deadline also covers admission. Dialog waits and pending policy writes lose authority on abort, nonsends refund, final publication checks ownership. The numeric rename and its cancellation check share one event-loop step. | Held warning, held input and held policy write reject promptly, send nothing, refund known nonsends and cannot publish late answers.                                                                          |
| P2: backend changes withdraw grants               | Configuration and backend availability are separate gate ports. Review revokes only when the configured setting is off.                                                                                                                                                        | Startup unavailable, Model API Always, Muse Code/focus review, Model API again: availability changes, accepted price/generation and Always remain intact. Existing explicit-OFF and tariff tests still apply. |
| P3: Best-of-N overview says off by default        | README overview now says available by default and retains the explicit action/consent contract.                                                                                                                                                                                | README assertion agrees with manifest/fallback behavior and rejects the stale claim.                                                                                                                          |

Kubuntu baseline snapshot `265690e2` exited 1: all seven new scenarios failed
for the intended reasons, with the original 42 tests passing. No test-name
filter, skipped test, live call or local Vitest run was used. Restored candidate
`819cc91c` passed 67 tests in four whole owning files. A stronger in-flight
rename race and held-policy-write cancellation case were then added;
candidate `bdd5548d` passed all 68 tests in those same files.

The warning-message API has no dismissal token. Cancellation ends its
operation and removes its authority immediately; a late answer is ignored.
This is fake-only lifecycle evidence, not a claim of a real VS Code UI run.

### FIXDEF guard-fire record

All seven mutants ran on Kubuntu through rig-test.sh, using whole owning
files. Every red run exited 1 for the intended assertions; every restored run
exited 0. The local source was restored in finally and its full SHA-256
compared with its saved bytes before the restored snapshot. Logs and the
runner remain in this worktree's ignored `temp/fixdef-*` artifacts.

| Guard                             | Red / restored snapshots | Red failure                                                     | Restored tests | Source SHA-256 prefix |
| --------------------------------- | ------------------------ | --------------------------------------------------------------- | -------------- | --------------------- |
| Stop marker                       | `e1bf628e` / `6a50b04c`  | Stop no longer refuses cap read                                 | 17             | `1f44b8826b8e8bc5`    |
| Unused packing prefix             | `2086719b` / `8fcadc55`  | Whole request differs; recall offered without a placeholder     | 35             | `5d48944cff5dc75b`    |
| Image admission signal            | `646b6dd1` / `2f4fff88`  | Held warning/input/write do not settle on abort                 | 17             | `d55cf3153a76f00c`    |
| Token admission signal            | `c8c3b138` / `b73fe254`  | Held token admission does not settle on abort                   | 17             | `d55cf3153a76f00c`    |
| Policy ownership                  | `8625a2d7` / `bd017f68`  | Cancelled dialogs/write can publish Stop or a raise             | 17             | `1f44b8826b8e8bc5`    |
| Configuration versus availability | `a195bac4` / `52f3e5f3`  | Backend review removes acceptance and advances grant generation | 20             | `05cd144303a803ef`    |
| Best-of-N docs                    | `387aaa51` / `cb7c6f7e`  | Default-availability claim no longer matches                    | 13             | `3c45767e867582a4`    |

Pre-merge static snapshot `8b7188e6` passed all five typecheck projects,
then scoped lint reported fourteen test-style errors (promise chaining,
boolean names and void resolver types). Repaired without suppressions and
shared the ordinary-turn/claim-reading setup in this same test file. The
guarded product files remain byte-identical to the drilled versions.

Snapshot `a923c9c0` passed all five typechecks, scoped ESLint and knip; jscpd
caught three repeated raise-fixture blocks. Shared that fixture without
changing behavior or thresholds. Snapshot `787e98f7` then passed the revised
test's lint, jscpd (0 clones), localization (14 tables, 0 problems), host API
(275 APIs, 0 problems), and the production build including all size/split/
global/notices checks. Sizes: extension 558.5/600 KiB, Model API 428.1/475,
checkpoint store 109.1/225, webview 860.8/900, ACP 786.8/850. Final pre-commit
snapshot `057f3566` passed 68 tests in four whole owning files after the
fixture cleanup. Windows scoped Prettier check exited 0.

### Proposed search and voice bounds: external evidence still required

The report proposes search `Smax=1`: reserve worst-case input/output token
cost plus USD 0.0025, and retain the full reservation after ambiguous dispatch.
It also requires a **server-enforced bound covering internal billed searches**.
The captured request is still only `{type:'web_search'}`; this tree has no
captured hard query limit. An output-token ceiling or displayed event count
cannot establish it. No invented field or unsupported search cap is shipped.

For voice, the report proposes `Dmax=180` seconds: USD 0.009 at USD 0.18/hour
under whole-second billing, a 5,760,000-byte bound across buffered/sent 16 kHz
mono PCM, a capture/socket deadline and fresh admission for every connection.
The existing protocol counts locally sent audio and supplies no billing
receipt. Accepted-audio billing, rounding/minimums and connection-time or
other overhead are still unverified. A recorder timer alone cannot establish
the proposed worst-case cost. Once the contract is verified, keep the full
worst-case reservation without a trustworthy settlement receipt; a missing
receipt by itself is not a reason to refuse a proven bounded feature.

Common.md forbids live/paid calls and unrelated network calls in this lane.
Enabling either transport safely therefore requires lead-supplied captured
contracts or separately authorized research/live evidence. Existing explicit
refusal and the free system dictation choice remain visible in README; these
two paid transports are an external blocker, not certified usable features.

### FIXDEF integration evidence

Feature commit `3db0ef3758a0bece6df6c9a5650d4c06d7b175e8` passed the installed
pre-commit hooks: scoped ESLint/Prettier and staged Gitleaks (27,174 bytes,
no leaks). Integrated current local `origin/main` at
`244d5905a94e3e5cd2b30659aa584649bc207663`, preserving M87 and D78. PLAN,
README, code and all translations merged cleanly. The one conflict was the
generated host-API inventory: regenerated from both features with the
canonical `check:host-api -- --write` command, 283 APIs and zero problems.
The prescribed changelog-rebase.py preserved main's released sections and
the branch's two Unreleased additions, without dropping either feature.

Kubuntu integrated static snapshot
`e3d16a614cceee3bdf14a75b8633914a1fa393d9` passed all five typecheck projects,
scoped ESLint, knip, jscpd (0 clones), localization (14 tables, 123 manifest
strings, 435 source files; 0 problems), host API (283 APIs; 0 problems) and
the production build's size, split, global and notices checks. Observed
runtime: Node v24.18.0, npm 12.0.1. Knip's existing `vendor/**` configuration
hint remains non-failing; no gate configuration changed.

| Integrated bundle | KiB / unchanged cap |
| ----------------- | ------------------- |
| Extension         | 568.3 / 600         |
| Model API         | 429.8 / 475         |
| Checkpoint store  | 109.3 / 225         |
| Webview           | 888.9 / 900         |
| ACP               | 787.8 / 850         |

Kubuntu integrated test snapshot `a3159c6c` passed **841 tests in fourteen
whole files**, with no skipped or name-filtered tests: paidDailyBudget,
paidHost, paidFeatures, settings, modelApiHost, modelApiClient, modelApiHooks,
modelCallHooks, modelApiPacking, sessionBudgetJournal, acpRuntime, execRun,
bestOfNManager and scheduledRunConfirmation. These receipts bind executable
and configuration files; later certification text records the receipts.

M91 golden files remain absent from this integrated tree; no golden was
rewritten. Next lead actions: review the five repairs and seven red/restored
drills, run full quality plus actual VS Code/platform/hosted gates on the
reviewed tree, integrate M91's goldens and M94's independent Tab ledger, and
supply verified search/voice billing contracts before enabling those finite-cap
transports. No live call, public push or release certification occurred here.
