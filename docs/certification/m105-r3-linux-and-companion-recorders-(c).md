# M105 R3 Linux and companion recorders

Kubuntu, 2026-10-06; branch `m105/r3`, based on lane 0.
Read the rig brief, shared common rules, AGENTS.md, PLAN D85 and M105,
`meta-coverage-2026-10-05.md` §2/§6 and the lane-0 capture/certification records.
The rig brief overrides the old common merge instruction. No merge, rebase,
push, live or paid model call, credential access or OS privacy change.

## Lane implementation

R3 owns `src/core/media/record/linux.ts` and
`src/webview/media/recorder/**`, with focused tests and this record.
The Linux driver uses lane 0's `ScreenRecordingDriver`: explicit user entry,
portal consent and PipeWire sources, a verified GStreamer encoder launch,
bounded private output, countdown/Stop/Cancel and a sniffed disposable preview.
Attach latest searches only injected GNOME/Spectacle recording roots and
copies a fresh supported recording privately; GNOME WebM is marked for M1's
conversion path, never silently relabelled mp4.

The companion component and controller use the browser's actual
`getDisplayMedia`/`MediaRecorder` APIs through a testable port. mp4 support is
checked before capture. Audio is off unless selected for this recording.
Stop, track end, close, error, suspend, duration and size limits all release
capture tracks. Attach alone calls E3's injected guarded upload; Discard
releases the preview without sending anything.

## Named integration bindings

- **R3-PORTAL:** the runtime/host binds ScreenCast's availability,
  CreateSession/SelectSources/Start/OpenPipeWireRemote and session closure.
  The port returns numeric node/fd identities; selected audio sources are
  separate explicit permission-gated inputs. No D-Bus response parser is
  invented from Meta/MSP captures.
- **R3-TRUSTED-LAUNCH:** bind absolute helper discovery, trusted-path
  verification immediately at launch, required GStreamer plugin checks,
  credential-free environment, inherited PipeWire descriptors, parent-death
  process cleanup, hard file-size limit and bounded EOS/kill on stop.
  Generic ffmpeg builds have no PipeWire input; this rig's ffmpeg reports
  PulseAudio/X11 only. Use `pipewiresrc`, not an unconsented X11 fallback.
- **R3-PRIVATE-PREVIEW:** bind private temporary storage, bounded sniffing
  from M1, deletion after attach/discard and lifecycle cancellation on close,
  crash and sleep. Latest-recording roots come from the user's XDG Videos
  directory and Spectacle's configured recording folder; no config is changed.
- **R3-COMPANION-E3:** mount the recorder lazily in E3's companion chunk and
  bind Attach to its guarded streamed upload with an AbortSignal; never
  mount browser capture in a VS Code webview. Keep the model capability,
  contributor warning and paid consent downstream at E3/M2/C's attach/send
  fence, for every vendor and editor.
- **R3-W:** wire `dist/screenRecord.js`, the browser chunk and hard budgets;
  update the editor matrix, README/PRIVACY/SECURITY/CHANGELOG and feature
  reference. `featureCatalog.ts` does not exist on this base. No other lane's
  files, thresholds or bundle caps are changed.

Implementation receipts, red drills and permission-gated checks follow below.

## Linux guard drills and first receipt

`npx vitest run test/unit/linuxScreenRecording.test.ts --maxWorkers=3`:
**56/56 passed**, repository default timeout. Changed Linux source/test ESLint
and Prettier passed. The 37 isolated mutations below each exited 1 at the
named test, followed by byte-exact restoration verified with SHA-256.
No thresholds, test filters, skips or timeouts were changed. These are fake
portal/process tests, not desktop permission or native encoder receipts.

