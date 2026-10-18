# Windows process birth read through PowerShell (WINBIRTH)

Recorded on the Windows 11 rig (Windows 11 Pro 10.0.26200, i9-12900HK,
20 threads, Node 24.20.0) in the worktree `mx-winbirth`, branch
`fix/windows-process-birth`, from `296c63f20c`, rebased onto `81dacaf5a7`.
No model calls.

## Finding

PR #154's run `39078271738`, job "build / tests (windows-latest, shard 3)"
(`117529837694`), failed `test/unit/fileLease.test.ts` "process owners
(M123 lane P) > reads this process's birth from the system" after
10,076 ms with "expected undefined to be defined" at line 245. The lead
reports the same failure on main's code in PR #158's organization run
`39082272956` (2026-10-18 00:18Z, shard 3, 10,097 ms) after a pass on that
pull request's run at 00:09Z; that log was not reachable from this rig's
GitHub access, so its numbers are not used below.

**Measured cause.** On Windows, `processStartTime`
(`src/core/locks/processOwner.ts:108-131` on the base `81dacaf5a7`,
`windowsStartTime`) starts
Windows PowerShell 5.1 (`powershell.exe -NoLogo -NoProfile -NonInteractive
-Command [DateTimeOffset]::new((Get-Process -Id <pid> -ErrorAction
Stop).StartTime).ToUnixTimeMilliseconds()`) through `execFile` with
`PROCESS_START_QUERY_TIMEOUT_MS` (10,000 ms, `src/shared/constants.ts:1826`),
and turns every failure, the timeout's kill included, into `undefined`
(`processOwner.ts:161-163`). The failing test took 10,076 ms: the 10,000 ms
kill plus the assertion; in the same job the next test's single query took
4,675 ms. In the five passing CI runs of that shard read for comparison
(`39063233942`, `39065488443`, `39069570770`, `39070870774`,
`39071561346`) the same test, three PowerShell starts, took 3,183 to
3,429 ms, and a later single query about 300 ms. The `exit 0` PowerShell
cold start that `checkCommands.test.ts` prints on Windows shard 5 measured
1,374 to 3,368 ms over six of those runs and once passed 15 s (PR 165,
2026-10-16). So the 10 s bound is crossed by Windows PowerShell's own first
start on a fresh hosted VM, not by reading the time: the engine loads
roughly 300 to 600 ms of CPU work before it runs one statement, and on a
fresh runner that start has stretched from 1.4 s to beyond 15 s. On this
rig the real code took 355 to 430 ms cold (10 fresh Node processes, each
with a fresh `PSModuleAnalysisCachePath`), 342 to 393 ms warm (10 fresh
Node processes on a populated cache) and 360 to 423 ms for 10 calls in one
process; it never approaches the bound here. The same read through a
4 KB C# program calling `OpenProcess` and `GetProcessTimes` needs 31 to
94 ms of CPU against PowerShell's 281 to 656 ms (table below).

