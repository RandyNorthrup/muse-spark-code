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

### MONEY017B review repair (RVMONEY017, 2026-10-08)

Kubuntu, `rel017/money2`, base `054a9fd12`. The same fake-only and scoped
quality boundary applies. No hook substitution, merge, push or live/paid call.

P3: `rebindDaily` reserves its replacement before refunding the original,
retaining held headroom throughout the transfer. A failed refund releases the
nonsent replacement. The concurrent-admission regression holds the refund
while another request competes at exactly the remaining headroom: the original
request keeps its replacement. The existing second-transfer/dispatch refusal
assertions remain; the reserve now has already run once while refund is held.
Cap-refusal assertions additionally require explicit `hasUnknownCost: false`.

Base run with the new P3 regression and revised ordering assertion:
`mediaAccounting` **2 failed / 14 passed (16)**, exit 1, repository deadlines.
The same base-source restoration is the deliberate ordering drill; the repaired
source was restored byte-exact by SHA-256. Restored `mediaAccounting` + `mediaClient`: **38 passed**, exit 0.
Changed-source/test eslint `--max-warnings=0`: exit 0. Initial lint/hook
runs caught promise-wrapping, the unavailable `Promise.try` library type and
an unnecessary async wrapper; the competing synchronous admission now runs
directly while the original async refund is held.
Final fresh-clone receipts and P2 production/settlement regressions follow
when both repairs are complete.

P2: `ReplayMedia.budgetParts` detaches each actually projected media part and
adds its calibrated upper bound on every request, including replayed file IDs.
The host's session reservation uses those parts. Scheduled requests reuse the
durable session claim and attach `reserveMediaRequest` accounting to the
production guard; the client admits the first daily claim directly against the
schedule and shared-day ledgers. It does not temporarily double-reserve the
shared day. Interactive accounting/retry policy stays unchanged. Session
settlement includes hosted fees; capped media without verified usage retains
uncertainty consistently with its media claim. Missing calibration refuses.

D85.6 reserves at the worst case; D95.3 requires the hard schedule/shared caps.
Media and the shared schedule paid scope therefore **refuse an above-reserve
settlement**, retain admitted liability, and never post the excess without
admission. README's scheduled-media paragraph and Unreleased's first fix now
state the behavior exercised through `sendScheduledTurn` in the production host.
The existing runtime scheduler binding limitations remain outside this repair.

The tariff-aware fake paid port verifies the actual reserved amount, rather
than returning a fixed `0.001`. Video reads then file-ID follow-ups, image
attachments then same-fire file-ID replay, caps one nano-USD below the media
upper bound, Stop, and a bill above reserve are exercised through the real host.
Image fixtures use the attachment route, because `readMedia`'s contract is
video/audio/document; the test does not broaden that production contract.
Fixture corrections caught by typechecks/lint included exact USD returns,
that media-kind distinction, fake IO's concrete port, an unused parameter,
boolean naming, and an attempted write to frozen tariff state. No gate changed.

Latest base replay, with final regressions and original production source from
`054a9fd12`: `modelApiMedia` + `mediaAccounting` + `schedulePaid` **9 failed /
53 passed (62)**, exit 1. Restored final owning suites: **62 passed**, exit 0.
The independent numeric inventory probe on that base remains **1 failed /
12 passed (13)**, the same 21 entries as the fresh repaired clone. This qualifies
the earlier MONEY017 blanket statement about the required paid families.

| Finding                       | Fix                                                                                      | Regression                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| P2 production media admission | `ModelApiHost.ts:3646`, `:4794`, `:5929`; `replayMedia.ts:146`                           | `modelApiMedia`: tariff-aware scheduled video/image follow-ups and below-cap refusal                              |
| P2 unadmitted settlement      | `mediaCost.ts:407`, `paidConsent.ts:221`; host session accounting `ModelApiHost.ts:3944` | `mediaAccounting`: above-reserve bill; `schedulePaid`: rejected overage leaves `0.6` held; host excess-usage case |
| P3 held headroom              | `mediaCost.ts:339`                                                                       | `mediaAccounting`: concurrent admission at remaining headroom and held-refund dispatch/second-transfer fences     |