| Broken guard/action         | Named failing test                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| interactive entry           | refuses tool before consent or launch                                                              |
| local screen                | refuses remote before consent or launch                                                            |
| duration schema             | refuses duration before consent or launch                                                          |
| single writer               | honours maximum, keeps one writer at a time and cleans cancellation                                |
| already aborted owner       | refuses aborted before consent or launch                                                           |
| absolute encoder            | refuses relative before consent or launch                                                          |
| numeric fd                  | cleans failed setup: fd                                                                            |
| numeric node                | cleans failed setup: node                                                                          |
| strict source schema        | rejects malformed setup identities: fd-extra                                                       |
| microphone opt-in           | records explicitly selected audio true / false                                                     |
| system audio opt-in         | records explicitly selected audio false / true                                                     |
| pending lifecycle           | does not start a helper if the owner closes during private file creation                           |
| absolute private output     | cleans failed setup: output                                                                        |
| NUL private output          | rejects malformed setup identities: nul-output                                                     |
| hard encoder byte limit     | starts only portal video, passes hard bounds to trusted launch, previews on Stop and disposes once |
| hard encoder duration       | starts only portal video, passes hard bounds to trusted launch, previews on Stop and disposes once |
| portal revocation           | cleans files and portal on close                                                                   |
| owner closure               | deletes a completed preview when its owner closes                                                  |
| maximum countdown           | honours maximum, keeps one writer at a time and cleans cancellation                                |
| sleep detection             | cancels on sleep or backwards wall clock 3000 without extending capture                            |
| post-sniff cancellation     | checks cancellation after the sniffer returns, before publishing a preview                         |
| sniffed metadata validation | rejects sniffed invalid output: shape                                                              |
| mp4 container               | rejects sniffed invalid output: type                                                               |
| nonempty recording          | rejects sniffed invalid output: empty                                                              |
| preview byte bound          | rejects sniffed invalid output: bytes                                                              |
| known duration              | rejects sniffed invalid output: unknown                                                            |
| preview duration bound      | rejects sniffed invalid output: duration                                                           |
| sound matches selection     | rejects sniffed invalid output: sound                                                              |
| private file cleanup        | cleans files and portal on cancel                                                                  |
| absolute latest root        | refuses a relative recording root before copy                                                      |
| latest root confinement     | refuses outside candidates before copy                                                             |
| latest media candidate      | refuses type candidates before copy                                                                |
| latest no future timestamp  | refuses future candidates before copy                                                              |
| latest age limit            | refuses old candidates before copy                                                                 |
| latest video kind           | disposes an invalid latest preview: kind                                                           |
| latest nonempty file        | disposes an invalid latest preview: empty                                                          |
| latest private copy bound   | disposes a private copy that sniffs as empty or oversized                                          |

Restored Linux source SHA-256: `fb510a4a0dc2a4a39600aad6ff9296bcc3cf834c10d5cb81ccb7e24fb6fcb14f`.

The interactive-entry drill exercises a tool-context attempted start; removing
that fence dispatches capture and fails `refuses tool before consent or launch`.
No recording tool is registered in production. The launch request carries
only the command, fixed pipeline arguments, numeric sources, output, bounds
and lifecycle signal; it has no credentials, shell command or user/model text.

## Documentation/reference handoff to W

Suggested Unreleased entry: “Added Linux portal recorder and companion mp4
recorder implementations with per-recording sound choices, bounded capture,
Stop/Cancel and private preview cleanup. The integration binds the native
portal/trusted process ports and companion upload before exposing the UI.”
README/feature-reference entries to add at that binding: Attach screen
recording (Linux portal/GStreamer), Attach latest recording (GNOME/Spectacle;
WebM offers conversion), and companion recording (mp4-capable browser only).
Do not advertise those entry points as shipped on this contracts-only base.

## Owed permission and integration checks

- Actual Kubuntu portal picker: allow, deny, revoke; early Stop/maximum;
  screen plus each selected audio source; valid mp4 through M1's sniffer.
- Native trusted-path replacement/rejection, owner-only file/directory modes,
  hard writer byte cap, EOS grace/kill, parent crash, desktop sleep and cleanup.
  The injected ports require these behaviors; this lane's fakes cannot certify
  the host bindings. This rig has ffmpeg/gdbus but no gst-launch-1.0.
- Browser permission denial and process-close receipts; Safari/unsupported
  browser receipts. Chromium's synthetic capture and real mp4 playback are
  completed below, with no actual desktop or microphone.
