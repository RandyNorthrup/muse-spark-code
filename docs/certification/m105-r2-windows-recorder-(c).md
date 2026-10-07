# M105 R2 Windows recorder (c)

Windows 11 rig, 2026-10-06; worktree `C:/lanes/M105R2`, branch `m105/r2`.
Read the rig brief, shared common rules, AGENTS.md, PLAN D85/M105, the
Meta coverage research and lane 0's capture/certification handoffs. The rig
brief overrides the common file's old merge and rig-wrapper instructions.
No merge, rebase, push, dependency installation, credential read, external
request, paid call, inference, desktop capture, or microphone recording.

## RVM105R2 corrections: driver

Findings 2 and 4 are fixed. Shutdown is subscribed before any asynchronous
preparation and remains latched across helper preparation, directory reservation
and trust verification for capture and latest import. The subscription is
released on refusal as well as after a launched run. Preview deletion shares
an in-flight or successful promise, tries at most three removals 200 ms apart,
and clears a rejected promise so a later Discard/Cancel can retry.

The driver also renders the fixed helper code `accessDenied` through the new
runtime-read `media.recordingAccessDenied` text in English and all fourteen
translations; it keeps the existing screen-permission recovery distinct.
The complete three-file recorder batch passed **102/102** (driver 59,
native 38, compiler 5), repository timeouts, on Win11. The following controls ran
the whole driver suite and exited 1 with the named test failure. Source bytes
were restored in finally and checked with SHA-256 after each control:

| Finding / guard            | Deliberate break                                           | Named failing regression                                                           | Receipt          |
| -------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------- |
| R2 / 2: early shutdown     | Move subscription back after preparation                   | shutdown during prepareHelper prevents subsequent capture and latest import launch | exit 1; restored |
| R2 / 4: bounded retries    | Stop retries after the first attempt                       | retries a temporary preview lock and shares successful disposal                    | exit 1; restored |
| R2 / 4: failed cache       | Keep a rejected cleanup promise                            | bounds failed deletion and retries on a later Cancel after the lock clears         | exit 1; restored |
| R2 / 2: preparation latch  | Remove shutdown's cancellation latch before a child exists | shutdown during prepareHelper prevents subsequent capture and latest import launch | exit 1; restored |
| R2 / 5: translated refusal | Render accessDenied as capture unavailability              | shows access denial in en at runtime instead of capture unavailability             | exit 1; restored |

Driver restoration SHA-256 at drill time:
`98c82027f00849320e05c45a7e675c38a647c5cde3157d63ce486b59fef6e447`.
After lint fixes and the access-denied cases, all four current driver controls
again exited 1 and restored SHA-256
`d20b8ea9a2b2d6e08b89c217b3666cdea27187a40a85bfb3c3512b8f4f2fa162`.
The final four controls (after moving the unsubscribe binding to satisfy lint)
restored `fb08e3c9988db0908fbbc943088ee88129b86bb422b78f1bb6ac75e90e327ca5`.
The shutdown fixture now acknowledges any wrongly launched helper so its
negative control fails on the result assertion rather than the test timeout.
Ignored receipts: `temp/r2-shutdown-preparation.log`,
`temp/r2-bounded-retry.log`, `temp/r2-failed-cache.log`.

## RVM105R2 corrections: native helper

All five confirmed P2 findings and finding 6's confirmed cancellation gap are
fixed. Finding 6's actual hung-encoder scenario remains unconfirmed on this VM;
its working-desktop receipt is owed, as named in PLAN §9.

- A shared, private `Lifetime` is necessary for the Form and static latest
  dispatch to use the same lifecycle rules. Its lock protects the monotone
  Preparing / Recording / Stopping / Cancelled / Completed state and operation
  registration. Cancellation cannot be overwritten by ordinary Stop or success.
  Cancel calls happen outside the state lock; an operation registered after
  cancellation is cancelled immediately. Picker, file lookup, stream open,
  transcoder preparation and encoding all register their pending handles.