All final deliberate drills exit 1, restore exact bytes, and compare SHA-256.
P3's ordering drill was recorded with its first validated commit above.

| Disabled behavior                                  | Failed / passed | Restored source SHA-256                                            |
| -------------------------------------------------- | --------------- | ------------------------------------------------------------------ |
| Host attaches accounting                           | 3 / 21 (24)     | `7918fdf3e47405219881aa2397fc102865485fb790fb9e2073f218b15e2de2ce` |
| Media refuses above-reserve settlement             | 1 / 16 (17)     | `6b8413e52b6fdc56785ac7672bd3f7041f169e985e87001e84eb99870a6e685c` |
| Schedule scope refuses above-reserve settlement    | 1 / 20 (21)     | `76f592bf236b9086831a1ab25bb46def508028c984ff50801c36ee4466dfb59a` |
| Daily transfer reserves first (first-commit drill) | 2 / 14 (16)     | `fb774bd36f567d9ba9defbab020103ad75ab8acc0fc2ac35382328938b14bd00` |

Fresh ordinary clone under `$TMPDIR`, `npm ci` (901 packages), all verification
with `CI=true`. Final five projects pass; initial diagnostic reds were repaired
before the final runs. No command raises a test timeout, filters a test case,
uses strict knip, or changes the repository hooks.

| Gate                                 | Exit   | Result                                                                                                         |
| ------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------- |
| `npm ci`                             | 0      | Unchanged lockfile, ordinary install                                                                           |
| Five typechecks                      | 0 each | Host, webview, unit, e2e, integration                                                                          |
| `eslint --max-warnings=0`            | 0      | Nine changed TS files, final naming correction verified                                                        |
| Prettier                             | 0      | Changed files; final docs also pass normal hooks                                                               |
| Plain knip                           | 0      | No production/strict switch                                                                                    |
| Scoped jscpd                         | 0      | Zero clones, threshold unchanged                                                                               |
| `check:l10n`                         | 0      | Zero problems                                                                                                  |
| `check:reference` / `check:host-api` | 0 each | Records current                                                                                                |
| Required suite sweep                 | 1      | **28 files, 588 passed / 1 inherited failed (589)**                                                            |
| `npm run build`                      | 1      | Exactly the nine pre-existing caps listed below; Model API **521.7 / 525 KiB**, activation **571.3 / 600 KiB** |

The sweep includes every `paid*`, `media*`, `modelApiMedia*`, `sessionBudget*`,
`acpPaid`, `schedulePaid`, plus `replayMedia` and `modelApiAttemptBudget`.
Each invocation has at most three files and `--maxWorkers=3`. The only red is
`paidMoneyPorts`' inherited source inventory; its exact assertion is preserved.
All 62 owning regressions pass. The final post-naming `modelApiMedia` replay
passes 24 tests in the fresh clone.

| Batch | Files                                                  | Passed / failed |
| ----- | ------------------------------------------------------ | --------------- |
| 1     | acpPaid, mediaAccounting, mediaAttach                  | 53 / 0          |
| 2     | mediaBudget, mediaClient, mediaContracts               | 50 / 0          |
| 3     | mediaConvert, mediaCost, mediaFixtures                 | 60 / 0          |
| 4     | mediaLimits, mediaLocalization, mediaProviders         | 33 / 0          |
| 5     | mediaSniff, mediaSniffMalformed, modelApiAttemptBudget | 36 / 0          |
| 6     | modelApiMedia, modelApiMediaTools, paidAuthority       | 45 / 0          |
| 7     | paidConsent, paidDailyBudget, paidFeatures             | 104 / 0         |
| 8     | paidHookModels, paidHost, paidMoneyPorts               | 63 / 1          |
| 9     | replayMedia, schedulePaid, sessionBudget               | 93 / 0          |
| 10    | sessionBudgetJournal                                   | 51 / 0          |

