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

### LEFT017B continuation (2026-10-08, linuxlt)

Branch `rel017/left2`, base `e2605a991`. The continuation brief authorizes the
complete renderer/scene expansion without the earlier mapping scope limit.
No merge, push, live/paid call, changed timeout, byte cap or pixel tolerance.

- Deferred slash-command registration: the real split gate first exits 1 on
  `Unlisted deferred webview surface src/shared/slashCommands.ts`; after adding
  its source to the existing deferred inventory it exits 0. Activation remains
  exactly 587,451 bytes (cap 614,400).
- The new complete `slashCommandsBundle.test.mjs` owner passes 1/1 at the
  repository deadline. Its deliberate eager-import mutation fails on the
  actual emitted startup graph; restoring `App.tsx` SHA-256
  `0aca24f6b41cac35a616cf5989f77e9d33064b182cb5774c7163a4879b00608c`
  restores the whole owner to green. The fixture copies the production
  formatter configuration so a disk-backed external temp root stays valid.
- Baseline visual owners reproduce four failures: current renderer inventory,
  two theme read inventories and current audit/source coverage (24 tests pass).
  The three stale `visualMatrix` assertions are retained unchanged.
- Added 111 mappings: 184 current renderers across 136 scenes. All 136
  default/light/320 smoke captures mount their actual components. The capture
  driver opens real account/grant/resource controls and traffic tabs, advances
  frozen-clock Suspense retries, selects the correct independent bundle, and
  scrolls canonical descendants into view. The packed update page uses its
  production decoder. Test-only vault identifiers are deterministic public IDs.
- Current source SHA receipts are refreshed from actual browser files. The two
  immutable third-party archive/colour/default receipts retain their hashes;
  eight new read names are explicitly unresolved in those retained captures,
  rather than invented colours. The full six-theme Chrome replay exercises
  their real CSS fallback. All three stale visual assertions pass unchanged.
- Shared visible repairs: Models actions wrap at narrow width, and Models and
  accounts use the token focus width/offset. The independent Models stylesheet
  imports its token contract. The real capture owner's three new guards were
  deliberately broken together: offscreen threshold top 880.828125 >= 760,
  missing visible focus targets and six column/nowrap action measurements.
  The complete owner exits 1 with 3 failed/7 passed. Exact source restoration
  hashes: Models CSS `721845e6221b3cc7bb1913511e4d6f71209d7ca9f719c45475d8037b2c65fd01`,
  accounts CSS `c6a6fc83d0e203f79cf6ea1acf5b78b937eea84b00011f8a98f85f4ca964995c`,
  capture driver `64c25bcabe261b90052a3fb7805e8d26406626441a96a862318da63ea874f31c`.
- Input checks pass: complete capture/matrix/audit owners 26/26, browser harness
  typecheck, changed-file eslint (zero warnings), stylelint, tokens (zero
  problems), plain knip and jscpd (2,835 files, zero clones).
- Full capture exposed a delayed folded-tool chunk at frame 6,840: the tool-opening
  query ran before its controls mounted. Wait for the actual tool control after
  the steps group paints; the complete capture owner now covers all six tool
  states. No loading placeholder is accepted as a render.
- Full archive generation, image review and fresh-clone gate receipts remain
  pending below; no visual certification is claimed until they finish.

### Earlier LEFT017 receipts

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

README current-render review **LEFT017 Linux, 2026-10-08**: render inputs
match committed `41fde362144fbfab6ec5889edba6d97a82abf28b`; all 18 declared shots rendered successfully
with the real ready handshake and were compared with their prior captures.
Seven remain byte-identical. Eleven reviewed current captures replace stale
combined-tree screenshots; question controls, current usage status and Help
prose are visible. Help alt text describes its visible detail. No crop,
synthetic image, tolerance or PNG-budget change. Global input SHA-256:
`a399a86f2147dad3ffd381ce980882e5e90280bd09f9f8a4b9f93448f2e6d3d4`. The 18 captured images total 1,139,781 bytes; complete README media, including
its unchanged banner, is 1,467,029 / 2,097,152 bytes.
The complete M114 map and manifest remain blocked separately.