- E3's guarded upload, M2/C's model capability/contributor/paid fences, W's
  lazy chunk registration/budget/split checks and the equal-editor matrix.
  Native Linux logic imports no VS Code API and the component uses no editor
  API; the runtime and native bridges bind the same driver port.
- Full quality/coverage/a11y/security and Windows/macOS CI are the lead's gate,
  as the rig brief forbids this lane's full quality run and other lane edits.

## Companion guard drills and fixes

**34 companion mutations plus 8 additional mutations** each failed the named
assertion, exited 1, and restored the file byte-exact with SHA-256. Together
with the first Linux set this is **79 deliberate red drills**. Each invocation
ran an entire owned test file with `--maxWorkers=3` and the repository's default
timeout; no test-name filter or timeout override was used.

The asynchronous Stop test first failed on the unguarded preview-URL callback.
The controller now catches that callback's failure, releases capture and the
blob, and reports the fixed localized refusal without exposing exception text.
Late upload success/failure cannot cancel or overwrite a new recording.
The default browser port stops the display immediately even while microphone
permission is pending, and closes the mixer and its output tracks too.

| Broken guard/action                  | Named failing test                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| companion interactive entry          | refuses non-user starts before capture                                                     |
| companion mp4 support                | refuses an unsupported browser by name before permission                                   |
| companion options bounds             | refuses invalid recording bounds 0 before capture                                          |
| companion single capture             | refuses concurrent starts while the picker is pending                                      |
| pending capture epoch                | cancels pending permissions and releases late resources without starting a recorder        |
| nonempty track set                   | cleans failure at empty-tracks                                                             |
| live tracks                          | cleans failure at track                                                                    |
| late recorder event epoch            | discards without uploading, even when a late stop callback arrives                         |
| retained chunk byte cap              | rejects the first over-limit chunk, stops every track and never creates a preview          |
| nonempty mp4 output                  | cleans failure at empty-output                                                             |
| OS track end                         | stops when the operating system ends a capture track                                       |
| companion duration maximum           | counts down and stops at the maximum using repository-default test timeout                 |
| companion sleep detection            | stops after sleep or wall clock jump -3000 without extending the recording                 |
| companion stalled clock              | stops after sleep or wall clock jump 3000 without extending the recording                  |
| stop every capture track             | stops live tracks immediately while the final mp4 flush is pending                         |
| attach only after preview            | refuses a second Attach while its first upload is pending                                  |
| abort pending permission             | cancels pending permissions and releases late resources without starting a recorder        |
| abort upload on close                | aborts upload on owner close and ignores its late completion                               |
| release private blob URL             | attaches only after preview and releases the blob and URL after successful upload          |
| release capture resources            | passes explicit sound selections false/false and stops to preview without uploading        |
| native browser mp4 capability        | probes mp4 support without requesting capture and refuses absent browser APIs              |
| request system audio opt-in          | requests silent display by default, removes unsolicited audio and never opens a microphone |
| remove unsolicited system audio      | requests silent display by default, removes unsolicited audio and never opens a microphone |
| request microphone opt-in            | requests silent display by default, removes unsolicited audio and never opens a microphone |
| selected system audio exists         | cleans denied or missing system audio                                                      |
| selected microphone exists           | cleans denied or missing microphone audio                                                  |
| browser lifecycle cancellation       | refuses capture after its lifecycle was already aborted                                    |
| release pending capture immediately  | stops screen tracks immediately when owner closes while microphone consent is pending      |
| release audio mixer output           | mixes selected microphone, with system audio false                                         |
| inactive recorder stop               | does not stop an already inactive MediaRecorder a second time                              |
| trusted UI click                     | starts only from the user button and leaves both audio boxes unchecked                     |
| recording visible indicator          | shows a live countdown, disables sound changes, and gives Stop and Discard                 |
| audio controls locked during capture | shows a live countdown, disables sound changes, and gives Stop and Discard                 |
| owner pagehide                       | allows cancelling the permission picker and cancels on pagehide and unmount                |
| asynchronous Stop error              | handles a preview URL failure from an asynchronous recorder Stop event                     |
| actual mp4 encoder format            | requests silent display by default, removes unsolicited audio and never opens a microphone |
| no native startup probe              | does nothing at construction or availability except probe verified encoder support         |
| encoder probe refusal                | availability refuses a failed encoder probe by name                                        |
| latest metadata schema               | disposes an invalid latest preview: schema                                                 |
| separator normalization              | normalizes Windows separators and keeps GNOME WebM for the explicit conversion offer       |
| no companion startup capture         | does not capture or upload at construction, attach or Stop before Start                    |
| late upload/recorder ownership       | ignores late upload resolve while a new recording is running                               |