The lead owns numeric-inventory reconciliation, the nine integrated size caps,
and aggregate quality (PLAN §7). There is no full-quality or fully-green-sweep
claim. Normal repository hooks are used, and staged/committed diffs are reread.
No merge, rebase, push or live/paid call. Scratch receipts remain under the lane's
`temp/`; the private fresh clone is removed after verification.

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

## Money ports (PORTS017)

Kubuntu, `rel017/ports`, base `1a2086399`, 2026-10-08. Fake-only: no paid/live
calls, credentials, dependencies, gate changes, merge or push. Full integrated
quality and the inherited bundle caps remain assigned to the lead by the rig
brief and PLAN §7. Current money ports carry canonical `UsdAmount`; token and
count arithmetic stays numeric. These are internal ACP schedule context and
CLI authorization fields, not fields of the external ACP specification.

| Current port                                                               | Validated boundary (source line)                                                                                                                                                              | Regression / owning coverage                                                                                                                  |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `acp/agent.ts:154`, `acp/schedules.ts:12`: `maxBudgetUsd`                  | `runtime/schedules/args.ts:44` (`usdInputSchema`); forwarded by `runtime/cliArgs.ts:384` and runtime/ACP contexts                                                                             | `paidPortBoundaries`, `acpSchedules`, `acpRuntime`, `scheduleCommand`                                                                         |
| `runtime/cliArgs.ts:87`, `runtime/schedules/args.ts:30,39`: `maxBudgetUsd` | `runtime/schedules/args.ts:44`, exact CLI decimal input                                                                                                                                       | `paidPortBoundaries` CLI precision and malformed-input cases                                                                                  |
| `runtime/schedules/registration.ts:53`: `maxBudgetUsd`                     | `runtime/schedules/registration.ts:73`: numeric unmarked/v1 wake records normalize on read; v2 writes are canonical                                                                           | `paidPortBoundaries` old numeric wake, `scheduleBackground`, `scheduleRegistration`, `nativeScheduleBackground`                               |
| `runtime/schedules/control.ts:102`: draft/grant `paidCapUsd`               | `shared/scheduleV2.ts:45` validated JSON/disk money codec; CLI authorization above                                                                                                            | `scheduleSurface`, `scheduleRuntime`, `paidPortBoundaries`, `schedulePaid`                                                                    |
| `core/estimator/recommend.ts:50,190`: `rentalCostP90Usd`                   | `core/estimator/recommend.ts:160` validated price cards; `:161` parses rates once; exact computed fraction at `:216`                                                                          | `estimatorRecommend`: decimal ties, sub-nano evidence, 0.1 + 0.2 rentals, malformed prices and overflow                                       |
| `core/paid/paidConsent.ts:68`: `sharedDailyBudgetUsd`                      | `shared/scheduleV2.ts:45,224`; `core/paid/paidConsent.ts:113` additionally validates the host identity before consent                                                                         | `paidPortBoundaries` numeric v2 consent read, `schedulePaid`, `mediaClient`                                                                   |
| `webview/schedules/ports.ts:56`: `sharedDailyBudgetUsd`                    | Same consent/host boundary; editor cap text (`webview/schedules/ScheduleEditor.tsx:378`) uses `usdInputSchema` without a float conversion                                                     | `scheduleEditor`, `scheduleSurfaceWebview`, `schedulePaid`                                                                                    |
| `core/reporting/sources/types.ts:140,146`: total/breakdown `costUsd`       | `core/reporting/sources/session.ts:25` validated source usage (`legacyUsdSchema`), shared by session and aggregate sources                                                                    | `paidPortBoundaries` numeric usage, exact sum and malformed input; `report*`, `reporting*`                                                    |
| Saved report USD cells                                                     | `core/reporting/render/canonical.ts:121,137` verifies the original numeric version-1 bytes/hash, then migrates to money version 2; `shared/reportSchema.ts` keeps both structural validations | `paidPortBoundaries` retained numeric fixture; `reportHistory`, `render.json`, all renderer goldens                                           |
| `core/schedules/agentTools.ts:38,48`: authority/policy `paidCapUsd`        | `shared/scheduleV2.ts:45`; host caps and policy are checked with `nonnegativeUsdSchema` before exact intersections                                                                            | `agentSchedules`: exactly 0.1 settled + 0.2 allocation at a 0.3 cap and refusal of an additional sub-nano amount; existing malformed policies |
| `core/schedules/agentTools.ts:92`: `settledUsd`, `uncertainUsd`            | `core/schedules/agentTools.ts:310` validated owner daily projection; exact sum includes active allocations                                                                                    | `agentSchedules`, `scheduleJournal`, `unattended*`                                                                                            |
| `core/schedules/agentTools.ts:126`: `alwaysPaidCapUsd`                     | `core/schedules/agentTools.ts:272`: consent result validated before remembering; same exact policy cap                                                                                        | `agentSchedules` malformed Always caps and atomic allocation                                                                                  |
| `shared/accounts.ts:113–115`: settled/reserved/uncertain totals            | `core/accounts/thresholds.ts:18` validated journal projection; `core/accounts/pool.ts:118` projects nano totals to canonical strings without a numeric round trip                             | `paidPortBoundaries` sub-nano headroom; `thresholds`, `accountFakes`, `accountUsage`, account pool suites                                     |
| `core/voice/transcribeBatch.ts:203`: `dailyBudgetUsd`                      | `core/voice/transcribeBatch.ts:204`: canonical caller amount checked with `nonnegativeUsdSchema` before shared money formatting                                                               | `paidPortBoundaries` exact batch question, `transcribeBatch` runtime refusal                                                                  |

