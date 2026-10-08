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

## Spawn governance (SPAWN017)

Windows 11 rig, branch `rel017/spawn`, candidate `7a4fc2ab3`, 2026-10-08.
The rig's shared `common.md` was absent from both named context locations;
the rig brief and repository rules were applied. No live model attempt,
paid call, credential capture, merge, rebase or push was performed.

Account-scoped MSP retains its account command owner while using the same
governed native launch and bounded shutdown as ordinary MSP. Native tests
check root and descendant membership, owning-host death, job disappearance
and `complete(false)` rather than root-exit retirement. Vault stdio now has
`governedMcpVaultRoutes`, selected by `modelApiMcpPoolDeps.vaultBroker`:
resource admission precedes broker redemption; workspace/canonical use and
revocation are rechecked; streams are scrubbed; values and leases are cleared
after contained shutdown. No broker is installed in this candidate, so
unbound vault references still refuse before dispatch. This is a production
builder and its binding seam, not certification of an installed vault broker.

### Spawn-site inventory

Replaced by SPAWN017C (see that section); historical receipts below retain
their original results.

`test/unit/spawnInventory.test.mjs` (scanner: `scripts/lib/spawn-inventory.mjs`)
parses every file under `src` for `spawn`, `execFile`, `exec`, `fork`,
`execSync`, `execFileSync`, `spawnSync`, the governed launchers, aliases,
`promisify` wrappers, member calls, `child_process` / `node:child_process`
imports and `require`s, and supervisor programs embedded in strings. The
scanned set must equal `docs/certification/spawn-inventory.json`, so a new
unlisted site fails. `x.exec(` counts only on a `child_process` binding
(otherwise it is `RegExp.exec`). Every `test-only` entry is proved: no
production path reaches its owning symbol, transitively, and a test uses it.
Portable call sites must name the profile the entry records. The rows below
must equal the JSON, cell for cell.

