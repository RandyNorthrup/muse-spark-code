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
- Full-size image inspection exposed capture-induced update-page clipping: the
  driver assigned a content-box body the full viewport width, then its padding
  extended beyond 320px. Capture now uses a border-box body; the whole owner
  measures the actual body width in every captured state. Resource-history
  chart/table overflow remains an owning-surface finding, not an accepted
  responsive result.
- The body-sizing deliberate drill reproduces 352px bodies at a 320px
  viewport; the whole capture owner exits 1. The expanded coverage assertion
  also rejects the old 4,824-frame receipt against 9,792 required captures.
  Restore driver SHA-256
  `484b2d7041c3b4607439a8a33be045906ca3d883c00918681bbdbd4d0b9459c9`.
  Models/accounts rings now use the established shared text-colour outline
  so One Dark Pro's low-contrast focusBorder does not hide keyboard focus;
  theme archive values themselves remain immutable.
- Final generator exits 0: 9,792 real Chrome PNGs, 446,522,789 bytes (below
  512 MiB), from source `58a8552a154ba5a2f43a73b1e18f1fbd8b242116`.
  All 5,298 distinct current images were inspected on 144 labelled contact
  sheets; byte-identical frames share the same inspected image. Original-size
  checks confirmed update wrapping, Models focus, resource clipping and
  reporting focus. Exact hashes, dimensions and one line for every renderer
  are in `left017b-visual-review.json` and `left017b-visual-review.md`.
- The final Playbook capture waits for `.playbook-record`, not just its
  outer shell: earlier loading-only frames were rejected and superseded.
  The complete capture owner requires the host reply in all six states.
- Findings F1 (standalone resource-history narrow clipping) and F2 (inherited
  theme/reporting focus and border contrast) remain explicit file:line
  owning-surface findings in the image review; no responsive/contrast pass
  is claimed for those observations. Fresh-clone pixel replay and final scoped
  static results are pending below.

- Fresh npm-ci clone: install exits 0 (901 packages), with existing audit
  advisories retained. The first complete pixel replay exits 1 on
  `panel/quote-menu/default/light/320`: 9,863 changed pixels, allowance 12.
  The real menu origin was chosen before theme/fonts/host layout settled.
  Reopen the actual context-menu handler at the final passage rectangle.
  The complete stability owner now repeats quote-menu plus its original
  three scenes (24 state images per pass) and checks the real pill origin.
  Deliberately offsetting the context click by 100px makes its anchor guard
  fail (266 versus 166). Restore driver SHA-256
  `e461b59a81f9d39a2974c5e884a61c91538a41ac418a7a42b6a7bf120d2a7d49`;
  the entire owner passes 1/1 at default deadlines (22.36 s whole run).
  The earlier reviewed manifest remains unchanged and correctly names its
  original capture revision. Regenerate the full matrix with the settled
  quote driver, inspect changed quote images, then rerun the complete
  fresh-clone pixel gate. Do not splice partial receipts or widen tolerance.

### LEFT017B final fresh-clone results

Verified code source `8a451e9de4a8a3bdea9858ed59379469b616ba10`, Linux rig,
fresh `npm ci`, `CI=true`, default repository deadlines, at most three whole
test files per invocation and one build/typecheck/lint/test process at a time.
All eight visual owners pass: 27 + 14 + 4 = 45 tests, none skipped.
The entire protected visualMatrix owner is byte-exact against `e2605a991`.

| Gate              | Exit | Evidence                                                                                                                                       |
| ----------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `visual-final`    | 1    | Final quote-origin code correctly rejects the old baseline: 28,957 changed pixels at panel/quote-menu/default/light/320; allowance remains 12. |
| `visual-owners-a` | 0    | 27 tests; capture, matrix and audit.                                                                                                           |
| `visual-owners-b` | 0    | 14 tests; gate, source reconstruction and stability.                                                                                           |
| `visual-owners-c` | 0    | 4 tests; slash bundle and theme inventory.                                                                                                     |
| `typecheck`       | 0    | All five projects.                                                                                                                             |
| `eslint`          | 0    | Every changed TS/TSX/MJS file; zero warnings.                                                                                                  |
| `prettier`        | 0    | Every changed file.                                                                                                                            |
| `knip`            | 0    | Plain knip; two inherited configuration hints.                                                                                                 |
| `jscpd`           | 0    | 2,835 files; zero clones.                                                                                                                      |
| `stylelint`       | 0    | Unchanged gate passes.                                                                                                                         |
| `l10n`            | 0    | Unchanged gate passes.                                                                                                                         |
| `reference`       | 0    | Unchanged gate passes.                                                                                                                         |
| `host-api`        | 0    | Unchanged gate passes.                                                                                                                         |
| `plan`            | 0    | Unchanged gate passes.                                                                                                                         |
| `tokens`          | 0    | Unchanged gate passes.                                                                                                                         |
| `build`           | 1    | Production compilation succeeds; nine inherited caps below stop the aggregate.                                                                 |
| `split`           | 0    | Deferred source accepted; activation 587,451 bytes.                                                                                            |

The source owner first fails because a symlinked disk-backed temp directory
has no parent Git repository. Its fixture now runs `git init --quiet` inside
its own root; the original missing-tree and cleanup assertions remain intact.
The complete owner passes locally and in the fresh clone. After the quote
commit hook rewrote the condition chain into a switch, the committed logic
was reread; the full stability owner passes again. Final capture-driver hash:
`1885352f13682c65fe1726bb32b51c58b7a677457d6a063e7a40e321206cc964`.

Full-size final quote failure image was inspected: the settled menu is within
the narrow viewport; the expected origin change needs a new reviewed baseline.
No partial manifest splice, changed tolerance, stale assertion edit or waiver.

Nine inherited size failures (KiB / cap): runtimeQuestions 25.5/25;
conversation 255.0/250; runtimeEngine 893.8/875; usagePanel 83.4/75;
headless 100.7/100; runtimeAccounts 339.6/300; webview surface English
26.9/25; Palette 25.7/25; estimator panel 25.0/25 (exact bytes exceed cap).
These remain the shrinking lane's work. Activation is exactly 587,451/614,400.

Local hooks-on commits, oldest first: `45dee1e3b`, `c9a4f2ec7`, `2ae80ffb9`,
`fac844b25`, `58a8552a1`, `dea829e87`, `3a4fca76c`, `8a451e9de`.
Staged and committed diffs were reread after each successful hook run.

**Incomplete at the two-hour limit:** the last quote capture fix invalidates
its earlier baseline. The full generator previously took about sixteen minutes;
another full generation plus replay does not fit the remaining brief window.
The original 9,792-image receipt and 184 review lines are retained honestly at
their recorded source revision. F1/F2 remain owning-surface findings.

Next: run the repository's full `check:visual -- --update` with a new review
reference and a new outside-git `$TMPDIR` archive; inspect every changed image,
refresh the bound image review, then rerun complete fresh-clone `check:visual`.
Keep all thresholds and the three protected assertions unchanged. Fresh clone
is removed at handoff; the external archive and labelled review sheets remain.

### LEFT017C/LEFT017D: F2, traffic buttons and contrast coverage (2026-10-08)

Branches `rel017/left3` (base `a038b5c2d`) and `rel017/left4` (base
`16fb06638`). No merge, push, live or paid call, changed timeout, threshold,
assertion or invented colour. F1 is untouched: `src/webview/usage/ResourcesSection.*`
belongs to the resource-history lane.

- **F2 fixed** (`1c3006e59`). Before: the independent reporting page drew
  keyboard focus in the host focus colour (`src/webview/reporting/styles.css:42`,
  `outline: 2px solid var(--vscode-focusBorder)`), and the Models provider
  button and the accounts picker drew their boundary in the host input border
  (`src/webview/models/models.css:147`,
  `src/webview/models/sections/accounts/accounts.css:30`,
  `border: 1px solid var(--vscode-input-border)`). After: the same lines use
  the M114 token contract already used by the Models/accounts focus outline
  (`models.css:25`, `accounts.css:54`): `outline: var(--ms-focus-width) solid
var(--ms-text)` with `outline-offset: var(--ms-focus-offset)`, and
  `border: 1px solid var(--ms-border)`. The reporting stylesheet imports
  `tokens.css`; accounts loads beside `models.css`, which imports it. The
  `tokens.test.mjs` case "draws F2 focus rings and boundaries from M114
  tokens" fails on the pre-fix CSS and passes after.
- **Traffic buttons fixed** (`4a29c2d40`). The team traffic fixture mounts
  the real `TrafficView`/`TrafficSurface` with their own stylesheet, so the
  finding belongs to the component, not the fixture. Before,
  `src/webview/components/traffic/traffic.css:13-24` gave every
  `.traffic-view button` the input-field role (`--vscode-input-background`,
  `--vscode-input-foreground`, input border), so task-row actions read as
  text fields in all six themes. The same stylesheet is shared by the Runners
  section (`src/webview/models/sections/runners/RunnersSection.tsx:6`).
  Neither surface is mounted by a shipped entry yet (`TrafficView` and
  `RunnersSection` are imported only under `test/harness`), so no released
  UI showed it, but the shared stylesheet would have shipped it unchanged.
  Now the stylesheet imports the token contract (`traffic.css:4-5`); buttons
  take the secondary-button role (`--ms-secondary-text`,
  `--ms-secondary-surface`, `--ms-control-border`, `traffic.css:32-38`) with
  a hover that leaves the selected tab alone (`traffic.css:40-42`); focus uses
  the token ring (`traffic.css:44-47`). No host theme name was added or
  dropped, so the protected theme-read inventories are unchanged. New
  `tokens.test.mjs` case "gives traffic and runner buttons the
  secondary-button role": the deliberate drill (pre-fix stylesheet restored)
  exits 1 with that case failing; restoring SHA-256
  `099994009cf999d9fa3de6cd1dc5cf67d5d282a92670e27f9785d9b9d7ce8f5f` passes
  the whole owner 15/15.
- **Nine below-AA host comparisons** (`docs/certification/m114-0.md:178`),
  measured with the repository's `contrastRatio` against the immutable theme
  fixtures, for what our CSS now draws:

| Host comparison (ratio)               | What our UI draws now                                                   | Measured                                             | Status                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| One Dark Pro focus on sidebar (1.579) | `--ms-text` ring (`#cccccc`)                                            | 9.586                                                | Covered by our token                                                                                         |
| One Dark Pro focus on raised (1.579)  | `--ms-text` ring                                                        | 9.586                                                | Covered by our token                                                                                         |
| One Dark Pro focus on input (1.692)   | `--ms-text` ring                                                        | 10.276                                               | Covered by our token                                                                                         |
| One Dark Pro focus on primary (1.044) | `--ms-text` ring                                                        | 5.819                                                | Covered by our token                                                                                         |
| Dracula focus on primary (1.945)      | `--ms-text` ring (`#F8F8F2`)                                            | 8.585                                                | Covered by our token                                                                                         |
| Dracula input border on input (1.218) | `--ms-border` (host panel border `#BD93F9`)                             | 5.903 on input, 6.546 on sidebar                     | Covered by our token                                                                                         |
| One Dark Pro panel border (1.579)     | `--ms-border` resolves to this host colour `#3e4452`                    | 1.579 on sidebar, 1.692 on input, 1.292 on secondary | Host-only; residual R1                                                                                       |
| One Dark Pro placeholder (3.604)      | Panel inputs use `--ms-input-text` (`styles.css:541`, `:1008`, `:4341`) | 7.742                                                | Covered in the chat panel; host-only in Models filter/select/wizard, vault editor, agent map, review comment |
| Dracula placeholder (3.026)           | Same rules                                                              | 13.359                                               | Same split as above                                                                                          |

The F2 and traffic surfaces render no placeholder text. The token ring
covers all five focus comparisons wherever our CSS draws focus with it.

