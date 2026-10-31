# CC-WINRUNTEAM — the team worker launch starts no PowerShell (2026-10-30)

Claude Code lane `CC-WINRUNTEAM`, worktree `C:/Users/Randy/Coding/mx-cc-winrunteam`,
branch `cc/winrunteam`, cut from `cc/winworkers` `1b44323c7d` (int/recovery
`0a5ebd7189` with CC-WINHOOK and CC-WINWORKERS), on the owner's Windows 11 PC
(Windows 11 Pro 10.0.26200, Intel i9-12900HK, 20 logical CPUs, Node 24.20.0). It
carries out CC-WINWORKERS' decisions 1, 4 and 5, which the lead accepted as this lane.
Model attempts: **0**. Provider calls: **0**. Muse requests: **0**. Nothing was
pushed, rebased, reset, stashed by hand or tagged. The vault suites and the real
credential-store suites (`test/unit/vault/**`, `keyringParts`, `keystoreOwner`,
`credentialLease`, `providerHeadersStore`, `devicePairKeyDpapi`) were never run on
this PC. Scratch files lived in the worktree's ignored `temp/` (`TMP` and `TEMP` at
`temp/tmp`); one heavy command ran at a time; no busy loop was started.

## 1. What still started Windows PowerShell

`windowsTeamDriver` (`src/host/team/processLifetime.ts`) started Windows PowerShell for
every team worker launch, only to load the compiled job helper and run
`exit [MuseSparkJob]::RunTeam(...)`, with the payload's arguments and its whole
environment block quoted into the script on PowerShell's command line.

Two facts about that code, found on the way:

- **It has no product caller yet.** `startNativeTeamLifetime` and
  `startTeamMuseCodeHost` are called by no product code (`knip.jsonc` lists
  `processLifetime.ts` among the team runtime "built but no product surface spawns team
  workers yet"; `docs/certification/spawn-inventory.json` marks the driver test-only;
  RLF-TEAMWIRE's decision 2 asks who assembles it). A packed build cannot reach it, so
  the change is proven by the real-process suite over the production module (§6) and
  measured (§3); nothing is claimed in the CHANGELOG (§10, decision 2).
- **No suite ran the Windows driver at all.** The suites that covered it
  (`teamProcessLifetime`, `teamWindowsControl`) mocked `node:net` and `node:child_process`
  and went with the 2026-10-12 overhaul (`f2b00c0947`). `teamLaunchWindows.test.ts` (new,
  §6) is the first real one.

## 2. The change (commit `a7bee6fcb5`)

- **`MuseSparkJobHost run-team`** (`native/windows/MuseSparkJob.cs`):
  `run-team <executable> <cwd> <parentPid> <ownerPipe> <nonce> <statusPipe> <jobName>
<belowNormal> <verbatim> <argumentCount>`, then the payload's arguments, then its
  environment entries, one program argument each. It calls `MuseSparkJob.RunTeam`
  unchanged, so the launch is the one PowerShell ran: a named job with kill-on-close and
  no breakaway, the helper inside it, below-normal priority on the helper when asked
  (the payload inherits it), the shared launcher's READY/GO with the owner and its own
  kill-on-close inner job, the payload created suspended inside both, `CONFIRMED` with
  its kernel identity, held until `GO`, `STOP` by its pinned handle, `END proved` only
  when the job holds the helper alone, and the job handle kept until the helper's
  normal exit. Its exit code is `RunTeam`'s, the payload's, as `exit` returned it in
  PowerShell. Standard input, output and error are the payload's, so a launch that fails
  writes nothing to them and exits 1 (PowerShell wrote its error record there, which
  could name a path); one that fails after its job exists ends inside it by
  kill-on-close, as before. One helper, no second program.
- **`windowsTeamDriver`** runs it through `windowsJobHost` (absolute path, the helper's
  environment, §4), with the same working folder as before (the launch's), hidden, three
  pipes. `runTeamArgs` builds the arguments; Node quotes each for the C runtime, the CLR
  splits them back, and `RunTeam` quotes the payload's arguments again for the payload's
  C runtime (`isVerbatim` passes a `cmd.exe` line as built). The PowerShell script, its
  `[string[]]@(...)` literals and the imports only it used are gone.
- Comments naming the helper's callers (`MuseSparkJob.cs`, `shellJob.ts`,
  `execGuard.ts`) list the team launch; `RunTeam`'s comment about returning the exit code
  "before PowerShell returns" now names `run-team`.

The Windows command-line limit (32,767 characters) bounds the launch as before: the
whole PowerShell script, every value quoted, was on one command line then; now the
values alone are.

## 3. Measurements

The counters CC-WINWORKERS used, copied into this worktree's `temp/measure/` (not
committed): `count.cjs`, loaded with `node --require` into the test process, records
every `spawn`, `spawnSync`, `execFile`, `execFileSync`, `exec` and `fork` with its time;
`analyze.mjs` reads the "Windows PowerShell" event log (event 400, one per engine start,
with its command line) with `wevtutil` for each marked window and attributes an event to
the run when its command line names the run's scratch folder or helper. The driver
(`temp/measure/teamlaunch.measure.test.ts`, under a vitest config that includes only it)
runs the product's own `createNativeTeamProcessDriver` of the tree it sits in: the real
helper build and self-test, then per round one launch of `node -e "process.exit(0)"`
(launch, `CONFIRMED`, `GO`, exit, `END proved`, close). "Before" is the two files as
they are at `1b44323c7d` (byte-identical to `git show HEAD:<path>`, checked with
`git hash-object`), put in place for the run and replaced byte for byte afterwards;
"after" is this change. Five launches a run; the last four runs were interleaved
(before, after, before, after) to share the PC's load.