| Site                                                                           | Profile              | Reason                                                                                                                                                                              |
| ------------------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/backends/modelapi/mcp/pool.ts#call:spawn:1`                          | contained            | Delegates ordinary stdio to admitted host builder and credentialed stdio to the authorized vault port.                                                                              |
| `src/core/backends/modelapi/pluginHost.ts#call:spawn:1`                        | contained            | Plugin probe and worker take admission; their process-tree adapter owns timeout/cancellation and retirement.                                                                        |
| `src/core/backends/modelapi/pluginHost.ts#call:spawn:2`                        | contained            | Plugin probe and worker take admission; their process-tree adapter owns timeout/cancellation and retirement.                                                                        |
| `src/core/backends/modelapi/pluginHost.ts#call:spawn:3`                        | contained            | Plugin probe and worker take admission; their process-tree adapter owns timeout/cancellation and retirement.                                                                        |
| `src/core/backends/modelapi/pluginHost.ts#import:1`                            | contained            | Plugin probe and worker take admission; their process-tree adapter owns timeout/cancellation and retirement.                                                                        |
| `src/core/backends/musecode/MuseCodeHost.ts#call:spawn:1`                      | contained            | Process type import and injected contained shell port; account/ordinary MSP use their admitted native transport.                                                                    |
| `src/core/backends/musecode/MuseCodeHost.ts#import:1`                          | contained            | Process type import and injected contained shell port; account/ordinary MSP use their admitted native transport.                                                                    |
| `src/core/browser/browserRun.ts#call:spawn:1`                                  | contained            | Injected browser process port is supplied by browserProcess admission and containment.                                                                                              |
| `src/core/eval/workspace.ts#call:execFile:1`                                   | test-only            | M75 paired-evaluation verifier: reachable only from the eval runner, which only tests and live drills call (proved by the guard).                                                   |
| `src/core/eval/workspace.ts#import:1`                                          | test-only            | M75 paired-evaluation verifier: reachable only from the eval runner, which only tests and live drills call (proved by the guard).                                                   |
| `src/core/media/convert.ts#call:spawnResourceProcess:1`                        | probe                | Media tool version probe (`-version`): bounded, reads stdout only, writes nothing; contained tree, no temp root.                                                                    |
| `src/core/media/convert.ts#call:spawnResourceProcess:2`                        | contained            | Media probes/encoders use the portable contained launch; this import is a process type.                                                                                             |
| `src/core/media/convert.ts#import:1`                                           | contained            | Media probes/encoders use the portable contained launch; this import is a process type.                                                                                             |
| `src/core/media/record/macos.ts#call:spawn:1`                                  | honestly-unavailable | Installed recorder driver is unbound; Help/preview refuse honestly before these injected builders.                                                                                  |
| `src/core/media/record/macos.ts#call:spawn:2`                                  | honestly-unavailable | Installed recorder driver is unbound; Help/preview refuse honestly before these injected builders.                                                                                  |
| `src/core/orchestration/playbook/modules.ts#import:1`                          | contained            | Type-only process port; Git hooks use the admitted contained runner.                                                                                                                |
| `src/core/orchestration/playbook/outcomes.ts#import:1`                         | contained            | Type-only process port; outcome commands use the admitted contained runner.                                                                                                         |
| `src/core/reporting/history.ts#call:execResourceFile:1`                        | probe                | Report-writer birth identity probe (ps / Diagnostics.Process start time): read-only, bounded; contained tree, no temp root.                                                         |
| `src/core/reporting/sources/github.ts#call:execResourceFile:1`                 | probe                | gh reads for reports (GET only), credential-stripped, bounded; contained tree, no temp root.                                                                                        |
| `src/core/reporting/sources/github.ts#import:1`                                | contained            | GitHub reads select the bounded credential-stripped contained command adapter.                                                                                                      |
| `src/core/resources/admission.ts#call:execResourceFile:1`                      | contained            | Lazy facade forwards this branch’s profile to the single governed launcher.                                                                                                         |
| `src/core/resources/admission.ts#call:handoffResourceFile:1`                   | handoff              | Lazy facade forwards this branch’s profile to the single governed launcher.                                                                                                         |
| `src/core/resources/admission.ts#call:spawnResourceProcess:1`                  | interactive          | Lazy facade forwards this branch’s profile to the single governed launcher.                                                                                                         |
| `src/core/resources/admission.ts#call:spawnResourceProcess:2`                  | contained            | Lazy facade forwards contained and bootstrap launches to the single governed launcher; hand-offs use handoffResourceFile only.                                                      |
| `src/core/resources/bootstrap.ts#call:spawnResourceProcess:1`                  | bootstrap            | Compiler selects bootstrap with heavy admission, combined output bound, deadline and OS whole-tree stop.                                                                            |
| `src/core/resources/commands.ts#call:spawnResourceProcess:1`                   | handoff              | handoffResourceFile: fixed OS adapter, waits for its own exit within RESOURCE_HANDOFF_TIMEOUT_MS; never waits for or stops what it opened.                                          |
| `src/core/resources/commands.ts#call:spawnResourceProcess:2`                   | contained            | execResourceFile forwards the caller-named contained or probe profile; one deadline covers admission and run; combined output cap.                                                  |
| `src/core/resources/commands.ts#import:1`                                      | contained            | Type-only import of execFile options for the contained command adapter.                                                                                                             |
| `src/core/resources/launch.ts#import:1`                                        | contained            | Type-only process interfaces; profile and terminal/session options are owned by the portable launcher.                                                                              |
| `src/core/resources/process.ts#call:execFile:1`                                | bootstrap            | Bootstrap emergency stop: fixed SystemRoot taskkill /T /F of the owned root; cannot queue behind the pause it may need to outlast.                                                  |
| `src/core/resources/process.ts#call:spawn:1`                                   | interactive          | Interactive branch: inherited stdio, no new session or group, exit observed, root stopped at shutdown.                                                                              |
| `src/core/resources/process.ts#call:spawn:2`                                   | handoff              | Handoff branch: background admission (pause refuses), named deadline, output to the null device, root-only stop.                                                                    |
| `src/core/resources/process.ts#call:spawn:3`                                   | contained            | Contained and bootstrap branch: pipes, own POSIX group (Windows contained work joins a job), whole-tree stop on cancel, timeout, exit and dispose.                                  |
| `src/core/resources/process.ts#import:1`                                       | contained            | The single governed launcher; each branch is listed separately.                                                                                                                     |
| `src/core/resources/sampler/system.ts#call:execFile:1`                         | bootstrap            | Fixed absolute OS sampler probes have empty credential environment, RESOURCE_SAMPLE_MS timeout and bounded output; admission would recurse.                                         |
| `src/core/resources/sampler/system.ts#import:1`                                | bootstrap            | Fixed absolute OS sampler probes have empty credential environment, RESOURCE_SAMPLE_MS timeout and bounded output; admission would recurse.                                         |
| `src/core/resources/trees/linuxLaunch.ts#call:spawn:1`                         | contained            | Contained Linux launcher gates already admitted work into a dedicated scope/group before payload dispatch.                                                                          |
| `src/core/resources/trees/linuxLaunch.ts#call:spawn:2`                         | contained            | Contained Linux launcher gates already admitted work into a dedicated scope/group before payload dispatch.                                                                          |
| `src/core/resources/trees/linuxLaunch.ts#import:1`                             | contained            | Contained Linux launcher gates already admitted work into a dedicated scope/group before payload dispatch.                                                                          |
| `src/core/resources/trees/run.ts#call:execFile:1`                              | bootstrap            | Fixed absolute OS identity/tree probes have credential-free environment, PROCESS_TABLE_TIMEOUT_MS and Node default output cap; admission would recurse.                             |
| `src/core/resources/trees/run.ts#import:1`                                     | bootstrap            | Fixed absolute OS identity/tree probes have credential-free environment, PROCESS_TABLE_TIMEOUT_MS and Node default output cap; admission would recurse.                             |
| `src/core/schedules/events/git.ts#call:execResourceFile:1`                     | probe                | Scheduled Git common-dir read (rev-parse), trust-checked, --no-optional-locks; read-only, contained tree, no temp root.                                                             |
| `src/core/schedules/events/git.ts#call:execResourceFile:2`                     | probe                | Scheduled Git ref listing (for-each-ref), --no-optional-locks; read-only, contained tree, no temp root.                                                                             |
| `src/core/schedules/events/git.ts#call:execResourceFile:3`                     | probe                | Scheduled Git ref re-read that verifies a stable listing; read-only, contained tree, no temp root.                                                                                  |
| `src/core/team/workers/engineWorker.ts#call:spawn:1`                           | contained            | Injected worker port is the admitted team engine-worker launcher.                                                                                                                   |
| `src/core/team/workers/workerFence.ts#call:execFile:1`                         | test-only            | macOS lsof path probe inside WORKER_NATIVE_IO, which only tests use (proved by the guard).                                                                                          |
| `src/core/team/workers/workerFence.ts#import:1`                                | test-only            | macOS lsof path probe inside WORKER_NATIVE_IO, which only tests use (proved by the guard).                                                                                          |
| `src/core/vault/broker/peer.ts#call:spawnResourceProcess:1`                    | contained            | Fixed Unix peer helper selects contained launch with the inherited socket descriptor and empty environment.                                                                         |
| `src/core/voice/dictation.ts#call:spawn:1`                                     | contained            | Injected helper spawn is supplied by admittedVoiceProcess with admission and contained job/group lifetime.                                                                          |
| `src/host/backend/jobBuild.ts#call:runBootstrap:1`                             | bootstrap            | Containment helper compiler selects shared bounded bootstrap admission; it cannot use its unbuilt helper.                                                                           |
| `src/host/backend/mcpJobLaunch.ts#call:spawn:1`                                | contained            | Admitted Windows MCP launcher assigns the payload to its native job before dispatch and observes tree retirement.                                                                   |
| `src/host/backend/mcpJobLaunch.ts#import:1`                                    | contained            | Admitted Windows MCP launcher assigns the payload to its native job before dispatch and observes tree retirement.                                                                   |
| `src/host/backend/mcpProcess.ts#call:spawn:1`                                  | contained            | Admitted MCP transport uses job containment on Windows and a dedicated group on POSIX.                                                                                              |
| `src/host/backend/mcpProcess.ts#import:1`                                      | contained            | Admitted MCP transport uses job containment on Windows and a dedicated group on POSIX.                                                                                              |
| `src/host/backend/mcpServers.ts#call:spawn:1`                                  | contained            | Delegates to the admitted MCP builder; no raw unowned process.                                                                                                                      |
| `src/host/backend/mcpVault.ts#call:spawn:1`                                    | contained            | Authorized broker stdio builder uses the admitted MCP boundary, scrub and bounded contained shutdown.                                                                               |
| `src/host/backend/museCodeBackendManager.ts#call:spawn:1`                      | contained            | Backend lifecycle delegates to resource-governed MSP transport and observed shutdown.                                                                                               |
| `src/host/backend/toolIo.ts#call:spawn:1`                                      | contained            | Shell/tool entry admits resources and registers the native job or POSIX process group.                                                                                              |
| `src/host/backend/toolIo.ts#import:1`                                          | contained            | Shell/tool entry admits resources and registers the native job or POSIX process group.                                                                                              |
| `src/host/browser/browserProcess.ts#call:execFile:1`                           | contained            | Pinned browser has resource admission, registered job/group lifetime and bounded OS emergency termination.                                                                          |
| `src/host/browser/browserProcess.ts#call:spawn:1`                              | contained            | Pinned browser has resource admission, registered job/group lifetime and bounded OS emergency termination.                                                                          |
| `src/host/browser/browserProcess.ts#import:1`                                  | contained            | Pinned browser has resource admission, registered job/group lifetime and bounded OS emergency termination.                                                                          |
| `src/host/git.ts#call:execFile:1`                                              | contained            | Git commands use resource admission and registered job/group containment; injected execFile is the same guarded port.                                                               |
| `src/host/git.ts#call:execFile:2`                                              | contained            | Git commands use resource admission and registered job/group containment; injected execFile is the same guarded port.                                                               |
| `src/host/git.ts#call:execFile:3`                                              | contained            | Git commands use resource admission and registered job/group containment; injected execFile is the same guarded port.                                                               |
| `src/host/git.ts#call:execFile:4`                                              | contained            | Git commands use resource admission and registered job/group containment; injected execFile is the same guarded port.                                                               |
| `src/host/git.ts#call:execFile:5`                                              | contained            | Git commands use resource admission and registered job/group containment; injected execFile is the same guarded port.                                                               |
| `src/host/git.ts#call:spawn:1`                                                 | contained            | Git commands use resource admission and registered job/group containment; injected execFile is the same guarded port.                                                               |
| `src/host/git.ts#import:1`                                                     | contained            | Git commands use resource admission and registered job/group containment; injected execFile is the same guarded port.                                                               |
| `src/host/git/untrustedGit.ts#call:execFile:1`                                 | contained            | Injected execFile is the host guarded Git command port; this module imports process types only.                                                                                     |
| `src/host/git/untrustedGit.ts#call:execFile:2`                                 | contained            | Injected execFile is the host guarded Git command port; this module imports process types only.                                                                                     |
| `src/host/git/untrustedGit.ts#import:1`                                        | contained            | Injected execFile is the host guarded Git command port; this module imports process types only.                                                                                     |
| `src/host/processTree.ts#call:execFile:1`                                      | bootstrap            | runProgram: fixed bounded runner for containment-helper self-tests, OS identity probes and emergency termination; it cannot be admitted through the helpers it verifies.            |
| `src/host/processTree.ts#call:spawnSync:1`                                     | contained            | Bounded credential-free native probes and emergency termination; the embedded POSIX supervisor owns and stops its payload group.                                                    |
| `src/host/processTree.ts#embedded:call:execFileSync:1`                         | contained            | Bounded credential-free native probes and emergency termination; the embedded POSIX supervisor owns and stops its payload group.                                                    |
| `src/host/processTree.ts#embedded:call:execFileSync:2`                         | contained            | Bounded credential-free native probes and emergency termination; the embedded POSIX supervisor owns and stops its payload group.                                                    |
| `src/host/processTree.ts#embedded:call:spawn:1`                                | contained            | Bounded credential-free native probes and emergency termination; the embedded POSIX supervisor owns and stops its payload group.                                                    |
| `src/host/processTree.ts#embedded:import:1`                                    | contained            | Bounded credential-free native probes and emergency termination; the embedded POSIX supervisor owns and stops its payload group.                                                    |
| `src/host/processTree.ts#import:1`                                             | contained            | Bounded credential-free native probes and emergency termination; the embedded POSIX supervisor owns and stops its payload group.                                                    |
| `src/host/resources/resourceAdmission.ts#import:1`                             | contained            | Type-only import; observes registration and whole-tree retirement for contained launchers.                                                                                          |
| `src/host/resources/resourceJobHolder.ts#call:spawn:1`                         | contained            | Fixed native job holder is containment infrastructure for already admitted work, never a payload bypass.                                                                            |
| `src/host/resources/resourceJobHolder.ts#import:1`                             | contained            | Fixed native job holder is containment infrastructure for already admitted work, never a payload bypass.                                                                            |
| `src/host/team/acpProcess.ts#call:spawn:1`                                     | contained            | Team launcher owns admission and native job/group transport lifetime.                                                                                                               |
| `src/host/team/processLifetime.ts#call:spawn:1`                                | test-only            | Native team lifetime driver: reachable only from startNativeTeamLifetime, which only tests call (proved by the guard).                                                              |
| `src/host/team/processLifetime.ts#call:spawn:2`                                | test-only            | Native team lifetime driver: reachable only from startNativeTeamLifetime, which only tests call (proved by the guard).                                                              |
| `src/host/team/processLifetime.ts#import:1`                                    | test-only            | Native team lifetime driver: reachable only from startNativeTeamLifetime, which only tests call (proved by the guard).                                                              |
| `src/host/vault/slots/windowsVaultBuild.ts#call:runBootstrap:1`                | bootstrap            | Vault guard/compiler select shared bootstrap admission; pause refuses without a second storage attempt.                                                                             |
| `src/host/vault/vaultExecSpawn.ts#import:1`                                    | honestly-unavailable | Process type only; unbound installed broker/feeder route refuses closed before launch.                                                                                              |
| `src/host/voice/voiceProcesses.ts#call:spawn:1`                                | contained            | Voice helper takes resource admission, job/group launch and registered retirement.                                                                                                  |
| `src/host/voice/voiceProcesses.ts#import:1`                                    | contained            | Voice helper takes resource admission, job/group launch and registered retirement.                                                                                                  |
| `src/host/voice/voiceProcesses.ts#import:2`                                    | contained            | Voice helper takes resource admission, job/group launch and registered retirement.                                                                                                  |
| `src/runtime/main.ts#call:handoffResourceFile:1`                               | handoff              | Usage companion opener (xdg-open, open, rundll32) receives a checked loopback URL; bounded adapter wait, root-only stop; pause is reported as such.                                 |
| `src/runtime/main.ts#call:spawnResourceProcess:1`                              | interactive          | `muse login` runs in the user’s terminal session, group and TTY; Ctrl+C reaches it; stopped if the CLI shuts down.                                                                  |
| `src/runtime/reporting/sources.ts#call:execResourceFile:1`                     | probe                | Report Git reads (--no-pager log/show/diff), credential-free; read-only, contained tree, no temp root.                                                                              |
| `src/runtime/resources/entry.ts#call:runBootstrap:1`                           | bootstrap            | Native containment self-tests/builds select bounded bootstrap compilation.                                                                                                          |
| `src/runtime/schedules/nodeBackgroundIo.ts#call:execResourceFile:1`            | contained            | Native schedule OS commands (launchctl, systemctl, schtasks) change scheduler state, so they stay contained with a temp root.                                                       |
| `src/runtime/schedules/nodeBackgroundIo.ts#call:spawnResourceProcess:1`        | contained            | Native schedule commands and maintenance children select contained admission and owned tree lifetime.                                                                               |
| `src/runtime/schedules/nodeBackgroundIo.ts#import:1`                           | contained            | Native schedule commands and maintenance children select contained admission and owned tree lifetime.                                                                               |
| `src/runtime/sharing/sharingEntry.ts#call:handoffResourceFile:1`               | handoff              | Share copy (xclip, pbcopy, Set-Clipboard) and browser (xdg-open, open, explorer) adapters; scrubbed stdin, credential-free environment; pause is refused with the governor’s words. |
| `src/runtime/vault/slots/macVaultTransport.ts#call:spawnResourceProcess:1`     | contained            | Private vault slot transport selects contained launch with an empty credential environment.                                                                                         |
| `src/runtime/vault/slots/windowsVaultTransport.ts#call:spawnResourceProcess:1` | contained            | Private vault guard selects contained native job launch after readiness/digest checks.                                                                                              |

