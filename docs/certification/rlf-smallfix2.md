# RLF-SMALLFIX2 — honest words where helpers and sessions fail, the serial interpreter setting (2026-10-31/2026-11-01)

Lane `RLF-SMALLFIX2`, worktree `/Users/randy/lanes/RLF-SMALLFIX2`,
branch `rec/rlf-smallfix2`, on the test rig `macmini` (macOS, Intel x86_64,
Node 24.21.0, npm 11.19.0). Base: `cc/int8` `810b320fc`, with
`lanes/rlf-smallfix1` merged in (`87a2a9bf2`; the merge resolved PLAN.md and
`docs/roadmap/entries.json` for current int and regenerated the generated
files). The first run (Claude Code, 2026-10-31) built brief items 1-3 and was
paused with the owner's project pause; the resume (Muse Spark via Muse Code,
2026-11-01, this record) re-verified every claim with its own runs, fixed one
latent helper-name bug the resume environment exposed, and left item 4 open
with measured evidence. This record cites only runs the resume observed; the
first run's drill logs under `temp/drills/D[123]-*.log` are superseded by the
`R1`-`R10` drills below.

Provider calls: **0**. Model attempts: **0**. Muse model requests: **0** (the
allowance was out until 2026-11-02T00:00:00Z; no prompt was ever sent). The
real Muse Code 1.4.14 (`/Users/randy/.local/bin/muse`, `1.4.14-R7309.1`) was
started by the real-agent runs below in throwaway homes whose sign-in files
hold no credential, with every proxy variable at the dead `127.0.0.1:9`. No
`session/new` ever succeeded, so no session was created and no session record
exists (the throwaway homes hold only the CLI's own trace logs, its
`serve-exit.jsonl`, and the agent's resource registry). No Muse Code process
was left running (`ps` is denied on this rig, so the check rests on the
client killing its process group and on the dead proxy). Nothing was pushed,
rebased, stashed or tagged. The vault and real credential-store suites were
not run by name in the related run (section 6); this rig allows them, but the
lane touches neither.

## 1. What was found, measured

**Item 1, before.** SMALLFIX1 read (its record, section 8 decision 3) that the
agent's "session could not be started (…)" sentences are flattened to "That
did not work" at the ACP boundary. Measured on the built agent before the
fix by the first run: a malformed `muse/auth.json`, a folder to open that
does not exist, and a Muse Code the computer will not run each ended in "That
did not work" or a bare "Internal error".

**Item 2, before.** The three paths SMALLFIX1 left (its record, section 8
decision 2): the Linux portal recorder read an absent `muse-portal-record`
as "no portal" through the `hasPortal` boolean; the trusted-path
private-group check read a missing Mac helper as a group that is not
private; the local judge peer's missing build output surfaced as an engine
failure.

**Item 3, before.** SMALLFIX1's record (section 8 decision 1) named the
missing piece: no setting names the serial helper's Python, so a venv's
`python3` with pyserial that is not first on PATH cannot be chosen.

**Item 4, before and after.** CC-INT6 section 8 item 3 (repeated as CC-INT8
open item 1): nothing in `src/extension.ts` creates `createMakerHost`,
`MakerCommands` or `createMakerPreviewPanel`. Still true; section 8 says why
it stays open.

## 2. What changed

### 2.1 Item 1 — a session that cannot start says why (part 1)

- `src/core/backends/musecode/startFault.ts` (new): why `muse serve` ended
  before it answered, in our own fixed words. The CLI's stderr is free text
  that can name a path or an account, so it is never forwarded: only lines
  captured from a real `muse serve` (section 3) choose `authFile` or
  `authSchema`, and the exit status chooses `cannotRun` (POSIX shell 126/127
  via `SHELL_EXIT_CANNOT_RUN`, POSIX.1-2017) or `exited`. Status 0, a signal
  (our own kill), a caller-asked stop and an answered-then-refused host are
  left untouched.
- `src/shared/museStartError.ts` (new): the typed `MuseStartError`, recognised
  across bundles by name and fault like `NativeHelperError`.
- `src/core/filledSentence.ts` (new): the sentence-template matcher, factored
  out of `nativeHelper.ts` so the ACP boundary and the helper check share it;
  `CAUSE_SLOT_VALUE` adds the parentheses of `kind (MSP error 12)`.
- `src/acp/agent.ts`: `isOpenableFolder` refuses a folder to open that is
  missing, a file or closed to this account before the CLI starts in it (only
  the six errnos that say so; anything else throws); a non-absolute folder
  keeps its invalid-params refusal with words instead of the echoed path. The
  existence check applies to session start only (`openHost`'s
  `requiresOpenableFolder`, set by new/resume): listing and deleting never
  start the CLI there, so they keep their old refusals byte for byte (shard A
  caught the unscoped check on `session/list`; drill R10). The boundary lets
  the four `museStart` sentences, the two folder sentences and the
  session/turn backstops with a fixed-vocabulary cause leave in full.
- `src/acp/startText.ts`, `src/core/backends/musecode/logText.ts`: the start
  text and the log carry the start error (name and fault only in the log).
- `src/host/backend/museCodeBackendManager.ts`: the handshake catch keeps the
  refusal the stderr watch captured and the exit the close observed, and
  throws `museStartFailure(...)` instead of the bare error.
- "No model" (`acpNoModels`) now names the sign-in, key and network checks.

### 2.2 Item 2 — three more missing helpers are said (part 2)

- The Linux portal recorder (`src/host/media/linuxRecorderPort.ts`,
  `src/core/media/record/linux.ts`): a `muse-portal-record` that is not
  shipped throws `missing`; one the trusted-path walk refuses throws
  `unloadable`; a `--probe` the system will not start surfaces through
  `runNativeHelper`. The driver's `available`/`refused` carry the helper's
  sentence. A helper that runs and answers no is still "no portal".
- The trusted-path private-group check (`src/runtime/trustedPath.ts`): the
  Mac branch uses the same shipped-helper selector as the created-path
  commands, and a native-helper fault is rethrown (said by the caller) instead
  of being read as a group that is not private; `verifyTrustedExecutable`
  returns the helper's sentence as the refusal reason.
- The macOS local judge peer (`src/runtime/judge/localHelper.ts`,
  `src/core/judge/local/source.ts`): a peer build output that is not there
  throws `missing` with its own build script
  (`bash native/darwin/build-local-judge.sh`); a peer whose signature
  `codesign` refuses (a failure exit, not a stop or a codesign that never
  started) throws `unloadable`. The judge reads either as the unverified
  answer: its refusal vocabulary is fixed with the MHP lock, so the peer
  reads as unverified, not as an engine failure.
- `nativeHelperError` takes the platform's build row as a parameter, so the
  judge peer names its own script; the vault keeps its one fixed sentence by
  design, untouched.
- Found on the way (pre-existing, unchanged by this lane): the macOS helper
  has no `private-group` mode — the group check's Mac branch starts the
  dictation helper with `['private-group', gid]`, as it did before this lane
  (the old code built the same path and arguments; only the selector moved).
  Section 8, decision 3.

### 2.3 Item 3 — the serial Python is a machine setting (part 3)

- `museSpark.serialPythonPath` (package.json, machine-scoped, max 4096 chars;
  `serialPythonPath` in the agent's `settings.json`; `MACHINE_SCOPED_SETTINGS`
  on both sides, so a workspace cannot set it; settings schema, defaults,
  feature catalog, reference and all 14 tables plus the manifest strings).
- `resolveSerialInterpreter` honours `configured`: one absolute path, used as
  given (so the venv's own `python3` finds its packages), refused inside the
  workspace (lexically or by real path — a project could supply a venv's
  packages) and refused when relative or not a file, each with its sentence.
  Absent or empty resolves `python3` on PATH outside the workspace, as before.
- The runtime reads it at each serial action
  (`src/runtime/runtimeSerialPython.ts`, beside `mediaConverterPath`; no
  workspace file and no environment variable can set it), threaded through
  `entry.ts` → `service.ts` → `nativeSerial.ts`.
- It takes effect where the serial helper runs today, in the agent
  (ACP/headless runtime). The VS Code setting is declared and read but has no
  consumer in the VS Code process yet — there is no serial engine there (item 4) — and takes effect with the maker host's activation wiring. The
  CHANGELOG entry says exactly this.

### 2.4 The resume fix — the helper sentence names the helper's own app

`helperName` (`src/core/nativeHelper.ts`, from SMALLFIX1) returned the last
path segment ending in `.app` anywhere in the helper's path. Under this
resume's sandbox the test root sits below `RLF-SMALLFIX2.app/`, so five
`helperWords` cases said "The native helper RLF-SMALLFIX2.app is missing"
instead of naming `muse-portal-record` — and any install path with an
ancestor ending in `.app` would do the same in the product. Only segments at
or below `native/` count now (the macOS apps ship as
`native/darwin/<app>.app/Contents/MacOS/...`); anything else falls back to
the file name. The portal-missing case now runs both layouts (a plain product
and one nested under `Outer.app`), so the regression is pinned on every
machine however its tmpdir reads. Drill R9b/R9c.

## 3. Proof: real-code tests, real processes, the real CLI

- `test/unit/museStartFault.test.ts` (17 cases): the recorded-lines unit
  cases; `museStartFailure` (a caller-asked stop untouched, status 0 kept, 126
  as `cannotRun` on POSIX and `exited` on Windows); real handshakes that end
  (exit 3 says the status); the real Muse Code CLI refusing a bad sign-in
  file — malformed, a folder, mode 000, schema 99 — each through a real
  `muse serve` in a throwaway home with no network before it refuses; what
  leaves the ACP boundary (each start sentence in full, the backstops with a
  fixed-vocabulary cause, and still flattened when a slot holds a Windows
  path, a newline or 65 chars); `isOpenableFolder` over real folders.
- `test/unit/helperWords.test.ts` (11 cases): real folders, files and
  processes — the portal recorder missing/checkout/unrunnable/open, the Mac
  group check (private walk without the helper, missing, unrunnable), the
  judge peer (missing installed/checkout, unsigned, other platforms untouched).
  The macOS helper is never started (its dictation mode asks for the speech
  permission).
- `test/unit/makerSerialInterpreter.test.ts` (9 cases): the bare-name threat
  is real (a planted `python3` on a relative PATH entry runs); only a planted
  `python3` says what is missing; a set Python inside the workspace (by name
  or by a link) is refused and never runs; a relative or non-file set path is
  refused without falling back to PATH; the agent's settings file is read at
  each use and empty means unset.
- `test/unit/judgeLocalHost.test.ts` (the part-2 expectations plus the
  resume's refactor, which only shares each case's untouched dependencies),
  `test/unit/startText.test.ts`, `test/unit/nativeHelper.test.ts`,
  `test/unit/portalRecord.test.ts` (Linux-only; skipped on this rig): all
  green, repository timeouts, section 6.

The CLI's captured lines (resume capture, 2026-11-01, Muse Code
1.4.14-R7309.1, macOS, throwaway home, dead proxy, no model attempt —
byte-identical to the `RECORDED` lines the tests pin, modulo the home path):

```
compose serve model client: malformed auth file at <home>/.config/muse/auth.json: expected ident at line 1 column 2: expected ident at line 1 column 2
compose serve model client: failed to read auth file at <home>/.config/muse/auth.json: path is not a regular file: path is not a regular file
compose serve model client: failed to read auth file at <home>/.config/muse/auth.json: Permission denied (os error 13): Permission denied (os error 13)
compose serve model client: unsupported auth schema version 99 at <home>/.config/muse/auth.json
```

each preceded by its `muse serve: exit reason recorded: error (...)`
wrapper. The matchers read only the fixed prefixes (`malformed` /
`failed to read` … `auth file at `, `unsupported auth schema version` plus
1-9 digits); the path is never forwarded.

The real agent, `session/new`, on the built dev agent (`node
scripts/build.mjs`, `dist/acp.js`, the ACP SDK's own stream as the client in
`temp/acp/`, dead proxy, 0 Muse requests, no process left afterwards):

| State                                                               | What the editor gets                                                                                                                                                                                                              |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sign-in file malformed, a folder, mode 000                          | `Internal error: Muse Code could not read its sign-in file (muse/auth.json in its configuration folder), so it did not start. Repair or delete that file, then sign in again.`                                                    |
| sign-in file schema version 99                                      | `Internal error: Muse Code's sign-in file is in a format this Muse Code does not support (version 99), so it did not start. Delete the file (muse/auth.json in its configuration folder) and sign in again, or update Muse Code.` |
| binary not executable (mode 644)                                    | `Internal error: This computer would not run Muse Code (exit status 126), so this could not start. Check that the file is the Muse Code program and that you may run it, or reinstall it.`                                        |
| binary exits 0 at once (`/usr/bin/true`)                            | `Internal error: The session could not be started (ProtocolError). The Muse Spark log has the details.`                                                                                                                           |
| binary path does not exist; providers file broken; Muse home broken | `Invalid request: The backend offers no model this agent may use. Check that you are signed in or have stored a key, and that this computer can reach the provider's server, then try again.`                                     |
| agent data folder blocked (`ENOTDIR`)                               | `Internal error: The session could not be started (Error ENOTDIR). The Muse Spark log has the details.`                                                                                                                           |
| folder missing, a file                                              | `Invalid params: The folder to open cannot be used: it does not exist, is not a folder, or this account may not open it. Check the path and open it again.`                                                                       |
| folder relative                                                     | `Invalid params: The editor must give the folder to open as a full path.`                                                                                                                                                         |
| `XDG_CONFIG_HOME` a file                                            | `Authentication required: Muse Code is not signed in; sign in and try again.`                                                                                                                                                     |

No state answers "That did not work". A signed-in Muse Code with a dead proxy
could not be reproduced without a credential (no key may be seen, printed or
stored by a lane): the no-models sentence and the model-catalog path are
covered by the broken-home states above instead.

## 4. Red/green drills

Each: break one thing, run the proving test with the repository's own
timeouts, record the exit code, restore, run again green. Logs under the
worktree's ignored `temp/drills/R*.log`; each break was a single-statement
edit, restored from a copy.

| #   | Break                                                               | Proving run              | Red (exit)        | Green      |
| --- | ------------------------------------------------------------------- | ------------------------ | ----------------- | ---------- |
| R1  | the `malformed`/`failed to read` matcher reads `zzz-no-match`       | `museStartFault`         | 1 (4 of 17 fail)  | 0          |
| R2  | `isOpenableFolder` answers true for a file                          | `museStartFault`         | 1 (1 of 17 fails) | 0          |
| R3  | the boundary's `museStart` allow-list line never matches            | `museStartFault`         | 1 (3 of 17 fail)  | 0          |
| R4  | the portal helper's absence throws a bare error                     | `helperWords`            | 1 (4 of 12 fail)  | 0          |
| R5  | the judge peer's missing source rethrows the raw error              | `helperWords`            | 1 (2 of 12 fail)  | 0          |
| R6  | the group check swallows the helper fault as "not private"          | `helperWords`            | 1 (2 of 12 fail)  | 0          |
| R7  | the resolver ignores the configured Python                          | `makerSerialInterpreter` | 1 (3 of 9 fail)   | 0          |
| R8  | the settings reader answers unset                                   | `makerSerialInterpreter` | 1 (1 of 9 fails)  | 0          |
| R9b | `helperName` searches every segment again (the resume fix reverted) | `helperWords`            | 1 (5 of 11 fail)  | 0          |
| R9c | the same break with a tmpdir holding no `.app`                      | `helperWords`            | 1 (3 fail)        | 1 (2 fail) |
| R10 | the folder check unscoped (fires on list again)                     | `acpServeHandshake`      | 1 (2 of 2 fail)   | 1 (test 2) |

R9c ran under `TMPDIR=/private/tmp/clean-tmp` (removed afterwards): the two
group-check cases fail in both runs because that shared sticky tmpdir's own
ancestor is group/other-writable, so the walk refuses before ever asking the
helper — environmental, unrelated to the break (those cases are macOS-only
and macOS tmpdirs are per-user private). The portal-missing case fails in the
red run and passes in the green one, which proves the `Outer.app` layout pins
the fix on a machine whose tmpdir reads clean. R9b is the clean red/green in
the real environment. R10's green run keeps the suite's environmental test 2
(this rig's PATH, identical on the base); test 1 is red unscoped and green
scoped, which is what the drill proves.

## 5. The packed product

`node scripts/package-acp.mjs --target darwin-x64` after `npm run build`'s
production bundles on the final tree (the universal `npm run package:acp`
stops, as designed, with the Linux helpers missing on a Mac), installed with
`npm install` into a new empty folder with its own `package.json`
(`temp/packed3`, 3 packages, `--ignore-scripts`), and driven through
`initialize` and `session/new` by the
same client against the installed `dist/acp.js` (real Muse Code 1.4.14,
throwaway homes, dead proxy, 0 Muse requests, no process left afterwards).
Production English rides brotli-compressed in `dist/uiText.js`, so the run
itself is the freshness proof: every sentence below arrived through the
packed bundles.

| Installed state                   | What the editor gets                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| no sign-in file                   | `Authentication required: Muse Code is not signed in; sign in and try again.`                                                                                             |
| sign-in file malformed, a folder  | the sign-in-file sentence (as section 3)                                                                                                                                  |
| sign-in file schema version 99    | the unsupported-version sentence (as section 3)                                                                                                                           |
| empty providers file              | the no-models sentence (as section 3)                                                                                                                                     |
| binary not executable             | the would-not-run sentence with exit status 126 (as section 3)                                                                                                            |
| folder missing, a file, relative  | the folder sentences (as section 3)                                                                                                                                       |
| helper moved aside, then restored | `Internal error: The native helper muse-dictate-screen-x64.app is missing from this installation of Muse Spark Code, so this could not start. Reinstall Muse Spark Code.` |

**Serial helper, packed:** not run end to end. It needs a real serial port;
this rig has none attached. What ran instead is section 3's real-process
cases against the same resolver and reader the packed bundle calls, with a
planted `python3` that marks when it runs.

## 6. `npx vitest related`, and the base

`vitest related` over the lane's changed sources in three shards (part 1
plus `logText` and `museCodeBackendManager`; part 2; part 3),
`--maxWorkers=3`, the repository's own timeouts, with `judgeP2Delivery`
(~90 minutes), `runtimeLsp` and the browser suites (`*rowser*`,
`devicesPhase2*`, unstartable on this macOS rig) excluded by name; not
`constants.ts` or `en.ts`, whose closure is the whole battery (the l10n,
reference, catch and build gates stand for them). Base: an extracted
untouched `87a2a9bf2` (`git clone --shared` under `$TMPDIR`, `node_modules`
linked, the built darwin apps linked in).

- Shard A (part 1): **1,453 files (1,365 passed, 41 failed, 47 skipped),
  31,254 tests (177 failed)** in 44 minutes.
- Shard B (part 2): **1,453 files (1,368 passed, 38 failed, 47 skipped)**.
  37 of the 38 were classified in shard A (with `acpServeHandshake` already
  down to test 2 after the scoping fix); the 38th, `resourceProbesDarwin`,
  fails its 1 test alone on both trees. The 3 flaky files passed in this run.
- Shard C (part 3): **19 files (16 passed, 3 failed)**. All 3 were
  classified in shard A (`runtimeMakerCommands`, `runtimeMakerStop`,
  `runtimeMakerTransport`).

Every failing file was then run in a small group on this tree, and every
file still failing was run in the same group on the base:

| Class                                         | Files (failing tests match by name, not just count)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Result                                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mine, fixed                                   | `acpServeHandshake` (2: the folder check fired on `session/list`, where the suite pins the auth and CLI-missing refusals)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | scoped to new/resume (`requiresOpenableFolder`); test 1 green, drill R10                                                                               |
| An artifact of the run                        | `estimatorHistorySources` (passed in the small group)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | load                                                                                                                                                   |
| Flaky counts                                  | `scheduleFireFailures`, `schedulePauseAfterFailures`, `teamCrossBranchAdvisories` (lane 9 fails, rerun 3, base 3 — the rerun equals the base test for test)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | load; SMALLFIX1 measured the same variance                                                                                                             |
| Same failing tests alone on the base and here | `judgeLocalDarwinPid` e2e, `connectorStorageGuard`, `crashMarker`, `createdRegistryQuarantineResume`, `createdRegistryReclaim`, `judgeLocalDarwinDeadline`, `macRss`, `makerLease`, `makerLeaseCrashes`, `makerLeaseIdentity`, `makerSerial`, `makerSerialSession`, `nodeOsAddons`, `osImageBuildUpdateTryboot`, `playbookContainedJob`, `playbookConversation`, `playbookGovernor`, `playbookHeadGit`, `playbookSchedulesInputs`, `playbookWindow`, `providerHeadersStore`, `providerSpend`, `resourceStatusCpu`, `runtimeMakerCommands`, `runtimeMakerStop`, `runtimeMakerTransport`, `teamPlaybookIntegration`, `teamPlaybookRounds`, `teamWorkerCreateBundle`, `treeSyncNoDeadline`, `treesLifecycleNative`, `vault/brokerSocketDirectory`, `vault/vaultPanelBuild`, `vault/vaultStoreScope`, `vault/writerCrashPosix`, `vsixCompression`, `resourceProbesDarwin` (shard B; the same 1 test alone on both trees), `acpServeHandshake` test 2 (the PATH scrub does not remove this rig's `/Users/randy/.local/bin`, so the CLI is found and the auth check answers; identical on base) | **Base.** Causes UNMEASURED beyond that; the set includes suites needing `/bin/ps` (denied in this sandbox), `socat`, and the real OS credential store |

Changed suites, final tree, repository timeouts (no `--testTimeout`):
`museStartFault` (17 passed), `helperWords` (11), `nativeHelper` (19),
`makerSerialInterpreter` (9), `judgeLocalHost` (5 passed, 1 skipped),
`startText` (7): 69 tests, every command exit 0.

## 7. Gates (final tree)

| Gate                                                                                   | Exit                                                                                                     |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `prettier --check` on every touched file                                               | 0                                                                                                        |
| `eslint --max-warnings 0` on every touched `.ts` (29 files)                            | 0                                                                                                        |
| `npm run typecheck` (all projects)                                                     | 0                                                                                                        |
| `node scripts/check-l10n.mjs`                                                          | 0 (14 UI tables, 0 problems)                                                                             |
| `npm run check:reference`                                                              | 0                                                                                                        |
| `npm run check:host-api`                                                               | 0                                                                                                        |
| `npm run check:plan`                                                                   | 0                                                                                                        |
| `npm run check:roadmap`                                                                | 0                                                                                                        |
| `npm run check:catches`                                                                | 0 (all sites and counts match the baseline)                                                              |
| `npm run duplication`                                                                  | 0 (0 clones; the resume's first regression case cloned its neighbour — 1 clone — and was folded into it) |
| `npm run cycles`                                                                       | 0                                                                                                        |
| `npm run deadcode`                                                                     | 0                                                                                                        |
| `npm run build`                                                                        | 0, every budget holds                                                                                    |
| `SEMGREP_ENABLE_VERSION_CHECK=0 SSL_CERT_FILE=/etc/ssl/cert.pem npm run security:sast` | 0 (694 rules, 0 findings)                                                                                |
| `npm run security:audit`                                                               | 0 (2 moderate advisories, 0 exceptions)                                                                  |

Bundle sizes from this lane, all within budget: `acp.js` 420.9 KiB (budget
850), `resourceGovernor.js` 123.9 (125), `teamWorkerOps.js` 14.2 (17),
`screenRecordDrivers.js` 45.7 (60), `runtimeMaker.js` 125.9 (126),
`uiText.js` 114.7 (125), `extension.js` 535.7 (600).

## 8. Not proven, left, and open decisions for the lead

Not run: Windows (no Windows host; the `cannotRun`/`exited` split and the
`isInWorkspace` Windows branch are proven as named-platform unit paths, and
`isFilledSentence` pins a `C:\Users\…` slot as flattened); Linux with real
helpers (the portal logic runs on the `linux` table here; the `muse-created`
file selector and build command are checked by path, not by running a Linux
helper); the serial helper end to end (no hardware); `judgeP2Delivery`,
`runtimeLsp`, the browser suites; `lint:ps`. No hosted CI was available.

Left, each with its reason: the vault's helpers (one fixed sentence by
design); the macOS memory reader (SMALLFIX1's reason stands); item 4 below.

Open decisions:

1. **Item 4: the VS Code maker host's activation wiring.** Verified on the
   final tree: `dist/makerHost.js` has `requestedBy: []` in the lazy
   registry; `src/extension.ts` creates none of `createMakerHost`,
   `MakerCommands`, `createMakerPreviewPanel` or `createMakerTools`; the six
   `museSpark.enableHardware` … `museSpark.openDeviceLog` commands are in no
   manifest. Wiring is not a loader alone: `MakerCommandsDeps`
   (`changeHardware`, `listMachines`, `registerMachine`,
   `registerOctoprintReadOnly`, `removeMachine`, `openDeviceLog`) and
   `VscodeMakerDeps.openApprovalPreview` have no supplier anywhere in `src/`
   — only the deps interfaces name them — and the portable `MachineRegistry`
   is only assembled into the ACP/headless runtime service. Six manifest
   commands with titles in every table, activation wiring, the approval
   preview page, and an activation test inside VS Code (which this macOS rig
   cannot start) is M103's VS Code piece. Options: (a) wire it as its own
   milestone, against the Devices loader pattern, with the packed-VSIX
   real-use run CC-INT6 asked for; (b) leave the host dormant until then.
   Recommendation: (b) — wiring commands onto an engine that does not exist
   in the process would ship dead UI, and two maker stacks already coexist
   (RLF-DEVICES' exact-payload surface is the wired one). CC-INT6/INT8's (a)
   is recorded and disagreed with for that reason.
2. **The `private-group` mode the macOS helper does not have.** The group
   check's Mac branch starts the dictation helper with `['private-group',
gid]` (pre-existing; this lane only moved the selector). Either the helper
   answers that mode by design and should document it, or the check never
   reaches a real answer on a Mac. Recommendation: the helper's owner names
   the mode or the check takes the Linux `id -Gn` path everywhere.
3. **The `muse serve: exit reason recorded` wrapper.** The CLI prints the
   refusal twice (the wrapper, then the line); the matchers read either.
   Recommendation: none — read both, as now.
4. **Decision numbers:** none used.

## 9. Commits

First parent, in order (lane branch `rec/rlf-smallfix2`):

- `87a2a9bf2` Merge `lanes/rlf-smallfix1` into RLF-SMALLFIX2
- `c919a61fb` fix(acp): a session that cannot start says why and what to do (part 1)
- `9c6ffc54c` fix(native): the Linux portal helper, the Mac trusted-path group check and the macOS judge peer say when missing or unrunnable (part 2)
- `bcfc3ea13` feat(maker): a machine-scoped Python for the serial helper (part 3)
- `7caa16248` fix(maker): the serial Python setting's reader names its two expected failures (NARROW)
- `8439da0af` fix(native): the helper sentence names the helper's own app (resume; also carries the lane's PLAN/roadmap/test-refactor set, and the pre-commit hook's `shipped < 0` → `shipped === -1` rewrite, which is semantics-preserving for `lastIndexOf`)
- `6ea443985` fix(acp): the folder-exists check applies to session start only (resume; also folds the `Outer.app` layout into the portal-missing case)
- the record and the PLAN status wording (this commit)
