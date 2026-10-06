# CIFIX14T — Timed-out monitor process cleanup

Worktree `/Users/randy/lanes/CIFIX14T`, branch `fix/ci-0.14.0-monitor`,
base `6baacdb7`. Direct Mac mini runs: macOS Darwin 24.6.0, x86_64,
Node 24.21.0, 12 logical cores. Hosted CI uses Node 22; its final receipt
remains with the lead. No network, live model or paid call.

## Root cause and native evidence

`runCommand` already awaits `killTree`. The POSIX implementation of
`killTree` previously resolved immediately after `process.kill(-pid,
'SIGKILL')`; delivering a signal does not prove every member has exited.
The leader's exit and closed output pipes can therefore settle `runShell`
while an output-independent descendant still exists.

The original complete monitor file passed **30/30** runs under twelve
`/usr/bin/yes` workers. No assertion, timeout or retry changed. A diagnostic
instrumentation only printed process state when the original liveness
assertion would fail; it did not change the assertion.

A separate native diagnostic bundled the unchanged `createToolIo` and ran
**300** monitor calls at **500 ms**, with the same twelve CPU workers. This
shorter diagnostic increases cleanup samples; it is not the five-second
acceptance test. All 300 announced both PIDs. Four returned with a PID still
accepting signal 0; three were reaped before `ps` captured state. Attempt 123
captured a live descendant after return:

```text
pid    ppid  pgid   stat
60465  1     60423  R
```

That child was orphaned to PID 1, still in its original process group and
reported running. The product race is proved independently of zombie
accounting. Local raw receipts are in ignored `temp/cifix14t/`.

A deterministic regression retains real monitor processes and the real
runner, but delivers SIGKILL to the leader first and to its group 500 ms
later. Without a group wait the child remains live when the result returns.
With a wait, the group is gone before the result is exposed.

The Mac probe also needed the Linux probe's existing exited-process
semantics. During the controlled diagnostic, a PID still accepted signal 0
immediately after group disappearance but had been reaped by `ps` (PIDs
64195 and 64409). A separate native `fork`/exit/wait proof held a dead child
unreaped: signal 0 succeeded while `/bin/ps` printed `65115 65114 65114 Z`.
The test now reads macOS `ps -o stat= -p <pid>` and treats `Z`, `Z+` and
vanished PIDs as exited; live `R` and `S+` remain alive.

## Changes

- Await POSIX process-group exit, polling every 20 ms with a two-second
  bound. If the group persists, send SIGKILL again and log the outcome.
- Linux group checks exclude exited zombies and give the trusted `/bin/ps`
  reader only the remaining deadline and an empty environment. Windows job,
  taskkill and orphan-sweep behavior keep their existing deadlines.
- Preserve the original five-second monitor test and its live-process
  assertion. Add the controlled real-child regression, macOS state controls
  and cross-platform scripted checks for waiting, the bound, re-signalling,
  Linux zombie accounting and failed state reads.

No new setting, command, dependency, localized string or escape hatch. The
shared shell runner is used by extension and ACP/headless hosts in every
editor. Children that deliberately leave the group remain outside the
existing POSIX containment guarantee. An unkillable group is logged after
the bound; successful workspace-shutdown proof is not claimed.

## Final verification

The five complete owned files (`toolIo`, `modelApiShellDirectory`,
`processTree`, `shellBoundedMonitor`, `shellJob`) pass: **113 passed,
6 existing Windows-only skips**, in batches of three and two files. Every
command uses `--maxWorkers=3 --testTimeout=120000`. After the red drills,
`processTree` passes again: 22 passed, 3 existing skips.

The original monitor keeps its **5000 ms** command deadline and existing
**300000 ms** test budget. The added real-process ordering case uses the
same test budget because its command plus delayed signal takes over five
seconds. No existing deadline, timeout, retry or skip was increased.

The initial diagnostic loop exposed a test-only persistent `ps` mock:
its final empty response leaked into the next real live-PID assertion.
Each state control now supplies exactly one mocked response; the real
live-PID assertion continues to use native `ps`. Those intermediate
runs are diagnostic receipts, outside the final acceptance count.

Final loaded proof: **30/30 complete-file runs, 210 passed tests, zero
failures**, under twelve `/usr/bin/yes` workers. Workers stop and are reaped
in the runner's `finally` block. The source stayed byte-identical throughout
that acceptance loop. See [machine-readable receipts](cifix14-monitor-drills.json).

| Deliberate break                                            | Red result                                                                          | Restoration   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------- |
| Remove the awaited product wait; loaded loop                | 3/3 files failed, each 1 failed / 6 passed                                          | exact SHA-256 |
| Remove the awaited product wait; complete process-tree file | 6 failed / 16 passed / 3 existing skips                                             | exact SHA-256 |
| Disable the Mac state branch                                | 3 failed / 4 passed                                                                 | exact SHA-256 |
| Make the Mac probe always report dead                       | 3 failed / 4 passed, including the real live-PID assertion                          | exact SHA-256 |
| Count Linux zombies as running                              | 1 failed / 21 passed / 3 existing skips                                             | exact SHA-256 |
| Remove the exit-wait interval                               | 2 failed / 20 passed / 3 existing skips                                             | exact SHA-256 |
| Ignore the reader's remaining deadline                      | 1 failed / 21 passed / 3 existing skips; reader took 20004 ms instead of under 2000 | exact SHA-256 |

Every new test was seen to fail. The loaded positive loop followed restoration;
the final live-probe drill was restored afterward and its complete file rerun.

| Static/build check                                | Result                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run typecheck`                               | All five projects, exit 0                                                                  |
| `npm run typecheck:unit` after final test cleanup | exit 0                                                                                     |
| Scoped `npx --no-install eslint --max-warnings=0` | exit 0                                                                                     |
| Plain `npm run deadcode`                          | exit 0; existing vendor/axe-core configuration hints                                       |
| `npx --no-install jscpd`                          | exit 0, zero clones in 1159 files                                                          |
| `npm run check:l10n`                              | 14 tables, 164 manifest strings, 590 source files; zero problems                           |
| `npm run check:host-api`                          | 332 VS Code APIs, 31 importing files, 25 Node built-ins, 61 theme variables; zero problems |
| `npm run build`                                   | exit 0; all size, split, host-global and 83-package notice checks pass                     |

Production sizes: extension **437.4 / 600 KiB**, Model API **446.6 / 475 KiB**,
checkpoint store **76.9 / 225 KiB**, webview with static imports
**893.2 / 900 KiB**, ACP **817.5 / 850 KiB**. No cap changed.

The initial duplication check caught one copied setup block in the new
process-tree tests. A local test-only factory now shares that setup while
retaining every assertion; the zero-clone threshold stays unchanged.
Scoped Prettier and final `git diff --check` accompany the hook-on commit.

Changed files: `src/host/processTree.ts`, `src/shared/constants.ts`,
`test/unit/processTree.test.ts`, `test/unit/shellBoundedMonitor.test.ts`,
`PLAN.md`, `CHANGELOG.md`, this record and its JSON receipt. No README
command or setting was added. Full coverage, aggregate quality,
accessibility, security audit/SAST and native Linux/Windows/hosted Node 22
receipts remain the lead's integrated checks. Aggregate `npm run quality`
and full coverage are prohibited by the shared lane brief and remain the
lead's integrated gate. Hooks are installed in this worktree; commits use
explicit staged paths and never bypass hooks, push, merge or rebase.
