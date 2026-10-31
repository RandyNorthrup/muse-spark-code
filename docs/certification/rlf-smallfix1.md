# RLF-SMALLFIX1 — a missing native helper says what is missing; the serial helper starts a python3 found by its full path (2026-10-31)

Claude Code lane `RLF-SMALLFIX1`, worktree `/Users/randy/lanes/RLF-SMALLFIX1`,
branch `rec/rlf-smallfix1`, on the test rig `Macmini.ivettnet` (macOS 15.7.4,
Intel x86_64, Node 24.21.0, npm 11.19.0). Base: `cc/int6` `339c1ec95` (CC-INT6's
merge round, `docs/certification/cc-int6.md`; its section 8 item 7 is this lane's
fix 2). RLF-SHUTDOWN2's finding (`docs/certification/rlf-shutdown.md` section 9,
on `rec/rlf-shutdown2`, not in this base) is fix 1.

Provider calls: **0**. Model attempts: **0**. Muse model requests: **0** (the
allowance is out until 2026-11-02T00:00:00Z; no prompt was ever sent). The real
Muse Code 1.4.11 (`~/.local/bin/muse`) was started by the real-agent runs below in
a throwaway HOME whose only sign-in file is the recorded empty one (`{ "providers":
{}, "schema_version": 2 }`, the file RLF-SHUTDOWN2 recorded as `v2-empty.json`:
no credential, so no Keychain write) with every proxy variable at the dead
`127.0.0.1:9`; it answered `initialize` and the session could not fetch models, as
RLF-SHUTDOWN2 measured. No Muse Code process was left running. The CLI's own
model-catalog fetch went to that proxy and was refused on this computer; no request
reached Muse, and no session was ever created (every `session/new` was refused by the
agent), so no session record exists. I removed those throwaway homes before counting rows
in their session index, so the count rests on that reasoning and on the dead proxy, not on a
recount. Nothing was pushed,
rebased, stashed or tagged. The vault and real credential-store suites
(`keyringParts`, `keystoreOwner`, `credentialLease`, `providerHeadersStore`, `test/unit/vault/**`)
were not run (excluded by name from the related run, section 6).

## 1. What was found, measured

**Fix 1, before.** On this worktree (no `native/darwin/muse-dictate-screen-x64.app`;
it is a gitignored output of `native/darwin/build.sh`), the built agent
(`node scripts/build.mjs`, then `dist/acp.js` with `--muse-binary ~/.local/bin/muse`)
driven through `initialize` and `session/new` by a small client (the ACP SDK's own
stream, in `temp/`, not committed):

```
session/new error message: That did not work (the Muse Spark log has the details)
session/new error data: {"kind":"internal"}
[warn] ACP session/new failed: Error
```

With the stack printed from the built bundle only (a debug line in `dist/`, removed):
`Error: spawn <worktree>/native/darwin/muse-dictate-screen-x64.app/Contents/MacOS/muse-dictate ENOENT
at dist/resourceGovernor.js` — that is `runTreeProgram` (`src/core/resources/trees/run.ts`),
run by `createdPathCommands` (`src/core/resources/resourceGovernorEntry.ts`), the created-resources
registry's native file commands, which every governed launch of Muse Code goes through. Two layers made
it silent: the spawn error's message names a path and so is never logged (`causeForLog` kept only the
name, `Error`), and the ACP boundary (`outboundSentence` in `src/acp/agent.ts`) lets only an allow-list
of exact sentences leave, so any other text became `actionFailed`.

**Fix 2, before.** `src/runtime/maker/nativeSerial.ts` returned `file: 'python3'`. A real run (test
`makerSerialInterpreter`, first case) shows a bare `python3` with a relative PATH entry (`bin:…`) run
the program planted in the workspace's `bin/`: its marker file was written.

## 2. What changed

### 2.1 Fix 1 — the paths, and what each does now

