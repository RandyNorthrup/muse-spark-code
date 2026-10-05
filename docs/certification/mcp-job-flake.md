# Windows MCP job helper compile flake (DEFLAKE2)

Recorded on the Windows 11 rig in `C:/lanes/DEFLAKE2`, branch
`fix/mcp-job-helper-flake`, from `2e341e4c`. No live/model calls, network
requests, dependencies, timeout changes or test exclusions were introduced.

## Finding

PR #115 run `37257904865`, Windows shard 4, failed preparing the MCP
launcher in `modelApiMcpServers.test.ts`: the failing command was Windows
PowerShell running `Add-Type` on a UUID-named source in `shell-job`.
`mcpJobExecutable.ts` and M27's `shellJob.ts` both use `jobBuild.ts` for
that compile. Their default runner imposes `PROCESS_TABLE_TIMEOUT_MS`
(20,000 ms), covering PowerShell startup, module discovery and compilation
together. The supplied failure has no exit/signal/killed metadata.

PowerShell is an unnecessary startup dependency: `Add-Type` delegates to
the Windows .NET Framework C# compiler. Loaded-runner PowerShell startup
and module analysis exceeding process deadlines were already observed in
M50 and M51 (PLAN.md's M50 history and `shellJob.ts`'s join statement
record). A runner can therefore fail a valid helper before its compile
finishes. The regression drill below reproduces that preparation failure
by forcing the PowerShell compile-start command to fail.

The precise original CI trigger cannot be recovered from the supplied
error: timeout, launch failure and a compiler/OS error remain distinguishable
only with termination metadata and diagnostic output. This record does not
claim an antivirus lock or timeout was observed in that specific CI run.

The other candidate races were inspected: temporary source/output names
are unique UUIDs; output is published by rename to a source-digest name;
a competing publisher's existing target is accepted; stale-file removal
matches only each helper's stable name prefix and extension. Temporary
names and the other helper's artifacts are not removed by that sweep.
Factories share their own in-flight preparation promise and retain a
successful cached artifact. There is no evidence of a shared temporary
file or stale-file sweep causing the reported `Add-Type` failure.

PR #100 (`7b4abd33`, `ed386050`, merged as `b186d5a2`) fixed permanent
failure caching in the shell helper and improved its assertion diagnostics.
It did not change the shared compile path or the MCP launcher compiler.

## Change

`jobBuild.ts` invokes the OS-owned compiler directly at
`%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe` with an argument
array. This is the x86 .NET Framework compiler available alongside Windows
PowerShell 5.1; it emits AnyCPU helpers. Both the MCP console application
and the shell library take this path. No PowerShell/module discovery is
required for compilation. The shell's actual load/join self-test still
runs in Windows PowerShell; MCP's self-test still runs the executable.

`/noconfig` excludes response-file defaults, `/utf8output` preserves
diagnostics, and all assembly references resolve to absolute files in the
same trusted framework directory. Both helpers explicitly reference
`System.dll` and `System.Core.dll`; MCP also references
`System.Runtime.Serialization.dll` and `System.Xml.dll`. The first real
Windows run exposed the missing `System.Core.dll` reference (CS0234 for
`System.IO.Pipes`); adding that required framework reference corrected it.

The hidden, bounded compiler runner preserves stdout (where csc emits
errors), stderr, exit code, killed flag and signal, with the original error
as its cause. A real invalid C# source fails closed, produces useful
diagnostics and leaves no partial output. Source-digest caching, temporary
file cleanup, atomic publication, self-tests and the existing 20-second
deadline remain. There is no internal blind retry or precompiled binary.

## Test-fire proof

All runs were direct on Win11, with at most three complete files per run:
`npx.cmd vitest run <files> --maxWorkers=3 --testTimeout=120000`.
Existing explicit suite/test deadlines were preserved.

- Before the implementation, the new complete `jobBuild.test.ts` failed
  all three tests: both helper preparations failed with the forced
  PowerShell compile-start error; the real malformed-source case lacked
  the expected native compiler diagnostic/termination detail.
- After implementation, the three helper suites (`jobBuild.test.ts`,
  `shellJob.test.ts`, `mcpJobExecutable.test.ts`) passed **15/15**.
- Deliberately reinstated the `Add-Type` compile path in `jobBuild.ts`:
  the complete new suite exited 1, **3 failed**. Restored the exact bytes.
- Deliberately reverted compiler failure reporting to `error.message`,
  discarding stdout and termination metadata: the complete new suite
  exited 1, **1 failed / 2 passed**. Restored the exact bytes.
- Original and restored SHA-256 after both controls:
  `3EC63261D43590C2C52CDD4DF9094281B09F749AC8908EB6868A7128A51D2D23`.
- Restored final helper-suite run passed **15/15**, exit 0, 4.86 s.
- The original failing suite and both real shell/job suites
  (`modelApiMcpServers.test.ts`, `processTree.test.ts`, `toolIo.test.ts`)
  passed **65 tests / 2 existing platform skips / 67 discovered**, exit 0,
  33.59 s. This proves real compilation, MCP server initialization, shell
  load/join and termination of the job's descendants with direct csc.

Ignored local receipts and the restoration copy are under
`temp/deflake2/`: `startup-red.log`, `diagnostics-red.log`,
`restored-green.log`, `jobBuild.original.ts`.

## Scoped gates and build

All required checks ran directly in the worktree on Win11, one heavy
command at a time:

| Check                                                | Result                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                              | Exit 0, all five projects: host, webview, unit, e2e, integration.                                           |
| `npx.cmd eslint --max-warnings=0 <changed TS files>` | Exit 0, zero warnings. The initial run required moving the test runner stub to outer scope; no suppression. |
| `npx.cmd prettier --check <changed files>`           | Exit 0 after formatting.                                                                                    |
| `npm.cmd run deadcode`                               | Exit 0; existing `vendor/**` configuration hint only.                                                       |
| `npx.cmd jscpd`                                      | Exit 0, 834 files, zero clones.                                                                             |
| `npm.cmd run check:l10n`                             | Exit 0, 14 tables, 120 manifest strings, 421 source files, zero problems.                                   |
| `npm.cmd run check:host-api -- --write`              | Exit 0, 271 VS Code APIs, 18 VS Code import files, 23 Node built-ins, 59 theme variables, zero problems.    |
| `npm.cmd run build`                                  | Exit 0; all unchanged size caps, bundle splits, host-global and notices checks passed.                      |

The first host API comparison correctly required regenerating the record:
only `node:child_process`'s importing-file count changes, **9 → 10**,
because the dedicated compiler runner uses `execFile` in `jobBuild.ts`.
No VS Code API changed.

Production sizes: extension **553.1 KiB / 600 KiB**, Model API **426.3 KiB /
475 KiB**, checkpoint store **109.1 KiB / 225 KiB**. The other bundles also
fit every unchanged cap; the notices check found 83 bundled packages.
Static/build logs are retained alongside the drill receipts in
`temp/deflake2/`.

## Lane boundary

The rig brief prohibits push, merge and rebase. `common.md` prohibits the
full quality/full-test run in this shared lane; aggregate coverage,
accessibility and hosted CI remain the lead's certification. No gate,
threshold or rule was weakened. There is no new command, setting or script
requiring a README update. The changelog records CI reliability. No new
escape hatch needs a PLAN.md section 8 row.