| Run     | Route      | CPU load (start → end) | PowerShell starts per launch (engine log; this process's own spawns) | Confirmed after (ms)         | Whole launch (ms)            |
| ------- | ---------- | ---------------------- | -------------------------------------------------------------------- | ---------------------------- | ---------------------------- |
| before  | PowerShell | 99 %                   | **1, 1, 1, 1, 1** (powershell.exe 1 each)                            | 2714, 2149, 1138, 4637, 1399 | 3764, 2716, 1566, 5826, 2131 |
| before2 | PowerShell | 100 % → 100 %          | **1, 1, 1, 1, 1**                                                    | 4032, 1492, 1014, 1107, 1920 | 4753, 2070, 1575, 2461, 2629 |
| before3 | PowerShell | 100 % → 34 %           | **1, 1, 1, 1, 1**                                                    | 207, 201, 191, 176, 165      | 336, 327, 306, 297, 282      |
| before4 | PowerShell | 36 % → 38 %            | **1, 1, 1, 1, 1**                                                    | 362, 287, 336, 311, 296      | 519, 453, 510, 483, 468      |
| before5 | PowerShell | 22 % → 45 %            | **1, 1, 1, 1, 1**                                                    | 299, 316, 278, 312, 295      | 466, 480, 456, 462, 450      |
| after   | native     | 6 % → 8 %              | **0, 0, 0, 0, 0** (the helper 1 each)                                | 80, 71, 60, 65, 59           | 193, 186, 172, 172, 169      |
| after2  | native     | 41 % → 14 %            | **0, 0, 0, 0, 0**                                                    | 74, 100, 126, 82, 80         | 204, 249, 242, 203, 201      |
| after3  | native     | 24 % → 42 %            | **0, 0, 0, 0, 0**                                                    | 120, 112, 91, 84, 99         | 259, 264, 252, 218, 238      |
| after4  | native     | 42 % → 39 %            | **0, 0, 0, 0, 0**                                                    | 131, 103, 87, 85, 102        | 263, 231, 218, 222, 242      |

In every window the PC's own engine-start count equalled the run's (no other
PowerShell started meanwhile). Totals: **25 of 25** launches started one Windows
PowerShell before, **20 of 20** none after. At the comparable load (22 to 45 %, runs
before3 to before5 against after2 to after4) the median time to `CONFIRMED` fell from
295 ms to 99 ms and the whole launch from 456 ms to 238 ms. On the PC at 99 to 100 %
(before, before2) the PowerShell route took 1.0 to 4.6 s to confirm, against the
driver's 5 s confirmation clock (`NATIVE_CONFIRM_MS`); no "after" run fell in such a
period, so the native route at that load is not measured here. Each run's setup (the
helper's build and its PowerShell self-test, CC-WINWORKERS §3) made one PowerShell start
in both routes.

## 4. The job helper's environment (decision 5)

CC-WINHOOK's record said `windowsJobHost` gives an "environment of `SystemRoot` only".
What the code gives is `SystemRoot` and the guard's `NoDefaultCurrentDirectoryInExePath=1`
(`noWorkspaceChildEnvironment` adds it). What the helper gets is more: Node's process
start on Windows (libuv's `make_program_env`, `required_vars`) copies, from the starting
process, each of `HOMEDRIVE`, `HOMEPATH`, `LOGONSERVER`, `PATH`, `SYSTEMDRIVE`,
`SYSTEMROOT`, `TEMP`, `USERDOMAIN`, `USERNAME`, `USERPROFILE` and `WINDIR` that the given
environment lacks. Measured on this PC (a child started with `{ SystemRoot, PATH: '',
TEMP: '' }`): the two emptied names arrive present and empty (`"PATH":""`, `"TEMP":""`),
the other eight arrive with this process's values. So the code **cannot** pass exactly
`SystemRoot` alone through Node's process start: a variable can be emptied but not left
out. The real set, on every call of the helper (the governor's, the workers' file
commands, the playbook's contained job and its end by name, the legacy stop, and now the
team launch): `SystemRoot`, `NoDefaultCurrentDirectoryInExePath=1`, and those ten that
the starting process has, with its values; none is a credential, and `PATH` is the
starting process's whole PATH.

- `windowsJobHost`'s comment says exactly that, and that a program the helper starts
  for a caller is named by its absolute path (§5 is why).
- `jobHostNative.test.ts` reads it back: the given names are exactly the two; a Node
  probe started with that environment (Node's process start is the same for any
  program) sees exactly the given names plus the libuv names this process has, and not a
  variable only this process has (`MUSE_JOB_HOST_PARENT_ONLY`); `PATH` is this process's.
  A Node upgrade that changed libuv's list would fail it, as it should: the record would
  then be wrong.
- CC-WINHOOK's record (`cc-winhook.md` §2) is corrected in place, dated, naming this
  section; `pathGuardSpawns.test.ts`'s two "SystemRoot-only guarded env" reasons now say
  what is given.

## 5. The playbook's dispatch head named `git` bare (decision 4, commit `21daa32597`)

`PlaybookOutcomes.head()` (`src/core/orchestration/playbook/outcomes.ts`) built its
first effect by hand with `command: 'git'`; every other effect is `this.effect(...)`,
whose command is `this.gitCommand()` (`processGitPath`: git resolved outside the
workspace, links followed; D24). On Windows the effect runs in the contained job's helper,
whose `Process.Start` looks a bare name up through `CreateProcess`: the helper's folder,
its working folder, the system folders, then **the helper's own PATH**, which §4 shows is
the starting process's whole PATH. Measured (`temp/measure/baregit.measure.test.ts`, not
committed): with a copy of `whoami.exe` named `git.exe` first on this process's PATH, a
bare `git` through the real contained job printed `mini-dt\randy`, status 0. The
admission also never saw the path it approved.

`head()` now uses `this.effect('git', this.workspace, [...])`. `playbookHeadGit.test.ts`
(new): a real repository and real git, a program named git planted inside the workspace
and put first on this process's PATH (on Windows a copy of `hostname.exe`, on POSIX a
script), the real contained job on Windows; `head()` must answer `refs/heads/main` and
the real commit, and both admitted effects must carry `processGitPath`'s absolute git.