Schedule generation and delta envelopes now mark money version 2; historical
unmarked envelopes remain readable through their validated v2 payload schemas.
New model tool schemas declare canonical decimal strings. Schedule settled and
retained fire costs carry exact amounts too. Report goldens were reviewed for
the money-version marker and resulting hashes; the separate numeric legacy
fixture remains to exercise the saved-file migration. No captured vendor frame
was changed or invented.

Initial unchanged inventory: **1 failed / 12 passed**, 21 numeric declarations.
Final regression replay on base sources: **28 failed / 43 passed (71)**:
`paidMoneyPorts` 14 failed / 12 passed (only 13 port-list additions),
`paidPortBoundaries` 7 failed / 10 passed, `estimatorRecommend` 7 failed / 21 passed.
All 41 source files were restored byte-exact after that replay.

Numeric-port drill: `acp/schedules.ts` temporarily restored `maxBudgetUsd?: number`.
The unchanged assertions fired: **2 failed / 24 passed**, exit 1. Restored
SHA-256: `a7ec643d463749e445f1f4812bdd4d7dc347322394aa2514311182397dffc3a3`.
Focused restored core runs passed 95, 81 and 63 tests at repository timeouts.
Supplemental base replay confirms **4 failed / 10 passed (14)** in
`accountUsageBundle`, `acpNpmReadme` and `acpResources` (two cases). It restores
all 41 source files byte-exact. The full-base agent-admission replay cannot
register its converted fixtures against the old numeric draft schema; the
semantic drill below proves the new assertion itself fires.

Float-sum drill: replace only the exact admission sum with JavaScript numeric
addition. `agentSchedules` fails the new 0.1 + 0.2 case: **1 failed / 49 passed**,
exit 1. Restored source SHA-256:
`48232fac81a5ac57efa724bb29d786f486b046bfb23cb94fcd8a0403e25bf1e1`.
Restored run: **50 passed**, exit 0. Cleanup owning runs: **294 passed** across
12 files. New repetition exposed by the zero-clone gate is removed with shared
zero-cost/fixture builders, report cell mapping, report action changes and the
existing exact formatter. No gate configuration is changed. The plan's status
phrase is corrected to its supported `built` value.

Native fixture receipt: its numeric host-budget mock produces **3 failed /
42 passed (45)**. The canonical mock and both canonical/numeric corrupt-input
probes retain all assertions: **45 passed**, exit 0. This is a fixture migration;
no production change follows `ad8926a8e`.

