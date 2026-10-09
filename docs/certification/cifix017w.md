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

Post-commit diff review found a new close-error edge: success status had
already been selected when the deferred close threw. A real-handle close
fixture proves the defect (HTTP 200 instead of 400), then the catch resets
status to refusal. The handle still closes and private bytes disappear;
the sensitive injected close diagnostic never reaches the response.
The final upload/schedule repeat set includes this fiftieth upload test.

## Resource-history durable disposal

The governor records a valid live snapshot; the empty day list was a test
race with the explicitly best-effort asynchronous disposal flush. Wait for
the day assertion. The corruption case had a related race: the day folder
could exist before its `.jsonl` file, leading to `EISDIR`. Wait for a
complete durable line before appending corruption, retaining its existing
3-second wait and all refusal assertions.

A temporary 200 ms delay before disposal flush reproduces the exact first
failure (expected one day, got zero) and exposes the corruption case's
`EISDIR`: original file 5 passed/two failed; the waiting version passes
7/7. This is an explicit slow-disposal control, not a timeout override or
an assertion change. Restore product entry SHA-256
`7a99fe1693930215080733f121ab9752f4d09b4d836e5e533719a494c81e91c9`
byte-exact. Final actual-source repeats: 7/7, 1.631/1.720 s.

## Native PowerShell startup

Cold `New-Object`, JSON and environment-provider cmdlets load PowerShell
modules that these probes do not need. Use CLR constructors in the vault's
inline guard, emit the same native ACL fixture table directly, print the
known schedule JSON value through Console, and read the credential fence's
exact canary through Environment. The ACL table still runs once in one
native process; every descriptor and predicate assertion is retained.
The vault already caches completed source-derived native builds in memory
and its three distinct fixture outputs compile once in `beforeAll`.
Do not introduce a disk guard cache or bypass verification before private
input: those would change the security contract.

Temporary hook instrumentation measures vault setup 3,527 → 3,117 ms and
trusted-path table setup 547 → 411 ms. W-X1 cases measure 319/296 →
263/306 ms; the second case shows normal startup variance, not a measured
speedup. The schedule system-helper test measures 392 → 252/234 ms.
The original native batch passes on the idle rig, so the hosted 30/15-second
timeouts were not reproduced here. These changes reduce cold startup work
without changing any deadline or claiming a load-saturated CI result.

The uninstrumented vault/trusted/fence batch passes all 80 cases twice at
repository defaults. Trusted-path test time is 9.830/9.844 s; vault test
time is 35.567/35.436 s (sum of individual tests, excluding setup); fence
test time is 487/491 ms. Upload/schedule repeats pass all 96 cases including
the close-error regression; schedule test time is 653/602 ms.

## Trusted-path duplication

The unchanged duplication gate reproduces the single six-line clone at
the two temporary-directory cleanup sites (51 tokens), exiting 1.
Fold only those blocks into `removeTemporaryDirectory`; retain the
resolved-parent assertion before recursive removal. `npx.cmd jscpd`
then exits 0: 2,900 files, zero clones, 1.75 s detector time. No threshold,
minimum token count, ignore or gate configuration changes.

## Production package isolation and inherited blocker

Four packaging suites independently compiled the complete production
tree inside their workers. Global setup now builds once for selected packaging
consumers; each suite copies the production output into its own complete
fixture before mutations. Selected paths are normalized for Windows.
Unrelated native runs do not build production. Build failure diagnostics
go to a private disk log rather than `execFileSync`'s default output buffer.
The failed global snapshot is removed while its diagnostic log survives.

The original actual-source package setup fails as ENOBUFS. Its underlying
production build already refuses the 79,510-byte serialized 0.17.0/0.16.0
What's New content against the unchanged 76,800-byte decoded bound, before
bundling. This is reproduced with LF-normalized input too. No release
notes or cap are changed by this lane; PLAN §7 records the lead-owned
release representation decision. Actual-source package/build checks
cannot be certified green until that blocker is resolved.

A private, clearly named source fixture abbreviates only the previous
release's notes to qualify shared build/copy behavior. It does not replace
the final actual-source run or certify a release. In that fixture, the
original per-suite production-build setup completes after 66,408 ms,
exits 1 against its unchanged 60-second hook, and neither archive test
runs (111,357 ms total invocation including global setup). Shared-output
setup takes 49,318/48,438 ms; the full archive/slash pair passes 3/3 twice
(91,382/90,940 ms total invocations). The initial full
package/webview/slash batch passes 58 cases and fails one: webview's
resource-policy emitted-input drill exceeds its unchanged 15-second test
deadline while spawning the full split check. No retry with raised
timeouts, filtered assertions or unrelated gate repair is applied.