| Curated image            | Dimensions | Bytes  | SHA-256                                                            |
| ------------------------ | ---------- | ------ | ------------------------------------------------------------------ |
| agents.png               | 690 × 760  | 63107  | `d3ada1d94ec7dd2a67c02c8cda3d0a62166d49b0971aa4901c05342dc365a569` |
| approval.png             | 690 × 760  | 55704  | `5b5f115860a493444f46846669373dbd33dbf37aa4fa7341d8abdf35d6b7b16a` |
| question.png             | 690 × 760  | 50009  | `576085cd213fda4ac33da2deb21dab2a7accf2b62d32a46a303b3a5b63405e90` |
| history.png              | 690 × 760  | 70158  | `e39a860074461075400b7d812054cf2592a7cdc919254e9ddd89058e77efc7f0` |
| languages.png            | 690 × 760  | 73506  | `45752b079a7932bcd2153f037116d646074c37d7a940bf84fb200473ac2f8d73` |
| modes.png                | 690 × 760  | 83896  | `bc517ea0c1348535b482e1a1d7af8c54331871d647661b43e48e75d4db96b9ee` |
| paid.png                 | 690 × 760  | 33999  | `c16aae671a561aff3c08de0273cdfcfc4ebeb24f35078eb829cd5bb1b2492b0b` |
| paid-always.png          | 690 × 1000 | 107122 | `5c26bb4d062d0aff5255280f23f2c7b7158faa741993af8f56e732d042115cb9` |
| palette.png              | 690 × 760  | 51269  | `bf9da19fc6191d6fd2dd40076b7185ed01af13096d2ff2022a323e47ea3309a6` |
| quote.png                | 690 × 760  | 35098  | `f3d4fd22cd258d17f0a6984629a8850efbe6c6888e6eee6c9b799cd804211e1d` |
| rewind.png               | 690 × 760  | 45082  | `a559dd2434f1c978d467a7e6e699b0a926b100949ca203b880bd582a1eb805b9` |
| slash-commands.png       | 690 × 760  | 76462  | `48957d67c987c89f4f57ebff432562032014086e1aab9b13fbbe4dd485ab153e` |
| turn.png                 | 690 × 760  | 53323  | `78a64d44b5a354db100e21244395af8c888b6e6ae56579c55ec0a50a361a76fc` |
| usage.png                | 690 × 760  | 66454  | `2ff06969d626f5acd123234bfc58e2244694e43c366e18a91527e26775237886` |
| voice.png                | 690 × 760  | 56642  | `b28b6b298004e807e54ab4223d42b7083411695f9b11b753bda68bb1edcf266d` |
| open-question.png        | 690 × 760  | 47703  | `b3301bbf4f78b5eb5dcbbd36c30b29ae76548559371090d219e57eb295afeb01` |
| help.png                 | 1000 × 760 | 116134 | `39b5625d156a4c256ac209814703f0710509fd14e24e9cc68bb7aef36f555558` |
| deterministic-report.png | 690 × 760  | 54113  | `25a14e0a51c9018c7011daeab68a88020394323e8938babdb77c911396b79891` |

Final committed-clone receipt (Linux rig, Node 24.21.0, npm 11.19.0):
`08d9c8ce2ca2bb259519f0d3d0699fd0e30eb143`; fresh local clone under TMPDIR, ordinary npm ci,
CI=true for every command. No test filtering within owner files, timeout
override, gate weakening, merge, push, paid call or credential read. Ordinary
tests retain their repository deadlines. The journal coverage command uses
the repository partial-shard collection mode (--shard=1/1); this receipt
does not claim aggregate percentage coverage certification. Both own clones
are removed after verification; logs remain under ignored temp/left017.

