# CC-INT11FIX3 — both rig lanes in, the created-registry race, no real Muse by accident

Lane `CC-INT11FIX3`, branch `cc/int11fix3` from `cc/int11fix2`. Nothing pushed. No Muse request, no paid call, no real
`muse` started, no vault or credential-store file imported here, no budget or timeout raised. Every run names its files
through `temp/vt2.ps1`, which refuses a forbidden name before vitest starts and cannot find the real CLI.

## 1. The two rig lanes

`refs/rigs/macmini/rec/rlf-cimac` is `f2be4ed92`, `refs/rigs/linuxlt/rec/rlf-cilin` is `0caae124a`. Their records came
with them.

| Fixed by more than one lane | Kept                                                                                         | Why                                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| resvg reading system fonts  | **RLF-CIMAC's** `scripts/lib/resvgFonts.mjs`, used by both build scripts and both art suites | Stronger: one constant, and it records the second reason, that a machine's own fonts must not reach the pixels. Mine, the same option written at each site, went. |
| `nodeInstall`'s fixture     | **RLF-CILIN's** line                                                                         | The two lines were the same; git kept both. Theirs stays, so each file gets one refusal case. Their record names 61ba38756, my own regression.                    |
| `dist/uiTextSettings.js`    | **Mine** in `deploy/` (61ba38756)                                                            | The product fix. Neither lane touched `deploy/`; RLF-CILIN only made the fixture follow it.                                                                       |

Budgets: `dist/resourceGovernor.js` is **124.8 of 125 KiB** after RLF-CIMAC's seam (124.6) and item 2's fix. No budget
moved, and it has about 0.2 KiB of room: the next change there needs a move.

`test/unit/vault/feederAncestry.test.ts` and `test/unit/vault/vaultPeerRun.test.ts` came in through these merges and were
**not run or imported here**, by rule. Their green is on the rigs' records and on hosted CI.

## 2. `createdRegistryRace`: a product fault

**My reading agrees with yours on the cause, and differs on one point of the fix, so I say it first.** `checkManifest`
compares the file it sampled with the file it opened. A difference is another process's publish between the two, and
`readLiveForSave` reported it as `unsafe`. You asked for merging and publishing again like `contended`. I put the retry
one level lower, in `checkManifest` itself: nothing has been read at that point, so sampling again and then merging is
the same as a new attempt, and `open` and the sweep read the same way and were exposed to the same race: `open` hands
the error to whoever opens the registry. After `CREATED_REGISTRY_SAVE_ATTEMPTS` (5, client-go's `DefaultRetry`, already recorded
as the norm for this file), a save says `contended`.

A manifest that fails its checks (link, wrong owner, wrong mode, not a file) is refused at once and never retried, and a
read only returns from a file that passed every check and is the one sampled. So a persistent attacker gains nothing but
a `contended`.

The race itself can only be hit by chance, so `createdRegistryRace` forces it: two real registries on one manifest, the
real native publish, and a new `sampleManifest` parameter (defaulting to the real `lstatIdentity`) that a suite wraps to
make a real publish land between the sample and the open.

| Drill | Break                                        | Red                                                                                               |
| ----- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| R1    | a changed identity throws at once, as before | exit 1, 2 of 4: the lost race fails, and `expected 'unsafe' to be 'contended'`                    |
| R2    | one read more than the bound                 | exit 1: `expected 6 to be 5`                                                                      |
| R3    | every read fault counts as a lost race       | exit 1: `expected 'contended' to be 'unsafe'`, in the new case and in `createdRegistrySaveErrors` |

All restored byte-exact. The original two-process case passes here too, but it was intermittent on Linux, so its green
here proves little; the forced cases are the proof, and the next hosted Linux log should show it stay green. CHANGELOG
has a line: a person could read that failure when two windows started together.

**Not settled:** RLF-CILIN saw this on Linux. On Windows, a publish could also surface at `open` as `EPERM` or `EBUSY`,
which still reads as `unsafe`. No log shows it, so I did not guess at it.

## 3. A real Muse Code only when a run asks

