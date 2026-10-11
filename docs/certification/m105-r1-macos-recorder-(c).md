# M105 R1 macOS recorder (c)

Mac mini, 2026-10-06; branch `m105/r1`, base `386729cf`.
Read the rig brief, common rules, AGENTS.md, PLAN D85 and M105 in full,
the media research record (especially §2/§6), and lane 0's
capture/certification records.
No network, live, paid or subscription calls; no credentials accessed;
no privacy settings changed; no dependency added. No merge, rebase or push.

## Portable driver delivered

`src/core/media/record/macos.ts` implements lane 0's recorder contract.
It validates explicit sound choices and duration, refuses remote/non-macOS
hosts and missing/relative helpers, strips credential variables and the
inherited disclaim marker, writes into a 0700 temporary directory, and
returns a 0600 mp4 preview only after a validated finished frame and clean
stdio exit. It bounds startup, recording and shutdown; handles Stop,
Cancel, duplicate/out-of-order/oversized frames and partial UTF-8; verifies
sniffed metadata and file size; and deletes partial/discarded output.
Cancellation during inspection also discards the file. Native stderr and
exit descriptions never enter the user result or a log.

Both permission refusals offer the caller a typed recovery callback;
`openMacosRecordingPermissions` opens exactly the Screen Recording or
Microphone pane through the editor's injected opener, only when the user
chooses the recovery action. Existing lane-0 translated media messages
are read at use time. No language table or manifest change is needed.

The driver never uploads or registers a tool. Interactive authorization,
model capability checks and the preview's Attach/Discard surface remain
with E1/E2/E3/W, exactly as the lane table assigns them.

## Integration handoffs (owned by other lanes)

- **M1 inspect:** bind `inspect(path)` to its bounded file sniffer. No fake
  production sniffer is provided.
- **E1/E2/E3 spawn:** adapt direct process spawning to `HelperChild`, passing
  the supplied argument array and sanitized environment unchanged. `onExit`
  must run after stdout EOF; `kill` must terminate the entire owned process
  tree even when it is stuck. Supply the installed absolute helper path,
  a local temporary root, platform and remote-window facts. The result's
  private path stays out of the webview; the host issues its preview token.
- **W tunables/lazy bundle:** bind the injected startup/finish timeouts and
  protocol cap to named `SCREEN_RECORDING_*` constants in
  `src/shared/constants.ts`. Tested values: 30,000 ms, 30,000 ms and 4,096
  characters. Add the driver to lazy `dist/screenRecord.js`; keep startup
  and deferred budgets unchanged. Add the permission-free native test runner
  to macOS CI. This lane does not edit lane 0/W files.
- **W generated host record:** `check:host-api` reports exactly the four
  Node import-count changes: node:buffer 39→40, node:fs/promises 47→48,
  node:path 84→85, node:string_decoder 1→2. Refresh the W-owned generated
  record during integration. VS Code API counts stay 332 in 31 files.
- **W docs/reference:** the base has no featureCatalog.ts or reference
  generator. List Attach screen recording, explicit sound choices,
  bounded duration, private preview/disposal and permission recovery in
  the integrated registry/reference and README. CHANGELOG should say:
  “Added a macOS screen recorder using the operating system's H.264/AAC
  encoders, with bounded lifecycle, private previews and permission recovery.” Do not advertise the command
  before the entry-point/preview lanes are bound. Document the successfully
  run native validation commands: `bash native/darwin/build.sh`,
  `bash native/darwin/check-disclaim.sh --screen-only`, and
  `bash test/native/darwin/run-screen-record.sh`. The editor port is
  shared by VS Code-family hosts, native MHP hosts and interactive ACP;
  remote hosts use the planned companion/file path; headless/tools refuse.

## Portable validation

- Owned Vitest file: **37/37 passed**, directly on macmini with
  `npx vitest run test/unit/macosScreenRecording.test.ts --maxWorkers=3`.
  Repository default timeout throughout; no --testTimeout or filtered tests.
- All five `npm run typecheck` projects passed; unit typecheck passed again
  after additional edge cases. Changed TypeScript ESLint and Prettier pass.
- `node scripts/check-l10n.mjs`: 14 tables, 164 manifest strings,
  593 source files, **0 problems**.
- `npm run deadcode` passes (two pre-existing knip configuration hints).
  `npx jscpd` passes: 1,168 files, zero clones.