One module, `src/core/nativeHelper.ts` (`runNativeHelper`, `nativeHelperError`, `isNativeStartFailure`,
`isNativeHelperSentence`), and one typed error, `src/shared/nativeHelperError.ts` (`NativeHelperError`
with a fixed `fault`: `missing` or `unloadable`; recognised across bundles by name and fault, like
`CreatedRegistrySaveError`). The sentence is built where the helper is started:

| Fault        | Packaged product (no build script beside `native/`)                                                                                                      | Source checkout (`native/darwin/build.sh` on a Mac, `scripts/build.mjs` on Linux)                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `missing`    | "The native helper {helper} is missing from this installation … Reinstall Muse Spark Code."                                                              | "The native helper {helper} is not built in this source checkout … Build it with “{command}”, then try again." |
| `unloadable` | "… is installed, but this computer cannot run it (it may be damaged, blocked by the system or built for another processor) … Reinstall Muse Spark Code." | "… is built, but this computer cannot run it (…) … Rebuild it with “{command}”, then try again."               |

`{command}` is `bash native/darwin/build.sh` (Mac) or `npm run build:dev` (Linux: `scripts/build.mjs` builds
`muse-created`). Two more sentences: a platform that ships no helper (`unsupported`) and the Windows job helper
(`windowsJob`: compiled on first use by Windows PowerShell 5.1; reinstall, check PowerShell starts, check
security software). All six are in `UI_TEXT.nativeHelper` and the 14 tables. A spawn failure is `missing` if the
file is not there and `unloadable` if it is (Node raises `EACCES` with the program as `path` for a file
without the execute bit, and `-86` with no path, thrown at once, for a binary built for the other processor).

| Path (every place found that starts a shipped helper, by search of `native/`, `darwinDictationHelperSegments`, `muse-created`)                                                         | Before                                                                                                                                                                                                                     | Now                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Created-path commands (`createdPathCommands`; macOS app `--created-directory`, Linux `muse-created`, Windows PowerShell + job assembly) — **the path the agent's session start takes** | bare spawn error, log `Error`, person sees "That did not work"                                                                                                                                                             | `NativeHelperError`; the registry, `startFailureText` and the ACP allow-list carry the sentence; Windows says `windowsJob`, other platforms `unsupported`                                                                                 |
| Team worker file helper (`nativeOperation` in `workerOps.ts`)                                                                                                                          | looked for macOS `native/darwin/muse-dictate`, a file the build never makes (`ls native/darwin` after `build.sh`: only the two `.app`s and the vault peers); said "The verified native worker file helper is unavailable." | the same selector as above (`createdHelperFile`), so the macOS app; the helper's sentence; Windows job missing says `windowsJob`; `teamFileHelperMissing` (still used for a Windows assembly that will not load) now also says what to do |
| Voice dictation and Muse Voice capture (`darwinHelper` in `helperLocation.ts`)                                                                                                         | "… which this build does not include."                                                                                                                                                                                     | the same, plus "Reinstall Muse Spark Code; in a source checkout, build it with “bash native/darwin/build.sh”."                                                                                                                            |
| Screen recording on macOS (`macos.ts`)                                                                                                                                                 | `Screen recording is unavailable: native/darwin/<app>`, and the bare words `helperIntegrity` and `muse-dictate`                                                                                                            | the helper's sentence for missing, for a signature that does not verify, and for a start that fails; the spawn catch is NARROW now (it rethrows any failure that is not the helper's own start)                                           |
| ACP session and turn start (`startFailureText`, `causeForLog`, `outboundSentence`)                                                                                                     | the cause flattened to `Error` and then to `actionFailed`                                                                                                                                                                  | the sentence leaves in full; the log keeps `NativeHelperError missing` (name and fault only)                                                                                                                                              |

**Reviewed and left, with the reason (open items in section 7):** the macOS memory reader
(`darwinMemory.ts`; used only on a Node whose libuv is older than 1.52, this rig's is 1.52.1, and its
unknown reading is the stated design: never substituted); the trusted-path private-group check
(`trustedPath.ts`; fails closed with its own technical reasons for a directory writable by the person's
own group; a change there is a security-layer change); the vault's helpers (`posixNative.ts`; every
failure is the one fixed `vault.noAccess` sentence by design, no oracle); the Linux portal recorder
(`muse-portal-record`: an absent helper reads as "no portal" through a boolean) and the local judge peer
(its own build script).