- Capture and latest import validate and hold the owner process before starting
  work. A background watcher observes the held process rather than a reused PID
  or a potentially blocked UI timer. Owner death cancels work and arms an
  independent two-second forced-exit watchdog. Latest import now reads Stop,
  Cancel and EOF, checks cancellation during its bounded copy, and deletes a
  partial or completed copy cancelled before the completion acknowledgement.
- `Win32Exception(5)` emits the fixed `accessDenied` code, mapped by the driver
  to its translated access refusal. Arbitrary exception text never crosses the
  helper boundary. The existing screen-permission refusal remains separate.

Native tests compile the actual helper with the inbox compiler, split metadata
and warnings as errors, once in `beforeAll`. They replace only known-folder
resolution with the test-private folder and add a scheduling barrier after one
real bounded write. The `--latest` dispatch, stdin worker, copy, process-handle
binding, cancellation state and watchdog are the production implementations.
Fake pending WinRT operations obey idempotent cancellation and one completion;
they open no picker, graphics or audio device. A test-only sleeping owner is
the only process intentionally killed.

The first new fixture compilation exposed two reflection-assigned fields under
the unchanged warning gate; explicit null initialization fixed that fixture.
The first scheduled-copy run exposed reflection's exception wrapper in the
test-only folder substitution; that adapter now rethrows the original failure.
Moving Cancel outside the lock exposed a fake operation that completed twice
on concurrent cancellation; its idempotence now matches WinRT. No timeout or
gate was changed for these corrections. The complete recorder batch then
passed **102/102** at repository timeouts. A final failure-path check also
caught cleanup turning an access failure into cancellation before its error
frame. Disposal now preserves the terminal cause while removing unfinished
copies, and a native regression proves that access denial survives cleanup.

## RVM105R2 native guard-fire receipts

All nine controls ran the complete native suite, without filters, skips or
timeout overrides, and exited 1 at the named regression. The helper bytes were
restored in finally and checked after every control. All nine were rerun
against the final, corrected fake-operation semantics.

| Finding / guard           | Deliberate break                                | Named failing regression                                                                 | Receipt          |
| ------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------- |
| 1: atomic cancellation    | Let ordinary Stop overwrite Cancelled           | keeps Cancel atomic when a concurrent normal Stop finishes later                         | exit 1; restored |
| 3: latest owner binding   | Remove --latest's WatchOwner call               | latest import refuses an owner that has already died before copying                      | exit 1; restored |
| 3: latest controls        | Remove --latest's stdin worker                  | latest import observes stdin cancellation during copying and deletes its partial preview | exit 1; restored |
| 3: bounded owner death    | Disable the native forced-exit deadline         | exits on owner death even when native work never cooperates                              | exit 1; restored |
| 3: late copy cleanup      | Remove lifetime disposal's deletion             | deletes a completed private copy when Cancel arrives before acknowledgement              | exit 1; restored |
| 5: access denied          | Remove Win32 NativeErrorCode 5 mapping          | reports Win32 access denial as file access denied                                        | exit 1; restored |
| 6: pending preparation    | Await the operation without registering it      | Stop cancels a pending prepare operation before recording starts                         | exit 1; restored |
| 6: registration race      | Ignore cancellation latched before registration | cancels an operation registered after Cancel was already latched                         | exit 1; restored |
| 5: terminal failure cause | Turn disposal into a Cancel                     | cleanup preserves access denial instead of relabeling it cancellation                    | exit 1; restored |

Helper restoration SHA-256:
`50746cb6d72ccf0bf809d5d039539d6dbce10fb5bd2a23a65abf75966a07bc3e`.
Ignored logs: `temp/r2-atomic-cancel.log`, `temp/r2-latest-owner.log`,
`temp/r2-latest-stdin.log`, `temp/r2-owner-exit.log`,
`temp/r2-late-copy-cleanup.log`, `temp/r2-access-denied-native.log`,
`temp/r2-pending-preparation.log`, `temp/r2-late-pending.log`,
`temp/r2-cleanup-reason.log`.

## Named residuals after RVM105R2

No confirmed P1/P2 code finding is left open. PLAN §9 names these remaining
receipt/policy limits and their follow-up:

- **M105-R2-direct-runtime-receipt:** the VM explicitly refuses WGC; no direct
  recording or actual hung encoder was tested. The lead owes the generated
  encoder smoke and working-desktop capture/Stop/sound/permission receipts.
- **M105-R2-forced-exit-preview:** a forced exit or persistent lock can retain
  an owner-only file. Cooperative copy cancellation is tested to remove it;
  bounded driver cleanup reports exhaustion and allows later preview disposal
  to retry. W/E1/E2 owe confined deletion and crash/lock purge integration.
- **M105-R2-latest-provenance:** modification age identifies the selected file,
  not its capture provenance. Mandatory sniffing, bounds, preview and explicit
  Attach keep this safe pending the lead's timestamp/UI policy decision.
- **M105-R2-host-api-record:** the previously recorded W-owned importer count
  mismatch is unchanged (84 → 85). The portable-boundary check passes. W must
  regenerate/review the record before the full gate can pass.

These limits do not certify direct capture or editor integration. Full quality,
coverage, packaging and the hosted matrix remain the lead's integration gates.

## Final RVM105R2 checks

- Final recorder batch: `windowsScreenRecorder`, `windowsScreenRecorderBuild`,
  `windowsScreenRecorderNative`: **102/102 passed**, no skipped Windows cases.
  Existing compiler regressions `jobBuild` and `mcpJobExecutable`: **6/6
  passed**. **108 distinct tests**, directly on Win11 in sequential batches
  of at most three files and `--maxWorkers=3`, repository timeouts throughout.
- `npm.cmd run typecheck`: all five projects passed. The unit project was
  checked again after the final fixture corrections. The first full check
  caught a resolver incorrectly inferred as a Vitest mock; its explicit
  callable type fixed that test harness without a cast or suppression.
- Changed-file ESLint passed for all five changed TypeScript files. The
  original hooks also ran lint/format and staged gitleaks on the driver commit.
- Changed-file Prettier check and `git diff --check`: passed. Final helper
  and driver hashes match the byte-restoration receipts above.
- `npm.cmd run deadcode`: passed, with only the existing configuration hints.
- `npx.cmd jscpd`: zero clones across 1,170 files. Its first run caught six
  duplicated preview-setup lines; the two cleanup regressions now share one
  fixture setup while keeping their independent assertions and failure modes.
- Localization: all 14 tables, 164 manifest strings and 593 source files,
  **zero problems**. The new access-denied key has a real translation in every
  table, and all fifteen runtime language cases passed.
- `npm.cmd run check:host-api`: the existing W-owned 84 → 85 `node:path`
  importer mismatch remains the sole failure; 332 VS Code APIs, 31 importing
  files, 25 Node built-ins and 61 theme variables. Portable-boundary checks
  pass. The original lane receipt below records this same mismatch.
- `npm.cmd run build`: size, split, host-global and notices checks all passed.
  Existing artifacts remain under their unchanged caps. W still owns the
  complete `screenRecord.js` factory, its package members and integration.

| Artifact                                                      |   Fresh size |                                 Existing cap |
| ------------------------------------------------------------- | -----------: | -------------------------------------------: |
| activation                                                    |    436.8 KiB |                                      600 KiB |
| Model API                                                     |    446.7 KiB |                                      475 KiB |
| ACP                                                           |    816.9 KiB |                                      850 KiB |
| compressed English fallback                                   |     49.3 KiB |                                      125 KiB |
| browser startup JS and static imports                         |    899.0 KiB |                                      900 KiB |
| deferred browser JS                                           |     49.7 KiB |                                       50 KiB |
| standalone owned Windows driver, shared UI/validation plugins | 12,509 bytes | complete recorder bundle remains W's receipt |

## Original delivered scope (before RVM105R2)

- `src/core/media/record/windows.ts` implements lane 0's driver and a separate
  latest-recording entry point through explicit injected ports. It has no
  editor, provider, transport, upload or tool dependency. User action and
  local-host admission precede helper preparation. Only one run is admitted
  across asynchronous preparation. Paths use Windows path semantics.