## 6. Real-process suites

| Suite                                  | What it runs for real                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Result |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `teamLaunchWindows.test.ts` (new)      | `createNativeTeamProcessDriver` over the helper the product's builder makes, launching a real Node payload: the helper is the compiled job helper (`spawnfile`), never PowerShell; `CONFIRMED` names the payload's real image and SID; the payload sits suspended in the launch's named job beside its helper (read back with the helper's `query`) and has not run 500 ms later; released, it gets nine hostile arguments byte for byte (quotes, trailing backslashes, an empty one, `%PATH%`, `^&\|<>()`, `$(...)`, backtick, Unicode), its working folder, exactly the guarded environment block (a hostile value included) and exits 37 with `END proved`; exit codes 0, 1, 2, 255, 1000 and 3221225477 passed exactly; a batch file (a space in its name) through `cmd.exe` verbatim, exit 42; the payload's standard streams; below-normal on helper and payload when asked (read with `os.getPriority`), the caller's otherwise; `STOP` ends payload and detached grandchild, `END proved`, exit 1; a killed helper takes payload and grandchild (kill-on-close), `uncertain`; a launch retired before `GO` never runs | 8 of 8 |
| `playbookHeadGit.test.ts` (new)        | §5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 1 of 1 |
| `jobHostNative.test.ts` (one new case) | §4, with CC-WINHOOK's and CC-WINWORKERS' five cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 6 of 6 |

