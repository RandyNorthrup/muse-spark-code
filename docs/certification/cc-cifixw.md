# CC-CIFIXW — hosted CI run 41214393586, the failures only Windows had (2026-11-02)

Claude Code lane `CC-CIFIXW`, worktree `C:/Users/Randy/Coding/mx-cc-cifixw`, branch `cc/cifixw`, base
`810b320fc3` (the commit the run tested), on the owner's Windows 11 PC. Provider calls: **0**. Model attempts:
**0**. Muse requests: **0**. Nothing was pushed, rebased, stashed by hand, reset or tagged. The vault and
credential-store suites (`test/unit/vault/**`, `keyringParts`, `keystoreOwner`, `credentialLease`,
`providerHeadersStore`) were never run here. Scratch files stayed in the worktree's ignored `temp/`.

**How the hosted leg was reproduced.** Node 22.23.4 (a portable copy in `temp/`), started from PowerShell as
`build.yml` starts the Windows leg, with `TEMP` and `TMP` spelled through an 8.3 name
(`C:\Users\Randy\Coding\MXC7E2~1\temp\rt`, the hosted runner's is `C:\Users\RUNNER~1\AppData\Local\Temp`), an
empty `GIT_CONFIG_GLOBAL` (a runner has no git identity), `CI` and `GITHUB_ACTIONS` set, `--maxWorkers=4`. On the
untouched base this gave 137 failures in 23 of the 27 files it may run. Three things this PC cannot be: an
elevated account (it may not make a file symbolic link), the machine's built-in Administrator (RID 500, the
hosted `runneradmin`), and a slow fresh VM.

## 1. The causes, and which side was wrong