- The helper is verified immediately before launch. The host supplies direct
  spawning with an argument array and a credential-free environment, a
  unique reserved path, bounded stdout/exit delivery, the M1 byte sniffer and
  host close/sleep cancellation. No production fake or substitute sniffer is
  supplied on this base.
- The Windows helper resolves the real Videos known folder, including user
  local redirection, then `Screen Recordings`. It selects the newest recent mp4,
  case-insensitively, only in that folder. It refuses stale/future, empty,
  oversize and reparse sources, locks out writes/deletes during copying and
  binds the held handle to its canonical path. The original stays intact.
- Copies and capture output use a directory created atomically with a
  protected DACL granting only the current user full access. An existing
  directory is refused. Failed cleanup deletes only the known output and
  empty private directory; it never recursively removes an existing folder.
- The direct capture implementation uses Windows.Graphics.Capture's picker,
  free-threaded D3D11 frame pool and MediaTranscoder's Media Foundation
  H.264/AAC pipeline. A visible native window provides Stop and countdown;
  the OS capture border remains on. WASAPI opens the microphone and/or
  render loopback only when explicitly selected. Both default off. It
  observes EOF/parent exit, window close and suspend, and caps duration and
  random-access sink size. **This direct-capture path is not certified;
  the failed encoder probe below must be resolved before enabling it.**
- A successful helper exit still needs an explicit completion frame and
  strictly validated, sniffed mp4 metadata. A bad/missing/unknown frame,
  crash, bad duration/size/soundtrack or cancellation refuses the result and
  removes the private copy. Cancellation during sniffing remains effective.
  Stop finalizes; Cancel/discard removes; preview disposal is idempotent.
  Nothing is uploaded or attached by the driver itself.
- The `jobBuild.ts` entry lazily reads and compiles the shipped source,
  names its executable by source digest, validates compiler/helper through
  the trusted-path port and checks the helper identity. Recorder compilation
  and its identity check get only `SystemRoot`, never `process.env`. It uses
  inbox .NET Framework assemblies and split Windows WinMetadata; no SDK
  download, npm dependency, PowerShell or PATH compiler. Existing shell/MCP
  build behavior is preserved.

## Native checks and failed experiment

The real helper compiles with Windows' inbox compiler and metadata, with
warnings treated as errors in the native-check suite. Its `--self-test`
identity check succeeds without opening a screen or audio device. A separate
`--probe` refuses direct recording on this rig: the initial WGC probe raised
“The specified service does not exist as an installed service.” No OS
service, privacy policy or security setting was changed.

A test-only synthetic encoder experiment in ignored `temp/` generated black
pixel buffers, with no desktop/audio capture and no provider request. The
first attempt failed with `0xC00D36E6` (missing attribute). Setting input
frame rate and pixel aspect changed the failure to `0xC00D6D60` (valid media
type not set). Setting explicit output bitrate and pixel aspect still failed
with `0xC00D6D60`. The two configuration corrections remain in the helper;
they do not establish successful encoding. The common brief requires:

> If the same test fails twice after two different fixes, STOP that path

Work on that encoder path stopped. The lead must diagnose its valid-type
failure and record a successful generated H.264 smoke before enabling direct
recording. The experiment is not a passing test, a permission receipt, or a
claim that the Media Foundation runtime works here. Latest-file import and
the fake driver/real native guard suites are independently verified.

## Named integration handoffs

1. **W: lazy recorder factory and packaging.** Bind the ports in
   `dist/screenRecord.js`, with its own budget and split checks, using
   `native/windows/MuseSparkScreenRecord.cs` as `readSource`. Keep native
   source reading and all recorder UI out of activation. No existing cap is
   raised. This lane does not edit W's build, graph, package or manifest files.
   Install the caller's language table before constructing the lazy factory,
   as each Node bundle owns its own installed-language state.
2. **W/E1/E2: trusted process and lifetime.** Reserve a unique, absent
   absolute directory named `muse-spark-screen-<random>` under the trusted
   temp root. Validate installed compiler/helper paths at both build and
   launch. Spawn directly with only the OS environment needed; never inherit
   credentials. Buffer and bound helper lines, drain stdout before delivering
   exit, handle spawn failures as exits, close stdin on owner death and
   guarantee that the kill port settles after the helper releases handles.
   Confine removal to the reserved directory. Purge orphan private previews
   after owner crashes; the driver cannot remain alive after its host dies.
