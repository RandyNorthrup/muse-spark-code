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