**Historical SPAWN017 status before the follow-up:** the bootstrap entries and
the runtime's then-unbound global resource
admission are unresolved scope, not approved governance exceptions. The
installed extension configures admission; newly migrated portable process paths
refuse when admission is unconfigured. Their runtime feature binding is still owed. Closing that runtime/bootstrapping seam
needs qualification beyond this Windows lane's time box. No assertion, gate,
cap, ignore or timeout was weakened to conceal it.

### Regression and verification receipts

On a fresh local clone with `npm ci`, `CI=true`, untouched candidate sources
and only the new tests copied in: `spawnBoundaries` 7/7 failed;
`spawnGovernance` 3 failed / 2 passed (12 total: 10 failed / 2 passed).
Account membership failed on the missing named job; vault stdio failed on
the absent production builder; the shared helper module was absent. The
host-death positive control also passes the candidate because Node's own
Windows lifetime handling stops that fixture; named governor job membership
is the account regression that distinguishes the repair.

Restored runs use repository defaults, no `--testTimeout`, no more than
three files per invocation. Compilation is shared in `beforeAll`; its
explicit 60-second hook covers compilation/self-test, not test execution.
The Windows Node fixture requires `SystemRoot` for its CSPRNG initialization;
vault payload environments remain empty. Slot protocol tests inject their
original peer and await asynchronous launch; native containment is independently
proved at the shared process boundary. Existing assertions are retained.