### 2.2 Fix 2 — the serial helper's interpreter

`src/core/maker/serial/interpreter.ts`: `resolveSerialInterpreter` finds `python3` the way `gh`, `git` and the
Linux recorders are found (`resolveAllExecutables` over the absolute PATH entries outside the run workspace,
links followed), then skips a hit whose real path lies inside the workspace, and throws
`UI_TEXT.makerSerialPythonMissing` (what is missing, and `python3 -m pip install pyserial`) when none is
left. `nativeSerial.ts` calls it for every POSIX helper start (so a Python installed later is used) and
starts the absolute path with `-I` and the shipped script. The plan names no setting for the interpreter
(searched `PLAN.md`, `docs/plan-archive/`, `package.json`), so none is honoured and none was added.

## 3. Proof: real-code tests, real processes

- `test/unit/makerSerialInterpreter.test.ts` (4 cases): a planted `python3` first on PATH (absolute workspace
  entry, relative `bin` and `.`) is never chosen and never runs (its marker file is never written), the real
  python3 found beside it runs `-I -c print(...)`; a link into the workspace from an outside directory is
  skipped; with only the planted one the sentence is thrown. The first case shows the bare name really runs
  the planted program (the threat is real on this OS).
- `test/unit/nativeHelper.test.ts` (19 cases): a missing helper under a product folder with and without the
  build script, on the `darwin` and `linux` tables, through `runNativeHelper` and through `createdPathCommands`;
  `windowsJob` and `unsupported`; a helper that runs and answers; a helper that runs and exits 3 (its own
  refusal, untouched); a real file without the execute bit (`unloadable`, both forms); on a Mac the other
  processor's real built binary (`unloadable`; skipped by name where `build.sh` has not run); the product's
  own built helper answers its own refusal through `createdPathCommands` (skipped by name where unbuilt);
  `isNativeHelperSentence` lets every filled sentence through and refuses a slot holding a key-shaped token,
  a newline, a Windows path or nothing, and text around a sentence.
- `test/unit/startText.test.ts` (+1), `test/unit/macosRecorderDeps.test.ts` (2 expectations changed, +1 case: the other
  processor's signed app in this Mac's slot — a real helper build, signed), `test/unit/teamWorkerCreate.test.ts`
  (the missing-helper expectation now names the helper), `test/unit/pathGuardSpawns.test.ts` (the reviewed reason).
- The real agent, `session/new`, matrix (the same client, `dist/acp.js`, helper moved aside or altered, then restored):

| Helper state                                                                    | What the editor gets                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| absent, source checkout                                                         | `Internal error: The native helper muse-dictate-screen-x64.app is not built in this source checkout, so this could not start. Build it with “bash native/darwin/build.sh”, then try again.` |
| absent, product folder without the build script (`dist` linked, empty `native`) | `… is missing from this installation of Muse Spark Code, so this could not start. Reinstall Muse Spark Code.`                                                                               |
| present, execute bit removed                                                    | `… is built, but this computer cannot run it (it may be damaged, blocked by the system or built for another processor) … Rebuild it with “bash native/darwin/build.sh” …`                   |
| the arm64 binary in the x64 slot (this Mac is Intel)                            | the same "cannot run it" sentence                                                                                                                                                           |
| present and right                                                               | `Invalid request: The backend offers no model this agent may use.` (the dead proxy; the helper was found and used)                                                                          |

## 4. Red/green drills

Each: break one thing, run the proving test, record the exit code, restore, run again green.