| Source (this rig)                       | Idle wall ms, 10 runs (median) | 24 busy loops wall ms, 5 runs (median) | CPU ms  |
| --------------------------------------- | ------------------------------ | -------------------------------------- | ------- |
| PowerShell `exit 0`                     | 237–331 (278)                  | 688–1173 (806)                         | 281–469 |
| PowerShell `Get-Process` (today's code) | 293–606 (337)                  | 787–1080 (921)                         | 312–656 |
| PowerShell `[Diagnostics.Process]` only | 237–470 (281)                  | 806–1477 (991)                         | 297–625 |
| C# exe, `GetProcessTimes`               | 48–69 (55)                     | 256–392 (322)                          | 31–94   |
| `cscript` JScript, WMI `Win32_Process`  | 225–344 (250)                  | 746–1208 (1008)                        | 31–141  |

`wmic` is not installed on this rig (Windows 11 25H2 removed it), and no
other inbox command prints a process's creation time.

Hosted Windows runs test files one at a time (`vitest.config.ts`,
`fileParallelism`), so no other test file was loading that runner; in
shard 3 `fileLease.test.ts` is the first file that starts Windows
PowerShell, so its first query is that fresh VM's first PowerShell start.
What a start has to bring in, read from inside each program at the end of
its read (three runs each, identical):

| Program                       | Images mapped | Their size on disk | Peak working set |
| ----------------------------- | ------------- | ------------------ | ---------------- |
| PowerShell `exit 0`           | 89            | 177.4 MB           | 67.0–67.7 MB     |
| PowerShell `Get-Process` read | 91            | 180.2 MB           | 74.5–74.6 MB     |
| C# reader                     | 34            | 87.1 MB            | 17.3 MB          |

(The C# figure includes `System.dll`, which only the measuring code
loads.) A fresh VM pages all of that in for the first time; the reader
touches about a quarter of PowerShell's memory and needs a sixth of its
CPU.

## Fix

`processStartTime` on Windows (`src/core/locks/processOwner.ts`) no longer
starts PowerShell. A C# 5 program (the compiled reader is 4,608 bytes),
its source in the module,
opens the process with `PROCESS_QUERY_LIMITED_INFORMATION`, refuses one
that has exited (`GetExitCodeProcess`, since an exited process keeps its
times while a handle is open), and prints `GetProcessTimes`'s creation
time in epoch milliseconds. Windows' own .NET Framework compiler
(`%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe`, the one the
job helpers use) builds it once per user into
`%LOCALAPPDATA%\Muse Spark Code\native\MuseSparkBirth-<digest>.exe`
(`WINDOWS_BIRTH_READER_FOLDER`): written under a random name and renamed
into place, so two processes building at once never share a file. Both the
build and each run get only `SystemRoot` from the environment and keep the
10 s `PROCESS_START_QUERY_TIMEOUT_MS` bound — each of them separately, so
a first read on a machine without the reader can take the build's bound
and then the run's. A failed build is not kept; a reader that cannot
start (removed, quarantined, damaged) is deleted and built again on the
next read. Every other contract stands: `undefined` when no running
process has the id or it cannot be opened, never a throw.

The values are the ones PowerShell gave, to the millisecond, for this
process, a live child and the parent; an exited child, id 4 and
999,999,999 read `undefined` (a scratch script over the real module, not
kept in the repository):

```text
self 31528: native 1792283312165 powershell 1792283312165
live child 2720: native 1792283312253 powershell 1792283312253
parent 29452: native 1792283311151 powershell 1792283311151
exited 11672: native undefined
id 4 (System): native undefined
id 999999999: native undefined
```

The real `processStartTime(process.pid)` after the fix, with
`LOCALAPPDATA` pointed into the worktree's `temp/`:

| Case                                                     | Wall ms                                 |
| -------------------------------------------------------- | --------------------------------------- |
| Cold: fresh data folder, so build and read (10 runs)     | 132 119 157 133 174 129 127 131 164 115 |
| Warm: reader built, a fresh Node process each (10 runs)  | 39 44 37 48 39 41 50 51 38 40           |
| Warm: 10 reads in one Node process                       | 45 37 49 44 36 37 45 40 42 36           |
| Before the fix, cold (fresh `PSModuleAnalysisCachePath`) | 401 408 381 391 382 381 393 430 400 355 |
| Before the fix, warm (populated analysis cache)          | 387 354 349 361 387 342 358 381 393 368 |

The inbox compiler took 75 to 113 ms (31 to 78 ms of CPU) over ten builds.
"Reads this process's birth from the system", which makes three reads and
starts one short-lived process, took 754 to 870 ms in five runs on main's
code and 197 to 339 ms after the fix.

## Red drill

With the reader's `Console.Out.Write` line deleted (it exits 0 and prints
nothing), `node node_modules/vitest/vitest.mjs run
test/unit/fileLease.test.ts` exited 1: 4 failed, among them "reads this
process's birth from the system" ("expected undefined to be defined"),
"reads a Windows or macOS birth as the epoch time it was recorded at" and
"names a gone owner only when it is provably gone". Reverted byte for byte
(`cmp` against the saved copy).

## Gates (this rig, commit `eb62e0693f`)

| Gate                                                               | Exit                         |
| ------------------------------------------------------------------ | ---------------------------- |
| `prettier --check .`                                               | 0                            |
| ESLint, product code (`lint:js:main`, `--max-warnings=0`)          | 0 (with `temp/**` excluded¹) |
| `npm run typecheck` (host, webview, unit, e2e, integration)        | 0                            |
| `npm run build` (production, size budgets, split, notices)         | 0                            |
| `check:host-api` (record rewritten: `node:crypto` 174 → 175)       | 0                            |
| `knip`, `cycles`, `jscpd`                                          | 0, 0, 0                      |
| `fileLease.test.ts` + `runtimePullRequestRecords.test.ts`, one run | 0 (51 passed, 1 skipped)     |

¹ ESLint's flat config does not ignore the gitignored `temp/`, so the
scratch scripts of this record fail `lint:js:main` as run; CI has no
`temp/`. Without them the gate is clean.

