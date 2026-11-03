# CC-INT11FIX2 — hosted run 41677635406 on `06bf4704a`

Lane `CC-INT11FIX2`, branch `cc/int11fix2` from `cc/int11c2`. The run: 34 jobs pass, 44 fail, 1 cancelled, 36 failing
test files. Logs read from the lead's `ci-41677635406` folder. Nothing pushed. No Muse request and no paid call.

**How tests ran here.** One runner, `temp/vt2.ps1`: every argument is a named test file, a vault or credential-store
name is refused before vitest starts, no flag or filter can widen the list. Its PATH has no `muse` entry and its
`LOCALAPPDATA` is the worktree's, so the launch cannot find the real CLI, and it refuses to start if `muse` still
resolves. `@napi-rs/keyring` is refused in every Node process, and no load was tried in any run (0 `[nokeyring]`
lines). At most four workers, TEMP in the 8.3 hosted shape, git unable to look above it.

## The reds on all three systems

| File                       | Cause, from the logs                                                                                                                                    | Fix                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `museStartFault` (EPIPE)   | **Product.** The handshake write lost the race with the exit: `write EPIPE`, no `fault`. `museStartFailure` only knew the SDK's protocol error.         | `isHandshakeEnded` takes both. A person sees the same words either way.   |
| `museStartFault` (flatten) | **Product, a path could leave.** rlf-makerfence (`04ee2ee26`) added free `{detail}` and `{reason}` templates, so the `C:\Users\…` slot passed.          | Templates out. `isFilledSentence` checks the start slots; registry exact. |
| `osImageBuild` (44)        | **Product.** `os/check.py` (D229): no staged file or folder may wear the CLI's names, and M111AR's boot themes were folders named `muse`.               | Themes renamed `muse-desktop`, descriptor and script with them.           |
| `manifest`                 | `check:art` is in `quality:gates` (rlf-m111ar) and was never in the static job.                                                                         | Added. It takes seconds now; see below.                                   |
| `billingRouteInventory`    | rlf-editfuzz froze one route in a const for the non-strict resend, right by design; the guard read only an inline call.                                 | Guard follows the shorthand to that const and the one resolver.           |
| `actionMaxRequests`        | m105bind made five transcription counters required in `usage.paid`; the schematic result lacked them.                                                   | Fixture.                                                                  |
| `real-use` (5)             | The same counters. **It needs no live request**: all five cases are schematic results through `verdictForStep`. Nothing live was made.                  | Fixture, both `paid` blocks.                                              |
| `teamConstants`            | rlf-fallback's `refused` is a real switch reason (D261).                                                                                                | Expected list.                                                            |
| `acpSessionRegistry` (2)   | SDK 2.4 (rlf-upsdk): its client turns `-32002` on `session/close` into success, as ACP advises. The agent still answers it (read in `core/jsonrpc.js`). | A prompt shows the registry holds nothing.                                |
| `subscriptionForeignPaths` | D262 names `CLAUDE_CONFIG_DIR`. See below.                                                                                                              | One reviewed file names it now.                                           |

**`subscriptionForeignPaths`, read and not allow-listed by reflex.** No lane reads a credential path, so there was
nothing to stop and tell you. `claudeAgentEnvironment` drops an inherited `CLAUDE_CONFIG_DIR` and sets the child's to
`<our storage>/claude-agent-config`, so a keyed Claude preset's adapter cannot reach `~/.claude`. `acpProcess.ts` and
`externalOrchestrator.ts` only made that folder. They now ask `claudeConfigFolderOf`, so one reviewed file names the
variable, with this as its reason. A new naming still fails: drill C1 below.

**Art, which is also why `check:art` could join the job.** `new Resvg` loads the machine's fonts on every render by
default, and no art has `<text>`. `build-cursors --check` took over seven minutes here and takes 0.5 s with
`loadSystemFonts: false`; every output stays byte-fresh. This is `desktop/artBoot` on Windows and macOS, and, by the
same code path, `desktop/artCursors` and `desktop/artIcons` on macOS (their hosted reds are timeouts; I could only
measure Windows, so macOS is inferred).

## The two non-test jobs

