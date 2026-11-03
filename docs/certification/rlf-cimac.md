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
