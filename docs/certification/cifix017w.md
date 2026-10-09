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

The complete exec consumer passes all 41 cases twice against the controlled
source fixture (256,058/248,827 ms whole invocations, including its existing
long setup). Receipts: `temp/cifix017w-package-fixture-1-1/2.json`.
Temporary instrumentation restores global setup SHA-256
`0022590dc797894b5b835dcbc187aa70a18b249d84b748591cc9787db5a57d52`
and archive test SHA-256
`16cd4ae8d4ac70b9d76ecd6115ce45eafce41b6e57396c05f34120e437c9c0ad`
byte-exact. The owned private source snapshot is removed after both repeats.
These are controlled-fixture results, not actual-release certification.

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

## Round 2, Windows

Lane CIFIX017W2, 2026-10-09: branch `rel017/cifixw2` from `a0b3f55c9`
(the 0.17.0 release head on PR #145), on the lead's Windows 11 host, with
vitest on the win11 VM and kubuntu. Digests: CI run 37980345168 (static
gates job 113988954528, unit shards 1 and 2, jobs 113988955084 and 113988955088) and Hosts run 37980344591 (agent package on windows-latest,
job 113990120245). No live or paid calls, pushes, merges, rebases or
timeout, cap, threshold or tolerance changes. Hooks: `.husky/_` with the
repository's fail-closed stubs (`npm run prepare`); every commit ran them.

### 1. `cycles` exits 255 on Windows

Cause: the `cycles` script was 8,070 characters. npm runs a script as
`cmd.exe /d /s /c "<script>"`, and `node_modules/.bin/dpdm.cmd` re-expands
every argument into one line of its own after `%COMSPEC%`, the program and
its own folder, past cmd.exe's 8,191 characters. On the host the old script
run as npm runs it exits 255 in 36 ms with "The syntax of the command is
incorrect.", before dpdm starts. Through that shim in a 51-character `.bin`
folder an 8,035-character script runs and 8,036 fails.

Fix: the 222 roots and the dpdm options (`--no-warning --no-tree
--exit-code circular:1 -T`) move to `scripts/cycles.json`;
`scripts/cycles.mjs` starts dpdm's CLI with node, no shell, and exits with
dpdm's status. The patterns reach dpdm unexpanded, as they did quoted.
`npm run cycles`: 3,129 modules, no cycle, exit 0 on the host (57 s, then
51 s) and kubuntu (31–34 s); Ubuntu's old command analysed 3,128 (the
runner itself is the new one). A planted two-file cycle exits 1 on the host
with both runner versions. The first runner resolved dpdm through
`createRequire().resolve`, which plain knip does not read: deadcode reported
dpdm unused (exit 1) until `import.meta.resolve` replaced it (exit 0).

Test: `manifest.test.ts` fails any npm script whose line, as npm hands it to
cmd.exe or as a `.bin` shim expands it with MAX_PATH-long paths, passes 8,191
characters (budget 7,088 for a script). `cyclesRoots.test.ts` reads the roots
and options from the list.

### 2. `windowsTrustedPath` timeouts (shard 2)

