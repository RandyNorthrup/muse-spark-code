# CC-WINWORKERS — the job helper's other callers start no PowerShell (2026-10-30)

Claude Code lane `CC-WINWORKERS`, worktree `C:/Users/Randy/Coding/mx-cc-winworkers`,
branch `cc/winworkers`, cut from int/recovery `0a5ebd7189` (CC-INT5), on the owner's
Windows 11 PC (Windows 11 Pro 10.0.26200, Intel i9-12900HK, 20 logical CPUs,
Node 24.20.0, npm 11.19.0). It carries out CC-WINHOOK's open questions 3 and 4,
which the lead accepted as this lane. Model attempts: **0**. Provider calls: **0**.
Muse requests: **0**. Nothing was pushed, rebased, reset, stashed by hand or
tagged. The vault suites and the real credential-store suites (`test/unit/vault/**`,
`keyringParts`, `keystoreOwner`, `credentialLease`, `providerHeadersStore`,
`devicePairKeyDpapi`, `deviceOwnerVaultUses`, `deviceOwnerBind`) were never run on
this PC. Scratch files lived in the worktree's ignored `temp/` (`TMP` and `TEMP` at
`temp/tmp`). No busy-loop contention was made this time; one heavy command ran at a
time.

## 0. The merge of CC-WINHOOK

`git merge --no-ff cc/winhook` (built on `dfcb45936f`) onto `0a5ebd7189`: commit
`1dd0014d59` (`fix(int): merge CC-WINHOOK ...`). The one conflict was PLAN.md's M104
status block, where int had added lane B's CC-INT5 lines and CC-WINHOOK lane H's
busy-PC hook line beside the same paragraph: both kept, int's first. CHANGELOG, the
catch baseline and `runtimeLsp.test.ts` merged cleanly. On the merged tree
`check:catches`, `check:roadmap` and `check:plan` exit 0 (no generated file needed
regenerating; no catch identity moved). The merge commit's diff against int is
CC-WINHOOK's 22 files exactly (+1057 / −199), so the hook rewrote nothing.

## 1. What still started Windows PowerShell for the job helper

CC-WINHOOK moved the resource governor's tree reader, actuator, created-path
registry and job holder onto `MuseSparkJobHost` (`windowsJobHost`). Its record named
what was left; each of these loaded the same compiled helper into a fresh Windows
PowerShell only to call one method:

| Caller                                                                                    | PowerShell starts                                                                          |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| The team workers' file commands (`src/core/team/workers/workerOps.ts`, `nativeOperation`) | 1 per file operation: the governed launcher's payload was `powershell.exe -EncodedCommand` |
| The playbook's contained job (`src/host/playbook/containedJob.ts`)                        | 1 per decision (the helper server), 1 per end of a job by name                             |
| The window's end of a stopped worker's jobs (`src/host/playbook/playbookWindow.ts`)       | 1 per job ended by name                                                                    |
| The legacy shell stop (`src/host/processTree.ts`, `didTerminateJob`)                      | 1 per stop of a command that had its own job                                               |

## 2. The change (commit `dd159b4cc3`)

`native/windows/MuseSparkJob.cs` keeps one helper (no second program): `MuseSparkJobHost`
gains four commands, and every caller of the job type but the shell tool runs the
helper through `windowsJobHost` (absolute path; the environment given is `SystemRoot` alone, §7a's note).

- **`worker <op> <root> <rootId> <ancestor> <ancestorId> <remaining> <identity>`**
  runs `MuseSparkCreated`'s worker operations, and only those (any other operation is
  `worker file helper failed: ArgumentException`). A refusal is the helper's own line
  on standard error (`worker file helper refused: <reason>`, a short code, never a
  path); any other failure is `worker file helper failed: <type name>`; both exit 1,
  as the PowerShell wrapper wrote them. `nativeOperation` runs it through the same
  governed contained launcher as before; each value is one argument of the program
  (the launcher quotes each for the C runtime), so no shell or script reads a name.
  `workerWindowsCommand` (the `-EncodedCommand` wrapper) is gone; `workerHostCommand`
  gives the arguments.
