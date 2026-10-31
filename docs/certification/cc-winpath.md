# CC-WINPATH — the job helper's PATH, working folder and DLL search, closed for every native caller (2026-10-30)

Claude Code lane `CC-WINPATH`, worktree `C:/Users/Randy/Coding/mx-cc-winpath`,
branch `cc/winpath`, cut from `cc/winrunteam` `57e6126ca9` (int/recovery
`0a5ebd7189` with CC-WINHOOK, CC-WINWORKERS and CC-WINRUNTEAM), on the owner's
Windows 11 PC (Windows 11 Pro 10.0.26200, Intel i9-12900HK, 20 logical CPUs,
Node 24.20.0). It carries out CC-WINRUNTEAM's decisions 1 and 4, which the lead
accepted as a security hardening. Model attempts: **0**. Provider calls: **0**.
Muse requests: **0**. Nothing was pushed, rebased, reset, stashed by hand or
tagged (the pre-commit hook's own lint-staged backup is the only stash a commit
touched). The vault suites and the real credential-store suites
(`test/unit/vault/**`, `keyringParts`, `keystoreOwner`, `credentialLease`,
`providerHeadersStore`) were never run on this PC. Scratch files lived in the
worktree's ignored `temp/` (`TMP` and `TEMP` at `temp/tmp`); one heavy command
ran at a time; no busy loop was started.

## 1. What was left open, and the threat

CC-WINRUNTEAM moved the last native caller (the team launch) onto the job
helper and recorded `windowsJobHost`'s real environment: `SystemRoot`, the
guard's `NoDefaultCurrentDirectoryInExePath=1`, and the ten variables Node's
process start on Windows copies from the parent, `PATH` among them, with this
process's whole value. Nothing the helper starts is looked up by name any more
(`RunTeam` passes an absolute `lpApplicationName`; every contained call names
`processGitPath`'s absolute git; the governor's calls start nothing). But two
walks still reached a folder anyone could write:

- **Windows' DLL search.** `CreateProcess` completes a program's own imports,
  and the loader resolves any DLL a process needs without a full path, through
  a path that (in safe mode) ends in the current folder and then `PATH`'s
  folders. The helper ran with the workspace as its current folder (the team
  launch's cwd, the contained helper's `process.cwd()`) and the parent's whole
  `PATH`.
- **A future bare name.** Nothing passes a bare program name today, but nothing
  stopped one: the helper's `Process.Start`/`CreateProcessW` would resolve it
  through the helper's own folder, its working folder and its `PATH`.

CC-WINRUNTEAM's decision 1 recommended option (c): pass `PATH` empty, as one
change for every native caller. Decision 4: two comments cite
`test/unit/jobSource.test.ts`, which does not exist.

## 2. The change (commit `8c1e5f8327`)

