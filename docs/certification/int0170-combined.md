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
  `src/runtime/providers/runtimeServices.ts:69`), which stops and removes
  profiles only after confirmation; profiles stay on disk until then.
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