Final restored batches (repository timeout, at most three files):

| Files                                                                     | Exit | Tests                                                                                                                           |
| ------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| spawnGovernance, spawnBoundaries, nativeScheduleBackground                | 0    | 57 passed                                                                                                                       |
| mediaConvert, windowsVaultTransport, macVaultTransport                    | 0    | 82 passed                                                                                                                       |
| windowsVaultNative, accountHost, scheduleEvents.local                     | 0    | 65 passed (earlier restored native run; final repeat recorded below)                                                            |
| playbookPolicyModel, playbookRounds, reportFixtures                       | 0    | 60 passed                                                                                                                       |
| initial MSP/MCP resource regression batch                                 | 0    | 41 passed                                                                                                                       |
| nativeScheduleBackground, reportHistory, githubReportSource (earlier run) | 1    | 115 passed, 1 reportHistory failure: Windows EPERM during directory-rename race fixture. Not established as a baseline failure. |

Protocol/helper policy suites retain native or fake peer processes through a
shared test-only boundary. Their launch transport is injected; production
admission, named-job membership and whole-tree retirement are exercised by
spawnGovernance and spawnBoundaries. Exploratory fixture failures were fixed;
no assertion or timeout was changed to obtain the restored results.

Deliberate red drills in the private clone, each source restored byte-exact
(SHA-256 equality), each vitest exit 1:

