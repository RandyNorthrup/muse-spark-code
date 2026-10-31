# RLF-TEAMWORKERS3 — contributor models on the `own` preset, and a live caller for the heavy-check route (2026-10-31)

Lane `RLF-TEAMWORKERS3`, worktree `/Users/user/lanes/RLF-TEAMWORKERS3`, branch
`rec/rlf-teamworkers3`, on the test rig `MacBookPro.ivettnet`, in Claude Code
(Sonnet 5.5). Base: `rec/rlf-teamworkers2` at `a1cadc926` (RLF-TEAMWORKERS2,
`docs/certification/rlf-teamworkers2.md`; `rlf-teamworkers.md` §6 and §7).
**Muse requests: 0. Model turns: 0. Paid provider calls: 0.** The Muse Code host
the process-worker suite starts ran Muse Code's own `echo` provider with
`--no-session-log`, so no model request left the machine and no Muse session
record was written; the real packed agent ran with an empty home and no sign-in.
Nothing was pushed, rebased, stashed or tagged. The real OS credential-store
suites and the vault suites were not run (MacBook rule); no browser or GUI app was
started. Scratch files lived in the worktree's ignored `temp/`; every suite and
gate ran with `TMPDIR` set to the canonical path of this rig's temporary folder
(`/private/var/folders/…/T/rlf3-tmp`, not a link, outside the worktree).

## 1. What landed

| Piece                                                                                                                                                                           | Where                                                                                                                                                                     | Proof                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| The `own` preset adds `--allow-contributor-models` exactly when the pool entry's model id is a contributor-tier id the product's model table lists; every other entry gets none | `AcpPreset.contributorModelsSwitch`, `isListedContributorModel`, `acpSpawnArgs` (`workerFence.ts`), `spawnAcpAgent` and `runExternal` hand the entry's model id on        | `acpPresetSwitches` (17), `teamProcessWorkers` (the real packed agent's received arguments) |
| A Muse Code worker whose role has the checks group gets `run_checks` as a session MCP server of its own; a call waits for the governed check slot, runs, and frees it           | `workerChecks.ts` (server, token per task, `bridgeRunChecks` → `routeWorkerCheck`), `teamProcessWorkers.ts` (`buildCheckSlots` through `loadRunners`, `runMuse`)          | `teamWorkerChecks` (6), `teamProcessWorkers` (the real `muse serve` reads the endpoint)     |
| The check slots' process runner over the team's native process lifetime; the launch request gets an `attach` hook                                                               | `checkProcess.ts` (`checkProcessOver`, `proofOf` moved here), `processLifetime.ts` (`TeamLaunchRequest.attach`)                                                           | `teamProcessLifetime` (7, three new)                                                        |
| A worker's approval for the team's own `run_checks` is answered yes once                                                                                                        | `classifyMuseWorkerApproval` (`workerFence.ts`), `MuseWorkerApprovalAnswer` gains `allow`                                                                                 | `teamChecksApproval` (3)                                                                    |
| The governed slots' wait between asks has a suite that fails without it                                                                                                         | `governedTeamSlotsPoll.test.ts`                                                                                                                                           | §4, drills 20 and 21                                                                        |
| An install folder the setup never made is skipped, not an error                                                                                                                 | `CheckSlots.copyInstall` (`checkSlots.ts`)                                                                                                                                | `teamWorkerChecks` (checks with no `node_modules`)                                          |
| Shared pieces: the loopback MCP reply, the test process runner, the governor window rig                                                                                         | `answerMcp` (`mcpLoopback.ts`, also used by `teamMcpServer.ts`), `helpers/checkProcessProvedByExit.ts`, `helpers/governorWindow.ts`                                       | `npm run duplication` (0 clones; four found in the first draft)                             |
| Build and registry bookkeeping                                                                                                                                                  | `scripts/check-bundle-split.mjs` (`MODEL_API_MODEL_TEXT` read by `dist/teamProcess.js`), `lazyBundles.generated.ts` (one more load), `docs/ide-compatibility/host-api.md` | `npm run build`                                                                             |