`MUSE_TEST_REAL_CLI=1` (`test/unit/helpers/realMuse.ts`, in the README's list). Without it every suite's way to a real
CLI answers nothing, whatever the machine holds:

- `museCommand()` in `acpRecoverRig`: `teamProcessWorkers` (RLF-CILIN's two tests, and the rest of its Muse Code cases),
  `acpBackendRecover`, `acpBackendRecoverAgent`.
- `resolveInstalledMuse()`: `acpShutdown`, `museEmptyCatalogue`, whose skip titles now name the variable.
- `museStartFault`'s own lookup.
- `nodeOsSetupServer`'s live install and `nodeOsMuseSetup`'s, which run Meta's installer. The variable is checked first,
  so they do not probe the network either.

**The hosted test job names the variable**, so nothing it ran before is lost: a runner holds nobody's Muse, and RLF-CILIN
needs the next hosted log to show `installs Muse Code from Meta` passing.

`test/unit/realMuseGate.test.ts` plants an empty file where the product's lookup finds a CLI, and never starts it.

| Drill | Break                                      | Red                                                                          |
| ----- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| G1    | `museCommand()` finds one unasked          | exit 1, 4 of 5: `expected 'C:\Users\…' to be undefined`                      |
| G2    | `resolveInstalledMuse()` finds one unasked | exit 1, 4 of 5: `expected { Object (command) } to deeply equal { missing… }` |

**Limit:** the two `nodeOs` gates sit behind `process.platform !== 'win32'`, so no drill of them can go red on this PC.
The next hosted log shows them running with the variable, and a Linux or macOS run without it shows them skipped.

Also: `teamProcessWorkers`' `beforeAll` used a directory symlink, which an ordinary Windows account may not make
(`EPERM`), so the whole file failed here. It is a junction now. Its packed-agent cases are skipped on Windows, so no
agent started on this PC. Its real behaviour on Linux and macOS is hosted's.

## Seen here and not a fault of these changes

`museEmptyCatalogue`'s four panel cases fail on this PC with a second notice, `Muse Code's Windows sandbox cannot reliably
run commands in a workspace under your user profile`. This worktree and its TEMP are under `C:\Users\Randy`. It is not in
the hosted run's Windows failures, so I read it as this PC's shape (inferred) and left it out of the final list.

## 4. Gates

On `8fd4bc9b0`, one after another, Node 22.23.4. Every exit is 0.

| Gate                                                                                                 | Exit |
| ---------------------------------------------------------------------------------------------------- | ---- |
| `format:check`, `lint`, `typecheck`                                                                  | 0    |
| `check:badges`, `check:tokens`, `check:art`, `check:l10n`, `check:reference`                         | 0    |
| `check:host-api`, `check:mhp`, `check:plan`, `check:roadmap`, `check:editor-matrix`, `check:catches` | 0    |
| `check:usable-reply`, `check:wrap-up-request`, `check:no-output-cap`, `check:no-round-cap`           | 0    |
| `check:workflow-scripts`, `deadcode`, `cycles`, `duplication`, `build`, `security:audit`             | 0    |

The merged and touched suites on that head, files named: 27 files, 226 passed, 89 skipped by platform or by the new
variable, 0 failed. They are `createdRegistryRace`, `createdRegistrySaveErrors`, `createdRegistryReclaim`,
`createdRegistrySpaces`, `createdRegistryQuarantineResume`, `realMuseGate`, `teamProcessWorkers`, `nodeOsSetupServer`,
`nodeOsMuseSetup`, `acpShutdown`, `acpBackendRecover`, `acpBackendRecoverAgent`, `museStartFault`, `nodeInstall`,
`desktop/artBoot`, `desktop/artCursors`, `desktop/artIcons`, `manifest`, `playbookGovernor`, `desktop/panelSessions`,
`governedTeamSlotsPoll`, `teamCheckSlotsGoverned`, `teamWorkerChecks`, `macosRecorderDeps`, `nativeHelper`,
`teamWorkerCreateBundle`, `desktop/harnessDbus`. The keyring refusal never fired (0 lines). The whole unit suite did not
run here.

**Only hosted CI decides:** the whole suite on three systems; the two rig lanes' fixes on their own systems (`teamWorkerChecks`,
`macosRecorderDeps` and `desktop/harnessDbus` are all skipped on Windows); the `nodeOs` gates; the race on Linux. RLF-CIMAC
leaves `makerSerial` unsolved with no log to read, and asks the next hosted log for socat's exit and stderr.