**Result: eight requested items closed; visual receipts remain blocked.**
All changed owners pass. The additional whole visualMatrix owner has three
unchanged failing assertions: current renderer inventory and registered theme
variables for One Dark Pro and Dracula. Total selected tests: 396 passed,
3 failed, none skipped. All 45 journal/store tests pass under coverage in
133.64 s (135.50 s process time), with the named 240 s workload unchanged.
Actual stable 1.141.0 and minimum 1.99.0 each pass 40 integration tests,
including every contributed command. Full axe: 1,068 main pages and 32
production report pages, zero violations, undecided rules or missing results.
SAST: 533 executed rules over 3,025 targets, zero findings.

| Item | Root repair / source                                                                                                                                         | Final evidence                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | extension.ts:3533,3830; host/schedules/schedulesBridge.ts:87: lazy bridge, registered editor/list/timeline commands, deferred ready delivery                 | 7 command-owner cases; stable/minimum 40 + 40 integration tests; extension 587,451 / 614,400 bytes                                       |
| 2    | webview/components/PlanUi.tsx:240,263: localized request counts; test/unit/ReferencePage.test.tsx:340: unique Help IDs; inherited harness readiness retained | 25 plan-UI cases; 25 Help cases; full test:a11y exit 0, 1,068 + 32 pages                                                                 |
| 3    | core/reporting/render/redaction.ts:11,32: vetted literal segment escaping; inherited research/template dispositions retained in PLAN §8                      | 25 redaction cases; intentional escape removal fails; security:sast exit 0                                                               |
| 4    | scripts/lib/harnessServer.mjs:318: current-gate usage fixture; reviewed curated README captures and input digest                                             | Historical-root owner passes; readmeShots 17/17. check:visual exit 1; audit/matrix/themes deliberately unchanged and blocked             |
| 5    | acp/agent.ts:1272; shared/l10n/exactUsd.ts:3; test/unit/modelApiElicitation.test.ts:95; test/unit/paidDailyBudget.test.ts:67,172                             | jscpd exit 0, zero clones; ACP/USD/elicitation 168 cases, budget 36 cases                                                                |
| 6    | Remove scripts/lib/referenceBundle.mjs, its declaration and obsolete test; scripts/build.mjs:83,338 uses nodeReferenceData                                   | Obsolete owner fails before removal; knip and check:reference exit 0                                                                     |
| 7    | test/unit/browserUiText.test.mjs:23,47,75: scratch parent and actual deferred account/developer graph                                                        | All 5 cases pass; account-import removal fails; cold getter assertions retained                                                          |
| 8    | shared/scheduleV2.ts:53: bounded successful-zone reuse                                                                                                       | Zone constructor control fails before reuse; journal/store coverage 45/45 in 133.64 s, no deadline change                                |
| 9    | .husky/pre-commit:1; docs/orchestration-gotchas.md:149 (G76); real lintStagedBatching owner                                                                  | All 123 long paths delivered once through bounded batches; removing hook limit fails; native Windows receipt still belongs hosted replay |

All source paths in the item table are relative to src/ unless they name
scripts/, test/, docs/ or .husky/. The command contribution/catalog IDs and
reference were already present; no new identifier or wire shape is invented.
Actual unattended editor delivery remains the scoped host-adapter gap named
in PLAN §3; command registration does not certify that separate feature.

