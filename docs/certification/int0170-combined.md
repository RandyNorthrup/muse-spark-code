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

## Leftovers (LEFT017)

Lane `rel017/left`, base `7a4fc2ab3`, Linux rig, 2026-10-08. All tests
use repository deadlines, hooks remain enabled, no merge or push.

- Item 6: `compactNodeReference` is referenced only by its own declaration
  and unit owner. Production `scripts/build.mjs` uses `nodeReferenceData`
  from `scripts/lib/deferredBundles.mjs`. Before removal, the whole obsolete
  test fails with `Missing generated reference boundary` (exit 1); the
  concurrent browser-English owner passes all five tests. Removed plugin,
  declaration and obsolete owner. Plain knip result follows.

- Item 7: browser-English probe imports the real account/developer surfaces
  dynamically and includes the probe in its source inventory. The new
  account-reader assertion fails before the fix on
  `sessionBudgetStoreUnavailable`; restored whole owner passes 5/5 tests.
  Accounts remain deferred (the original cold getter assertion is retained).
- Item 3: exact `npm run security:sast` already exits 0 on the inherited
  tree: 533 rules, 3,027 tracked targets, zero findings. No new ignore or
  exception. Fresh-clone replay follows.
- Item 6: plain knip exits 0 (two existing configuration hints).

- Item 5: baseline jscpd reports exactly four clones (27 lines). ACP cancel
  and release share cancelPreparing; exact media USD formatting reuses
  formatUsdAtPrecision; elicitation uses the existing host fixture defaults;
  paidDailyBudget shares its half-dollar settlement. The latter owner also
  restores exact decimal ledger assertions after the combined API merge,
  preserving numeric UI projections and the token attempt's reserved request
  in threshold accounting. Whole paid owner passes 36/36; ACP owner passes
  142/142; USD and elicitation owners pass alongside the browser probe (31 total).
- Item 9: G76 records the 123-file cmd.exe failure. The hook now gives
  lint-staged --max-arg-length 6000, retaining concurrent=1 and every original
  ESLint, Prettier, stylelint and gitleaks task. The real lint-staged fixture
  passes all 123 long paths through multiple batches without omission or
  duplication. Before the fix its guard fails on the missing batch bound.
  Native Windows execution remains a hosted integration receipt.

Intentional controls (complete owner files, repository timeouts): changed the
Schedule Prompt view to list; removed validated-zone reuse; pointed the usage
fixture at an absent source; removed the hook argument bound; removed the
probe's account/developer imports; duplicated Help's section ID. Each run
exits 1 on its intended assertion/build failure. All six sources restored
SHA-256-exact before final verification. Detailed hashes follow in the final
receipt. The restored shared batch passes 168 tests.

- Item 1: extension.ts passes createSchedulesBridge to each controller and
  registers all three command IDs before use. The command port retains
  cold requests until a panel's ready handshake and keys existing-panel
  requests by their surface; disabled schedules refuse
  before opening and pending requests recheck the setting. Seven whole-owner
  cases pass, including cold/warm views and failed opening. The message factory
  does not open a credential store or backend; actual scheduled editor delivery
  still needs the separately named scoped host adapter (PLAN §3).
- Item 2: the inherited Help already has distinct IDs. The new whole-document
  uniqueness guard passes and fails when a section ID is deliberately reused.
  Inherited container-relative column geometry and standalone schedule mount
  handshakes address the older readiness failures; full axe replay follows.
- Item 4: serveRepo now builds the usage fixture from the running gate's source,
  as its traffic fixture already does. A real empty historical source root
  fails before this fix and serves the actual bundled usage bytes afterwards.
  Full expansion is blocked: 270 webview files, 184 render inputs, 112 audited
  sources and 73 mapped render inputs (111 missing). No tracked audit-refresh
  generator exists; capture helpers need a reviewed map. Scene/selector/theme
  review exceeds the shared approximately 300-new-lines-per-finding rule. No
  audit hash, scene map, manifest or PNG is falsified or reset. Exact visual
  replay failure follows; the gate is not waived.
- Item 8: the complete coverage profile passes on this rig in 172.43 s (20
  journal tests), and attributes 31.289 CPU seconds to repeated schedule-zone
  Intl validation, 25.895 s to structuredClone, and 13.434 s to zod parsing.
  Keep a single successfully validated zone; invalid zones and numeric offsets
  remain refused and changed zones still consult Intl. No snapshot, delta,
  fencing or storage validation changes. The new constructor-count regression
  fails on 100 constructions before reuse and passes afterwards. Final 240 s
  workload replay follows.
- Item 3 follow-up: report-root segments use a named literal escape helper,
  tested with every regex operator, unbalanced brackets/groups and Windows
  separators. Removing the helper from root construction makes the complete
  reportRedaction owner fail; restored source SHA-256 is
  `0e41182484b5499d38ea672b1cac08c4556066a0fdcb756e63a5806ada6ee55e`.
  The inherited precise suppression remains documented in PLAN §8; no new
  scanner ignore or rule change. Restored redaction/zone/hook batch: 48 passed.

Fresh-clone replay follow-up: npm ci and all five typechecks pass. The probe
exposes a pre-existing missing ignored temp parent in a clean tree; create it
before its entry files, preserving their relative imports. The visual gate's
required-job shell fixture omits the merged LINUX_HELPER success result; add
that result, retaining every fast/full and visual outcome assertion. Both
complete owners failed naturally before these corrections. Plan heading
format drift is corrected without changing the parser. Final replay follows.

The first exact accessibility replay scans 1,068 pages and 32 production
report pages: no violations or missing readiness results; four plan-usage
request counts have undecided contrast because they are single-digit text.
Render counts through the existing localized request forms, preserving totals,
reported/estimated/unknown distinctions and the responsive facts grid. Whole
UI/probe/visual owners pass 42 tests; removing plural display or account imports
makes the whole respective owner fail, restored SHA-exact. Production replay
of both plan-usage widths across four themes passes 8/8, with zero violations,
undecided rules or missing results. Full-matrix final replay follows.

The first real VS Code integration replay passes all 40 tests on stable
1.141.0 and all 40 on minimum 1.99.0, including the unchanged loop over every
contributed command ID. Model traffic is fake-only. Activation is 587,451 of
614,400 bytes. Fresh journal/store coverage passes 45 tests in 132.08 s; the
10,000-fire store still reports 10,000 fires, a bounded audit and fenced old
identities. Final-row journal: 53 operations / 24,662 bytes; total storage
2,404,304 bytes. No deadlines or validation assertions changed.
