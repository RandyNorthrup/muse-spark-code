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

Updated by SPAWN017B; historical receipts below retain their original results.

The inventory searches spawn/exec/fork/child-process imports in existing
files added or changed since `4da4ef666`; deleted paths are excluded.

| Site                                                       | Governance and containment                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/backends/musecode/MuseCodeHost.ts`, account MSP      | Repaired: account transport through `spawnResourceAccountConnection`; native job plus observed retirement.                                  |
| `host/backend/museCodeBackendManager.ts`                   | Both account and ordinary paths share the MSP resource launch boundary.                                                                     |
| `host/auth/accountHost.ts`                                 | Existing short-lived account path already uses `spawnResourceMuseConnection`.                                                               |
| `core/backends/modelapi/mcp/pool.ts`                       | Delegates ordinary stdio to the host builder and credentialed stdio to the vault port.                                                      |
| `host/backend/mcpServers.ts` and `mcpProcess.ts`           | Existing MCP admission/job/group boundary; new broker builder joins it.                                                                     |
| `host/backend/mcpVault.ts`                                 | Repaired production vault stdio builder; authorization, scrub, expiry and revocation retained.                                              |
| `core/media/convert.ts`, probe and encoder                 | Repaired: `spawnResourceProcess`; native payload PID is queried for RSS rather than sampling the launcher.                                  |
| `core/media/record/macos.ts`, two injected spawn calls     | Honestly unavailable: M105 W leaves all installed recording drivers unbound; Help now says direct recording is unavailable.                 |
| `core/reporting/history.ts`, identity probe                | Repaired: bounded `execResourceFile`, resource admission and contained helper.                                                              |
| `core/reporting/sources/github.ts`, gh reads               | Repaired: same bounded command adapter; credential-stripped environment retained.                                                           |
| `core/schedules/events/git.ts`, three Git reads            | Repaired: same adapter; trust and stable-read checks retained.                                                                              |
| `runtime/reporting/sources.ts`, Git reads                  | Repaired: same adapter; nonzero results and bounds retained.                                                                                |
| `runtime/schedules/nodeBackgroundIo.ts`, OS commands       | Repaired: same adapter; credential stripping and fixed program resolution retained.                                                         |
| `runtime/schedules/nodeBackgroundIo.ts`, maintenance child | Repaired: resource process boundary, group containment, detached lifecycle retained. Native Darwin maintenance qualification is still owed. |
| `core/vault/broker/peer.ts`, Unix peer helper              | Repaired: resource process boundary with the exact inherited socket descriptor.                                                             |
| `runtime/vault/slots/macVaultTransport.ts`                 | Repaired: resource process boundary; private binary pipes and empty payload environment retained.                                           |
| `runtime/vault/slots/windowsVaultTransport.ts`             | Repaired: job-backed guard process; readiness/digest checks still precede private input.                                                    |
| `host/vault/vaultExecSpawn.ts`                             | Honestly unavailable: M109 W has no broker-backed service or installed feeder; commands refuse closed and Help names the absent broker.     |
| `core/orchestration/playbook/modules.ts`, rename Git reads | Repaired: ordinary hook admission and required contained runner on Windows; POSIX tree supervisor otherwise.                                |
| `core/orchestration/playbook/outcomes.ts`                  | Existing contained hook/Git runner; its child-process imports are types.                                                                    |
| `host/team/acpProcess.ts`                                  | Existing `TeamChildLauncher` admission and contained transport.                                                                             |
| `host/backend/toolIo.ts`                                   | Existing governed shell/resource command adapter; the original raw spawn is behind that boundary.                                           |
| `host/processTree.ts`, native probes and POSIX supervisor  | Existing native containment/probe infrastructure, including the supervisor's payload spawn.                                                 |
| `host/backend/jobBuild.ts`                                 | Bootstrap tier: shared runBootstrap, heavy admission, bounded output/deadline, OS whole-tree termination and observed exit.                 |
| `host/vault/slots/windowsVaultBuild.ts`                    | Bootstrap tier: the public-source guard and job compiler both use the same admitted bootstrap runner.                                       |
| `runtime/main.ts`, browser opener and login terminal       | Governed: runtime login and Linux browser handlers use spawnResourceProcess; Windows/macOS OS openers use bounded execResourceFile.         |

The bootstrap entries above and the runtime's still-unbound global resource
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
   The real-Git schedule assertion remains failing: the first binding attempt
   reached native created-file publication refusal; moving the registry under
   machine storage did not restore the test. Common.md's two-failed-fixes rule
   stops this path. Its assertions and deadlines are unchanged. This native
   publication defect is a release blocker; admission is never bypassed.
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
native schedule publication failure remains explicitly blocked, so this
record does not certify a regression-free runtime release.
