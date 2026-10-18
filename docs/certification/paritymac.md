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

- Review fix (2026-10-17, before any live run): `resolve_operand` refused
  the grammar's default operand `"."` as non-canonical. Fixed (root itself),
  verified: `find .` now walks (`excluded:0`) instead of refusing. The
  committed live drills cover `find . -print` and would have caught this
  outside.
- Dedup refactor (0%-clone gate): the busiest-device tail shared as
  `src/core/resources/sampler/diskDelta.ts` (`finishDiskDelta`, used by both
  Linux and macOS deltas; direct tests in
  `test/unit/resourceDiskDelta.test.ts`); the B1 fixture/spelling/runner
  shared as `test/unit/helpers/inspectCase.ts` (Linux block converted
  verbatim — behavior identical by diff); the Darwin plugin test rewritten
  to a `--mac` command tag. Linux delta wiring re-checked live in scratch
  (baseline null, then 10 %). `npx jscpd`: 0 clones.

## Gates (final tree, this Mac, 2026-10-17)

- prettier: changed files formatted, `format:check` equivalent clean.
- eslint zero warnings on all lane files (src, scripts, tests, helpers).
- typecheck: all five projects green (`npm run typecheck` exit 0).
- `check:plan`: 0 drift. `check:l10n`: 0 problems (no new UI strings).
- `npm run build`: exit 0, budgets hold.
- `npm run deadcode` (knip): exit 0. `cycles`: none. `duplication`: 0 clones.
- Suites (repo default timeout, `--maxWorkers=3`):
  `resourceProbesDarwin` 7/7, `resourceDiskDelta` 2/2, `resourcesContracts`
  16/16, `pluginDispatch` 29 passed + 2 skipped (installed-bun drills need
  Linux + bun), `inspectNative` 10 skipped here (see item 1),
  `inspectGrammar` 62/62.

## Item 1b — PARITYMAC2: lead's unsandboxed rerun (macmini, 5 passed / 5 failed) — causes

One line per failure (read 2026-10-18 from the helper's exit codes and
refusal kinds; nothing below loosens what must be refused):

- `refuses protected and noncanonical operands` (`home` where
  `privateOperand` was wanted): the test reuses one fixture — one `home`
  dir — for four raw helper runs. The Mac helper consumes `home` on the
  first run (`check_home` demands it empty, `open_profile` creates
  `profile.sb` in it with `O_EXCL`), so runs 2–4 refuse `home` before the
  operand check. The Linux helper never writes into `home`, so reuse works
  there. The product contract is fresh-home-per-run (`InspectRunner`
  mints `b1-home-*` per run): the shared-home loop is the test
  assumption that does not hold on a Mac. Fix in the test (fresh fixture
  per operand), not the helper.
- `captures ABI 1 …` (exit 125): `probe_child` accepts only `EACCES` as a
  Seatbelt denial, but Seatbelt denials surface as `EPERM` (`Operation not
permitted`). The `late`/`denied` post-walk reads are correctly denied,
  yet `errno != EACCES` fires `refuse("postWalkRead")`. Fix in the helper:
  accept `EPERM` alongside `EACCES` there (write/fork/connect already do).
