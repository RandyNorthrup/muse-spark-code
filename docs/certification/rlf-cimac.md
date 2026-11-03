# RLF-CIMAC — the macOS-only failures on merge round 11's head

Rig `macmini` (Intel x86_64, macOS 15, Node 24.21.0, libuv 1.52.1, about
10 GB free), branch `rec/rlf-cimac`, base `06bf4704a`. Hosted run
41677635406 on that head (macos-latest: Apple silicon, Node 22.23.4)
failed the files below. No budget, cap or timeout raised; no push, merge
or rebase; no Muse request, no paid provider call, no `muse` CLI started.

Each file was run here with the repository's own timeouts:
`npx vitest run <files> --maxWorkers=3`.

## playbookGovernor — test fault

`which file a path names > still matches a case-different spelling of a
file that exists where the file system ignores case` failed here and on
hosted macOS with `expected [ 'src/core/schedules/clock.ts' ] to deeply
equal []`. Cause (shown by the log and reproduced): the test expected the
match on `win32` only, but macOS's default volume ignores case too, and
the product asks the file system (`realpathSync.native` resolves the
upper-case spelling to the file), so it rightly matches there. The test
now asks the file system whether the upper-case spelling exists and
expects the match exactly where it does — the same claim its title makes.

Drill: product broken on purpose (`workspaceFile` treats any spelling that
differs from its resolved identity as lost) → the case exit 1; restored →
exit 0.

## panelSessions — test fault