One `vitest run` on the final code (`--maxWorkers=4`, the PC at 100 % CPU when it
started): **29 files, 372 passed, 11 skipped, exit 0** (528 s). Beside the three above it
held the suites that import `processLifetime.ts` (`pathGuardRound6`, `pathGuardRound7`),
the spawn inventory (`pathGuardSpawns`), the suites that run `head()` for real through
the panel governor's dispatch over a real repository (`playbookGovernor`,
`playbookConversation`, `playbookWindow`), the team playbook's over the same outcomes
(`teamPlaybookRounds`, `teamPlaybookIntegration`), and every suite that builds or runs the job helper from
`MuseSparkJob.cs`, whose digest this change moves (`playbookContainedJob`,
`playbookWindowBundle`, `windowsTreeReader`, `teamWorkerCreate`, `teamWorkerCreateBundle`,
`shellJobRetiredBuilds`, `processTreeJobStop`, `hookLaunchWindows`,
`actuatorsWindowsNative`, `mediaJobRun`, `jobCreateAtomic`, `resourceHandoffDeadline`,
`resourceCreatedSweep`, `mcpJobRetire`, `judgeB1HoldDrill`, `governedCheckoutGit`,
`createdRegistrySpaces`, `createdRegistryRace`). The reverse import closure of
`outcomes.ts` reaches 667 of the 1354 test files and that of `execGuard.ts` 707 (the
vault suites among them; computed by `temp/logs/related.mjs`, CC-WINWORKERS' script, not
committed), which this PC's rule forbids; `execGuard.ts` and `shellJob.ts` changed in
comments only, and `processLifetime.ts`'s closure is the three files run here.

The first run of `teamLaunchWindows.test.ts` failed one case: the batch file read `%1`,
which is `"42"` with its quotes (the product quotes each batch argument, `cmdQuoted`),
and `exit /b "42"` exits 0. The same line through plain `spawnSync`, no helper, also gave
0 (`temp/tmp/probe/cmd.cjs`); the batch now reads `%~1`. A test mistake, not the product's.

## 7. Red/green drills

