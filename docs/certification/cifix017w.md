# CIFIX017W — Windows 0.17.0 hosted CI repairs

Rig: win11, release base `8f0a75ea1`, branch `rel017/cifixw`, 2026-10-09.
Brief: `C:/lanes/_ctx/CIFIX017W.rig.md`; digest: run 37950960680.
No live/paid calls, network calls, merges, pushes, gate/cap/timeout changes,
custom hook modifications or aggregate quality runs. Hooks resolve to
`.husky/_`. The first commit attempt refused the plain Husky stubs; the
repository's prescribed `npm run prepare` installed its fail-closed stubs.
Every successful commit runs the unchanged repository hooks.

## Recorder native path spelling

The guard originated in `b2bc4ba0f` and was unchanged by the cancellation
repair `261aacc5b`. .NET Framework `Path.GetFullPath` expands existing 8.3
ancestor names; comparing it with Node's supplied short TEMP spelling
rejects valid destinations before copying begins. An actual 8.3 TEMP/TMP
invocation reproduces all ten digest failures: 10 failed, 28 passed,
20.42 s wall time. A long TEMP invocation passes the original 38 cases.

Use Win32 `GetFullPathName` for lexical canonicality without alias expansion.
Keep absolute-path, canonical-spelling, reserved-name, protected-DACL,
exclusive-creation, source-identity and cancellation guards. The native
test helper now returns the root's actual short spelling, checked against
the original root's resolved identity, so the whole suite exercises hosted
TEMP conditions on this rig. An additional control uses its long spelling.

Default-timeout full-file replays pass 39/39 twice: 7.144 s and 7.057 s
test time (JSON report, excluding hooks). Cancellation reaches `copying` then
`cancelled`, partial/completed private copies disappear, and source bytes
remain unchanged. Traversal and existing-destination refusals still pass.

Canonicality drill: remove only the native normalized-spelling comparison;
the full file exits 1 on the traversal assertion. Restore SHA-256
`02f54f06efa81a2ab5979d3cedc9b0e22ab505905c79c5802e792418b6027c4c`
byte-exact. All five typechecks pass; changed-file ESLint passes. Normal
hooks perform staged Prettier/ESLint and the staged secret scan.

## Initial measurements and remaining qualification

The original eight scoped files are being qualified directly on win11, with
at most three files per invocation and repository defaults. The repository
currently sets Windows tests to 15 s and hooks to 30 s in vitest.config.ts;
the archive hook separately names 60 s. No command overrides these values.

The initial vault/trusted-path/fence batch passes 80/80 in 71.90 s. W-X1
cases take 388/298 ms; trusted root/components 3.280 s; junctions 5.991 s.
The initial recorder/history/upload batch passes 93/93 in 36.56 s.
Native schedule background passes its full file; package setup fails before
tests with ENOBUFS, masking the build's existing What's New decoded-content
budget failure. Measurements and final checks will be appended per fix.

## Companion upload acknowledgement and cleanup

The handler sent success before its inspection handle's `finally` close
and the outer private-directory removal. The HTTP client could therefore
finish and tear down its parent while Windows still held the file open.
Reply only after both cleanup steps, for success and refusal alike.

The regression observes `ServerResponse.writableEnded` at the real read
handle's close and also checks that no private directory remains after the
response. With original product code: 47 passed, two failed (1.526 s test
time), proving acknowledgement while the handle remained open and leftover
private bytes after the Unicode response. Restore the fixed product file
byte-exact: SHA-256
`47e74ab14afb2cf43c8ce6b043c92b9e77ef2eb9ff791ea9064d945850ed4def`.
Final full-file repeats: 49/49, 601/648 ms.