| Fresh-clone command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Exit | Seconds |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------- |
| `npm ci`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 0    | 5.99    |
| `npm run typecheck:host`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 0    | 16.66   |
| `npm run typecheck:webview`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 0    | 9.62    |
| `npm run typecheck:unit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 0    | 50.62   |
| `npm run typecheck:e2e`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 0    | 23.56   |
| `npm run typecheck:integration`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 0    | 8.29    |
| `npx --no-install eslint --max-warnings=0 scripts/lib/harnessServer.mjs src/acp/agent.ts src/core/reporting/render/redaction.ts src/extension.ts src/host/schedules/schedulesBridge.ts src/shared/l10n/exactUsd.ts src/shared/scheduleV2.ts src/webview/components/PlanUi.tsx test/unit/ReferencePage.test.tsx test/unit/browserUiText.test.mjs test/unit/harnessHistoricalFixture.test.mjs test/unit/lintStagedBatching.test.mjs test/unit/m95PlanUi.test.tsx test/unit/modelApiElicitation.test.ts test/unit/paidDailyBudget.test.ts test/unit/readmeShots.test.mjs test/unit/reportRedaction.test.ts test/unit/scheduleCommands.test.ts test/unit/scheduleV2.test.ts test/unit/visualGate.test.mjs`                                                                                              | 0    | 22.30   |
| `npx --no-install prettier --check CHANGELOG.md PLAN.md README.md docs/certification/int0170-combined.md docs/orchestration-gotchas.md scripts/lib/harnessServer.mjs src/acp/agent.ts src/core/reporting/render/redaction.ts src/extension.ts src/host/schedules/schedulesBridge.ts src/shared/l10n/exactUsd.ts src/shared/scheduleV2.ts src/webview/components/PlanUi.tsx test/unit/ReferencePage.test.tsx test/unit/browserUiText.test.mjs test/unit/harnessHistoricalFixture.test.mjs test/unit/lintStagedBatching.test.mjs test/unit/m95PlanUi.test.tsx test/unit/modelApiElicitation.test.ts test/unit/paidDailyBudget.test.ts test/unit/readmeShots.test.mjs test/unit/reportRedaction.test.ts test/unit/scheduleCommands.test.ts test/unit/scheduleV2.test.ts test/unit/visualGate.test.mjs` | 0    | 11.04   |
| `npx --no-install knip`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 0    | 4.24    |
| `npx --no-install jscpd`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 0    | 1.36    |
| `npm run check:l10n`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 0    | 2.45    |
| `npm run check:reference`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 0    | 2.38    |
| `npm run check:host-api`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 0    | 23.68   |
| `npm run check:plan`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 0    | 0.39    |
| `npm run check:tokens`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 0    | 1.10    |
| `npx --no-install vitest run test/unit/acpAgent.test.ts test/unit/usd.test.ts test/unit/modelApiElicitation.test.ts --maxWorkers=3`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 0    | 10.41   |
| `npx --no-install vitest run test/unit/paidDailyBudget.test.ts test/unit/lintStagedBatching.test.mjs test/unit/browserUiText.test.mjs --maxWorkers=3`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 0    | 6.33    |
| `npx --no-install vitest run test/unit/scheduleV2.test.ts test/unit/scheduleCommands.test.ts test/unit/harnessHistoricalFixture.test.mjs --maxWorkers=3`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 0    | 1.38    |
| `npx --no-install vitest run test/unit/ReferencePage.test.tsx test/unit/reportRedaction.test.ts test/unit/m95PlanUi.test.tsx --maxWorkers=3`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 0    | 11.01   |
| `npx --no-install vitest run test/unit/visualSource.test.mjs test/unit/visualGate.test.mjs test/unit/visualMatrix.test.mjs --maxWorkers=3`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 1    | 1.51    |
| `npx --no-install vitest run test/unit/readmeShots.test.mjs --maxWorkers=3`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 0    | 1.24    |
| `npx --no-install vitest run test/unit/scheduleJournal.test.ts test/unit/scheduleStore.test.ts --coverage --shard=1/1 --maxWorkers=3`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 0    | 135.50  |
| `npm run build`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 1    | 7.99    |
| `node scripts/check-bundle-split.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 1    | 1.91    |
| `npm run check:visual`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 1    | 7.60    |
| `npm run test:a11y`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 0    | 352.29  |
| `npm run security:sast`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 0    | 203.71  |
| `xvfb-run -a npm run test:integration`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 0    | 68.85   |

**Unchanged build blockers:** runtimeQuestions 25.5/25 KiB; conversation
255.0/250; runtimeEngine 893.8/875; usagePanel 83.4/75; headless 100.7/100;
runtimeAccounts 339.6/300; surface English 26.9/25; Palette 25.7/25;
estimator 25.0/25 (rounded display, measured bytes exceed cap). The separate
split replay also fails on unlisted deferred src/shared/slashCommands.ts;
neither that module nor its split guard is changed by LEFT017. npm run build
fails its size check before this later split check can run. No cap/allowlist
is raised or bypassed.