- `runs verified cat, ls, grep and find` (exit 71 with the protocol line
  already on stderr): the profile is `(deny default)` plus `file-read*`
  literals only. Under deny-default `sandbox-exec` cannot exec the
  verified target without `(allow process-exec …)`, and dyld cannot map
  it without system `file-read*` rules — so `sandbox-exec` fails with
  `EX_OSERR` 71 after the helper's line is printed. The record's
  assumption above ("the nine BSD tools need nothing beyond the file
  rules") was wrong. Fix in the helper: emit `(allow process-exec
(literal target))` plus `(allow file-read* (subpath "/bin") (subpath
"/sbin") (subpath "/usr") (subpath "/System"))` in both the run and the
  probe profiles. Deny-default still covers writes, network, fork and
  everything the walk did not see.
- `withholds protected contents …` (`refused` where `output` was wanted)
  and `runs session self-tests …` (`{refused, selfTest}` on the first
  run): both go through `InspectRunner`, whose one-time `selfTest()` runs
  `probe`; with the probe broken (previous two causes) the runner latches
  off and every later run refuses. No separate cause; fixed by the two
  helper fixes above.

Checked and not a cause: nothing in the helper compares against `$HOME`
or assumes the worktree outside the home folder (the `home` dir is
caller-provided and identity-bound), and `/bin`, `/usr/bin` realpaths
stay under their `/bin/` `/usr/` prefixes, so `system_file` holds.

What the lead's unsandboxed rerun must show after the fix (`npm ci
--ignore-scripts`, `npm run build:confine`, `npx vitest run
test/unit/inspectNative.test.ts`): 10/10 green — probe exits 0 with
exactly `{"abi":1,"confined":true}` on stdout; cat/ls/grep/find each exit
0 with stderr starting `{"confined":true,` and `cat` printing
`ALLOWED_CANARY`; find lists `.git/config` without its contents and grep
reports `excluded > 0`; the swapped leaf still fails nonzero with empty
stdout; the first session run outputs and the rewritten secret run
refuses with `secret`. The generated `profile.sb` is now the six-rule set
(version, deny-default, system file-reads, root literal, process-exec +
file-read literals for the verified target, walked literals).

Proven in this sandbox 2026-10-18 (commit `015b46a74`; the live
Seatbelt step itself still needs the lead's unsandboxed Mac, as before):

- The fixed helper compiles clean under the repo's exact flags
  (`-std=c11 -O2 -Wall -Wextra -Werror -Wconversion -Wshadow`): the repo
  script's `/usr/bin/cc` exec fails on this rig (broken `xcode-select`
  plus the sandbox denying the toolchain exec), so `policy.h` came from
  `node scripts/build-confine.mjs` and the link from the direct CLT cc
  against the MacOSX SDK — same flags, same `temp/confine/muse-confine`
  output. `npm run build:confine` itself was NOT green here for that
  environmental reason; it must run on the lead's machine.
- Pre-confinement refusals measured on the fresh binary, one fixture per
  run: identity `workspaceIdentity`, unknown program `program`, `.env` /
  `x/../allowed.txt` / `C:outside` each `privateOperand`, symlink and
  hardlink each `operand` — all exit 125 with empty stdout.
- Home-reuse diagnosis reproduced: a second raw run against the same home
  refuses `home` (the first run's `profile.sb` fails the empty-home
  check), fail-closed, which is why the three multi-run tests now take a
  fresh fixture per operand/name/program.
- Generated `profile.sb` for `cat allowed.txt` (run fails here at
  `sandbox_apply`, as before — this shell cannot apply any profile):

```text
(version 1)
(deny default)
(allow file-read* (literal "<workspace>"))
(allow file-read* (subpath "/bin") (subpath "/sbin") (subpath "/usr") (subpath "/System"))
(allow process-exec (literal "/bin/cat"))
(allow file-read* (literal "/bin/cat"))
(allow file-read* (literal "<workspace>/allowed.txt"))
```

- `probe` here still fails closed with `{"refused":"selfTest"}` exit 125
  (`sandbox_apply: Operation not permitted`), unchanged.
- Gates on the final tree: prettier clean, eslint zero warnings on the
  changed test, all five typechecks green, `check:plan` 0 drift,
  `check:l10n` 0 problems, `npm run build` green with budgets holding,
  `test/unit/inspectNative.test.ts` 10 skipped / 0 failed here (the repo
  build path cannot produce the binary inside this sandbox).

## Item 1c — PARITYMAC3: the confined program starts (rules to add)

Cause (lead's macmini rerun, 6 passed / 4 failed): every live drill fails
because the exec'd program never reaches `main` — macOS's own crash reports
(`muse-confine-*.ips`) show the child dying in dyld, EXC_CRASH / SIGABRT,
all crashing frames inside dyld. The PARITYMAC2 profile is `(deny default)`
plus `file-read*` literals/subpaths and one `process-exec` literal: it
denies exactly what the loader needs to start any program. Verified on this
Mac (15.7.9): `/bin/cat` links `/usr/lib/libSystem.B.dylib`, dyld lives at
`/usr/lib/dyld`, `/private/var/db/dyld` does not exist (the shared cache
ships in the cryptexes), `/System/Cryptexes/{App,OS}` exist.

Rules to add (all read/map/metadata-only — no `file-write*`, no `network*`,
no `process-fork`, no new `process-exec`, workspace stays literal-only, the
walk's protected-path exclusions unchanged), each cited to Apple's own
`/System/Library/Sandbox/Profiles`:

- `file-map-executable` on `(subpath "/System/Library/Frameworks")`,
  `(subpath "/System/Library/PrivateFrameworks")`, `(subpath "/usr/lib")`:
  dyld maps libSystem and the frameworks with MAP_EXEC; `file-read*` alone
  does not grant it. Citation: `system.sb:43-52` (map system frameworks +
  dylibs, a subset of the read paths).
- `file-read* file-test-existence file-map-executable` on the five cryptex
  graft-point subpaths (`/System/Cryptexes/App`, `/System/Cryptexes/OS`,
  `/System/Volumes/Preboot/Cryptexes/App/System`,
  `/System/Volumes/Preboot/Cryptexes/Incoming/OS`,
  `/System/Volumes/Preboot/Cryptexes/OS`): the dyld shared cache lives
  there on macOS 13+. Written with plain `subpath` lines (no `let`/`apply`:
  the generated profile stays `(version 1)`); the graft points' ancestors
  are already covered by the `/` literal and the `/System` read subpath.
  Citation: `dyld-support.sb` cryptex block.
- The `dyld-support.sb` bootstrap syscalls verbatim: `syscall-unix`
  `SYS___mac_syscall`, `SYS_getfsstat`, `SYS_getfsstat64`,
  `SYS_map_with_linking_np`, `SYS_open`, `SYS_openat`, `SYS_fstatat`,
  `SYS_fstatat64`, `SYS_dup`; `system-fcntl` `F_ADDFILESIGS_RETURN`,
  `F_CHECK_LV`, `F_GETPATH`; `system-mac-syscall` 2 under the Sandbox
  filter. `deny default` denies these; every Apple profile gets them via
  `system.sb:12`'s `(import "dyld-support.sb")`. Inlined because the
  generated profile cannot import.
- `file-read* file-test-existence` on `(literal "/")`: libignition opens
  `/` as its `openat` root. Citation: `dyld-support.sb`.
- `file-read* file-test-existence` on `(literal "/dev/null")`,
  `(literal "/dev/zero")`, `(literal "/dev/random")`,
  `(literal "/dev/urandom")`, and `file-read-metadata file-test-existence`
  on `(literal "/etc")`, `(literal "/tmp")`, `(literal "/var")`,
  `(literal "/private/etc/localtime")`: the standard special files and
  symlink-resolution stat rules every Apple process gets. Citation:
  `system.sb:78-104`.
- `file-map-executable` on the verified target literal (and on the probe's
  self literal, same line as its existing `process-exec` + `file-read*`):
  dyld maps the main executable image itself, not just its dylibs —
  same read+map pairing as `system.sb`'s `oopjit-runner`.

What the lead's unsandboxed rerun must show (`npm ci --ignore-scripts`,
`npm run build:confine`, `npx vitest run
test/unit/inspectNative.test.ts`): 10/10 green — probe exits 0 with exactly
`{"abi":1,"confined":true}`; cat/ls/grep/find each exit 0 with stderr
starting `{"confined":true,` and `cat` printing `ALLOWED_CANARY`; find
lists `.git/config` without its contents and grep reports `excluded > 0`;
the swapped leaf still fails nonzero with empty stdout; the first session
run outputs and the rewritten secret run refuses with `secret`. Nothing
that must stay refused widens: writes, network, fork and the protected
paths are still denied by `deny default` plus the unchanged walk.

## Drills

- Item 3 and item 2 drills ran live on this Mac (above).
- Item 1 live Seatbelt drills (5, in `test/unit/inspectNative.test.ts`) did
  NOT run here: this shell's sandbox denies `sandbox_apply`, and the rig's
  broken `xcode-select` denies the repo build's compiler shim. They skip
  visibly and must run green on an unsandboxed Mac / hosted macOS CI before
  the Seatbelt change merges. Everything provable without the sandbox was
  measured above.