3. **M1: inspect port.** Bind the bounded byte sniffer to the known
   `recording.mp4` output; never accept the helper's word or extension as
   evidence of content. Latest-file import remains usable when `--probe`
   cannot establish direct capture availability.
4. **E1/E2/E3: interactive preview.** Obtain a real user gesture, show the
   sound options with both unchecked, pass the configured duration/byte cap,
   render countdown/Stop and preview before Attach/Discard. Return only an
   opaque host token to browser panels. Call `preview.dispose()` after
   upload or discard. Remote/headless callers get the named refusal and the
   companion/file fallback; no tool, hook or schedule grants the gesture.
5. **M2/C: attachment/model gate.** Apply the selected model's capability
   record and the screen-recording contributor question before sending, on
   every provider and backend. The recorder itself makes no model choice,
   paid call or upload and cannot bypass these downstream gates.
6. **W: docs/reference.** `featureCatalog.ts`, `gen-reference.mjs` and
   `check:reference` are absent on this base. Add registry/reference rows for
   **Attach screen recording…**, **Attach latest screen recording**, ACP
   `/record` and `screenRecordingMaxSeconds` when integrating. README,
   CHANGELOG, PRIVACY, SECURITY, ACP/editor docs and manifests are W-owned.
   Describe private preview/copy disposal and Snipping Tool's recent-folder
   fallback; do not advertise direct Windows recording until its checks pass.
   All wording used here already exists in lane 0's fully translated media
   table; no new translation key or manifest contribution is needed here.

| Editor family                                              | Windows implementation handoff                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| VS Code, VSCodium, Cursor, Windsurf, Kiro, Positron, Theia | E1 binds the same portable driver, native UI and private preview               |
| Remote SSH, WSL, Dev Containers, Codespaces, code-server   | local screen unavailable; E1/E3 bind companion/file fallback                   |
| JetBrains, Visual Studio, Eclipse                          | M104b–d runtime/bridge supplies the same ports and opaque attachment tokens    |
| Zed, Xcode, Qt Creator, Neovim, Emacs, Sublime             | E2/E3 bind interactive `/record` or companion entry point                      |
| Other ACP clients                                          | E2 supplies interactive action, permission/options and preview via the runtime |
| Headless exec, hooks, schedules, subagents, team workers   | no interactive action grant; refused before preparation                        |
| Every model/vendor                                         | recording is local; attachment dispatch belongs to M2's capability gate        |

The editor matrix is a binding handoff, not an executed editor certification.
No other lane's owned files were edited. No escape hatch, ignore, threshold,
timeout, gate level, dependency pin or machine setting was changed.

## Verification and red drills

All commands run directly on `win11`. Every Vitest run uses at most three
files and `--maxWorkers=3`, with the repository's default per-test timeout.
No run uses `--testTimeout`. Native setup compiles once in `beforeAll`.
Final checks and the named, byte-exact red-drill table follow below.

## Owed direct-capture checks

- Resolve the failed generated encoder smoke (`0xC00D6D60`).
- On a working desktop, the user's explicit OS selection must produce a
  sniffed H.264 mp4, with sound off, microphone only, system audio only and
  both selected. Check AAC sound actually plays and is synchronized.
- Check early Stop, exact maximum, byte-cap failure, Discard/Attach cleanup,
  owner crash/EOF, native window close, host close and sleep/suspend.
- Check OS permission refusal and recovery without changing privacy settings
  on the user's behalf; retain visible picker, border, countdown and Stop.
- W/E1/E2/E3's exact lazy bundle, package, preview, model/contributor and editor
  integration gates; full quality/coverage/security and hosted OS matrix.

These owed checks keep M105 delivery c open; this lane is not a release or
support claim for direct Windows recording.

## Original lane checks (before RVM105R2)

