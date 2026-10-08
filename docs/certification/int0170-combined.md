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

### MONEY017C production audit and repair (2026-10-08)

macmini, `rel017/money3`, base `1a2086399`. Fake HTTP only; no credentials,
paid/live calls, hook changes, merge, rebase or push. The rig brief delegates
aggregate quality and the nine unrelated integrated bundle caps to the lead.

**Production media remains blocked by recorded prerequisites.** D95.1/3 and
MONEY017 intend scheduled media reads. D85.6 (PLAN.md:11495–11502) explicitly
prohibits shipping an upload default until the U6c storage billing finding is
recorded. M105's current status says U6c is unknown; the production storage and
ownership bridge, captured Responses media codec, selected-model capabilities,
and calibration readers are open (`docs/certification/m105.md:117`, `:121`,
`:126`, `:130`, `:133`). Searches find no production `UploadLedgerStorage`
implementation, media codec factory or calibration catalogue to bind. M108 is
accounts, while the media milestone named in the brief is M105.
A summary of a capture cannot supply the missing wire frame under AGENTS 14.
The lane requested any existing evidence paths from the owner and continued
independent repairs. No free storage tariff, codec or calibration was invented.

README and Unreleased now describe production availability accurately; the
reference includes the limitation. The shared Model API engine returns a
localized, explicit scheduled-video/audio refusal while its upload adapter is
unavailable, in VS Code and the runtime/ACP factory path. Interactive refusals,
inline images/PDFs and injected-port accounting keep their existing behavior.
All fourteen translated tables carry the new sentence.

The new `modelApiProductionMedia` suite calls `createModelApiHost` with the
ordinary production dependency shape and fake HTTP, injecting **no replay,
codec, calibration or upload port**. Four cases cover scheduled video/audio,
with and without the native reader. The next request contains the explicit
refusal, no file ID or durable media entry, and no upload HTTP occurs. The
existing injected-port tariff/follow-up tests remain unchanged. The requested
production calibrated-reserve, one-nano-below-cap, settlement and uncalibrated
audio receipts cannot be produced without the missing prerequisites and remain
outstanding. This is not a claim that the requested production wiring is done.

`reserveMediaRequest` now accepts `UsdAmount` only for all three tariffs and
validates them before either ledger admits. Its two numeric test callers now
construct exact decimal amounts; other money ports are untouched. A JavaScript
caller attempting numbers is explicitly rejected instead of silently accepted.

Ordinary `reserve` has no cap argument: its returned durable claims can total
more than a caller's cap. The synchronous `claim.check(cap)` before dispatch
is still the admission fence, and an unsent owner refunds only its own row.
On the base, ordinary publication also bypassed `reserveAdmitted`'s lock;
a competing owner could publish while an earlier claim was incomplete. Both
reservation methods now use exactly the same existing scope lock. The real-disk
regression starts with USD 0.4 spent and two simultaneous USD 0.6 requests
against USD 1: it holds the first publication, proves the second waits on the
lock, admits the first at precisely the cap, refuses/refunds the second and
retains a total of exactly USD 1. Both ordinary and atomic-admission competitors
are covered. Serialization does not replace the caller's cap check or pretend
that the cap-free `reserve` itself has a spending limit.

| Item                                             | Fix                                                                              | Regression                                                                                                            |
| ------------------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1 production prerequisites / honest availability | `ModelApiHost.ts:8461`, `tools.ts:1193`; README, CHANGELOG and feature reference | `modelApiProductionMedia.test.ts:26`: four production-factory scheduled refusals                                      |
| 2 production calibrated media receipts           | Blocked: D85.6 U6c and M105 recorded storage/codec/calibration inputs absent     | Existing `modelApiMedia` injection tests retained; no production success claim                                        |
| 3 exact media tariff port                        | `mediaCost.ts:237`, `:257` exact prices and validation                           | `mediaAccounting.test.ts:79`: numeric caller refuses before either ledger; exact fixtures in `mediaClient.test.ts:72` |
| 4 ordinary/admitted lock                         | `sessionBudgetJournal.ts:547`, `:613` shared reservation lock                    | `sessionBudgetJournal.test.ts:267`: both competitors at exactly remaining headroom                                    |