- **`contained <job> <pipe> <idleMs> <sweepMs> <exitPollMs> <sweepPollMs>`** is the
  playbook's helper server ported from the PowerShell script to C#, statement for
  statement: join a fresh named job; set kill-on-close on the only handle (the
  `TeamLimits` layout `RunTeam` already uses) before any pipe exists; serve framed
  calls (program, arguments, directory, time limit, output bound, exact environment);
  after each call end every other member, each by its start identity
  (`Query`, `Signal`); answer `status flags outLength errLength` and both streams;
  terminate the job, itself included, when the pipe closes, idles or anything fails.
  The answer flags are `PLAYBOOK_JOB_FLAGS`. Two differences, both safer: the output
  past the bound is still drained but no longer kept in memory (the answer is refused
  whole either way), and the process handle is released only after both streams
  reached their end. `containedJobScript` and `endJobScript` are gone, with the
  constants only the script used (`PLAYBOOK_JOB_ENVIRONMENT`, `PLAYBOOK_JOB_KILL_ON_CLOSE`).
- **`end-job <job> <sweepMs> <pollMs>`** ends a job by name and exits 0 only once it
  has no member or no longer exists (the old `endJobScript`); the worker's
  `ContainedJob` and the window's `endJobByName` both run it (`endJobArgs`).
- **`terminate <job> <exitCode>`** answers `true` or `false`: the legacy shell stop's
  job termination.

Two interactions found on the way, each fixed and drilled (§5):

1. **The worker helper could be refused as a workspace program.** The governed
   launch refuses an absolute command inside the workspace it guards, and without a
   named workspace that is this process's working folder. PowerShell lives in
   `System32` and never met that rule; the job helper lives in the product's storage
   (`%TEMP%\muse-spark-code-acp` for the agent's hooks, the agent's data folder for
   its governor), which a working folder can contain. `nativeOperation` now names the
   working copy it acts in (`workspaceRoot: proof.root`), which is what the guard is
   for. Found when this suite's own `TMP` sat inside the worktree: 11 cases failed
   with `Governed command unavailable` until it was named.
2. **A helper the system refuses to start at all kept its job's name published.**
   Node throws from `spawn` itself when the file exists but is not a program, where
   a missing file only emits `error` (the code was not recorded); PowerShell
   always started, so this was new. `ContainedJob.open` now drops the name it had
   just published (no process ever existed, so no job did) and rethrows; the default
   starter also listens for `error`.

The helper's old builds: until CC-WINHOOK the helper was built as a library,
`MuseSparkJob-<16 hex>.dll`, 60 KB each, one per helper version, in
`<storage>/shell-job/`. `JobBuild.retiredExtensions` (`['.dll']` for the shell job)
makes the sweep after a build remove those too, and the sweep now matches only the
exact names the product makes (`jobFileName`: the stem, sixteen lower-case hex
digits, the extension), in the live build's own folder; a file a live process holds
retires on the next job-helper exit, as stale `.exe` builds already did.

## 3. What stays Windows PowerShell, and why

- **The shell tool.** It is the person's shell: commands run in PowerShell and join
  their job with `joinStatement` (PowerShell loads the type with `LoadFrom`).
- **The helper's self-test** (`shellJob.ts` `prepare`, once per process): what it
  proves is that this PowerShell can load the type and join a job, which the shell
  tool depends on (Constrained Language Mode fails it, and commands then fall back).
- **The orphan sweep after taskkill** (`processTree.ts` `sweepOrphans`: the process
  table through `Get-CimInstance`, the identity-checked kill). It runs only for a
  command that had no job or whose job could not be ended, which is exactly when the
  helper may be missing (a failed build) or unloadable; moving it onto the helper
  would either lose the sweep there or need a second implementation. Recorded in the
  file's header.
- **The ungoverned hook route** (`toolIo.runHook` without a governor or launcher):
  PowerShell joins the job, then starts `cmd.exe` (CC-WINHOOK kept it).
- **Not in this lane's brief, and still loading the helper through PowerShell:** the
  team worker _process_ launch, `MuseSparkJob.RunTeam` in
  `src/host/team/processLifetime.ts` (one PowerShell start per worker launch). It is
  the same pattern; §8 item 1 asks the lead.

## 4. Measurements