| #   | Break                                                                                                                                            | Proving run                               | Red (exit)                                | Green |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------- | ----- |
| S-A | `resolveSerialInterpreter` returns the bare `python3`                                                                                            | `makerSerialInterpreter`                  | 1 (2 of 4 fail)                           | 0     |
| S-B | the real-path-inside-the-workspace filter removed                                                                                                | `makerSerialInterpreter`                  | 1 (the link case)                         | 0     |
| S-C | both guards removed (no-workspace scope, first hit); with only the scope removed the suite stays green (exit 0): the real-path guard holds alone | `makerSerialInterpreter`                  | 1 (3 of 4 fail)                           | 0     |
| N-1 | `createdPathCommands` calls `runTreeProgram` directly (the old code)                                                                             | `nativeHelper`                            | 1 (the created-path case)                 | 0     |
| N-2 | a spawn failure must carry the program as `path` (the `-86` failure has none)                                                                    | `nativeHelper`                            | 1 (the other-processor case)              | 0     |
| N-3 | the ACP allow-list line removed from `agent.ts`; dev bundle rebuilt; the real agent on a helper-less folder                                      | real `session/new`, grep for the sentence | 1: the editor gets "That did not work"    | 0     |
| N-4 | `startFailureText` stops passing the helper's sentence                                                                                           | `startText`                               | 1                                         | 0     |
| N-5 | the team worker's macOS path back to `native/darwin/muse-dictate`                                                                                | `teamWorkerCreate`                        | 1                                         | 0     |
| N-6 | the recorder's probe swallows a start failure again (`catch { resolve(undefined) }`)                                                             | `macosRecorderDeps`                       | 1 (the other-processor case says `probe`) | 0     |

Drill logs were kept under the worktree's ignored `temp/drills/`; each break was a single-statement edit, restored from a copy
(`git diff` of the touched file empty afterwards).

## 5. The packed product

`node scripts/package-acp.mjs --target darwin-x64` (after `npm run build`'s production bundles; the universal
`npm run package:acp` stops, as designed, with `Required native helper is missing for the universal package:
native/linux/x64/muse-created`, because the Linux helpers cannot be built on a Mac), installed with `npm install` into a new
empty folder with its own `package.json` (`temp/packed`, 3 packages, `--ignore-scripts`), and driven through `initialize` and
`session/new` by the same client against the installed `dist/acp.js` (real Muse Code 1.4.11, throwaway HOME, dead proxy, 0 Muse
requests, no process left afterwards):

| Installed helper    | What the editor gets                                                                                                                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| present             | `Invalid request: The backend offers no model this agent may use.` (the helper was found and used; the proxy is dead)                                                                                                                        |
| execute bit removed | `Internal error: The native helper muse-dictate-screen-x64.app is installed, but this computer cannot run it (it may be damaged, blocked by the system or built for another processor), so this could not start. Reinstall Muse Spark Code.` |
| removed             | `Internal error: The native helper muse-dictate-screen-x64.app is missing from this installation of Muse Spark Code, so this could not start. Reinstall Muse Spark Code.`                                                                    |

(A slip, undone: my first install ran in a folder without a `package.json`, so npm took the worktree as the target and added the
tarball to its `package.json`, `package-lock.json` and `node_modules`. I restored the two files with `git restore` on those paths,
removed the one package and its entry in `node_modules/.package-lock.json`; `git status` showed only this lane's files after.)

**Serial helper, packed:** not run. It needs a real serial port, the operating-system sign-in and a live approval; this rig has
none attached. What ran instead is section 3's real-process cases against the same function the packed bundle calls.

## 6. `npx vitest related`, and the base

`vitest related` over the lane's changed sources (`startText`, `logText`, `macos`, `resourceGovernorEntry`, `workerOps`,
`nativeHelper`, `nativeHelperError`, `nativeSerial`, `interpreter`; not `constants.ts` or `en.ts`, whose closure is the whole
battery: the l10n, reference, catch and build gates stand for them), `--maxWorkers=3`, three shards, the repository's own
timeouts, with `judgeP2Delivery` (about 90 minutes, CC-INT6 section 4), `runtimeLsp` and the browser suites excluded by name:
**1,430 files (1,362 passed, 32 failed, 36 skipped), 31,146 tests (62 failed)**. (My `--exclude test/unit/vault/**` was
expanded by the shell, so the vault and credential-store suites **did run** on this Mac mini, where the rules allow them; the two
`providerHeadersStore` tests that write the OS store failed at the write with "User interaction is not allowed", so nothing was
stored.) Every failing file was then run alone, in pairs, on this tree and on an extracted untouched base (`git clone --shared` of
`339c1ec95` under `$TMPDIR`, `node_modules` linked, the built darwin apps copied in for the vault suites):