- `npm run build` passes all size, split, host-global and notice gates:
  extension 436.7/600 KiB, Model API 446.7/475, ACP 816.8/850,
  wire 43.1/50, compressed English 49.2/125, checkpoint store 77.0/225;
  **startup 898.9/900 KiB**, **deferred 49.7/50 KiB**. No cap was raised.
  The new driver awaits W's lazy-bundle binding; these are the current
  shipped bundles, not a claim that integrated screenRecord.js is gated.
- Host API has the single generated-record deferral described above.
- Full quality/coverage is reserved for the integrating lead by the common
  rig rules. No gate, rule, ignore, threshold, timeout or hook was weakened.

## Portable red drills

Each row runs the entire owned file and exits 1 with the named failure.
Source is restored in finally and SHA-256 compared before the next run.
The first isolated video-kind mutation stayed green because the strict
schema and mime/sound checks also enforce that type; the grouped metadata
mutation below fails wrongKind, wrongMime and unexpected/unknownSound.
That non-failing exploratory mutation is not counted as a red drill.

| Guard broken                 | Named failing test                                                                                             | Outcome         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------- |
| remote refusal               | refuses remote, non-macOS, missing and relative helpers before spawning                                        | 1; SHA restored |
| macOS platform               | refuses remote, non-macOS, missing and relative helpers before spawning                                        | 1; SHA restored |
| absolute helper              | refuses remote, non-macOS, missing and relative helpers before spawning                                        | 1; SHA restored |
| missing helper               | refuses remote, non-macOS, missing and relative helpers before spawning                                        | 1; SHA restored |
| recording options boundary   | validates explicit audio selections and duration before creating files                                         | 1; SHA restored |
| provider key environment     | passes only absolute command and argument arrays, drops credentials and the inherited disclaim marker          | 1; SHA restored |
| named credential environment | passes only absolute command and argument arrays, drops credentials and the inherited disclaim marker          | 1; SHA restored |
| disclaim marker environment  | passes only absolute command and argument arrays, drops credentials and the inherited disclaim marker          | 1; SHA restored |
| private folder mode          | passes only absolute command and argument arrays, drops credentials and the inherited disclaim marker          | 1; SHA restored |
| private file mode            | stops early and returns a private preview only after finished and a clean exit                                 | 1; SHA restored |
| no unfinished success        | refuses noFinished output and deletes the whole private folder                                                 | 1; SHA restored |
| clean exit                   | refuses crash output and deletes the whole private folder                                                      | 1; SHA restored |
| regular file                 | refuses directory output and deletes the whole private folder                                                  | 1; SHA restored |
| nonempty file                | refuses empty output and deletes the whole private folder                                                      | 1; SHA restored |
| file size cap                | refuses oversize output and deletes the whole private folder                                                   | 1; SHA restored |
| sniffer boundary             | refuses malformedMetadata from the sniffer                                                                     | 1; SHA restored |
| video metadata group         | refuses wrongKind output and deletes the whole private folder                                                  | 1; SHA restored |
| mp4 mime                     | refuses wrongMime output and deletes the whole private folder                                                  | 1; SHA restored |
| file size matches metadata   | refuses wrongSize output and deletes the whole private folder                                                  | 1; SHA restored |
| known duration               | refuses unknownDuration from the sniffer                                                                       | 1; SHA restored |
| maximum duration             | refuses longDuration from the sniffer                                                                          | 1; SHA restored |
| explicit soundtrack          | refuses unexpectedSound from the sniffer                                                                       | 1; SHA restored |
| cancel during inspection     | cancels while inspection is pending and deletes the completed recording                                        | 1; SHA restored |
| stop idempotent              | stops early and returns a private preview only after finished and a clean exit                                 | 1; SHA restored |
| startup deadline             | bounds startup and a helper that ignores Stop, even if the adapter never reports exit                          | 1; SHA restored |
| finish deadline              | bounds startup and a helper that ignores Stop, even if the adapter never reports exit                          | 1; SHA restored |
| helper line cap              | refuses malformed, unsolicited, byte-bearing or oversized helper frames (oversized frame)                      | 1; SHA restored |
| helper boundary              | refuses malformed, unsolicited, byte-bearing or oversized helper frames ({"type":"recording","bytes":"canary"} | 1; SHA restored |
| finished ordering            | refuses malformed, unsolicited, byte-bearing or oversized helper frames ({"type":"finished"}                   | 1; SHA restored |
| recording ordering           | decodes split lines and refuses duplicate recording notifications                                              | 1; SHA restored |
| partial EOF                  | refuses partialLine output and deletes the whole private folder                                                | 1; SHA restored |
| partial UTF8 EOF             | refuses partialUtf8 output and deletes the whole private folder                                                | 1; SHA restored |
| screen recovery mapping      | offers the correct recovery for screenPermissionDenied without storing native stderr or paths                  | 1; SHA restored |
| microphone recovery mapping  | offers the correct recovery for microphonePermissionDenied without storing native stderr or paths              | 1; SHA restored |
| maximum Stop                 | counts down from recording readiness and sends Stop exactly at the maximum                                     | 1; SHA restored |

Driver SHA-256 before/after the 35 successful drills:
`bf3a09ed67ffbc15f1d93d90ec0067b59ab434536af69cc96bc7e378806dadde`.
The later lint-only permission-mapping rewrite was re-drilled for both
panes; those two runs also exit 1 with their respective recovery test and
restore the final source SHA, recorded with the native completion below.

## Native helper delivered

`native/darwin/ScreenRecord.swift` adds `--record-screen` to the existing
helper. The build generates a temporary `main.swift` dispatch after the
existing M28 responsibility relay and before dictation's permission calls;
it refuses a missing/duplicate insertion anchor. Dictation.swift is intact.
The `--probe` mode proves dispatch in the disclaimed copy without requesting
Screen Recording, Microphone or Speech Recognition permission. The usage
strings describe screen contents, explicit microphone selection and preview.

ScreenCaptureKit on macOS 12.3+ captures the main display. AVAssetWriter
produces real-time H.264/mp4, with AAC only for the selected sound sources.
System sound needs macOS 13+. Microphone PCM is retimed from the capture
session's clock to ScreenCaptureKit's host clock, retaining per-sample timing.
When both sources are selected, AVFoundation mixes them into one playable
AAC soundtrack; neither source silently replaces the other. Static frames
remain visible through the bounded recording duration. The OS indicator's
Stop is a successful stop only for the exact ScreenCaptureKit domain/code.

On macOS 12.0–12.2, fixed `/usr/sbin/screencapture -v -V … -D 1` captures
and fixed `/usr/bin/avconvert` produces mp4. `-G` names the default input
device only for explicitly selected microphone sound. It cannot capture
system sound; that request refuses before permissions rather than silently
recording a different source. Finishing capture enters the stopping phase
before conversion, so a late Stop cannot interrupt avconvert. Child launch
is injected into native tests; production directly runs the configured
Foundation Process, with no shell or fake implementation.

Both paths validate options and the owner-only output directory before
permission requests, reject symlinks/overwrites, use umask 077, bound duration
and file size, and return fixed protocol words. Screen denial prevents a
microphone request; an unselected microphone never asks. Cancel, stdin EOF
and signals discard partial output; the fallback kills and waits for its
owned active child. The portable adapter's watchdog covers stuck permission,
start and finalize operations, and its host port must kill the owned process
tree if the native helper cannot finish.

## Native validation

Direct on macmini, macOS 15.7.4, Apple Swift 6.2.4. No installs or privacy
changes. The synthetic suite compiles the production Swift file once and
uses generated 32×32 frames and stereo PCM; all generated files are removed
by the test runner's trap.

- `bash test/native/darwin/run-screen-record.sh` passes with **111 PASS
  assertions** (including repeated pixel-allocation checks). It encodes silent,
  system-only, microphone-only and both-source H.264/AAC mp4; reads actual
  track codecs/container brands; decodes the mixed AAC and detects both
  440 Hz and 880 Hz tones; runs the real avconvert against synthetic media;
  refuses empty/final oversized output; proves private-path/argument and
  permission order; checks OS Stop classification; verifies microphone
  sample timing and static-screen duration; exercises actual native duration
  and size timers with a test-only clock; and covers the late-Stop transition.
  No screen capture, audio input, transcription or network dispatch occurs.
- `bash native/darwin/build.sh` passes: universal arm64/x86_64, minimum
  macOS 12.0, `-Osize`, dead stripping, embedded version **0.14.0** matching
  package.json. `codesign --verify --strict` passes. Both slices weak-link
  ScreenCaptureKit (`LC_LOAD_WEAK_DYLIB`), allowing the older-OS fallback.
  Embedded screen/microphone purpose strings verified. Helper size:
  **437,280 bytes**, raw ZIP-style Deflate payload **150,532 bytes**; this
  is a payload measurement, not a complete packaged VSIX certification.
- `bash native/darwin/check-disclaim.sh --screen-only` passes: exact helper
  responsibility frame from the disclaimed copy, with no permission request.
  Calling `--record-screen` with missing options returns only the fixed
  invalidOptions frame and exit 2 before TCC. No screen is captured.
- `bash -n` passes for build.sh, check-disclaim.sh and run-screen-record.sh;
  `plutil -lint native/darwin/Info.plist` passes.

## Native red drills

Each mutation runs the complete native suite (or the named build/probe
check), sees the named failure, and restores original bytes in finally with
SHA-256 equality. The first AAC→ALAC mutation kept AAC-only bitrate settings
and aborted without a named assertion; it is not counted. Repeating with
valid ALAC settings reaches and fails the actual AAC inspection assertion.
HEVC alternatives at 32×32 and 128×128 fail at the named encoder append
stage on this Intel rig (AVFoundation -12902), before codec inspection. The
first named encoder refusal is counted; the second exploratory attempt is
not. A negative H.264 codec-inspection assertion is therefore not claimed.
No test, gate or production encoding requirement was weakened.

| Guard broken                  | Named failing test                                        | Outcome           |
| ----------------------------- | --------------------------------------------------------- | ----------------- |
| argument count                | extra flag is refused                                     | 1; SHA restored   |
| minimum seconds               | duration 0 is refused                                     | 1; SHA restored   |
| maximum seconds               | duration 601 is refused                                   | 1; SHA restored   |
| positive bytes                | byte cap 0 is refused                                     | 1; SHA restored   |
| maximum bytes                 | byte cap 209715201 is refused                             | 1; SHA restored   |
| explicit booleans             | explicit boolean --microphone                             | 1; SHA restored   |
| absolute output               | relative output is refused                                | 1; SHA restored   |
| directory kind                | regular-file output directory is refused                  | 1; SHA restored   |
| directory owner               | foreign-owned output directory is refused                 | 1; SHA restored   |
| directory mode                | public output directory is refused                        | 1; SHA restored   |
| mp4 output extension          | non-mp4 output is refused                                 | 1; SHA restored   |
| no overwrite or symlink       | dangling output symlink is refused                        | 1; SHA restored   |
| screen permission             | screen denial has its recovery code                       | 1; SHA restored   |
| microphone permission         | microphone denial has its recovery code                   | 1; SHA restored   |
| microphone opt-in             | unselected microphone needs no permission                 | 1; SHA restored   |
| fallback system audio refusal | fallback system audio is refused                          | 1; SHA restored   |
| fallback input device         | missing fallback microphone is refused                    | 1; SHA restored   |
| fallback microphone opt-in    | fallback microphone uses the explicit input device        | 1; SHA restored   |
| OS stop error domain          | foreign errors do not become OS indicator Stop            | 1; SHA restored   |
| OS stop error code            | permission denial is not OS indicator Stop                | 1; SHA restored   |
| live size cap                 | native size cap stops the encoder                         | 1; SHA restored   |
| native duration deadline      | native maximum stops without discarding                   | 1; SHA restored   |
| final nonempty file           | native final-empty refuses finished output                | 1; SHA restored   |
| final size cap                | native final-size refuses finished output                 | 1; SHA restored   |
| H264 encoder                  | append silent.mp4 (AVFoundation -12902)                   | 132; SHA restored |
| AAC encoder                   | AAC sound in system.mp4                                   | 1; SHA restored   |
| mp4 container                 | mp4 rather than QuickTime brand in silent.mp4             | 1; SHA restored   |
| empty writer refusal          | an empty encoder refuses success                          | 1; SHA restored   |
| static frame maximum          | static screen duration is capped at the maximum           | 1; SHA restored   |
| both sound sources mixed      | system sound survives mixing                              | 1; SHA restored   |
| native fallback late Stop     | fallback completion protects conversion from late Stop    | 1; SHA restored   |
| build dispatch anchor         | screen-recording dispatch anchor must appear exactly once | 1; SHA restored   |
| disclaimed screen probe       | screen recording did not run in the disclaimed copy       | 1; SHA restored   |

The 30 original native guards restore SHA-256
`a16347de8be20ba1d3669a28f83323d0597ba89004d39882027dade2e3edcd39`.
The late-Stop correction and its final drill restore native source
`6d5fce1283dbeb62deaadf73748a98039354114c1ed33cf4e48ec6c75ead7e6b`.
The build-anchor and probe drills restore respectively
`abd4dc8d0a43dae044c15d2a5daf9f0bf4f8714dfab2e034191f77a43e336e65`
and `af06f5a46dd57cb1bdcd23a3b9b925cf45eb9183fa1971f7fc614d620dfed8e1`.
Final portable driver source is
`0d5e1f68a643f7c15685ea45e2aef4ff8d51ccaa55b96252a9fcbc51e62083d1`.
There are **70 successful red drill runs**: 35 original driver runs, two
permission-mapping repeats, 30 original native runs, the late-Stop test and
the build/probe checks. Non-firing/exploratory attempts are excluded.

## Remaining permission-gated and integration checks

The brief requires listing these without requesting access or changing
privacy settings. They remain owed, and no live recorder certification is
claimed:

1. On macOS 13+, real main-display capture with sound off, microphone only,
   system sound only, and both. Play the results and bind M1's real bounded
   sniffer to prove each valid mp4, selected soundtrack and duration; verify
   actual microphone/system synchronization and both-source playback.
2. During real capture, Stop early, wait for the configured maximum, Stop
   through the OS indicator, and leave the screen static. Verify the visible
   countdown, OS indicator and helper process lifetime.
3. Denied Screen Recording: the translated refusal, user-selected recovery
   opens the exact pane, permission is granted under the helper's own name,
   and retry succeeds. Denied Microphone when selected: corresponding
   recovery and retry; with microphone off, prove no microphone prompt or
   input capture. Do not use the test rig to revoke existing permissions.
4. Cancel during real capture/finalization, close stdin and send signals;
   verify no helper/capture/converter descendants or partial/private output
   survive. Confirm the host process-tree kill port on a stuck permission
   or encoder. Fake watchdog tests already pass.
5. Real screencapture fallback on macOS 12.0–12.2: silent/microphone,
   early Stop, maximum, valid mp4 after avconvert, cancellation and denied
   permissions. System sound must refuse. This rig is 15.7.4: older-OS
   testing is separately owed, not just permission-gated.
6. The full pre-existing M28 `check-disclaim.sh` speech-permission/signal
   drill. Only its new `--screen-only` check ran; dictation was not invoked.
7. E1/E2/E3/W bind the named ports/lazy bundle and real preview Attach /
   Discard, disposal after upload, between-turn authorization, model gate,
   no-tool/headless recording refusal and every editor's fake matrix.
   W owns integration docs, the generated host record and the full quality,
   coverage, packaged VSIX/ACP budgets and final live receipts. Recording
   itself is local/free; this lane makes zero model attempts or uploads.

## FIXM105R1 — RVM105R1 corrections (2026-10-06)

All three P2s (including the unconfirmed real-sleep risk) and both P3s are
fixed. No review finding is accepted as a residual. The rig/common rules
reserve aggregate quality, coverage and integration for the lead; no gate,
ignore, threshold, timeout or hook was changed. No network, install,
credential access, model attempt, paid call, real capture or privacy change.

| Finding                                   | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Regression / native receipt                                                                                                                                                                                                                                   | Red drill                                                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1 conversion escaped bounds            | One timer stays alive from capture readiness through writer close, AVFoundation soundtrack export and avconvert. Capture stops at its requested maximum; the whole pipeline has that maximum plus a fixed 30-second close/export grace. Size overflow or the pipeline deadline aborts honestly; avconvert is killed and waited for, and AVFoundation work is cancelled before partial-file removal/exit.                                                                                                                                                                                                                                                                                                                  | `conversion-size` and `conversion-deadline` use the production fallback transition with a permission-free owned converter; both assert its PID is gone and the folder is empty. The existing real H.264/AAC/mix/avconvert tests remain.                       | Cancel the timer at conversion entry; remove the pipeline-deadline abort. Each whole native suite fails its named conversion test.                                                 |
| P2-2 unverified helper launch             | The injected REDM104L3 trusted-root verifier supplies canonical executable/bundle paths and a requirement from trusted release metadata. Absence, rejection, exceptions and malformed bindings refuse. The executable must be inside that exact signed `.app`. Fixed `/usr/bin/codesign --verify --strict -R =<requirement>` runs before **each** probe/record launch, with bounded output/deadline and stripped credentials.                                                                                                                                                                                                                                                                                             | Trusted/untrusted/absent/replaced binding tests; strict signature ordering and repeated checks; stalled/oversize verifier tests. The real native resource check rejects an unsigned helper, a replaced executable and modified signed localization resources. | Bypass trusted-root rejection; bypass signature failure; remove signed-bundle identity checks; remove verification timeout/output cap. Each whole unit suite fails its named test. |
| P2-3 sleep could resume capture           | Native lifecycle subscribes to `NSWorkspace.willSleepNotification` and `screensDidSleepNotification`, runs the Cocoa main loop needed to deliver OS notifications, and requests Stop/finalization. The TS driver requires the editor/runtime power-suspend subscription, sends Stop once, preserves the finalization deadline and unsubscribes on settlement.                                                                                                                                                                                                                                                                                                                                                             | Both native injected notifications are delivered through the Cocoa main loop and finalize without cancellation. Portable suspend, repeated suspend, pre-readiness suspend and absent-binding tests pass.                                                      | Remove native notification Stop; remove portable suspend Stop. Named whole-suite failures, with original bytes restored.                                                           |
| P3-1 misleading availability              | Native read-only `--probe` reports Screen Recording and all four microphone authorization states, a display and real H.264/AAC encoder availability. It calls no permission-request API. The public TS availability check refuses denied/missing/failed/malformed states. Explicit Start retains the native permission request and denial path, screen first and microphone only when selected; it never captures before permission. Undecided microphone permission is unavailable in the public probe and named accurately, separately from denial or a system restriction. Screen preflight reports notAuthorized because false cannot prove a user denial. Silent capture works when microphone permission is denied. | Injected native ungranted-screen/denied/restricted/notDetermined/missing-display/missing-encoder cases and the rig's actual permission-free capture below. Portable permission/display/encoder/probe cases pass without creating recording files.             | Force native screen/microphone authorization or encoder success; bypass portable screen/encoder refusals. Named failures, restored hashes.                                         |
| P3-2 English-only permission descriptions | Three purpose descriptions live in the English media table and all fourteen translations, with matching `InfoPlist.strings` sources. `build.sh` validates and copies them into a signed screen `.app`; a bare Mach-O cannot supply localized bundle resources. Existing bare dictation output is retained; recording binds the `.app` executable.                                                                                                                                                                                                                                                                                                                                                                         | Entire unit suite checks all fourteen plus English against the tables. The real Foundation `Bundle.main` check resolves each of the fourteen languages using process-only argument defaults; signature resource tampering is refused.                         | Remove the German screen-purpose key; the named localization test fails. Restore its exact bytes.                                                                                  |

### Native probe capture and signature evidence

Capture **R1-PROBE-2026-10-06**, worktree `/Users/randy/lanes/M105R1`,
macmini, rebuilt universal helper version 0.14.0. Command:
`env -u MUSE_DICTATE_DISCLAIMED native/darwin/muse-dictate-screen.app/Contents/MacOS/muse-dictate --record-screen --probe`.
It exited 0 and emitted exactly:

```json
{
  "display": "available",
  "encoder": "available",
  "microphone": "notDetermined",
  "responsibility": "helper",
  "screen": "denied",
  "type": "available"
}
```

Zero model attempts; no screen/audio input or permission request. The
original consumer schema and fake producer used that owned native frame shape.
The final follow-up capture below corrects the preflight status word: the
OS does not tell us whether ungranted screen access was explicitly denied.

Real codesign verification uses a requirement naming the expected bundle
identifier and both universal architecture CDHashes. Production receives
these hashes from trusted release metadata, **never** from the candidate
being checked. A Team ID release instead supplies its expected team and
designated requirement. Test hashes are extracted from the known freshly
built positive fixture solely to exercise the OS verifier against copies.

Two exploratory requirement spellings were rejected before any named
assertion: codesign needs `=` for inline requirement text and `H"…"` for
hash literals. A single-architecture CDHash then rejected the other slice
of the universal helper. That single-hash approach was abandoned; the final
check pins both slices. These setup failures are not counted as drills.

Final capture **R1-PROBE-2026-10-06-2** used the same command and
workspace after the status correction, with zero model attempts. It emitted:

```json
{
  "display": "available",
  "encoder": "available",
  "microphone": "notDetermined",
  "responsibility": "helper",
  "screen": "notAuthorized",
  "type": "available"
}
```

This is the final strict consumer/fake shape. `CGPreflightScreenCaptureAccess`
only establishes authorized versus notAuthorized; it cannot establish a
user denial. `AVAuthorizationStatus.notDetermined` is an undecided choice,
so the localized public reason says pending, without claiming a denial or
that a prompt has never been opened. Denied and restricted microphone
states have their own translated reasons. Explicit Start still requests
permissions through the native screen-first/selected-microphone path.

### New red-drill record

**61 successful runs, 19 distinct guards.** Each runs the entire owned unit
file or the entire native suite, exits 1 with the named failure, restores in
`finally`, then compares SHA-256. Six portable drills were repeated after
binding the signed bundle. All nine portable/resource drills were then
repeated on the final source and regression fixtures. The final permission
state refinement added two message-classification drills; all eleven were
run twice, and the six native drills were repeated. The final Cocoa-run-loop
refinement adds its own deliberate break and repeats native sleep Stop; all
repeats are counted.
The deliberate timeout/output-cap removals fail at the unchanged repository
five-second test deadline; the restored tests complete promptly.

| Guard broken                                     | Named failure                                                                                     | Runs |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---: |
| trusted installed root                           | refuses a missing trusted-path port and untrusted workspace, symlink or replaced helpers          |    5 |
| pinned signature result                          | refuses unsigned or replaced signatures before launching the helper                               |    5 |
| host suspend Stop                                | stops once on host suspend and removes its subscription after finalization                        |    5 |
| portable screen authorization                    | reports unavailable screen honestly without recording                                             |    5 |
| portable display/encoder availability            | reports unavailable encoder honestly without recording                                            |    5 |
| German native screen-purpose resource            | binds all fourteen native permission translations to the UI tables and English fallback           |    5 |
| monitored conversion                             | conversion-size monitor stays alive through conversion                                            |    2 |
| pipeline deadline                                | conversion-deadline monitor stays alive through conversion                                        |    2 |
| native sleep Stop                                | native sleep finalizes instead of cancelling / native Cocoa run loop delivers sleep notifications |    3 |
| native screen probe                              | probe reports ungranted Screen Recording access without guessing denial                           |    2 |
| native microphone probe                          | probe honestly reports microphone denial without requesting it                                    |    2 |
| native encoder probe                             | probe refuses an unavailable encoder                                                              |    2 |
| signed bundle identity                           | refuses a helper outside its signed localized bundle                                              |    4 |
| verification watchdog                            | bounds a stalled signature check before launching any helper                                      |    4 |
| verification output cap                          | refuses oversized verification output before launching any helper                                 |    4 |
| app-only plist keys in the bare helper directory | legacy bare helper remains independently signed without flat-bundle resources                     |    1 |
| microphone status messages                       | names microphone denied availability without guessing (also pending and restricted fail)          |    2 |
| screen status message                            | reports ungranted screen access without claiming a known denial                                   |    2 |
| Cocoa run loop                                   | native Cocoa run loop delivers sleep notifications                                                |    1 |

The additional native build drill copies only owned build inputs into a
private scratch tree, puts app-only keys back in its source Info.plist and
reproduces the original flat-bundle signing behavior. The real resource
check fails `legacy bare helper remains independently signed without
flat-bundle resources`. Its isolated Info.plist is restored byte-exact and
its SHA matches the unchanged worktree source; the scratch tree is removed.
Bundle-only keys now enter the generated app plist after the bare binary
has been built and signed. No source directory signature is generated.

Final restored hashes:

- Driver: `8e3c7eccbd3b648b07cb1014ffa8a0dcd2d28098432d643dae59da8f144bd2ae`.
- Native source: `91c7d206979a85c3cd056d30334233bf816696e02dbfc5cf33826ce13f630abd`.
- German strings: `aa9cbcfd03b9f8f32dac39d9e4f1bc1e48a6e48c0b4eb4af0c1ce3842dc24efa`.
- Info.plist: `baa99fcbfb57e5a3894a24c40918897894c75ee48e05759392ce07c8a42fdbcf`.

### Named integration / validation residuals

These are recorded in PLAN §9; they are not unfixed review findings.

- **M105-R1-integration.** E1/E2/E3/W bind the shared trusted-root verifier,
  expected release requirement and host suspend event; use the installed
  screen `.app` executable; preserve/copy **all** its signed resources,
  executable mode and signature into VSIX/ACP; and add the native checks to
  macOS CI. Package the screen bundle without widening existing size caps.
  The existing bare helper remains for existing dictation. No new reachable
  recording command is advertised before binding. Safe now: the portable
  recorder fails closed without required bindings. Follow-up: exact-package
  signature/localization tests and all-editor fake matrix before shipping.
- **M105-R1-live-validation.** Real capture/permission prompts, actual
  sleep/wake/display sleep and macOS 12.0–12.2 remain owed. The earlier seven
  live/integration cases above still apply, with sleep/wake added to case 2
  and conversion overflow/deadline to case 4. Safe now: tested native and
  portable guards, no recorder entry point in this lane. Follow-up: the
  lead's authorized live and packaged receipts before reachability.
- **M105-R1-gate-integration.** The aggregate quality/coverage/package gates
  are lead-owned by the explicit rig/common rule; W refreshes the existing
  four Node-import changes in the generated host API record. No gate is
  weakened. The base has no feature catalog/reference generator; W lists
  the integrated feature there. README documents the successfully executed
  native scripts and CHANGELOG records these implementation corrections.

### Final FIXM105R1 validation on macmini

- `npx vitest run test/unit/macosScreenRecording.test.ts --maxWorkers=3`:
  **61/61 passed**, whole file, default repository timeout, 1.640 seconds.
  No test filtering, skip, timeout override or raised timeout was used.
- Native synthetic suite: **122 PASS assertions** across encoding/mixing,
  real avconvert, options/privacy/permission order, duration/size, sleep,
  late Stop, conversion bounds, child termination and cleanup. Native
  signature/resources suite: **18 PASS assertions**, including all
  fourteen Foundation language resolutions and legacy bare-helper signing.
  Final disclaimed `--screen-only` probe passes without requesting access.
- Universal native build: arm64/x86_64, minimum macOS 12.0, version 0.14.0.
  Both the bare helper and screen app pass `codesign --verify --strict`;
  the app also passes the expected-identifier/two-CDHash requirement.
  Bare signature has `Sealed Resources=none`; no source `_CodeSignature`
  directory remains. Helper: **471,264 bytes**, raw Deflate **160,760**.
  Screen app: 18 files, **493,692 bytes**, sum of raw Deflate payloads
  **169,852**. These are payload measurements, not packaged VSIX/ACP claims.
- All five `npm run typecheck` projects passed. Host and unit projects were
  rechecked after the final permission/start and fixture changes and pass.
  Changed-file ESLint, Prettier, shell syntax, all sixteen plist/strings
  lints and `git diff --check` pass.
- Localization: **14 tables, 164 manifest strings, 593 source files,
  zero problems**. Plain knip passes with its two pre-existing hints.
  Duplication passes: **1,168 files, zero clones**. It first caught three
  repeated new test fixtures/assertions; those are now shared within the
  existing test fixture, with every assertion and named test retained.
- Production build passes every size/split/host-global/notice gate:
  extension **436.7/600 KiB**, Model API **446.7/475**, ACP **816.8/850**,
  compressed English **49.5/125**, checkpoint store **77.0/225**,
  browser startup **899.6/900**, deferred **49.7/50**. No cap was changed.
  The driver still awaits W's lazy screenRecord bundle; these measure the
  actual current shipped bundles, not the future integrated recorder.
- `check:host-api` exits 1 **only** for the same W-owned generated-record
  drift: buffer 39→40, fs/promises 47→48, path 84→85, string_decoder 1→2.
  VS Code counts remain 332 APIs in 31 files; no generated record was edited.
- Full aggregate quality, coverage, integration, packaged signatures/budgets
  and real capture/sleep/privacy checks remain the named lead/W handoffs
  above. No new reviewer P2/P3 residual, paid/live call, dependency, cast,
  lint escape hatch, push, rebase or merge.