## 2. Item 1: the `own` preset and a contributor-tier model

The lead's decision (TEAMWORKERS2 §7 item 2, option a): the person's explicit pick of
that model in the pool is the opt-in. `acpSpawnArgs` now takes the entry's model id
and, for a preset that carries a `contributorModelsSwitch` (only `own`:
`['--allow-contributor-models']`), appends it exactly when `isListedContributorModel`
holds: the id ends in `-contributor` **and** is an exact row of `MODEL_EFFORT_LEVELS`,
the product's table of the Meta models it lists (`muse-spark-1.2/1.3-contributor`,
`muse-wonder-1.0-contributor`, `muse-wonder-full-1.0-contributor`). A suffix on an id
the table does not know, a provider-qualified id (`meta/…-contributor`), a standard
Meta model, a model that is not Meta's and an entry naming no model get none. Any other
extra argument is refused as before. The host still refuses to start unless the
agent confirms that exact model id (`AcpModelSelectionError`).

What the suites show, with the real parts:

- `acpPresetSwitches`: the argument vector for each case; the real argument parser
  (`parseCommandLine`) given exactly that vector reads `allowsContributorModels`
  true for a listed contributor id and false for any other, with
  `noUserMcpServers` true in both.
- `teamProcessWorkers`: the packed agent started through the team's own launcher
  receives `--no-user-mcp-servers --allow-contributor-models` for an entry on
  `muse-wonder-full-1.0-contributor` and `--no-user-mcp-servers` alone for
  `muse-wonder-full-1.0`. A Node `-r` preload notes the arguments before the
  agent's own code runs (the agent itself is the real packed bundle), and the task
  reaches the agent's sign-in sentence, so its parser accepted them.

**Not shown here:** that the agent then _lists_ the contributor model. It reads the
catalogue only after its sign-in (`openHost`), which this lane may not use. The live
run's step 1 shows it. A contributor id the table does not list (a future
`muse-spark-1.4-contributor`) gets no flag until it is added to the table, which its
effort tiers need anyway; the task then fails at the model check, in words of the
existing error.

## 3. Item 2: the check route

**Where M96c routes a worker's heavy checks.** PLAN M96c (`docs/plan-archive/decisions.md`,
"Check slots and runners", and acceptance 25): an engine worker's test command runs in
a slot against a snapshot of its copy, after every shell guard; "**Muse Code and
external workers** get the bridge's `run_checks` tool". The code for it was built in
M96c lane O and had no caller: `bridgeRunChecks` (`mcpBridge.ts`), `routeWorkerCheck`
(`engineWorker.ts`), `loadRunners` (`teamEntry.ts`) and the construction of
`CheckSlots`. The team host binding's worker path is `createProcessTeamPorts`
(`teamProcessWorkers.ts`), where Muse Code workers were handed `bridgeServers: {}`.

**What is wired** (Muse Code workers; the engine route and external agents are §7):

1. `runMuse` asks `workerChecks.serve(task)`. A role without the checks group, or a
   person with no `museSpark.checkCommands`, gets nothing. Otherwise the worker's
   session starts with one MCP server, `muse-team-checks`, on a loopback endpoint
   whose token names the task; it is closed with the task and with the team.