`a real emulator renders captured PTY bytes` failed on hosted macOS at
`panelSessions.test.ts:207:80` (no rendered line held both `red` and `✓`)
and here at the wait for the shell's exit. One cause, two shells: the
command typed into the person's shell used `printf '\e[31mred\e[0m
\u2713\n'`. macOS's `/bin/bash` is 3.2, whose `printf` prints `\u2713` as
text (hosted runners' `SHELL` is `/bin/bash`, inferred: the log does not
print it); zsh here refuses `\u2713` outside a UTF-8 locale ("character
not in range") and drops the rest of the line, so `exit` never ran (seen
in the captured PTY bytes). The command now uses octal escapes
(`\033`, `\342\234\223` = ✓ in UTF-8), which every shell's `printf` writes
as they are. The case still feeds real PTY bytes from a real shell to a
real xterm.js emulator. Not node-pty's helper mode: no `posix_spawnp` in
the log.

Drill: the old command under `SHELL=/bin/bash` → exit 1 at
`panelSessions.test.ts:207:80`, the hosted failure's own line; the new
command under `SHELL=/bin/bash` → exit 0; under zsh → exit 0.

## teamWorkerCreateBundle — test fault

`NF packaged file adapter shares the retained grant and loads native
creation only on first use` failed here and on hosted macOS with
`NativeHelperError: The native helper muse-dictate-screen-<arch>.app is
missing`. Cause (shown by the log and reproduced): the test planted the
installed macOS helper at `native/darwin/muse-dictate`, but production
looks inside its architecture's app
(`native/darwin/muse-dictate-screen-<arch>.app/Contents/MacOS/muse-dictate`,
`createdHelperFile`). The test now plants it at the path production's own
`createdHelperFile` names; the real compiled C worker still answers through
the production darwin launcher.

Drill: the old planted path → exit 1 (the missing-helper error); the
production path → exit 0.

## artCursors, artIcons, artBoot — one cause, product (build script) fix

Each failed on hosted macOS with `Test timed out in 5000ms` (cursor
freshness; icon renders at 48 px; boot art byte-for-byte), and artCursors
and artIcons timed out here too. Cause (measured here): resvg scans every
system font on each `new Resvg(...)` unless told not to — 106 to 158 ms
per render on this Mac against 0.1 ms without it, and the suites make
dozens of renders. Linux runners carry few fonts, so only macOS and Windows
pay it. The art draws no text (no `<text>` anywhere under `design/art`),
so `scripts/lib/resvgFonts.mjs` now holds `{ loadSystemFonts: false }` and
both build scripts and both tests' own renders pass it. This covers
artBoot's Windows failure too (the same per-render font scan; inferred,
the Windows log is not in this lane's set).

Every committed output is unchanged: `npm run check:art` exit 0 (cursors
294, icons 360, desktop-art 24, companion-art 61 outputs fresh), and the
byte-for-byte cases pass. The three files took 56.2 s here before, 10.6 s
after; the slow cases fell from 5 to 8 s to 6 to 35 ms.

Drill: before the change, artCursors and artIcons → exit 1 (timeouts);
after → exit 0, with no timeout raised.

## teamCheckSlotsGoverned, teamWorkerChecks, governedTeamSlotsPoll — one cause, test fault with a small product seam

Hosted macOS: `expected null to be 1` (the governor's check capacity), a
check that should have waited started (`[ 'start next', 'end next' ]`), and
the window-governed slot cases failed the same way. Cause (reproduced): the
hosted runtime is Node 22.23.4, whose libuv (1.51.0) is older than 1.52, so
on macOS the live sampler reads memory headroom only through the signed
helper (`DarwinMemoryReader`), which sits beside `dist` in an installed
product and nowhere in a source checkout. The machine's memory reads as
unknown, a 0% memory limit never moves the governor to throttle, and every
case that relies on throttle's one place fails. The product is right:
unknown memory is not pressure, and it never substitutes free pages.

Fix: the suites lend the governor the real helper compiled from
`native/darwin/MuseSparkCreated.c` (`liveSamplerSuite`, already used by the
relocation suites; a no-op off macOS and on libuv 1.52+).
`teamCheckSlotsGoverned` passes it to `createMachineResourceSampler`; the two
window suites pass it through `governorWindow`, for which the window host's
settings gain an optional `darwinMemory` reader
(`src/core/resources/resourceGovernorEntry.ts`; undefined keeps the
packaged helper, as an installed product has). `dist/resourceGovernor.js`
stays inside its unchanged budget (124.6 of 125 KiB).

A second, rig-only cause in `teamCheckSlotsGoverned`: its disk floor was
the free space plus 10 GiB. With this Mac's 9.6 GiB free that floor (20 GiB)
put free space at half the floor or less, which pauses all background work
(`disk.ts`) instead of holding disk-heavy work, so the check was refused as
paused. The floor is now one and a half times the free space: above it,
under twice it, on any machine with more than a gigabyte free.

Drills, with Node 22.23.4 (libuv 1.51.0, downloaded and checksum-verified
into the lane's temp folder): the old three files → exit 1, 6 of 13 failed
(the five hosted failures plus the disk floor case); the fixed files →
exit 0, 13 of 13. Node 24.21.0 (libuv 1.52.1): fixed files → exit 0.

## nativeHelper, macosRecorderDeps — test fault (the premise fails under Rosetta)

Hosted macOS (Apple silicon): nativeHelper's `that is built for the other
processor says so` got the helper's own refusal (`created directory helper
refused`, exit 1) instead of `fault: 'unloadable'`, and macosRecorderDeps'
`says the signed app cannot run on this Mac when it is built for the other
processor` timed out at 5 s. Cause (shown by the log): the other
processor's build is x64, and hosted Apple silicon runners have Rosetta, so
the x64 helper starts and answers for itself (its refusal text is in the
log); the recorder app starts and records until the deadline. The product
is right: a helper that started is never a start fault. On this Intel Mac
the arm64 build cannot start, and both cases pass.

Fix: `test/unit/helpers/otherProcessor.ts` asks the system whether this Mac
runs the other processor's build (`/usr/bin/arch -x86_64 /usr/bin/true` on
Apple silicon; never on Intel), and both cases are skipped, by name, where it
does: `(SKIPPED: Rosetta runs the x64 build on this Mac)`. They still run
wherever the premise holds (an Intel Mac, or Apple silicon without Rosetta).
On hosted macOS they will now read as skipped, not passed; no hosted
runner in this matrix can show the start fault with a real build.

Drill: the other processor's slot given this processor's own build (a build
that starts, as Rosetta's does) → exit 1 with `created directory helper
refused`, the hosted failure's own text; restored → exit 0. Both suites →
exit 0, 25 of 25, with `native/darwin/build.sh` run here so nativeHelper's
case runs rather than skips. Next hosted log must show both cases skipped
with the Rosetta title.