Restoration hashes (source versions at drill time):

- `src/webview/media/recorder/browserRecorder.ts`: `540a3b12798960ce1d0805af3d2df37283f298de10a1189ac1dc57f79acb519b`
- `src/webview/media/recorder/browserCapture.ts`: `dc0fef1d5d983889ef636e627ce2c493294edc1d161a4e989133c566f1cd3603`
- `src/webview/media/recorder/CompanionRecorder.tsx`: `facd6278b8d86b6abacf2026085e528bfe9e8906c72fae972c304d4c6aeca7c8`
- `src/core/media/record/linux.ts`: `fb510a4a0dc2a4a39600aad6ff9296bcc3cf834c10d5cb81ccb7e24fb6fcb14f`

Two fixture issues found by the real gates were fixed: repeated pending-upload
setup is shared by the tests, and nested native fixture ternaries became plain
branches because ESLint's automatic parentheses and Prettier disagreed. No
rule, ignore, threshold or test deadline changed.

## Chromium and accessibility receipts

`m105-r3-browser-receipt.json` records headless Chrome 150 with its synthetic
capture device and a fresh private profile. DISPLAY/Wayland and credential
variables were excluded from the browser environment. A trusted Start click
recorded `video/mp4`; Stop produced a playable 320×240 clip, **1.0472 seconds,
22,012 bytes**, readyState 4. Nothing was attached before the explicit Attach
click; one in-memory fake upload callback then received the mp4. No actual
desktop, microphone, provider or model was used, and the profile was removed.
The generated preview is `m105-r3-companion-preview-320.png`.

The same real browser checked the preview at **320 and 1200 px in light, dark,
high-contrast light and high-contrast dark**. There was no horizontal overflow
and **zero axe violations**. `m105-r3-a11y-receipt.json` preserves every result:
**video-caption was undecided in all eight scans**. The generated clip is
silent, but arbitrary user recordings can contain speech; caption review and
caption integration remain with E3/W. This is **not** a passing repository
accessibility-gate claim. No empty caption track, axe ignore or exemption was
added. Initial page-heading/landmark findings were in the standalone test
page; its real title was placed inside its main landmark before the final scan.

## Final lane validation (Kubuntu)

- Final Vitest batches, repository default timeout, at most three files/run:
  `linuxScreenRecording`, `browserScreenRecording`, `browserCapture`:
  **106/106 passed**; `CompanionRecorder`: **6/6 passed**. Total **112/112**.
- `npm run typecheck`: **passed**, all five projects (host, webview, unit,
  end-to-end and integration).
- ESLint over all changed source/tests, Stylelint on the new CSS and Prettier
  over changed text: passed. Localization: **14 tables, 164 manifest strings,
  596 source files, zero problems**. Every displayed phrase uses the existing
  lane-0 translated tables at runtime; no string or setting was added here.
- Dead-code check: passed. Duplication: **1,175 files, zero clones**, after
  sharing the repeated pending-upload fixture. Owned module dependency graph:
  **no cycles**.
- Host API check: **one stale generated count only**, `node:path` importers
  **84 → 85**; 332 VS Code APIs and 31 importing files unchanged. W owns
  `docs/ide-compatibility/host-api.md` and must regenerate it with the merged
  source. No `vscode` import was added to the portable implementation.
- No dependencies installed, npm pins changed, OS settings changed, credentials
  read, live/paid/model calls made, or provider uploads created. No merge,
  rebase or push. Commits use the repository's hooks and explicit paths.

## Deferred module measurements and W binding