Base production-source runs at repository deadlines:

- `mediaAccounting` + `mediaClient`: **1 failed / 39 passed (40)**.
- `sessionBudgetJournal`, first ordinary regression: **1 failed / 51 passed (52)**.
- Both final journal regressions plus numeric regression: **3 failed /
  90 passed (93)** across three files, exit 1.
- `modelApiProductionMedia`: **4 failed / 0 passed (4)**, exit 1. The test's
  new English sentence was present while the production sources were unchanged.

The numeric and locking red drill restores both production files from
`1a2086399` and then restores the repaired bytes exactly. SHA-256:
`mediaCost.ts` `cf49a0595d9fb3ded0708c1e21212fe03c0e547be2ecdf5b53f84b2002e2626c`;
`sessionBudgetJournal.ts` `3231c1d04b558c4f6649dc50de44c99e93750d2429af8cc113b0aec71ae30276`.
Restored owning three files: **93 passed**, exit 0. Production-factory,
`modelApiMedia` and `modelApiMediaTools`: **34 passed**, exit 0.
Initial static checks identified test-only async/URL/promise idioms and the
fake settlement's required total return; those fixtures were corrected without
weakening assertions or changing any timeout. Final fresh-clone CI receipts,
production sizes are appended after verification.
The explicit refusal drill restores base `ModelApiHost.ts`: **4 failed /
0 passed (4)**, exit 1, then restores repaired SHA-256 `a2b4137d162cda5a28c835ea7f443521d6fb3f82587ac7b995160f5a3e537802` exactly.
The latest three owning suites (journal, accounting, production factory) pass
**75 tests**, exit 0, after lint fixture corrections.

Fresh-clone verification started at implementation `18a807dde`, after
ordinary `npm ci` installed 902 packages with the unchanged lockfile. Every
command uses `CI=true`; tests have at most three files, `--maxWorkers=3` and
the repository deadlines. No test is skipped, filtered by case or weakened.

| Gate                                                            | Exit   | Result                                                     |
| --------------------------------------------------------------- | ------ | ---------------------------------------------------------- |
| `npm ci`                                                        | 0      | Ordinary install under the lane's `$TMPDIR`                |
| Five typechecks                                                 | 0 each | Host, webview, unit, e2e, integration                      |
| Changed-file eslint `--max-warnings=0` / Prettier               | 0 each | All changed source, tests and documentation                |
| Plain knip                                                      | 0      | No strict/production mode                                  |
| Full jscpd                                                      | 1      | Three inherited clones; new factory-test duplicate removed |
| `check:l10n`, `check:reference`, `check:host-api`, `check:plan` | 0 each | Current records; zero localization problems                |
| Complete assigned-family/host suite sweep                       | 1      | **32 files, 1,379 passed / 3 inherited failed (1,382)**    |
| `npm run build`                                                 | 1      | Exactly nine inherited other caps; owned budgets fit       |
| Separate bundle-split audit                                     | 1      | Same base unlisted deferred `src/shared/slashCommands.ts`  |
| Separate host-globals audit                                     | 0      | No host-global violations                                  |

| Batch | Files                                                      | Passed / failed |
| ----- | ---------------------------------------------------------- | --------------- |
| 1     | acpPaid, mediaAccounting, mediaAttach                      | 54 / 0          |
| 2     | mediaBudget, mediaClient, mediaContracts                   | 50 / 0          |
| 3     | mediaConvert, mediaCost, mediaFixtures                     | 60 / 0          |
| 4     | mediaLimits, mediaLocalization, mediaProviders             | 33 / 0          |
| 5     | mediaSniff, mediaSniffMalformed, modelApiBackendManager    | 51 / 0          |
| 6     | modelApiBundle, modelApiHost, modelApiMedia                | 706 / 2         |
| 7     | modelApiMediaTools, modelApiProductionMedia, paidAuthority | 25 / 0          |
| 8     | paidConsent, paidDailyBudget, paidFeatures                 | 104 / 0         |
| 9     | paidHookModels, paidHost, paidMoneyPorts                   | 63 / 1          |
| 10    | replayMedia, schedulePaid, sessionBudget                   | 93 / 0          |
| 11    | sessionBudgetJournal, unattendedBackends                   | 140 / 0         |