Each: the code as described, the non-zero exit or the PowerShell start seen, restored
from a saved copy (SHA-256 checked against the saved file), green again. `--maxWorkers=4`,
the repository's own timeouts.

| #   | Broken on purpose                                                                                           | Caught by                                                 | Red                                                                                                                                                                                               | Restored                     |
| --- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1   | the old path: `processLifetime.ts` and `MuseSparkJob.cs` as they are at `1b44323c7d` (PowerShell `RunTeam`) | `teamLaunchWindows.test.ts`; the counters (§3, before3–5) | exit 1, 1 of 8: `spawnfile` was `C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe`; the other 7 passed on the PowerShell route (the same launch); 1 PowerShell start per launch          | byte-exact (SHA-256), 8 of 8 |
| 2   | `run-team` returning 0 instead of `RunTeam`'s code                                                          | `teamLaunchWindows.test.ts`                               | exit 1, 4 of 8: 0 where 37, 1, 42 and 1 (`STOP`) were expected                                                                                                                                    | byte-exact                   |
| 3   | every payload argument passed verbatim (`String(true)` for `isVerbatim`)                                    | `teamLaunchWindows.test.ts`                               | exit 1, 1 of 8: 18 arguments arrived where 12 were sent (`naïve ✓ 日本語` split)                                                                                                                  | byte-exact                   |
| 4   | `head()` naming `git` bare again (`outcomes.ts` as at `1b44323c7d`)                                         | `playbookHeadGit.test.ts`                                 | exit 1: `ref: undefined` where `refs/heads/main` was expected: the call answered status 1 with no output, which the real git on `main` never does (§5's probe shows what a bare `git` runs there) | byte-exact                   |
| 5   | `windowsJobHost` handing the helper this process's whole environment                                        | `jobHostNative.test.ts`                                   | exit 1: 147 names given where 2 were expected                                                                                                                                                     | byte-exact                   |

Kill-on-close on the outer team job is not drilled: the inner launcher job (the shared
`MuseSparkMcpJob`, also kill-on-close, its only handle in the same helper) holds the same
payload and grandchild and ends them when the helper dies, so removing the outer flag
alone changes nothing a test can see. The outer flag is the second wall around anything
in the outer job the inner one does not hold; the C# that sets it is unchanged.

After the drills the folder of each was removed and no `node.exe` with a drill's command
line was left on the PC (the cases' own `afterEach` kills a helper still running, and its
kill-on-close job takes the rest).

## 8. Gates

Every command ran from the worktree, on the code of the commits (the record's commit
changes no code), with `TMP`/`TEMP` in `temp/tmp` for the suites. The owner was using the
PC throughout (6 to 100 % CPU).

| Gate                                                                                                                                                             | Exit          | Result                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check --ignore-unknown` on every changed and new file                                                                                                | 0             | all use Prettier code style (the C# has no Prettier parser)                                                                                                                                                                                                                                                                                                                                             |
| `eslint --max-warnings 0` on the 8 changed code files                                                                                                            | 0             | the first run found six problems in the three suites (three sorts without a comparer, a boolean name, an `if` instead of an early `continue`, two functions to move out); fixed, not disabled                                                                                                                                                                                                           |
| `npm run typecheck` (host, webview, unit, e2e, integration, faults)                                                                                              | 0             | no `error TS` line (176 s)                                                                                                                                                                                                                                                                                                                                                                              |
| `node scripts/check-l10n.mjs`                                                                                                                                    | 0             | 14 UI tables, 14 usage tables, 284 manifest strings, 2496 source files; 0 problems (no text a person reads was added)                                                                                                                                                                                                                                                                                   |
| `npm run check:host-api`                                                                                                                                         | 0             | 392 VS Code APIs, 57 files importing vscode; 0 problems                                                                                                                                                                                                                                                                                                                                                 |
| `npm run check:plan`                                                                                                                                             | 0             | 244 milestones; 0 drift (with this lane's M107 paragraph)                                                                                                                                                                                                                                                                                                                                               |
| `npm run check:roadmap`                                                                                                                                          | 0             | 244 entries; `ROADMAP.md` current                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run check:catches`                                                                                                                                          | 0             | all catch sites and counts match the baseline (no catch added or moved)                                                                                                                                                                                                                                                                                                                                 |
| `npm run duplication`                                                                                                                                            | 0             | 0 clones                                                                                                                                                                                                                                                                                                                                                                                                |
| `npm run deadcode`                                                                                                                                               | 0             | knip clean (the same 5 configuration and 5 tag hints as the base)                                                                                                                                                                                                                                                                                                                                       |
| **`npm run build`**                                                                                                                                              | **1**         | **the four known rows, unchanged to the tenth of a KiB, and nothing else:** `dist/teamRunners.js` 78.4 of 75, `dist/teamHost.js` 140.2 of 130, `dist/teamScheduler.js` 76.5 of 75, `dist/uiText.js` 125.3 of 125, as CC-WINWORKERS §7 measured them on the base. No budget raised. `dist/playbook.js` 133.9 of 150. No bundle in `dist/` contains `run-team` or `RunTeam(` (the team driver is in none) |
| the rest of the build chain by hand: `check-bundle-split`, `gen-lazy-registry --check`, `check-host-globals`, `third-party-notices`, `check-legal-build-records` | 0, 0, 0, 0, 0 | the split gate passes; 184 bundles, 290 loads resolved, current; 93 notices; 165 legal bundles, 2899 files, 0 problems                                                                                                                                                                                                                                                                                  |
| `npm run check:reference`                                                                                                                                        | 0             | current                                                                                                                                                                                                                                                                                                                                                                                                 |
| **`npm run check:mhp`**                                                                                                                                          | **1**         | known on int, not re-frozen: `MHP_VERSION_LOCK: v1.1 frozen wire contract changed (expected 80d04e5d634a3dc315f5da8b8231a688b526ff589c96cf05f217eeebe6e3783e)`, the line CC-WINWORKERS recorded on the base; no MHP file changed here                                                                                                                                                                   |
| `npm run package:acp -- --target win32-x64`                                                                                                                      | 0             | 106 s; **141 of 141** packaged-bundle checks; `dist/muse-spark-code-acp-0.19.0-win32-x64.tgz`, 4,059,185 bytes (SHA-256 `9d879d53accc2602cf7f8d0b400b7dc36a61b5c3c652eae2fbb43876fa024d73`), its `native/windows/MuseSparkJob.cs` byte-identical to the tested one                                                                                                                                      |
| the suites in one `vitest run` (§6), `--maxWorkers=4`                                                                                                            | 0             | 29 files, 372 passed, 11 skipped                                                                                                                                                                                                                                                                                                                                                                        |

## 9. The packed product

The team launch and the playbook's dispatch head cannot be reached through a packed
build today: no product code starts the native team lifetime (§1, and no shipped bundle
holds the driver), and the playbook's git calls run in the VS Code window, which this
lane may not start (the ACP agent's playbook surface has no contained runner on Windows
and refuses git there). What the package does carry is the changed helper source, which
every Windows job helper call in the product compiles. So the package above, unpacked
with `tar -xzf` into `temp/packed/pkg` (`node dist/acp.js --version` printed `0.19.0`),
was driven as CC-WINHOOK and CC-WINWORKERS drove it (`temp/packed/drive.mjs`, their
script, not committed): `dist/acp.js lsp --workspace <ws> --trust-workspace --tab
--verbose` under `vscode-jsonrpc`, a scratch `HOME`, `LOCALAPPDATA`, `APPDATA` and `TMP`
under `temp/packed/run`, one `beforeTabFileRead` command hook that gives no permission
(so no key is read), five inline completions, the counter loaded into the agent, the PC
at 13 %.

- The agent built the helper `MuseSparkJob-85f0da71905d317f.exe`, the digest the suites
  and the measurement built from the same source, and swept the two earlier library
  builds from its folder as CC-WINWORKERS made it do.
- Each of the five requests ran the hook (`beforeTabFileRead: denied` five times),
  answered `{"items":[]}` (781 to 896 ms warm, 1343 ms cold), asked **0** questions; the
  agent exited 0.
- **1** Windows PowerShell start in the whole process (the helper's self-test, by the
  counter, and the only engine start on the PC in that window); the new helper ran 50
  `created` and 33 `query` calls and the launcher 11 times, all native.

No model request was made and nothing was sent to a provider.

## 10. Decisions for the lead

1. **The helper's PATH, and `run-team`'s working folder.** Windows PowerShell got the
   launch's credential-free environment with its PATH guarded (workspace, relative and
   drive-relative entries dropped); the native helper gets the starting process's whole
   PATH (§4), as every native caller has since CC-WINHOOK. Nothing the helper does
   resolves a program by name any more (`RunTeam` passes an absolute
   `lpApplicationName`; every contained call names an absolute program after §5; the
   governor's calls start nothing), so what is left is the last steps of Windows' DLL
   search (the working folder, then PATH's folders) for a DLL not found in the helper's
   folder or the system folders. `run-team`'s helper keeps the launch's folder as its
   working folder, as PowerShell had it. Options: (a) keep; (b) `windowsJobHost` passes
   PATH as the guarded absolute-only PATH, what the PowerShell helpers had; (c) it
   passes PATH present and empty (measured: it arrives as `""`), so the helper's own
   lookups stop at its folder, its working folder and the system folders, and a bare
   name a future caller passes for a program found nowhere there fails
   closed (the contained job answers `ENOENT`), and `run-team`'s helper works in its own
   folder (the payload's folder goes to `CreateProcessW` either way). Recommendation:
   (c), one change for every native caller with `jobHostNative`'s case moved with it.
   Not made here: it changes what every caller's helper gets, past this brief ("state the
   real set").
2. **Nothing is claimed in the CHANGELOG.** The team launch has no product caller
   (RLF-TEAMWIRE's decision 2 is who assembles `startTeamMuseCodeHost`), and the playbook
   head runs only in the VS Code window. Recommendation: claim the team launch when the
   team assembly lands and a real team run goes through a packed build; the dispatch
   head with the release's real playbook run in a packed VS Code build.
3. **The team driver's POSIX route has no real suite either.** The mock-driven suites
   went in the 2026-10-12 overhaul for both systems; this lane added Windows only.
   Recommendation: a real-process suite for the `setpriv`/`systemd-run` and process-group
   routes in the lane that wires the team host, run on Linux and macOS.
4. **A comment names a test that no longer exists.** `MuseSparkJob.cs` and
   `MuseSparkMcpLauncher.cs` say `test/unit/jobSource.test.ts` holds the class names and
   constants together; there is no such file (the only suite that reads
   `SHELL_JOB_TYPE_NAME` is `jobHostNative.test.ts`, which calls the type by that name
   in PowerShell and fails if they part). Left as found: an edit there moves the helper's
   digest after the suites ran. Recommendation: fix the two comments in the next change
   that touches the helper.
5. **No "after" at 99 to 100 % CPU.** The PC was quiet during every native run (§3).
   Recommendation: none needed for the decision (25 of 25 against 20 of 20 PowerShell
   starts is the result); if the lead wants the busy-PC timing, one interleaved run under
   CC-WINHOOK's two-CPU contention would give it.

## 11. Commits

`1b44323c7d` → `a7bee6fcb5` (`perf(windows):` the team launch on the job helper, the helper's
environment recorded and read back, the suites) → `21daa32597` (`fix(playbook):` the dispatch
head's git, its suite) → the commit carrying this record, the PLAN paragraph, the index
line and CC-WINHOOK's corrected sentence.
