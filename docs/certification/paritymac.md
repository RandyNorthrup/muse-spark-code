# Lane PARITYMAC certification — fast judge, OpenCode plugins, headroom on macOS

Rig: MacBookPro15,1 (Intel i9-8950HK, x86_64), Darwin 24.6.0, Node v24.21.0,
libuv 1.52.1. Worktree `/Users/user/lanes/PARITYMAC`, branch `fix/macos-parity`.
Probe: `temp/now-probe.ts` bundled with esbuild and run on this machine.

## First result — now (measured 2026-10-17 on this Mac), after

- Fast judge (`InspectRunner.run('cat x', …)` on darwin): now `{"kind":"refused",
"reason":"platform"}` (`inspectExec.ts:328`). After: runs on macOS under a
  Seatbelt profile via `/usr/bin/sandbox-exec`; Windows stays refused
  (`platform`: no Landlock/seccomp and no Seatbelt equivalent wired).
- OpenCode plugins (`resolvePluginRuntime('opencode', {platform:'darwin'})`):
  now `{ok:false, reason:"opencode: bun's memory cannot be bounded on darwin"}`
  (`pluginHost.ts:295-296`). After: runs `bun -e` directly, like OpenCode
  itself does — no kernel memory cap on macOS; timeout, frame and tree bounds
  still hold.
- Probes (`createOptionalResourceProbes` on darwin): now `gpu: null`,
  `disk: null`. After: real readings — GPU `%` from `ioreg IOAccelerator
PerformanceStatistics "Device Utilization %"`, disk busy `%` from the
  `IOBlockStorageDriver` `Total Time` delta. Headroom already reads:
  `availableMemory: 16800477184` (libuv 1.52.1 clears the D87 gate, ≥ 52).

## Rig notes (environment, not product)

- The rig's `xcode-select` points at a missing `/Applications/Xcode.app`, so
  the `/usr/bin/{git,cc}` shims fail. All git and C work here uses the direct
  CommandLineTools paths (`/Library/Developer/CommandLineTools/usr/bin` first
  on PATH, `DEVELOPER_DIR` override for builds). Nothing in the repo was
  changed for this; healthy machines and CI are unaffected.
- This shell runs inside an agent sandbox: `sandbox-exec` fails with
  `sandbox_apply: Operation not permitted`, `ps` and `setrlimit(RLIMIT_AS)`
  are denied. Live Seatbelt confinement drills (item 1) cannot execute in this
  shell; they are committed gated on sandbox-exec availability (visible skip
  here) and must run green outside the sandbox / on hosted macOS CI.
  Everything else below ran for real on this Mac.

## Item 3 — macOS GPU and disk probes (DONE on this Mac)