The isolated production-style native build used the repository's real
`sharedUiText` and `sharedValidation` plugins: **13,142 bytes (12.8 KiB)**.
The browser modules with React/constants/l10n/media validation shared by the
companion page were **7,375 JS bytes (7.2 KiB)**, plus the small recorder CSS.
These are module measurements, not registered shipped chunks. W must bind and
budget `dist/screenRecord.js` and a **separate lazy companion page chunk**;
this browser module cannot be added to the nearly-full chat optional total.
No existing cap is raised. W's lazy Node factory must install the caller's
language table before constructing the driver; companion modules share the
page's installed-language state. Every helper/plugin probe as well as the
encoder launch uses the trusted-path verifier.

`npm run build`: **exit 0**, production compilation, hard size budgets,
bundle splits, host-global checks and third-party notices. The final build's
output was saved in gitignored `temp/r3-final-build.log` because the earlier
terminal receipt was truncated; no gate was changed. Existing shipped sizes:

| Bundle                           | Built size | Hard budget |
| -------------------------------- | ---------- | ----------- |
| `dist/extension.js`              | 436.7 KiB  | 600 KiB     |
| `dist/modelApi.js`               | 446.7 KiB  | 475 KiB     |
| `dist/checkpointStore.js`        | 77.0 KiB   | 225 KiB     |
| webview main plus static imports | 898.9 KiB  | 900 KiB     |
| webview deferred JS              | 49.7 KiB   | 50 KiB      |

This production build verifies the current registered entry points. R3's new
modules remain behind the named W/E3 bindings above; their isolated module
measurements do not claim those bindings or budgets are already registered.

## RVM105R3 repair receipt (2026-10-06, Kubuntu)

Read the entire RVM105R3 report and rig/shared rules before editing. All five
P2 findings are fixed; no P1 or P3 was reported and no review finding is
left as a residual. Scope remains the owned recorder implementation/tests,
its failure text in English and all 14 translated tables, PLAN, CHANGELOG
and this certification. No dependency, guard, gate, hook or timeout changed.

The run owns its private output through portal closure. It publishes a preview
only after close succeeds and cancellation is checked again; close failure
still attempts disposal in finally and returns a structured refusal. Setup
always attempts portal closure and private-file removal, with busy state and
owner-listener release in an outer finally even when either cleanup rejects.
An actual storage refusal can prevent deletion; these fake ports certify the
cleanup attempt and released ownership, not an OS guarantee that removal
cannot fail. Owner-only storage and crash/orphan cleanup remain the named
R3-PRIVATE-PREVIEW integration binding.

Sound opt-ins are consumed at Start and cleared on pagehide; Attach, Discard
and recording errors therefore cannot carry consent into another recording.
Only `NotAllowedError` from portal/browser permission acquisition maps to the
permission recovery. The Linux adapter must preserve ordinary failures and
translate a genuine portal user/OS denial to that identity; this is an injected
port contract, not a guessed D-Bus wire parser. Encoder, storage, stopped-track,
empty-output and preview-URL failures use `media.recordingFailed`, translated
in every table, without exposing exception text. Permission-shaped errors
after access is granted also use the general failure text.

| Review finding                                                | Resolution                                                                                             | Regression                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1: cancel during portal closure returns deleted preview       | Fixed: cancellation checked after closure, before publication                                          | refuses cancellation during portal closure without publishing a deleted preview                                                                                                                                                                                                                                        |
| 2: portal-close rejection leaks private output/rejects result | Fixed: invalidate preview, attempt disposal in finally, return refusal                                 | disposes private output and returns a refusal when portal closure rejects                                                                                                                                                                                                                                              |
| 3: setup deletion error keeps driver busy                     | Fixed: outer finally releases busy state and abort listener on both invalid-output and launch failures | releases setup ownership when output/launch cleanup rejects                                                                                                                                                                                                                                                            |
| 4: sound selection carries into another recording             | Fixed: consume both opt-ins for each Start and clear on page close                                     | requires fresh audio opt-ins after discard/attach/error/pagehide; clears unused audio opt-ins when the page closes before Start                                                                                                                                                                                        |
| 5: ordinary errors claim permission denial                    | Fixed: acquisition-only denial classification and translated general failure text                      | reports storage/encoder/portal failure without claiming permission was denied; reports capture NotReadableError/SecurityError/Error without claiming permission was denied; cleans failure at constructor/start/stop/empty-output/recorder/url; handles a preview URL failure from an asynchronous recorder Stop event |