- **`build / semgrep`.** One blocking finding, `npm-missing-minimum-release-age`, on `.npmrc`. The repo's form is `#
nosemgrep: <rule> -- <reason>`; `.npmrc` carries it as its first line, naming D260. PLAN's D260 says so too. The wait
  stays out and the job stays on. I ran the pinned semgrep 1.180.0 here, from a venv in `temp/`: exit 1 before, exit 0
  after, on `.npmrc` and on every file this lane changed. That run found one more of mine, `spawnSync` in
  `globalSetup.mjs`, suppressed the same way with its reason. A scan of the whole tree is hosted's.
- **`build / static gates (macos-latest)`.** The log says `FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed -
JavaScript heap out of memory` at 2032 MB, then `typecheck:e2e exited with 134`. **The merged tree outgrew the job's
  default heap on that smaller runner:** the project holds all of `src`, and uses 2.23 GB here (`--extendedDiagnostics`).
  It now passes `--max-old-space-size=4096`, as `typecheck:unit` already does. The project checks exactly what it did.
  `typecheck:integration` (1.27 GB) and `typecheck:faults` (0.88 GB) have room. Everything after this abort in that job
  was never reached on macOS, so hosted may find more there.

## The Windows-only reds

| File                        | Cause                                                                                                                                                                         | Fix                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `contextHiddenCharacters`   | The test passed `path.join('sub','file.ts')`. The product's touched path is forward slashes on every system (`confineWorkspacePath`). Not a product fault.                    | The product's form.                                  |
| `hardwareUnknownFence`      | It relied on the serial read failing, true off Windows; since `2cf05e929` real Windows answers.                                                                               | The real reader, on a missing system folder.         |
| `desktop/artBoot`           | Fonts, above. Bytes unchanged.                                                                                                                                                | `loadSystemFonts: false`.                            |
| `m96dCoordinatorEndpoint`   | 15 s, here 582 ms. Its `Get-CimInstance` is a first CIM use. **Inferred:** the log shows only the timeout and `PowerShell cold start: 6823 ms` (226 ms here).                 | Global setup also pays CIM's first query.            |
| `makerWindowEngine`         | 15 s, here 599 ms, in the case that lists ports. `listPorts.ts` runs `Get-CimInstance Win32_PnPEntity`. **Inferred**, as above.                                               | The same.                                            |
| `runtimePullRequestRecords` | 15 s on the file's first lease, then 3.4 s, then under 0.5 s; here 2.7 s for all 22. Each process compiles its birth reader with `csc.exe` (`processOwner.ts`). **Inferred.** | Global setup compiles once first.                    |
| `feedbackBrowser` (hook)    | `chromium.launch` passed its 30 s hook; the file's own comment names that slow first start. **Inferred.**                                                                     | Global setup starts Chrome once, on its own profile. |

No deadline moved. Global setup already paid PowerShell's first start before any worker for this reason; it now pays
those three as well and prints each time. Here: PowerShell 356 ms, compiler 155 ms, Chrome 603 ms. Only hosted can show
whether that is enough, and if a shard's first start still passes a deadline the printed time will say which.

## Batch D's three

- **`nodeBrowserWorkspace`** builds into `temp/node-browser-<pid>`, removed after; `test/harness/node.html` takes
  `?build=`, and a run with none uses the release build as before. `dist/webview/node` does not exist after a run here.
  The build still writes `dist/meta-node/workspace.json`, not asked for and not touched. Its macOS red, a 5 s timeout on
  the keyboard case, is a different thing and stays yours to place.
- **arm64 `harnessScenes`.** GitHub's arm64 Ubuntu image has no Chrome and Google builds none for that platform. The job
  now runs `playwright-core install --with-deps chromium` and writes the path to `CHROME_PATH`. The suite still throws
  without one, so there is no skip. **Not run here:** no arm64 machine; hosted decides.
- **`compositor session in guest`.** `chmod +x` after `download-artifact`, and in the container `set -e`, `curl -fSL` and
  `ca-certificates`. The log shows the unexecutable binary, and a `/tmp/cloud.qcow2` that never appeared under `curl -sL`.
  **Inferred:** `--no-install-recommends` left curl without its certificates; `-fSL` will now say. **Not run here.**

## Drills

Each restored byte-exact (sha256 compared), files named.

| Drill | Break                                        | Red                                                                                                   |
| ----- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| F1    | a handshake EPIPE stays a raw write error    | exit 1: `expected Error: write EPIPE { code: 'EPIPE' } to have property "message"`                    |
| F2    | makerfence's free start slot back            | exit 1: `expected 'Internal error: The session could not…' to be 'That did not work…'`                |
| F3    | the registry sentence's slot left free       | exit 1: `expected 'Invalid request: The created-resource…' to be 'That did not work…'`                |
| B1    | the frozen route not from the one resolver   | exit 1: `core/backends/modelapi/client.ts: expected false to be true`                                 |
| C1    | a file names `.claude/.credentials.json`     | exit 1: `foreign storage path named outside the reviewed list`                                        |
| C2    | the reviewed anchor gone                     | exit 1: `claudeAgentSafety.ts lost its anchor CLAUDE_CONFIG_DIR_VARIABLE`                             |
| R1    | close leaves the session held                | exit 1: `expected -32603 to be -32002`                                                                |
| M1    | `check:art` out of the static job            | exit 1: `expected [ 'build', 'check:badges', …(31) ] to deeply equal [ 'build', 'check:art', …(32) ]` |
| H1    | a failed win32 read reads as known and empty | exit 1: `expected false to be true`                                                                   |
| O1    | a folder under `os/` named `muse`            | exit 1: `os/check.py` refuses, in `osImageBuild`                                                      |
| S1    | the suppression off `.npmrc`                 | semgrep `Findings: 1 (1 blocking)`, exit 1 (the green run's exit was 0)                               |
| T1    | `typecheck:e2e` at a 1500 MB heap            | exit 134: `FATAL ERROR: Ineffective mark-compacts near heap limit`                                    |

My first C2 renamed only the declaration, so the anchor survived and it stayed green. That was a bad drill, redone as a
rename of every spelling, and the table has that red. `museStartFault`'s 126 case is skipped on Windows, so the F1 red
is a new case that runs on every system; only hosted can run the original on Linux and macOS.

Suites here on the final code: the nine above, `acpTurnFailure`, `hardwareUnknownFence`, `contextHiddenCharacters`,
`desktop/artBoot`, `desktop/artCursors`, `desktop/artIcons`, `makerWindowEngine`, `runtimePullRequestRecords`,
`m96dCoordinatorEndpoint`, `nodeBrowserWorkspace`, `feedbackBrowser`, `nodeWorkspaceBuild`, `nodeInstall`,
`team/claudeAgentSafety`, `team/externalOrchestrator`: 24 files, 476 passed, 36 skipped by platform, 0 failed.
`nodeInstall` was **my own regression** from batch C2: its fixture tarball lacked the `dist/uiTextSettings.js` I added to
the installer's list. It is Linux and macOS only, and most of it is skipped here, so hosted decides it.

## Not mine, listed

macOS only: `desktop/panelSessions`, `governedTeamSlotsPoll`, `macosRecorderDeps`, `makerSerial`, `nativeHelper`,
`playbookGovernor`, `teamCheckSlotsGoverned`, `teamWorkerChecks`, `teamWorkerCreateBundle`, `vault/feederAncestry`,
`nodeBrowserWorkspace`'s keyboard case. Linux only: `createdRegistryRace`, `desktop/harnessDbus`, `nodeOsSetupServer`,
`vault/vaultPeerRun`. Linux and macOS: `teamProcessWorkers`.

Shared cause I can tell, from the messages only: `desktop/artCursors` and `desktop/artIcons` with the art fix above, and
`nodeInstall` with my regression. `teamCheckSlotsGoverned`, `governedTeamSlotsPoll` and `teamWorkerChecks` look like one
thing (a governor reading `null` or `normal` where a level was wanted, inferred). `nativeHelper`, `macosRecorderDeps` and
`teamWorkerCreateBundle` all name the macOS native helper (inferred). None of those was opened here.

## Gates

On `98ae9d38d`, one after another, Node 22.23.4. Every exit is 0.

| Gate                                                                                                 | Exit |
| ---------------------------------------------------------------------------------------------------- | ---- |
| `format:check`, `lint`, `typecheck`                                                                  | 0    |
| `check:badges`, `check:tokens`, `check:art` (12 s; minutes before), `check:l10n`, `check:reference`  | 0    |
| `check:host-api`, `check:mhp`, `check:plan`, `check:roadmap`, `check:editor-matrix`, `check:catches` | 0    |
| `check:usable-reply`, `check:wrap-up-request`, `check:no-output-cap`, `check:no-round-cap`           | 0    |
| `check:workflow-scripts`, `deadcode`, `cycles`, `duplication`, `build`, `security:audit`             | 0    |

Touched since their last run, on that head, files named: `museStartFault`, `billingRouteInventory`,
`acpSessionRegistry`, `manifest`, `acpTurnFailure`, `subscriptionForeignPaths`, `team/claudeAgentSafety`,
`nodeBrowserWorkspace`, `desktop/artBoot`: 103 passed, 5 skipped by platform. The whole unit suite did not run here.

**Only hosted CI decides:** the whole suite on three systems; `museStartFault`'s 126 case on Linux and macOS; `nodeInstall`;
whether the warm starts are enough on Windows; the arm64 Chromium and the guest session, neither run here; `typecheck` and
the gates after it on macOS.
