# M107 lane 0 — platform facts (no model calls)

Measured on the Mac mini on 2026-10-05 local time (2026-10-06 UTC):
macOS 15.7.4, build 24G517, Darwin 24.6.0 x86_64, Node v24.21.0,
32 GiB physical RAM. No credential, account, user process tree or environment
is read. All child probes are owned, finite processes; paths below are
commands/SDK references, never resource journal payloads.

## Memory

Three sequential captures used Node's `os.totalmem()`, `os.freemem()` and
`process.availableMemory()`, immediately beside `/usr/bin/vm_stat` and
`/usr/sbin/sysctl -n kern.memorystatus_level`. Reads are adjacent, not atomic.
Mach's page size was 4,096 bytes; `totalmem()` was 34,359,738,368 bytes.

| Capture | `freemem()` bytes | `availableMemory()` bytes | Free pages | Inactive pages | Speculative pages | (Free + inactive + speculative) bytes | `memorystatus_level` |
| ------- | ----------------: | ------------------------: | ---------: | -------------: | ----------------: | ------------------------------------: | -------------------: |
| 1       |        91,488,256 |            12,774,350,848 |     19,831 |      3,096,114 |             2,809 |                        12,774,416,384 |                   74 |
| 2       |        91,942,912 |            12,774,899,712 |     19,698 |      3,096,148 |             2,824 |                        12,774,072,320 |                   74 |
| 3       |        91,942,912 |            12,774,899,712 |     19,302 |      3,096,132 |             2,824 |                        12,772,384,768 |                   74 |

On this host `freemem()` does **not** include the large inactive-page pool:
its scale matches free plus speculative pages. `availableMemory()` closely
matches free + inactive + speculative pages. This is observational evidence
on the installed Node/platform, not proof of all Node versions or a promise
that all inactive pages can be reclaimed instantly. A free-pages-only floor
would falsely report critical pressure while this sample has ~11.9 GiB
available. `memorystatus_level` is 74 while available/total is ~37%; it must
not be substituted as that byte fraction without separately qualifying its
meaning. The sampler lane should use the measured available-memory value
for headroom and qualify D87's conditional sysctl fallback; if no reliable
reading exists, report unknown. No 0.5%-core sampler-cost claim is made by
these three observations.

## macOS taskpolicy reversibility

The absolute executable is `/usr/sbin/taskpolicy` (not `/usr/bin/taskpolicy`).
The installed `taskpolicy(8)` manual documents `-b` as background policy and
`-B` as removing it. The SDK header
`/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/mach/task_policy.h`
defines `PROC_FLAG_EXT_DARWINBG` as externally enforced Darwin background.

Create our own `/bin/sleep 30` child, read only its `PROC_PIDTBSDINFO` via
`proc_pidinfo`, apply `taskpolicy -b -p <owned-pid>`, read back, apply
`taskpolicy -B -p <owned-pid>`, read back, then clean up our child in finally:

| Step                | `PROC_FLAG_DARWINBG` | `PROC_FLAG_EXT_DARWINBG` | Full BSD flags |
| ------------------- | -------------------: | -----------------------: | -------------- |
| Before              |                    0 |                        0 | `0x404010`     |
| After `-b` (exit 0) |                    0 |                        1 | `0x414010`     |
| After `-B` (exit 0) |                    0 |                        0 | `0x404010`     |

Thus `-B` restores the externally imposed background flag to the original
state for our unprivileged owned child on this host. It does not establish
that arbitrary pre-existing priority/QoS choices may be reset: lane A must
retain original policy and lane T must re-prove membership/start identity
before every change. This probe neither suspends nor hard-caps memory.

The first attempted readback used `getpriority(PRIO_DARWIN_PROCESS, pid)`;
that returned 0 throughout and is discarded as evidence. `getpriority(2)`
documents current-process `who=0` for this query. The BSD-info flag is the
actual before/after readback above. Temporary C source and executable stay
in this worktree's ignored `temp/`, not product code.

## Kubuntu and Win11 — pending, not guessed

This lane runs on the Mac mini. The shared brief forbids network calls
other than installation and changing machine/user settings, and supplies
no local Linux/Windows execution environment. No SSH or remote rig command
is attempted. These required facts remain uncertified and require the
lead's authorized rig probes:

- **Kubuntu cgroup v2:** inspect only the harness-owned user scope's
  `cgroup.controllers`, `cgroup.subtree_control`, effective delegation and
  ownership under the user's slice. In a disposable delegated scope,
  save/read/set/read/restore `cpu.weight`, `io.weight` and `memory.high`;
  never write `memory.max` or the user's existing slice. Record controllers
  unavailable without elevation and the irreversible nice fallback.
- **Win11 job CPU rate:** create an owned finite child in an owned job,
  query/save the existing rate-control info, set enable + hard-cap with
  the proposed 50% (5,000 in Windows' 1/100-percent units), query it back,
  then restore/query the original info. Read back below-normal/idle job
  priority and recovery without requesting elevated rights. Do not change
  M27's production helper or inspect the user's processes for this fact.

No live wire capture is needed for these local contracts or platform facts.
Model attempts: **0**.
