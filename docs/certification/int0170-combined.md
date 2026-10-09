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

## Startup (STARTUP017)

Lane `rel017/startup` (`94eefd28e`), macbook rig worktree. The owner's rule
stands: the ratchet is met by shrinking, not by moving the number, so the
751,411 B ratchet and both `webviewBundle` assertions are unedited.

### Before and after (rig `npm run build` / `node scripts/build.mjs --production`, bytes)

| Chat startup (`dist/webview/main.js` + static imports) | Bytes     |
| ------------------------------------------------------ | --------- |
| 0.16.0 (`4da4ef666`, same rig)                         | 749,987   |
| 0.17 candidate (brief)                                 | 766,223   |
| Lane base, rig build                                   | 766,296   |
| After this lane, rig build                             | 760,051   |
| Ratchet (0.16.0 baseline)                              | 751,411   |
| **Remainder over ratchet**                             | **8,640** |

(The `webviewBundle` fixture build measures 760,149 B against 751,411.2 B:
over by 8,738 B. Saved 6,147 B of the 14,885 B gap.)

### What 0.17 added (metafile startup-input diff, 0.16.0 → lane base)

| Module(s)                                                                                  | +Bytes | First paint?                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/l10n/en.ts` (new strings)                                                      | 8,951  | yes: per-key split already ships only referenced keys; lazy-only values verified absent from startup chunks                                                                                                                                                            |
| `src/webview/App.tsx` (feature growth)                                                     | 7,680  | yes: the main component                                                                                                                                                                                                                                                |
| `src/shared/scheduleV2.ts` + `scheduleEvents` + `core/schedules/time/cron.ts`              | 8,424  | yes: `protocol.ts` validates schedule messages; `toolPresentation` renders restored schedule rows                                                                                                                                                                      |
| `src/shared/media.ts`, `src/shared/patchDocument.ts`                                       | 2,930  | yes: `protocol.ts` validates attachment/patch messages                                                                                                                                                                                                                 |
| `src/shared/constants.ts`, `src/shared/protocol.ts`, `uiState`, `store`, `Composer` growth | ~5,000 | yes: first-paint state and components                                                                                                                                                                                                                                  |
| `src/shared/redact.ts`                                                                     | 1,625  | yes: `state/snapshot.ts` redacts restored user rows and the saved draft (`:157`, `:167`), and `state/uiState.ts` redacts replayed user items and queued sends (`:1511`, `:3810`); `errorReport.ts` is in startup but does not import it (corrected after RVSTARTUP017) |
| `schedules/prompt.ts`                                                                      | 1,374  | **no**: `/schedule` submit only → lazy (below)                                                                                                                                                                                                                         |
| `schedules/presentation.ts`                                                                | 1,205  | yes: restored schedule settlement rows                                                                                                                                                                                                                                 |
| Money closure (`paid`, `usd`, `exactUsd`, `insights`, `tokenRatePrice`)                    | ~6,800 | **no** → lazy hub (below)                                                                                                                                                                                                                                              |

### Each module moved (all out of the startup closure, verified in `dist/meta/webview.json`)

| Moved                                                                                                                                                                          | Mechanism                                                                                                                                                                                                                                                                       | Behaviour                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/usd.ts` (`Usd`, exact arithmetic)                                                                                                                                      | schema-only importers repoint to `shared/usdSchema.ts` (`agentEvents`, `paidBoundary`, `transcriptEntries`, `protocol`→`paidBoundary`, `constants.ts:1`, `modelsPanel.ts`); display through the hub                                                                             | parsing/validation identical (same schemas); display exact once loaded                                                                                                                                              |
| `shared/paid.ts` (prices, tariffs)                                                                                                                                             | `paidFeatureName` + `usablePaidFeatures` moved to `paidBoundary.ts` (constants + `UI_TEXT` only, no `protocol` import, keeping it acyclic); `paid.ts` re-exports them and the hub's `formatUsd`/`Usd`/`isPositiveUsd`; tooltip/cost call sites use `src/webview/money.ts` hooks | names paint with startup; prices fill in exactly; tooltips omitted (never guessed) while loading                                                                                                                    |
| `core/usage/insights.ts` (`formatUsd`, estimates)                                                                                                                              | `Transcript` reply-usage cost → `useReplyUsageText`; lazy surfaces keep their imports                                                                                                                                                                                           | usage line pops in once per restored transcript, exact; tokens were never async                                                                                                                                     |
| `shared/l10n/exactUsd.ts`, `shared/tokenRatePrice.ts`                                                                                                                          | follow the above out; reached only through the hub                                                                                                                                                                                                                              | —                                                                                                                                                                                                                   |
| `webview/schedules/prompt.ts`                                                                                                                                                  | `/schedule` submit path dynamic-imports it (estimate-precedent); failure warns `scheduleCommandFailed` and, since RVSTARTUP017, hands the command back to an empty composer; the mapping lives as long as its surface, session and conversation                                 | same mapping; prefix check stays sync                                                                                                                                                                               |
| Palette prices (`priceText`), paid toggle prices (`paidItems`), estimator `defaultPrice`, models `Wizard`/`ModelsSection`/`ProvidersSection`/`CostNotice`, usage `ModelDetail` | all through the hub (`useFormatUsd`, `useConservativeUsd`, `useFormatTestCost`, `usePriceOf`, `useMoneyDisplay`, `loadMoneyDisplay`)                                                                                                                                            | no wrong numbers; `buildPalette` keeps purity via an injected `priceOf` (tests inject the sync one). Since RVSTARTUP017: consent Accepts wait for their stated amount, and a failed load is said with Retry (below) |