| Class                                         | Files (failing tests in the related run)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Result                                                                                                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mine, fixed                                   | `macosRecorderDeps` (1: the new other-processor case said `probe`), `recordingDriver` (1: expected the old words)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | pass now (`readCheck` reports a failed start; the expectation names the helper)                                                                                                              |
| An artifact of the run                        | `evalFreezeLayout` (copies `git ls-files`: my new files were not committed yet), `runtimePanelGit` and `runtimeReview` ("Stale shared production build": I edited sources while the shards ran)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | pass after the commit, together (3 files, 16 tests)                                                                                                                                          |
| Same failing tests alone on the base and here | `teamEnginePorts` (5), `teamLandingKilled` (1), `teamLandingPause` (1), `teamWorkerCreateBundle` (1), `resourceStatusCpu` (1), `resourceNoLimits` (1), `resourceQueueUnknownOccupancy` (1), `makerLease` (1), `makerSerial` (2), `runtimeMakerStop` (1), `playbookGovernor` (1), `providerSpend` (1), `playbookSchedulesInputs` (1 to 2), `scheduleFireFailures` (4 to 5; 7 failing tests in all three files on both trees), `acpServeHandshake` (1), `connectorStorageGuard` (3), `judgeLocalDarwinDeadline` (1), `nodeDashboardPage` (5), `nodeTerminalPage` (6), `vsixCompression` (2), `providerHeadersStore` (2), `vault/vaultStoreScope` (1), `vault/chatgptSubscriptionMigration` (3) | **Base.** Causes UNMEASURED beyond that; `makerSerial`, `makerLease` and `runtimeMakerStop` are the three CC-INT6 listed as the lane's own on this rig, and fail identically on the base now |
| Passes here, fails on the base                | `teamPlaybookIntegration` (alone: 7 failing tests on the base in the pair with `teamEnginePorts` and `teamLandingPause`, 6 here)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | no regression                                                                                                                                                                                |
| Not run                                       | `devicesPhase2Harness` (7), `feedbackBrowser` (8): they start a browser, which this macOS rig cannot; `judgeLocalDarwinPid` e2e (1): CC-INT6 row 10 puts it on the base, not re-measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | named                                                                                                                                                                                        |

Changed suites, final tree, repository timeouts (no `--testTimeout`): `nativeHelper`, `startText`, `macosRecorderDeps` (32 tests);
`recordingDriver`, `teamWorkerCreate`, `makerSerialInterpreter` (112 passed, 28 skipped: Windows-only); `helperLocation`,
`pathGuardSpawns`, `logText` (41); `evalFreezeLayout`, `runtimePanelGit`, `runtimeReview` (16): every command exit 0.

## 7. Gates (final tree)

| Gate                                                                                   | Exit                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check` on every touched file                                               | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `eslint --max-warnings 0` on every touched `.ts`                                       | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run typecheck`                                                                    | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `node scripts/check-l10n.mjs`                                                          | 0 (14 UI tables, 0 problems)                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `npm run check:reference`                                                              | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run check:host-api`                                                               | 0 (record regenerated; net zero against the base)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run check:plan`                                                                   | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run check:roadmap`                                                                | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run check:catches`                                                                | 0 (SWALLOW 65 to 64 and GENERIC 241 to 240 fell; none rose; baseline regenerated twice, each diff only the removed sites)                                                                                                                                                                                                                                                                                                                                               |
| `npm run duplication`                                                                  | 0 (0 clones)                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `npm run cycles`                                                                       | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run deadcode`                                                                     | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run build`                                                                        | **1**: `dist/teamRunners.js` 78.7 KiB (budget 75, over by 3.7), `dist/teamHost.js` 140.2 (130, by 10.2), `dist/teamScheduler.js` 76.5 (75, by 1.5). The same three, at the same sizes, on the base built here (CC-INT6 section 8 item 1); no budget raised. Every other budget holds. The rest of the build chain, run on its own (`check-bundle-split`, `gen-lazy-registry --check`, `check-host-globals`, `third-party-notices`, `check-legal-build-records`): 0 each |
| `SEMGREP_ENABLE_VERSION_CHECK=0 SSL_CERT_FILE=/etc/ssl/cert.pem npm run security:sast` | 0 (694 rules, 0 findings, after the commit so the new files are tracked)                                                                                                                                                                                                                                                                                                                                                                                                |
| `npm run security:audit`                                                               | 0 (3 moderate advisories, 0 exceptions needed)                                                                                                                                                                                                                                                                                                                                                                                                                          |

