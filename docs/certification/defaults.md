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