Fresh ordinary clone under `$TMPDIR`: ordinary `CI=true npm ci` exits **0**
with the unchanged lockfile. Production source `ad8926a8e`; final fixture source
`54f40ddca`. No shared/junctioned dependency tree or install-policy bypass.
All verification commands use `CI=true`.

| Gate                    | Exit   | Receipt                                                                                            |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| Five typechecks         | 0 each | Host, webview, unit, e2e, integration; unit repeated after the last fixture                        |
| Scoped ESLint           | 0      | All changed TS/TSX files, `--max-warnings=0`; last native fixture checked separately               |
| Scoped Prettier         | 0      | All changed supported files; normal hooks format final documentation                               |
| Plain knip              | 0      | No strict/production switch                                                                        |
| Full jscpd              | 1      | Exactly two inherited clones: ACP agent, queued-answer/model-API fixture; zero threshold unchanged |
| `check:l10n`            | 0      | Zero problems                                                                                      |
| `check:host-api`        | 0      | Record current, portable boundaries intact                                                         |
| `check:reference`       | 0      | Generated reference current                                                                        |
| `check:plan`            | 0      | Supported milestone status, zero drift                                                             |
| Report schema freshness | 0      | `node scripts/schema-report.mjs --check`                                                           |
| Required owning sweep   | 1      | **179 files / 3,644 passed / 4 inherited failed**, 60 invocations                                  |

The complete owning sweep includes every `schedules*`, `scheduled*`,
`unattended*`, `estimator*`, `report*`, `reporting*`, `acp*`, `paid*` and
`sessionBudget*` suite, plus account, voice batch, USD, renderer, native schedule,
legacy store, media and locale owners. Each invocation has at most three files,
`--maxWorkers=3` and repository deadlines, with no raised `--testTimeout`.
The 10,000-fire journal workload passes at its existing named deadline.
No case is skipped or filtered; remaining failures are the same four proven
on the base above and remain assigned to the lead in PLAN §7.

Commits use `.husky/_` exactly as installed; staged and committed diffs are
reread after every hook. `ad8926a8e`'s hook adds block bodies to two test
callbacks and adjusts table spacing; no production logic changes. The numeric
port and float-sum drill hashes still match final source. No merge, push,
quality aggregate, gate/configuration weakening, live/paid call or dependency
change. The private fresh clone is removed after final verification.

## Paid consent (CONSENT017)

Mac mini rig, `rel017/consent`, base `f411b64a4` (exact-money candidate),
2026-10-08. Fake-only; no credentials, paid/live calls, merge, push, stash,
hook substitution or gate weakening. Commits use `.husky/_` exactly as
installed; staged and committed diffs reread after every hook.

### Root cause

The int/0180b merge (`f3a6c1e5b`) made a quoted-search "Always" live only in
quote grants — looked up through `readQuoteGrant` by
`paidAuthorityKey` (`[feature, provider, model]`) plus the in-memory
authority — while M108's account binding persists "Always" in the
binding-keyed feature store (`readGrants`/`writeGrants` under
`[provider, account, price]`). `AccountPaidUseConsent` wrote that feature
grant (the `remember` fallback when no quote store is configured) but a new
instance's `allowSearch` never read it, so a second instance asked again. The
money-port lanes masked this by adding binding-scoped quote stores to the
tests instead of bridging the class's required ports. The frozen quote in the
`ask` payload is 0180b design, pinned by `acpPaid.test.ts:210`, so the
pre-merge quoteless-forwarding expectation is stale; its rule (ask once per
account with account, tariff and budget) is still asserted unchanged.

### Fix

`src/core/paid/paidConsent.ts:908` (`bindingGrants`, `keepBindingFeature`)
and `:936-969` (`shouldBridgeQuotes` in `createConsent`): when the host
configures no quote store and no quote-generation tracking, the binding-kept
feature grant is bridged into the quote lookup, so "Always" holds across
instances and restarts for the same workspace, provider, account and price.
Differently-keyed (legacy) grants never match; a changed provider, account
or price misses the binding key and asks again; `requiresAsking` and
`canRemember: false` still ask through the dispatch flag; a host that tracks
generations without a quote store fails closed and asks. Quote-store
configurations are untouched: ceiling and generation safety still come from
the quote grant. The legacy single-account path is untouched
(`paidConsent.test.ts:315` still requires asking for an unpriced legacy
feature grant).