New deferred budgets (`scripts/lib/webviewBundles.mjs`, measured + 15% → 25 KiB
scale): `exact money` 12.5 KiB (paid + insights closures), `prompt.ts` joins
`schedule surface` (39.1/50 KiB). Deferring money reattributes its shared
chunks into lazy closures; Palette (22.3/25), estimator panel (24.9/25) and
the models body (73.8/75) are back inside their caps through the hub above.

### Guards and red drills

| Guard                                                                                                                                                        | Break                                                 | Result                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `scripts/check-bundle-split.mjs` `MONEY_STARTUP_NEVER` (`usd.ts`, `exactUsd`, `tokenRatePrice`, `insights.ts`, `paid.ts` never in the initial webview graph) | `src/webview/money.ts` value-imported `../shared/usd` | exit 1: `dist/webview/chunks/4DFTTBSW.js carries exact-money src/shared/usd.ts in the initial webview graph`; pass on revert |
| `webviewBundle` "loads exact USD arithmetic and display only with lazy media pricing"                                                                        | — (unbroken)                                          | pass                                                                                                                         |

### Tests and gates (rig, default timeouts, ≤3 files per run)

- New `test/unit/moneyDisplay.test.tsx` (11): hub parity against the direct
  arithmetic for every exposed display, loading-then-exact hooks,
  chunk-failure and tariff-refusal withholding without throwing,
  `PaidBadge` painting at once with the tooltip filling in. (Its "retry
  after failure" case exercised a different importer, not the browser's
  cached failed fetch; RVSTARTUP017 finding 1 replaced it, below.)
- Updated: `modelsComponents` (async `CostNotice`), `paletteRegistry`
  (sync `priceOf` injection + priceless-rows test), `Composer` (mic tooltip),
  `Transcript` (usage cost, paid-row tooltip), `Palette` (unpriced-then-priced
  rows), `warmDeferredSurfaces` helper (new `schedules/prompt` surface).
- Suites: webviewBundle 55/56 (only the ratchet fails, unedited),
  deferredBundles 113/113, moneyDisplay/modelsComponents/paletteRegistry
  80/80, Composer/Transcript/Palette 181/181, estimatorPanel/paidFeatures
  pass, schedulePrompt passes, AppPalette ×2 + modelsWebviewEntry pass,
  providerWizardSave/scheduleSurfaceWebview/estimatorPrices 48/48.
