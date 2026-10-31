# RLF-TEAMFIT — fit the four over-budget bundles on int, and re-prove three team behaviours on real parts (2026-10-30)

Lane `RLF-TEAMFIT`, worktree `/Users/randy/lanes/RLF-TEAMFIT`, branch
`rec/rlf-teamfit`, on the test rig `macmini`. Base: int/recovery
`0a5ebd7189` (CC-INT5, `docs/certification/cc-int5.md`, whose known failures
are not counted here). Model attempts: **0**. Provider calls: **0**. Muse
requests: **0**. Nothing pushed, rebased, stashed or tagged. The vault and
real credential-store suites were not run (not in this lane's related set);
no browser or GUI app was started. Scratch files (drill backups, logs) lived
in the worktree's ignored `temp/`.

## 1. Part 1 — the four bundles fit, no budget raised

Measured with each bundle's esbuild metafile (`dist/meta/*.json`), then
fitted by structure. Sizes are the size gate's own rows (production build).

| Bundle                  | Before                | Budget | After                     | How                                                                                                                                                                                                                                                                      |
| ----------------------- | --------------------- | ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dist/teamHost.js`      | 140.2 KiB (143,526 B) | 130    | **122.5 KiB** (125,431 B) | The `team` MCP server loads in its own `dist/teamMcp.js` on the first endpoint request; the server, its roster answer and the host service read tool definitions, argument parsers, roster text and the JSON-RPC handler from `dist/team.js`, which already carries them |
| `dist/teamRunners.js`   | 78.4 KiB (80,329 B)   | 75     | **33.3 KiB** (34,134 B)   | The Traffic read and dispatch (with the models-panel schemas, 14.0 KiB of the overage) load in their own `dist/teamTraffic.js` on the first Traffic use, behind the runners runtime's same members                                                                       |
| `dist/teamScheduler.js` | 76.5 KiB (78,313 B)   | 75     | **60.2 KiB** (61,631 B)   | Loads only through the team runtime, so its build now reads the shared team schemas from the already-loaded `dist/team.js` (the runners' existing rule), instead of second copies of `shared/team` and `shared/teamView`                                                 |
| `dist/uiText.js`        | 125.3 KiB (128,341 B) | 125    | **123.8 KiB** (126,736 B) | The watchdog's English group (terminal command text, read only when that command runs) rides the runtime region (`dist/uiTextRuntime.js` 9.7 → 11.4 of 25 KiB)                                                                                                           |

New bundles with measured budgets of their own (D6: measured ×1.15, rounded
up to the next 25 KiB): `dist/teamTraffic.js` 48,241 B → 75 KiB;
`dist/teamMcp.js` 7,131 B → 25 KiB. `dist/team.js` grew 54.6 → 57.4 KiB
(budget 75) carrying the shared members once. The logger and two backend
helpers now import the secret scrubber from `src/shared/redact` directly, as
other host files do, so the `src/core/redact` compatibility shim is no
longer carried by two team chunks (the cohort ownership rule). CC-INT5's
reverted options were not retried: Traffic into `teamWindow.js` (87.1 KiB
there) and panel-key shuffling (83 B). The lazy registry (186 bundles, 294
loads), the split gate and host-globals stay green; the built bundles load
and construct a board, traffic runtime, MCP runtime and host through the
shared members (direct `node` requires of `dist/teamWindow.js`,
`dist/teamScheduler.js`, `dist/teamMcp.js`, `dist/teamRunners.js`,
`dist/teamHost.js`, exit 0).

## 2. Part 2 — three behaviours re-proven on real parts, and two breaks fixed (D229)

`test/unit/teamHostRealParts.test.ts` (3 cases): the real
`createTeamHostService`, the real window scheduler, the real engine merge
ports (plan, merge, diff, discard over the real git binary), real git
repositories and a real JSON state file in temporary folders, and worker
processes that are real child processes writing inside the real working
copies the production workspace helpers made. No model conversation runs;
the engine ports' `listModels`/`startWorker` and the paid port are
tripwires (the entries pay locally), and the card port records what the
person's surface would show. The full dispatch through a real worker turn
stays the live drill's.

- **finalAdmit.** Trust flips during launch's own persistence await (the
  state update that first records the task running withdraws it): no worker
  process ever starts (no marker, empty start log), the task settles back
  to `queued`, the board counts no live attempt, and with trust restored
  the same task relaunches to `done`.
- **The ordered merge queue.** Two finished tasks enqueued low-then-high
  under a landing pause: the queue orders high first (its merge answer is
  position 1), one card opens at a time, and the recorded events are
  `enqueued, enqueued, landed(high), landed(low)` with both files landed
  in the real tree.
- **Plan before card.** The worker's outcome withholds one changed file;
  the card still lists the planner's real-git files with the protected
  flag. A moved agents ref then returns from the queue with no waiting
  card ever opened and the tree byte-identical.

Proving them found two product breaks the deleted fake suite could not see;
both are fixed (PLAN.md D229):

1. **A finished attempt could never land.** No worker port supplies a
   retirement proof, so the board kept the attempt counted and
   `scheduler.landed` threw busy for every merge and discard. The person's
   recorded landing decision now retires the attempt
   (`retireAttemptByDecision` in `decideMerge` and `discard`), releasing
   the retained admission slot with it.
2. **A refused admission leaked its scheduler slot.** The launch gate
   marks the slot running before start; a final-admission refusal refunds
   the board attempt (`cancelUnstarted`) but nothing released the slot or
   lease, so the same attempt number keyed a duplicate refusal forever.
   `TeamScheduler` now releases slot, lease and activity when start
   reports `notStarted` with the attempt off the board.

## 3. Red/green drills

Each: one break, the owning check's non-zero exit, byte-exact restore
(`cmp` against a copy in `temp/`), green again in the final runs.

| Break                                                             | Caught by                                                                                                        | red | green |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --- | ----- |
| Second `finalAdmit` after persistence removed                     | final-admission case (`expected 'failed' to be 'queued'`: the worker launched untrusted)                         | 1   | 0     |
| Merge-queue priority order reversed                               | queue case (high's position 2, expected 1)                                                                       | 1   | 0     |
| `merges.plan` call skipped in the merge flow                      | plan case (card listed only the outcome's `feature.ts`)                                                          | 1   | 0     |
| `retireAttemptByDecision` call removed from `decideMerge`         | queue case (the original "already being merged or discarded" throw)                                              | 1   | 0     |
| Scheduler slot release disabled (`&& false`)                      | final-admission case (refunded task stays `queued`)                                                              | 1   | 0     |
| `teamSchedulerFieldsSchema` removed from `teamEntry`'s re-exports | `check-bundle-split` ("teamScheduler.js reads teamSchedulerFieldsSchema from team.js, which does not export it") | 1   | 0     |

## 4. Gates (final tree)

Exit codes are each command's own; suites run with the repository's own
timeouts, `--maxWorkers=3`, at most three files per invocation.

| Command                                                   | Exit | Result                                                                                                                                                   |
| --------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                                           | 0    | every size row holds (table in §1); tokens, split, lazy registry (186 bundles, 294 loads), host-globals, notices (93), legal records (167 bundles) green |
| `npm run typecheck`                                       | 0    | six projects, no errors                                                                                                                                  |
| prettier + eslint `--max-warnings 0` on all touched files | 0    | (also enforced by the commit hooks)                                                                                                                      |
| `node scripts/check-l10n.mjs`                             | 0    | 14 UI tables, 14 usage tables, 0 problems                                                                                                                |
| `npm run check:reference`                                 | 0    | current                                                                                                                                                  |
| `npm run check:host-api`                                  | 0    | 392 VS Code APIs, 0 problems                                                                                                                             |
| `npm run check:plan`                                      | 0    | 244 milestones, 0 drift                                                                                                                                  |
| `npm run check:roadmap`                                   | 0    | 244 entries, current (after `roadmap:generate`)                                                                                                          |
| `npm run check:catches`                                   | 0    | counts match baseline; nothing rose                                                                                                                      |
| `npm run duplication`                                     | 0    | 0 clones (the engine-ports construction shared into `helpers/realTeamGit.ts`)                                                                            |
| `npm run cycles`                                          | 0    | no circular dependency                                                                                                                                   |
| `npm run deadcode`                                        | 0    | knip clean (tag hints only)                                                                                                                              |

| Command                                                                                                                           | Exit | Result                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/package-vsix.mjs --target win32-x64` (zopfli 0.4.3 in a venv under `temp/`)                                         | 0    | VSIX: 4,363,034 bytes (budget 4,915,200; CC-INT5: 4,362,815 — two new bundles, smaller hosts)                                                                                                                                                                                                                                             |
| `npm run package:acp -- --target win32-x64`                                                                                       | 0    | 142 of 142 packaged-bundle checks (CC-INT5: 141; +1 for `teamTraffic.js`)                                                                                                                                                                                                                                                                 |
| Touched suites                                                                                                                    | 0    | `teamHostRealParts` (3), `teamMoveTask` + `teamMcpWiring` (with the real-parts file: 7), `teamLandingPause` + `teamLandingKilled` + `teamSchedulerRecovery` (5), `teamSchedulerRecovery`/`Schemas`/`Borrowing` (114), `resourceRelocationDevices` + `lazyBundleFiles` + `teamMcpWiring` (31), `teamChunkPackaging` + `acpTeamPackage` (7) |
| `npx vitest related <17 changed sources> --run` (`extension.ts`'s 3-line change covered by typecheck, build and the wiring suite) | 1    | 462 files, 4,795 passed, 70 failed, 219 skipped in 1,372 s; every one of the 28 failed files classified in §4.1 — no regression from this lane                                                                                                                                                                                            |

### 4.1 The related run's 28 failed files, classified

Each was either in CC-INT5's known-red/environment list, re-run identically
on the untouched base (`git archive 0a5ebd7189` under `$TMPDIR`, this
worktree's `node_modules` and `dist` linked, removed after), or a load
timeout that passes alone:

- **CC-INT5's list, unchanged readings:** `acpServeHandshake`,
  `connectorStorageGuard`, `createdRegistryRace`, `execTeamSweep`,
  `nodeCertificate`, `nodeToolHost`, `nodeWorkspaceDevcontainer`,
  `playbookGovernor`, `playbookSchedulesInputs`, `resourceCreatedSweep`,
  `resourceHandoffDeadline`, `resourceStatusCpu`, `runtimeLsp`,
  `scheduleFileWatcher`, `scheduleFireFailures`,
  `teamPlaybookIntegration`.
- **Identical on the untouched base:** `playbookWindow` (5, "playbook
  unavailable" from `renamedFiles`), `playbookContainedJob` (2, macOS group
  sweep), `providerHeadersStore` (3, OS credential store in the lane
  environment), `teamPlaybookRounds` + `schedulePauseAfterFailures` +
  `treeSyncNoDeadline` (base 6 failed, this tree 4),
  `treesLifecycleNative` + `vault/vaultStoreScope` +
  `vault/writerCrashPosix` (19 on both).
- **Load timeouts, green alone:** `estimatorPricePackaging` (its one test
  passed in the related run; the cleanup hook timed out),
  `lintStagedBatching` (5 s limit; alone 1,845 ms), `teamEnginePorts`
  (three 5 s timeouts in the related run; alone 15 of 15).

## 5. Not claimed, not run

- No real team run through the packed product (CC-INT5 §8 item 3 stands);
  the packed product was not driven with a model conversation.
- No CHANGELOG line: teams are not in a release yet, and nothing here is a
  change a person on a shipped build can see; the two fixes repair
  pre-release int behaviour (PLAN D229 records them).
- Windows legs (hosted CI) must still confirm the merged tree, including
  the new bundles' sizes there.
