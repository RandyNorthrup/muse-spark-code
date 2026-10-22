# MSM96 — milestone integration (2026-10-17, linuxlt)

Lane branch `ms/msm96` resumes after the 2026-10-16 power outage from
`rigs/kubuntu/c/m96-join` (`132679ac7`). Main is merged twice
(`13e126506`, then `821566c0f`, then `3d30a7321`), then the two
unmerged candidates. All commits carry hooks and the Muse trailer.

## Merges (what came from which branch)

- `c1caaf775` + `c26208ab0`: main `13e126506`, then main-now
  `821566c0f` (4 more commits). One hook-caught reorder
  (`src/host/extensionHooksRunner.ts`: `teamEvent` joins the public
  methods after the privates). 930 staged deletions verified absent
  from main: the test-overhaul deletions stay deleted.
- `9ecccbb50`: `cand/MSM96/3` (m96-3, `96709ef61`). Late worker
  admissions recheck their request after each async wait and release
  the late unsent claim exactly once
  (`src/core/backends/modelapi/ModelApiHost.ts`,
  `src/host/team/teamEnginePorts.ts`). Its round-7 regression tests
  import helpers the overhaul deleted (`fakeAgent`, `sessionTurns`,
  `teamGit`, `modelApiHostDeps`), so they stay out; the reviewed
  drills remain in `docs/certification/m96-3.md` round 7.
- `f6453a9d7`: `cand/MSM96/1` (m96-newfiles, `fe9bbd8b4`, 18
  commits). Engine and ACP workers create new files through the
  verified native helper (`src/core/team/workers/workerOps.ts`,
  `workerCreateEntry.ts`, `teamCreate`/`teamWorkerOps` chunks).
  Resolutions: deferred regex and notices header union both sides;
  `team-workers` host capabilities follow main's delisting (empty, in
  progress) with the reference regenerated; roadmap and spawn table
  regenerated from sources. Fake-based suites the overhaul deleted
  stay deleted; the real-native `createdNative` helper is kept, and
  `createdNativeWindows.ts` returns beside its consumers (string
  interleavings in the real helper, no stand-ins).
- `006c7353a`: main-now `3d30a7321`. Generated reference rebuilt.

## Outage triage (kept vs dropped)

The stopped run left an unfinished main merge plus 170 unstaged
deletion-only worktree edits (100 deleted files, 66 gutted, 4
re-added-then-deleted). 169 of 170 reference nothing main deleted
(the last is `test/e2e/acpStdio.e2e.test.ts` importing the surviving
`helpers/fakes`, a false positive): every one exists on main, so all
170 were restored from the index and the merge was concluded. The
staged side was verified file by file (930 deletions all absent from
main; M96 engine code intact).

## Fixes this lane

1. **The team host ships the engine chunk it loads** (`.vscodeignore`
   gains `!dist/teamEngine.js`). `dist/teamHost.js` lazy-loads
   `dist/teamEngine.js` since port 4, but no package shipped it:
   enabling a team would fail at the import. The chunk gate
   (`test/unit/teamChunkPackaging.test.mjs`) now maps the engine
   entry and reads the ACP ship list from its moved home
   (`scripts/lib/acpBundles.mjs`). Red: 4 failures on the merged
   graph, including the unshipped reachable chunk. Green after.
2. **Conversation back under budget** (263.9 → 248.1 KiB of 250, no
   cap changed). New conversations validate the saved orchestrator
   override through a lazy team-chunk import
   (`src/host/conversation/conversationController.ts`, re-exported
   from `src/core/team/teamEntry.ts`), so the orchestrator slot,
   team schemas and model settings leave `dist/conversation.js`;
   `dist/team.js` absorbs 0.9 KiB (53.2 of 75). Built artifact keeps
   `import("./team.js")`; only the injected deps port stays inline.
   New regression in `test/unit/teamRuntimePackage.test.mjs`: the
   packaged `team.js` exposes `validateOrchestratorSettings`. Red
   drill renamed the re-export (expected 'undefined' to be
   'function'); restored byte-exact (SHA-256 `1a564bde…c4675ce8334c`).
