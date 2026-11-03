# CC-INT11FIX — hosted run 41619068707 on merge round 11's head (2026-11-03)

Claude Code lane `CC-INT11FIX`, worktree `C:/Users/Randy/Coding/mx-cc-winfix3`, branch `cc/int11fix` at `298f078c77` (`cc/int11`, batch A), on the owner's Windows 11 PC. Provider calls: **0**. Model attempts: **0**. Muse requests: **0**. Nothing was pushed, rebased, stashed, reset or tagged. "Hosted shape" is as in `cc-winfix3.md`, and that shape's empty global git config is what reproduces "Author identity unknown" here.

- **`npm ci`:** the lockfile moved. `node_modules` and `dist` here are real folders, not junctions, so it ran. Exit 0.
- **No vault or credential-store suite, no broker, no keyring.** Two suites start the real agent, which can reach the OS credential store: `runtimePanelCompanion` and `acpTeamServe`. Here each ran only with a scratch preload that refuses any load of `@napi-rs/keyring`, added to the test for that run and restored byte-exact, so hosted CI runs them without it. `acpTeamServe` as it stood would have read this PC's real data folder (section 1), so it never ran here before its fix, and its red drill points at another scratch folder.
- **Linux runs:** the owner's WSL distro ran this worktree's Linux Node for one measurement, with its scratch in `/tmp`. It has stopped again.

## 1. Most of it was merge interaction

Two lanes, each green alone, met at this head. The static gates stopped at `check:usable-reply`, so everything after it had never run on hosted CI: here all of it exits 0 (section 6).

**Product faults, fixed in the product:**

- **A folder reached through a Windows short name read as outside itself** (`src/core/fs/confine.ts`). See `panelSessions` below. It has a CHANGELOG line.
- **The Model-API-only refusal said `--team, --team`** (`execArgs.ts`). Two lanes added the name, one at each end of the list. Never released, so no CHANGELOG line.
- **The activation bundle was over its D6 budget** (section 2).

**Reds and causes:**