- Final Vitest batch: `windowsScreenRecorder`, `windowsScreenRecorderNative`,
  `windowsScreenRecorderBuild`: **67/67 passed** (no skipped Windows checks).
- Compiler regression batch: existing `jobBuild` and `mcpJobExecutable`:
  **6/6 passed**. Total distinct tests: **73**, all at the repository timeout,
  directly on `win11`, in sequential batches of at most three files.
- All five `npm run typecheck` projects passed on the final code/test shape.
- Changed TypeScript ESLint/Prettier passed through the first commit's
  unchanged hooks. Its staged gitleaks scan found no leaks. Final formatting
  and lint results are checked again with the certification commit.
- `npm run deadcode`: passed (only the existing configuration hints).
- `npm run cycles`: passed. A separate dpdm run rooted at the new driver and
  recorder build entry passed, including their eight dependency files.
- `npx jscpd`: passed, 1,170 files, zero clones. The first run fired on seven
  duplicated assertion lines in the two admission cases. They now share a
  parameterized test, retaining both names, cases and assertions. Their
  trusted-path and expired-action red controls were rerun after this change;
  both failed by name and restored the driver byte-exact.
- `node scripts/check-l10n.mjs`: 14 tables, 164 manifest strings, 593 source
  files, **zero problems**. No string or manifest key was added in R2.
- `npm run build`: passed all existing size, split, host-global and notices
  gates. **No cap was raised.** This is the base's production build; W still
  owns adding the recorder bundle and packaging its native source.
- `npm run check:host-api`: **one generated-record mismatch remains for W**:
  the `node:path` importer count is **84 → 85**. The record still reports 332
  VS Code APIs, 31 importing files, 25 Node built-ins and 61 theme variables;
  the new driver imports no `vscode`. `docs/ide-compatibility/host-api.md` is
  W-owned, so it was not changed here. W must regenerate/review it with the
  integrated lanes before claiming a green full gate. No gate was ignored or
  weakened to conceal this mismatch.
- Full `quality`, coverage, security/a11y/editor suites are reserved for the
  integrating lead by the common brief; they were not run by this lane.

| Artifact                         |                Measured | Existing cap / interpretation                                                                          |
| -------------------------------- | ----------------------: | ------------------------------------------------------------------------------------------------------ |
| activation                       |               436.8 KiB | 600 KiB                                                                                                |
| Model API                        |               446.7 KiB | 475 KiB                                                                                                |
| ACP                              |               816.9 KiB | 850 KiB                                                                                                |
| checkpoint store                 |                77.0 KiB | 225 KiB                                                                                                |
| compressed English fallback      |                49.2 KiB | 125 KiB                                                                                                |
| chat startup JS + static imports |               898.9 KiB | 900 KiB                                                                                                |
| deferred browser JS              |                49.7 KiB | 50 KiB                                                                                                 |
| standalone Windows driver        | 12,060 bytes (11.8 KiB) | uses existing shared UI/validation plugins; not a complete integrated `screenRecord.js` budget receipt |

The standalone measurement bundles the owned driver to ignored `temp/` with
the existing shared UI/validation plugins and the same Node target/minifier.
It does not modify build scripts, budgets, package members or production
entrypoints. Capture implementation and host/API record integration remain
open exactly as noted above.

## Original guard-fire record (before RVM105R2)

All **47** controls below exited 1 with named failures. Every source was
restored in finally and its SHA-256 matched the saved bytes. Each control ran
the complete owning suite; no test filter, skip, timeout override or gate change.