### Failing-before regressions and red drills

The first three-file regression run on unchanged production source exited 1:
**23 failed, 91 passed (114)**. It reproduced every review finding. The first
fixed-source run passed **114/114**; additional acquisition-identity and
page-close cases were then added and exercised in the drills and final runs.
All invocations used complete owned test files, `--maxWorkers=3`, and the
repository's default timeout. There were no test-name filters or skips.

All **11** isolated mutations below exited 1 at the named regression. After
each invocation the original source bytes were restored in finally, and its
SHA-256 was compared to the pre-mutation digest. The R-number in these drill
IDs names the review finding, not another platform's implementation lane.

| Broken guard                   | Named failing test                                                              | Receipt                                   |
| ------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------- |
| `R1-final-cancel`              | refuses cancellation during portal closure without publishing a deleted preview | exit 1; named failure; byte-exact restore |
| `R2-close-refusal`             | disposes private output and returns a refusal when portal closure rejects       | exit 1; named failure; byte-exact restore |
| `R3-busy-finally`              | releases setup ownership when output cleanup rejects                            | exit 1; named failure; byte-exact restore |
| `R3-owner-finally`             | releases setup ownership when launch cleanup rejects                            | exit 1; named failure; byte-exact restore |
| `R4-start-audio-reset`         | requires fresh audio opt-ins after discard                                      | exit 1; named failure; byte-exact restore |
| `R4-close-audio-reset`         | clears unused audio opt-ins when the page closes before Start                   | exit 1; named failure; byte-exact restore |
| `R5-linux-failure-text`        | reports storage failure without claiming permission was denied                  | exit 1; named failure; byte-exact restore |
| `R5-linux-denial-identity`     | reports genuine portal permission denial without exposing private details       | exit 1; named failure; byte-exact restore |
| `R5-browser-failure-text`      | handles a preview URL failure from an asynchronous recorder Stop event          | exit 1; named failure; byte-exact restore |
| `R5-browser-acquisition-scope` | cleans failure at constructor                                                   | exit 1; named failure; byte-exact restore |
| `R5-browser-denial-identity`   | shows permission recovery without exposing browser error details                | exit 1; named failure; byte-exact restore |

Restored source SHA-256 values for these repair drills:

- `src/core/media/record/linux.ts`: `16fbf61aa9c0a69a599ea3f95c10e3979177a2a60a0a8f1e2b9a1828faab7d24`
- `src/webview/media/recorder/CompanionRecorder.tsx`: `d1300b887964423e13e0c91a128f23d7b0fb79610eb9ee886a81c89822db3fe9`
- `src/webview/media/recorder/browserRecorder.ts`: `5286994424ec65020445263185a0078659309762f0a4eb493648d842db854f85`

### Final repair verification

- `npx vitest run test/unit/linuxScreenRecording.test.ts test/unit/browserScreenRecording.test.ts test/unit/browserCapture.test.ts --maxWorkers=3`: **119/119 passed**.
- `npx vitest run test/unit/CompanionRecorder.test.tsx --maxWorkers=3`: **11/11 passed**. Final total: **130/130**, repository-default timeout.
- `npm run typecheck`: **exit 0**, all five projects.

Static/build gate receipts follow below.
Full quality/coverage, native permission/process receipts, installed editor
bindings and preview caption certification remain with the lead and E3/W as
already recorded above. No new command, setting or shipped feature was added.
`src/shared/featureCatalog.ts`, `scripts/gen-reference.mjs` and the reference
check do not exist on this base; the existing R3-W documentation/reference
handoff remains, without creating another lane's architecture here.

### Static gates, budgets and remaining integration work

