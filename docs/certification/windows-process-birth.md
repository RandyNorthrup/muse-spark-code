# Windows process birth read through PowerShell (WINBIRTH)

Recorded on the Windows 11 rig (Windows 11 Pro 10.0.26200, i9-12900HK,
20 threads, Node 24.20.0) in the worktree `mx-winbirth`, branch
`fix/windows-process-birth`, from `296c63f20c`. No model calls.

## Finding

PR #154's run `39078271738`, job "build / tests (windows-latest, shard 3)"
(`117529837694`), failed `test/unit/fileLease.test.ts` "process owners
(M123 lane P) > reads this process's birth from the system" after
10,076 ms with "expected undefined to be defined" at line 245.

**Measured cause.** On Windows, `processStartTime`
(`src/core/locks/processOwner.ts:108-131`, `windowsStartTime`) starts
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