- Account connection changed back to raw spawn: 1 failed / 4 passed,
  named native governor job membership failed.
- Vault broker selection bypassed: 1 failed / 4 passed,
  production vault admission/containment test failed.
- Shared process admission removed: all 7 portable boundary tests failed.

Fresh local clone, CI=true, npm ci exit 0 (901 packages; existing audit
reported 2 low and 9 high findings; no dependencies changed):

| Gate                | Exit | Receipt                                                                                                                   |
| ------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------- |
| Five typechecks     | 0    | host, webview, unit, e2e, integration; final repeat after fixture refinements recorded below                              |
| Changed-file ESLint | 0    | --max-warnings=0; 29 TypeScript files                                                                                     |
| Changed-file jscpd  | 0    | 29 files, 0 clones, unchanged threshold                                                                                   |
| Plain knip          | 0    | two existing configuration hints                                                                                          |
| check:l10n          | 0    | 14 UI/14 usage tables; 0 problems                                                                                         |
| check:host-api      | 0    | regenerated built-in import inventory; host API coverage unchanged                                                        |
| Production build    | 1    | existing reporting, network, questions, conversation, runtime, usage, accounts, headless and webview caps; no cap changed |

The new command/process implementations ship inside the existing first-use
resourceGovernor bundle through the shared admission shim. Payload PID reads
also use that bundle. resourceGovernor is 100.9 KiB against 125 KiB;
scheduleBackground is 49.0 KiB against 50 KiB. The intermediate new schedule
overage was fixed by the existing lazy boundary. Aggregate quality remains
with the lead under the lane's explicit scoped-gate deferral (PLAN section 7).
This record does not certify the unresolved bootstrap, installed broker or
runtime binding as satisfying the owner's no-exceptions decision.

Final native repeat: windowsVaultNative and accountHost passed; scheduleEvents.local
had one real-Git case refused by the intentionally unbound admission seam
(64 passed / 1 failed, exit 1). Its assertions are retained. This is a remaining
runtime integration failure, not a qualified regression-free runtime delivery.
The explicit time box ended with these unresolved bindings and bootstrap paths;
no further scope was implemented. Changed-file format verification is recorded
with the hook and fresh-clone check below.

Final delivery receipts: all five fresh-clone typechecks exited 0 after the
last fixture refinements. Fresh-clone changed-file Prettier initially exited 1
for this certification document; the normal hook formatted it, and the restored
fresh-clone check exited 0 for all 33 changed files. ESLint and jscpd exited 0
on all 29 changed TypeScript files. Normal pre-commit lint/format and gitleaks
exited 0; no source/test byte changed in the hook (compared with the tested
fresh-clone snapshot). Staged and committed differences were re-read.
Implementation commit: `006738760842e15ce90457ea4416ac0280f5dfa2`.
Cleanup was attempted with both a checked resolved path and its verified literal
path. Automatic approval review rejected both recursive removals as blocked by
policy, without a more specific reason. The private clone and scratch receipts
remain at C:/Users/Randy/AppData/Local/Temp/l-SPAWN017.

## Spawn governance follow-up (SPAWN017B)

Windows 11, branch rel017/spawn2, base b6e717f74. Shared rules were found
and read at C:/lanes/_ctx/codex/common.md. No merge, push, live/paid model
call, dependency or gate/hook change. The inventory above includes the
follow-up's bootstrap tier and honest unavailable states.

1. Bootstrap: core/resources/bootstrap.ts is shared by jobBuild.ts and
   windowsVaultBuild.ts. Heavy background admission cannot use foreground's
   automatic bypass. The deadline covers admission too; output has one
   combined cap. Windows taskkill /T /F and POSIX group termination remain
   available at pause; close is observed before compiled results are used.
   Bootstrap does not allocate or finish helper-backed temporary roots.
   spawnBootstrap proves compiler admission, native hung root/child deadline
   and cancellation, pause refusal and bounded output. The vault threat model
   documents why the builder cannot use its own not-yet-built job helper.
2. Runtime: lazyRuntimeResources binds global process admission to the
   existing createRuntimeResourceHost queue, prepares native jobs lazily in
   resourceGovernor.js and disposes the binding. spawnRuntimeAdmission proves
   shared heavy admission, governor pause refusal and shutdown refusal.
   The real-Git schedule refusal's root cause, repair and receipts are under
   "Root cause of the real-Git refusal (SPAWN017C)" below. Its assertions and
   deadlines are unchanged; admission is never bypassed.