- Pre-existing failures, unchanged by this lane (other lanes' territory,
  listed in CAPS017 §Tests): warmDeferredSurfaces `ElicitationCard` hunk,
  paidDailyBudget/accountPaidConsent (numeric-vs-decimal ledger),
  paidMoneyPorts (no touched file listed), jscpd's 3 clones
  (`acp/agent.ts`, questions helper, paidDailyBudget test).
- Gates, all exit 0: five typechecks; eslint `--max-warnings=0` and prettier
  on all 31 changed/new files; plain knip (hub destructures the dynamic
  imports so member use traces; dead `paidStateSchema` re-export removed);
  `check:l10n` (no new keys); full `npm run build` with every cap.
- Not run on this rig: the harness/Chrome suites (sandbox blocks Chrome;
  the lead runs those outside the sandbox), live/e2e bills. The review-fix
  lane below ran the production Chrome harness on the Windows host.

### Remainder for the lead (D6)

8,640 B over the ratchet, all first-paint-anchored and measured, not moved:

- schedule/media/patch schemas via `protocol.ts` (message validation for
  restored state), `toolPresentation` schedule parsing via `stepSummary` →
  `Transcript` (restored rows), `redact.ts` via `state/snapshot.ts` and
  `state/uiState.ts` (restored drafts and user rows), the `en.ts`
  startup slice (only referenced keys ship), and `App`/`Composer`/`uiState`
  feature growth. No further user-triggered-only module remains in startup:
  `rankSlashCommands` (487 B) must rank synchronously on each keystroke and
  `diffTally` (466 B) decides the tally entry on first paint.

### Review fixes (RVSTARTUP017)

Lane `rel017/startup2` from `e3dc72665`, on the Windows 11 host, where the
production Chrome harness runs. The P3 English split came from a sub-lane
(`rel017/startup2-p3`, `d9b37fa7f`) and was cherry-picked after review. The
ratchet and both `webviewBundle` assertions are unedited.