- **`windowsJobHost`** (`src/core/execGuard.ts`) now returns `cwd` (the helper's
  own folder) beside `file` and `env`, and gives `PATH` present and empty. Node
  keeps the emptied `PATH` rather than copying the parent's (measured by
  CC-WINRUNTEAM and re-measured here); the other nine libuv variables still
  arrive, none a credential. Every native caller passes `host.cwd` as the
  spawn's working folder: the governor's tree reads and created-path registry
  (`trees/windows.ts`, `resourceGovernorEntry.ts`, through `ResourceTreeRun`'s
  new `cwd`), the job holder (`resourceJobHolder.ts`), the team workers' file
  commands (`workerOps.ts`, through the governed launcher), the legacy shell
  stop and the playbook's end by name (`processTree.ts` `RunProgram`'s new
  `cwd`, `playbookWindow.ts`), the playbook's contained job
  (`containedJob.ts`'s `StartContainedHelper` and `end-job`), and the team
  launch (`processLifetime.ts`'s `windowsTeamDriver`). The payload still gets
  its own working folder: `run-team` passes the payload's `cwd` to
  `CreateProcessW`, and the contained call passes the effect's `cwd` to the
  payload it starts.
- **`MuseSparkJob.cs`** restricts its own DLL search for the life of the
  process. `MuseSparkJobHost`'s `worker`, `run-team` and `Main` each call
  `SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_APPLICATION_DIR |
LOAD_LIBRARY_SEARCH_SYSTEM32)` as their first act, and the assembly carries
  `[assembly: DefaultDllImportSearchPaths(DllImportSearchPath.System32)]` so
  every platform invoke resolves from `%windows%\system32` only (see §5 for the
  Microsoft sources). `RunTeam` and `ContainedCall` refuse a program or a
  working folder that is not fully qualified (`IsFullyQualified`: a drive path
  `C:\…` or a UNC `\\…`, never a bare name, a relative or a drive-relative
  path), before any job or process exists.
- **Decision 4.** `MuseSparkJob.cs` now says `test/unit/jobHostNative.test.ts`
  holds the class name together with `SHELL_JOB_TYPE_NAME` (it calls the type by
  that name in Windows PowerShell, as the shell tool does), and
  `MuseSparkMcpLauncher.cs` says `test/unit/mcpJobRetire.test.ts` holds its
  self-test and configuration constants (it builds the launcher through
  `sealedMcpJobExecutable` and launches a payload through `spawnMcpJob`).

## 3. Measurements (loader traces and the working folder)

Every native caller was run through the product's own modules of the tree it
sits in (`temp/measure/winpath.measure.test.ts`, not committed), with a copy of
`whoami.exe` planted under a program name (`git.exe`) and under every DLL name
the helper's start loads, in a folder first on this process's `PATH` and (for
the program) in this process's working folder (the workspace); the parent's
whole `PATH` was kept. The helper it ran was a wrapper (`temp/snaps/SnapWrap.cs`,
compiled with the helper's own C# so Windows PowerShell's self-test still finds
the type) that starts the genuine helper exactly as it was started, under a
minimal debugger with the loader's snaps on, and logs the working folder, the
`PATH`, every module loaded and every DLL search the loader computed. "Before"
is the two changed files at `57e6126ca9`, compiled the same way; "after" is this
change.

| Caller (helper command)                   | Working folder                                                | `PATH` first entry                        | Loader DLL search reaches the workspace or the planted PATH folder | Planted DLL loaded |
| ----------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------ | ------------------ |
| tree reader (`identity`, `query`)         | before: the workspace → after: the helper's own folder        | before: the planted folder → after: empty | before: **yes** → after: **no**                                    | 0 → 0              |
| created-path registry (`created publish`) | workspace → helper's folder                                   | planted → empty                           | yes → no                                                           | 0 → 0              |
| job holder (`hold`)                       | workspace → helper's folder                                   | planted → empty                           | yes → no                                                           | 0 → 0              |
| contained job (`contained`)               | workspace → helper's folder                                   | planted → empty                           | yes → no                                                           | 0 → 0              |
| team launch (`run-team`)                  | before: the payload's folder → after: the helper's own folder | planted → empty                           | yes → no                                                           | 0 → 0              |

Before, the loader's computed search path for a DLL searched by name was, in
order, the Framework folder, `System32`, the system and Windows folders, `.`
(the current folder, the workspace) and then the parent's whole `PATH`
(beginning with the planted folder). After, `SetDefaultDllDirectories` is
located by the loader (twice, in each run) and the computed path is reduced: `.`
now resolves to the helper's own folder, and the `PATH` folders are gone. No
planted copy of `whoami.exe` was ever loaded in either build, before or after:
every DLL the helper needs (the CLR, the C runtimes, the system DLLs) is a
Known DLL or lives in `System32`/the Framework folder, found before the current
folder or `PATH` in the order — so the DLL search reaching the workspace and
`PATH` was a latent exposure with no currently-loadable target, closed anyway.
The behavioural exploit was the program lookup (§4).

Two behaviours a caller's working folder decides, measured before and after:

- **A bare `git` through the real contained job.** Before: status 0,
  `mini-dt\randy` — the planted `whoami.exe` ran (the contained call set no
  guard; the helper's cwd was the workspace, where `git.exe` was planted).
  After: status `null`, `ENOENT` — the helper refuses the bare name before
  anything starts.
- **The team payload's folder renamed while it ran.** Before: `EBUSY` — the
  helper held the payload's folder as its own working folder. After: `renamed`
  — the helper works in its own folder, so the payload's is free.

## 4. Red/green drills

Each: the two changed files put back to `57e6126ca9` (`git show HEAD:`),
compiled, the suite run and the non-zero exit seen; restored from the saved
`after` copies (and the suite green again). `--maxWorkers=4`, the repository's
own timeouts.

| #   | Broken on purpose (the base files)                                                                                            | Caught by               | Red                                                                                                                                                         | Restored      |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | the base `MuseSparkJob.cs` and `execGuard.ts` (full PATH, workspace cwd, no fully-qualified guard, no DLL-search restriction) | `jobHostHijack.test.ts` | exit 1, 1 of 5: the bare `git` ran the planted `whoami.exe` (status **1**, the decoy rejected git's arguments) where the guard's `null`/ENOENT was expected | green, 5 of 5 |
| 2   | the same base files                                                                                                           | `jobHostNative.test.ts` | exit 1, 1 of 6: `windowsJobHost`'s env had **2** names (`NoDefaultCurrentDirectoryInExePath`, `SystemRoot`) where **3** with an empty `PATH` were expected  | green, 6 of 6 |

After the drills no `node.exe` or helper with a drill's command line was left on
the PC (each suite's own teardown kills a helper still running, and its
kill-on-close job takes the rest).

## 5. The DLL-search choice and its Microsoft sources

`SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_APPLICATION_DIR |
LOAD_LIBRARY_SEARCH_SYSTEM32)` establishes a process DLL search path of the
application's own folder and `%windows%\system32` only, for the life of the
process, and it "eliminates the most vulnerable directories" — the current
folder and `PATH` — from the search (Microsoft Learn, _SetDefaultDllDirectories
function_, read 2026-10-30). The .NET Framework's platform invokes go through
`LoadLibraryEx`, so the assembly also carries `[assembly:
DefaultDllImportSearchPaths(DllImportSearchPath.System32)]`, which Microsoft
documents as the way "to prevent the Win32 `LoadLibraryEx` function from
searching the current working directory … so that … the function's default
search order finds the malicious DLL instead of the system DLL it was intended
to find" (Microsoft Learn, _DefaultDllImportSearchPathsAttribute Class_,
`netframework-4.8`, read 2026-10-30; it applies to .NET Framework 4.5+, which
compiles the helper). The two together cover both the runtime's own loads
(`SetDefaultDllDirectories`) and each P/Invoke's resolution
(`DefaultDllImportSearchPaths`). The search-order details — the current folder
at position 11 and `PATH` at 12 in safe mode, and the `LOAD_LIBRARY_SEARCH`
order that excludes both — are from Microsoft Learn, _Dynamic-link library
search order_ (read 2026-10-30).

## 6. Real-process suites (final code, `--maxWorkers=4`, repository timeouts)

| Suite                                        | What it runs for real                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Result |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `jobHostHijack.test.ts` (new)                | every native caller (tree reader, job holder, the contained job's real dispatch head over a real repository, the team launch) through the product's modules, with `git.exe` planted in the workspace and on `PATH` and DLL decoys on `PATH`, this process working in the workspace: the head answers the real branch and commit, a bare `git` is refused (`null`/ENOENT), the team payload is the named node (not a decoy) and its folder is free while it runs, and the helper folder holds neither planted name | 5 of 5 |
| `jobHostNative.test.ts` (one case rewritten) | `windowsJobHost` gives `SystemRoot`, the guard variable and an empty `PATH`, works in the helper's own folder, and a Node probe started with that env in that folder sees exactly those plus the libuv names this process has (never `PATH` from the parent, never a parent-only variable), with CC-WINHOOK's, CC-WINWORKERS' and CC-WINRUNTEAM's cases                                                                                                                                                           | 6 of 6 |
| `teamLaunchWindows.test.ts` (cleanup helper) | the real team driver's eight cases, now starting the helper in its own folder                                                                                                                                                                                                                                                                                                                                                                                                                                     | 8 of 8 |
| `playbookHeadGit.test.ts` (shared helpers)   | the dispatch head over a real repository with a planted `git`, the real contained job on Windows                                                                                                                                                                                                                                                                                                                                                                                                                  | 1 of 1 |
| `pathGuardSpawns.test.ts`                    | the spawn inventory; the `windowsJobHost` reasons now name the empty `PATH` and the helper's own folder                                                                                                                                                                                                                                                                                                                                                                                                           | 7 of 7 |

Beside those, the native-caller suites the brief names, run green on the final
code: `playbookContainedJob` (24 passed, 2 POSIX-skipped), `windowsTreeReader`
(2), `actuatorsWindowsNative` (2), `teamWorkerCreate` (122 passed, 3 skipped),
`governorWindowsBundle`, `playbookGovernor`, `hookLaunchWindows`,
`processTreeJobStop` (162 passed, 4 skipped across five files), and the two
`runtimeLsp.test.ts` Tab-hook cases (2 passed, 8 filtered). The reverse import
closure of `execGuard.ts` reaches most of the battery and the vault suites,
which this PC's rule forbids; the suites above exercise it for real.

## 7. Gates

Every command ran from the worktree with `TMP`/`TEMP` in `temp/tmp`, on the
committed code. The owner was using the PC throughout.

| Gate                                                                                                                                                             | Exit          | Result                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check` on the changed and new TS (C# has no Prettier parser)                                                                                         | 0             | all use Prettier code style                                                                                                                                                                                                                                                                                                              |
| `eslint --max-warnings 0` on the 18 changed TS files                                                                                                             | 0             | the first run found two `String.raw` and one void-return problems in the new suite and helper; fixed, not disabled                                                                                                                                                                                                                       |
| `npm run typecheck` (host, webview, unit, e2e, integration, faults)                                                                                              | 0             | no `error TS` line                                                                                                                                                                                                                                                                                                                       |
| `node scripts/check-l10n.mjs`                                                                                                                                    | 0             | 14 UI tables, 14 usage tables, 284 manifest strings, 2496 source files; 0 problems                                                                                                                                                                                                                                                       |
| `npm run check:host-api`                                                                                                                                         | 0             | 392 VS Code APIs, 57 files importing vscode; 0 problems                                                                                                                                                                                                                                                                                  |
| `npm run check:plan`                                                                                                                                             | 0             | 244 milestones; 0 drift (with this lane's M107 paragraph)                                                                                                                                                                                                                                                                                |
| `npm run check:roadmap`                                                                                                                                          | 0             | 244 entries; `ROADMAP.md` current (with the CHANGELOG Security entry)                                                                                                                                                                                                                                                                    |
| `npm run check:catches`                                                                                                                                          | 0             | all catch sites and counts match the baseline (no catch added or moved)                                                                                                                                                                                                                                                                  |
| `npm run duplication`                                                                                                                                            | 0             | 0 clones (the new suite's shared setup moved into `headRepo.ts` and `killLaunched`)                                                                                                                                                                                                                                                      |
| `npm run deadcode`                                                                                                                                               | 0             | knip clean (the same 5 tag hints as the base)                                                                                                                                                                                                                                                                                            |
| **`npm run build`**                                                                                                                                              | **1**         | **the four known rows, unchanged to the tenth of a KiB, and nothing else:** `dist/teamRunners.js` 78.4 of 75, `dist/teamHost.js` 140.2 of 130, `dist/teamScheduler.js` 76.5 of 75, `dist/uiText.js` 125.3 of 125 (CC-WINRUNTEAM §8). No budget raised. `dist/playbook.js` 134.0 of 150. No shipped bundle carries the helper C#          |
| the rest of the build chain by hand: `check-bundle-split`, `gen-lazy-registry --check`, `check-host-globals`, `third-party-notices`, `check-legal-build-records` | 0, 0, 0, 0, 0 | the split gate passes; 184 bundles, 290 loads resolved, current; 93 notices; 165 legal bundles, 2899 files, 0 problems                                                                                                                                                                                                                   |
| `npm run check:reference`                                                                                                                                        | 0             | current                                                                                                                                                                                                                                                                                                                                  |
| **`npm run check:mhp`**                                                                                                                                          | **1**         | known on int, not re-frozen: `MHP_VERSION_LOCK: v1.1 frozen wire contract changed (expected 80d04e5d634a3dc315f5da8b8231a688b526ff589c96cf05f217eeebe6e3783e)`, the line CC-WINWORKERS and CC-WINRUNTEAM recorded on the base; no MHP file changed here                                                                                  |
| `npm run package:acp -- --target win32-x64`                                                                                                                      | 0             | **141 of 141** packaged-bundle checks; `dist/muse-spark-code-acp-0.19.0-win32-x64.tgz`, 4,058,786 bytes (SHA-256 `02faa7258443e8b99425eba965db93e1d7f61752183bf6825c990d95ccde3de0`); its `native/windows/MuseSparkJob.cs` byte-identical to the tested one (SHA-256 `af9adf32164604a7e144636931f4100717b6fdf7e4f976aba7422c428ed0306f`) |

## 8. The packed product

The package above, unpacked with `tar -xzf` into `temp/packed/pkg/package`
(`node dist/acp.js --version` printed `0.19.0`), was driven as CC-WINHOOK and
CC-WINWORKERS drove it (`temp/packed/drive.mjs`, their script, not committed):
`dist/acp.js lsp --workspace <ws> --trust-workspace --tab --verbose` under
`vscode-jsonrpc`, a scratch `HOME`, `LOCALAPPDATA`, `APPDATA` and `TMP`, one
`beforeTabFileRead` command hook that gives no permission (so no key is read),
five inline completions, the counter loaded into the agent, the PC at about
70 %.

- The agent built the helper `MuseSparkJob-931064bbe34f835d.exe` and the
  launcher `MuseSparkMcpJob-fa14a407e4297f07.exe` in its machine folder, and
  swept the two earlier library builds (`MuseSparkJob-690dd47ec7d3b609.dll`,
  `MuseSparkJob-0f1e2d3c4b5a6978.dll`) from it, keeping the two foreign
  look-alikes — as CC-WINWORKERS made it do.
- Each request ran the hook (`beforeTabFileRead: denied` five times), answered
  `{"items":[]}` (779 to 1638 ms), asked **0** questions; the agent exited 0.
  The new helper ran its `created` and `query` calls and the launcher, all
  native, each started by the governor in the helper's own folder with an empty
  `PATH`.
- **1** Windows PowerShell start in the whole process (the job helper's
  self-test, once, in the cold first request's window; the only engine start on
  the PC attributed to the run), and **0** per Tab operation after it. The
  self-test is the one start CC-WINWORKERS §3 keeps (it proves the shell can
  load the type).

No model request was made and nothing was sent to a provider.

## 9. Decisions for the lead

1. **The DLL hijack had no currently-loadable target; the program hijack did.**
   Every DLL the helper needs resolves from `System32` or the Framework folder
   before the current folder or `PATH` in the search order, so a planted DLL
   was never loaded, before or after (§3). The exploitable vector was the
   program lookup — a bare `git` ran a planted `whoami.exe` (§3, §4) — now
   closed by the empty `PATH`, the helper's own working folder and the
   fully-qualified guard. The DLL-search restriction
   (`SetDefaultDllDirectories`, `DefaultDllImportSearchPaths`) is
   defense-in-depth for any future dependency the helper gains that is not a
   system DLL. Recommendation: keep both; the cost is three lines and an
   assembly attribute.
2. **The CHANGELOG claims only the governor's native helper, which the packed
   run exercised.** The team launch has no product caller (CC-WINRUNTEAM
   decision 2) and the playbook head runs only in the VS Code window, so the
   Security entry names the governor's tree reads and created-directory
   registry — the one native-helper surface the packed `lsp --tab` run drives.
   Recommendation: extend the claim to the team launch and the dispatch head
   when a real team run and a real packed VS Code playbook run exist.
3. **The fully-qualified guard is the helper's, not only the caller's.** The
   TypeScript callers already pass absolute programs; the C# guard refuses a
   bare or relative one the OS would otherwise complete from a search path, so
   a future caller that passed one fails closed (ENOENT) instead of running a
   planting. Recommendation: keep it as the last wall.

## 10. Commits

`57e6126ca9` → `8c1e5f8327` (`perf(windows):` the hardening, the C# guards and
DLL-search restriction, the decision-4 comments, the new hijack suite and the
shared test helpers) → the commit carrying this record, the SECURITY.md line,
the CHANGELOG Security entry, the PLAN M107 paragraph and the certification
index line.
