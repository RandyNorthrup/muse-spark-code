# INT0170-COMBINED — 0.17.0 release candidate from int/0170 and int/0180b

Branch `release/0.17.0` in worktree `mx-rel0170`, started from `origin/main`
`4da4ef666` (0.16.0), 2026-10-07/08, Windows host plus the Kubuntu rig for
targeted suites. Hooks stayed on for every commit; nothing was pushed. The
measured conflict map (`combined-017-conflict-map.md`) and its four lead
decisions were followed; deviations are listed below.

## Merge commits

| Step | Commit      | Parents                              | Content                                                                      |
| ---- | ----------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| 1    | `1e5dc24cb` | `4da4ef666`, int/0170 `2617dc159`    | M113–M117 onto 0.16.0, 93 conflicted files                                   |
| 1b   | `1e16306af` | `1e5dc24cb`, int/0170 `41dffa50b`    | the lane's final docs-only certification commit (lead addendum)              |
| 2    | `f3a6c1e5b` | `1e16306af`, int/0180b `516ace8d5`   | M105/M108/M109/M117 estimator, 125 conflicted files, plus 0.17.0 prep        |
| 3    | `507f7d4b2` | `f3a6c1e5b`                          | translated tables back in English key order                                  |
| 4    | `e5f3bdb55` | `507f7d4b2`                          | PLAN archive keeps every parsed milestone fact                               |
| 5    | `bdeaaa1f1` | `db0b46dc8`, origin/main `67099ce1b` | batch PR #144 (dev tools, ACP stream bound, vetting); D3/D102/DEP138 in PLAN |

Accepted lane heads contained: M116 `667c10380`, M108 `313c1df87`, M117
`c487fe828` (all ancestors of HEAD; none needed a separate merge).