3. Uninstalled builders: PLAN M105 W final status and section 7's
   M105-R1 integration deferral leave the trusted helper, process tree and
   installed recorder driver unbound; extension.ts supplies no driver and
   previewPanel.ts refuses before any recorder call. PLAN M109 W and
   vaultPanelBundle.ts leave the broker-backed service missing; both vault
   commands refuse before loading/opening the panel. The feeder is not
   installed. Help/catalog now explicitly describe both as unavailable, in
   English and all fourteen translations. Existing recorder and vault command
   refusal suites retain their assertions.
4. reportHistory: Windows cannot restore a lease over an open destination.
   Close the fully written/synced lease before the identity/tombstone checks;
   release only a matching named native identity. No sleep, retry or deadline
   was added. The original displaced-creator regression fails on b6e717f74
   with EPERM and passes after repair. Idle/load replay receipts follow.
5. Runtime login and browser openers: main.ts no longer imports child_process.
   Login forwards the terminal streams through the governed pipes. Linux's
   potentially long-lived xdg-open handler uses governed group launch;
   macOS open and Windows rundll32 use the governed bounded command adapter.
   No OS-handoff exception is claimed. spawnBoundaries guards both sites.

Fresh npm-ci baseline with only copied regression tests: 34 passed, two
failed, and one failed suite. The report restoration reproduces EPERM;
bootstrap's module/API is absent and runtime admission is unbound. The
additional opener/Help boundary regressions are checked separately.

Five deliberate red drills each exited 1 and restored SHA-256-identical
source bytes: bootstrap admission removed; runtime queue disconnected;
lease left open; unavailable recorder Help changed to a false success claim;
runtime opener changed back to a raw child_process import. Native fixtures
are cleaned after drills. Restored initial batch: 41 tests in three files,
exit 0, repository default timeouts. No timeout override was used.

Full quality belongs to the lead under common.md and PLAN section 7. The
Windows tree-reader residual (SPAWN017C below) remains open, so this record
does not certify a regression-free runtime release.

Implementation commit e50ef9f49 passed the installed lint-staged and gitleaks hooks. The staged and committed source differences were re-read. Native account/job and boundary batch passed 14 tests; the subsequent login/runtime/resource-host batch passed 73 tests. Final bootstrap/runtime/Help boundary batch passed 15 tests, including an actual spawn spy proving zero compiler launches at governor pause.

Cold-replay follow-up: the first complete-file idle sequence passed twice,
then loop 3 failed seven identity/admission cases when bounded Get-Process
probes exhausted their existing deadline. The rename regression itself was
not the failure. Diagnostics.Process reads the same native birth identity
without PowerShell module discovery; absence remains an ArgumentException
with no invented identity. All deadlines remain unchanged. Its selector
regression and red drill reject the old module-dependent command.

Additional red drills exited 1 with byte-exact restoration: taskkill /T
removed, compiler output cap removed, and birth lookup changed back to
Get-Process. An initial no-/T control passed because Node's attached Windows
child lifetime killed that fixture independently. The corrected fixture
uses a detached Windows descendant (POSIX retains the same group), with the
same explicit root/descendant absence assertions and owned PID cleanup;
now removing /T fails both deadline and cancellation cases. Output refusal
is asserted by its distinct internal code before the injected deadline,
so a later timeout cannot masquerade as an output-cap failure.

Final history replay on source commit `5128960ad`: 30/30 idle and 30/30
loaded complete-file runs exited 0, 35 tests each (2,100 test executions).
Loaded mode kept three owned CPU workers busy for the full sequence; they
were retired in finally. No other test/typecheck/lint/build ran concurrently.
Maximum complete-file elapsed time was 13,083 ms idle and 10,174 ms loaded.
These are whole-suite durations, not raised test deadlines. The earlier
three-run failure is retained above and excluded from this successful sequence.

The final vault guard regression also checks both private-storage preparation
attempts refuse before launch at pause. Removing bootstrap admission makes
the complete bootstrap file fail (exit 1); SHA-256-identical source restoration
was verified. Native vault fixtures explicitly inject their admission lease,
retaining the real public guard/compiler and all existing native assertions.
The native vault/account/bootstrap repeat passed 59 tests at repository
timeouts, exit 0. Queue/containment and pause have separate production-boundary
tests; this fixture transport is not a claim of an installed vault broker.

Final item map (source and test lines are at qualified commit `19e889372`):

| Item                    | Code                                                                                                                                                 | Regression and result                                                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Bootstrap tier        | `src/core/resources/bootstrap.ts:15`, `src/host/backend/jobBuild.ts:43`, `src/host/vault/slots/windowsVaultBuild.ts:34`                              | `spawnBootstrap.test.ts`: six cases pass; native root/child deadline and cancellation, output bound, compiler admission and both vault guard preparation attempts.                                                           |
| 2 Runtime admission     | `src/runtime/resources/load.ts:95`, `src/runtime/main.ts:1584`                                                                                       | `spawnRuntimeAdmission.test.ts`: real queue and zero spawn at pause pass. `scheduleEvents.local.test.ts:81` failed here (`Unavailable: gitRefs`); root cause and repair: SPAWN017C below.                                    |
| 3 Unavailable builders  | `src/extension.ts:2074` and `:3363`, `src/host/media/previewPanel.ts:129`, `src/shared/featureCatalog.ts:29`, `src/shared/l10n/en.ts:425` and `:483` | `recordingPreview.test.ts`, `vault/vaultPanelBundle.test.ts`: 23 pass. `spawnBoundaries.test.ts:28` checks honest Help. PLAN M105 W final status, M105-R1-integration, M109 W service handoff; neither builder is installed. |
| 4 History race          | `src/core/reporting/history.ts:464` and `:116`                                                                                                       | `reportHistory.test.ts:554` retains displaced-creator assertions; birth selector at `:189`. Thirty idle plus thirty loaded whole-file runs pass, 35 tests each. No added sleep/retry/deadline.                               |
| 5 Runtime openers/login | `src/runtime/main.ts:639`, `:652`, `:1341`                                                                                                           | `spawnBoundaries.test.ts:21` guards the adapter/import boundary; `acpRuntime.test.ts` retains synchronous/async login lifecycle assertions. The complete login/runtime/host batch passes 73 tests. No OS-handoff exemption.  |

