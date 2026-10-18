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

Proven in this sandbox 2026-10-18 (the live Seatbelt step itself still
needs the lead's unsandboxed Mac, as before):

- `native/confine/MuseSparkConfineMac.c`: new `allow_loader()` (cryptex
  read/map, system `file-map-executable`, `/` + `/dev/*` reads,
  `/etc`-family metadata stats, the `dyld-support.sb` bootstrap syscalls),
  called from both `probe()` and `run()` next to `allow_system()`; and
  `allow_exec()` now also grants `file-map-executable` on the verified
  target literal (dyld maps the main image itself). No other line changed.
- The fixed helper compiles clean under the repo's exact flags (`-std=c11
-O2 -Wall -Wextra -Werror -Wconversion -Wshadow`) via the direct CLT cc
  against the MacOSX SDK. `npm run build:confine` itself still fails here:
  the script shells `/usr/bin/cc` with a scrubbed `PATH=/usr/bin:/bin`
  env that drops `DEVELOPER_DIR`, so the shim resolves the rig's missing
  Xcode.app (`can't exec .../XcodeDefault.xctoolchain/usr/bin/clang`);
  environmental, not a repo cause — the script is unchanged.
- The generated `profile.sb` for `cat allowed.txt` is now the 17-rule set
  (version, deny-default, workspace literal, system reads, loader block,
  process-exec + map + read literals for `/bin/cat`, walked literal).
  `sandbox-exec -f` parses it clean: a deliberately broken control
  profile exits 65 with a parse error (`unbound variable`), while ours
  exits 71 `sandbox_apply: Operation not permitted` — this shell's nested
  sandbox denies applying any profile, so the confined run itself cannot
  execute here.
- Refusal matrix on the fresh binary (fresh fixture per run): identity
  `workspaceIdentity`, unknown program `program`, `.env` /
  `x/../allowed.txt` / `C:outside` each `privateOperand`, symlink and
  hardlink each `operand` — all exit 125 with empty stdout.
- No widening in the generated profile: no `file-write*`, no `network*`,
  no `process-fork`; the single `process-exec` is the verified target
  literal; no `subpath` under the workspace (workspace grants are
  literal-only); every other allow line is `file-read*`,
  `file-test-existence`, `file-map-executable`, `file-read-metadata`,
  `syscall-unix`, `system-fcntl` or `system-mac-syscall`.
- Gates on the final tree: typecheck all five projects exit 0, `lint:js`
  zero warnings, `check:plan` 0 drift, `npm run build` exit 0 with
  budgets holding, `test/unit/inspectNative.test.ts` 10 skipped / 0
  failed here at the repo default timeout (repo build path and
  `sandbox_apply` both unavailable inside this sandbox, by the suite's
  designed skip).

## Item 1d — PARITYMAC4: the probe fails on its own file state (7/10 → 10/10)

Causes (from the code, not from loosening: both fail closed as refusals).
The dyld rules held — cat/ls/grep/find run, no crashes — but `probe`
exits 125, and that one failure latches the session runner off
(`InspectRunner.selfTest` keeps `offReason`), so the find drill and the
session drill refuse with `selfTest` too. Three failures, one root cause
chain, two file-state bugs in `probe()` /
`probe_child()` (`native/confine/MuseSparkConfineMac.c`):

- Denied path never existed: the child opened `<dir>/probe-denied`
  (`probe-tree/probe-denied`), but `probe()` creates `probe-denied` at the
  profile root. The open fails with ENOENT, not a policy denial, so the
  child refuses `postWalkRead`, the parent sees a nonzero exit and refuses
  `selfTest`, and the ABI drill exits 125. Fix: the child takes the denied
  file absolute (`<root>/probe-denied`, built next to the profile/dir
  paths) — an existing file the profile never grants, so the confined
  open is refused EPERM/EACCES as intended.
- Allowed file empty: `probe-tree/allowed` is created but never written,
  so the child's one-byte read gets EOF and refuses `selfTest`. Fix:
  `probe()` seeds one byte (`O_RDWR` + `write`, one line each).

Nothing that must stay refused widens: the profile is byte-identical in
shape (same allow lines; the denied file is granted nowhere), the walk,
the protected-path exclusions and every denial check are untouched.

Diagnostics committed with the tests: every assertion on a helper result
in the three drills now carries the helper's stderr (raw `native` runs)
or the refused reason (`JSON.stringify` of runner results), as the
verified-tools drill already did — the next unsandboxed rerun names each
refusal's reason.

Proven in this sandbox 2026-10-18 (live Seatbelt still needs the lead's
unsandboxed Mac, as before):

- The fixed helper compiles clean under the repo's exact flags
  (`-std=c11 -O2 -Wall -Wextra -Werror -Wconversion -Wshadow`) via the
  direct CLT cc against the MacOSX SDK.
- Refusal matrix on the fixed binary (fresh home per run): identity
  `workspaceIdentity`, unknown program `program`, `.env` /
  `x/../allowed.txt` each `privateOperand`, symlink and hardlink each
  `operand` — all exit 125 with empty stdout.
- `probe` setup now completes: `probe-tree/allowed` is 1 byte,
  `probe-denied` exists at the root, `probe-tree/late` is its hardlink,
  and the profile grants `probe-tree` + `probe-tree/allowed` only. The
  run then fails solely at `sandbox-exec: sandbox_apply: Operation not
permitted` (this shell's nested sandbox), refusing `selfTest` at the
  spawn mismatch. The old path is provably gone: `probe-tree/probe-denied`
  does not exist, so the old join could only ever have raised ENOENT.
- No widening in the probe profile: no `file-write*`, no `network*`, no
  `process-fork`; workspace grants stay literal-only.

What the lead's unsandboxed rerun must show (`npm ci --ignore-scripts`,
`npm run build:confine`, `npx vitest run
test/unit/inspectNative.test.ts`): 10/10 green — probe exits 0 with
exactly `{"abi":1,"confined":true}`; the verified-tools drill unchanged;
find lists `.git/config` without its contents and grep reports
`excluded > 0`; the swapped leaf still fails nonzero with empty stdout;
the first session run outputs `ALLOWED_CANARY` and the rewritten secret
run refuses with `secret`. Any remaining refusal now names its reason in
the assertion message.

## Item 1e — PARITYMAC5: the session self-test passes (8/10 → 10/10)

Cause (from the code; the probe and profile are now fine — all 8 raw
drills pass). `InspectRunner.selfTest()` (`src/core/judge/fast/inspectExec.ts`)
created ONE `home` dir and passed it to BOTH confined self-test executes
(`cat allowed.txt`, then `grep -r -e 'B1_.*_CANARY' .`). The Mac helper
consumes its home on every run (`check_home` demands it empty,
`open_profile` creates `profile.sb` with `O_EXCL`), so the second execute
always refuses `home` (exit 125, `{"refused":"home"}`) — while the Linux
helper never writes into home, so the mirrored Linux self-test passes.
`selfTest()` dropped that reason, the runner latched generic `selfTest`,
and both runner drills refused on the first run. Two changes, both in
`selfTest()` — no helper, profile, refusal or skip touched:

- Each self-test probe gets a fresh home (`b1-self-home-*` under the
  self-test root, removed with it), the same fresh-home-per-run contract
  every session run (`inspect()` → `b1-home-*`) and every drill fixture
  already follows.
- The latched refusal adopts the failing probe's own refused reason (cat
  and grep steps, as the probe step already did). Probes run probe, cat,
  grep in order and the first failure sticks, so the reason identifies
  which probe failed and why; the refusal shape and vocabulary are
  unchanged, no new strings. Had this run first, the rerun would have
  shown `{kind:'refused', reason:'home'}` on the grep probe.