The counter, as CC-WINHOOK's: `temp/measure/count.cjs` (not committed), loaded with
`node --require` into the test process, records every `spawn`, `spawnSync`,
`execFile`, `execFileSync`, `exec` and `fork` with its time. That sees only what this
process starts; the worker command's payload starts inside the native job launcher.
So the PowerShell count is read from the operating system as well: Windows PowerShell
writes event 400 to its "Windows PowerShell" log for every engine start, with the
whole command line (`HostApplication`). `temp/measure/analyze.mjs` reads it with
`wevtutil qe "Windows PowerShell"` for each marked window and attributes an event to
the run when its command line (an `-EncodedCommand` decoded) names the run's scratch
folder, the helper or the playbook script. The driver
(`temp/measure/powershell.measure.test.ts`, under a vitest config that includes only
it) runs the product's own modules of the tree it sits in: `nativeOperation`
(`worker-create`) through the configured governor and the real M50 launcher,
`ContainedJob` (one decision: two calls, then close), the end of a job by name (a
helper that serves its pipe, drops the caller and stays, as the suite's stand-in
does, so the product's own end runs), and `killTree` of a PowerShell command joined
to its own job. "Before" is `git archive 1dd0014d59` (int plus CC-WINHOOK) in
`temp/before` with the same driver; "after" is `dd159b4cc3`. Five rounds of each.

| Operation (per round)                        | PowerShell starts, before | after                    | Process starts by this process, before → after                 | Time, before (median)  | Time, after (median)                                        |
| -------------------------------------------- | ------------------------- | ------------------------ | -------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------- |
| Team worker file command                     | **1** (5 of 5, two runs)  | **0** (5 of 5, two runs) | launcher 1 → launcher 1 (its payload: PowerShell → the helper) | 350–1119 ms (368, 402) | 160–717 ms (165); 207–3706 ms on a busier PC                |
| Playbook contained decision (2 calls, close) | **1** (5 of 5, two runs)  | **0** (5 of 5, two runs) | PowerShell 1 → helper 1                                        | 624–764 ms (640, 727)  | 199–278 ms (246); 234–1504 ms busier                        |
| End of a job by name                         | **1** (2 of 2)            | **0** (2 of 2, two runs) | PowerShell 1 → helper 1 (`end-job`)                            | about 5.4 s            | about 5.1 s (both are the 5 s wait for a helper that stays) |
| Legacy shell stop of a joined command        | **1** (5 of 5, two runs)  | **0** (5 of 5, two runs) | PowerShell 1 → helper 1 (`terminate`)                          | 236–309 ms (267, 276)  | 45–70 ms (49, 62)                                           |
| Setup (the helper's build and self-test)     | 1                         | 1                        | csc, PowerShell self-test, M50 self-test                       | 0.6–0.7 s              | 0.75 s; 3.3 s busier                                        |

The shell commands the stop rounds kill are themselves PowerShell (the shell tool);
their own start (1 each, both builds) is outside the stop's window and not counted.

**What else was seen on the PC:** in a 20-second window the owner's installed VS Code
extension (0.19.x, `...\globalStorage\randynorthrup.muse-spark-code\shell-job\
MuseSparkJob-690dd47ec7d3b609.dll`) started four Windows PowerShell processes for its
governor's `Query` calls; this run's own were none. CC-WINHOOK and this lane together
remove those once a build with them is installed. Those events are excluded from the
counts above by the attribution, and listed in the analyzer's output.

## 5. Red/green drills

Each: the code as described, the non-zero exit or the PowerShell start seen,
restored from a saved copy (SHA-256 checked against the committed file), green
again. Suites ran with `--maxWorkers=4` and the repository's own timeouts.

| #   | Broken on purpose (the old code path put back)                                           | Caught by                                            | Red                                                                                                              | Restored               |
| --- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | `nativeOperation`'s old Windows branch (PowerShell 5.1, the encoded wrapper, `LoadFrom`) | the counter and the event log (3 rounds)             | **1** PowerShell start in each worker window (3 of 3), where the committed code shows 0                          | byte-exact; measured 0 |
| 2   | `containedJob.ts`, `playbookWindow.ts`, `constants.ts` as they were at `1dd0014d59`      | the counter and the event log (3 + 2 rounds)         | **1** PowerShell start per decision (3 of 3) and per end by name (2 of 2)                                        | byte-exact; measured 0 |
| 3   | `processTree.ts` as it was (PowerShell `Terminate`)                                      | `processTreeJobStop.test.ts`                         | 2 of 2, exit 1: the stop ran `powershell.exe -NoProfile ...` where `terminate <job> 1` was expected              | 2 of 2                 |
| 4   | `staleJobs.ts` as it was (no retired extensions)                                         | `shellJobRetiredBuilds.test.ts`                      | exit 1: `MuseSparkJob-690dd47ec7d3b609.dll` still in the folder                                                  | 1 of 1                 |
| 4b  | the sweep matching by prefix and extension instead of the exact name                     | `shellJobRetiredBuilds.test.ts`                      | exit 1: four foreign files removed (`...abcde.dll`, `...abcdef0.dll`, `...abcdeg.dll`, `MuseSparkJob-notes.dll`) | 1 of 1                 |
| 5   | `ContainedJob.open` without the guard around the helper's start                          | `playbookContainedJob.test.ts`                       | exit 1: "a file that is not an assembly fails closed" kept the job's name published                              | green in §6's run      |
| 6   | `nativeOperation` without `workspaceRoot: proof.root`                                    | `teamWorkerCreate.test.ts` (TMP inside the worktree) | 11 of 125 red, exit 1: `Governed command unavailable`                                                            | green in §6's run      |
| 7   | the C# `worker` command writing every failure as `helper failed`                         | `teamWorkerCreate.test.ts`, `jobHostNative.test.ts`  | 35 red, exit 1 (every typed refusal, and the helper's own failure lines)                                         | green in §6's run      |
| 8   | the C# `contained` server without kill-on-close                                          | `playbookContainedJob.test.ts`                       | exit 1: "ends the whole tree when the helper is lost": the grandchild still running                              | green in §6's run      |

After drill 8 the PC was searched for the drill's processes (`node.exe` with the
fixture's command line): none was left.

## 6. Real-process suites

| Suite                                 | What it runs for real                                                                                                                                                                                                                                                                                                                                                                                    | Result                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `teamWorkerCreate.test.ts`            | the worker helper through `nativeOperation` and the governed launcher: creates, the raced target's typed refusal, a nested file parent, and nine hostile names (`o'brien.ts`, `a;exit.ts`, `$(Get-Date).ts`, ``a`b.ts``, `a&b.ts`, `%VAR%.ts`, ` two  spaces .ts`, two typographic quotes) made exactly; the helper's 25 name refusals through the fixture, which now runs the helper as production does | 122 passed, 3 skipped        |
| `playbookContainedJob.test.ts`        | the C# server: exit status and exact bytes, exact environment, directory and arguments, a timed-out parent and detached grandchild ended, leftovers ended between calls, the output bound, an unstartable program, close, a lost helper's whole tree, a helper that stayed, `end-job`, a non-program file                                                                                                | 24 passed, 2 skipped (POSIX) |
| `jobHostNative.test.ts`               | `terminate` (`true` on a held job, `false` once gone), `end-job` on a held and a gone job, the `worker` command's two failure lines, with CC-WINHOOK's three cases                                                                                                                                                                                                                                       | 5 passed                     |
| `processTreeJobStop.test.ts` (new)    | a PowerShell command joined to its own job with a detached grandchild: the stop through `terminate` alone; a command whose job is not there: `terminate` answers `false`, taskkill follows                                                                                                                                                                                                               | 2 passed                     |
| `shellJobRetiredBuilds.test.ts` (new) | the product's builder over a storage folder an earlier version left: the exact `.dll` builds go, seven look-alikes and a file in another folder stay                                                                                                                                                                                                                                                     | 1 passed                     |
| `pathGuardSpawns.test.ts`             | the spawn inventory: `containedJob.ts` and `playbookWindow.ts` now anchor on `windowsJobHost`, `workerOps.ts`'s record names the job helper                                                                                                                                                                                                                                                              | 7 passed                     |

One `vitest run` of those six on the committed code: **6 files, 161 passed, 5 skipped,
exit 0** (133 s).

## 7. Gates

Every command ran from the worktree with `TMP`/`TEMP` in `temp/tmp`, on the
committed code (`dd159b4cc3`; the commit carrying this record, PLAN and CHANGELOG
changes no code but one comment in `execGuard.ts`). The owner was using the PC throughout.

| Gate                                                                                                                                                             | Exit          | Result                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check --ignore-unknown` on every changed and new file                                                                                                | 0             | all use Prettier code style (the C# has no Prettier parser)                                                                                                                                                                                                                             |
| `eslint --max-warnings 0` on the 17 changed code files                                                                                                           | 0             | the first run found five problems in the two new suites (function scoping, `toSorted` with a comparer); fixed, not disabled                                                                                                                                                             |
| `npm run typecheck` (host, webview, unit, e2e, integration, faults)                                                                                              | 0             | no `error TS` line                                                                                                                                                                                                                                                                      |
| `node scripts/check-l10n.mjs`                                                                                                                                    | 0             | 14 UI tables, 14 usage tables, 284 manifest strings, 2496 source files; 0 problems (no text a person reads was added)                                                                                                                                                                   |
| `npm run check:host-api`                                                                                                                                         | 0             | 392 VS Code APIs, 57 files importing vscode; 0 problems                                                                                                                                                                                                                                 |
| `npm run check:plan`                                                                                                                                             | 0             | 244 milestones; 0 drift                                                                                                                                                                                                                                                                 |
| `npm run check:roadmap`                                                                                                                                          | 0             | 244 entries; `ROADMAP.md` current (run again after the CHANGELOG line)                                                                                                                                                                                                                  |
| `npm run check:catches`                                                                                                                                          | 0             | all catch sites and counts match the baseline (the new catch in `ContainedJob.open` rethrows on every path; no identity moved, no baseline change)                                                                                                                                      |
| `npm run duplication`                                                                                                                                            | 0             | 0 clones; the first run found the two stop cases of `processTreeJobStop.test.ts` alike, now one `stopCommand` helper                                                                                                                                                                    |
| `npm run deadcode`                                                                                                                                               | 0             | knip clean (configuration and tag hints only: the same 5 tag hints as the base)                                                                                                                                                                                                         |
| **`npm run build`**                                                                                                                                              | **1**         | **CC-INT5's four rows, unchanged to the tenth of a KiB, and nothing else:** `dist/teamRunners.js` 78.4 of 75, `dist/teamHost.js` 140.2 of 130, `dist/teamScheduler.js` 76.5 of 75, `dist/uiText.js` 125.3 of 125 (CC-INT5 §8 item 1). No budget raised. `dist/playbook.js` 133.9 of 150 |
| the rest of the build chain by hand: `check-bundle-split`, `gen-lazy-registry --check`, `check-host-globals`, `third-party-notices`, `check-legal-build-records` | 0, 0, 0, 0, 0 | the split gate passes; 184 bundles, 290 loads resolved, current; 93 notices; 165 legal bundles, 2899 files, 0 problems                                                                                                                                                                  |
| `npm run check:reference`                                                                                                                                        | 0             | current                                                                                                                                                                                                                                                                                 |
| **`npm run check:mhp`**                                                                                                                                          | **1**         | known on int, not re-frozen: `MHP_VERSION_LOCK: v1.1 frozen wire contract changed (expected 80d04e5d634a3dc315f5da8b8231a688b526ff589c96cf05f217eeebe6e3783e)`. The same line, exit 1, on the base (`temp/before`, `1dd0014d59`); no MHP file changed here                              |
| `npm run package:acp -- --target win32-x64`                                                                                                                      | 0             | 105 s; **141 of 141** packaged-bundle checks; `dist/muse-spark-code-acp-0.19.0-win32-x64.tgz`, 4,058,485 bytes (SHA-256 `3edf0f3596ab3625302fc63c6ab11da69eff8ee752aea54ff402a209dbd7540e`), carrying the new `native/windows/MuseSparkJob.cs`                                          |
| the six touched suites in one `vitest run` (§6), `--maxWorkers=4`                                                                                                | 0             | 6 files, 161 passed, 5 skipped                                                                                                                                                                                                                                                          |
| **the related suites** (below), `--maxWorkers=4`                                                                                                                 | **1**         | 96 files: 94 passed, **2 failed**; 1098 tests: 1042 passed, 51 skipped, **5 failed** (805 s). Classified below; neither is from this lane                                                                                                                                               |

**The related suites.** `vitest related` over `execGuard.ts`, `constants.ts`,
`processTree.ts` or `staleJobs.ts` reaches 665 to 1186 of the 1286 test files (the
whole battery, and the vault suites), which this PC's rule forbids. The set run is
the reverse import closure (static and dynamic relative imports, computed by
`temp/logs/related.mjs`, not committed) of `workerOps.ts`, `containedJob.ts`,
`playbookWindow.ts`, `shellJob.ts` and `jobSource.ts`: 114 files, less the vault and
credential-store suites by name (`test/unit/vault/**`, 8 files, and
`devicePairKeyDpapi`), the suites that need the test run's own production build
(`runtimePanelGit`, `runtimePanelSessions`; the packed agent's run in §7a stands for
the built product) and the six already run. `execGuard.ts`, `processTree.ts` and
`staleJobs.ts` are exercised for real by the touched suites and by `mcpJobRetire`,
`processTreeSweep`, `hookLaunchWindows`, `windowsTreeReader`,
`actuatorsWindowsNative`, `teamPlaybookIntegration`, `teamPlaybookRounds`,
`playbookWindow`, `teamWorkerCreateBundle` and `teamChunkPackaging` (10 files, 54
passed, 2 skipped, exit 0, one run on this code before the commit).

| Failed in the related run                                                           | Alone on this code                      | On the base (`temp/before`) | Class                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------- | --------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `teamWorkspaceRefs` "throws a broken repository instead of reporting it absent" (1) | the same 1, exit 1                      | **the same 1, exit 1**      | Base: `expected TeamWorkspaceError: The team ref refs/hea… to be an instance of TeamGitError`. Not in CC-INT5's base lists (that round ran on macOS); cause UNMEASURED                                                                                   |
| `deviceWorkerHostNative` (4, each `Test timed out in 15000ms`)                      | **7 passed, 13 skipped, exit 0** (29 s) | not run                     | Load: the four ran while a second `vitest` of mine (the one-case check in §7a's note) ran beside the long run, against this lane's one-heavy-command rule; it passes alone, and passed in an earlier batch on this code. Not re-run into green as a gate |

## 7a. Use through the packed product

The package above, unpacked with `tar -xzf` into `temp/packed/pkg` (`node
dist/acp.js --version` printed `0.19.0`), driven by `temp/packed/drive.mjs` (not
committed) as CC-WINHOOK drove it: `dist/acp.js lsp --workspace <ws>
--trust-workspace --tab --verbose` under `vscode-jsonrpc`, a scratch `HOME`,
`LOCALAPPDATA`, `APPDATA` and `TMP` under `temp/packed/run`, a workspace whose
`.muse/spark-hooks.json` has one `beforeTabFileRead` command hook that stamps the
time and gives no permission (so the stored key is never read), five inline
completions. Before the start, both of the agent's helper folders (the governor's,
`<LOCALAPPDATA>\Muse Spark Code\shell-job`, and the hooks', `<TMP>\muse-spark-code-acp\
shell-job`) held two exact earlier builds (`MuseSparkJob-690dd47ec7d3b609.dll`,
`MuseSparkJob-0f1e2d3c4b5a6978.dll`, 60 KB each) and two look-alikes
(`MuseSparkJob-notes.dll`, `Other-690dd47ec7d3b609.dll`).

- The governor built the new helper (`MuseSparkJob-a92cb37ebff41dd3.exe`) and the
  launcher in its folder, and the folder then held those two, the two look-alikes
  and **neither earlier build**. The hooks' folder was untouched: a governed hook
  starts through the native launcher and never prepares that folder's helper, so
  its earlier builds wait for the first build there (the same code).
- Each of the five requests ran the hook (`beforeTabFileRead: denied` five times),
  answered `{"items":[]}` (731 to 1052 ms warm; 1569 ms cold), asked **0**
  questions; the agent exited 0.
- Counted with the counter loaded into the agent and the engine-start log: **1**
  Windows PowerShell start in the whole process, the helper's self-test (§3), and
  none else; the job helper ran 50 `created` and 33 `query` calls and the launcher
  10 times, all native.

No model request was made and nothing was sent to a provider.

**A note on the helper's environment** (found while checking a bare `git` through the
new contained server, `temp/measure/baregit.measure.test.ts`, not committed):
`windowsJobHost` gives `SystemRoot` alone, but Node's process start on Windows (libuv)
copies ten required variables from the parent when they are absent: a child started
with `{ SystemRoot }` sees `HOMEDRIVE`, `HOMEPATH`, `LOGONSERVER`, `PATH`,
`SYSTEMDRIVE`, `SystemRoot`, `TEMP`, `USERDOMAIN`, `USERNAME`, `USERPROFILE` and
`WINDIR` (measured). None is a credential. It matters in one place: the playbook's
`head()` (`src/core/orchestration/playbook/outcomes.ts`) is the one contained call
that names `git` bare; Windows resolves a bare name from the helper's own directory,
its parent's working folder and its `PATH`, so the native helper finds `git` through
the parent's whole `PATH` where the PowerShell helper used that `PATH`'s absolute
entries (a relative entry adds nothing the parent's working folder does not). The
call returned `git version 2.52.0.windows.1`. §8 item 5.

## 8. Open questions for the lead

1. **`RunTeam` still starts Windows PowerShell for every team worker launch**
   (`src/host/team/processLifetime.ts`: `exit [MuseSparkJob]::RunTeam(...)`). Not in
   this lane's brief and not in CC-WINHOOK's list. It is the same change again (a
   `run-team` command whose exit code is the payload's; the kill-on-close job is the
   helper's own either way). Recommendation: its own small lane with the team
   process-lifetime suites, because its status and control pipes and its
   confirmation clock are a different surface from the four moved here.
2. **The orphan sweep after taskkill stays PowerShell** (§3). Recommendation: keep it.
   The alternatives are a second implementation in C# beside the PowerShell one
   (forbidden), or losing the sweep exactly where it is needed.
3. **The CHANGELOG claims only what the packed product ran.** The worker file
   commands need a team run (two models), and the playbook's contained job runs in
   the VS Code window, which this lane may not start; both are proven by the
   real-process suites over the production modules (§6) and measured (§4), not
   through the packed product. Recommendation: claim them when a real team run and
   a real playbook run go through a packed build (the release's real-life run).
4. **An older version still running loses its library build at the next sweep.** The
   sweep runs after a new helper build, like the stale `.exe` sweep it extends: a
   build another window's PowerShell has loaded is held and retires later, but an
   older window between two calls finds its `.dll` gone until it reloads. This is
   the trade-off the existing sweep of stale builds already makes; recommendation:
   keep it (an update reloads the window).
5. **`head()` names `git` bare** (§7a's note). Every other contained call carries
   `processGitPath`'s resolved path (D24: never a `git` planted in the workspace).
   Recommendation: `head()` uses `this.gitCommand()` like the rest, a one-line change
   in the playbook core with its own suite run on all three systems; not made here,
   it is outside this lane's files and its POSIX side cannot be run on this PC.
6. **`windowsJobHost`'s comment said `SystemRoot` only**; on Windows the child also
   gets the ten variables libuv copies (§7a's note), from CC-WINHOOK on. None is a
   credential. The comment is corrected in the record's commit (comment only, no
   code); CC-WINHOOK's record still says "environment of `SystemRoot` only", which
   the lead may want to annotate. Nothing here needs a truly empty environment.
7. **Base failure seen on Windows, not from this lane:** `teamWorkspaceRefs` "throws a
   broken repository instead of reporting it absent" fails identically on the base
   (§7). Its owner is the team cluster (CC-INT5).

## 9. Commits

`0a5ebd7189` → `1dd0014d59` (`fix(int):` the merge of CC-WINHOOK) → `dd159b4cc3`
(`perf(windows):` the change, its suites and drills' targets) → the commit carrying
this record, the PLAN entry, the index line, the CHANGELOG line and the corrected
`windowsJobHost` comment.