The two host failures are M52's `releases a rejected duplicate/different schedule
lease without clearing the running generation`: the unchanged assertions expect
two `claim` calls but receive one. `paidMoneyPorts` has exactly the same 21
numeric inventory entries as MONEY017B. A true base checkout in the fresh clone
reproduces all three: `modelApiHost` + `paidMoneyPorts` + `modelApiBundle`,
**694 passed / 3 failed (697)**, exit 1. The repaired checkout is restored
without rewriting history. These findings are assigned to the lead in PLAN §7;
no unrelated scheduling or money port is changed here.

Full duplication on the base has three clones: ACP image/document prompt
assembly (`acp/agent.ts:1967` / `:2052`), currency fractional formatting
(`shared/l10n/exactUsd.ts:25` / `text.ts:156`) and question backend fixtures
(`unit/helpers/questions/queuedAnswerBackend.ts:34` / `modelApiElicitation.test.ts:113`).
The first fresh run also caught one new 55-token schedule setup clone in the
factory test. Setup now names its schedule context before binding the run; no
assertion, policy or gate changes. Its four tests pass again. The gate firing
is recorded, and final fresh checks of that fixture follow below.

Production Model API is **521.8 / 525 KiB** and activation **571.4 / 600 KiB**;
base values are **521.7 / 525** and **571.3 / 600 KiB**. The nine other capped
bundles fail on the actual base build too: runtimeQuestions, conversation,
runtimeEngine, usagePanel, headless, runtimeAccounts, surface English, Palette
and estimator panel. The base also reproduces the separate split failure.
No cap, split allow-list, ignore or threshold is changed. This lane's full-quality
boundary stays with the lead, as the brief requires.

Final fresh-clone qualification uses `28ffed40b`, fetched locally after normal
hooks. The only code delta from the first qualification is the unchanged-policy
factory fixture setup; unit types, all changed-file eslint/format, complete and
scoped duplication, localization/reference/host API/plan checks and production
build/audits were rerun. Host/webview/e2e/integration typechecks and plain knip
had already passed on identical production sources. No code was rewritten by
hooks; all three drilled production SHA-256 values still match.

| Final gate                                         | Exit   | Receipt                                                                         |
| -------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| Changed owning suites                              | 0      | **75 passed**, zero failed, default deadlines                                   |
| Unit typecheck / changed eslint / changed Prettier | 0 each | Corrected fixture and final docs                                                |
| Full / changed-file jscpd                          | 1 / 0  | Exactly three inherited clones / zero clones                                    |
| Localization / reference / host API / plan         | 0 each | Current and complete                                                            |
| Production build                                   | 1      | Same nine inherited caps; **Model API 521.8/525**, **activation 571.4/600 KiB** |
| Split / host-globals                               | 1 / 0  | Same base split failure / no global violations                                  |

M105's cost certification additionally confirms that U4 summary numbers are
**test projections only**, with no production calibration seed
(`docs/certification/m105-c-cost-(b).md:53`). Its storage handoff (`:106`) and
`docs/certification/m105-captures.md:47` still require U6c. The owner was asked
for existing evidence paths; none was supplied in this run. Production binding
and the four requested successful tariff receipts remain explicitly open.
All implemented guards fired on base production sources (seven failing new
cases in total), then restored byte-exact. No paid/live attempt was made.

Implementation and fixture/certification commits: `18a807dde`, `28ffed40b`.
Both ran the repository's installed hooks; staged and committed diffs were
reread. The final documentation-only receipt commit also uses normal hooks.
Scratch logs/results are kept in the worktree's ignored `temp/fresh-gates/`;
the private ordinary clone under `$TMPDIR` is removed before the final report.
No push, merge, rebase, manual stash, raised timeout or altered gate.

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