2. A request is the bridge's `bridgeRunChecks` over the person's checks, the files the
   task changed (git's own status over its copy, or paths confined to the copy), the
   ref guard (`hasRefMove`; the commands are the person's own, so no other shell
   guard applies), and `routeWorkerCheck`, whose local leg is `CheckSlots.run`.
3. The slots are built on the first check: `createTeamRuntime().loadRunners()` (the
   runners bundle, one more load) → `createGovernedCheckSlots` over the window
   governor's queue, `check` capacity and running count (`teamSlotPorts`), with
   folders under `<team storage>/check-slots`, `count` the machine's own
   parallelism (folders are made on use), the setup command and cache key the Roles
   section saved (`readTeamWindowSettings`, read when the slots are built), `git`
   and `/bin/sh -c` (Windows PowerShell where the window found it), and
   `checkProcessOver` over the team's own process lifetime.
4. A check waits for the machine's `check` capacity and a free folder, runs against a
   snapshot of the task's copy, and gives both back.
5. Muse Code asks before a session MCP tool runs; `classifyMuseWorkerApproval` now
   answers yes once to the tool of the server this team started (matched on that
   server's reserved name) for a role with the checks group, and refuses everything
   else as before.

**What the suites run.** `teamWorkerChecks` drives the endpoint with the MCP
protocol a Muse Code session speaks (JSON-RPC over HTTP with the task's token) and
everything behind it is real: the route and its server, `bridgeRunChecks`,
`routeWorkerCheck`, the runners runtime's governed `CheckSlots`, the window's real
governor host held at throttle by a memory limit of 0%, real git clones and one real
process per check. It shows: two workers asking at once run one after the other
(`start x, end x, start y, end y`) while the same two overlap with no limit set; each
check ran on the files its own task changed; a later call still runs (the slot was
given back); a call stopped while it waits never starts; no token, a forged token, a
closed endpoint and an ended attempt are refused; a role without the checks and a
person with no check get no endpoint; a check that moves a ref is refused and runs
nothing; a path outside the copy is refused by name. `teamProcessWorkers` shows the
real `muse serve` (echo provider) reading the endpoint when its session starts (the
route's `checks` dep is read once to offer it and again for every request the host
makes), and not for a role without the checks. `teamProcessLifetime` runs
`checkProcessOver` over the real native lifetime: exit code, both streams, the time
limit, a caller that stops, and `descendantsEnded` equal to what the journal
recorded.

**Defects the real processes found, and their fixes.**

- A check that ends at once lost its output: Node drops what nobody reads by the
  time a child exits, and the lifetime released the held command before `launch`
  returned. `TeamLaunchRequest.attach` hands the child over before the release.
- A caller that stopped during the launch was never stopped (its signal had fired
  before the listener existed): the runner checks `aborted` once registered.
- The worker's classifier would have refused its own `run_checks` (every unknown tool
  is refused): the `allow` answer above.
- The split gate refused `MODEL_API_MODEL_TEXT` (the bridge's sentences) in
  `dist/teamProcess.js`: that bundle is now a declared reader (18.5 KiB), and the lazy
  registry took the new load.

**Bundles** (measured, `npm run build`): `dist/teamProcess.js` 313.4 → **356.8 KiB** of
375; `dist/teamRunners.js` 34.3 of 75; `dist/resourceGovernor.js` 120.4 of 125;
`dist/team.js` 58.6 of 75; `dist/teamMcp.js` 7.0 of 25; the lazy registry 187 bundles,
296 loads (295 before).

## 4. Item 3: the 100 ms wait in `GovernedTeamSlots`

**Which option: a suite that fails without it** (`governedTeamSlotsPoll.test.ts`). An
event could replace the wait only if the slots had one: they hold the queue's
`request`, the governor's `capacity`, the running count and the caller's own two
ports, none of which says "the scheduler's place changed". Waiting on the slots' own
releases would miss a governor that eases or a registry whose unproved tree retires,
and widening the ports is the thing TEAMWORKERS2's decision kept out. So the wait
stays and now has its proof.

**Why it had none.** The wait guards a disagreement the shipped adapter cannot make:
`CheckSlots` keeps a folder and its permit together, so the queue and the scheduler's
count agree. The suite makes the disagreement with the real parts: the window's
governor host at throttle (one place per kind), the host's real queue, and the real
`SchedulerSlots` as the scheduler's bookkeeping, where a running engine worker fills
the scheduler's only place while the governor sees no process it launched, so the
queue grants. The first worker ends on the third ask, so the loop is bounded by a
count of asks, not by a timer a starved loop could never fire. With the wait the
three asks take at least 170 ms; without it they took **1.8 ms**, and the suite fails
at once instead of freezing the worker as the first draft of TEAMWORKERS2 did.

## 5. Real suites and red/green drills

Real code only: the real governor and queue, real git, real processes, the real
`muse serve` on its echo provider, the real packed agent. Repository timeouts
throughout; the process and clone cases carry named per-test timeouts with their
reason in the file. The worker-check, slots and lifetime suites are POSIX-only (the
shell is `/bin/sh`; Windows has its own job and PowerShell): **NOT RUN on Windows
here; hosted CI shows them skipped there.** The test process runner reads a clean
exit as the container's proof (this rig has no OS container for a bare process
group); the product's runner is `checkProcessOver`, run over the real lifetime in
`teamProcessLifetime`.

Each drill: one break, the owning suite's non-zero exit, byte-exact restore (SHA-256
checked by `temp/drill/drill.py`), green in the final runs.

| #   | Break                                                        | Caught by                                                               | red |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------- | --- |
| 1   | `own` without its contributor switch                         | `acpPresetSwitches` (3 cases)                                           | 1   |
| 2   | The `-contributor` suffix alone counts                       | `acpPresetSwitches` (unlisted id, qualified id)                         | 1   |
| 3   | The switch added for every entry                             | `acpPresetSwitches` (7 cases)                                           | 1   |
| 4   | `acpSpawnArgs` accepts an extra argument                     | `acpPresetSwitches` (2 cases)                                           | 1   |
| 5   | The switch misspelled                                        | `teamProcessWorkers`: the packed agent refuses the argument             | 1   |
| 6   | `runExternal` does not hand the model id on                  | `teamProcessWorkers`: the agent got `--no-user-mcp-servers` only        | 1   |
| 7   | `createGovernedCheckSlots` builds slots without the governor | `teamWorkerChecks` (overlap under throttle; the stopped call started)   | 1   |
| 8   | `serve` gives a role without the checks an endpoint          | `teamWorkerChecks`                                                      | 1   |
| 9   | A closed endpoint's token stays known                        | `teamWorkerChecks` (`200` where `401` was due)                          | 1   |
| 10  | The attempt's end ignored                                    | `teamWorkerChecks`                                                      | 1   |
| 11  | The task's changed files dropped                             | `teamWorkerChecks` (`edited-in-a.txt` missing from the result)          | 1   |
| 12  | The ref guard off                                            | `teamWorkerChecks`                                                      | 1   |
| 13  | `runMuse` hands the worker no servers                        | `teamProcessWorkers`: the real host read the endpoint 0 times (`1 > 1`) | 1   |
| 14  | `CheckSlots.withFolder` never gives the permit back          | `teamWorkerChecks`: timed out at 60 s (the second check never starts)   | 1   |
| 15  | The `attach` hook removed                                    | `teamProcessLifetime` (3 cases: output `''`)                            | 1   |
| 16  | The aborted-at-launch check removed                          | `teamProcessLifetime`: timed out at 30 s                                | 1   |
| 17  | The time limit never fires                                   | `teamProcessLifetime`: timed out at 30 s                                | 1   |
| 18  | The `run_checks` approval given to a role without the checks | `teamChecksApproval`                                                    | 1   |
| 19  | The `run_checks` approval given to every tool of such a role | `teamChecksApproval`                                                    | 1   |
| 20  | The wait in `GovernedTeamSlots` removed                      | `governedTeamSlotsPoll` (1.8 ms where ≥ 170 was due)                    | 1   |
| 21  | The wait cut to 1 ms                                         | `governedTeamSlotsPoll` (3.8 ms where ≥ 170 was due)                    | 1   |

One invalid drill, reported as such: the first run of drills 15 to 17 passed a test
filter the shell had split, so every test was skipped and the exit code was 0. It
proved nothing and was run again with the filter passed directly (the rows above).

## 6. Gates (final tree)

Exit codes are each command's own; suites ran with the repository's own timeouts and
`--maxWorkers=3`.

| Command                                                                  | Exit    | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx prettier --check` on every touched file                             | 0       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `npx eslint --max-warnings 0` on every touched `.ts`/`.mjs`              | 0       | the strict unicorn rules found 21 nits in the first drafts, all fixed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run typecheck`                                                      | 0       | six projects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `node scripts/check-l10n.mjs`                                            | 0       | 14 UI tables, 14 usage tables, 0 problems (the new sentences are model text, `TEAM_MODEL_TEXT`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `npm run check:reference`                                                | 0       | current                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run check:host-api`                                                 | 0       | after `--write`: `node:crypto`, `node:fs/promises`, `node:http`, `node:os` and `node:path` count one more import each                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run check:plan`                                                     | 0       | 244 milestones, 0 drift                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run check:roadmap`                                                  | 0       | 244 entries, current                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npm run check:catches`                                                  | 0       | counts equal the baseline (two CLEANUP catches in the first draft were rewritten away; the new catch, `heldLockfiles`, is NARROW)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm run duplication`                                                    | 0       | 0 clones                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `npm run cycles`                                                         | 0       | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npm run deadcode`                                                       | 0       | knip clean (tag hints only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `npm run build`                                                          | 0       | every size row holds (§3); split gate, lazy registry, host-globals, notices and legal records green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Touched suites                                                           | 0       | `acpPresetSwitches`, `teamChecksApproval`, `governedTeamSlotsPoll` 21; `teamWorkerChecks`, `teamCheckSlotsGoverned`, `teamProcessLifetime` 19; `teamProcessWorkers`, `noUserMcpServers`, `teamMcpWiring` 21; `teamChunkPackaging`, `acpTeamPackage`, `lazyBundleFiles` 24; `governorWindowsBundle`, `teamHostRealParts`, `teamEnginePorts` 20                                                                                                                                                                                                                                                             |
| `npx vitest related <14 changed sources> --run` (canonical `TMPDIR`)     | 1       | 102 files: 98 passed, 3 skipped, **1 failed**; 958 tests passed, 1 failed, 58 skipped. The failing file, `execTeamSweep` (1 of 7: "removes the dead run with its owned ref and keeps the live one"), fails the same way on the untouched base `a1cadc926` (a clean `git archive` under `temp/`, this worktree's `node_modules` linked, the same `TMPDIR`): 1 of 7, the same assertion; it is on CC-INT5's and RLF-TEAMFIT's lists. The three skipped files are the two live end-to-end suites (`eval.live`, `team.live`: they need a billed key and are skipped without one) and `deviceWorkerHostNative` |
| `npm run package:acp`, `npm run security:audit`, `npm run security:sast` | not run | not in this brief's gate list; no dependency changed; the base record's rig limit on the native helper stands                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

`src/shared/constants.ts` and `src/shared/l10n/en.ts` are hubs every suite imports: a
related run on them would run every suite, so they are covered by `typecheck`,
`check-l10n`, `build` and the suites above. The related run's sources were the
fourteen non-hub files named in its row, with the credential-store and vault suites
excluded by the MacBook rule.

## 7. Not built, open questions, and what I recommend

1. **A check never proves its tree on macOS, so the first `run_checks` there ends in
   the uncertain-attempt sentence.** `CheckSlots` keeps the M96c rule: a folder is
   given back only on the container's proof, and the container of a bare process group
   (macOS, Linux without a delegated scope) proves nothing. On this rig the journal
   records the check's tree `uncertain` and `checkProcessOver` reports
   `descendantsEnded: false` (measured on darwin for `node -e 'console.log(1)'`: exit code 0,
   output `1`, `descendantsEnded` false; `teamProcessLifetime` asserts that the runner and
   the journal agree). The check
   _ran_, but its result is thrown away behind that sentence and the folder stays held
   (and, under throttle, so does the permit). A Windows job and a Linux systemd scope
   prove it, so the route works there. Options: (a) keep the rule and say so (the
   state of this lane); (b) accept an emptied process group (`kill(-pgid, 0)` answering
   `ESRCH`) as the proof for check commands on macOS, which the M96c text refuses as a
   PID observation; (c) leave macOS checks to SSH runners. **Recommendation:** (a) until
   the lead decides on (b); it is the owner's rule about proof, not mine to relax.
2. **The tool name Muse Code reports for a session MCP tool is not captured.**
   `classifyMuseWorkerApproval` matches the team's server name inside the reported
   name, so a different shape refuses the call (fail closed, said to the worker). The
   live run must record the approval's `subject` and `toolName` for one `run_checks`
   call, and whether Muse Code asks at all. An echo host makes no tool call, so no
   capture was possible without a model turn.
3. **Runners over SSH are not on this route** (`runners: () => []`): the SSH half
   needs the extension's helper folder and `ssh` path (`SshRunner`'s deps). Every
   check goes to a local slot. **Recommendation:** one lane that builds `SshRunner`
   in the editor and passes `runners.json`'s runners, with a runner on the live run.
4. **External agents get no `run_checks`**: their `session/new` takes an MCP server
   only where the agent advertises HTTP, which the connection does not read yet.
   **Recommendation:** read `mcpCapabilities` in the `initialize` capture and offer
   the same endpoint; `own` is the first agent to try.
5. **The engine route is not wired**: an engine worker's own shell and `run_checks`
   still run where the Model API runs them. M96c's text asks for them in a slot too
   (transparently, after every shell guard); that is a hook in the Model API's check
   runner for team worker hosts. **Recommendation:** a lane of its own; it shares
   `routeWorkerCheck` and the slots built here.
6. **Per-copy install** (`dependencyInstallation: 'perCopy'`, `installInCopy`) is not
   wired; a worker's checks always run in a slot.
7. **Install folders and the setup's time of reading.** The setting holds a setup
   command and a cache key, no install folders: `node_modules` is the one folder the
   slots restore (a folder the setup did not make is skipped), and the setup is read
   when the slots are first built, so a changed setup applies from the next window.
   **Recommendation:** an install-folders field beside the setup command, and read
   the setup per check.
8. **No packed-editor run, no CHANGELOG line, no README claim.** The standing rule
   claims a feature after it was used through the packed product, and this rig starts
   no editor. The entries below wait for the live run (`rlf-teamworkers.md` §7):
   "**A worker on your team can run your checks.** …" and "**An agent team's
   own-agent worker can use a Muse contributor model you picked in its pool.** …".

## 8. Decisions for the lead (notes, no D number)

1. "The catalogue lists" is `MODEL_EFFORT_LEVELS`'s exact rows (§2): the one table of
   Meta model ids in the product that names the contributor tier of the wonder-full
   model. A model the Muse Code CLI derives a contributor id for (`<base>-contributor`)
   that the table lacks gets no flag.
2. The checks a worker runs are the person's `museSpark.checkCommands`; the role's
   checks group is the permission (the role's own `shell`/`testShell` command policy is
   not applied: a configured check such as `npm run lint && npm test` is not a plain
   command and would be refused by it), and the one guard is the ref guard.
3. The approval answer for `run_checks` is `allow` once, never a stored grant, and
   needs no card.
4. The folder count is the machine's own parallelism (D121: no ceiling of ours); the
   governor's `check` capacity and the person's limits are what bound concurrency.
5. The wait in `GovernedTeamSlots` stays a wait (§4).