- Changed-file ESLint and Prettier checks: **exit 0**; diff whitespace also
  passed. No suppression, cast or escape hatch added.
- Dead-code: **exit 0**. Duplication first found three repeated test blocks;
  sharing the unchecked-audio assertion and setup-failure fixture within the
  owned tests fixed them. Final duplication: **1,175 files, zero clones,
  exit 0**. The assertions and production source stayed unchanged.
- After that fixture sharing, the final Linux/UI rerun passed **77/77** with
  the default timeout; the unit TypeScript project passed again. Together
  with the unchanged browser controller/capture results, all **130** owned
  tests pass. Production SHA-256 values still match the repair drill hashes.
- Localization: **14 tables, 164 manifest strings, 596 source files;
  zero problems**. The new failure phrase has real translations in all 14.
- Host API: **exit 1**, exactly the pre-existing `node:path` importer count
  **84 → 85**. VS Code surface remains **332 APIs, 31 importing files**.
  **M105-R3-host-api-count** is the named documentation/gate residual:
  safe for now because only a generated count is stale and the repair adds
  no imports/API calls; follow-up is R3-W's integrated record regeneration
  and rerun. PLAN §7/§9 records this deferral; no check is weakened.
- `npm run build`: **exit 0**, production compilation, hard budgets, split
  checks, host globals and third-party notices.

| Shipped bundle                   | Size      | Unchanged hard budget |
| -------------------------------- | --------- | --------------------- |
| `dist/extension.js`              | 436.7 KiB | 600 KiB               |
| `dist/modelApi.js`               | 446.7 KiB | 475 KiB               |
| `dist/checkpointStore.js`        | 77.0 KiB  | 225 KiB               |
| `dist/uiText.js`                 | 49.3 KiB  | 125 KiB               |
| webview main plus static imports | 899.0 KiB | 900 KiB               |
| webview deferred JS              | 49.7 KiB  | 50 KiB                |

The repaired isolated modules were measured again with `write: false`: native
**13,427 bytes (13.1 KiB)** using the actual shared-English/validation build
plugins; companion **7,436 JS bytes (7.3 KiB)** with React/constants/l10n/media
validation supplied by the companion page, plus **188 CSS bytes**. No chunk
registration or existing cap is changed; these remain isolated measurements,
not a claim that the pending W bundles ship on this base.

**M105-R3-native-bindings** is the unchanged integration residual, also in
PLAN §9: the base does not expose these ports/modules through shipped entry
points, so it cannot capture a screen at startup. R3-PORTAL,
R3-TRUSTED-LAUNCH, R3-PRIVATE-PREVIEW, R3-COMPANION-E3 and R3-W bind and
certify native permissions/processes, owner-only storage and orphan deletion,
upload, equal-editor paths and lazy budgets. Full quality/coverage, native
OS receipts and captions stay with those owners; this repair leaves no
review finding for them to fix. No paid/live calls, credentials, OS settings,
installs, dependency changes, merges, rebases or pushes were used.

## RVM105R3B final repair receipt (2026-10-06, Kubuntu)

Read the complete RVM105R3B review, rig brief and shared rules. The single
remaining P2 is fixed; there are no deferred review findings. An encoder's
`false` exit now preserves `media.recordingFailed` unless the run's explicit
cancellation/lifecycle flag is set. Neither Stop nor the duration limit sets
that flag. A rejected automatic Stop terminates the writer directly without
pretending the user cancelled. Genuine Cancel, owner closure and portal
closure retain their cancellation result and cleanup behavior.

The failure guidance already has real translations in English and all 14
`l10n/ui.*.json` tables; the driver reads it at runtime. No new text, command,
setting, feature, dependency, escape hatch, guard widening or timeout was
introduced. Shared core behavior applies to every editor through the existing
R3-W/portal binding. README/reference and native/caption/upload/editor handoffs
remain as recorded above.