| Red                                                | Where           | Cause                                                                                                                                                   | Shown or inferred                                                                  | Fixed in      |
| -------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------- |
| `check:usable-reply`, `toolRoundsUsableReplyGuard` | all             | `acpteam-reviewed`'s `showCard` reads a team card's own status, with no allow-list entry. Same display gate as `showTeamCard`, no turn and no reply     | Shown                                                                              | allow-list    |
| `modelsActivationBudget`                           | all             | Four ACP-only methods on the activation-carried `TeamHostBinding`                                                                                       | Shown, measured commit by commit                                                   | product       |
| `teamChunkPackaging`                               | all             | `f0afff4e48` ships `teamMcp.js` in the ACP package, which only `dist/acpTeam.js` reaches, and the suite built no such entry                             | Shown                                                                              | test          |
| `judgeP2Delivery`                                  | all             | **Not downstream of the activation bundle.** The size gate's budgets name `dist/desktop` since M111, and the suite's shared build ran `build.mjs` alone | Shown: 7 `MISS dist/desktop/...` here, exit 0 after `build-desktop`                | test setup    |
| `execTeamFlags`                                    | all             | The duplicate above                                                                                                                                     | Shown                                                                              | product       |
| `runtimePanelCompanion`, zod                       | all             | MHP 1.6 paints a `theme` frame before any state replay, and the suite parsed every frame as a webview message                                           | Shown: the frame is `theme`                                                        | test          |
| `runtimePanelCompanion`, `exits 0 on SIGTERM`      | windows         | Windows has no SIGTERM: Node ends the child, and there is no exit code                                                                                  | Shown by the words `expected null`                                                 | test          |
| `crashHook`, 3 cases                               | windows         | An ESM import of a bare `C:\` path fails before the hook installs, so the child exits 1 with no record: the expected exit, for the wrong reason         | Shown by drill D10                                                                 | test          |
| `crashHook`, day file                              | ubuntu, macos   | The suite's root was group-readable, and the store reads no such root                                                                                   | Shown under Linux: mode 755, 0 records and 31 unreadable files; mode 700, 1 record | test          |
| `panelSessions`, `shell`                           | windows         | Enter is `\r`. `cmd.exe` under ConPTY takes `\n` as more of the line, so nothing ran and no exit came                                                   | Shown by D9                                                                        | test          |
| `panelSessions`, agent session                     | windows         | A closed session reports no exit by design, and the case closed the agent before its exit arrived                                                       | Shown by D9b                                                                       | test          |
| `panelSessions`, `EBUSY`                           | windows         | A killed shell holds its folder for a moment, and the removal did not retry. Follows from the above                                                     | Read                                                                               | test          |
| `panelSessions`, `unknown sessions`                | windows         | **The product fault above**, shown by the hosted runner's `RUNNER~1`                                                                                    | Shown by D6                                                                        | **product**   |
| `panelSessions`, session list                      | ubuntu          | The person's `exit` could drop the session before the list was read                                                                                     | Shown by the words `expected [] to deeply equal [ Array(1) ]`                      | test          |
| `panelSessions`, `shell`                           | macos           | node-pty 1.1.0 publishes its macOS spawn helper as mode 644, and its install step does not set it: `posix_spawnp failed`                                | Mode shown in the registry's tarball; **that it is this failure is inferred**      | install step  |
| `harnessCompositor`                                | windows         | `findExecutable` looked for `node` with no extension                                                                                                    | Shown by D7                                                                        | harness       |
| `harnessCompositor`                                | others          | The case waited on version probes of tools it does not own, past its 5 s                                                                                | **Inferred**: the log shows the timeout, not the slow tool                         | test          |
| `harnessElectron`, `harnessInput`                  | windows         | `findExecutable` read a backslash path as a bare name. `harnessElectron` also expected `/` in a path the OS spells                                      | Shown by D7b                                                                       | harness, test |
| `appScheme`                                        | windows         | The suite expected `/opt/...`, and `path.resolve` answers `D:\opt\...` there. The product's real paths are fine                                         | Shown                                                                              | test          |
| `acpTeamSession`                                   | ubuntu, windows | "Author identity unknown": `gitRepo`'s commit named no author, on a runner with none                                                                    | Shown by D11                                                                       | test          |
| `acpTeamSession`, merge diff                       | windows         | ACP team paths carry `/` on every OS, by contract (`normalizeTeamPath`), and the suite expected the OS's spelling                                       | Shown by D11b                                                                      | test          |
| `acpTeamServe`                                     | windows         | "Agent teams need a second model". The child had `HOME` but no `USERPROFILE`, so it read the runner's real data folder and not the suite's stored team  | Shown by D15                                                                       | test          |
| `teamM96cAcceptance`                               | windows         | `/bin/sh` does not launch there, and a failed launch reports its descendants not proved ended, which reads "The earlier attempt has not stopped"        | Shown by D13                                                                       | test          |

**`AttachConsole failed` is not a cause.** It is node-pty's own helper, printed when a kill races a shell that has already gone, and it still prints in green runs here. I left it alone.

## 2. The activation bundle

Measured with the budget test's own build at each first-parent commit. The budget is 3,072 bytes of growth.

| Commit       | Merge              | Growth               |
| ------------ | ------------------ | -------------------- |
| `7ef35e5c8f` | before             | 2,803                |
| `88b1a72cb3` | `acpteam-reviewed` | **3,123**            |
| `09dbac3aa2` | `cc-m104gw`        | 3,199                |
| `483aa5c66b` | `m109h-reviewed`   | **3,279**, this head |
| `707ce70cb9` | this lane          | **2,988**            |

`acpteam-reviewed` added 320 bytes: `taskDiffFiles`, `taskReport`, `taskSession` and `stopSessionTasks` on `TeamHostBinding`, which only `dist/acpTeam.js` calls. The binding now hands that bundle its loaded service (`loaded()`), and those reads live in the bundle. The budget is unchanged. `cc-m104gw`'s 76 is code moved out of `extension.ts`, and `m109h-reviewed`'s 80 is one dependency field. Both stay. That leaves 84 bytes to spare, so **the next lane to touch activation will meet this budget.**

## 3. The jobs that are not tests

| Job                                                  | What it is                                                                                     | Evidence                                                                                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `build / platform release artifacts`                 | **Roll-up**                                                                                    | `CHECKS: failure`, then `test "$CHECKS" = success`                                                                                                                       |
| `build / package`, `quality` (3), `dictation helper` | **Roll-ups**                                                                                   | The same shape: `CHECKS: failure`, `UNIT: failure`                                                                                                                       |
| `desktop / Desktop`                                  | **Roll-up**                                                                                    | `RESULTS: failure success ...`: its first leg, `unit`, the harness suites                                                                                                |
| `desktop / harness suites (amd64)`                   | Its own: `harnessCompositor`                                                                   | Fixed here                                                                                                                                                               |
| `desktop / harness suites (arm64)`                   | `harnessCompositor`, and **`harnessScenes`: "Chrome is required for the desktop scene suite"** | The second is its own and not fixed: this leg has no Chrome. **`desktop / Desktop` stays red until it is settled**                                                       |
| `desktop / compositor session in guest`              | **Its own, two faults, outside the roll-up** (manual and nightly)                              | `virtual-input binary not executable`, since `download-artifact` drops the bit (shown). `/tmp/cloud.qcow2` missing after a silent `curl -sL` (cause inferred). Not fixed |

## 4. macOS-only and Linux-only files: what shares a cause

**None of them shares a cause with the reds above**, as far as the logs show. Among themselves:

| Files                                                                                                                                     | Job           | Their words                                                                                                             | Reading                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `teamCheckSlotsGoverned`, `teamWorkerChecks`, `governedTeamSlotsPoll`                                                                     | macos         | `expected 'normal' to be 'throttle'`, `expected null to be 1`                                                           | Probably one cause: the governed slots' machine level on hosted macOS (inferred)                    |
| `feedbackBrowser`, `nodeBrowserWorkspace`                                                                                                 | macos         | A 5 s case and a 10 s hook                                                                                              | The same shape as `teamModelsFirstPaint`'s first page in `cc-winfix6.md`, a cold browser (inferred) |
| `harnessScenes`                                                                                                                           | macos         | A 5 s case                                                                                                              | Possibly the same (inferred)                                                                        |
| `teamProcessWorkers`                                                                                                                      | ubuntu, macos | `Muse Code is not installed in any known location` where the case expects not-signed-in; also `TEAM_HOST_BUSY` on macos | Its own                                                                                             |
| `harnessDbus`                                                                                                                             | ubuntu        | The canary service exited 1                                                                                             | Its own                                                                                             |
| `vault/vaultPeerRun`                                                                                                                      | ubuntu        | `expected 2 to be +0`                                                                                                   | Its own, not looked into: a vault suite                                                             |
| `vault/feederAncestry`                                                                                                                    | macos         | `expected false to be true`                                                                                             | Its own, not looked into: a vault suite                                                             |
| `nativeHelper`, `macosRecorderDeps`, `judgeLocalDarwin`, `makerSerial`, `playbookGovernor`, `nodeOsSetupServer`, `teamWorkerCreateBundle` | macos         | Various, including a missing `muse-dictate-screen-arm64.app`                                                            | Their own                                                                                           |

`makerReviewBrowser` no longer appears in this run.

## 5. Drills

Each line broken on purpose, in the hosted shape, restored byte-exact (the tool compared hashes), run again. Every red exited 1 and every green 0.

| Drill | Broken                                                     | Red                                                             | Green                |
| ----- | ---------------------------------------------------------- | --------------------------------------------------------------- | -------------------- |
| D1    | The ACP card leaves the guard's allow-list                 | 2 failed, 2 passed: the hosted two                              | 4 passed             |
| D2    | `--team` twice                                             | 1 failed, 8 passed: the hosted words                            | 9 passed             |
| D3    | The four readers back on the binding                       | `expected 3308 to be less than or equal to 3072`                | 1 passed             |
| D4    | The suite loses `dist/acpTeam.js`                          | `dist/teamMcp.js is shipped but unreachable`                    | 5 passed             |
| D6    | Confinement treats a short name as any folder              | 2 failed across 2 files: the new case, and the hosted `Refused` | 11 passed, 3 skipped |
| D7    | Bare names on Windows                                      | `expected undefined to be defined`                              | 9 passed, 1 skipped  |
| D7b   | A backslash path as a bare name                            | 2 failed across 2 files: the hosted words                       | 4 passed, 1 skipped  |
| D8    | The app scheme builds a POSIX path                         | 2 failed, 2 passed: the hosted words                            | 4 passed             |
| D9    | `\n` for Enter in the shell suite                          | `expected undefined to be +0`                                   | 7 passed             |
| D9b   | The agent closed before its exit                           | `expected false to be true`                                     | 5 passed, 3 skipped  |
| D10   | A bare path in the crash suite's import                    | 2 failed, 1 passed: the hosted words                            | 3 passed             |
| D11   | No identity on the commit                                  | 9 failed, 3 passed: "Author identity unknown"                   | 12 passed            |
| D11b  | The OS's path spelling expected                            | 1 failed, 11 passed: the hosted diff                            | 12 passed            |
| D13   | `/bin/sh` on Windows                                       | "The earlier attempt has not stopped"                           | 24 passed            |
| D14   | Session state expected before the theme                    | `expected 'theme' to be 'init'`                                 | 8 passed             |
| D15   | The agent's home elsewhere, still isolated                 | "Agent teams need a second model"                               | 2 passed             |
| J1    | The shared build skips the desktop, on a `dist/` with none | 2 failed, 102 passed: the hosted two                            | 104 passed           |

**Under Linux, not drilled here:** the crash store's root (section 1).

**No drill:** the node-pty install step needs a Mac, and the guest job a hosted runner.

**J1's first run was not a red.** It exited 0 because this tree's `dist/desktop` was left from earlier builds. A clean checkout has none, so the drill now removes it first. A stale `dist/desktop` would hide this fault on any working copy, though not on hosted CI.

## 6. Gates

Node 22.23.4, on `040eac5787` (this record's commit adds only this document). The list is the hosted static gates', which stopped at `check:usable-reply`, plus format and lint.

| Gate                                                                                                                                           | Exit                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `format:check`, `lint`, `typecheck`                                                                                                            | 0 each                                 |
| `check:badges`, `check:tokens`, `check:l10n`, `check:reference`, `check:host-api`, `check:mhp`, `check:plan`, `check:roadmap`, `check:catches` | 0 each                                 |
| `check:usable-reply`, `check:wrap-up-request`, `check:no-output-cap`, `check:no-round-cap`, `check:workflow-scripts`                           | 0 each                                 |
| `deadcode`, `cycles`, `duplication`, `build`, `security:audit`                                                                                 | 0 each                                 |
| The cross-OS and Windows-only suites this PC may run, hosted shape                                                                             | **0**: 16 files, 202 passed, 5 skipped |
| `runtimePanelCompanion`, keyring refused                                                                                                       | **0**: 8 passed                        |
| `acpTeamServe`, keyring refused                                                                                                                | **0**: 2 passed                        |

**A false red of my own, on the way.** `judgeP2Delivery` failed once while collected, with `ETIMEDOUT` at `vsce ls`, CC-WINFIX3's 300 s hung bound. The PC was idle. My own scratch was the cause (inferred): 65,367 archived files under `temp/arch`, from the activation measurements, and `vsce ls` walks the whole tree before it applies `.vscodeignore`. With them removed one listing took 57 s, and the suite passed at the head. No budget moved. A checkout with a large `temp/` can reach that bound.

Not run: the whole unit suite, the vault and credential-store suites, the packed product's real-life run (it spends money, and the brief makes no provider request) and hosted CI.

## 7. Only hosted CI can decide

- **macOS's `posix_spawnp failed`.** The install step sets the bit, but only a Mac can show that was the whole of it.
- **`harnessCompositor` off Windows.** That looking only in node's folder is inside the 5 s.
- **`crashHook`'s day file on real Ubuntu and macOS.** Shown under WSL's Linux.
- **The merge with batch B**, which is landing on `cc/int11` at the same time. `teamHostBinding.ts`, `productionBuild.ts` and `usableReplyGuard.mjs`'s list are the likeliest to meet.

**Not settled:** which tool slowed `harnessCompositor` on hosted runners, why `/tmp/cloud.qcow2` went missing in the guest job, and what should happen to `harnessScenes` on an arm64 leg with no Chrome.