Fresh local clone at `19e889372`, `CI=true`, ordinary npm ci exit 0;
901 packages, existing audit reports 2 low and 9 high findings. No dependency
changed. Each gate below ran serially on win11. Complete test files use the
repository's own timeout settings; no CLI timeout override or test filter.

| Gate                                 | Exit | Receipt                                                                                                                   |
| ------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------- |
| typecheck:host                       | 0    | 46,597 ms                                                                                                                 |
| typecheck:webview                    | 0    | 18,251 ms                                                                                                                 |
| typecheck:unit                       | 0    | 103,787 ms                                                                                                                |
| typecheck:e2e                        | 0    | 38,038 ms                                                                                                                 |
| typecheck:integration                | 0    | 12,989 ms                                                                                                                 |
| Changed-file ESLint --max-warnings=0 | 0    | 25 TypeScript files                                                                                                       |
| Changed-file Prettier                | 0    | 47 files; final documentation additions checked separately                                                                |
| Plain knip                           | 0    | Two existing configuration hints                                                                                          |
| Full jscpd                           | 1    | Four inherited clones; baseline b6e717f74 also exits 1 with the same four pairs. The six files have no diff against base. |
| check:l10n                           | 0    | 14 UI/14 usage tables, 0 problems                                                                                         |
| check:host-api                       | 0    | 378 APIs, 49 vscode files, 30 Node built-ins, 71 theme variables; 0 problems                                              |
| check:reference                      | 0    | 77 features, 69 commands, 100 settings, 29 slash commands, 257 CLI rows; current                                          |
| Production build                     | 1    | Existing candidate caps listed below; none changed                                                                        |
| Bootstrap/runtime/boundaries         | 0    | 16 tests, three files                                                                                                     |
| Login/runtime/resource host          | 0    | 73 tests, three files                                                                                                     |
| Unavailable recorder/vault           | 0    | 23 tests, two files                                                                                                       |
| Native vault/account                 | 0    | 53 tests, two files                                                                                                       |
| Real-Git schedule events             | 1    | 11 pass / one failure at `19e889372`; repaired by SPAWN017C below                                                         |

Fresh tests total 176 passed / one failed at `19e889372`. The passing history replays are
additional. Nine deliberate red drills all exit 1 with byte-exact source
restoration; the earlier attached-child control's exit 0 is excluded and
documented above. Structured timings and exit codes are in
`int0170-spawn2-receipts.json`.

Measured budgets: extension 582.6/600 KiB, resourceGovernor 112.9/125 KiB,
scheduleBackground 49.0/50 KiB and checkpointStore 83.3/225 KiB. Build fails
on reporting 255.3/175, reportingNetwork 167.6/75, runtimeQuestions 25.5/25,
conversation 255.0/250, runtimeEngine 895.6/875, usagePanel 83.3/75,
headless 100.7/100, runtimeAccounts 341.2/300, webview surface English
26.9/25, Palette 25.7/25 and estimator panel just above 25/25 KiB.
No cap is raised. Size failure stops the chained build before split/global
and notices checks; this record does not claim those later checks ran.

Implementation/test commits: `e50ef9f49`, `5128960ad`, `19e889372`.
Their installed lint-staged and gitleaks hooks exited 0; staged and committed
differences were re-read after each hook. Aggregate quality remains lead-owned.
Existing duplication and candidate caps remain release blockers; the
schedule refusal and its Windows residual are recorded in SPAWN017C below. This lane does not certify a complete runtime
release. Final documentation formatting is checked separately and committed
through the same installed hooks; the final report names that receipt commit.

Cleanup: the verified scratch root is a plain directory, not a link, at
`C:/Users/Randy/AppData/Local/Temp/l-SPAWN017B`. Automatic approval review
rejected both checked-path and literal-path recursive PowerShell removals
before execution, with the reason "blocked by policy" and no more specific
explanation. The baseline/qualification clones, one owned runtime fixture
directory and raw scratch logs remain there. No alternate-shell bypass was
attempted. Structured receipts above were preserved in git before cleanup.

### Root cause of the real-Git refusal (SPAWN017C)

Windows 11 host plus the Kubuntu, Mac mini and win11 rigs; branch
`rel017/spawn3` from `fb0b12aa3`. No push, live or paid call, credential,
dependency, gate, cap, hook or timeout change.

**Reproduction at `fb0b12aa3`.** `scheduleEvents.local.test.ts:81` fails on
every platform, in two ways. Kubuntu and the Mac mini refuse within 0.2 s
with `Unavailable: gitRefs`. A scratch probe showed the hidden error:
`spawn <checkout>/src/core/native/linux/x64/muse-created ENOENT` (macOS:
`src/core/native/darwin/muse-dictate --created-directory`), raised by a temp
root's manifest `publish`. On win11 and on the host the case times out at
15 s: one governed `git --version` takes 2.5–2.9 s on win11 (11–31 s on the
loaded host). So the failure is not Windows-only.