**Visual scope blocker:** 270 current webview files versus 112 audited;
159 unrecorded sources, 48 stale source hashes, and absent old diffTally.ts.
There are 184 required render inputs versus 73 mapped: 111 missing.
One Dark Pro and Dracula each record 63 of the 71 currently read variables;
the missing eight are five chart colors, two dropdown colors and the editor
find-match background. check:visual refuses missing manifest coverage at
panel/agents-details/default/light/320. No tracked audit-refresh generator
was found; capture helpers require reviewed scene/selector/state mappings.
A complete review exceeds the shared common.md approximately 300-new-lines
per-finding stop rule. Full audit, theme captures and manifest expansion
remain a dedicated visual lane; no receipts are fabricated or assertions
relaxed.

| Intentional failing control | Whole owner                       | Exit | Restored source SHA-256                                            |
| --------------------------- | --------------------------------- | ---- | ------------------------------------------------------------------ |
| commands                    | scheduleCommands.test.ts          | 1    | `5050b73b895faf5015decb1e1942da482001c78ee10b9ac8af08efcd4315485b` |
| zone                        | scheduleV2.test.ts                | 1    | `007c871a744474d98f2667821f442266ae9c1aa7438482ff66e925e40c53ccf9` |
| fixture                     | harnessHistoricalFixture.test.mjs | 1    | `1c11b38b92fddd74e9280ba2b2117cd8c85f01bf3f9c7569f478df4eb3cc3a5f` |
| hook                        | lintStagedBatching.test.mjs       | 1    | `44e9ee35f61cd51e5e1b2d7884b5462e6edd6af9236ed0ba864a9f4306367b9d` |
| help                        | ReferencePage.test.tsx            | 1    | `a9cff2f94ebc067b1fa74ca7f53ef653ec68021c050fdca43a4a671e31f763d6` |
| report-root                 | reportRedaction.test.ts           | 1    | `0e41182484b5499d38ea672b1cac08c4556066a0fdcb756e63a5806ada6ee55e` |
| plan-counts                 | m95PlanUi.test.tsx                | 1    | `6a4c7d4b10d03a7a5127b23ee48eea84f0f3de8f5d5a25886c8e9f12a2db0ccd` |
| browser                     | browserUiText.test.mjs            | 1    | `59e7c83b9c698c6d6e4ad218f7e4ce166dad559c2adffac47d75cc6c4de3c89d` |
| readme-input                | readmeShots.test.mjs              | 1    | `1c11b38b92fddd74e9280ba2b2117cd8c85f01bf3f9c7569f478df4eb3cc3a5f` |

Every deliberate run fails on its intended assertion/build error, restores
exact source bytes, and is followed by a passing whole owner. Final hash
checks match all nine sources after hooks. New test guards are exercised;
the inherited obsolete owner is removed only after its observed failure.

Repair commits (oldest first; hooks enabled and committed diffs re-read):

- `98e924873` fix(build): remove obsolete compact reference plugin
- `abc258b91` test(l10n): cover lazy account and developer English graphs
- `ca08754db` refactor: share cancellation, USD display and merged test fixtures
- `359277d9a` fix(hooks): bound Windows staged-file arguments and share budget factory
- `04614250f` fix(schedules): register lazy editor panel commands at activation
- `7b0ef7692` perf(schedules): reuse validated time zone during journal parses
- `0449c5952` test(visual): resolve historical fixture source and guard Help IDs
- `95abdf61c` fix(reports): vet literal root escaping and record bounded lane progress
- `41fde3621` fix(a11y): render localized request counts and prepare clean gate fixtures
- `08d9c8ce2` docs(visual): refresh reviewed README captures and source receipt

Next: integrate the local repair commits, assign the complete M114 audit/theme
and reviewed-manifest expansion, and finish the existing cap/split shrinking
lane. Then replay full visual/build certification and the native Windows hook
case. No quality aggregate runs in this rig lane, as required by the brief.
Final receipt-only edits to PLAN and this record get format, plan and enabled
hook checks; production/test inputs remain those of the committed clone.