Step 2's commit was made on the Kubuntu rig from the exact local index tree
(`13d934436`): on Windows, lint-staged's eslint chunk exceeded cmd.exe's
8,191-character line through the `eslint.cmd` shim ("The command line is too
long"). The rig ran the same pre-commit hook (eslint `--max-warnings=0
--fix` on 123 files, prettier, gitleaks: no leaks). The hook changed one
test's arrow body only; the local branch was then set to that commit. G-rows
for this class are a lead call (see below).

## Policy resolutions

- Translations: key-level three-way merges of `l10n/ui.*.json` and
  `package.nls*.json`; `referenceAcp` combines both command lists (the three
  CJK tables carry main's list; 0170 never changed them). After both merges
  every table was put back in the English table's nested key order, which
  the packaged `ui.tables.json.br` archive needs for a byte-exact round trip.
- PLAN.md: block-level merge on 0170's normalized layout (unique §3/§7/§8),
  main's and 0180b's edits to sections 0170 folded together re-applied by
  context, D6 kept in 0170's narrow table with main's eight M106/M107 rows,
  0180b's estimator and `reference.js` rows and `wire.js` 75 KiB. Six 0.16.0
  and two 0.18 sections gained dated status rows. 147 closed (built,
  certified, merged, released, complete, superseded) milestone sections
  outside 0.17/0.18 and M91/M93/M100 moved to `docs/plan-archive/milestones.md`;
  each keeps its heading, status rows, Goal/Depends on/Gates fields,
  checklist and lane tables and a pointer. Every one of the 194 milestones
  parses to identical facts before and after. 3,840,756 / 4,194,304 bytes.
- CHANGELOG: 0.16.0's dated section unchanged; a dated `[0.17.0] -
2026-10-08` section with five Highlights collects 0170's and 0180b's
  entries; `[Unreleased]` keeps main's M101 Pending items.
- Money: 0180b's `usd.ts` with `usdSchema.ts` (main's `@__PURE__` builders
  restored); 0170's schedule paths ported to `UsdAmount` (shared-day claim
  through main's authority, schedule records keep their numeric schema and
  convert once at the fire-record edge).
- Moved symbols: `statusDotClass` lives only in `toolStatus.ts`;
  formatters in `l10n/text.ts`; palette split per 0170 with 0180b's estimate
  row in `paletteRegistry`.
- Positional collisions fixed: `readFile(path, expected?, signal?,
observeSource?)`, `describeTool(tool, args, isArgumentPreview, output?)`,
  `allows(request, requiresAsking, ask, signal?)` (also in
  `transcribeBatch.ts`), `shellArguments(platform, cmd, job, isGoverned,
isFenced)`, MuseCodeHost's extra argument before `accountHome`.
- Broken-without-markers list: one `surfaceKeys` and one handler per English
  region in `uiTextRegions.mjs` (surface, reference, resource, account);
  AgentMap's map block carries main's `onControl`/`onOpenFile` and 0170's
  playbook props; `client.ts` uses `media ? undefined : paidReservation(...)`;
  App.tsx no longer calls `paletteModule?.slashCommandsOf`;
  `helperRequestSettlement` returns `UsdAmount`; `L10N_COMPRESSION_QUALITY`
  declared once.
- Workflows: build.yml downloads the vault artifact; hosts/forks/action-check
  now build, upload and unpack `muse-vault` and `muse-dictate-screen.app`.
- Release prep: 0.17.0 in `package.json` and the lock's two root entries;
  README and Marketplace README have one What's new (0.17.0) with 0.16.0
  under "Earlier in 0.16.0" and the contents anchor moved.

## Deviations from the map

- Gotcha ids collided: 0170's G53–G56 and G57 became G66–G70, 0180b's
  G55–G59 became G71–G75 (G60/G61 kept; G65 left for batch PR #144); record
  and PLAN references updated.
- ACP compaction test: main's `acknowledgeQueued('notTaken')` assertion is
  now `commitQueued` not called (0170 replaced the API with leases).
- Tests ported to merged APIs without weakening: exact USD literals, the two
  NaN refusal cases use one documented malformed amount (PLAN §8 row still
  to add), `provisionalSeen`, palette-registry mock path, fenced
  `shellArguments`, exec `budgetUsd: '1'`, paid-consent "Stop preserves the
  popup" uses `voice` (search approval now returns a quote).
- Not done: M115's three editor commands still have no activation
  registration; the account MSP spawn on Windows is PID-registered without
  the native job; vault MCP stdio is not governed (no production builder);
  media requests inside scheduled runs get no schedule-cap claim and read
  media refs are not in the schedule ledger.

## Regenerated artifacts

Reference (77 features, 69 commands, 100 settings, 29 slash, 257 CLI),
host-API record (378 APIs, 49 vscode importers), exec schemas (match),
report schema, vault schema, design tokens (0 problems), third-party
notices (92 packages, unchanged). README PNGs are 0170's reviewed captures;
not re-shot after step 2.

## Caps after both merges (`npm run build`, Windows host)

| Artifact                      | Measured        | Cap       | Main driver                                        |
| ----------------------------- | --------------- | --------- | -------------------------------------------------- |
| `dist/runtimeQuestions.js`    | 26,097 B        | 25 KiB    | shared constants.ts growth (both branches)         |
| `dist/conversation.js`        | 261,054 B       | 250 KiB   | conversationController.ts (both), 0180b paths 4 KB |
| `dist/runtimeEngine.js`       | 914,158 B       | 875 KiB   | ACP agent/MuseCodeHost growth, 0180b media/vault   |
| `dist/usagePanel.js`          | 85,306 B        | 75 KiB    | 0170 scheduleV2.ts 9.3 KB, main resources 7.7 KB   |
| `dist/headless.js`            | 103,100 B       | 100 KiB   | main exec 10.5 KB, 0180b 6.4 KB                    |
| `dist/runtimeAccounts.js`     | 347,643 B       | 300 KiB   | MuseCodeHost/toolIo closure grown by 0170/main     |
| webview surface English       | 26.9 KiB        | 25 KiB    | both branches' deferred strings                    |
| webview Palette closure       | 25.7 KiB        | 25 KiB    | estimate row + schedule rows                       |
| webview estimator panel       | 25.0 KiB (over) | 25 KiB    | estimator panel and contracts                      |
| `dist/modelApi.js`            | 531,762 B       | 525 KiB   | within cap; private review ratchet 474,100 fails   |
| `dist/extension.js`           | 585,004 B       | 600 KiB   | ok                                                 |
| `dist/acp.js`                 | 234,060 B       | 850 KiB   | ok                                                 |
| `dist/exec.js`                | 1,444 B         | 950 KiB   | ok (runExec lives in headless.js)                  |
| `dist/reference.js`           | 58,168 B        | 125 KiB   | ok                                                 |
| webview main + static imports | 748.2 KiB       | 900 KiB   | ok by the build gate; ratchet not re-measured      |
| AgentMapContent chunk         | 11.9 KiB        | 25 KiB    | ok                                                 |
| VSIX                          | not produced    | 2,841,600 | `npm run package` stops at the bundle gate         |
| PLAN.md                       | 3,840,756 B     | 4 MiB     | ok after archive                                   |

No cap was raised. Shrink options are in the lead report.

## Gates

Five typechecks: 0 errors each (host, webview, unit, e2e, integration) at
step 2 and again at step 5 after a fresh `npm ci` with #144's tools. `npm run build`: exit 1 (caps above). `npm run package`: exit 1
(same gate; macOS artifacts also absent on Windows). check:l10n 0 problems;
check:plan 0 drift; release-prep unit files readmeVersion, whatsNewContent,
changelogVersion, checkBadges pass; vsixPackaging passes on Kubuntu after the
table reorder. Static batch results are appended below.

Kubuntu targeted batch (14 files): failures in execStdio (package build stops
at the caps), paidDailyBudget/accountPaidConsent (0180b's M108 tests assert
numeric/nano-USD amounts against main's exact decimal ledger), schedulePaid
(three durable-reservation cases), deferredBundles (Model API review ratchet
531,762 > 474,100; legal scanner cap fixture), browserUiText (account English
not reachable from the probe's entry graph).

## Remaining for CI and the lead

Hosted CI full gate; macOS helper artifacts and universal VSIX measurement;
the cap decisions; M115 command registration; the lead's INT0170 open list
(axe duplicate Help ids, jscpd clones, SAST findings, visual-gate fixture,
journal coverage time) was not addressed in this pass.

### Static batch (Windows host, after step 4)

| Gate            | Exit | Note                                                                                                                                    |
| --------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| format:check    | 0    |                                                                                                                                         |
| check:reference | 0    |                                                                                                                                         |
| check:host-api  | 0    |                                                                                                                                         |
| check:plan      | 0    | 194 milestones, 0 drift                                                                                                                 |
| check:tokens    | 0    |                                                                                                                                         |
| check:l10n      | 0    |                                                                                                                                         |
| deadcode (knip) | 0    | plain knip                                                                                                                              |
| cycles (dpdm)   | 0    | union of all roots                                                                                                                      |
| duplication     | 1    | 4 new clones: `src/acp/agent.ts` 2052–2059, `src/shared/l10n/text.ts` 156–162, two test fixtures (paidDailyBudget, modelApiElicitation) |
| lint (full)     | n/r  | not run in full; the pre-commit hook linted every changed file of steps 1–2 at zero warnings                                            |
| check:visual    | n/r  | not run (full reviewed matrix needs the hosted replay)                                                                                  |

## Money and schedule ledger (MONEY017)

Kubuntu, `rel017/money`, base `7a4fc2ab3`, 2026-10-08. Fake-only; no
credentials, paid/live calls, merge, push or gate changes. The rig brief
supersedes the common file's historical merge/full-quality instructions.

- Initial default-timeout run of paidDailyBudget, accountPaidConsent and
  schedulePaid: 69 tests, 17 failed / 52 passed. All three schedule failures
  were numeric expectations (`0`, `0.3`) against exact strings, with no
  reservation-logic failure. They retain every refusal and allow assertion.
- Daily-budget tests keep exact headroom, token price, refunds, account-swap
  liabilities and Judge totals. An entered `1.0000000001` stays exact rather
  than rounding to nanos. Captured numeric usage projections stay numeric.
  The account fixture records one simulated request even when key retrieval
  repeats before token dispatch; its threshold still refuses at exactly one.
- Account popup assertions supply an explicit frozen search quote; Always
  tests persist quote ceilings scoped by provider/account/accepted tariff,
  instead of expecting legacy feature bits to authorize quoted search.
- The test-only malformed branded NaN injection stays, with its inline reason
  and PLAN §8 row: both constructors reject it, so constructing it in the test
  would bypass the production defenses the two assertions exercise.

The account consent binding now uses canonical `UsdAmount`, including an exact
`0.0000000001000000000000000000001` budget passed unchanged to consent. Display uses the
shared conservative significant-digit formatter; it never changes the budget.

Scheduled media replaces its original shared-day claim with the schedule's
shared-day claim before dispatch. Admission uses the complete frozen media
amount plus any bounded hosted-search allowance, checks both schedule caps and
the shared budget, and settles once through media's admitted tariff snapshot.
Missing usage retains uncertain liability. Cap refusal refunds unsent claims
and makes no HTTP request. The existing durable reservation ledger is unchanged.

The checked native media handle reports its SHA-256, normalized canonical path
and native read identity through `observeSource`. The scheduled adapter records
that source against the workspace decision; media receipts and their replay
projection carry closed provenance into the next request. A read completed
after Stop is discarded before its source is recorded or another call starts.
No model wire shape was invented: regressions use existing fake-only fixtures.

Initial new-media run: six failures proving missing schedule admission,
source observation and replay proof. Restored money/ledger/schedule/media sweep:
59 files / 1,046 tests passed at repository deadlines, max three files and
three workers per invocation. Two additional final regressions cover exact
sub-nano account consent and hosted fees; final fresh-clone totals follow below.
The pre-existing 10,000-fire journal test retains its named 240-second deadline;
no command supplied `--testTimeout`.

Each deliberate drill below exited 1; original source bytes were restored and
SHA-256 compared before continuing. These are drill-time hashes after the final source
repairs. Normal restored runs pass; no assertion or gate was weakened.

| Drill                      | Failing / passing tests   | Source SHA-256 before = after                                      |
| -------------------------- | ------------------------- | ------------------------------------------------------------------ |
| `account_budget_precision` | 1 failed / 12 passed (13) | `73cd8cc955fd359cf61304a8c509c3d88f31ffdb7003e7146559d71bbfb007c7` |
| `hosted_media_allowance`   | 1 failed / 21 passed (22) | `e43d94993b5136f1e339bf879a4b01344dca887095ad2e2f37a2b9598b1a102c` |
| `exact_media_amount`       | 4 failed / 18 passed (22) | `73cd8cc955fd359cf61304a8c509c3d88f31ffdb7003e7146559d71bbfb007c7` |
| `daily_refund`             | 4 failed / 18 passed (22) | `2f23168f674ca283010f723f134762937aeab21fc84ae65bf7e81e96b1c87950` |
| `daily_transfer_guard`     | 1 failed / 14 passed (15) | `2f23168f674ca283010f723f134762937aeab21fc84ae65bf7e81e96b1c87950` |
| `media_source_observer`    | 1 failed / 8 passed (9)   | `c36d2ecfe7fc8e9927d57ad13ead24bec35c749d0ba45402193c4c9b6a465ebf` |
| `media_replay_proof`       | 1 failed / 19 passed (20) | `8dbc54dce83f7ab5bcdd239db30c6e146c8f4be1a7f527865f654b551997940a` |
| `stopped_media_read`       | 1 failed / 19 passed (20) | `8dbc54dce83f7ab5bcdd239db30c6e146c8f4be1a7f527865f654b551997940a` |

First fresh clone exposed a verification `Promise<void>` adapter after the
workspace decision began returning its ID, and one account-home pay-as-you-go
fixture still carrying nano-USD. Both are ported without changing behavior or
assertions. Scoped duplication exposed two test clones: the inherited daily
budget setup now uses its existing builder, and two media cases share one
parameterized assertion body. The new PLAN entry also needs its explicit
status for the parser. No gate setting changes; final clone receipts follow.

The four assigned findings map to these final source/test locations:

| Finding                             | Fix                                                               | Regression                                                 |
| ----------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| Exact daily budget and M108 consent | `paidDailyBudget.test.ts:186`, `paidConsent.ts:830`               | `paidDailyBudget`, `accountPaidConsent:55`, `accountHomes` |
| Three durable schedule failures     | `schedulePaid.test.ts:503` (exact expectations; ledger unchanged) | `schedulePaid:484`, `:503`, `:521`                         |
| Scheduled media claims and cost     | `client.ts:540`, `mediaCost.ts:333`, `paidConsent.ts:210`         | `mediaClient:158`, `:196`, `:215`; `mediaAccounting:75`    |
| Scheduled media sources/references  | `toolIo.ts:731`, `ModelApiHost.ts:7268`, `:8291`                  | `toolIoMedia:63`, `modelApiMedia:95`                       |
| Malformed NaN refusal probes        | `schedulePaid.test.ts:74`; inline reason and PLAN §8              | Both existing estimate/durable-reservation NaN refusals    |

Final ordinary clone under `$TMPDIR`, source `0662bd00e`, Kubuntu,
Node 24.18.0 / npm 12.0.1. `npm ci` installed the unchanged lockfile
(901 packages); all verification commands below ran with `CI=true`.

| Gate              | Exit   | Receipt                                       |
| ----------------- | ------ | --------------------------------------------- |
| `npm ci`          | 0      | Fresh clone, ordinary install                 |
| Five typechecks   | 0 each | host, webview, unit, e2e, integration         |
| Scoped eslint     | 0      | 16 changed TS/TSX files, `--max-warnings=0`   |
| Scoped prettier   | 0      | All changed files                             |
| Plain knip        | 0      | No strict/production switch                   |
| Scoped jscpd      | 0      | 16 files, zero clones; threshold remains zero |
| `check:l10n`      | 0      | Zero problems                                 |
| `check:reference` | 0      | Generated reference current                   |
| `check:host-api`  | 0      | Record current; portable boundary intact      |
| `check:plan`      | 0      | MONEY017 status parsed, zero drift            |
| `npm run build`   | 1      | Only the nine integrated size caps below      |

Production compilation and token validation succeed. The size gate stops the
full build; subsequent split/host-global/notice stages are not reached by that
command. No package or successful full-quality claim is made. Unchanged caps:

| Artifact                       | Measured KiB | Cap KiB |
| ------------------------------ | ------------ | ------- |
| `dist/runtimeQuestions.js`     | 25.5         | 25      |
| `dist/conversation.js`         | 255.0        | 250     |
| `dist/runtimeEngine.js`        | 894.0        | 875     |
| `dist/usagePanel.js`           | 83.3         | 75      |
| `dist/headless.js`             | 100.7        | 100     |
| `dist/runtimeAccounts.js`      | 339.5        | 300     |
| `dist/webview surface English` | 26.9         | 25      |
| `dist/webview Palette`         | 25.7         | 25      |
| `dist/webview estimator panel` | 25.0         | 25      |

`dist/modelApi.js` is 520.6 KiB / 525 KiB; `dist/extension.js` is
571.3 KiB / 600 KiB. These caps predate the lane in the combined record;
the brief assigns their shrink and integrated full quality to the lead.

Final fake-only fresh-clone sweep: **60 files / 1,099 tests passed**, 20
invocations, each at most three files with `--maxWorkers=3`, `CI=true`, no
`--testTimeout`. All required money/ledger/schedule families are included,
plus media, unattended, account-USD and account-home companion coverage.
The 10,000-fire journal workload passed its existing 240-second deadline.

Paths below are under `test/unit/`; every batch exited 0:

| Batch files                                                                                     | Passing tests |
| ----------------------------------------------------------------------------------------------- | ------------- |
| `accountPaidConsent.test.ts`, `acpPaid.test.ts`, `paidAuthority.test.ts`                        | 58            |
| `paidConsent.test.ts`, `paidDailyBudget.test.ts`, `scheduleBackground.test.ts`                  | 82            |
| `scheduleBackgroundTarget.test.ts`, `scheduleBinding.test.ts`, `scheduleChannel.test.ts`        | 43            |
| `scheduleClock.test.ts`, `scheduleCommand.test.ts`, `scheduleEditor.test.tsx`                   | 55            |
| `scheduleEvents.core.test.ts`, `scheduleEvents.local.test.ts`, `scheduleEvents.network.test.ts` | 31            |
| `scheduleEvents.signals.test.ts`, `scheduleFakes.test.ts`, `scheduleFs.test.ts`                 | 65            |
| `scheduleGrant.test.ts`, `scheduleInterrupt.test.ts`, `scheduleJournal.test.ts`                 | 36            |
| `scheduleMigrate.test.ts`, `scheduleOutbox.test.ts`, `schedulePaid.test.ts`                     | 75            |
| `schedulePrompt.test.ts`, `scheduleProvenance.test.ts`, `scheduleRegistration.test.ts`          | 20            |
| `scheduleReportAction.test.ts`, `scheduleReportCli.test.ts`, `scheduleReportEditor.test.tsx`    | 40            |
| `scheduleRestartRecovery.test.ts`, `scheduleReview.test.tsx`, `scheduleRunIdentity.test.ts`     | 18            |
| `scheduleRunRows.test.tsx`, `scheduleRuntime.test.ts`, `scheduleRuntimeEntry.test.ts`           | 30            |
| `scheduleSessionOwner.test.ts`, `scheduleStore.test.ts`, `scheduleStrings.test.ts`              | 42            |
| `scheduleSurface.test.ts`, `scheduleSurfaceWebview.test.tsx`, `scheduleTime.test.ts`            | 69            |
| `scheduleV2.test.ts`, `scheduledReports.test.ts`, `scheduledReportsDeterminism.test.ts`         | 48            |
| `scheduledRunConfirmation.test.ts`, `scheduler.test.ts`, `schedules.test.ts`                    | 47            |
| `sessionBudget.test.ts`, `sessionBudgetJournal.test.ts`, `usd.test.ts`                          | 94            |
| `mediaAccounting.test.ts`, `mediaClient.test.ts`, `modelApiMedia.test.ts`                       | 57            |
| `toolIoMedia.test.ts`, `modelApiMediaTools.test.ts`, `unattended.test.ts`                       | 41            |
| `unattendedBackends.test.ts`, `accountUsd.test.ts`, `accountHomes.test.ts`                      | 148           |

Commits `302d6e6f4`, `b71be1ba7` and `0662bd00e` ran normal pre-commit
hooks (eslint fix, prettier, gitleaks). After each, the index and committed
diff were re-read; the latter two exactly match the hook's pre-task index.
All eight restored drill hashes match the committed source. Final receipt
changes are documentation only. No dependencies, prices, limits, timeouts,
ignores or lint levels changed; no paid/live model attempt occurred. The lane
ran no full quality, merge, push or packaging, as directed by its brief.