Proven in this sandbox 2026-10-18 (live Seatbelt still needs the lead's
unsandboxed Mac, as before):

- Real binary, repo flags, direct CLT cc + MacOSX SDK (the repo script's
  `/usr/bin/cc` shim still fails on the rig's broken `xcode-select`).
  Self-test-shaped fixture (allowed/seeded `.git/config`, `.env`,
  symlink, hardlink): first `run` prints
  `{"confined":true,"abi":1,"excluded":0}`, writes `home1/profile.sb`,
  and fails solely at `sandbox_apply` (exit 71, this shell's nested
  sandbox); the same home reused refuses `{"refused":"home"}` exit 125
  with empty stdout — the exact failure the shared home forced on the
  grep probe; a fresh home proceeds like the first run.
- No new committed test: the two live runner drills ARE the coverage
  (they fail pre-fix, pass post-fix on a sandbox-capable Mac). A narrower
  test would need a fake helper or start function (forbidden: no fakes),
  and without a sandbox the probe step fails first on every platform, so
  no honest deterministic unit test can reach the changed lines.
- Gates on the final tree: prettier clean, eslint zero warnings,
  typecheck all five projects exit 0, `test/unit/inspectNative.test.ts`
  10 skipped / 0 failed here at the repo default timeout.

What the lead's unsandboxed rerun must show (`npm ci
--ignore-scripts`, `npm run build:confine`, `npx vitest run
test/unit/inspectNative.test.ts`): 10/10 green — the two runner drills
pass through a passing session self-test (find lists `.git/config`
without its contents, grep reports `excluded > 0`; first session run
outputs `ALLOWED_CANARY`, rewritten secret refuses `secret`). Any
future self-test failure names its probe's own reason instead of bare
`selfTest`.

## Item 1f — PARITYMAC6: protected names stay listed on macOS (9/10 → 10/10)

Cause (lead's macmini rerun): the last live drill fails —
`expected '.\n./allowed.txt\n' to contain '.git/config'`.
The walk skips every protected/private entry without granting any
profile rule for it, so under `(deny default)` the confined `find`
cannot even open the protected directory: names vanish along with
contents. Linux B1-13 keeps protected names visible (directory listing
and metadata) while withholding contents; the macOS profile did not.

Rule added (`native/confine/MuseSparkConfineMac.c`, in `walk()`, same
generated `policy.h`, nothing else changed): every skipped
protected/private dir-or-file now gets exactly one narrow literal
rule — a protected directory gets `(allow file-read* (literal "<abs>"))`
so its entries enumerate (names only); a protected regular file gets
`(allow file-read-metadata (literal "<abs>"))`. Any other skipped type
(symlink, fifo, …) keeps no rule at all: its name already surfaces
through the parent's listing, and readlink's gating stays denied. The
type comes from `fstatat(…, AT_SYMLINK_NOFOLLOW)` — no open, no follow,
no block on fifos; anything unstatable, or not a plain dir-or-file,
keeps no rule.

Why contents stay denied: Seatbelt checks every open's resolved path,
and no rule grants `file-read-data` on a protected file — the directory
grant lists names but opens nothing beneath it. `cat`/`grep` on a
protected file still refuse EPERM/EACCES; deeper entries enumerate
through their parent's listing but never open. No `file-write*`, no
`network*`, no `process-fork`, no new `process-exec`; workspace grants
stay literal-only; the walk's exclusions and the `excluded` count are
unchanged (every skipped entry still counts).

What the lead's unsandboxed rerun must show (`npm ci
--ignore-scripts`, `npm run build:confine`, `npx vitest run
test/unit/inspectNative.test.ts`): 10/10 green — `find . -print`
lists `.git/config` without its contents, `grep -r -e 'CANARY' .`
prints `ALLOWED_CANARY`, never `FORBIDDEN_CANARY`, with `excluded > 0`;
every other drill unchanged. The generated `profile.sb` for the drill
grows by exactly one line: the `file-read*` literal for
`<workspace>/.git` (the walk never descends into a skipped directory,
so `.git/config` gets no rule of its own — its name surfaces through
the parent's listing, its contents and metadata stay denied).

Proven in this sandbox 2026-10-18 (live Seatbelt still needs the lead's
unsandboxed Mac, as before):

- The fixed helper compiles clean under the repo's exact flags
  (`-std=c11 -O2 -Wall -Wextra -Werror -Wconversion -Wshadow`) via the
  direct CLT cc against the MacOSX SDK (`policy.h` from
  `node scripts/build-confine.mjs`; the script's `/usr/bin/cc` shim
  still fails on the rig's broken `xcode-select`, environmental).
- Drill-shaped fixture (`allowed.txt` + `.git/config`): the run prints
  `{"confined":true,"abi":1,"excluded":1}` and the profile gains
  exactly the one new line —
  `(allow file-read* (literal "<workspace>/.git"))` — then fails
  solely at `sandbox_apply` (exit 71, this shell's nested sandbox).
  `sandbox-exec -f` parses the profile clean (71, not the 65 a parse
  error gives).
- File and symlink branches: with `.env` (file) and `.husky` →
  `/etc/hostname` (symlink) added, `excluded` is 3; `.env` gets
  `(allow file-read-metadata (literal …))` only and the symlink gets no
  rule at all — no `file-read-data` on any protected file, readlink
  stays denied so the target is unrevealed.
- Refusal matrix on the fresh binary unchanged: `workspaceIdentity`,
  `program`, `privateOperand`, `operand` — all exit 125 with empty
  stdout.
- One cold-start flake noted: the very first exec of the fresh binary
  refused `walkBudget` (macOS launch verification pushed the walk past
  100 ms); every later run is ~70 ms all-in. Environmental, not a code
  cause — and the lead's rerun executes the binary repeatedly.

## Drills

- Item 3 and item 2 drills ran live on this Mac (above).
- Item 1 live Seatbelt drills (5, in `test/unit/inspectNative.test.ts`) did
  NOT run here: this shell's sandbox denies `sandbox_apply`, and the rig's
  broken `xcode-select` denies the repo build's compiler shim. They skip
  visibly and must run green on an unsandboxed Mac / hosted macOS CI before
  the Seatbelt change merges. Everything provable without the sandbox was
  measured above.

## Lane PR244W1 — first result (macmini rig, 2026-10-18, head `130ad5a31`)

Review threads: 0 listed in the brief — none to fix or answer.

Root cause (measured on this rig, same repo-default timeout): the macOS
live disk probe fails on any Mac with more than one block storage driver.
`DarwinDiskDelta.read` keys counters by the IORegistry object name, and
every driver instance is named `IOBlockStorageDriver`, so the
duplicate-name guard returns null on every read and
`test/unit/resourceProbesDarwin.test.ts > macOS probes live > reads GPU,
disk and headroom from this Mac` fails at line 99 (`expected null not to
be null`). Hosted macOS runners carry several block devices, so the
capacity macOS unit shard fails, `org` fails, and every `required` name
rejects. Fix in progress on this lane: key Darwin counters by the
registry entry id (unique per device, stable across consecutive reads —
the same identity shape Linux already uses as `major:minor:name`).

- build / quality (ubuntu-latest): downstream — `required` rejects when
  any selected-tier job fails, and the measured selected-tier failure is
  the capacity macOS unit shard on the duplicate driver-name cause above
  (static gates re-run below before this lane ends).
- build / package (.vsix): downstream — same `required` rejection; the
  packaging steps themselves were not reached.
- build / dictation helper (macos): downstream — same `required`
  rejection; `native-build` itself was not reached.
- build / quality (macos-latest): downstream — same `required` rejection
  via the capacity run, not a macOS static-gate failure.
- build / quality (windows-latest): downstream — same `required`
  rejection (static gates re-run below before this lane ends).
- build / tests (windows-latest, macos-latest) in
  scnetsolutions/muse-spark-code-ci: downstream — the macOS shard fails
  on the duplicate driver-name cause above; the fix is verified by the
  live test passing on this multi-driver Mac plus a new recorded-exchange
  test with two same-named drivers.

## Lane PR244W1 — fix and verification (macmini rig, 2026-10-18)

Fix (commit `673b54a18`): `src/core/resources/sampler/darwinDisk.ts`
keys each driver's counters by registry entry id plus object name
(`0x…:name` — the same unique-identity shape Linux already uses as
`major:minor:name`) instead of the bare object name. Registry ids are
stable across consecutive reads (both fixture pairs keep theirs: the
MacBookPro pair shares `0x100000461`, the macmini pair keeps
`0x10000047c`/`0x100000464`). A header-shaped line without a parseable
class and id now fails closed instead of attributing its counters to the
neighbouring device. No widening: the duplicate-identity guard, the
missing-key refusal, the walk exclusions and every denial are untouched;
no `file-write*`, no network, no new surface. No path comparisons in the
changed code, so Windows separators are unaffected.

- Authentic pre-fix failure observed: `test/unit/resourceProbesDarwin`
  live test failed at line 99 (`expected null not to be null`) on this
  two-driver Mac — the same permanent-unknown any multi-disk Mac,
  including hosted macOS runners, hit. The new recorded-exchange test
  (`tells same-named drivers apart by registry entry id`, fixtures
  `ioreg-blockstorage-twodevices[-later].txt`, captured
  `ioreg -r -c IOBlockStorageDriver -d 1` twice ~5 s apart on this rig
  2026-10-18) encodes that cause: baseline null, then 100 (~14.4 s busy
  over 5,000 ms wall, capped).
- Final tree, repo-default timeout, `--maxWorkers=3`:
  `resourceProbesDarwin` 8/8, `resourceDiskDelta` 2/2 (10/10 together);
  `pluginDispatch` and `inspectNative` unchanged by this fix and green
  as measured on the head (`pluginDispatch` 29 passed + 2 skipped,
  `inspectNative` 5 passed + 5 sandbox-gated skips).
- Gates on the final tree, all exit 0: prettier on changed files, eslint
  `--max-warnings=0` on changed files, `typecheck` (all five projects),
  `check:plan` (0 drift), `check:l10n` (0 problems), `npm run build`
  (budgets hold), `deadcode`, `cycles`, `duplication` (0 clones),
  `security:audit` (2 advisories, 1 exception, exit 0).

## Lane PR244W2 — first result (macbook rig, 2026-10-18, head `eaf7a0330`)

Rule site: `budget()` in `native/confine/MuseSparkConfineMac.c:118-123`
(and the mirrored `native/confine/MuseSparkConfine.c:121-126`) refuses
`walkBudget` when `visited > JUDGE_FAST_B1_WALK_MAX_ENTRIES` (20,000,
deterministic) **or** the wall-clock walk time exceeds
`JUDGE_FAST_B1_WALK_MAX_MS` (100 ms, `src/shared/constants.ts:4040`).
The clock arm measures `CLOCK_MONOTONIC` from the run's start, so any
descheduling over 100 ms — eight other jobs on macmini, a cold start on
PARITYMAC6 — refuses a walk of a five-file fixture. The failure is a
security refusal caused by machine load, not by anything the walk saw:
`runs session self-tests once …` got `{"kind":"refused",
"reason":"walkBudget"}` where it expects `output`, and the earlier
loaded run failed 5 with several at the 5,000 ms test timeout.

Deterministic replacement (this lane): drop the wall-clock arm
entirely. `budget()` refuses only past 20,000 visited entries — a count
that caps the walk's work and the generated profile's size however slow
the machine is — and the depth arm (`> 128`) is untouched, as are the
path-length `walkBudget` refusals (over-long relative/absolute paths,
deterministic). `JUDGE_FAST_B1_WALK_MAX_MS`, the `started` timestamp,
the per-entry `clock_gettime` call and the `clock` refusal go away in
both helpers, the TS refusal enum and the `Time` test variant; the
`Budget` (entries = 2) and `Depth` (depth = 0) variants keep proving the
remaining bounds fire. No widening: every denial, exclusion and
same-device check is untouched; a slow walk now completes slowly
instead of refusing.