Cause: the production verifier starts one Windows PowerShell per component;
its script used `Get-Item`, `Get-Acl` and `ConvertTo-Json`, each of which
loads its module on first use, after PowerShell looks the command up among
the installed modules. On the hosted runner one probe of `C:\` passed 15 s,
while the same file's CLR-only policy table took well under a second.
Measured on win11 (one probe of `C:\`, no persisted module analysis cache,
under the concurrent shard run):

| Module path       | Cmdlet probe (ms)        | CLR probe (ms)  |
| ----------------- | ------------------------ | --------------- |
| Default           | 16,463 / 1,421 / 1,421   | 345 / 327 / 330 |
| 300 extra modules | 18,723 / 13,183 / 29,024 | 847 / 328 / 369 |

Fix: `[IO.File]::GetAttributes` for the item's own attributes (a reparse
point is still refused before its descriptor is read) and
`[IO.Directory]`/`[IO.File]::GetAccessControl` for the descriptor, as
Get-Acl reads it (owner, group, access); the boolean goes out through
Console. `Test-TrustedAcl` and the TRUSTROOT rules (PLAN D105) are
unchanged. A new case verifies a folder and a file with module
auto-loading off.

Second cause, masked by the timeouts: hosted `%TEMP%` is 8.3
(`C:\Users\RUNNER~1\...`), and the verifier probes and answers with resolved
paths. Two real-folder cases compared the answer with the path as given and
detected the refused component by its given spelling. With TEMP/TMP set to
their 8.3 spelling on win11 (`C:\Users\Randy\gates\TMP-RT~4`) three cases
fail; the cases now expect `realpath` results and pass 25/25 there.

### 3. Shard 1 cancelled at 20 minutes

No hang. The job reported files until the 20-minute limit cancelled it:
229 of its 255 files after 1,144 s of tests (19.1 min); the 26 left take
about 4 s of tests. The vitest hash split was recomputed exactly
(`temp/cifixw2/shards.mjs`). On win11 the same 255 files run to the end in
2,287.87 s (the VM is slower, mostly in git); five files fail there on VM
conditions only (recordingReader 20 s hook, runtimeChatGptPackage 60 s hook,
visualStability painted selector, vault/sshImport ssh-keygen, one
modelApiHost reviewer case), none hung, and all but visualStability passed
on the hosted shard.

What grew: `windowsVaultNative` took 153,389 ms. Seven "refuses an untrusted
… ACL" cases timed out at 15,000 ms, and two later cases failed (5,446 and
2,200 ms). Each of the seven first adds an Everyone rule through a
PowerShell that used `Get-Item` and `New-Object` (item 2's cause); a
timed-out case kept changing the rule in the background while later cases
verified the same helper. The previous run's vault setup ended in 30 s.
Fix: `FileInfo`/`DirectoryInfo`, `SecurityIdentifier` and
`FileSystemAccessRule` through `::new`, DACL only, with module auto-loading
off and errors stopping the script. win11: 34/34 (44.0 s, then 41.6 s).

What remains: the shard is too large for one job. From the hosted per-file
times of runs 37950960680 and 37980345168 (vault at its fixed time) five
Windows shards project to 17.8/17.4/14.1/16.4/14.7 min of tests; the other
shards spent 1.2–2.2 min on set-up and upload, so shard 1 sits at the
limit. Six project to 16.0/14.2/11.6/16.2/9.8/12.6. Commit `222c428ec`
moves Windows to six shards (Ubuntu and macOS keep four; coverage requires
all six). It revisits the lead's five-shard decision (CITIME017) and stands
alone so it can be dropped.

`visualStability.test.mjs` also failed in this shard: a `beforeAll` ran out
the 30 s hook deadline (30,859 ms; the cancel cut off its details). On macOS
the same file's first `beforeAll`, the production webview build, ran out
its 10 s. That cross-platform case belongs to CIFIX017L2; not changed here.

### 4. Agent package on Windows: `RequestError: Internal error`

Cause: the runtime's resource governor starts every contained process on
Windows, `muse serve` included, through the sealed job launcher compiled
from `native/windows/MuseSparkMcpLauncher.cs`
(`src/runtime/resources/jobs.ts`). `scripts/package-acp.mjs` still left that
file out under a pre-governor comment; the unit job's fixture copies every
`JOB_SOURCE_FILES` entry, so the suite passed there. Reproduced on win11:
the fixture without the launcher fails exactly the four hosted cases with
`RequestError: Internal error`.

Fix: ship the launcher's C#; the two suites that package a test-owned tree
lay it out, and the CI package check requires it. The packaging suite
requires every `JOB_SOURCE_FILES` source in the package. Not verified here:
the installed tarball on Windows (packing needs the Darwin and Linux
helpers CI builds); the hosted agent-package job is that check.

### Red drills (each file restored byte-exact, SHA-256 compared)

| #   | Break                                                 | Rig     | Result                                                            | Restored SHA-256 (prefix) |
| --- | ----------------------------------------------------- | ------- | ----------------------------------------------------------------- | ------------------------- |
| D1  | `cycles` back to the 8,070-character script           | kubuntu | manifest exit 1: `[ 'cycles: 8070' ]` vs `[]`                     | `09434210483ede78`        |
| D2  | `src/extension.ts` dropped from `scripts/cycles.json` | kubuntu | cyclesRoots exit 1, 3 cases name `src/extension.ts`               | `623f9aa961dc02ea`        |
| D3  | launcher dropped from `JOB_SOURCES`                   | kubuntu | resourceAcpPackaging exit 1, the new case                         | `058f9082ce96af7c`        |
| D4  | verifier back to the cmdlet script                    | win11   | windowsTrustedPath `-t CLR` exit 1: refused instead of ok         | `a95c50925661bd80`        |
| D5  | vault ACL fixture back to `Get-Item`/`New-Object`     | win11   | 7 cases fail, "test ACL change failed"                            | `445af609aa9101d0`        |
| D6a | 8.3 TEMP with given-path expectations                 | win11   | 3 cases fail (given vs resolved path, unrefused component)        | `d331627464a1ae2d`        |
| D6b | 8.3 TEMP with resolved-path expectations              | win11   | 25/25 pass (control)                                              | `d331627464a1ae2d`        |
| D7  | e2e fixture without the launcher                      | win11   | acpStdio: the 4 hosted cases fail, `RequestError: Internal error` | `5e36cca22d84f2cd`        |
| D8  | coverage job back to `SHARDS` 5 for Windows           | kubuntu | manifest exit 1, the shard case                                   | `44636fca9ccface0`        |
| —   | planted two-file cycle under `scripts/lib`            | host    | `npm run cycles` exit 1, cycle named; files deleted               | —                         |

### Receipts

win11 (snapshots): baseline shard 1/5 at `a0b3f55c9` `fe708b8f` (255 files,
2,287.87 s); native suites `c58949c2` (vault 34/34, trusted path 25/25);
probe timings `326462cf`; D4 `c4946c8e`; D5 `60f03023`; D6a `7c3b277d`;
D6b `f5edb20c`; D7 `fcc9982e`; final `6a986dbc` (acpStdio 13/13, manifest
40/40, cyclesRoots 5/5, resourceAcpPackaging 11/11) and `c14cfd39` (vault
34/34, trusted path 25/25; execStdio's built-exec cases pass, and its
package-guard cold hook exceeds its unchanged 60 s on the VM, as round 1
recorded). kubuntu: `278bb366` (cyclesRoots, manifest, resourceAcpPackaging
56/56), `5f50f0ba` (runtimeChatGptPackage 2/2; execStdio stops at the
existing "Required Linux created-path helper is missing" refusal, as Ubuntu
shard 2 of the same run did, before any copy), `b2e36d0b` (manifest 40/40
with six shards). Logs: `temp/cifixw2/`.

Static: all five typechecks exit 0 on kubuntu (the host's unit typecheck
reports only `museCodeSdk142.test.ts`, because the shared `node_modules`
holds `@muse-code/sdk` 1.3.0 against the lock's 1.4.4). deadcode (two
existing hints), jscpd, check:l10n, check:host-api, check:reference,
check:roadmap, check:plan, cycles and the production build exit 0 on
kubuntu or the host; actionlint, changed-file ESLint and Prettier exit 0.

| Finding                                        | Commit      |
| ---------------------------------------------- | ----------- |
| `cycles` roots off the command line, line gate | `30a3dd3f5` |
| dpdm resolved where knip sees it               | `032d8a98b` |
| npm package ships the launcher's C#            | `b332d0648` |
| package fixtures and CI require it             | `f35be762b` |
| trusted-path probe through the CLR             | `203660e7d` |
| resolved-path expectations (8.3 TEMP)          | `309b1ec26` |
| vault ACL fixture through the CLR              | `a158e77c5` |
| six Windows unit shards (lead decision)        | `222c428ec` |