| Finding                                   | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Tests                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 P2 money failure without retry          | `src/webview/money.tsx`: one load per document shared by every consumer (`loadMoneyDisplay`, `useMoneyLoad`); a failure stays failed, since the browser keeps the failed fetch. `MoneyUnavailable` says `moneyLoadFailed` (new key, 14 tables) with Try again, which calls the existing document retry (`retrySurface` in chat: save, then host rebuild; reload in the models panel), so every mounted consumer refetches. Shown in `App.tsx` and inside `Palette.tsx` (pressing a notice outside the palette closes it first and the click misses, found by the harness). Chat-only hooks moved to `moneyHooks.ts`; a consumer that shows no price loads nothing (mic only for the paid engine, badge only with features, palette prices once its registry loads). | `moneyDisplay` (shared load, failure stays said, notice + Retry, report-only notice starts no load); `startupMoney.mjs` `money-chat` (abort → notice, no guessed tooltip → restore → Try again → badge and paid row priced, chunk fetched again), `money-palette` (same inside the palette; mic tooltip priced)                                     |
| 2 P2 consent without a disclosed price    | `models/components/CostNotice.tsx` `useTestCostDisclosure`: Accept disabled until the exact cost is shown (wizard notice and saved-provider `TestLine` in `ProvidersSection.tsx`); loading says Loading…; a failed load keeps Accept unavailable and the panel notice (`models/panel.tsx`) shows the error with Try again. `SuggestionCard` `isValueShown`: the session budget's Accept waits for its amount.                                                                                                                                                                                                                                                                                                                                                       | `modelsComponents` (disabled first, then cost, then Accept; budget card); `modelsMoneyLifecycle` (held: disabled then enabled; failed: unavailable + alert); `modelsPanelSections` awaits the load before Accept; `startupMoney.mjs` `consent-failed` (abort: alert, Accept disabled, no `acceptCost: true` posted, Retry restores), `consent-held` |
| 3 P2 budget change outlives its wizard    | `models/reducer.ts` + `sections.ts`: `wizardGeneration`, a new one on each open (a provider pick or save dispatches it while the wizard stays open, `ProvidersSection.tsx`); `panel.tsx` `useWizardLife` reports a closed wizard as never current; `Wizard.tsx` posts the pending change only if its captured generation is still current. A failed load keeps the typed amount and shows the panel notice.                                                                                                                                                                                                                                                                                                                                                         | `modelsMoneyLifecycle` (held: posts to its draft; cancel and cancel + reopen drop it; failed: alert, amount kept, nothing posted); `startupMoney.mjs` `wizard-cancel` (held chunk, 7.5, Change, Cancel, release: no `suggestions/change`)                                                                                                           |
| 4 P2 failed `/schedule` loses the command | `App.tsx` `loadSchedulePrompt` + submit path: a failed load restores the submitted text only into an empty composer, never over a newer draft, and keeps `scheduleCommandFailed`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `App` (failure restores; newer draft kept); `startupMoney.mjs` `schedule-failed` (abort the prompt chunk: warning, command back, no `openSchedules`)                                                                                                                                                                                                |
| 5 P2 stale schedule open                  | `App.tsx` `isCommandLive`: the mapping lives as long as its surface (closes counted on Cancel, same workspace), session (`sessionId`) and conversation (`attachmentEpoch`); ended first, it posts and stashes nothing (success and failure alike).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `App` (surface cancelled and reopened; conversation cleared); `startupMoney.mjs` `schedule-stale` (held chunk, surface Cancel, New conversation, release: no `openSchedules`)                                                                                                                                                                       |
| 6 P3 App test expects a sync open         | `test/unit/App.test.tsx`: the report-draft test awaits the real mapping and keeps the no-request and nothing-stashed checks; new cold, failure, newer-draft, cancelled-surface and cleared-conversation cases at the App boundary over a held real chunk (`vi.doMock` + a fresh App import per test).                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 13/13 schedule tests                                                                                                                                                                                                                                                                                                                                |
| 7 P3 remainder not proved                 | English (sub-lane): `scheduleSettlement { sent, outcomes }` replaces `scheduleV2.editor.sent` and `scheduleV2.outcomes` (moved with every translation, no string duplicated); `parseScheduleSettlement` moved to `schedules/settlement.ts`, so `presentation.ts` leaves startup; the rest of `scheduleV2` English is its own lazy lane `browser-schedule-english` (4,933 B, new 25 KiB cap), awaited by each non-eager reader, `loadDeferredEnglish` and the palette registry. The `redact.ts` rationale is corrected above.                                                                                                                                                                                                                                        | toolPresentation, scheduleStrings, scheduleRunRows 30/30; schedulePrompt, scheduleChannel, agentSchedules 62/62; webviewDiet 27 PASS (schedule surfaces under CSP)                                                                                                                                                                                  |

Not done in 7: lazy schedule request/response/surface validators. `scheduleV2.ts`
(6,542 B in startup) stays for restored rows, and esbuild keeps every
module-level zod schema, so making the messages lazy saves nothing until that
24 KB module (imported by about 70 host and runtime files) is split. A lazy
`schedulesSurface` parse also needs an ordered queue in `store.ts`, since the
estimator's lazy-parse pattern reorders and drops messages. Ceiling about
3.5 KB. Not safe to rush; recorded for the lead.

#### Startup bytes (production build, this host)

| Build                                                     | Chat startup | Models body (cap 76,800) |
| --------------------------------------------------------- | ------------ | ------------------------ |
| `e3dc72665`                                               | 760,051      | 75,413                   |
| P2 fixes alone (`5056e7f3e`)                              | 761,289      | 76,759                   |
| P3 English alone (`d9b37fa7f`)                            | 756,346      | —                        |
| Final (both, `npm ci`, `npm run build` exit 0, every cap) | **757,694**  | **76,733**               |
| Ratchet                                                   | 751,411      |                          |
| **Remainder over the ratchet**                            | **6,283**    |                          |