| Guard deliberately broken         | Suite                                 | Named failing test                                                                         | Result               |
| --------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------- |
| interactive entry                 | `windowsScreenRecorder.test.ts`       | refuses tools, hooks and headless entry points before preparation or import                | exit 1; SHA restored |
| local screen                      | `windowsScreenRecorder.test.ts`       | refuses a remote host without launching any helper                                         | exit 1; SHA restored |
| single admission                  | `windowsScreenRecorder.test.ts`       | admits one recording across asynchronous preparation and releases admission after exit     | exit 1; SHA restored |
| recording duration contract       | `windowsScreenRecorder.test.ts`       | refuses invalid recording bounds 0 before launch                                           | exit 1; SHA restored |
| byte cap admission                | `windowsScreenRecorder.test.ts`       | refuses an invalid byte cap 0                                                              | exit 1; SHA restored |
| absolute helper                   | `windowsScreenRecorder.test.ts`       | requires an absolute helper path relative.exe                                              | exit 1; SHA restored |
| trusted launch path               | `windowsScreenRecorder.test.ts`       | revalidates the helper through the trusted-path port immediately before launch             | exit 1; SHA restored |
| maximum stop                      | `windowsScreenRecorder.test.ts`       | starts countdown only after capture begins, stops at the maximum and preserves the preview | exit 1; SHA restored |
| stop watchdog                     | `windowsScreenRecorder.test.ts`       | kills a helper which ignores Stop, waits for exit and refuses its unfinished output        | exit 1; SHA restored |
| strict helper frames              | `windowsScreenRecorder.test.ts`       | rejects malformed or byte/path-bearing helper output                                       | exit 1; SHA restored |
| duplicate capture acknowledgement | `windowsScreenRecorder.test.ts`       | cancels a duplicate start acknowledgement instead of running a second countdown            | exit 1; SHA restored |
| completion acknowledgement        | `windowsScreenRecorder.test.ts`       | refuses success without a completion acknowledgement                                       | exit 1; SHA restored |
| successful exit                   | `windowsScreenRecorder.test.ts`       | refuses a crashed helper even when it has emitted completion                               | exit 1; SHA restored |
| shutdown cancellation             | `windowsScreenRecorder.test.ts`       | cancels on host close or sleep and removes the private file                                | exit 1; SHA restored |
| late cancellation                 | `windowsScreenRecorder.test.ts`       | keeps host-close cancellation in force while the byte sniffer is still pending             | exit 1; SHA restored |
| sniff metadata boundary           | `windowsScreenRecorder.test.ts`       | sniffs the output and refuses invalid/capped/mismatched media 6                            | exit 1; SHA restored |
| sniffed container                 | `windowsScreenRecorder.test.ts`       | sniffs the output and refuses invalid/capped/mismatched media 4                            | exit 1; SHA restored |
| nonempty output                   | `windowsScreenRecorder.test.ts`       | sniffs the output and refuses invalid/capped/mismatched media 0                            | exit 1; SHA restored |
| output byte cap                   | `windowsScreenRecorder.test.ts`       | sniffs the output and refuses invalid/capped/mismatched media 1                            | exit 1; SHA restored |
| known output duration             | `windowsScreenRecorder.test.ts`       | sniffs the output and refuses invalid/capped/mismatched media 2                            | exit 1; SHA restored |
| output duration cap               | `windowsScreenRecorder.test.ts`       | sniffs the output and refuses invalid/capped/mismatched media 3                            | exit 1; SHA restored |
| explicit soundtrack               | `windowsScreenRecorder.test.ts`       | sniffs the output and refuses invalid/capped/mismatched media 5                            | exit 1; SHA restored |
| failure cleanup                   | `windowsScreenRecorder.test.ts`       | passes explicit per-recording sound choices, bounds and localized indicator labels         | exit 1; SHA restored |
| idempotent preview disposal       | `windowsScreenRecorder.test.ts`       | passes explicit per-recording sound choices, bounds and localized indicator labels         | exit 1; SHA restored |
| compiler trust                    | `windowsScreenRecorderBuild.test.ts`  | verifies the compiler before spawning it                                                   | exit 1; SHA restored |
| helper trust                      | `windowsScreenRecorderBuild.test.ts`  | verifies the built helper before its identity check                                        | exit 1; SHA restored |
| helper identity                   | `windowsScreenRecorderBuild.test.ts`  | refuses an incorrect identity reply                                                        | exit 1; SHA restored |
| compiler environment whitelist    | `windowsScreenRecorderBuild.test.ts`  | reads and compiles on first use, caches, and references only inbox assemblies/metadata     | exit 1; SHA restored |
| owner-only access                 | `windowsScreenRecorderNative.test.ts` | atomically creates a protected DACL granting only the current owner                        | exit 1; SHA restored |
| exclusive private directory       | `windowsScreenRecorderNative.test.ts` | refuses an existing destination without deleting or modifying its contents                 | exit 1; SHA restored |
| reserved directory namespace      | `windowsScreenRecorderNative.test.ts` | refuses a destination outside the reserved recording namespace                             | exit 1; SHA restored |
| canonical output path             | `windowsScreenRecorderNative.test.ts` | refuses a noncanonical reserved destination before creating or deleting anything           | exit 1; SHA restored |
| native/shared bounds              | `windowsScreenRecorderNative.test.ts` | keeps native bounds identical to the shared contract                                       | exit 1; SHA restored |
| protected private DACL            | `windowsScreenRecorderNative.test.ts` | atomically creates a protected DACL granting only the current owner                        | exit 1; SHA restored |
| recent recording age              | `windowsScreenRecorderNative.test.ts` | refuses stale recordings before copying                                                    | exit 1; SHA restored |
| mp4 selection                     | `windowsScreenRecorderNative.test.ts` | copies the newest recent mp4, case-insensitively, byte-exact into a private preview        | exit 1; SHA restored |
| top-level selection               | `windowsScreenRecorderNative.test.ts` | does not descend into subfolders or take other filename extensions                         | exit 1; SHA restored |
| latest ordering                   | `windowsScreenRecorderNative.test.ts` | copies the newest recent mp4, case-insensitively, byte-exact into a private preview        | exit 1; SHA restored |
| folder reparse refusal            | `windowsScreenRecorderNative.test.ts` | refuses a junction in place of the Snipping Tool folder                                    | exit 1; SHA restored |
| held source path                  | `windowsScreenRecorderNative.test.ts` | binds the held source to its canonical path and refuses a redirected ancestor              | exit 1; SHA restored |
| empty source admission            | `windowsScreenRecorderNative.test.ts` | refuses an empty latest file                                                               | exit 1; SHA restored |
| file write cap                    | `windowsScreenRecorderNative.test.ts` | enforces the private file cap on fileWrite                                                 | exit 1; SHA restored |
| file size cap                     | `windowsScreenRecorderNative.test.ts` | enforces the private file cap on fileLength                                                | exit 1; SHA restored |
| random-access sink cap            | `windowsScreenRecorderNative.test.ts` | enforces the Media Foundation random-access sink cap on streamSize                         | exit 1; SHA restored |
| output substream cap              | `windowsScreenRecorderNative.test.ts` | enforces the Media Foundation random-access sink cap on streamOutputWrite                  | exit 1; SHA restored |
| clone sink cap                    | `windowsScreenRecorderNative.test.ts` | enforces the Media Foundation random-access sink cap on streamClone                        | exit 1; SHA restored |
| current interactive action        | `windowsScreenRecorder.test.ts`       | refuses a user action which expires during asynchronous preparation                        | exit 1; SHA restored |

Restoration hashes at control time:

- `native/windows/MuseSparkScreenRecord.cs`: `d7cfd1a3e5378c40aa1e4e0986915c5ea94502008e8ccc37b4424694bbb516e0`
- `src/core/media/record/windows.ts`: `2b32face27711e0a2b56b9d5ee8c37e2bb1fb68380c45857b4bcfdd58d710f53`, `77ccc77696c51a5f413ca72a909be83dd864487139c1bdd9a2288d98e5e9d554`
- `src/host/backend/jobBuild.ts`: `072f88c5841f2413bafbd8439dcc252e51cf19e4fe70007b3c88cd46f33af293`

The additional current-gesture guard was added after the original driver
controls; its own control records the second driver hash. Final source hashes
may differ after formatting, without changing the guard behavior.

The DACL control removes protection and introduces a broad World-SID grant.
Changing only the protection flag left an effectively protected owner-only ACL
on this rig, so that first attempt was not counted as a red. The composite
privacy control and the separate owner-only control both fail the actual
DACL/identity checks. The whitelist control adds a harmless marker, rather than
printing or passing the real process environment or a credential.