3. **Surface English back under budget** (25.3 → 24.7 KiB of 25).
   The 23 team UI keys the M96 panels read were missing from the
   `teamKeys` allow-list (`scripts/lib/uiTextRegions.mjs`) and rode
   in surface English; they travel with team configuration English
   (1.9 of 25 KiB). Proven by decoding both surface chunks and
   diffing the key sets.
4. **Saved role ids keep their canonical pattern**
   (`src/shared/team.ts`). The schema move from `teamConfig.ts`
   dropped `AGENT_ID_PATTERN` while its regression
   (`test/unit/teamOrchestratorSlot.test.ts`, from `13185f7d8`)
   stayed: 4 failures. Restored the check; the suite goes green
   unchanged (25 tests).
5. **Every UI table follows English key order** (`l10n/ui.*.json`,
   14 files, pure reorder). The packaged archive derives order from
   English and the round-trip gate compares byte-exact: 14 failures.
   Plural variants keep their own order, as the archive reader does.
   Red: 14; green: all 95 `vsixPackaging` tests.
6. **Merged suites adapted to main's types**: exact branded dollars
   (`Usd.from(n).toAmount()` in `teamHostService.test.ts`, 77 green),
   usage journal version 2 (`teamModelRegistry.test.ts`, green), one
   duplicated import (`TeamTree.test.tsx`), the money-structure gate
   returns to main's converted file plus 7 M96 offer-rate entries
   (46 green), the composition suite follows `processTeamGit` to
   `workerOps.ts`.

Left out with the overhaul (fake-based, helpers gone, cannot lint
or run here; drills stay in their records): `teamEnginePorts`,
`teamResponseAccounting`, `teamTry`, `deferredBundles`,
`teamAcpProcess`, `teamAcpWorker`, `teamWorkerFence` tests. Removed
`@unwired M96` where the host now calls the symbol (13 sites);
37 M96 markers remain for the sequenced slices (scheduler pick/retire
callers, ACP/Muse worker entries, merge planner, roles-file
loaders, team MCP server, slot checks, panel schemas), plus 5 M96c
ones (scheduler pick/retire, team traffic host messages, SSH runner
routing) owned by the M96c milestone.

7. **Knip triage to exit 0 without deleting a built feature**
   (`8bc6e3bba`). The reachability pass had removed four tags the
   static graph cannot trace: restored verbatim from `fb5e9ca7e^`
   (`workerFence` permission answer + approval classifier, the
   `acpWorker` fence re-exports, the `teamPool` lane-T orchestrator
   slot) — each verified to have zero static callers outside its own
   file and no dynamic importer. `workerOpsEntry.ts` joins the knip
   entry block as the `dist/teamWorkerOps.js` bundle entry
   `scripts/build.mjs` already bundles by path (the five flagged
   barrel members are that chunk's API surface, also imported
   directly from `workerOps` by tests and the native helper).
   `teamHost` destructures the lazy `teamMergeFlow` import so the
   call is visible; behaviour (install-fault refusal path) is
   unchanged. Two stale tags on now-wired symbols dropped
   (`teammateIdleFields`, called by `teamHost`; `acpFsWrite`,
   imported by two suites). One new tag for the planned stored-team
   reader (`TeamSnapshotReader`). A dead-destructure attempt in
   `workerCreateEntry` was reverted on `TS6198`. Result: `npx knip`
   exits 0; the only output is the 3 pre-existing configuration
   hints, identical on the `main-now` baseline. Root + unit
   typechecks pass; `teamWorkerCreate`/`teamHostService`/
   `teamWorkerToolIo` (208 passed, 28 platform skips) and
   `teamHookEvents`/`nativeProcessDefaults`/`teamGitClassifier`
   (22 passed) green; changed files lint-clean.