| Finding                                               | Resolution                                                                                            | Regression                                                                                                                                  | Red drill                                                                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| RVM105R3B P2: failed encoder exit claims cancellation | Fixed: cancellation depends on the cancellation flag; unsuccessful exit keeps translated failure text | reports an unsuccessful encoder exit during recording / Stop / duration limit as failure, not cancellation; cleans files and portal on exit | `R3B-encoder-exit`: restore the condition combining unsuccessful exit with cancellation; **5 failed / 65 passed**, exit 1 |
| Same P2, internal duration-limit Stop failure         | Fixed: terminate the writer without setting the cancellation flag                                     | reports an unsuccessful encoder exit during failed duration-limit Stop as failure, not cancellation                                         | `R3B-internal-stop`: restore `stop().catch(abort)`; **1 failed / 69 passed**, exit 1                                      |

The regressions first ran against unchanged production source: **5 failed /
65 passed (70)**, exit 1. Fixed source then passed **70/70**. The duplication
gate found one repeated cleanup assertion block; the four exit scenarios now
share one parameterized regression without changing their assertions.
Both red drills ran the complete Linux test file with `--maxWorkers=3` and
the repository-default timeout. The named regressions failed and each
mutation was restored in finally, followed by a SHA-256 comparison:

`src/core/media/record/linux.ts`:
`542b2dfb6beb4f2e61a6f4c74a36522a37d7a3b293e51d6d388a3849146437cd`.

Logs and the restoration script are in gitignored `temp/r3b-*` and
`temp/R3B-*`. Final bounded gate receipts follow. Aggregate quality/coverage
remain the lead's integration responsibility under the rig/shared rules.
The pre-existing **M105-R3-host-api-count** and **M105-R3-native-bindings**
residuals retain their stated safety reasons and follow-ups in PLAN §7/§9;
neither is an unfixed review finding.

### Final repair gates

- `npm run typecheck`: **exit 0**, all five projects on final restored source.
- `npx vitest run test/unit/linuxScreenRecording.test.ts test/unit/browserScreenRecording.test.ts test/unit/browserCapture.test.ts --maxWorkers=3`:
  **123/123 passed**. `npx vitest run test/unit/CompanionRecorder.test.tsx --maxWorkers=3`:
  **11/11 passed**. Total **134/134**, repository-default timeout and at most
  three files per invocation. Failed exits do not sniff or publish a preview;
  cleanup closes the portal, removes the private file and clears the timer.
- Changed-file ESLint, Prettier and diff whitespace: **exit 0**.
  Dead-code: **exit 0**. Duplication: **1,175 files, zero clones, exit 0**.
- Localization: **14 tables, 164 manifest strings, 596 source files;
  zero problems**. A separate table inspection confirmed that every
  `media.recordingFailed` translation is present and distinct from both the
  English fallback and its locale's cancellation text.
- Host API: **exit 1**, exactly the pre-existing `node:path` importer count
  **84 → 85**; **332 APIs, 31 importing files** unchanged. The existing
  M105-R3-host-api-count deferral applies; no generated record was edited.
- `npm run build`: **exit 0**, production compilation, unchanged hard size
  budgets, bundle split checks, host globals and third-party notices.

| Shipped bundle                   | Size      | Unchanged hard budget |
| -------------------------------- | --------- | --------------------- |
| `dist/extension.js`              | 436.7 KiB | 600 KiB               |
| `dist/modelApi.js`               | 446.7 KiB | 475 KiB               |
| `dist/checkpointStore.js`        | 77.0 KiB  | 225 KiB               |
| `dist/uiText.js`                 | 49.3 KiB  | 125 KiB               |
| webview main plus static imports | 899.0 KiB | 900 KiB               |
| webview deferred JS              | 49.7 KiB  | 50 KiB                |

Two early drill invocations briefly overlapped the first typecheck; the final
verification runner was corrected to execute checks sequentially, and a
separate all-project typecheck was rerun on the final restored source.
No source mutation overlapped the final checks.

Final isolated measurements used `write: false`: Linux **13,477 bytes**
with the repository's shared-English/validation plugins, companion **7,436
JS bytes + 188 CSS bytes** with page-shared inputs external. These remain
module measurements awaiting R3-W's registered lazy bundles; no cap or
startup import changed. No installs, live/paid calls, credential access,
OS settings changes, merges, rebases or pushes occurred.