- **Residual R1 (One Dark Pro boundaries).** One Dark Pro sets no
  `--vscode-input-border`, so before F2 the Models button and accounts picker
  had no border at all (an unset `var()` without fallback invalidates the
  declaration). They now draw a 1px `--ms-border` line, which in One Dark Pro
  is the host panel border `#3e4452`: 1.292:1 on the secondary button,
  1.692:1 on the input, 1.579:1 on the sidebar, below the 3:1 UI threshold.
  Traffic buttons draw the same colour through `--ms-control-border`. Labels
  stay readable (secondary text 6.753:1), but the boundary is not clearly
  visible. Closing it needs a token-contract decision (a boundary role whose
  fallback stays at 3:1 or more where the host's panel border is weak), not a
  per-surface colour, so no colour was invented here.

- **Receipts regenerated** in real headless Chrome 153.0.8010.52 on Linux
  (`randy-lt`), with the repository's own generator
  (`npm run check:visual -- --update`) in a clean clone after `npm ci`.
  Final receipt: source `0d354eac0`, review
  `LEFT017D-integrated-review-2026-10-08`, 9,792 captures, 5,363 distinct
  images, 446,821,642 bytes, kept outside git at
  `/var/tmp/l-LEFT017D/left017d-final`; manifest SHA-256 `9cf87fcf…`
  (`5e3bec107`). Against the LEFT017B receipt, 2,375 frames (1,379 distinct
  images) changed. Visible changes are confined to the F2 surfaces (Models,
  accounts, reporting), traffic and Runners buttons, quote menu, palette,
  share view and usage dialog; the other 63 changed scenes differ by
  rasterization noise of at most 5 pixels above a 10% channel delta. Every
  changed image was viewed on 42 labelled LEFT017D sheets, and
  `left017b-visual-review.json` binds each frame to the sheet that showed its
  exact bytes (142 LEFT017B sheets for unchanged frames). The 44 renderer
  lines whose scenes changed visibly are updated in
  `left017b-visual-review.md`, which also records the pre-existing narrow
  team-cards finding F4.
- **Capture races found by the fresh-clone replay and fixed in the driver.**
  The interim receipt at `4a29c2d40` (`f9c2809eb`) replayed with exit 1 at
  `share-narrow/default/light/320` (320 changed pixels, allowance 12). Code
  highlighting falls back to identical plain markup, the usage dialog's
  account facts fall back to nothing, and the palette filter's autofocus
  scrolled the document to 76 or 83 px depending on font timing (`0d354eac0`
  waits for the settled render and replays the focus scroll). The replay of
  `5e3bec107` then exited 1 at `plan-usage/default/hc-light/690`
  (1,389 pixels): the service-status row's "Reading usage…" Suspense fallback
  (`8f276975b` waits until no such status remains). Probes: three runs of
  palette, share-narrow and usage, then two runs of all eight usage, paid and
  plan scenes (576 frames each), have zero frames over the allowance run to
  run, and zero against the reviewed `0d354eac0` archive, so the reviewed
  receipts stay current for `8f276975b`. No threshold, tolerance or assertion
  changed.

Fresh-clone gates on `8f276975b` (Linux rig, clean clone, `npm ci`,
`CI=true`, repository deadlines, one heavy process at a time):

| Gate             | Exit | Evidence                                                                                                      |
| ---------------- | ---- | ------------------------------------------------------------------------------------------------------------- |
| `check:visual`   | 0    | 9,792 captures passed against the reviewed archive; 27 changed pixels in total, at most 3 per image (cap 12). |
| split            | 0    | `check-bundle-split.mjs`; deferred surfaces unchanged.                                                        |
| visual tests (a) | 0    | `visualCapture`, `visualMatrix`, `themeInventory`: 23 tests.                                                  |
| visual tests (b) | 0    | `visualGate`, `visualSource`, `visualStability`: 14 tests.                                                    |
| visual tests (c) | 0    | `slashCommandsBundle`, `tokens`: 16 tests.                                                                    |
| typecheck        | 0    | All five projects.                                                                                            |
| eslint           | 0    | Changed TS/MJS files, `--max-warnings=0`.                                                                     |
| stylelint        | 0    | Changed CSS files.                                                                                            |
| prettier         | 0    | Every file changed since `a038b5c2d`.                                                                         |
| `check:tokens`   | 0    | 0 problems.                                                                                                   |
| knip             | 0    | Plain knip; two inherited configuration hints.                                                                |
| jscpd            | 0    | 0 clones.                                                                                                     |

The full build is not claimed here; its inherited size caps belong to the
shrinking lane.

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

## Red tests (RED017)

Lane `rel017/red`, base `e2605a991`, macmini rig, 2026-10-08. Repository
timeouts throughout (no `--testTimeout`), hooks on, explicit `git add` of two
test files, no stash, no merge, no push. One repair commit: `231dd448e`.

### accountUsageBundle — handed to the caps owner, untouched

- Failure: `test/unit/accountUsageBundle.test.mjs:65`,
  `expect(inputs).not.toContain('src/shared/usd.ts')`; `usd.ts` sits in the
  eager caller graph.
- Root cause: merge `f3a6c1e5b` (int/0180b) re-introduced
  `import { Usd } from '../usd'` into `src/shared/l10n/text.ts:10` for the
  exact-USD `formatUsd`/`formatUsdAtPrecision` (0180b money work). The test's
  eager entry imports `setUiText` from `text.ts`, so `src/shared/usd.ts`
  (via `usdSchema.ts`; its `zod/mini` import is tree-shaken out of this
  graph) is now eager. 0.16.0's `a441b557a` had removed that import.
- Measured with the test's own esbuild config: the eager chunk carrying
  `usd.ts` is 121,526 B (react-dom client, `text.ts`, deferred English,
  the loader); the deferred AccountsSection chunk is 10,644 B of the
  25,600 B cap (passes); every other assertion in the file holds
  (AccountsSection.tsx and usageText.ts absent eager, the dynamic import
  present, no `accountUsage.ts`, no `src/host` or `src/core/accounts`
  inputs). Only the `usd.ts` containment assertion fails.
- Handoff to `rel017/caps`: moving exact USD arithmetic out of the eagerly
  imported `text.ts` (or re-cutting the split) is a split-boundary and
  budget decision, and the exact-decimal ledger assertions restored by
  LEFT017 item 5 depend on the current shape. Do not weaken the test.
  Files involved, none changed: `src/shared/l10n/text.ts:10,93-143`,
  `src/shared/usd.ts`, `src/shared/usdSchema.ts`.

### acpNpmReadme — fixed, stale adjacency expectation

- Failure: `test/unit/acpNpmReadme.test.ts:26`,
  `/'acp\.js',\s*'estimator\.js'/` against `scripts/package-acp-test.mjs`.
- Root cause: merge `f3a6c1e5b` put 0180b's shared lazy bundles
  (`mcpPool.js`, `exec.js`, `modelApiCodeIntel.js`, `structuredSchema.js`)
  between `acp.js` and `estimator.js` in the test-package list.
  `14f720cb2` ("ship lazy engine in product packages") had added
  `estimator.js` adjacent; the engine still ships in both packages, only
  the adjacency changed.
- Fix (`231dd448e`, test-only): require `'estimator.js'` in both
  `package-acp.mjs` and `package-acp-test.mjs` without adjacency. The
  `14f720cb2` guard still holds. No doc change was needed: the other four
  cases (packed README, star sentence, absolute links, manifest fields)
  pass unchanged, so the landing page describes what 0.17 ships.
- Proof: 5/5 green; red drill keeps a scratch mirror of the matcher and
  shows it fires on estimator-stripped script text. Release-prep files
  `readmeVersion`, `checkBadges`, `changelogVersion` (48 tests) and
  `whatsNewContent`, `changelogSource`, `referenceEntry` (45 tests) pass.

### acpResources, two cases — fixed, stale command list

- Failures: "announces built-in commands even when skills fail" (5
  announced vs 6 received) and "reserves resource command names" (names
  missing `'report'`).
- Root cause: `df3afec80` ("add lazy CLI, ACP and scoped host report
  adapters", M93, PLAN D72) legitimately announces `/report`
  (`src/acp/agent.ts:537-541`) between `compact` and `resources`;
  `docs/acp.md:884` and `src/shared/l10n/en.ts:532` document it, and the
  skill filter reserves its selector (`agent.ts:615`). Both tests predate
  the command.
- Fix (`231dd448e`, test-only; process launches stay with `rel017/spawn4`,
  whose files were read but never written): both expectations list
  `report` in its announced position, and the fake skill list gains the
  `'report'` selector, so a leaked duplicate fails the exact `toEqual`.
- Proof: 8/8 green. Drills: removing the announcement block fails exactly
  these two cases; removing the reservation filter line fails the
  reservation case on the duplicate; `src/acp/agent.ts` verified
  SHA-256 `c6dd2280b11ecbaf65251e50daf86a8f278983180c20305b6de6f405e8485af3`
  after each restore. Product `src/acp/*` and `src/runtime/resources/*`
  unchanged.

### Neighbours, static gates and further findings (this worktree)

- `acp*` / `account*` sweep: everything passes except the handed-off
  bundle file and the three pre-existing findings below. Account-usage
  neighbours pass 20/20 around the still-red bundle file.
- Five typechecks (host, webview, unit, e2e, integration): 0 errors.
  `eslint --max-warnings=0` and prettier on the changed files: clean.
  Plain knip 0 (two known configuration hints), jscpd 0 clones,
  `check:l10n` 0 problems, `check:reference` current.
- Not RED017's, all pre-existing on `e2605a991` (the repair diff touches
  only the two test files, so these inputs are base-identical) and left
  untouched:
  - `acpAgent.test.ts` ChatGPT case: `chatgpt-status` verify ends
    `request-failed` ("temporarily unavailable"). The refresh lock
    (`src/runtime/chatGptRefreshLock.ts:21-32`) binds loopback port 49953,
    and this rig's shell sandbox denies `listen` (bare-node probe:
    `EPERM`). Passes where loopback is allowed (LEFT017 Linux 142/142).
    Environmental.
  - `accountsPanel.a11y.test.mjs`: the harness server fails
    `listen EPERM 127.0.0.1` under the same sandbox. Environmental.
  - `accountPaidConsent.test.ts` (2 cases): the consent mock now also
    receives a `quote` object and `ask` is called twice where once is
    expected — the 0180b quote shape against M108 consent expectations
    (the hosted Kubuntu batch already listed this file). Paid-lane
    territory; untouched.

### Fresh-clone replay (macmini, `$TMPDIR/red017-fresh`, `npm ci`, `CI=true`)

Clone at `231dd448e`. The four files three times: 13/14 pass every run
— the only failure is the handed-off `accountUsageBundle` `usd.ts`
containment case; `acpNpmReadme` 5/5 and `acpResources` 8/8 green in all
three. Neighbours `acpReports`/`acpUsage`/`accountUsage` 27/27;
`accountPaidConsent` reproduces its two pre-existing failures on the
clean tree with `acpEstimate`/`accountUsd` green beside them. Five
typechecks exit 0. `eslint --max-warnings=0` and prettier on the changed
files plus this record: clean. Plain knip 0, jscpd 0 clones,
`check:l10n` 0 problems, `check:reference` current. Both clones removed
after verification; scratch probes stayed under `$TMPDIR` and were
removed too.

## Bundle diet (CAPS017)

Branch `rel017/caps` from `release/0.17.0` `7a4fc2ab3`, 2026-10-08, Windows
host builds plus Kubuntu for test batches and packages. Hooks ran on every
commit and nothing was pushed. The webview items were done by a helper
branch, `rel017/caps-web`, and were reviewed and cherry-picked. No bundle
cap was raised. Baselines for 0.16.0 (`4da4ef666`), int/0170 (`41dffa50b`),
int/0180b (`516ace8d5`) and the candidate were built on Kubuntu with
identical options, for attribution.

### Before and after (Windows `npm run build`, bytes)

| Bundle / closure             | Candidate | After   | Cap     | What moved                                                                                   |
| ---------------------------- | --------- | ------- | ------- | -------------------------------------------------------------------------------------------- |
| `dist/runtimeQuestions.js`   | 26,130    | 23,532  | 25,600  | `shared/questions.ts` comes from `dist/wire.js`                                              |
| `dist/conversation.js`       | 261,085   | 249,688 | 256,000 | upload report schema to `shared/media.ts`; ledger, Model API client and subagent tools leave |
| `dist/runtimeEngine.js`      | 915,371   | 638,576 | 896,000 | `englishZodLocales`: 63 unused zod locales (258 KiB); wire schemas shared                    |
| `dist/usagePanel.js`         | 85,339    | 73,648  | 76,800  | `scheduleV2`/`scheduleEvents`/`schedule` come from `dist/wire.js`                            |
| `dist/headless.js`           | 103,142   | 101,083 | 102,400 | account words to the `src/acp/accountText.ts` leaf; panel schemas leave                      |
| `dist/runtimeAccounts.js`    | 347,676   | 47,511  | 307,200 | `ExecAccountsPort.create` takes the engine's `createRuntimeBackend`; backend closure leaves  |
| webview surface English      | 27,592    | 24,540  | 25,600  | `vault` English leaves the shared region (`vaultEnglish.ts` installs it)                     |
| webview Palette              | 26,366    | 22,658  | 25,600  | `/` list via `paletteRegistry`; `SLASH_REFERENCE` to `shared/reference/slashReference.ts`    |
| webview estimator panel      | 25,627    | 25,315  | 25,600  | machine-class and provider schemas in `shared/estimate.ts` as pure builders                  |
| `dist/modelApi.js`           | 531,648   | 527,377 | 537,600 | `bareName` through `codeIntelEntry`; wire schemas shared                                     |
| `dist/wire.js`               | 65,514    | 70,883  | 76,800  | now exports the five schemas the protocol already carried                                    |
| `dist/extension.js`          | 585,037   | 569,835 | 614,400 | wire schemas shared                                                                          |
| `dist/reporting*.js` (four)  | 320,130   | 296,041 | each ok | `sharedRedaction`: the scrubber comes from `dist/vaultBoundaries.js`                         |
| chat startup (main + static) | 766,223   | 766,296 | 921,600 | +73 B for the exact-USD shared chunk (below); the FIXDIET1 ratchet failed before             |