8. **Break the team import cycle the newfiles merge closed**
   (`9b977cc83`). `npm run cycles` failed: refFence → workerFence →
   workerCreateEntry → workerOpsEntry → workerOps → teamWorkspaces →
   refFence (all value edges; dpdm ignores the two type-only ones).
   `TeamGitError`, `isTeamGitError` and `TeamGit` move verbatim to the
   new leaf `src/core/team/teamGit.ts`; workerOps, teamWorkspaces,
   teamMerge and teamEnginePorts import from there. The alternatives
   were worse: the git classifier's helper closure is shared fence
   code, the ref-name builders belong to refFence, and the fence's
   creator/sweep calls are load-bearing chunk boundaries. Cycles exits
   0, knip still 0, root + integration typechecks pass,
   teamGitClassifier/teamHostService/teamEntries (105) and
   teamWorkerCreate/teamCleanup/teamLanding (137) green.

9. **Export the engine's cross-bundle reads; ship teamPanel.js**
   (`36e4d1ca7`). `npm run build` failed its split gate with five
   problems: teamEngine.js reads four fence authority members through
   teamHost.js and `retryAfterMs` through modelApi.js, and neither
   bundle exported them — a latent runtime break (undefined reads) on
   the hidden engine path, predating this lane (the engine's imports
   come from round 3; the host entry's three-name list from round 4).
   The entries document this exact fix: four more fence members join
   the team host entry's shared-authority re-export, `retryAfterMs`
   joins the Model API entry's transport list. Regenerating the lazy
   registry then showed dist/teamPanel.js loaded by activation and the
   Models panel but absent from the VSIX (the same latent gap as fix
   1); it ships now and the chunk-packaging map covers the panel
   entry as a root. Build exits 0 with every budget held
   (conversation 248.1/250, modelApi 510.2/525, teamPanel 92.9/100,
   teamHost 97.8/130, teamEngine 95.4/100 KiB, surface English
   24.7/25). Chunk, runtime-package, worker-create-bundle and both
   vsix suites green (5 + 3 + 97). Packed-product proof: the built
   `dist/teamHost.js` exports all seven fence members,
   `dist/modelApi.js` exports `retryAfterMs`, `dist/teamEngine.js`
   loads beside them, and all seven team chunks are built and on the
   VSIX ship list.

10. **Remove the nine test clones the merged suites carried**
    (`963ed457a`). `npm run duplication` (threshold zero) failed on
    intra-file setup repetitions in five files the merges added (none
    on main): a temperature-change helper, a queue drain, delegated-team
    and ceiling-pair helpers, production-tool and fill-failing helpers,
    and a byte-identical duplicated describe block (deleted, not
    extracted). The hook caught two more on the way: an unnecessary
    optional chain and a helper to move to file scope. Same calls in
    the same order; duplication exits 0 with no clones, unit +
    integration typechecks pass, the touched suites green
    (workerCreate 104 + 28 platform skips, hostService + quotaStamp
    86, rolesSection 52).

## Remaining slices (tags kept, and why)

Every kept `@unwired M96` marker was verified to have zero static
callers outside its own file and no dynamic importer. Wiring any of
them means choosing a call site, precedence or port the plan assigns
elsewhere; inventing one would break the plan's repeated
no-guessed-binding rules, so they stay declared, not hidden and not
deleted (owner's rule, 2026-10-14):

- Roles-file loaders (`roles.ts`: `loadRoles`, `offeredRoles`,
  `resolveRole`, `newRoleAsks`, `applyNewRoleCeiling`). The panel and
  new-conversation override read saved charters through `teamConfig`,
  not these file loaders; catalogue precedence is the loaders
  slice's design decision.
- ACP/Muse worker entries (`runAcpWorker`, `runMuseCodeWorker`,
  `createWorkerShellRunner`, `createReportCapture`,
  `checkWorkerDepth`, `workerServeArgs`, `pickOnceOption`,
  `confineAcpFsPath`, `acpFsRead`, `ACP_PRESETS`, the fence answer +
  classifier and the `acpWorker` re-export). No product surface
  spawns team workers yet (knip.jsonc M96 entry block); entries and
  native editor bindings are C-M96-5/M96b.
- Merge planner (`planTeamMerge`). The merge card calls
  `applyTeamMerge`; the planner binding is its own slice.
- Team MCP server (`TeamMcpServer`, `TeamMcpBridge`). Nothing
  instantiates the bridge yet.
- Slot checks (`requestCheckSlot`). Heavy-check governor slot; check
  paths not yet bound.
- Pool/scheduler internals (`teamCapKey`, `TEAM_DEFAULT_ENTRY`,
  `TeamOrchestratorSlot`, `formatSwitchRow`, `noteTeamFailure`,
  `selectTeamEntry`, `answerExhausted`, `TeamTaskQueue`,
  `buildHandoffBrief`, `notStaffedText`, `TeamSnapshotReader`,
  `classifiedToolNames`, `plannedConflicts`,
  `isTeamWorkspaceError`). Importers of these modules use only the
  untagged names (`teamHost` takes `recordTeamSwitch` et al.;
  `teamSchedulerEntry` takes `TeamScheduler`); the tagged internals'
  callers arrive with the scheduler (M96c) and fence-coverage (M78)
  bindings.
- M96c-owned (separate milestone, roadmap `M96c`): scheduler
  pick/retire functions, team traffic host messages, SSH runner
  routing preference.

## Gates (final tree, exit codes)

- Format (`format:check`): exit 0, whole tree.
- ESLint zero warnings (`npm run lint` = js:main + js:unit +
  js:tests + css + ps): exit 0. The pre-repair whole-tree count was
  18,057 errors: 18,056 in git-ignored `temp/l10n-builds-*` scratch
  from the l10n gate run (removed) and one nested ternary in the
  merged search worker (rewritten as a branch — the rule's autofix
  is stripped back off by prettier).
- Typecheck, all five projects (`tsc --noEmit` on root, webview,
  unit, e2e, integration): exit 0 each.
- Knip (`npx knip`): exit 0; only the 3 pre-existing configuration
  hints, byte-identical on the `main-now` baseline.
- Cycles (`npm run cycles`, dpdm): exit 0, no circular dependency.
- Duplication (`npm run duplication`, jscpd, threshold zero): exit 0,
  0 clones.
- `check:l10n`: 0 problems (14 UI + 14 usage tables). `gen-reference
--check`: current (74 features, 65 commands, 89 settings, 29 slash,
  244 CLI). `check:host-api`: 0 problems (381 VS Code APIs).
  `check:plan`: 0 drift (218 milestones). `check:roadmap`: current
  (218 entries).
- `npm run build`: exit 0, every budget held (conversation 248.1/250,
  modelApi 510.2/525, surface English 24.7/25, team 53.2/75,
  teamHost 97.8/130, teamEngine 95.4/100, teamPanel 92.9/100 KiB).
- `security:sast` (`SEMGREP_ENABLE_VERSION_CHECK=0`): exit 0, 533
  rules on 3,297 files, 0 findings.
- Unit suites (repository deadlines, ≤3 files/run), all green:
  teamHostService 77, teamModelRegistry, TeamTree 27,
  teamOrchestratorSlot 25, teamPanel 33, paidMoneyStructure 46,
  spawnInventory, teamWorkerCreate 104 (+28 platform skips),
  teamWorkerCreateBundle, workerNativeRunner, teamRuntimePackage,
  teamChunkPackaging 5, TeamCards + AgentMap 38, acpPermissionAsk 21,
  checkCommands 10 (+2 skipped), vsixPackaging + vsixCompression 97,
  lazyBundleFiles + packagedBundles 21, teamGitClassifier + teamEntries
  105, teamWorkerToolIo 27, teamCleanup + teamLanding 33, teamHookEvents
  - nativeProcessDefaults 22, searchWorker 10, teamRolesSection 52,
    teamQuotaStamp 9.
- `browserUiText`: 5 passed on a quieter rig (load ~8). The earlier
  single timeout under rig load 21 reproduces identically on the
  untouched baseline: environmental, repository default kept, no
  per-test timeout added.

## Real-life steps for the lead

Teams stay hidden (`museSpark.team` off unless explicitly true, latch
closed). With a Model API key and the switch on in a scratch
workspace: Models & Agents shows Roles/Agents after its readiness
checks; create a team, run it against the key, review the diff,
merge, and check the tally. Nothing here spent money or called a
model. Remaining lead receipts: the composition integration run
outside the sandbox (`teamComposition.test.ts`, uses the packaged
build), a real enabled-team run with cost, hosted three-OS gates,
and the UI look for the Roles section (no visual change in this
lane, so none taken).