**Root cause.** `execResourceFile` admitted every bounded command as
ordinary work (base `commands.ts:24`, `process.ts:12`). Ordinary admission
allocates a per-tree temp root (base `launchHost.ts:349`). Each root costs
six native created-file operations: intent publish, create and publish,
then finish publish, remove and publish (`createdRegistry.ts:447`, `:553`,
`:576`). The governor resolves the POSIX helper relative to its own module
(`resourceGovernorEntry.ts:99`, `:129`). That path exists only in packaged
layouts, where the VSIX and the ACP package stage `native/` beside `dist/`.
It is absent from a source checkout and from the CI unit job, which has no
build step. On Windows each operation is a cold PowerShell assembly load,
and each first calls `windowsJob()` (`resourceGovernorEntry.ts:103`). The
runtime's `windowsJob` (base `load.ts:93`) built fresh helper factories on
every call (`entry.ts:41`, `:42`). Every call therefore re-ran the
PowerShell join self-test and the MCP executable self-test: about thirteen
cold process starts per governed Git command. Binding admission exposed
this path; moving the registry changed its location, not the helper or its
cost, so neither earlier attempt could help.

**Repair.**

- `src/core/resources/process.ts:21` adds `spawnResourceCommand`, used by
  `commands.ts:24`. Bounded commands keep `admitResource` admission, Windows
  job or POSIX group containment, whole-tree retirement and stop. They take
  the temp-free tier bootstrap already used (`admission.ts:77`,
  `launchHost.ts:118`, `:297`, `:350`). Ordinary launches still call
  `admitResource('other', signal)` and still get a temp root. PLAN D87.14
  records the narrowing.
- `src/runtime/resources/load.ts:84` prepares the runtime's Windows job
  helpers once per binding, as the extension does at activation. It shares
  an in-flight preparation and retries a failed one.
- `src/core/schedules/events/git.ts:120` keeps the fixed `gitRefs` reason
  and attaches the actual refusal as `cause`; the message itself is unchanged.

Measured on win11 over 13 governed reads: memoized helpers with temp roots
took 72.7 s; with both repairs, 11.2 s (0.7–0.9 s per read).

**Regressions** (`test/unit/spawnRuntimeAdmission.test.ts:70`, `:130`,
`:154`). They prove one helper preparation with a retried failure, a bounded
command admitted through the runtime queue without `TreeTempRoots.create`,
and the refusal kept as `cause`. On `fb0b12aa3` sources, with only this file
copied, each rig gave 3 failed and 1 passed: four preparations instead of
two; POSIX helper ENOENT, or `create` called once on Windows; no `cause`.

**Red drill.** With the six repaired sources set back to their `fb0b12aa3`
bytes, Kubuntu and win11 each exited 1 with 4 failed and 12 passed: the
three regressions plus the real-Git case (a 106 ms refusal on Kubuntu, a
15,012 ms timeout on win11). After restoration all six SHA-256 sums matched.

**Gates on the final code.** The rigs were shared with other lanes. Each
vitest call ran at most three files with repository timeouts.

| Gate                                                        | Exit     | Receipt                                                                                                                    |
| ----------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| scheduleEvents.local, three runs                            | 0        | Real-Git case: Kubuntu 710/714/768 ms, Mac mini 1,091/1,086/1,173 ms, win11 12,471/12,375/14,566 ms (quieter: 10.7–11.3 s) |
| spawnRuntimeAdmission, 44 schedule\* and unattended\* files | 1 (base) | Only failures that reproduce on untouched `fb0b12aa3` on the same rig; see below                                           |
| Related resource and spawn suites                           | 1 (base) | Same; spawnGovernance, spawnBoundaries, spawnBootstrap and spawnRuntimeAdmission pass on every rig                         |
| Five typechecks                                             | 0        | host 168 s, webview 102 s, unit 473 s, e2e 227 s, integration 79 s                                                         |
| ESLint `--max-warnings=0`                                   | 0        | Seven changed TypeScript files                                                                                             |
| Prettier                                                    | 0        | Seven TypeScript files, PLAN.md, CHANGELOG.md, this record                                                                 |
| jscpd, changed files                                        | 0        | Seven files, zero clones                                                                                                   |
| Plain knip                                                  | 0        | Two existing configuration hints                                                                                           |
| check:host-api                                              | 0        | 378 APIs, 49 vscode files, 30 Node built-ins, 71 theme variables; 0 problems                                               |

The inherited failures, each reproduced on `fb0b12aa3` on the same rig:
schedulePaid (three cases, every rig); deferredBundles (three);
modelApiHost (two); nativeScheduleBackground (one or two);
windowsVaultTransport (three); windowsVaultNative ACL cases and the
scheduleStore junction EPERM (win11). Also inherited: the suite-level native
helper refusals of resourceDiskAdmission, resourceMuseLifecycle and
resourceWindowsLaunch (win11), and the Mac mini's load-sensitive
scheduleMigrate, scheduleStore and scheduleRuntime cases (base: seven and
eight failures there). Two Kubuntu scheduleMigrate timeouts under shared
load passed on re-run, 74 of 74. A first cut changed the ordinary admission
call that spawnGovernance asserts; restoring that call shape fixed it. After
one 15 s timeout under shared load, it passed 20 of 20 on win11.

**Windows residual, not certified.** Limited to four CPUs (affinity 0xF on
win11, the hosted-runner size), the real-Git case still times out: 15,013 ms
and 15,039 ms. Each governed Windows launch still starts the MCP job
launcher (0.2–0.35 s). It also queues up to six cold PowerShell tree
queries (root, membership, members, usage, retirement twice) of 0.25–0.43 s
each; traces show about three per command. That is the T reader's per-query
design (`trees/windows.ts:43`), shared by every governed Windows launch.
Removing it needs a persistent native reader or launcher-attested job-empty
retirement. That is a redesign for the lead, not another patch, so hosted
Windows CI may still fail this case.

Cleanup: the scratch probes, the base worktree, and the win11 one-off task
with its command file are removed. Raw receipts stay in the session
scratchpad.