The P2 fixes cost about 1.3 KB of startup: the shared load state and failure
notice in the hub's chunk, and the `/schedule` lifetime and recovery in
`App.tsx`. Two first attempts were measured and dropped: a separate notice
module and a hub import of `surfaceRetry` each split a chunk (+1.5 KiB in
startup, models body 75.8/75); the notice now takes its retry from the
caller, and the chunk count is back to 55. New budget: `schedule English`
4.8/25 KiB.

#### Drills (each broken on purpose, seen red, reverted)

| Drill                                                                   | Result                                                                                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1: `MoneyUnavailable` never shows a failure (`status !== 'idle'`)       | moneyDisplay 2 failed; modelsMoneyLifecycle 2 failed; reverted, pass                                                                            |
| 2: the paid check's Accept ungated (`disabled={false}`)                 | modelsComponents 1 failed, modelsMoneyLifecycle 2 failed; reverted, pass                                                                        |
| 5: the `/schedule` lifetime forced live                                 | App 2 failed (cancelled surface, cleared conversation); reverted, pass                                                                          |
| All seven `startupMoney.mjs` cases against the `e3dc72665` build        | 7 FAIL: no notice (money ×2, consent-failed), Accept enabled while held, budget change after Cancel, empty composer, editor opened after Cancel |
| Sub-lane: `toolPresentation.ts` reads `UI_TEXT.scheduleV2.labels.title` | probe exit 1 "scheduleV2 is eager"; reverted                                                                                                    |

#### Gates (this host; default timeouts, at most 3 files per run, `--maxWorkers=3`)

- `npm run build`: exit 0, every cap (on an `npm ci` install; under a
  `node_modules` junction the split check reports 8 "no longer carries
  node_modules/…" lines because metafile paths resolve through the junction,
  on the base build too).
- Five typechecks: exit 0. ESLint `--max-warnings=0` and Prettier on every
  changed file: exit 0. Plain knip: exit 0 (`startupMoney.mjs` added as an
  entry beside `webviewDiet.mjs`). `check:l10n`: 0 problems.
- jscpd: exit 1 on the 3 clones listed above as other lanes' (`acp/agent.ts`,
  the questions helper, the paidDailyBudget test); this lane's own clones
  (`moneyDisplay`, `modelsMoneyLifecycle`) are removed.
- Suites: moneyDisplay/modelsComponents/modelsMoneyLifecycle 40/40;
  modelsPanelSections 19/19, modelsPanelReducer/modelsSections 11/11;
  Composer/Transcript/Palette 181/181; paletteRegistry/schedulePrompt 57/57;
  App 186 run: 185 pass and one focus-order flake in the share-view test
  under load, which passes on rerun (13/13 schedule cases); deferredBundles
  113/113; warmDeferredSurfaces fails only on the earlier `ElicitationCard`
  mismatch; webviewBundle 53/56 in a full-file run: the unedited ratchet (`expected 757694 to be less than or equal to 751411.2`, the remainder above) and two host-bundle tests (resource-policy leakage, provider pacing) that hit their 15 s limit while two other sessions ran `eslint .` on this host, the pair the review saw time out under overlap; a rerun of the pair hit the 120 s build-hook limit under the same load, so the lead reruns them on a quiet rig.
- Chrome: `node test/e2e/startupMoney.mjs` 7/7 PASS; `node
test/e2e/webviewDiet.mjs` exit 0 (27 PASS); a11y on empty, paid,
  paid-palette, palette, paid-usage, models-test-cost, models-suggestions,
  models-providers, models-table, models-confirm, schedules-v2-list and
  schedules-v2-editor: 48 pages, 0 violations. One page
  (light/schedules-v2-list) was not ready in 10 s on the first run; the
  schedule scenes were rerun: 8/8 pages, exit 0.
