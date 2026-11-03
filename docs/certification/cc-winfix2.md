# CC-WINFIX2 — hosted CI run 41214393586, the Windows failures left after two lanes (2026-11-02)

Claude Code lane `CC-WINFIX2`, worktree `C:/Users/Randy/Coding/mx-cc-winfix2`, branch `cc/winfix2`, base `31eed0a374`
(`cc/cifixw`) joined with `rec/rlf-cifixa`, on the owner's Windows 11 PC. Provider calls: **0**. Model attempts: **0**.
Muse requests: **0**. Nothing was pushed, rebased, stashed, reset or tagged. The vault and credential-store suites
(`test/unit/vault/**`, `keyringParts`, `keystoreOwner`, `credentialLease`, `providerHeadersStore`) were never run here.
Scratch files stayed in the worktree's ignored `temp/`.

"Hosted shape" is CC-CIFIXW's: Node 22.23.4, started from PowerShell, `TEMP` spelled through an 8.3 name, an empty
`GIT_CONFIG_GLOBAL`, `CI` and `GITHUB_ACTIONS` set, `--maxWorkers=4`.

## 1. The join

Merge `41af99f69e`: only `CHANGELOG.md` conflicted, and both sides' entries stay. On it, in the hosted shape,
CC-CIFIXW's whole Windows-only set: **27 files, 496 passed, 6 skipped, exit 0**, `teamMergePlan` among them (its one red
before the join).

## 2. Cause C is settled, and now reproduces here

CC-CIFIXW's record calls the PowerShell stall inferred and asks which variable a stripped start lacks. **This repository
had already measured it on the runner**, in `docs/certification/m51.md`: run 36954845386 took 22,295 to 28,901 ms for
statements naming a cmdlet in a narrow environment, 214 to 233 ms with only `PSModuleAnalysisCachePath` added, and
20 to 22 ms for .NET-only statements without it.

- **The variable.** `actions/runner-images`, `images/windows/scripts/build/Configure-PowerShell.ps1`: `Warmup
PSModuleAnalysisCachePath (speedup first powershell invocation by 20s)`, set machine-wide to
  `C:\PSModuleAnalysisCachePath\ModuleAnalysisCache`.
- **The weight.** `images/windows/toolsets/toolset-2025.json` installs `AWSPowershell`, `Microsoft.Graph`, `SqlServer`
  and more into Windows PowerShell's Program Files folder. The run's log names the image: Windows Server 2025,
  `windows-2025-vs2026`, release 20261021.278.
- **Why every start pays.** A cmdlet not yet loaded is found by module auto-loading, which analyses every module on the
  path unless a cache is reached, and a short process exits before it saves what it learned. Here one process that slept
  9 s after its search saved nothing, and two others saved within 12 s.
- **The riddle CC-CIFIXW left.** `projectIoWindows`' module path looked the smallest of all, yet it stalled. 5.1 adds Program
  Files' folder to any path it is given:

| Start                                                      | The module path 5.1 ends up with                        |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| `{}`, `{ PATH }`                                           | Documents, `C:\Program Files\…\Modules`, `$PSHOME`      |
| `{ PSModulePath: $PSHOME\Modules }` (the base's reader)    | `C:\Program Files\WindowsPowerShell\Modules`, `$PSHOME` |
| The same, with `ProgramFiles` aimed elsewhere in the block | The same: Windows resets `ProgramFiles` at each start   |

**The reproduction.** A module folder of that weight, in `temp/`: 200 script modules, 108 MB of our own bytes, few
commands, so a warm cache stays small (64,850 bytes) as the hosted one does. One start of Windows PowerShell 5.1 per cell:

| Script                                           | Module path only, no cache | With a warm `PSModuleAnalysisCachePath` |
| ------------------------------------------------ | -------------------------- | --------------------------------------- |
| `exit 0`                                         | 173 ms                     | 150 to 158 ms                           |
| `volumeLabel`'s script                           | 178 ms                     | 155 to 172 ms                           |
| The storage guard's read (CLR, `ForEach-Object`) | 216 ms                     | 193 to 230 ms                           |
| `Add-Type`                                       | **18,085 ms**              | 235 to 264 ms                           |
| `Get-Acl`                                        | **16,318 ms**              | 215 to 242 ms                           |
| A name that resolves to nothing                  | **16,585 ms**              | 793 to 879 ms                           |

**Real suites under it.** Since `ProgramFiles` cannot be aimed from outside, each simulation run pointed
`windowsPowerShellModulePath` at the folder with a temporary edit, restored byte-exact by hash and never committed. The
first simulation run, before that was found, made nothing heavy and measured nothing; it is not counted below.

| State                                                                    | Result                                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| The reader with `Add-Type`, no cache reached                             | 2 of 2 cases killed at the 10 s bound, exit 1: what the hosted log shows                                      |
| The reader through the CLR, the same shape                               | 30 passed, 1 skipped, exit 0; 19.8 s for the file                                                             |
| The guard with `ConvertTo-Json` again, the agent carrying no variable    | **6 of 7 red, `refuses widening` 41,937 ms** against the hosted log's 48,147 ms, exit 1 (drill C1)            |
| Cause C's suites, warm variable in the parent, before section 4's change | 7 files, 121 passed, 1 skipped, exit 0; `refuses widening` 2,218 ms; the same durations as without the weight |
| The runtime maker and hardware suites, their narrow fixture env weighty  | 12 files, 215 passed, 2 skipped, no stall; the one red was the file-link `EPERM` of section 6, fixed since    |

**What this cannot show.** A start with no module path at all (`{}`, `{ PATH }`) reads the real Program Files, so those
shapes are not heavy here. By reading, none of these suites has a cmdlet left under such a start. The log never prints
whether the test process holds the variable; M51's run and the fast whole-environment rows are the evidence.

### The six files CC-CIFIXW left to hosted CI

| File                                  | Now                                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| makerSerialSession, makerLeaseCrashes | Settled: the old fixture's `Get-Acl` and `Set-Acl` under `{ PATH }`. CC-CIFIXW's fixture has no cmdlet. Green under the weight.                                                                                                                                                                               |
| projectKinds                          | Settled, and no longer leaning on the variable: section 4.                                                                                                                                                                                                                                                    |
| connectorStdio                        | Settled: the guard's JSON cmdlets at every agent start. **CC-CIFIXW's two changes were not equal.** `getDefaultEnvironment()` carries no analysis variable and cures nothing; the CLR guard is the fix (drill C1). The suite's comment said otherwise, and is corrected.                                      |
| deviceResultStore                     | Not cause C: whole environment, CLR only, and the red was the SDDL spelling. Read again, nothing more to settle. Its RID 500 branch needs the hosted account.                                                                                                                                                 |
| credentialMigrationStore              | Not cause C, by reading (never run here): the broker's guard script is CLR only, the helpers compile through `csc` directly, and no cmdlet is on that path. The 30 s went to four bundles, the helper builds and a cold broker; its siblings already carry no limit. See section 8 on what no limit can hide. |

## 3. The three reds CC-CIFIXW named

**`runtimeMakerStop` RVM103W6 (product).** Verified before changing: `runRuntimeMaker` hard-coded `runtimeMakerLan`, and the
`lan` the case spread in was dropped without a type error (a spread gets no excess-property check). So the simulator on
127.0.0.1 was refused and the failure named `Bench printer, Devices and machines`. Red here, and on every OS of the run,
with the same words. `RuntimeMakerEntryDeps` now takes `lan`, used as `deps.lan ?? runtimeMakerLan` on both of the entry's
paths. `main.ts` passes none, so **a person's command keeps the real rule**, and a new case pins that: no request leaves
for a loopback machine. `names a failed machine` now really reaches the machine's 500.

**`connectorRemoteIssuer` (test).** `info.mode & 0o777` says nothing on Windows: Node reports 0o666 for any writable file,
so the check could never tell a private signing key from a public one. The property is that the key is this account's
alone. It now uses the storage guard suite's independent `Get-Acl` read, moved to `helpers/connectorPrivacy.ts`: protection
on, owned by this account, no other grant. On POSIX the read is also stricter than before (owner and link count). Drill
T1: the store stops securing the file, and the suite goes red naming that file.

**`connectorStorageGuard` `owner` against `access` (test; the guard was right).** From the code: `windowsLeafVerdict` has one
road to `owner`, `scanned.owner !== me`, asked before the grants and first of the root. So on the hosted account a plain
`mkdir` under a plain store is not owned by the account. Its neighbour `secures what the store creates` passes in the same
log, because `secure` runs `SetOwner($me)`. What the account changes: `runneradmin` is RID 500 (the log's `O:LA`), and new
objects under an administrator's full token belong to the Administrators group; UAC's filtered token is what makes the user
their owner. This PC's account runs filtered (token owner equal to user, read here). `makerTemp.ts` had noted the same
effect since `1e57b1f84a`. The case's expectation was this PC's.

The case now reads the plant's real owner and expects the reason that follows, and each reason gets a case that holds on
every account: `refuses a legacy root this account owns` (`access`, after `icacls /setowner`) and `refuses a tree another
account owns` (`owner`, on the system's own `drivers\etc`, read only).

**A correction.** `ac4c79b573`'s message and first comments called that owner a Windows Server default. It is not:
Microsoft's KB947721 says the policy is ignored since Vista, and that UAC is what ensures the user as owner. The comments
were corrected in `bfb8d5810e`. **Not measured:** which SID owns such an object on the hosted account; the log says only
that it is not the account, and nothing here depends on which.

## 4. The project reader names no cmdlet (product)

CC-CIFIXW's reader kept `Add-Type` and the JSON cmdlets and started through the whole environment, which carries the
variable on the runner. It still died wherever no cache is reached: a process started narrow, or a person with large
modules and no warm cache, whose read then runs past the 10 s bound. That is M51's rule again, so the reader goes through
`CSharpCodeProvider` and `JavaScriptSerializer` alone: **389 to 467 ms under the weight with no cache**, against a kill at
10 s. `JavaScriptSerializer` writes `null` for a refused read, so CC-CIFIXW's special case for it is gone.
`WINDOWS_JSON_ASSEMBLY` moved to `constants.ts`, shared with the guard.

Each no-cmdlet script now has M51's proof, with no clock and no weight needed: it runs with
`$PSModuleAutoLoadingPreference = 'None'`, where a cmdlet is simply not recognized (`helpers/noModuleAutoLoading.ts`). The
reader, the drive label and both guard scripts have it.

**What it does not change.** Each read still costs one PowerShell start and one C# compile.

## 5. `volumeLabel`: the same fault does not apply, so its environment stays

The fault is the cmdlet, not the empty environment. Its script is one .NET call: 178 ms under the weight, the same as
`exit 0`, against 18 s for `Add-Type`. The real `nodeProjectDetectIo.volumeLabel` with `env: {}` answers `"OS"` in 202 to
216 ms here. Moving it to the launch would change nothing it suffers from, and it keeps nothing inherited. Its script is now
a function, with the proof above; the reviewed list's reason in `windowsPowerShellModules.test.ts` names that proof.

## 6. Two more, found on the way

- **The duplication gate was red on the join.** `e320788590` copied the live samplers' memory fixture into both relocation
  suites, and this lane's new Stop case repeated a command. A live-sampler suite now starts from one call
  (`liveSamplerSuite`), and the Stop cases share `failedPrinterStop`. No assertion moved.
- **`makerLease`'s file-link case** failed here with `EPERM`, as CC-CIFIXW named. It now runs where `canLinkFiles()` says the
  account may, as the other file-link cases do. The hosted account has the privilege and keeps it.

## 7. Drills

Each line broken on purpose, run, restored byte-exact (the tool compared hashes), run again. Every red was exit 1 and every
green exit 0. `P` is a product fix, `T` a test that had to be seen to fail, `C` a drill under the weight. A first R1 went
red for the wrong reason (it removed the JSON assembly's load) and was redone.

| Drill                                                    | Suite                 | Red                                 | Green                     |
| -------------------------------------------------------- | --------------------- | ----------------------------------- | ------------------------- |
| P1: the entry drops `lan` again (the state CI ran)       | runtimeMakerStop      | 2 failed, 11 passed, 1 skipped (14) | 13 passed, 1 skipped (14) |
| P1b: a person's command gets an open LAN rule            | runtimeMakerStop      | 1 failed, 12 passed, 1 skipped (14) | 13 passed, 1 skipped (14) |
| T1: the store stops securing the signing key             | connectorRemoteIssuer | 1 failed, 2 passed (3)              | 3 passed (3)              |
| T2: the guard stops asking the owner                     | connectorStorageGuard | 1 failed, 9 passed (10)             | 10 passed (10)            |
| T3: the guard accepts inherited grants                   | connectorStorageGuard | 4 failed, 6 passed (10)             | 10 passed (10)            |
| C1: the guard's JSON is a cmdlet again, under the weight | connectorStdio        | 6 failed, 1 passed (7)              | 7 passed (7)              |
| R1: the reader names a cmdlet                            | projectKinds          | 1 failed, 29 passed, 1 skipped (31) | 30 passed, 1 skipped (31) |
| R2: the label names a cmdlet                             | projectKinds          | 1 failed, 29 passed, 1 skipped (31) | 30 passed, 1 skipped (31) |
| R3: a refused read writes no JSON                        | projectKinds          | 2 failed, 28 passed, 1 skipped (31) | 30 passed, 1 skipped (31) |
| G1: the guard names a cmdlet                             | connectorStorageGuard | 1 failed, 10 passed (11)            | 11 passed (11)            |

## 8. Gates

Node 22.23.4, on `81e8820e25` (this record's commit adds only documents):

| Gate                                                                                                 | Exit   |
| ---------------------------------------------------------------------------------------------------- | ------ |
| `npm run format:check`                                                                               | 0      |
| `npm run lint`                                                                                       | 0      |
| `npm run typecheck`                                                                                  | 0      |
| `npm run check:catches`, `check:plan`, `check:l10n`, `check:reference`, `check:mhp`, `check:roadmap` | 0 each |
| `npm run deadcode`, `cycles`, `duplication`                                                          | 0 each |
| `npm run check:host-api`                                                                             | 0      |
| `npm run build`                                                                                      | 0      |
| **Every Windows failure of the run this PC may run** (39 files, hosted shape)                        | **0**  |

That last row: **39 files, 672 passed, 9 skipped.** It includes what RLF-CIFIXA fixed for Windows too (`teamEnginePorts`,
`teamLandingKilled`, `teamLandingPause`, `acpServeHandshake`, `providerSpend`, `nodeImageArchive`, `devicesPhase2Harness`). The
skips: `osImageBuild` 3 and `nodeImageArchive` 2 (existing named skips), `runtimeMakerStop` 1 (POSIX only), `nodeOsMuseSetup` 1, and
one file-link case each in `projectKinds` and `runtimeMakerHost`, with `makerLease`'s left out of its list here.

Not run: the whole unit suite, the packed product's real-life run (it spends money, and the brief makes no provider request)
and hosted CI.

## 9. Open, named for the lead

**Only hosted CI can decide these.** Each is green, or never run, here:

- The hosted account's own legs: `connectorStorageGuard`'s `owner` branch of the legacy case, and `deviceResultStore`'s RID 500
  reading.
- `credentialMigrationStore` (a vault suite, never run here).
- **`vaultStoreScope`'s Windows case is on nobody's list.** It timed out at its 180 s on shard 16, and RLF-CIFIXA's open item
  names only its macOS leg. Read, never run: no cmdlet is on the broker's path, so it is not cause C, and its fixture is
  `startWindowsBrokerFixture`, the same one `credentialMigrationStore` timed out in. **Not settled.**

**A risk in that fixture.** `startWindowsBrokerFixture` retries `warm.snapshot()` with no end, and the hooks around it now have
no limit. A broker that never answers holds its shard until the job's limit instead of failing a case. The sibling suites
pass on it, so this is a risk and not a seen failure, and the owner's word of 2026-10-16 stands, so this lane changed nothing.

**Cmdlets left in product scripts.** No suite here stalled on these, but a start through a narrow parent, on a machine with
large modules and no cache reached, pays for each: `runtime/tokenFile.ts` (`ConvertFrom-Json`), `core/maker/serial/listPorts.ts`
(`Get-CimInstance`, `ConvertTo-Json`), `core/judge/hardware/probes.ts`, `core/resources/sampler/optionalProbes.ts`,
`host/media/recordingLatest.ts`, `runtime/schedules/nativeBackground.ts`. Left as they are.

**Carried over from CC-CIFIXW, unchanged:** the Windows hardware inventory's gaps (its section 7), and a PowerShell start and a
compile per project read.