| #   | Cause                                                                                                                                                                                                                                                                                                                                                 | Wrong side | Files                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **Every Windows machine read as hardware.** `readHardwareInventory('win32')` answered "unknown" by design ("not qualified yet", M103 Design 5), and unknown refuses every Model API shell command (`permissions.ts`); `hasPositiveHardwareEvidence` also counted the unknown answer's `hasConnectedBoard: true`, so every Muse Code turn was refused. | product    | approvalModesFailurePaths, evalJudgeWiring, hookModelTurns, judgeFastTurnMuse, mspTurnGoldens, museCodeAutoResend, museCodeQuotaExhausted                               |
| B   | **Maker storage compared spellings.** `RuntimeMakerStorage.create` refused a folder whose spelling differs from its canonical form, and called that a link. An 8.3 name or another letter case is the same folder with no link.                                                                                                                       | product    | runtimeMakerAcp, runtimeMakerAttendance, runtimeMakerCommands, runtimeMakerHost, runtimeMakerTransport                                                                  |
| C   | **Windows PowerShell started with almost no environment.** Every case that started it so ran past its budget on the hosted runner, and the same work with the whole environment takes under a second there. The log shows this; why is inferred (section 2).                                                                                          | both       | makerLeaseCrashes, makerSerialSession (test's fixture); projectKinds (product's reader); connectorStdio (test's launch, and the product's guard); checkPresets (test's) |
| D   | **A short name survived the test's own resolve.** `realpathSync` (the JS walk) keeps an 8.3 name, and the runtime answers with the long one.                                                                                                                                                                                                          | test       | runtimePanelConversation, runtimePanelGitLease, runtimePanelSessions                                                                                                    |
| E   | The team merge fence's same spelling demand: plainly RLF-CIFIXA's fix.                                                                                                                                                                                                                                                                                | product    | teamMergePlan (section 4)                                                                                                                                               |
| F   | Individual causes, each in section 3.                                                                                                                                                                                                                                                                                                                 | mixed      | bestOfN, deviceResultStore, hardwareContextOwner, makerSerialAdapters, nodeOsMuseSetup, osImageBuild, credentialMigrationStore                                          |

## 2. Cause C: what was measured, and what was not settled

Settled since, in `cc-winfix2.md` section 2: M51 had measured it on the runner.

The hosted log separates the two shapes:

| Shape                                                                                          | Hosted run 41214393586                                                                               |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `makerLeaseDeps`: environment `{ PATH }`, a script of the suite's own with `Get-Acl`/`Set-Acl` | every fixture past 15 s (makerSerialSession 24 of 24, makerLease 28 of 31, makerLeaseCrashes 6 of 6) |
| `projectIoWindows`: environment `{ PSModulePath }`, `Add-Type`                                 | every call killed at its 10 s bound (26 of 28 cases at 10,03x ms)                                    |
| The connector e2e: the agent started with eight variables, its PowerShell child inherits them  | two agent starts took 48,147 ms (`refuses widening`, whose `spawnSync` shows the true time)          |
| `checkPresets`: environment `{ PATH, SystemRoot }`                                             | past 15 s                                                                                            |
| `secWinNativeIdentity`: the whole environment, `Add-Type` compiling and running C#             | 2 cases, 516 ms                                                                                      |
| `shellJobRetiredBuilds`: the whole environment, a real `csc` build and the helper's self-test  | 461 ms                                                                                               |
| `makerLeaseIdentity`: the product's `leaseIdentity` through `windowsPowerShell`                | 7 cases run, 2,343 ms                                                                                |
| `windowsPowerShellModules`: the rule's environment, real `Get-Acl`                             | 5 cases, 1,952 ms                                                                                    |

Measured on this PC, for what it explains:

- **Without `PATHEXT`, Windows PowerShell 5.1 does not start a bare program.** `python --version` with
  `{ PATH, SystemRoot }` answers `Cannot run a document in the middle of a pipeline` or `The term 'python' is not
recognized`; with `PATHEXT` added it answers `Python 3.14.10`. A name that resolves to nothing makes PowerShell
  search every module on its module path: 1,100 to 1,440 ms here against 117 to 153 ms for `exit 0`, on 94 modules
  with a cold analysis cache.
- **A cmdlet that has to autoload pays that search too, and a short process never saves it.** With a fresh analysis
  cache (or a fresh `LOCALAPPDATA` and `USERPROFILE`, the connector's shape): `Get-Acl` 636 to 809 ms, `ConvertTo-Json`
  307 to 361 ms, `Add-Type` 355 to 421 ms, against about 130 ms for `exit 0`. Six runs of `Get-Acl` against one fixed
  `PSModuleAnalysisCachePath` never wrote the file and never got faster.
- With a warm cache this PC shows no difference between a stripped and a whole environment. **So the stall itself
  does not reproduce here, and its cause is inferred, not measured.** The module search on a runner's larger module
  path would explain `checkPresets` (a name it cannot find) and `makerLeaseDeps` (no `PSModulePath`, so the machine's
  whole one). It does not explain `projectIoWindows`, whose module path was the smallest of all, and which variable a
  stripped start lacks on the hosted image is not settled. The fixes take the shape the same log proves fast, and
  remove the module search wherever the script can do without it. **Hosted CI on the next commit decides this cause**,
  and a red there is read before anything else changes.

## 3. Per file: cause, fix, proof

Base is the untouched `810b320fc3`; "here" is the hosted shape above. The final run of all of them together is in
section 6.

**Cause A, product.** This is the finding that matters most: M103 as integrated made the product unusable on
Windows, and only the hosted Windows leg said so. Design 5's line (`m103-g.md`: "Windows discovery currently
conservatively latches and refuses agent shells until independently qualified") was written before anything
integrated it. Two changes:

- `hasPositiveHardwareEvidence` no longer counts `hasConnectedBoard` when the inventory is unknown, which is what
  its own comment and `fcf12f06c4`'s message already said.
- **Windows reads its inventory** (`readWindowsSerialComm`, `windowsBoardTargets`): `reg.exe query` on
  `HKLM\HARDWARE\DEVICEMAP\SERIALCOMM`, System32's program by full path with only `SystemRoot` in its environment,
  about 15 ms a query, opening no port. The machine's own UART (`\Device\Serial<n>`) and Bluetooth's virtual ports
  (`\Device\BthModem<n>`) are no board. Any other driver's name is, because USB serial drivers name their devices
  freely and an unknown name must fail safe. A failed read or a row of another shape stays unknown and refuses, as
  a missing `/dev` does elsewhere. The guard reads the inventory several times a command, so the default reader on
  Windows keeps an answer for `MAKER_WINDOWS_INVENTORY_REFRESH_MS` (2 s). `test/fixtures/maker/windows-serialcomm.json`
  is this PC's real answer with its date and command.

The first change alone turned six of the seven suites green. evalJudgeWiring needed the second, because
`PermissionEngine` refuses a shell command outright on an unknown inventory. That refusal stands for a real failed
read, and `hardwareWorkspace.test.ts` still pins it. `hardwareContextOwner` gains the known-empty case, the
wrong-shape case, the failed-read case (mode kept, turn sent, commands still fail-safe) and two real-registry cases
on Windows.

Base here: all seven suites red with the CI's own messages (`only 0 turns accepted`, a posted `sendFailed` saying
`This device adapter cannot verify the approved target`, `expected 0 to be greater than 0` for evalJudgeWiring).
After: all green.

This was a product decision the brief left to this lane, and it is the one to read first. **What it trades:** before,
an opaque command on Windows could never reach a board unasked, because no command ran at all. Now it behaves as on
Linux and macOS: a USB serial port makes the workspace a hardware workspace and each shell command asks. Within the 2 s
refresh, a board plugged in just before a command is not yet seen.

What it does not do: mass-storage boards. A drive's label costs a process per letter, so `boardRoots` stays empty
on Windows; a CircuitPython board shows its serial port as well, and a bare `RPI-RP2` bootloader drive has no port
to show. A board swapped on the same port keeps its `connectionId` because Windows gives no generation. A USB board
has never been attached to this reader: `docs/real-life/unproven.md` names it.

**Cause B, product.** `create` now asks the question it means: `hasLinkOnPath` walks the spelled path with `lstat`
(a junction reads as a link), so a link at any level still refuses and an alias does not. `checkDirectory` is
unchanged; it compares the canonical path it stored. `runtimeMakerHost` gains `cannot keep authority behind a link,
however far up the path`. A `subst` letter, which the old spelling check refused, now passes: the canonical path
is what is stored and used. Base here: 43, 25, 18, 12 and 3 failures. After: green.

**makerSerialSession, makerLeaseCrashes (cause C, test).** `makerLeaseDeps` on Windows now uses the product's own
`leaseIdentity` through `windowsPowerShell`, and the shared `makePrivateFolder` (icacls) where its own script ran
`Get-Acl` and `Set-Acl`. The compiler and the helper get the whole environment without credentials, as
`nativeSerial.ts` gives them. Green here before and after, so **the hosted run is the proof**. It also carries
`makerLease`'s and `runtimeMakerStop`'s fixtures. The POSIX branches are unchanged.

**projectKinds (cause C, product; and a bug no hosted run reached).** The reader starts through `windowsPowerShell`;
its entry leaves the reviewed list in `windowsPowerShellModules.test.ts`, because it now obeys the rule. Separately,
`ConvertTo-Json -InputObject $null` writes nothing at all in 5.1, so a refused read (a folder named like a marker)
threw `Unexpected end of JSON input` instead of answering undefined: product wrong, base red here, green after. The
folder-link cases use junctions, which need no privilege, and the file-link case is `it.runIf(canLinkFiles())`, the
precedent `companionFontPack` had, now shared from `helpers/temporaryFolders.ts`. Each read still costs one PowerShell
start and one C# compile, about 430 ms here: named in section 7.

**connectorStdio (cause C, both).** The test's agent started with fewer variables than any client gives. It now
starts with `getDefaultEnvironment()`, what the official MCP SDK hands a server, then the run's own home. The storage
guard's two scripts already avoided `Get-Acl`; their JSON still autoloaded its module, on every start, in a profile
folder a client may own. They now use `JavaScriptSerializer` through the CLR: the same bytes, 271 to 297 ms against
452 to 719 ms in a fresh profile here. Green here before and after: **the hosted run is the proof.**

**checkPresets (cause C, test).** The case started `powershell.exe` with `{ PATH, SystemRoot }`, where it cannot find
`python`. It now uses the product's launch. Base here: `The term 'python' is not recognized`. After: green.

**runtimePanelConversation, runtimePanelGitLease, runtimePanelSessions (cause D, test).** `createPanelRun` uses
`realpathSync.native`. The product's long-name URIs were right. Base here: the CI's own diffs (`RUNNER%7E1` against
`runneradmin`, here `MXC7E2%7E1` against `mx-cc-cifixw`). After: green.

**bestOfN (test).** A runner has no git identity; Linux and macOS git make one from the host name, and Windows git
refuses the commit. The disposable repository sets its own, as `panelGitRepo` and others do. Base here with the empty
global config: `Author identity unknown`. After: green.

**deviceResultStore (test).** `ownerOnlyEvidence` matched the SDDL text against the user's SID, and SDDL spells RID
500 as `LA` (`O:LAD:PAI(A;OICI;FA;;;LA)`, the log's own text). It now compares SIDs from the descriptor. Decoding that
exact SDDL here gives owner and rule `S-1-5-21-<machine>-500`, protected, rights 2032127, inherit 3. This PC's account
is not RID 500: **the hosted run is the proof** of that branch.

**hardwareContextOwner (test).** "A directory stands in on Windows" was never true: a folder is walked, not read, so
the workspace scans clean and the expectation of `true` holds only for a FIFO. The case now says which is which.

**makerSerialAdapters (test).** It ran `#!/bin/sh` scripts, which Windows does not start, and its runner read the
start failure as exit 1, so `busy` read as `free`. The tiny programs are now Node scripts started by this Node, so the
case runs on every OS; a program that never started rejects. Green here.

**nodeOsMuseSetup (product).** `resolveMuseInstallDir` names a POSIX folder on a Linux image and joined it with this
OS's separator. It uses `path.posix`, as does the launcher path beside it.

**osImageBuild (test).** POSIX mode bits asserted on Windows, where Python reports 0o666. The check stays for POSIX,
with the file's own `os.name == 'posix'` precedent; the bytes check runs everywhere.

**credentialMigrationStore (test; read, never run here).** Its `beforeAll` hit the 30 s hook budget building the
helpers and starting the broker. Its two sibling suites on the same fixture carry `, 0` with the owner's words of
2026-10-16 ("no time limit of ours on this setup"), and this one did not. It now does. That is the existing rule
applied to the one suite missing it, no new bound. **Named for hosted CI.**

## 4. RLF-CIFIXA's fix, read and not forked

**teamMergePlan** is `confinedRelative`'s spelling demand, `5a76d3790` on `rec/rlf-cifixa`. Nothing was
cherry-picked. Proof: its `teamMerge.ts`, `teamWorkspaces.ts` and `lease.ts` written over this tree for one run, then
restored with `git checkout --`: teamMergePlan green (base: `The team merge has a linked root`), and `makerLease`'s
`distinguishes PID reuse` green too.

## 5. Drills

Each line broken on purpose, run in the hosted shape, restored byte-exact (the tool compared hashes), run again. Every red was exit 1 and every green exit 0. `P` is a product fix, `T` a test change that had to be seen to fail. The script stayed in `temp/`.

| Drill                                                              | Suite                                | Red                                 | Green                     |
| ------------------------------------------------------------------ | ------------------------------------ | ----------------------------------- | ------------------------- |
| P1: unknown inventory counted as positive evidence                 | hardwareContextOwner                 | 1 failed, 12 passed (13)            | 13 passed (13)            |
| P2a: Windows inventory unknown again (the state CI ran)            | evalJudgeWiring hardwareContextOwner | 3 failed, 13 passed (16)            | 16 passed (16)            |
| P2b: Bluetooth virtual ports counted as boards                     | hardwareContextOwner                 | 1 failed, 12 passed (13)            | 13 passed (13)            |
| P3a: storage compares spelling again (the state CI ran)            | runtimeMakerHost                     | 43 failed, 5 passed, 1 skipped (49) | 48 passed, 1 skipped (49) |
| P3b: storage stops looking for links                               | runtimeMakerHost                     | 1 failed, 47 passed, 1 skipped (49) | 48 passed, 1 skipped (49) |
| P4: a refused read writes no JSON                                  | projectKinds                         | 2 failed, 26 passed, 1 skipped (29) | 28 passed, 1 skipped (29) |
| P5: the POSIX install folder joined with this OS separator         | nodeOsMuseSetup                      | 1 failed, 2 passed, 1 skipped (4)   | 3 passed, 1 skipped (4)   |
| P6: the guard reads its payload wrongly through the CLR serializer | connectorStorageGuard                | 3 failed, 5 passed (8)              | 8 passed (8)              |
| T1: port use reads busy as free                                    | makerSerialAdapters                  | 1 failed, 2 passed (3)              | 3 passed (3)              |
| T2: panel run keeps the 8.3 spelling (the state CI ran)            | runtimePanelConversation             | 1 failed, 1 passed (2)              | 2 passed (2)              |

Cause C has no drill here because the stall does not reproduce on this PC (section 2).

## 6. Gates

Node 22.23.4 on the committed code, each with its exit code:

| Gate                                                                                                        | Exit   |
| ----------------------------------------------------------------------------------------------------------- | ------ |
| `npm run format:check`                                                                                      | 0      |
| `npm run lint` (JS over `.`, `test/unit`, the other tests; CSS; PSScriptAnalyzer)                           | 0      |
| `npm run typecheck`                                                                                         | 0      |
| `npm run check:catches`, `check:plan`, `check:l10n`, `check:reference`, `check:mhp`, `check:roadmap`        | 0 each |
| `npm run deadcode`, `cycles`, `duplication`                                                                 | 0 each |
| `npm run check:host-api`, after `--write` moved `node:child_process` from 46 to 47 for `hardwareContext.ts` | 0      |
| `npm run build` (bundle budgets and split checks inside; `dist/hardwareGuard.js` 21.2 KiB of its 25)        | 0      |
| **The failing set together** (the 27 runnable files, hosted shape, `--maxWorkers=4`)                        | **1**  |

The failing set's one red is expected: **26 of 27 files green, 495 passed, 6 skipped, 1 failed**, and the failure is
teamMergePlan, whose fix is on `rec/rlf-cifixa` (section 4), not on this branch. The six skipped: two file-link
cases need a privilege this PC lacks, and the other four are the suites' existing named skips. Base was 137 failed.

Not run: the whole unit suite, the packed product's real-life run (it spends money, and the brief makes no real
conversation), and hosted CI. One real-bundle use: the built `dist/hardwareGuard.js` on this PC answers
`isInventoryKnown: true, hasConnectedBoard: false, targets: [], isHardwareWorkspace: false`. Base: exit 1 on 23 files.

## 7. Open, named for the lead

**Only hosted CI can decide these.** Each is green or unrunnable here, and red there:

- Cause C's suites: makerSerialSession, makerLeaseCrashes, projectKinds, connectorStdio. If one stays red there, the
  stall has another cause than section 2's, and a measured table of PowerShell starts on the runner is the next step.
- deviceResultStore (the RID 500 reading), and credentialMigrationStore (a vault suite, never run here).

**Windows legs of the files outside this lane's scope, which RLF-CIFIXA's fixes do not reach.** Read, not touched:

- `connectorRemoteIssuer`, `keeps the issuer when a TLS request uses an absolute-form request line`: it asserts POSIX
  mode bits (`expected 438 to be 384`) on Windows. The fix is a platform check beside the assertion.
- `connectorStorageGuard`, `refuses storage planted the legacy way`: `expected 'owner' to be 'access'` on the hosted
  account only. The guard does refuse; which reason comes first depends on who owns a new file under an elevated
  account (inferred, this PC is not elevated). RLF-CIFIXA's record says this leg needs a Windows lane's eyes.
- `runtimeMakerStop`, `RVM103W6 P1: stop-machine --all fails for an acquired owner…`: **red on every OS, and not fixed
  by RLF-CIFIXA's lease change**, whose record credits it. Reproduced here with that `lease.ts` applied: `Stop failed …:
Bench printer, Devices and machines`. `runRuntimeMaker` hard-codes `lan: runtimeMakerLan`, so the case's simulator on
  127.0.0.1 is refused under the real LAN rule, and the `lan` the case passes is dropped. `acpRuntime.ts` and
  `service.ts` already take `deps.lan ?? runtimeMakerLan`; `entry.ts` is the one that does not.

**Named gaps this lane leaves.**

- Windows hardware inventory: no USB board attached yet, mass-storage boards not read, a swapped board keeps its
  `connectionId`, and a machine whose serial driver has an unlisted name other than a board's reads as hardware. All in
  section 3 and `docs/real-life/unproven.md`. A corporate policy that blocks `reg.exe` reads as unknown, which refuses
  every Model API shell command there.
- `projectIo.ts`'s `volumeLabel` still starts PowerShell with `env: {}`, the shape of cause C. It stands on the reviewed
  list, nothing failed on it, and its 2 s bound answers undefined. If cause C proves to be the environment, it belongs
  with the rest.
- `windowsProjectIo` still starts one PowerShell and one C# compile per read, about 430 ms here and more than that on
  a laptop. The compiled-helper route the job helpers took would remove both.

**Only on this PC, by privilege.** With no file-link privilege here, `makerLease`'s `holds an unknown symlink claim`
fails with `EPERM` (the file is outside this lane; the hosted account is elevated). The suites this lane touched skip
their file-link cases here by `canLinkFiles()`, and run them on the hosted account.
