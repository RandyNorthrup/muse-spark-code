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
- Playwright Chromium with a synthetic capture device, real mp4 playback,
  permission denial and browser close; Safari/unsupported browser receipts.
- E3's guarded upload, M2/C's model capability/contributor/paid fences, W's
  lazy chunk registration/budget/split checks and the equal-editor matrix.
  Native Linux logic imports no VS Code API and the component uses no editor
  API; the runtime and native bridges bind the same driver port.
- Full quality/coverage/a11y/security and Windows/macOS CI are the lead's gate,
  as the rig brief forbids this lane's full quality run and other lane edits.