Bundle growth from this lane, all within budget: `resourceGovernor.js` 120.1 to 121.6 KiB (budget 125), `teamWorkerOps.js` 12.8 to 14.6
(17), `screenRecordDrivers.js` 43.7 to 44.9 (60), `runtimeMaker.js` 123.5 to 124.5 (126), `uiText.js` 115.0 to 115.4 (125).

`check-bundle-split` once failed on a first attempt: `createdHelper.ts` sat under `src/core/resources/`, which the team worker bundle may not
carry; the selector moved to `src/core/nativeHelper.ts` and the gate passed.

## 8. Not proven, left, and open decisions for the lead

Not run: Windows (the `windowsJob` sentence is proven only as `createdPathCommands('win32')` with no job; no Windows host);
Linux with a real `muse-created` (the missing/unrunnable logic is platform-neutral and runs on both tables here; the Linux
file selector and build command are checked by path, not by running a Linux helper); the serial helper end to end (no hardware);
`judgeP2Delivery`, `runtimeLsp`, the browser suites; `lint:ps`. No hosted CI was available.

Left, each with its reason (section 2.1): the macOS memory reader, the trusted-path private-group check, the vault's helpers, the
Linux portal recorder's boolean, the local judge peer.

Open decisions:

1. **An interpreter setting for the serial helper.** The plan names none, so none was added (the brief: honour it "if the plan
   names a setting"). Option: a machine-scoped `museSpark.maker.pythonPath` (absolute path only, refused inside the workspace,
   checked by the same function). Recommendation: add it when a person needs a Python that is not first on PATH (a venv with
   pyserial), as its own small change with a PLAN line.
2. **The paths left in 2.1.** Recommendation: the Linux portal recorder first (an absent `muse-portal-record` reads as "no
   portal"; make `hasPortal` return a reason), then the trusted-path walk (let a native-helper fault surface as its own refusal
   instead of `group/other writable ancestor`), then the local judge peer. The vault stays one fixed sentence by its own design
   (this lane left it alone).
3. **ACP start sentences.** `acpSessionStartFailed` and `acpTurnStartFailed` ("The session could not be started (…)") are not in the
   ACP boundary's allow-list (`outboundSentence`), so by reading `agent.ts` they leave as "That did not work" like this lane's
   sentence did. UNMEASURED: not run here. Option: add their templates to `outboundTemplates()` (the detail is an error name or code).
4. **Merge note.** PLAN.md and `docs/roadmap/entries.json` gain a section and an entry at the same places as `rec/rlf-shutdown`'s
   (before `### M127`; at the end of the entries): expect two adjacent-hunk conflicts, resolved by keeping both. `rec/rlf-shutdown2`
   records the unbuilt-helper start failure in its section 9.1 and skips its suite by name; with this lane the start failure now
   says the sentence, and that suite's "Muse Code never started" cases could assert it.
5. **Decision numbers:** none used.

## 9. Commits

First parent, in order:

- `0821fef9f` fix(maker): the serial helper starts one python3 found by its full path outside the workspace
- `419ad721e` fix(native): a missing or unstartable native helper says what is missing and what to do, where it is started
- the record, PLAN status, roadmap entry (this commit)