`npm run build` exits 0 (every cap, split check, host globals, notices).
Before, the split check also reported `src/shared/slashCommands.ts` as an
unlisted deferred surface. It reports nothing now.

### Model API review pin (M115 RVM115U5)

The pin was stale; this lane did not push the bundle past it. The RVM115U5
test fails on int/0170's own head (483,463 > 474,100 B, Kubuntu run of the
test), and 0.16.0 alone builds `dist/modelApi.js` at 500,400 B with no M115
code. Compared with 0.16.0, the combined tree adds:

- `ModelApiHost.ts` +22,347 B (int/0170 about 15.4 KB, int/0180b about 6.9 KB)
- `schedules/sessionOwner.ts` 4,308 B
- `context/recordingReader.ts` 3,252 B
- `shared/accounts.ts` 1,931 B

`sessionOwner.ts` and `recordingReader.ts` are core to every session: the
hosts' schedule owner and the provenance reader. Moving all four would still
leave 0.16.0's 500,400 B. The pin is corrected to the measured combined value,
**527,400 B**, which is inside D6's 525 KiB cap. The lead decided this is a
stale-pin correction, not a relaxed budget. Re-measure after the money lanes
merge.

**Re-measured after the money lanes (INT0170, 2026-10-08, Kubuntu).** With
every lane through `afc978b72` merged, the shared `usdSchema.ts` and
`windowsPathSpelling.ts` moved into `dist/modelApiBoundaries.js` (see
[Bundle regressions after the lane merges](#bundle-regressions-after-the-lane-merges-int0170)),
`dist/modelApi.js` measures **530,883 B**. That is +3,506 B over this lane's
527,377 B. It is feature code, not an accidental dependency:

| Lane (merge)              | Bytes  | Files                                                                                                                                                 |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| MONEY017 (`851c99497`)    | +2,544 | scheduled-run media reserve/settle: `ModelApiHost.ts` +2,081, `client.ts` +451, `tools.ts` +49, `retryPolicy.ts` −31, `transport.ts` −5, constants −1 |
| PORTS017 (`632f79910`)    | +224   | `shared/accounts.ts` +134 (its exact-USD fields and the shared schema's require), `l10n/exactUsd.ts` +90                                              |
| SECWINPATH (`afc978b72`)  | +517   | `checkpoints/storageRefusal.ts` +152, `ModelApiHost.ts` +139, `browser/browserTool.ts` +111, `protectedPaths.ts` +80, `workspacePath.ts` +35          |
| SECWINPATH's `MODEL_TEXT` | +221   | `checkpointWindowsPathRefused`, `checkpointStorageUncertain`, `browserCheckSystemDirectoryUnavailable` (read at activation)                           |

The pin moves to the measured **530,883 B** (lead decision, option (b)),
inside D6's 537,600 B cap. It is re-measured and ratcheted **down** when the
media redesign (`m105/media-w2`, media into the deferred
`dist/productionMedia.js`) merges.

### VSIX (provisional cap)

`npm run package` cannot finish on Windows because the Linux and macOS
helpers are missing. The packages below were built and measured on Kubuntu
with `scripts/package-vsix.mjs`.

| Package               | x64 helper | arm64 helper | macOS | Bytes     |
| --------------------- | ---------- | ------------ | ----- | --------- |
| 0.16.0 `4da4ef666`    | empty      | empty        | none  | 2,819,351 |
| candidate `7a4fc2ab3` | empty      | empty        | none  | 3,274,456 |
| CAPS017 `fa94713cd`   | real       | empty        | none  | 3,272,933 |

The real arm64 helper could not be built: Kubuntu has the aarch64 compiler
but no arm64 OpenSSL. The cap is therefore **provisional**:
`25 × ceil(3,196.2 KiB × 1.15 / 25)` = **3700 KiB (3,788,800 B)**, set in
`scripts/check-vsix-size.mjs` (lead decision, PLAN.md D6). The hosted CI
universal VSIX on the release PR sets the final cap. For scale, 0.16.0's
universal package measured 2,911,436 B with every helper. The 0.17.0
universal package adds the arm64 helper and the macOS artifacts to the
figure above.

Growth over 0.16.0 (compressed ZIP entry bytes, +444,896 B in total):

| Contributor                       | KB     | Detail                                                                  |
| --------------------------------- | ------ | ----------------------------------------------------------------------- |
| Node bundle archive               | +157.1 | measured; the per-feature rows below compress each bundle alone         |
| reporting (M113, four bundles)    | ~90.5  | 296,027 B raw after the scrubber share                                  |
| schedules (M115)                  | ~44.7  | `schedules.js`, 156,234 B raw                                           |
| estimator (M117)                  | ~27.5  | `estimator.js` and `estimateContracts.js`                               |
| vault (M109)                      | ~17.2  | `vault.js` and `vaultBoundaries.js`                                     |
| media (M105)                      | ~15.9  | `media.js` and `screenRecord.js`                                        |
| l10n tables                       | +105.1 | new 0.17.0 strings in 14 locales                                        |
| webview                           | +82.1  | new 0.17.0 UI: reports, schedules, estimator, accounts, playbook, vault |
| native                            | +34.3  | the real x64 helper (14.2 KB) and new 0.17.0 native resources           |
| manifest strings and package.json | +23.4  | new commands and settings in 15 languages                               |
| uiText regions, What's New, wire  | +26.4  | new English, the 0.17.0 notes and the shared schemas                    |
| changelog, readme and docs        | +8.3   |                                                                         |

Against the candidate, CAPS017 saves 13.3 KB (archive) and 3.6 KB (webview)
compressed, and costs 1.5 KB in `wire.js`. Two cheap levers were tried. The
report scrubber share went in. The `shared/constants.ts` residue (667 KB
raw across 69 Node bundles) was measured but not removed: esbuild keeps the
arithmetic constant declarations of any module with a value import or
re-export, which minimal modules confirmed, and `constants.ts` has three
(the `usd` import, the `UI_TEXT` re-export and `browserCheckConstants`).
Removing them changes hundreds of importers across every lane, so that is
the lead's call. Not tried: a shared report core for `reportSchema.ts` and
`sessionTransfer.ts`, about 4 KB raw each in four bundles.

### Exact USD display (RED017 handoff)

After f3a6c1e5b, `src/shared/l10n/text.ts` imported `Usd` again, so every
graph that installs the language carried `usd.ts`. `formatUsd`,
`formatUsdIntl` and `formatUsdAtPrecision` move unchanged to
`src/shared/l10n/exactUsd.ts`. `formatExactUsd` was the same function, so it
is folded into `formatUsd`, and `numberFormat` is exported for the moved code.

- 37 importers change only their import line; no call changes.
- The move removes the `text.ts`/`exactUsd.ts` jscpd clone.
- Chat startup still carries `usd.ts`, as before, through
  `core/usage/insights.ts`, `shared/paid.ts` and `shared/tokenRatePrice.ts`
  (money lane).
- The new shared chunk costs chat startup 73 B.

### Guards and red drills

| Guard                                                       | Break                                                    | Result                                 |
| ----------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------- |
| split: backend closure stays out of `runtimeAccounts.js`    | candidate's `runtimeAccounts.json` in `dist/meta-acp`    | exit 1, three "accounts port" problems |
| split: wire schemas in no other bundle                      | candidate's `usagePanel.json` and `runtimeAccounts.json` | exit 1, seven duplicate-wire problems  |
| split: only zod's English locale in the engine              | first plugin version did not match `core/index.js`       | exit 1, 63 locale problems             |
| deferredBundles CAPS017 tests (wire, port, locales)         | the same metafiles and plugin                            | fail, then pass on restore             |
| webview surface English, palette, AppPaletteLazy, estimator | `rel017/caps-web` drills, each restored                  | fail or hang, then pass                |

### Tests and gates

Kubuntu ran a batch of 23 test files: the bundle tests, the suites of the
moved paths, and the built-agent e2e suites (acpStdio, accounts, questions,
schedulesStdio, reports, estimator). 1205 passed and 2 failed. Both failures
are in `webviewBundle.test.mjs` and also fail at `7a4fc2ab3`: `usd.ts` in
chat startup, and the FIXDIET1 startup ratchet (751,411 B).

`execStdio.e2e`'s schema/launcher test fails the same way on the candidate
(the `l10n` archive's `keys`), and its E5 timing case failed once under
load.

Full `test/unit` on Kubuntu after the exact-USD move: 24,236 passed and 64
failed in 33 files. The same 33 files on the candidate fail 63 tests in 31
files, all shared with this branch apart from two:

- `browserEnglish.test.mjs` (2 tests): it read every English value after
  `loadDeferredEnglish`. It now installs vault English the way the vault
  surface does, after asserting that it throws first, and then compares
  every value.
- `vault/peer.test.ts` (1 test): `nobody` cannot execute the client inside
  the rig slot's 0700 temp folder. This is the environment; it passes with
  an ordinary temp folder.

Fewer failures than the candidate:

- `webviewBundle.test.mjs`: 4 failures there, 2 here.
- `accountUsageBundle.test.mjs` (RED017) now passes.
- `warmDeferredSurfaces` lost its palette mismatch; the remaining
  `ElicitationCard` entry also fails at the candidate.

The other failures in the shared files belong to other lanes: money
(paidDailyBudget, accountPaidConsent, schedulePaid, paidMoneyPorts,
mediaClient), visual and a11y (visual*, m114*), museCodeSdk142,
modelApiLoopGuarantees, playbookOutcomes and the packaging fixtures.

Windows gates, all exit 0:

- five typechecks
- eslint `--max-warnings=0` and prettier on changed files
- plain knip and cycles
- check:l10n, check:reference and check:host-api

jscpd still reports the other three clones listed above (left lane).

### Machine id (DEVID017)

Lane `rel017/devid`, worktree on the `macmini` rig (`Macmini.ivettnet`).

- **Root cause.** The CLI/ACP runtime opened developer options with
  `machineId: hostname()` (`src/runtime/providers/runtimeServices.ts:291`).
  The state schema (`src/shared/developerOptions.ts:25`) admits only
  `/^[a-zA-Z0-9_-]+$/`, so any dotted hostname (`name.local`, domain PCs)
  threw `$ZodError` out of `DeveloperOptions.open` before any stored state
  was read. The extension host opens developer options nowhere yet, so the
  second bug was latent: a future `vscode.env.machineId` (or raw hostname)
  opener would disagree with the runtime and refuse its unlocks.
- **Fix.** One shared derivation, `developerMachineId`
  (`src/core/developer/machineId.ts:14`, domain constant
  `DEVELOPER_MACHINE_ID_DOMAIN` in `src/shared/constants.ts`): lowercase,
  domain-separated SHA-256 hex of the OS hostname. The runtime passes it
  with `previousMachineIds: [hostname()]`
  (`src/runtime/providers/runtimeServices.ts:291`); the extension host and
  the companion derive the same id from the same hostname when they open
  developer options. The schema is untouched (a 64-hex digest fits it), so
  the stored state keeps `v: 1`: the shape never changed, only the
  derivation.
- **Migration.** `DeveloperOptions.open` (`src/core/developer/developerOptions.ts:59`)
  accepts a stored grant whose id is in `previousMachineIds`, re-binds it
  to the opaque id in memory, and persists it on the next save with no
  grant change (hence no audit entry). Another machine and future-dated
  grants are still refused. Dotted-hostname machines never held stored
  state (open always threw), so nothing is lost there.
- **Tests** (`test/unit/developerOptionsMachineId.test.ts`, helper
  `test/unit/helpers/keyring.ts`): dotted hostnames map to schema-valid
  ids; published vectors pin the shared derivation; the runtime opens and
  persists the shared id on this rig; a legacy raw-hostname grant is
  adopted with expiry and profiles intact; strangers and future grants
  refuse. macOS `$TMPDIR` (`/var` symlink) is resolved with the repo's own
  `realpathSync.native` idiom in the three touched rigs, since
  `DeveloperLocalFiles` refuses symlinked roots.
- **Drill.** On base `94eefd28e` (clone under `$TMPDIR`, since removed) a
  two-case drill spec fails both ways: dotted-hostname open throws
  `$ZodError` "Invalid input", legacy adoption throws `unavailable`. Both
  pass with the fix (25/25 across the new file, `runtimeServices` and
  `runtimeAccountsBundle`, repo default timeouts).
- **Gates.** Five typechecks exit 0; eslint `--max-warnings=0` and prettier
  on changed files exit 0; `check:l10n` exit 0; `check:host-api` regenerated
  (`node:crypto` 166 to 167 importers) and exit 0; knip exit 0. jscpd exit 1
  before and after: the same three pre-existing clones (the lane's two new
  ones were extracted into the shared keyring helper and merged away).
  `accountPaidConsent` (2 tests) fails identically on the base: another
  lane's quote shape, left for its owner. The rig's sandbox blocks loopback
  listening, so no loopback-dependent suite was attempted beyond the above.

Round 2 (`rel017/devid2`, review RVDEVID017, worktree on the `macmini`
rig): the hostname digest is replaced by a stored random id.

- **Design.** The machine id is 32 random bytes as hex, created once per
  machine in `<dataDir>/machine-id` (`developerMachineIdFile`,
  `src/core/developer/machineId.ts:24`), the runtime's machine storage
  folder every host on this machine shares; the extension host resolves the
  same folder through `agentDataFolder`. It is never derived from the
  hostname: renames and `host` vs `host.local` change nothing, and the id
  fits the untouched state schema (`v: 1`). Creation is atomic
  (`loadDeveloperMachineId`, same file): an exclusive `wx` create lets the
  first of racing processes win while losers read the winner's file; an
  unreadable or invalid file refuses honestly with `unavailable`, never a
  hostname fallback. Constants `DEVELOPER_MACHINE_ID_FILE/BYTES` and the
  read retry live in `src/shared/constants.ts`.
- **Migration.** Stored state may hold the raw hostname (pre-DEVID017) or
  the hostname digest (DEVID017 state). `DeveloperOptions.open`
  (`src/core/developer/developerOptions.ts:84`) adopts either when it
  matches, case-insensitively, the current raw hostname, its digest, or
  that digest for the short or `.local` forms
  (`developerMachineIdAliases`, `src/core/developer/machineId.ts:88`), then persists
  the re-bound grant at once with a `migrate` audit row (a new audit
  action in `src/shared/developerOptions.ts`, not an authority grant:
  `DeveloperLocalFiles.read` skips it when restoring the switch). The raw
  hostname therefore leaves stored state on that open. Anything else is
  refused with the honest `differentMachine` reply
  (`src/shared/developerOptions.ts:71`,
  `UI_TEXT.developer.differentMachine` in all 14 tables): the terminal
  names the identity instead of reporting `unavailable`
  (`src/runtime/providers/accountsEntry.ts:54`), and `developer reset`
  recovers through `DeveloperOptions.resetForeign`
  (`src/core/developer/developerOptions.ts:130`, terminal source
  `terminal` via `developerReset` in
  `src/runtime/providers/runtimeServices.ts:69`). (Round 3 corrected this
  passage: foreign reset asks first and never stops — see Round 3 below.)
  Wording correction: what is refused is another **hostname**, not
  necessarily another physical machine (a copied grant under the same
  hostname is still accepted).
- **Tests** (`test/unit/developerOptionsMachineId.test.ts`, 14/14): rename
  keeps unlock and profiles; `host` vs `host.local` both ways;
  case-insensitive raw adoption; raw-hostname migration with the hostname
  gone from the store right after open (plus the `migrate` audit row);
  digest migration; concurrent first use creates one id; an id file that is
  a directory refuses `unavailable` from the loader and from
  `services.developer`; mismatch reports `differentMachine` with profiles
  intact; foreign reset after confirmation clears state (denial keeps it);
  the runtime persists the stored id; terminal status names the identity
  and reset recovers. `developerOptions.test.ts` now expects
  `differentMachine` for a stranger. Repo default timeouts.
- **Drills.** Deriving the id from the hostname again turns the stored-id
  test red; skipping the immediate persist turns the raw-gone test red;
  both restored to green. A two-case drill spec against base `402251833`
  (worktree under `$TMPDIR`, since removed) fails both ways: a rename
  throws `unavailable`, and the raw hostname is still in the store after
  open.
- **Gates.** Five typechecks exit 0; eslint `--max-warnings=0` and prettier
  on changed files exit 0; `check:l10n` exit 0 (new message in all 14
  tables); `check:host-api` regenerated (`node:fs/promises` 106 to 107,
  `node:path` 188 to 189, `node:timers/promises` 21 to 22 importers) and
  exit 0; plain knip exit 0; `check:reference` exit 0. jscpd exit 1 before
  and after: the same three pre-existing clones (the lane's two new ones
  were extracted into a shared runtime-args builder and a test helper).
  `developerLocalFiles` (11 tests) fails identically on the base: the
  macOS `/var`-symlink directory guard, byte-identical files, left for its
  owner.

Round 3 (`rel017/devid3`, review RVDEVID017B, worktree on the `macmini`
rig): the publish and the foreign reset are redesigned, not patched.

- **Publish.** The full id is staged to a private temp file in the same
  folder (`machine-id.<pid>-<random>.tmp`, `0600`), fsynced, then
  published atomically and exclusively with `link`, which fails when the
  final name exists — the calibration journal's
  (`src/core/estimator/calibration/journal.ts`) claim pattern, which also
  links on Windows, so no separate Windows helper was needed. The temp
  file is removed afterwards on both the win and lose paths
  (`loadDeveloperMachineId`, `src/core/developer/machineId.ts:62`; temp
  name constants `DEVELOPER_MACHINE_ID_TMP_PID_RADIX/SUFFIX_BYTES` in
  `src/shared/constants.ts`). A reader racing a creator sees no file or
  the complete id, never a prefix. The loader accepts only the exact
  format — 64 lowercase hex with one optional trailing newline
  (`isPublishedMachineId`, same file): a 16-hex prefix, `a`, `garbage`
  and an empty file all refuse honestly with `unavailable`.
- **Foreign reset.** `DeveloperOptions.resetForeign`
  (`src/core/developer/developerOptions.ts:141`) asks for confirmation
  first with nothing mutated before the answer, then on confirmation
  clears the foreign unlock and registration to a fresh record for this
  machine with a single `reset` audit row. A grant bound to another
  machine id is never re-bound to this machine by any path: not before
  confirmation, not in a `finally` (there is none anymore), not on cancel
  or failure. Profiles recorded under the foreign id cannot be running
  under this machine's authority, so they are cleared from the record
  without `stopAll` through this machine's resource port — which is why
  recovery now works with the runtime's unbound stub
  (`src/runtime/providers/runtimeServices.ts:311`). The audit records
  exactly that: a reset with no stop and no disable. Profile state
  folders and credential slots stay on disk: PLAN D88 (b) gives Reset the
  job of turning every option off and stopping the profiles
  (PLAN.md:12407), never of deleting profile folders. Cancel leaves
  stored identity, unlock, profiles and audit unchanged, and the next
  open still refuses with `differentMachine`.
- **Tests** (`test/unit/developerOptionsMachineId.test.ts`, 21/21): the
  four refusal cases (prefix, `a`, `garbage`, empty — the file unchanged
  afterwards); a held partial publish that completes 30 ms later is never
  adopted, the complete id is read instead; concurrent creators produce
  one id with no staging litter; decline leaves everything unchanged with
  no stop/remove call and the next open still refused; confirmation with
  an always-failing resource port clears to a fresh record with a single
  `reset` audit row and no stop/remove call, and the next open succeeds
  fresh; a failing save transfers nothing. The terminal test now carries
  one profile through the real unbound runtime port: reset exits 0 and
  the next status is locked. Repo default timeouts.
- **Drills.** Loosening the validator to the old shape turns the prefix,
  `a` and `garbage` refusal tests red; restoring a pre-confirmation
  re-binding save turns the decline test red; both restored to green. The
  new suite run against base `53c787184` (worktree under `$TMPDIR`, since
  removed) fails 7 ways: the three refusals, the held publish, the
  decline, the unbound-port confirmation and the terminal recovery with a
  profile. (The empty-file refusal and the save-failure guard pass on the
  base too, as designed.)
- **Gates.** Five typechecks exit 0; eslint `--max-warnings=0` and prettier
  on changed files exit 0; `check:l10n` exit 0 (no new user-facing
  string); `check:host-api` exit 0 (no new module: `link`/`rm` join the
  existing `node:fs/promises` import); plain knip exit 0; jscpd reports
  only the same three pre-existing clones in untouched files.
  `accountPaidConsent` (2 tests) fails identically on the base:
  byte-identical files, another lane's quote shape, left for its owner.
  `accountsPanel.a11y` cannot run here: its harness needs loopback
  listening, which this rig's sandbox blocks (`listen EPERM 127.0.0.1`);
  reported, not worked around.

Round 4 (`rel017/devid4`, review RVDEVID017C, worktree on the `macmini`
rig): the final fixes for the three P2s and one P3.

- **Read-first publish.** `loadDeveloperMachineId`
  (`src/core/developer/machineId.ts:64`) reads the published id before
  staging anything and returns it without creating a temp file; it
  publishes only when the final name is absent or unreadable. Storage
  that refuses new files (permissions or quota) still loads an existing
  valid id. Staging failures now remove their temp file on every path
  (same file): a failed write, fsync or close no longer leaves another
  claim file behind.
- **Audit-before-clear foreign reset.** `DeveloperLocalFiles.commit`
  (`src/runtime/developer/localFiles.ts:173`) still publishes an
  ordinary revocation when its audit append fails, but never a full
  `reset` clear: the reset audit row is written before the cleared
  state, and when the audit write fails the stored state is left
  unchanged and the failure is reported
  (`src/core/developer/developerOptions.ts:150`). The store contract
  (`DeveloperStore`, same file `:17`) records the carve-out.
- **Honest foreign confirmation.** Foreign reset asks its own
  `resetForeign` question (`developerOptions.ts:157`,
  `src/core/developer/surfaces.ts:100`,
  `src/runtime/providers/runtimeServices.ts:281`), answered by the new
  `UI_TEXT.developer.foreignResetWarning`
  (`src/shared/l10n/en.ts:6072`, in all 14 tables): it clears this
  machine's developer state, stops nothing, and profile folders and
  credentials stay as they are (PLAN D88 (b)).
- **Tests** (`test/unit/developerOptionsMachineId.test.ts`, 25/25;
  `test/unit/developerLocalFiles.test.ts`, 13/13;
  `test/unit/developerSurfaces.test.ts`, 24/24): a published id loads
  with `EACCES` on new-file creation and no staging call; a failed
  staged fsync leaves no litter; foreign reset asks `resetForeign`
  with the honest text; audit append-open `EACCES` through the real
  store leaves the foreign grant stored, reports the failure, and the
  next open still refuses `differentMachine`; the store never publishes
  a reset clear without its audit row while the disable fallback still
  does. Repo default timeouts.
- **Drills.** The six new/changed tests run against base `ce9f3dd7b`
  (worktree under `$TMPDIR`, since removed) fail exactly the new six:
  the read-first load, the staging cleanup, the honest confirmation,
  the stored-foreign-state audit failure, the store-level reset guard
  and the extended localization test; the other 56 pass on the base.
- **Gates.** Five typechecks exit 0; eslint `--max-warnings=0` and
  prettier on changed files exit 0; `check:l10n` exit 0 (new string in
  all 14 tables); plain knip exit 0; jscpd exit 1 before and after with
  only the same three pre-existing clones in untouched files.
  `developerLocalFiles.test.ts` needs a symlink-free `TMPDIR` on this
  macOS rig (`os.tmpdir()` spells `/var`, which the storage root
  refuses by design): it passes 13/13 with the resolved
  `/private/var` `TMPDIR` and fails identically on the base, so the
  helper is left for its owner. `accountPaidConsent` (2 tests) fails
  identically on the base as in round 3, left for its owner.

Round 5 (`rel017/devid5`, lead review fix, worktree on the `macmini`
rig): DEVID017D's audit-failure guard matched every `reset` audit row,
so an ordinary own-machine Reset whose audit append failed left
developer options on. Foreign Reset is now distinguishable in the
audit.

- **Fix.** Foreign Reset writes a distinct `resetForeign` audit action
  (`DeveloperOptions.resetForeign`,
  `src/core/developer/developerOptions.ts:169`; new enum member in
  `src/shared/developerOptions.ts:84`). `DeveloperLocalFiles.commit`
  (`src/runtime/developer/localFiles.ts:180`) withholds only that
  clear when its audit row was not written; every other revocation,
  own-machine Reset included, is still published after an audit
  failure, and the caller still gets the persistence error. The
  `DeveloperStore.commit` JSDoc
  (`src/core/developer/developerOptions.ts:20`) says exactly that.
  No schema version change: `v: 1` is untouched and old `reset` rows
  still parse, the same precedent as the `migrate` action. `read`
  needs no change: `resetForeign` already counts as a revoking
  authority row, never as an enable. No user-facing string changed
  (the audit row is machine-readable), so all 14 `l10n` tables are
  untouched.
- **Tests** (`test/unit/developerOptionsMachineId.test.ts`, 27/27;
  `test/unit/developerLocalFiles.test.ts`, 14/14): own-machine Reset
  with only the reset row's append-open failing `EACCES` through the
  real store still publishes the cleared state (options off) and
  reports the error; foreign Reset with audit `EACCES` leaves the
  stored state unchanged and the next open still refuses
  `differentMachine`. The store suite shares its enabled-grant setup
  through one helper (no new jscpd clone).
- **Drill.** The new own-machine test run against base `05f3719b2`
  (clone under `$TMPDIR`, since removed) fails exactly as diagnosed:
  the stored state keeps the unlock, expiry and profile — only the
  disable revoke was published, the reset clear was skipped.
- **Gates.** Five typechecks exit 0; eslint `--max-warnings=0` and
  prettier on changed files exit 0; plain knip exit 0; jscpd reports
  no clone across the five touched files. `runtimeServices` and
  `runtimeAccountsBundle` pass alongside (44/44 with the machine-id
  suite); `developerOptions`, `developerContracts` and
  `developerSurfaces` pass (52/52 in the surface/contract run).
  `check:l10n` not run: no string changed.

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

## Money ports review repairs (PORTS017B)

Mac rig, `rel017/ports2` on this worktree, base `f411b64a4`, 2026-10-08.
Fake-only: no paid/live calls, credentials, dependencies, gate changes, merge
or push. Four commits, one per review item; each has a regression that fails
on the base (drill receipts below) and no raised `--testTimeout`.

| Review item                         | Fix (file:line)                                                                                                                                                                                                                                          | Regression test                                                                                                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2 `collect.usage` number-vs-string | `test/unit/collect.usage.test.ts:11`: canonical `'0.25'` plus a `typeof` string check                                                                                                                                                                    | The updated assertion; sweep finds no other numeric USD cell (`reportContracts` already asserts numbers are rejected)                                                                                      |
| P3 trigger float coercion           | `src/shared/accounts.ts:64`: spend `value`/`threshold` carry `UsdAmount` (numeric persisted forms normalize once via `legacyUsdSchema`); spend caps in `accountThresholdsSchema` likewise; counts stay numeric                                           | `test/unit/thresholds.test.ts:86`: projected `'0.1000000000000000001'` reaches a `0.1` cap with the exact string value; `test/unit/accounts.test.ts:86`: numeric persisted caps/triggers normalize on read |
| P3 producer                         | `src/core/accounts/thresholds.ts:171`: exact `toAmount()` projection, no `Number()`                                                                                                                                                                      | Same trigger regression; `paidMoneyPorts` now also guards this file                                                                                                                                        |
| P3 cap notice text                  | `src/core/usage/accountUsageText.ts:113`, `AccountNotices.tsx:64`, `src/acp/accounts.ts:146`: unchanged `formatUsd(parseUsd(...))` rendering, now fed canonical strings; verified by the existing `$0.3000`/`$1.00` notice assertions                    | `test/unit/accountUsageText.test.ts`, `test/unit/accountsPanel.test.tsx`, `test/unit/acpAccounts.test.ts`                                                                                                  |
| P3 estimator float bound            | `src/shared/constants.ts:6991` `ESTIMATE_MAX_RENTAL_COST_USD = '9007199254740991'`: above `Number.MAX_SAFE_INTEGER` no integer-cent accounting stays exact, matching `accountUsd`'s `MAX_USD`; `src/core/estimator/recommend.ts:224` compares against it | `test/unit/estimatorRecommend.test.ts:610`: the bound is admitted with its exact evidence; one dollar more refuses `cost-overflow`                                                                         |
| Suspicious systemd path             | `src/runtime/schedules/effectiveDefinition.ts:55`: empty/blank manager listings refuse as `invalidResponse`, not `Unsafe schedule launcher path: ` with an empty path                                                                                    | `test/unit/nativeScheduleBackground.test.ts:308`: each environment shape refuses honestly (empty listing, relative root, failed query); new exact-path drop-in test runs on any posix host                 |

Suspicious-path finding: production never derives a launcher path from
`XDG_RUNTIME_DIR` (it only inherits the variable to the systemd children,
which interpret it themselves), so it cannot compute a bad join from the
unset/empty/relative/non-login shapes: an unreachable manager refuses as
`unavailable`, a malformed listing as `invalidResponse`, and only a path that
fails trust verification is named `unsafe`. The laptop's
`/home/randy/nd`-style refusal is the test's assumption that every reported
search root verifies cleanly: the native test now derives its expectation
through production's own `verifySystemdSearchDirectories` (same refusal on a
clean machine, the earlier root's honest refusal elsewhere), skips
non-absolute runtime directories, and the hermetic drop-in test pins the
exact writable-directory refusal deterministically. No Linux host was
reachable from this rig (no Docker daemon, no SSH), so the native case ran
only through the platform gate here; it needs one Linux run.

Red drills on a pristine `f411b64a4` worktree: exact-spend trigger drill
fails with `value: 0.1` (1 failed); bound-plus-one drill is admitted without
a throw (1 failed); empty-listing drill gives `Unsafe schedule launcher
path: ` instead of `invalidResponse` (1 failed); numeric collect fixture
fails all 3 usage tests. Drill files removed afterwards.

Fresh ordinary clone under `$TMPDIR` (`CI=true npm ci` exit 0, unchanged
lockfile). Gate batches below use repository timeouts, `--maxWorkers=3`, at
most three files per run.

| Gate batch       | Files                                                                      | Result              |
| ---------------- | -------------------------------------------------------------------------- | ------------------- |
| A                | paidMoneyPorts, paidPortBoundaries, estimatorRecommend                     | 73 passed           |
| B                | thresholds, accounts, collect.usage                                        | 54 passed           |
| C                | accountUsage, acpAccounts, nativeScheduleBackground                        | 87 passed           |
| D                | pool, accountsPanel, reportContracts                                       | 85 passed, 1 failed |
| E                | scheduleRegistration, scheduleBackground, collect.session                  | 19 passed           |
| F                | accountUsageText, accountStore, reportFixtures                             | 43 passed           |
| G                | accountsPanelHost, AccountsSection, accountsCommand                        | 48 passed           |
| H                | policyGate, remoteAccountPool, m95PlanUi                                   | 94 passed           |
| Five typechecks  | host, webview, unit, e2e, integration                                      | exit 0 each         |
| Scoped ESLint    | all 24 changed TS/TSX files, `--max-warnings=0`                            | exit 0              |
| Scoped Prettier  | all changed supported files                                                | exit 0              |
| Plain knip       | no strict/production switch                                                | exit 0              |
| Full jscpd       | the same two inherited clones (ACP agent, queued-answer/model-API fixture) | exit 1, unchanged   |
| `check:l10n`     | zero problems                                                              | exit 0              |
| `check:host-api` | record current                                                             | exit 0              |

Batch D's single failure is `pool.test.ts` 'refuses money precision loss
and negative settlements': it fails byte-identically on untouched
`f411b64a4` (same assertion, same counts), so it is inherited, not a
regression from this lane; left for the lead. No case is skipped or
filtered. Base counts for this lane's scope: the P2 assertion failed on base
(review receipt); the three new regressions above fail on base as drilled.

Commits (`rel017/ports2`, hooks `.husky/_` as installed, diffs reread after
each hook; prettier reformatted one producer line and one test file, no
logic change): `62e5728b8` P2, `1d3eb9c83` trigger port, `be33324e6`
estimator bound, `285e59935` schedule path. No merge, push, stash,
hook substitution, or dependency change. Fresh clones removed after final
verification.

## Exact money end to end, structural guard (PORTS017C)

Linux rig, `rel017/ports3` on this worktree, base `3e71dda14`, 2026-10-08.
Fake-only: no paid/live calls, credentials, dependencies, gate changes, merge
or push. Five commits, one per piece; every behavior fix has a regression
that fails on the base (drill receipts below); all runs use the repository's
own test timeout, `--maxWorkers=3`, at most three files per run.

### 1. Structural money guard

`test/unit/paidMoneyStructure.test.ts` (about 1 s) walks the actual zod
schemas and type declarations under `src/shared` and `src/core` instead of
matching declaration text. A money-named key (`[Uu]sd`, `Cost`, `Price`,
`Budget`, `Cap`, `^spend`) fails the test when its leaf type is a JavaScript
number, including numbers hidden behind local aliases (`coldCacheUsd:
amount`), `z.optional`/`nullable`/`record`/`union` wrappers, `z.number()`
inline, `type X = number`, and cross-file imports. Boundary schemas that
normalize legacy numbers once (`legacyUsdSchema`, `usdInputSchema`,
`usdAmountSchema`, `nonnegativeUsdSchema`, `z.codec` versioned readers such as
scheduleV2's `money`) are sanctioned, never numeric. The existing regex guard
is kept; a new numeric money field fails one of the two.

The reviewed allow-list holds 70 `file:key` entries, each with a one-line
reason: POOL017's `coldCacheUsd` (remove on merge); versioned pre-exact
journal reads (3); OpenRouter `/key` wire rows (9); persisted usage-journal
numeric rows (13); deferred team costs and view state (6); the M117
resource-governor demand quantity (1); captured catalog prices converted once
at their boundary (6); team price-preview rates and totals (11); token counts
(10); model thinking budgets in tokens (2); a character count (1);
millisecond durations (3); worker counts (2); integer vendor tick units (2).
Every entry must match at least one finding or the test fails as stale, so
converted fields cannot linger. Token counts, durations and worker counts
stay numeric by design; the money entries are flagged-but-deferred inventory
for follow-up lanes, visible instead of silent.

Known residual gap: per-million rate names without a money token
(`inputPerMillion`, `outputPerMillion`, `cachedPerMillion` in
`shared/modelsPanel.ts` and `shared/usagePage.ts`) match neither guard's
patterns. They are catalog display/comparison rates, listed here for a
follow-up lane rather than silently uncovered.

### 2. Findings mapped to fixes

| Review item                            | Fix (file:line)                                                                                                                                                            | Regression test                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| P2 caps read back exactly              | `src/core/usage/accountUsage.ts:165`: spend meters compare with exact `Usd`, carry the canonical threshold string; counts keep the narrowed `BigInt` path                  | `test/unit/accountUsage.test.ts`: updated nano-cap expectation plus a sub-nano cap/admission-parity case                                  |
| P2 ThresholdEditor unchanged cap saves | `ThresholdEditor.tsx:52`: edits validate with `usdInputSchema`, no nano or number round trip                                                                               | `test/unit/accountsPanel.test.tsx`: sub-nano caps save unchanged; `-1`/unsafe counts still refuse                                         |
| P2 notices show the exact trigger      | `src/core/usage/accountUsageText.ts:113`, `AccountNotices.tsx:64`: ceiling parse (floor removed); `src/acp/accounts.ts:146` already ceilings; rule commented at all three  | `test/unit/accountUsageText.test.ts`, `test/unit/accountsPanel.test.tsx`, `test/unit/acpAccounts.test.ts`: sub-nano cap renders `$0.1001` |
| P2 Linux scheduler fixture             | `test/unit/nativeScheduleBackground.test.ts:691`: owned 0700 trust anchor asserted before use; fixture verifier stops at the anchor                                        | Hermetic case reaches the writable `<id>.service.d` drop-in; 46/46 three times on this rig                                                |
| P3 assertion strength                  | Same file: drop-in refusal names `dropDirectory` directly, never derived; empty/relative `XDG_RUNTIME_DIR` assert `unavailable` through full `register` calls              | XDG loop runs on every platform gate; planting case needs a live user manager                                                             |
| P3 estimator rationale                 | `src/shared/constants.ts:6988`: bound matches `accountUsd`'s `MAX_USD`, the bigint nano-USD ceiling of `Number.MAX_SAFE_INTEGER` whole dollars; integer-cent claim dropped | `test/unit/estimatorRecommend.test.ts:610` (unchanged bound behavior)                                                                     |

Display rule (commented at all three notice sites): a shortened cap renders
with ceiling, never below the exact trigger, so an exact reach always shows
value >= cap. Reach state itself comes from the exact meter or trigger event,
never the shortened text.

Correction to the PORTS017B table above: the estimator row's "no
integer-cent accounting stays exact" rationale was the wrong story. The bound
is `Number.MAX_SAFE_INTEGER` whole dollars because that magnitude is exactly
what `accountUsd`'s `MAX_USD` refuses above, not because of float cents. The
comment now says so.

### 3. Sweep list (`toNanos`, `Number(...)`, `parseFloat`, `* 100` on `UsdAmount`)

No `toNanos` and no `parseFloat` exist under `src/`. Every remaining hit is
kept with its reason: `thresholds.ts:171` `Number(projected)` is a
fail-closed finiteness proxy on a canonical decimal (only >308-digit
overflow trips it); `core/usage/aggregate.ts:480` `Number(spentUsd)` feeds a
display-only burn-rate projection while the zero-guard stays exact;
`reportingAmount` is the documented projection into captured numeric report
rows (fail-closed on non-finite), consumed by the allow-listed numeric
`usageBudgetSchema` row in `paidDailyBudget.ts:324` whose comparisons stay
exact; `journalRecord.ts` pricing math lives inside the persisted numeric
journal format (deferred with its conversion); chart `* 100` geometry and
`LimitsSection` progress widths operate on allow-listed display rows, never
admission; all other `Number(...)` hits are counts, percents, token totals,
or parse internals (`accountUsd.ts:39` exponent bound); `usdNumber` keeps its
documented compatibility-only contract with three call sites (two percent
precision gates, one POOL017-owned).

### 4. Scheduler notes

The sandbox maps host-owned directories to uid 65534, so no walk-to-root
verifier can pass here; the hermetic anchor (asserted 0700/own-uid,
verifier stops at the anchor, default walk preserved elsewhere) is what
makes the case runnable on any machine without weakening production's rule.
Probed on this rig: `systemd-analyze --user unit-paths` prints compiled-in
paths with exit 0 under any `XDG_RUNTIME_DIR`, so the empty/relative refusal
happens at `daemon-reload` (exit 1, observed), which the XDG loop asserts as
`unavailable` through full `register` calls. No user manager exists here, so
the planting case returns at the availability gate after the XDG loop; it
needs one live Linux run to exercise the drop-in plant.

### 5. Red drills (all reverted afterwards)

- Added `drillBudgetUsd: z.number()` to `src/shared/accounts.ts`: the new
  guard fails naming `drillBudgetUsd` (1 failed).
- Dropped the `coldCacheUsd` allow-list entry: the guard flags
  `coldCacheUsd`, proving POOL017's field is covered (1 failed).
- Restored the nano floor in `readAccountUsage`: exactly the two exactness
  assertions fail (updated `'0.3000000009'` expectation, new sub-nano case).
- New tests on a pristine `3e71dda14` worktree (linked modules): the two
  `accountUsage` exactness cases plus the notice ceiling case fail (3
  failed); both ThresholdEditor sub-nano saves plus the panel notice fail
  (3 failed); the ACP ceiling case passes there by design (already
  ceiling); the new guard and scheduler files pass on base (test-side
  fixes; the old hermetic case is the one that failed on base per the
  review receipt).

Fresh ordinary clone under `$TMPDIR` (`CI=true npm ci` exit 0, unchanged
lockfile). Gate batches below use repository timeouts, `--maxWorkers=3`, at
most three files per run.

| Gate batch      | Files                                                                           | Result            |
| --------------- | ------------------------------------------------------------------------------- | ----------------- |
| A               | paidMoneyPorts, paidMoneyStructure, thresholds                                  | 54 passed         |
| B               | accounts, accountUsage, accountUsageText                                        | 47 passed         |
| C               | AccountsSection, accountsPanel, acpAccounts                                     | 61 passed         |
| D               | estimatorRecommend                                                              | 29 passed         |
| E               | nativeScheduleBackground (three consecutive runs)                               | 46 passed each    |
| Five typechecks | host, webview, unit, e2e, integration                                           | exit 0 each       |
| Scoped ESLint   | all 12 changed TS/TSX files, `--max-warnings=0`                                 | exit 0            |
| Scoped Prettier | all changed supported files (`--check`)                                         | exit 0            |
| Plain knip      | no strict/production switch                                                     | exit 0            |
| Full jscpd      | the same two inherited base clones (ACP agent, queued-answer/model-API fixture) | exit 1, unchanged |
| `check:l10n`    | zero problems                                                                   | exit 0            |

jscpd exit 1 matches pristine `3e71dda14` byte-for-byte (same two clones);
this lane's earlier draft added three pairs and they were removed (shared
quote tracker, reshaped fixture). No case is skipped or filtered.

Commits (`rel017/ports3`, hooks `.husky/_` as installed, diffs reread after
each hook): `1f565225c` structural guard, `aab57cd08` exact caps end to end,
`543a343f2` scheduler tests, `d87440551` threshold narrowing plus estimator
rationale, `95c0d0226` guard dedup. No merge, push, stash, hook substitution,
or dependency change. Fresh clones removed after final verification.

## Pool (POOL017)

Mac rig, `rel017/pool` on this worktree, base `3e71dda14`, 2026-10-08.
Fake-only: no paid/live calls, credentials, dependencies, gate changes, merge
or push. One product commit plus this record; hooks `.husky/_` as installed,
diffs reread after each hook run.

**Cause.** `pool.test.ts` 'refuses money precision loss and negative
settlements' failed at `expect(t.claims).toHaveLength(0)` (1 claim, still
rejecting). Before the exact-money port, `projected()` forced the estimate
through a JS number (`numericUsd`), so the crafted
`9007199254740990.000000001` estimate lost one nano as a double and was
refused pre-reserve. PORTS017 (PLAN.md:19631, "Carry exact amounts through
… account totals …; use exact comparisons and sums") retired that boundary:
`pool.ts` projects nano totals to canonical strings without a numeric round
trip, so the crafted value is exactly representable — it now reserves, then
refuses honestly at the shared cap with a full refund (`settle(0, false)`).
The negative settlement (`actualUsd: -1n`) was and is refused with
`invalidAccount`, retaining uncertain liability (`null`, never released).
The last plain-number money in the pool path was the swap event's
`coldCacheUsd` (schema `z.number()`, written via `numericUsd`).

**Fix (file:line).** `src/shared/accounts.ts:12`: swap `coldCacheUsd`
carries `UsdAmount` via `legacyUsdSchema` (numeric persisted rows normalize
once on read), the same port the spend caps/triggers took; the now-unused
numeric `amount` alias is removed. `src/core/accounts/pool.ts:424`: the swap
row writes `usdDecimal(admitted.coldCacheUsd)`; `numericUsd` and the
`usdNumber` import are deleted, so no `Number()` remains on any pool money
path. Settlement and refund amounts (`settle(actualUsd: Usd | null, …)`)
were already exact and needed no conversion. Event readers
(`accountUsageText`, `AccountNotices`, ACP accounts, `runExec`) already
parse with `parseUsd`, which accepts the canonical strings unchanged.

| Test / helper port                   | Change                                                                                                                                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/unit/pool.test.ts:139,297`     | Swap-row expectations are the canonical strings `'0.02'` / `'0.2'`                                                                                                                                                          |
| `test/unit/pool.test.ts:414`         | Stale path updated, both refusals kept: the huge exact estimate still rejects (now at the shared cap, the honest path) with 1 claim refunded to `0`; the negative settlement still rejects with liability retained (`null`) |
| `test/unit/pool.test.ts:305`         | New regression: a `9007199254740990.000000001` cold-cache estimate swaps with the exact string in the row and in the reservation                                                                                            |
| `test/unit/paidMoneyPorts.test.ts:7` | `core/accounts/pool.ts` joins the numeric-port inventory (`shared/accounts.ts` was already listed)                                                                                                                          |
| `test/unit/accounts.test.ts:145`     | Swap fixture is canonical `'0.01'` plus a numeric-read normalization assertion; `-1` still refused                                                                                                                          |
| Helpers / panel fixtures             | `usage.ts`, `runtimeAccounts.ts`, `accountsPanel.test.tsx` build swap rows with `usdInputSchema.parse(…)`                                                                                                                   |

**Drill.** The updated `pool.test.ts` on a pristine `3e71dda14` clone:
**3 failed / 24 passed** — the two string expectations (number vs string)
and the new above-double-precision regression, which fails with the base
`numericUsd` refusal (`pool.ts:111`, `sessionBudgetStoreUnavailable`). The
updated cap-path refusal passes on both trees, confirming it is a stale-path
update, not a product change. Drill file removed afterwards (clone deleted).

Fresh ordinary clones under `$TMPDIR` (`CI=true npm ci` exit 0, unchanged
lockfile). Gate batches below use repository timeouts, `--maxWorkers=3`, at
most three files per run.

| Gate batch      | Files                                                                         | Result                                                                                                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A               | pool, paidMoneyPorts, paidPortBoundaries                                      | 72 passed                                                                                                                                                                                                                                 |
| B               | thresholds, accounts, accountUsage                                            | 65 passed                                                                                                                                                                                                                                 |
| C               | accountUsageText, accountStore, acpAccounts                                   | 64 passed                                                                                                                                                                                                                                 |
| D               | accountsPanel, accountsPanelHost, AccountsSection                             | 51 passed                                                                                                                                                                                                                                 |
| E               | remoteAccountPool, policyGate, accountFakes                                   | 73 passed                                                                                                                                                                                                                                 |
| F               | accountHomes, accountHost, accountPaidConsent                                 | 83 passed                                                                                                                                                                                                                                 |
| G               | accountPolicy, accountSecrets, accountUsd                                     | 89 passed                                                                                                                                                                                                                                 |
| H               | accountsCommand                                                               | passed; `accountUsageBundle` 1 failed (identical on pristine base: inherited static-graph failure, cf. MONEY017B); `accountsPanel.a11y` hook `EPERM` on loopback listen (identical on pristine base: sandbox networking, no local server) |
| Five typechecks | host, webview, unit, e2e, integration                                         | exit 0 each (`npm run typecheck` exit 0)                                                                                                                                                                                                  |
| Scoped ESLint   | all 8 changed TS/TSX files, `--max-warnings=0`                                | exit 0                                                                                                                                                                                                                                    |
| Scoped Prettier | all changed supported files                                                   | exit 0                                                                                                                                                                                                                                    |
| Plain knip      | no strict/production switch                                                   | exit 0                                                                                                                                                                                                                                    |
| Full jscpd      | exactly the two inherited clones (ACP agent, queued-answer/model-API fixture) | exit 1, unchanged                                                                                                                                                                                                                         |
| `check:l10n`    | zero problems                                                                 | exit 0                                                                                                                                                                                                                                    |

Commits (`rel017/pool`, hooks `.husky/_` as installed, committed diff
reread after the hook; the hook reformatted one import, no logic change):
`4c0ca3dac` product, tests and port-list; this record follows. No merge,
push, stash, hook substitution, or dependency change. Fresh clones removed
after final verification.

## Honest money guard, exact totals, pool merge (PORTS017D)

Linux rig, `rel017/ports4` on this worktree, base `ad612c82e`, 2026-10-08.
Fake-only: no paid/live calls, credentials, dependencies, gate changes, push,
rebase or stash. All runs use the repository's own test timeout,
`--maxWorkers=3`, at most three files per run.

### 0. Step 0 merge

`git merge --no-ff rel017/pool` (`6a88043b1`): the only conflict was the two
appended certification sections; both are kept. Merge repairs: the two new
notice fixtures with numeric `coldCacheUsd: 0`
(`test/unit/accountsPanel.test.tsx:383`,
`test/unit/acpAccounts.test.ts:194`) now use the canonical
`usdInputSchema.parse('0')`, and the stale
`shared/accounts.ts:coldCacheUsd` allow-list entry is removed. Commit
`1bd6b323f` (hooks `.husky/_` as installed; staged and committed diffs
reread, no logic rewrite by the hook).

### 1. P2 A1: exact totals (`src/core/usage/accountUsage.ts`)

`totalsFor` accumulated spend through nano-USD `parseUsd` (ceiling), so cap
`'0.1000000005'` with `'0.1000000001'` spent (and cap
`'0.1000000000000000002'` with `'0.1000000000000000001'` spent) reported
`isReached: true` and "Threshold reached" while admission
(`evaluateAccountThresholds`, already exact) returned `[]`. `totalsFor` now
accumulates with exact `Usd` decimals and emits canonical strings; the meter
comparison is unchanged and now always equals admission. Commit `4a348c5d4`.
Regression: `accountUsage.test.ts` (meter `isReached: false`, progress < 100,
admission `[]` for both pairs) and `accountUsageText.test.ts` (text never
contains "Threshold reached"). Red drill: restoring `ad612c82e`'s
`totalsFor` fails exactly the 2 new tests (22 passed / 2 failed); the fix
restores green (byte-identical restore verified by `diff`).

### 2. P3 A2: runtime structural guard (`test/unit/paidMoneyStructure.test.ts`)

The source-text scanner is replaced by a runtime walk of the actual zod
schemas: every module under `src/shared` and `src/core` (767 files) loads
through vitest's normal module loading (collection-time eager
`import.meta.glob`; sequential dynamic import did not fit the 5 s test
timeout), every exported schema is visited once, and `_zod.def` is walked
recursively (objects, records, arrays, tuples, unions, optional/nullable/
default/catch wrappers, quoted keys, lazy schemas, cross-file imports as the
same object). Pipes are judged by their OUTPUT schema, so
`legacyUsdSchema`-shaped boundaries (numeric in, canonical string out) stay
clean; a bare transform is probed for what it parses to, and an undeclared
transform output on a money-named key is a finding. Findings attribute to the
module that declares the key (re-exported and spread-copied shapes are
re-attributed by source declaration after a fixpoint reachability pass). The
text scan is kept for plain TypeScript declarations only. New coverage the
old guard demonstrably missed: snake_case keys (its pre-filter required
capital `Usd`), semicolon-joined members, and numeric pipes/transforms/
defaults/imported aliases/quoted keys/records.

Bypass drills (fixture schemas in the test, never edits to `src`; each fails
when injected, all 6 also fail together when appended to `src/shared/paid.ts`
and pass again after byte-exact restore): numeric pipe alias, numeric
transform alias, `z._default(amount, 0)`, imported/re-exported numeric schema
in a local optional, quoted money key, `Record<string, number>`. Commit
`320bd9d85` (plus a `vite/client` types entry in `test/unit/tsconfig.json`
for `import.meta.glob`, and two tiny re-export fixtures under
`test/unit/helpers/`).

### 3. P3 A3: honest allow-list (18 nonMoney, 19 sanctioned, 41 trackedDebt)

The guard checks each entry's category: a money leaf not in the list fails;
a stale entry fails; a `trackedDebt` entry without M121 fails; a
`sanctioned` entry without a `PLAN.md:<line>` citation fails; a `nonMoney`
entry that matches the money pattern or stops existing as a numeric
declaration fails. The 18 `nonMoney` entries are the reviewer's genuine
counts/durations/character-limits/token quantities with reasons. The 19
`sanctioned` entries are the M95 pricing compatibility port rates
(`usdPerMTok*`, `input/outputUsdPerMTokens`, `cachedUsdPerMTok`,
`usdPerHour*`, `hourlyUsd`, per-hour `accountUsdPerHour`; PLAN.md:17272,
PLAN.md:27519) and vendor wire fields carried as sent with their exact-money
conversion sites (`cost_in_usd_ticks` at responses.ts:361, `costInUsdTicks`
at journalRecord.ts:164, modelPolicy/priceCard tick inputs at
priceCard.ts:254; PLAN.md:4230). The 41 `trackedDebt` entries are every
remaining current numeric money field the new guard sees that the old one
missed or mislabeled (usage journal/page, `usage.ts`, models panel including
its team-shape spread-copies, `accountUsage` internals, aggregate, team and
team view costs and budgets, schedule v2 caps/liabilities, the
codec-normalized provider cost, preview totals), each naming M121. This
record does not claim "no numeric money anywhere": the `trackedDebt`
category is that inventory, and PLAN §8 registers it against M121.

### 4. M121

PLAN.md gains milestone M121, "Exact money everywhere (current money
ports)" (lead decision 2026-10-08): convert every `trackedDebt` field to
`UsdAmount` with versioned persisted reads, UI/text formatting, and the guard
emptying the category; ordered right after 0.17.0, complete before M110/M111
resume. Commit `27628bab3` (milestone plus the §8 escape-hatch row;
`check:plan` 0 drift).

Fresh ordinary clone under `$TMPDIR` (`CI=true npm ci`, unchanged lockfile).
Gate batches below use repository timeouts, `--maxWorkers=3`, at most three
files per run.

| Gate batch      | Files                                                       | Result                                                                                                   |
| --------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1               | paidMoneyStructure, paidMoneyPorts, thresholds              | 62 passed                                                                                                |
| 2               | accountUsage, accountUsageText, AccountsSection             | 29 passed                                                                                                |
| 3               | accountsPanel, acpAccounts, pool                            | 83 passed                                                                                                |
| 4               | estimatorRecommend, accounts                                | 54 passed                                                                                                |
| Five typechecks | host, webview, unit, e2e, integration (`npm run typecheck`) | exit 0                                                                                                   |
| Scoped ESLint   | all 15 changed TS/TSX files, `--max-warnings=0`             | exit 0                                                                                                   |
| Scoped Prettier | all changed supported files incl. PLAN.md                   | exit 0                                                                                                   |
| Plain knip      | no strict/production switch                                 | exit 0 (2 configuration hints, pre-existing)                                                             |
| Full jscpd      | whole tree                                                  | exit 1: exactly the 2 inherited clones (ACP agent, queued-answer/model-API fixture), none from this lane |
| `check:l10n`    | 14 UI + 14 usage tables, 250 manifest strings               | exit 0, 0 problems                                                                                       |
| `check:plan`    | 198 milestones                                              | exit 0, 0 drift                                                                                          |

No sandbox refusal was counted as a pass; nothing was blocked. Fresh clone
removed after final verification.

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
touching `src/core/paid/paidConsent.ts (account binding)`), and lane P is
merged (tip `76c1231e8`, merge `d3a6bfaea`). The deferral is PLAN §9
(FIXM108P-PROFILE-OWNER): installed composition waits on the shared
profile/broker owner and multi-window certification, and the P-PAID-ACCOUNT
handoff (`docs/certification/m108.md`) blocks installed account-aware paid
dispatch on the registry, pool and journal owners. So account-bound consent stays
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

## Paid consent (CONSENT017C)

Linux rig, `rel017/consent3`, base `8e72daf24` (CONSENT017B tip).
Redesign, not a patch, per the owner's rule: an account's grant authority
is bound to a durable revocation epoch
(`src/core/paid/paidConsent.ts`, `AccountPaidUseConsentDeps` epoch ports,
`AccountBindingGrants`, `quoteGrantEpoch`, `durableEpoch`, `revoke()`).

Design: the epoch is persisted per account binding in the same store as
the grants, never as a memory-only counter. `revoke()` advances it durably
first inside the owner queue, then clears the binding and quote grants. A
failed clear leaves leftovers that are stale on every instance after a
restart; a failed advance rejects honestly with nothing cleared and the
grants still working. Every persisted grant records its approval epoch
(binding grants carry it; quote grants carry it in their generation), and
a lookup reuses a grant only when its epoch equals the current durable
epoch with tariff, model and quote generation matching as before. Saves
re-check the epoch after their write, so a concurrent ask on another
instance sharing the store cannot resurrect a revoked grant. The
instance-local generation remains only for fencing in-flight asks inside
one instance.

P3 fixes: the Help caveat "Paid consent stays per workspace for now."
(`src/shared/l10n/en.ts:432`) now exists in all 14 UI tables, translated
with each table's own workspace wording and verified through the real
`createReference(...).all()` for every language (throwaway probe,
1 passed, removed afterwards). The deferral text above is corrected: lane
P is merged (tip `76c1231e8`, merge `d3a6bfaea`); the real deferral is
PLAN §9 (FIXM108P-PROFILE-OWNER) plus the P-PAID-ACCOUNT handoff's block
on the registry, pool and journal owners.

### Tests

`test/unit/accountPaidConsent.test.ts` (24 tests: 19 kept, 5 new). New,
through the in-memory store with simulated restarts: revoke, approve
Always, restart reuses both grants with no new ask; binding-deletion and
quote-deletion failures each reject, then a restart asks and Deny is
honoured for both; a failed epoch advance rejects with the grants still
working on both instances; a concurrent ask on one instance cannot
resurrect another instance's revoked grant. No retained assertion was
weakened; the rig now backs the epoch ports in the same shared store.

Red drills (default timeouts, `--maxWorkers=3`, byte-exact restore
verified by SHA-256 `dedb1f62…7bc6fba9` before and after): (A)
instance-local epoch (composition and save check read the local
generation) — 4 failed / 20 passed (the three restart tests plus the
concurrent test); (B) clearing before advancing the epoch — 4 failed /
20 passed (both failed-clear restart tests, the epoch-honesty test and
the kept failed-deletion test). After revert: 24 passed. The new-port
tests cannot run on `8e72daf24` (the ports do not exist there); the
reviewer's report already demonstrates the successful-clear and both
failed-clear scenarios failing on that base with the lane's store.

### Gates (this worktree, `CI=true` where applicable)

| Gate                                                 | Exit   | Receipt                                                    |
| ---------------------------------------------------- | ------ | ---------------------------------------------------------- |
| `accountPaidConsent`                                 | 0      | 24 passed                                                  |
| `paidConsent`, `paidAuthority`                       | 0      | 52 passed                                                  |
| `paidDailyBudget`, `paidHookModels`, `paidHost`      | 0      | 87 passed                                                  |
| `paidMoneyPorts`, `paidPortBoundaries`, `acpPaid`    | 0      | 73 passed                                                  |
| `paidFeatures`, `schedulePaid`                       | 0      | 52 passed                                                  |
| `accountUsd`, `accountHomes`, `accountFakes`         | 0      | 64 passed                                                  |
| `accountHost`, `accountPolicy`, `accountSecrets`     | 0      | 98 passed                                                  |
| `accountStore`, `accountUsage`, `accountUsageText`   | 0      | 51 passed                                                  |
| `accounts`, `accountsCommand`, `accountsPanelHost`   | 0      | 67 passed                                                  |
| Five typechecks                                      | 0 each | host, webview, unit, e2e, integration                      |
| eslint `--max-warnings=0`, prettier on changed files | 0      |                                                            |
| Plain knip                                           | 0      | configuration hints only                                   |
| Full jscpd                                           | 1      | exactly the two inherited clones, zero threshold unchanged |
| `check:l10n`                                         | 0      | zero problems                                              |
| `check:reference`                                    | 0      | current                                                    |

No `--testTimeout` on any verification run. At most 3 test files per run
with `--maxWorkers=3`. Every gate above also ran in a fresh clone under
`$TMPDIR` (`npm ci`, `CI=true`) with identical receipts; the clone was
removed afterwards.

## Paid consent (CONSENT017D)

Linux rig, `rel017/consent4`, base `c7566e09b` (CONSENT017C tip). Final
round per RVCONSENT017C: the **store port gives atomic operations**, so
wiring `AccountPaidUseConsent` later is safe. `AccountPaidUseConsentDeps`
(`src/core/paid/paidConsent.ts:860`) now declares `advanceEpoch(binding,
expected)` (`:887`: compare-and-set to `expected + 1`, else
`StaleEpochError`), `saveGrantIf(binding, epoch, grants)` (`:896`) and
`saveQuoteGrantIf(binding, epoch, grant)` (`:921`), each with a JSDoc
contract requiring the future production store to serialize them per
binding (with the clears). Conflict failures throw exactly
`StaleEpochError` (`:853`); any other failure keeps the previous behaviour
(Allow once, honest revoke error). Consent code never reads-then-writes an
epoch.

- P2 #1 (`paidConsent.ts`, ask capture and final fence). The ask wrapper
  captures the durable epoch before each popup into `askEpochs` (`:987`,
  `:1134`); `rememberGrant` saves binding features under that epoch
  (`:1117`) and every quote save uses the epoch its generation carries
  (`:1068`). If the conditional save fails on a meanwhile revocation,
  nothing is stored, and `allows()` fences the final decision against the
  captured epoch (`:1158`), so no Allow-once downgrade approves after a
  revocation.
- P2 #2 (`:1167`). `revoke()` advances with `advanceEpoch` and retries only
  by re-reading, so concurrent revokes produce strictly increasing epochs
  and a delayed writer can never move the epoch backwards or republish an
  older value. Its clear uses `saveGrantIf` under the new epoch; a
  concurrent newer revoke owns the grants then. A failed clear still leaves
  every older grant invalid.
- P2 #3 (`:943`, `src/shared/constants.ts:114`). Durable quote generations
  use `{ v: 2, epoch, hostGeneration }` (`ACCOUNT_QUOTE_GRANT_VERSION`);
  `quoteGrantEpoch` accepts only that schema, so old `[counter,
hostGeneration]` grants are refused as stale and asked again, and can
  never match a durable epoch.
- P3 (`test/unit/accountPaidConsent.test.ts:498`). The successful-clear
  restart scenario approves on the same instance that revoked
  (`approveSearchAndVoice(t, request, a)`).

### Tests

`test/unit/accountPaidConsent.test.ts` (28 tests: 23 kept, 1 fixed, 4
new), all through the shared in-memory store with atomic check-and-write
(no await between check and set) and simulated restarts. New: the held
voice answer refused with nothing approved stored; the held voice write
refused with nothing approved stored (covers the Allow-once downgrade);
concurrent revokes with a delayed writer ending at epoch 2 with a restart
asking and Deny honoured; the legacy-generation upgrade refused and asked
again. Redundant race tails share `heldAnswerRevoked` and
`expectRaceStoredNothing`, so jscpd reports only its two inherited clones.

Red drills (default timeouts, `--maxWorkers=3`, reverted byte-exact via
`git checkout`, tree verified clean and green after each): (A)
read-then-write epoch (`rememberGrant` re-reads at save) — 1 failed / 27
passed (the held-answer test); (B) no final-epoch fence — 2 failed / 26
passed (both non-search race tests, proving the downgrade guard); (C)
legacy array encoding restored — 1 failed / 27 passed (the legacy test
only); (D) instance-local epoch (`durableEpoch()` returns
`this.generation`) against the final test source — 6 failed / 22 passed,
including the fixed same-instance restart test.

### Gates (fresh clone under `$TMPDIR`, `npm ci`, `CI=true`)

| Gate                                                 | Exit   | Receipt                                                                                                                                           |
| ---------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accountPaidConsent`                                 | 0      | 28 passed                                                                                                                                         |
| `paidConsent`, `paidAuthority`                       | 0      | 52 passed                                                                                                                                         |
| `paidDailyBudget`, `paidHookModels`, `paidHost`      | 0      | 87 passed                                                                                                                                         |
| `paidMoneyPorts`, `paidPortBoundaries`, `acpPaid`    | 0      | 73 passed                                                                                                                                         |
| `paidFeatures`, `schedulePaid`, `accountUsd`         | 0      | 62 passed                                                                                                                                         |
| `accountHomes`, `accountFakes`, `accountHost`        | 0      | 73 passed                                                                                                                                         |
| `accountPolicy`, `accountSecrets`, `accountStore`    | 0      | 110 passed                                                                                                                                        |
| `accountUsage`, `accountUsageText`, `accounts`       | 0      | 44 passed                                                                                                                                         |
| `accountsCommand`, `accountsPanelHost`               | 0      | 43 passed                                                                                                                                         |
| `accountsPanel`, `accountsPanel.a11y`                | 0      | 26 passed, 34 skipped (Chrome launches, axe cases skip: no usable browser on this rig)                                                            |
| `accountUsageBundle`                                 | 1      | 1 failed, the inherited `src/shared/usd.ts` static-graph case; fails identically on base `c7566e09b` in the same clone, so unrelated to this lane |
| Five typechecks                                      | 0 each | host, webview, unit, e2e, integration                                                                                                             |
| eslint `--max-warnings=0`, prettier on changed files | 0      |                                                                                                                                                   |
| Plain knip                                           | 0      | configuration hints only                                                                                                                          |
| Full jscpd                                           | 1      | exactly the two inherited clones, zero threshold unchanged                                                                                        |
| `check:l10n`                                         | 0      | zero problems                                                                                                                                     |

No `--testTimeout` was used on any run. At most 3 test files per run with
`--maxWorkers=3`. The worktree shows identical receipts; the clone was
removed afterwards. No `check:reference` change (no reference surface
touched). The store-port contract was added to PLAN §9's lane P
prerequisites (FIXM108P-PROFILE-OWNER).

## Bundle regressions after the lane merges (INT0170)

Release-integration lane on `release/0.17.0` (worktree `mx-rel0170`), from
`01ee6233b`, 2026-10-08. All builds ran on Kubuntu in a `rig-test.sh` slot
with real `node_modules`: `node scripts/build.mjs --production`, then the
esbuild metafiles in `dist/meta` and `dist/meta-acp`. No model calls were
made, hooks ran on every commit and nothing was pushed. No cap was raised.
The one pin that moved is recorded under the CAPS017 Model API pin above,
by the lead's decision.

### Bisect (first-parent merges, production bytes)

| Commit                    | `extension.js` | `navigator` | `headless.js` | `modelApi.js` |
| ------------------------- | -------------- | ----------- | ------------- | ------------- |
| `7a4fc2ab3` base          | 585,037        | 0           | 103,142       | 531,787       |
| `d50b709bf` vis           | 587,451        | 0           | 103,142       | 531,787       |
| `b44a98ddb` red           | 587,451        | 0           | 103,142       | 531,787       |
| `69723c603` devid (CAPS)  | 572,199        | 0           | 101,083       | 527,377       |
| `851c99497` money         | 572,309        | 0           | 101,083       | 529,921       |
| `632f79910` ports         | 572,485        | 0           | 101,843       | 530,680       |
| `fa15b6b44` consent       | **1,026,792**  | **2**       | 101,843       | 530,680       |
| `5b7eb4fcb` chip          | 1,030,876      | 2           | 101,843       | 530,680       |
| `afc978b72` win-path      | 1,033,339      | 2           | **113,255**   | 532,391       |
| `b2affa501` … `01ee6233b` | 1,033,339      | 2           | 113,255       | 532,391       |

Caps: activation 614,400 B, headless 102,400 B, Model API pin 527,400 B (D6
cap 537,600 B). The deferredBundles fixture build measured activation at
753.7 KiB because it adds `englishZodLocales`; the shipped build is
1,009.1 KiB. teamHarness #23 read that shipped production `extension.js`.

### Root causes and module chains

1. **Activation and `navigator` (`fa15b6b44`, CONSENT017).**
   `src/core/paid/paidConsent.ts` imported classic `zod` for its durable
   quote generation schema. The chain was `src/extension.ts` →
   `src/host/paid/paidHost.ts` → `src/core/paid/paidConsent.ts` → `zod`,
   which brought in 95 modules (453,762 B), all 63 locales among them.
   `zod/v4/core/util.js`'s `allowsEval` reads `navigator` twice. The
   existing guard (`inlines the shared mini-parser`) checked only zod/mini's
   own files.
2. **Headless (`afc978b72`, SECWINPATH).** `windowsPathSpelling.ts` and
   `workspacePath.ts` read their seven refusals from `MODEL_TEXT`, and every
   bundle that reads one key of `MODEL_TEXT` carries all of it. The chain
   was `src/runtime/exec/runExec.ts` → `src/runtime/exec/attachArgs.ts` →
   `src/core/workspacePath.ts` → `src/core/windowsPathSpelling.ts` →
   `MODEL_TEXT` (+10,663 B). The same leak added 7 to 13 KB to twelve lazy
   bundles that had never carried `MODEL_TEXT`. They stayed under their caps:
   agentImport, checkpointStore, codeIntel, conversationGit, extensionHooks,
   foreignHooks, hookRuntime, modelApiHooks, prompts, reporting, sessionBoard
   and sharingRuntime. Each also carried its own copy of the module's 814 B.
3. **Model API pin.** PORTS017 (`632f79910`) split `src/shared/usdSchema.ts`
   out of `usd.ts`, which re-exports it from `dist/modelApiBoundaries.js`.
   The plugin's list named only `usd.ts`, so thirteen bundles that already
   load the shared file kept their own copy of about 580 B. The rest of the
   growth is feature code: see the pin table above.

### Fixes (commits)

| Commit      | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `69b0e152b` | `paidConsent.ts` reads `zod/mini` (served by `dist/validation.js`). Split guard: a Node bundle that reads zod/mini carries no classic zod (structuredSchema.js and the ACP engine are exempt by design), and the importing sources are named.                                                                                                                                                                                                                                                        |
| `b706a89e8` | `WINDOWS_PATH_MODEL_TEXT` block, read only by `windowsPathSpelling.ts`. `unprovenUncPathReason` takes `workspacePath.ts`'s one read. `windowsPathSpelling.ts` is shared through `dist/modelApiBoundaries.js`, like `pathIdentity.ts`. Split guards: the block lives in modelApiBoundaries.js and reporting.js only (the report engine is built without the plugin); `dist/headless.js` carries no `MODEL_TEXT`, and the sources that read it are named. deferredBundles pins the share for headless. |
| `c1ee73965` | `usdSchema.ts` is shared through `dist/modelApiBoundaries.js`. `MODEL_API_BOUNDARY_SOURCES` is now the plugin's one list. Split guard: a bundle that loads modelApiBoundaries.js carries no copy of those sources. RVM115U5 pin → measured 530,883 B.                                                                                                                                                                                                                                                |
| `0a38d850e` | `usdSchema.ts` and `windowsPathSpelling.ts` are also pinned in the split check itself, so dropping either from the plugin's list fails.                                                                                                                                                                                                                                                                                                                                                              |

### Sizes before and after (Kubuntu production build, bytes)

| Bundle                       | `01ee6233b` | After `0a38d850e` | Cap / pin                |
| ---------------------------- | ----------- | ----------------- | ------------------------ |
| `dist/extension.js`          | 1,033,339   | 578,192           | 614,400                  |
| `navigator` in Node          | 2           | 0                 | 0                        |
| `dist/headless.js`           | 113,255     | 101,342           | 102,400                  |
| `dist/modelApi.js`           | 532,391     | 530,883           | pin 530,883 (D6 537,600) |
| `dist/modelApiBoundaries.js` | 31,054      | 33,013            | 51,200                   |

The `MODEL_TEXT` leak, before the lane merges (`5b7eb4fcb`) → `01ee6233b` →
after: agentImport 128,950 → 140,348 → 128,985; checkpointStore 85,312 →
97,359 → 85,740; codeIntel 42,858 → 54,252 → 42,890; conversationGit 85,874
→ 97,331 → 85,973; extensionHooks 36,552 → 43,886 → 36,664; foreignHooks
74,384 → 81,373 → 74,421; hookRuntime 43,976 → 50,957 → 44,007;
modelApiHooks 29,867 → 37,160 → 29,899; prompts 165,689 → 177,089 →
165,724; reporting 146,899 → 160,001 → 149,814; sessionBoard 46,962 →
54,299 → 47,074; sharingRuntime 172,697 → 174,842 → 163,477.

The `usdSchema.ts` share (before → after, bytes): acp.js 235,662 → 235,098;
headless.js 101,878 → 101,342; modelApi.js 531,418 → 530,883; providers.js
138,478 → 137,938; runtimeAccounts.js 51,213 → 50,684; runtimeEngine.js
640,317 → 639,782; scheduleBackground.js 39,197 → 38,810; schedules.js
158,170 → 157,745; teamRunners.js 65,394 → 64,862; usageCompanion.js 43,260
→ 42,730; usagePanel.js 74,586 → 74,051; usageService.js 90,522 → 89,980;
wire.js 71,888 → 71,352. modelApiBoundaries.js already carried it and is
unchanged at 33,013. No bundle without the plugin changes, because none of
them loads the shared file.

### Red drills (Kubuntu; each break was restored, verified byte-exact against the fixed commit)

| Drill                                                                 | Result                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1: fixed split check on `fa15b6b44`'s build                          | exit 1: `dist/extension.js carries classic zod (95 modules), imported by src/core/paid/paidConsent.ts`, plus 13 `own copy of src/shared/usdSchema.ts`                                                                                                           |
| H2: the same on `5b7eb4fcb`                                           | exit 1: the same classic zod problem, plus 13 usdSchema copies                                                                                                                                                                                                  |
| H3: the same on `afc978b72`                                           | exit 1: `dist/headless.js carries MODEL_TEXT whole, read by src/core/windowsPathSpelling.ts, src/core/workspacePath.ts`, classic zod, 35 own copies (windowsPathSpelling.ts and usdSchema.ts)                                                                   |
| D1: `import { z } from 'zod'` back in `paidConsent.ts`                | size exit 1 (`OVER dist/extension.js: 1008.2 KiB`), split exit 1 (classic zod, naming paidConsent.ts), host globals exit 1 (`2 reference(s) to navigator`)                                                                                                      |
| D2: `windowsPathSpelling.ts` dropped from the share (list and filter) | size exit 1 (`OVER dist/headless.js: 100.1 KiB`), split exit 1 (58 problems: the block and an own copy in every bundle that inlined the module), deferredBundles 3 failed (the share test, RVM115U5 532,015 > 530,883, the legal scanner cap drill's green run) |
| D3: `usdSchema.ts` dropped from the share (list and filter)           | split exit 1 (13 × `loads dist/modelApiBoundaries.js and still carries its own copy of src/shared/usdSchema.ts`), deferredBundles 1 failed (RVM115U5 531,418 > 530,883)                                                                                         |
| Restored tree                                                         | build, size, split, host globals: exit 0                                                                                                                                                                                                                        |

### Suites and gates (Part 1 head `0a38d850e`)

| Gate / suite                                                                             | Exit | Receipt                                                                     |
| ---------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------- |
| `deferredBundles`, `secWinIdentity2` (Kubuntu, default timeouts)                         | 0    | 124 passed, 6 skipped (in secWinIdentity2)                                  |
| `teamHarness`, `webviewBundle`, `webviewBundles` (Kubuntu, after the production build)   | 1    | 105 passed, 2 failed; teamHarness #23 passes                                |
| check-tokens, `build.mjs --production`, bundle size, bundle split, host globals, notices | 0    | 92 third-party notices                                                      |
| plain knip                                                                               | 0    | configuration hints only                                                    |
| cycles                                                                                   | 0    | 3,072 modules, no cycle                                                     |
| jscpd                                                                                    | 0    | 0 clones                                                                    |
| `check:l10n`, `check:reference`, `check:plan`, `check:host-api`                          | 0    | 0 problems; reference current; 206 milestones, 0 drift; 0 host API problems |

The two `webviewBundle.test.mjs` failures are browser startup, not the Node
bundles. They are the ones this record already lists as failing at
`7a4fc2ab3`:

- `loads exact USD arithmetic and display only with lazy media pricing`:
  `usd.ts` is in chat startup.
- `keeps FIXDIET1 startup …`: 769,138 > 751,411 B.

`rel017/startup2` owns both.