### Tests

`test/unit/accountPaidConsent.test.ts:55` (`quoteBacked` shares the
quote-store scaffolding between the existing binding test and the new
generation test, so no new jscpd clone), `:187` (restart: new instances read
back search and voice "Always" from the binding store, legacy grants
ignored), `:201` (changed price asks again without a quote store), `:209`
(changed quote generation asks again with a quote store).

Red drill (default timeouts, `--maxWorkers=3`): with the three regressions
added but the product unchanged, `:187` fails (second instance asks again)
while the other 15 pass — 1 failed / 15 passed. After the fix: 16 passed.
The price (`:201`) and generation (`:209`) regressions pass before and after;
they guard safeties the fix must keep, not the defect.

### Gates (`npm ci` fresh clone under `$TMPDIR`, `CI=true`)

| Gate                                                    | Exit   | Receipt                                                                                                 |
| ------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| `accountPaidConsent`, `paidConsent`, `paidAuthority`    | 0      | 68 passed (16 consent)                                                                                  |
| `paidDailyBudget`, `paidHookModels`, `paidHost`         | 0      | 87 passed                                                                                               |
| `paidMoneyPorts`, `paidPortBoundaries`, `acpPaid`       | 0      | 73 passed                                                                                               |
| `paidFeatures`, `schedulePaid`, `accountUsd`            | 0      | 62 passed                                                                                               |
| `accountHomes`, `accountFakes`, `accountHost`           | 0      | 73 passed                                                                                               |
| `accountPolicy`, `accountSecrets`, `accountStore`       | 0      | 110 passed                                                                                              |
| `accountUsage`, `accountUsageText`, `accounts`          | 0      | 44 passed                                                                                               |
| `accountsCommand`, `accountsPanelHost`, `accountsPanel` | 0      | 69 passed                                                                                               |
| Five typechecks                                         | 0 each | host, webview, unit, e2e, integration                                                                   |
| eslint `--max-warnings=0`, prettier                     | 0      | changed files (one boolean-name and formatting repair, no logic change)                                 |
| Plain knip                                              | 0      | configuration hints only                                                                                |
| Full jscpd                                              | 1      | exactly the two inherited clones (ACP agent, queued-answer/model-API fixture), zero threshold unchanged |
| `check:l10n`                                            | 0      | zero problems                                                                                           |

No `--testTimeout` on any verification run. The private fresh clone is
removed after final verification.

## Paid consent (CONSENT017B)

Mac mini rig, `rel017/consent2`, base `11c76b9cc` (CONSENT017 tip),
2026-10-08. Fake-only; no credentials, paid/live calls, merge, push, stash,
hook substitution or gate weakening. Commits use `.husky/_` exactly as
installed; staged and committed diffs reread after every hook.

### Findings and fixes

P2 money safety (RVCONSENT017 finding 1,
`src/core/paid/paidConsent.ts:964`): the `shouldBridgeQuotes` bridge
fabricated a quote grant from the binding's feature bit, so a higher tariff
or a different model was approved without asking, on the same and on a new
instance. Removed. `AccountPaidUseConsentDeps` now requires the quote store
and generation (`readQuoteGrant`, `writeQuoteGrant`, `quoteGeneration`) plus
an account-scoped `revokeQuoteGrants`, so no account consent exists without
them (the 0.18 rule: an unversioned grant cannot prove its vintage). The
persisted quote generation composes the account's revocation generation with
the host's (`[accountGeneration, hostGeneration]`), and quote saves go
through the same owner queue and generation fence as binding saves, so a
revoked generation can never resurrect its grant after the clear.

Inherited P2 revocation (`paidConsent.ts:988`): `revoke()` cleared only the
binding's feature grants. It now also clears that account's quote grants in
the same owner-queued write; the advanced generation keeps asking again even
when the clear itself fails.

