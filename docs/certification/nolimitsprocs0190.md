# NOLIMITSPROCS: no deadline of ours on process queries and their stops (D121)

Lane `lim/procs`, base `87753d1877`, Windows 11 Pro 10.0.26200 (this rig),
2026-10-21. Hosted CI failed `test/unit/windowsScreenRecorderNative.test.ts`
with `Command failed: ...powershell.exe ...
[Security.Principal.WindowsIdentity]::GetCurrent().User.Value` (`killed: true`,
`SIGTERM`): `runProgram`'s default deadline, `PROCESS_TABLE_TIMEOUT_MS`
(20,000 ms), killed Windows PowerShell's first start on a slow runner. The
owner's rule (D121, D208, 2026-10-16: "no limit in the codebase that is not
about a model") leaves only a provider's documented limit, a value the person
set, a deadline the caller passes, or the person's own cancel to stop work.

## What was removed

| Site                                            | Old bound of ours                                                                       | Now                                                                                                                                                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/host/processTree.ts` `runProgram`          | default `timeoutMs = 20_000`                                                            | no default: `execFile` gets a `timeout` only when the caller passes one                                                                                                                                         |
| `src/host/processTree.ts` `runTreeSync`         | supervisor spec `timeout` and `spawnSync` `timeout` defaulted to 20 s (+ 2 × exit wait) | both only from the caller's positive `timeout`; the supervisor arms its timer only when `spec.timeout` is a finite positive number (`setTimeout(fn, undefined)` fires at once), and `spawnSync` gets no timeout |
| `src/core/bootstrapCommand.ts`                  | `AbortSignal.timeout(options.timeoutMs ?? 20_000)`                                      | `callerStop(options.signal, options.timeoutMs)`: only the signals that exist, else none                                                                                                                         |
| `src/core/resources/commands.ts`                | `AbortSignal.timeout(options.timeout ?? 20_000)`                                        | `callerStop(options.signal, options.timeout)`; `timeout: 0` means none, as with `execFile`                                                                                                                      |
| `src/core/resources/process.ts`                 | bootstrap `taskkill` `timeout: 20_000`                                                  | none: the stop the caller asked for runs to taskkill's end                                                                                                                                                      |
| `src/core/resources/trees/run.ts`               | `runTreeProgram = boundedTreeProgram(20_000)`                                           | `boundedTreeProgram()` takes an optional time bound; the OS probes run until they exit (`macRss.ts` keeps passing its own `MEDIA_RSS_SAMPLE_RUN_TIMEOUT_MS`, a separate limit)                                  |
| `src/core/media/record/windows.ts`              | helper killed 20 s after Stop/Cancel                                                    | waits for the helper's own exit; a dead helper channel is killed at once (nothing could answer it); the person's Cancel or the window closing while a stop is pending kills at once                             |
| `src/host/vault/vaultExecSpawn.ts`              | termination raced against 20 s rejecting with `vault.noAccess`; cleanup `Math.min`      | termination itself is awaited; the cleanup run takes the runner's own `timeoutMs`                                                                                                                               |
| `test/unit/windowsScreenRecorderNative.test.ts` | `timeout: PROCESS_TABLE_TIMEOUT_MS` on two `execFileGuarded` calls                      | no timeout                                                                                                                                                                                                      |

`PROCESS_TABLE_TIMEOUT_MS` is deleted. No user-facing sentence named the
20-second bound (English and the 14 tables checked); PLAN.md §8's two
SPAWN017B rows and the SPAWN017B follow-up line now say the bootstrap tier
stops only on the caller's cancel or deadline.

## What stays, and why

- `POSIX_TREE_EXIT_WAIT_MS` / the supervisor's `cleanupMs` and
  `TREE_EXIT_WAIT_MS`: the grace between SIGTERM/SIGSTOP and SIGKILL while a
  kill the caller already asked for runs. Out of this lane's scope. Note for
  the lead: the supervisor's periodic `/bin/ps` reads also use `cleanupMs`
  as their `execFileSync` timeout, so a `ps` slower than 2 s ends the effect
  even with no caller deadline.
- `ORPHAN_SWEEP_ROUNDS`, `SCREEN_RECORDING_REMOVE_ATTEMPTS`,
  `RESOURCE_HANDOFF_TIMEOUT_MS` (detaches an opener, never kills it), and the
  deadlines callers pass explicitly (`GIT_TIMEOUT_MS` from the playbook's
  `runTreeSync` callers, `VAULT_BROKER_NATIVE_TIMEOUT_MS`,
  `SCHEDULE_POLL_INTERVAL_MS`, `REPORT_SOURCE_TIMEOUT_MS` to
  `execResourceFile`): different classes, listed for the lead.

## Drills

- **runProgram (this rig, Windows).** With the change, temporarily
  `timeoutMs = 1` as runProgram's default:
  `npx vitest run test/unit/windowsScreenRecorderNative.test.ts` exits 1
  (`Error: Command failed: C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -Command [Security.Principal.WindowsIdentity]::GetCurrent().User.Value`,
  `killed: true, signal: 'SIGTERM'`, all 40 skipped after the failed
  `beforeAll`). Restored: exits 0, 40 passed.
- **runTreeSync supervisor (new `test/unit/treeSyncNoDeadline.test.ts`,
  POSIX only).** Vitest's native binaries here are Windows-only, so the
  test's two cases were bundled with esbuild (`temp/treeSyncDrill.ts`,
  importing the real `runTreeSync`, `workspaceChildEnvironment`,
  `withoutCredentials`) and run under WSL Arch's node v26.9.0: exit 0 (`PASS
no caller timeout runs to its end {"status":0,"stdout":"done\n"}`, `PASS
caller's timeout still ends it {"status":1,"stderr":"ETIMEDOUT"}`). With
  the supervisor's guard removed in the bundle (timer armed unconditionally,
  as before): exit 1, `FAIL no caller timeout runs to its end
{"status":1,"stdout":"","stderr":"ETIMEDOUT"}`. Hosted CI's Linux and
  macOS jobs run the test itself.