## Twenty runs of the suite on the committed code

`node node_modules/vitest/vitest.mjs run test/unit/fileLease.test.ts
--reporter=verbose`, 20 times in a row on `eb62e0693f`, with `TEMP`, `TMP`
and `LOCALAPPDATA` inside the worktree's `temp/`. Runs 1 to 10 each had a
fresh data folder, so each built the reader; runs 11 to 20 shared one
(run 11 built it, while the commit's hooks ran). Two load samples during
the runs, with other agents working on the rig, read 74 % and 60 % CPU.
Every run exited 0 with 29 passed and 1 skipped (the Linux case). "Reads
this process's birth from the system" took, in ms:

| Runs                           | Birth test ms                           |
| ------------------------------ | --------------------------------------- |
| 1–10 (build in each)           | 290 232 250 373 247 257 253 266 265 235 |
| 11–20 (shared reader)          | 711 277 220 226 200 213 311 224 243 203 |
| Main's PowerShell read, 5 runs | 756 852 802 754 870                     |

## Still open

- Hosted Windows CI on this branch is the proof for the fresh-VM case; the
  reader's first build there (the inbox compiler plus one read) has not
  been measured on a runner yet.
- The packed product has not been run with this change.
- `src/core/reporting/history.ts` still reads a process's start through
  Windows PowerShell (`[Diagnostics.Process]::GetProcessById`), with the
  same cold-start exposure; it is outside this fix.
- A reader built from an earlier source stays in the folder (4.6 KB per
  source change); nothing removes old builds. (Fixed in the review below.)
- Machines whose policy blocks programs in `%LOCALAPPDATA%` (AppLocker or
  WDAC default rules) read no birth, so an owner there is never provably
  gone and a lock waits out its lease; the job helpers in the extension's
  storage have the same exposure.

## Review (RVWINBIRTH, macOS rig, 2026-10-17)

Reviewed against the code and fixed on this branch; the Windows-only
paths could not run on this rig (its sandbox also refuses `/bin/ps`,
so the macOS birth tests cannot read a birth here), and no hosted
Windows run has measured the fixes yet.

- A relative `SystemRoot` or `LOCALAPPDATA` put the compiler lookup or
  the reader itself under this process's working folder; only absolute
  folders are used now (`fe1b43e50`).
- Two reads waiting on one failed build could each forget the kept
  build, the second forgetting a newer one; a failed build is now
  forgotten only while it is still the kept one. Only a missing or
  damaged reader (`ENOENT`, `ENOEXEC`) is deleted for a rebuild, so a
  machine whose policy refuses the reader no longer recompiles it on
  every read (`5f4693e38`).
- A build now removes the readers built from earlier sources, as the
  job helpers' builds are removed (`f53d018c5`).
- Security of the folder, as reviewed: `%LOCALAPPDATA%` is writable by
  default only by the person, SYSTEM and Administrators, and the
  reader trusts a file that is merely present at its digest-named
  path — the same trust the job helpers in the extension's storage
  get. Replacing it takes code already running as the person; what
  that gains against Muse Code's sandboxed commands depends on
  whether the CLI's Windows sandbox lets them write this folder,
  which is not measured here. The reader and its build run with only
  `SystemRoot` in their environment, no shell, one validated process
  id as the only argument, and digits-only output.

## Codex threads on PR #220 (plan, 2026-10-18)

- CHANGELOG.md:21 (P1, no claim before the packed-product proof): the entry
  keeps only what is proven (the hosted CI failure's cause and that Windows
  PowerShell is replaced by a native reader), drops the timings (they stay
  in this record) and says the packed product has not been run with it.
- processOwner.ts:288 (P1, validate the cached reader): never run a reader
  this process did not build. Each process compiles its own reader under a
  name with its process id and a random part, hashes the built bytes in
  memory right after the compile and again before every run (the job
  helpers' SPAWN017C seal); changed or missing bytes refuse the run, remove
  the file and rebuild on the next read. The shared digest-named file and
  its reuse go, so a file planted at a predictable name is never run; a
  build removes readers whose process is gone. D105's trusted-path check is
  not added per read: it starts Windows PowerShell, the measured cause of
  this fix; that reason and the remaining race in a folder others can write
  are recorded.
- processOwner.ts:89 (P2, signalled state, not exit code 259): open the
  process with `SYNCHRONIZE` as well and count it running only while
  `WaitForSingleObject(handle, 0)` times out. A new Windows test exits a
  real child with code 259 while its parent still holds the handle and
  expects no birth; the old exit-code check is its red drill.