P3 (safety tests through the real store): the rig supplies a real
per-binding in-memory quote store (one partition per
provider/account/price, shared across instances like a restart), and the
restart test passes through it, not a bridge.

Production wiring (review: no production caller of `AccountPaidUseConsent`;
VS Code, CLI/ACP, schedules, companion and MCP use workspace-scoped feature
consent with workspace-scoped quote stores): the defer case applies. PLAN
§6 places "paid consent per account" in M108 lane P ("after K and T",
touching `src/core/paid/paidConsent.ts (account binding)`), and only M108
D/X is accepted into the integrations — the pool/policy lanes that would
wire per-account consent have not merged. So account-bound consent stays
unwired: the class documents it, `CHANGELOG.md [Unreleased]` records the
hardened contract and the deferral (superseding the binding-grant entry,
which is kept), and Help (`referenceAccounts`, shared by the feature
catalog's `accounts` entry and `/help`) now says paid consent stays per
workspace. Nothing claims account-bound consent works.

### Tests

`test/unit/accountPaidConsent.test.ts` (19 tests): the rig builds a real
account-scoped store per binding; `quoteBacked` is gone. New regressions:
higher tariff and different model under an unchanged account, binding and
price string, each on the same and a new instance (ask again, Deny
honoured); revoke-after-Always asks again and is denied (with the store
empty afterwards); the restart, price-change and generation tests run
through the store; the remembered-write races target the quote write, and
the queued-Always test asserts voice in the binding grant plus search in
the quote store.

Tip check (new file run against `11c76b9cc` in a scratch worktree):
3 failed / 16 passed — the revoke regression and the two store-asserting
race tests fail on the tip; the tariff/model/restart tests pass there
because a real store already disables the bridge. The bridge failure mode
is proven by drill A instead.

Red drills (default timeouts, `--maxWorkers=3`, byte-exact restore
verified by SHA-256 `762a7d9…0580eb` before and after): (A) bridge
restored (fabricated read plus binding write, generation-matched) —
7 failed / 12 passed, including both tariff and model tests; (B) revoke
without the quote clear — 2 failed / 17 passed (the revoke regression and
the race test). After revert: 19 passed.

### Gates (fresh clone under `$TMPDIR`, `npm ci`, `CI=true`)

| Gate                                                    | Exit   | Receipt                                                    |
| ------------------------------------------------------- | ------ | ---------------------------------------------------------- |
| `accountPaidConsent`                                    | 0      | 19 passed                                                  |
| `paidConsent`, `paidAuthority`                          | 0      | 52 passed                                                  |
| `paidDailyBudget`, `paidHookModels`, `paidHost`         | 0      | 87 passed                                                  |
| `paidMoneyPorts`, `paidPortBoundaries`, `acpPaid`       | 0      | 73 passed                                                  |
| `paidFeatures`, `schedulePaid`, `accountUsd`            | 0      | 62 passed                                                  |
| `accountHomes`, `accountFakes`, `accountHost`           | 0      | 73 passed                                                  |
| `accountPolicy`, `accountSecrets`, `accountStore`       | 0      | 110 passed                                                 |
| `accountUsage`, `accountUsageText`, `accounts`          | 0      | 44 passed                                                  |
| `accountsCommand`, `accountsPanelHost`, `accountsPanel` | 0      | 69 passed                                                  |
| Five typechecks                                         | 0 each | host, webview, unit, e2e, integration                      |
| eslint `--max-warnings=0`, prettier on changed files    | 0      |                                                            |
| Plain knip                                              | 0      | configuration hints only                                   |
| Full jscpd                                              | 1      | exactly the two inherited clones, zero threshold unchanged |
| `check:l10n`                                            | 0      | zero problems                                              |
| `check:reference`                                       | 0      |                                                            |

No `--testTimeout` on any verification run. Pre-existing, unrelated:
`runtimeAccountsBundle` ("installs the caller language…") fails
identically on the untouched base `11c76b9cc` (a `machineId` regex refusal
in a developer-options bundle path on this rig). The private fresh clone is
removed after final verification.