- GPU: `ioreg -r -c IOAccelerator -d 1`, max of every
  `"Device Utilization %"` (Intel, AMD and Apple-silicon parts publish it;
  verified Intel + AMD here, Apple-silicon per the same IOKit key the
  platform's own monitors read). Live on this Mac: `gpu: 0` (idle).
- Disk: `ioreg -r -c IOBlockStorageDriver -d 1`, busiest driver's
  `Total Time (Read) + Total Time (Write)` (ns) differenced over wall time,
  capped at 100 — the duty-cycle counter Darwin iostat lacks. Two real
  snapshots ~5 s apart: 65.7 % busy on this rig (pinned in test).
- Headroom: no code change — `process.availableMemory()` already flows on
  this Mac (libuv 1.52.1 ≥ D87 gate 52): live `availableMemory 16718110720`
  vs `freemem 4459528192`. Sampler test pins the contract (new runtime →
  number, stale runtime → unknown).
- Tests: `test/unit/resourceProbesDarwin.test.ts` 7/7 (recorded-exchange
  fixtures under `test/fixtures/resources/`, plus live darwin readings);
  `test/unit/resourcesContracts.test.ts` 16/16. Fixture captures:
  `ioreg -r -c IOAccelerator -d 1` and `ioreg -r -c IOBlockStorageDriver -d 1`
  (twice), MacBookPro15,1, 2026-10-17.

## Item 2 — OpenCode plugins on macOS (DONE on this Mac)

- `boundedBun` no longer refuses darwin: `resolvePluginRuntime('opencode',
{platform:'darwin'})` now returns `{ok:true, command: <bun>, args:['-e']}`
  (was `bun's memory cannot be bounded on darwin`). macOS offers a spawner
  no per-process memory cap (no job objects, no prlimit), and OpenCode
  itself runs bun plugins unbounded — so we match OpenCode instead of
  refusing. Timeout, answer-frame, process-tree and fail-closed bounds hold
  unchanged.
- Measured on this Mac through the real dispatch path (node standing in for
  the absent bun, as the existing portable fixture does):
  an args-rewriting guard runs and narrows the call; a 1,300 MB allocation —
  past the 1 GiB Linux prlimit bound — completes with the call applied
  (documents the platform difference: no kernel cap on macOS).
  No installed bun exists on this rig or CI, so the real-bun drill stays
  Linux-gated as before.
- Tests: `test/unit/pluginDispatch.test.ts` 29 passed, 2 skipped (the 2 are
  the installed-bun drills: Linux-only, no bun here).
- `ulimit -v`/`setrlimit(RLIMIT_AS)` as a bound was investigated and
  rejected: this shell's sandbox denies the call, so no enforcement reading
  could be taken here, and a shell wrapper would be an unverified bound —
  worse than stating plainly that macOS applies none.

## Item 1 — fast judge on macOS (IMPLEMENTED; live drills need an unsandboxed Mac)

- `native/confine/MuseSparkConfineMac.c` (new): same argv protocol as the
  Linux helper, Seatbelt enforcement. Walk with no-follow opens under the
  same generated `policy.h`; literal-path profile (`file-read*` on walked
  files/dirs, root and program only; `deny default` covers writes, network,
  fork and exec); metadata line `{"confined":true,"abi":1,…}`; then
  `execve /usr/bin/sandbox-exec`. Probe mode proves the profile (late insert
  denied, outside read denied, allowed read works, create/fork/connect
  denied) and prints `{"abi":1,"confined":true}`.
- `inspectExec.ts`: darwin allowed (Windows stays `platform`-refused: no
  Landlock/seccomp, no Seatbelt wired); per-platform probe/run schemas keyed
  on `JUDGE_FAST_B1_DARWIN_ABI = 1` (below the Landlock range, single source
  of truth via `policy.h`). `scripts/build-confine.mjs` builds the Mac
  helper on darwin.
- Proven ON THIS MAC (real binary, `temp/confine/muse-confine`, same flags
  as the repo build): identity/program/privateOperand/operand refusals all
  exit 125 with empty stdout (matrix in `temp/spell-check.mjs` output below);
  3,618 seeded canonical spellings match the Linux policy exactly; the
  generated profile is the expected three-rule set; the metadata line parses;
  `probe` fails closed with `{"refused":"selfTest"}` where the sandbox
  denies `sandbox_apply`.
- NOT proven here: the confined run itself. This shell's sandbox denies
  `sandbox_apply` (`Operation not permitted`), and the rig's `xcode-select`
  points at a missing Xcode.app so the repo build's `/usr/bin/cc` shim fails
  here (built manually with the direct CLT cc + MacOSX.sdk instead). The
  committed Darwin tests (`test/unit/inspectNative.test.ts`: 5
  pre-confinement + 5 live drills) skip visibly here and MUST run green
  outside the sandbox / on hosted macOS CI before this merges.
- Assumptions the outside run confirms (all fail closed if wrong): fork
  denial surfaces as EPERM/EACCES; refused connect as EPERM/EACCES; dyld
  shared-cache mapping needs no profile rule; libSystem init and the nine
  BSD tools need nothing beyond the file rules under `deny default`.
- Documented macOS residual (code comment + here): path-based profiles
  cannot grant inodes, so an inode swap beneath an allowed path between the
  walk and the exec is invisible. The window is one synchronous process with
  no awaits; anything else swapped in only denies. Linux Landlock has no
  such window; Windows has no confinement at all.

Manual readings (this Mac, 2026-10-17):

```text
spellings match: true (3618 spellings)
identity: exit=125 want=workspaceIdentity OK
program: exit=125 want=program OK
protected: exit=125 want=privateOperand OK
symlink: exit=125 want=operand OK
hardlink: exit=125 want=operand OK
profile.sb:
(version 1)
(deny default)
(allow file-read* (literal "<workspace>"))
(allow file-read* (literal "/bin/cat"))
(allow file-read* (literal "<workspace>/allowed.txt"))
probe: {"refused":"selfTest"} exit=125 (sandbox_apply denied in this shell)
live run: {"confined":true,"abi":1,"excluded":0} then sandbox-exec EPERM
```

## Gates

## Drills