## Local commits

| Finding                                 | Commit      |
| --------------------------------------- | ----------- |
| Recorder 8.3 canonicality               | `6dbef28ce` |
| Upload response after private cleanup   | `25fc5fb90` |
| Upload close-error refusal              | `6fce4a804` |
| Resource-history durable disposal wait  | `1fb23c458` |
| Trusted-path cleanup clone              | `0beb498c1` |
| Native PowerShell cold startup          | `ad1ff7477` |
| Shared production build and diagnostics | `c9049a4a0` |
| Shared context type declaration         | `060ea6d50` |

Each commit uses the installed hooks; staged and committed diffs were
re-read after the hook's fixes. Final aggregate quality remains lead-owned.

## Final actual-source test receipts

All commands are direct win11 invocations with `--maxWorkers=3`, at most
three selected files, and no deadline overrides. The seven scoped files
that can run without production packaging pass twice (222 cases per pass):

| Scoped file                 | Cases | Repeat receipts           |
| --------------------------- | ----: | ------------------------- |
| windowsScreenRecorderNative |    39 | final-ordering-1/2        |
| windowsVaultNative          |    34 | final-native-1/2          |
| windowsTrustedPath          |    24 | final-native-1/2          |
| nativeScheduleBackground    |    46 | final-upload-schedule-3/4 |
| vault/execFence             |    22 | final-native-1/2          |
| resourceHistoryWiring       |     7 | final-ordering-1/2        |
| companionUpload             |    50 | final-upload-schedule-3/4 |

Receipts are `temp/cifix017w-<name>.json`. Final upload tests take
612/674 ms and schedule tests 664/630 ms. The fourth batch also passes
all 20 vault-transport unit cases (93 ms). No source drill or temporary
instrumentation remains.

Actual-source archive invocations exit 1 twice, 8,410/8,413 ms, during
global production setup before either test can execute. Vitest emits its
generic `No test files found` message along with the explicit shared-build
error; selected paths are correct. Both retained production logs show
`encodeWhatsNewContent` refusing `WHATS_NEW_CONTENT_DECODE_MAX_BYTES`,
not ENOBUFS. The failed snapshots disappear and the outer disk logs remain:
`temp/l10n-builds-FgHnWE.build.log` and
`temp/l10n-builds-BMQF9R.build.log`. Default/JSON reporter receipts are
`temp/cifix017w-final-package-1/2.log` and `.json`.

## Final static/build receipts

`temp/cifix017w-final-gates.json` records the sequential commands, exits,
elapsed times and full log paths. Changed-file ESLint exits 0; deadcode
exits 0 (two existing configuration hints); duplication exits 0 (zero
clones); localization exits 0 (14 UI/usage tables, zero problems); host
API exits 0 (375 APIs, zero problems); reference and roadmap exit 0 and
remain current. `npm.cmd run build` exits 1 in 4,288 ms at the inherited
decoded-content bound, after tokens report zero problems. Bundling, size,
split, host-globals and notices stages are consequently not reached; no
actual-source output sizes can be certified from this run.

The first final unit typecheck exposes the missing Vitest `ProvidedContext`
declaration (`productionBuild` was typed as `never`). Add its string type
in the existing shared helper, with no runtime change or cast. This compiler
failure proves the context declaration is needed. The first formatting
check reports only this certificate after new receipts were appended;
format it and repeat the check.

After the type correction, `npm.cmd run typecheck` exits 0 for all five
projects (host, webview, unit, e2e and integration; terminal session 96560).
The follow-up hook's changed-file ESLint and Prettier also exit 0.

Final all-changed-file ESLint and Prettier rechecks exit 0, as does the
roadmap recheck after the PLAN deferral paragraph. Timings and full logs
are in `temp/cifix017w-final-rechecks.json` (26,707/15,105/1,263 ms).

Scratch cleanup: the package qualification snapshots were removed by their
owned fixture lifecycle. Automatic approval review rejects direct recursive
removal of the two remaining owned scratch roots with `blocked by policy`.
Stop that part as the rig brief requires; no alternate deletion launcher.
The lead can remove `temp/l10n-builds-TGLDZv` (the initial failed setup
snapshot, including a read-only dependency junction) and
`temp/recorder short ancestor` (the 8.3 reproduction parent). Logs and
scripts under gitignored `temp/` remain as receipts.
