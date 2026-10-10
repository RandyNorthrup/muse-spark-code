# M9 Linux offline dictation — CM9LNX

Scope: local VS Code-family composer on Linux x64/arm64. Windows and macOS
retain their existing helpers. No paid API or live model calls are authorized
or used. Native runtime composer rows remain C-M9-1/C-M104-1 (JetBrains,
Visual Studio, Eclipse, companion); Zed, Xcode and terminal ACP/Neovim/Emacs/
Sublime require that bridge or C-M9-1's explicit microphone-surface exception.
Remote workspace hosts still cannot capture the local microphone.

The 2026-10-10 rig brief supersedes completion-program.md's old Linux engine
prohibition. The archived M9 acceptance retains insertion, tap/hold, stop,
resident helper and no cost; CM9LNX adds offline Linux capture, prebuilt
architectures, consented pinned acquisition, removal and real recognition.

Synthetic fixtures use FFmpeg libflite's `slt` voice, 16 kHz mono PCM16.
They are an engineering comparison, not a human-speech accuracy claim.

## Engine decision (Kubuntu, 2026-10-10)

| Engine                         | Fixture errors / 23 words | 10 s clip wall time               | Engine binary           | Model                                              |
| ------------------------------ | ------------------------- | --------------------------------- | ----------------------- | -------------------------------------------------- |
| Vosk 0.3.45 / small-en-us-0.15 | 3 / 23 (13.04%)           | 1.454 s warm + 0.551 s model load | 25,986,496 B libvosk.so | 41,205,931 B ZIP; 70,898,967 B extracted directory |
| whisper.cpp 1.7.6 / tiny.en    | 1 / 23 (4.35%)            | 1.644 s including load            | 2,457,040 B static CLI  | 77,704,715 B                                       |
| whisper.cpp 1.7.6 / base.en    | 1 / 23 (4.35%)            | 3.364 s including load            | same CLI                | 147,964,211 B                                      |

Chosen: **whisper.cpp 1.7.6, tiny.en**, CPU-only, three threads,
host-specific optimization disabled for portable builds; generic baseline and
runtime-selected CPU variants shipped, with x64 and arm64 supported upstream.
Base adds size and latency without improving these fixtures. Vosk's smaller
weights require a substantially larger shared engine and scored worse here.
Numbers are single wall-clock observations on the shared rig, not throughput
claims. The 10 s fixture is sentence 1 padded with silence.

Fixture 1: “Please open the project and run the tests.” All three exact.
Fixture 2: “Create a new file and save the changes.” Vosk wrote “fell”;
Whisper tiny/base wrote “fellow”. Fixture 3: “The microphone records speech
on this computer.” Vosk wrote “microfilm record”; both Whisper models exact.
WER ignores punctuation/case and uses word edit distance.

Sources: [whisper.cpp code, MIT](https://github.com/ggml-org/whisper.cpp/tree/v1.7.6),
[Whisper original code and weights, MIT](https://github.com/openai/whisper#license),
[converted model, MIT](https://huggingface.co/ggerganov/whisper.cpp),
[Vosk code, Apache-2.0](https://github.com/alphacep/vosk-api/blob/v0.3.45/COPYING),
[Vosk model, Apache-2.0](https://alphacephei.com/vosk/models).
No benchmark dependency enters package.json or node_modules. FFmpeg/libflite,
cmake, g++ and Python were already installed; only candidate archives/models
were fetched into the lane's private TMPDIR. No speech went over the network.

## Implementation and review

The prebuilt helper uses PulseAudio's native client (also PipeWire's Pulse
server), mono PCM16 at 16 kHz, three recognizer threads, ten-second phrases,
a thirty-second queued-audio ceiling and bounded in-memory capture. It
never creates an audio file. `--input-wav` is the certificate input, absent
from the extension's fixed invocation. The helper stays resident between
recordings; Stop drains already submitted phrases. Linux gets a thirty-second
stop grace; Windows/macOS retain their four-second grace.

The helper loads ggml backends explicitly before the model. Every shipped ELF uses only `$ORIGIN`, with no empty current-directory
search component. Both cwd-based
plugin discovery and `GGML_BACKEND_PATH` are confined before that call; the
host clears loader overrides. A hostile constructor writes a marker only
if loaded, so the real-engine test proves this boundary. CPU-only builds
include a baseline backend and select optimized variants by CPU capability.
KleidiAI and llamafile are disabled. The shipped MIT notices include the
YaRN routine's Jeffrey Quesnelle/Bowen Peng copyright as well as ggml and
OpenAI weights. PulseAudio/libstdc++ are system libraries, not bundled ones.

Acquisition requires consent before its first request, uses HTTPS redirects,
identity encoding, validated ranges/lengths, bounded streaming writes, fsync,
exact size and full SHA-256 before publication. A published model is hashed
again before reuse. An atomic nonempty lock directory names its owner PID;
a live/unknown owner is never stolen, a dead owner can be recovered, and
symlinked storage/files refuse. Partial bytes remain for a consented retry.
Late consent after Stop/dispose cannot start a download or microphone.
OFF stops this window's drivers and removes installed/partial weights;
removal failure shows translated recovery advice. Re-enabling after disabled
startup requires window reload, as the setting and README state.

Review classes: validation/security (pin, redirects, file/lock boundaries,
plugin/loader confinement, including exact ELF $ORIGIN search paths); failure/honesty (refusal, integrity, absent
microphone server, unknown command, malformed WAV and removal errors);
concurrency/lifecycle (live/dead owners, cancellation, queued restart,
dispose/reset and Stop drain); docs (14 tables, manifest/reference, privacy,
notices, native build/CI and all-editor rows). No npm dependency was added.
`libpulse-dev` was installed on Kubuntu; CI installs it for the native fake
suite and uses GCC 14 for ARM SME flags ([GCC 14 changes](https://gcc.gnu.org/gcc-14/changes.html)).

## Deliberate failures

[Full drill receipts](m9-linux-drills.json) record each source's original and
restored SHA-256, exit status and named failures; real-engine probes also
record the restored binary hash. Every new test case was observed failing.
The initial new-export probe passed because negative cases were missing;
those cases were added and the same probe then failed. Two initial C++ probes
stopped at unused-variable compilation errors; corrected probes preserve the
variable uses and fail the named runtime assertions instead. These first
probes are retained with `certifiesGuard=false`, not counted as certification.
The initial warm-restart assertion assumed the TypeScript driver delayed Start;
the native helper actually queues it while draining Stop. The corrected test
proves forwarding, reuse and drain ordering; its mutation fails by name.
All 45 recorded probes restore byte-exact; 41 certify guards. The native
notice freshness gate also fails deliberately and passes after restoration.
An empty ELF search component found in the original build was fixed; mutating
the compiled library's path fails the named loader test and real recognition.
Its exact binary SHA-256 is restored and all five real-engine cases pass.

No CLI `--testTimeout` override was used. Unit/protocol tests use repository
defaults. Real cold model loading and full CPU inference are genuinely long
operations: the integration suite has the named
`REAL_OFFLINE_RECOGNITION_TIMEOUT_MS` (30 seconds), with an inline reason.
A direct portable-helper observation took 7.539 seconds for fixture 1 on the
shared rig; the candidate static-CLI comparison above is a different build
and timing, not a promised production latency.

## Local verification

[Verification receipt](m9-linux-verification.json). The final owning runs total **313 passing tests and one existing Windows-only
capture skip**. Every invocation contains at most three files, uses
`--maxWorkers=3` and the repository timeout; the real inference exception is
named above. The real suite ran with the pinned model installed: all three
fixtures and the hostile-backend probe passed, with no model-absence skip.

| Owning suites                                                     | Result                          |
| ----------------------------------------------------------------- | ------------------------------- |
| Linux acquisition, lifecycle and native host consent/removal      | 23 passed                       |
| Native fake engine, helper location and existing dictation driver | 36 passed                       |
| Voice loader, existing host and reference generator               | 139 passed; 1 Windows-only skip |
| Complete VSIX packaging suite                                     | 87 passed                       |
| Real offline helper/model and ELF loader paths                    | 5 passed                        |
| Settings                                                          | 23 passed                       |

The repository's five type projects passed. Changed-file ESLint/format,
plain Knip, zero-clone duplication, all 14 localization tables, reference,
host API, plan and roadmap checks pass. The production build passes its
unchanged caps: activation **553.0 / 600 KiB**, lazy voice **41.5 / 50 KiB**.
The reference contains 77 features, 71 commands and 101 settings; the native
build command documented in README ran successfully. System CMake, strip, readelf,
cc and c++ are declared explicitly in Knip, with no broader ignore or rule
change. CI installs npm dependencies before the native selector build.

The existing composer visual shard passed **72 captures, zero changed pixels**
across six themes, two widths and six states, with the reviewed manifest
unchanged ([receipt](m9-linux-visual.json)). No CSS or JSX changed; the complete
visual matrix remains part of the lead's aggregate gate.

The initial notice check failed on the new Linux attribution, then regenerated
notices and the full production build passed. Source-pin mismatch fails before
compilation. [Final native inventory](m9-linux-native.json) records every x64
runtime file's size and SHA-256: **7,623,768 raw bytes; 3,111,639 ZIP bytes**.
[Real protocol capture](m9-linux-capture.json) names this workspace and one
offline model attempt (zero vendor attempts). The final helper recognized
the ten-second padded fixture in **2.135 seconds including load** on this rig.

[M97 native contribution assessment](m9-linux-legal.json) scans exact copied
native sources, runtime payload, project MIT licence and distributed notices:
**zero findings** after adding the two optional copyright/SPDX headers it
identified. Engine, ggml/YaRN and weights' original licence texts are retained.
The scanner records its normal binary/provenance and ecosystem limits; this
is the new native contribution assessment, not a claim of complete repository
legal certification. An exploratory workspace-wide scan reached the existing
node_modules enumeration budget and reported dependency/licence ambiguities
outside this contribution; no npm dependency was changed here.

## D106 — Download on consent (Kubuntu, 2026-10-10, CM9LNX2)

Lead decision (closes PLAN Q67): the native helper is NOT packaged in the
VSIX; the 3,700 KiB cap stays unchanged. The helper (x64 and arm64, five
files each) ships as same-tag release assets with build-embedded SHA-256
pins (`src/shared/linuxHelperPins.ts`, read only by `dist/voice.js`).

One consent card names both downloads with their sizes, asked once per
press (the first answer covers helper and model; `LinuxDictation` memoizes
it for the press). Every helper file travels the model's hardened path
(`PinnedFileDownload`, extracted from `LinuxDictationModel` with zero
behaviour change to its 12-case suite): HTTPS-only redirects, validated
ranges/lengths, fsync, exact size and full SHA-256 before publication, the
same lock directory, resumable partials. Installed files re-hash before
every start; the binary is owner-executable (0755), libraries owner-only
(0600). Mismatch, partial or swapped files refuse through the existing
integrity errors; OFF removes helper and model with their partials; unset
pins (a build without the release helpers) refuse before any consent.
Offline installs place the ten assets plus the model in the shown folder;
digests are checked identically. All 14 localization tables carry the new
card wording with real translations (`npm run check:l10n`: 0 problems).

Staging (`.vscodeignore`, `scripts/package-vsix.mjs`) and the hosted VSIX
content check refuse any helper binary instead of requiring it; only the
licence notices stay packed. `scripts/build-linux-helper-pins.mjs`
regenerates pins from both built architectures in the packages job;
`scripts/check-linux-helper-pins.mjs` guards shape, `--require-values`, and
`--bundle dist/voice.js --assets <uploaded>`, wired into the build and
release jobs (assets enter SHA256SUMS and the existing attestation;
`github-release.mjs` verifies existing assets byte-equal before uploading).
Pins are verified in `dist/voice.js` only, never in the activation bundle
(activation still 553.0 / 600 KiB; lazy voice 43.8 / 50 KiB).

Deliberate failures: five new red drills in `m9-linux-drills.json`
(D106-nopack/lazy/once/unset/pins), each observed failing, restored
byte-exact by SHA-256 and re-run green. The existing RELFAST/RELFAST2
workflow-drift counts in `manifest.test.ts` were extended (4→6, 6→6→8,
3→5) for the two helper artifact downloads; nothing else in that contract
changed. The pins tamper drill initially stayed green because the fixture
tamper also changes the byte size (the length guard fires first); the drill
now neuters both guards.

The card shows the measured first-download size (~7.6 MB x64 inventory),
not the brief's ~3 MB, which was the ZIP-compressed inventory while the
download is the uncompressed files (D106 records this for the lead).
TOCTOU between verification and spawn is not closed (one-spawn window).
`latest/download` asset URLs resolve to the newest release; older
extensions refuse newer assets by digest. The release/build YAML cannot run
on this rig (no ARM runner, no `gh`); both files parse, and the hosted
release is a publication receipt for the lead. `museVoice.test.ts`'s live
WebSocket case fails identically on the pristine base (sandbox blocks
loopback here); it is outside this lane's suites and untouched.

## Publication boundary

This is the local VS Code-family binding. Native composer/editor and
ACP/terminal rows remain C-M9-1/C-M104-1 as named above. No paid API, Meta
endpoint, live vendor model call, credential or workflow publication was used.

The x64 native payload alone measured 3,111,639 bytes with ZIP deflate;
the current whole-VSIX cap is 3,700 KiB, unchanged by the lead's D106
decision: the helper ships as same-tag release assets instead of in the
package. Stage/CI guards now refuse helper binaries in the VSIX, require
the licence files, and verify the embedded pins against the uploaded
assets. Hosted x64/arm64 native builds, the first real release with helper
assets, the complete universal package and the lead's full aggregate
quality remain publication receipts; this lane cannot push or launch that
workflow. No Linux-enabled VSIX was produced or published.

## RVCM9LNX findings fixed (lane CM9LNX3, kubuntu, 2026-10-10)

Both review findings are fixed by class, each with a regression test and a
red drill (guard broken, named test observed failing, file restored
byte-exact by SHA-256). No new dependency, no widened guard, no gate
weakened. All vitest runs used at most three files, `--maxWorkers=3`, and
the repository's own timeouts (no `--testTimeout`).

### P2 — the offline helper refuses any non-local audio server

- `native/dictation-linux/helper.cpp`: live capture now reads `PULSE_SERVER`
  first. A value that is not a local `unix:` socket throws `remote-server`
  before any connection is opened; an unset value connects through an
  explicit `unix:$XDG_RUNTIME_DIR/pulse/native` server (fallback
  `/run/user/<euid>/pulse/native`), which also overrides client.conf's
  `default-server`. `PULSE_SERVER/SINK/SOURCE` and
  `PIPEWIRE_REMOTE/PIPEWIRE_CORE` are scrubbed from the helper's environment
  after reading. Deliberately kept: `PULSE_COOKIE` (local authentication),
  `XDG_RUNTIME_DIR` (names the local socket), `HOME` (local cookie/config;
  the explicit server wins). Proxy variables are never read by the audio
  client. Failure with only a network server available is explicit
  (`remote-server`, then `stopped`), never a silent fallback.
- `src/core/voice/helperLocation.ts` (`helperEnvironment`, Linux only) plus
  `LINUX_DICTATION.audioServerVariables` (`src/shared/constants.ts`): the
  launcher deletes the same five selectors from the helper's inherited
  environment, after applying the invocation's own variables, so a
  `PULSE_SERVER=tcp:…` on the editor cannot reach the child. Other platforms
  are untouched (covered by test).
- Sibling sweep: the only other audio spawn in the lane,
  `startRecorder` (`src/host/voice/voiceProcesses.ts`, Muse Voice's
  `arecord`/`parec`), makes no offline-only claim and is M35's surface, so
  it is unchanged. No other `PULSE_SERVER`/server-selection path exists in
  `src`, `test` or `native`.
- Regression tests: `test/unit/linuxDictationNative.test.ts` —
  `a network audio server is refused before any connection` (`tcp:` address,
  `tcp:` hostname, bare hostname each yield `remote-server` and no text);
  `test/unit/helperLocation.test.ts` — Linux drops all five selectors while
  keeping cookie/runtime-dir/HOME/PATH, and other platforms keep them.
  Refusal happens before connecting, so no loopback listener is needed and
  these tests run inside the sandbox.

### P3 — disabling dictation reports exactly what happened to the files

- `src/host/voice/dictationHost.ts`: disabled startup returns
  `linuxDictationRemoved` only when the directory is verified absent;
  otherwise it returns the new `linuxDictationRemovalPending` (removal is
  launched, outcome unknown). A failed removal shows
  `{linuxDictationRemoveFailed}: {reason}` — the reason is technical, so it
  stays spliced — and the next startup still says pending and retries, never
  `removed`.
- `src/core/voice/linuxDictation.ts`: a press while disabled reports the new
  `linuxDictationDisabled` (no claim about the files; cleanup is owned
  elsewhere).
- New keys in `src/shared/l10n/en.ts` and all 14 `l10n/ui.*.json` tables;
  `node scripts/check-l10n.mjs` reports 14 UI tables and 0 problems.
- Regression tests: `test/unit/linuxDictationHost.test.ts` — absent files
  say removed without launching removal, present files say pending and
  launch it, a `permissions` rejection shows the reason and the next startup
  still says pending; `test/unit/linuxDictation.test.ts` — a disabled press
  reports disabled, never removed.

### Red drills (all restored byte-exact, `sha256sum -c` OK)

| Guard (fixed SHA-256, first 8) | Break                                      | Observed failure                                                        |
| ------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------- |
| helper.cpp (`e41a18d2`)        | `if (!local)` → `if (false)`               | `a network audio server is refused…` fails (no `remote-server`), 5 pass |
| helperLocation.ts (`83b300b7`) | `if (platform === 'linux')` → `if (false)` | `drops audio-server selectors…` fails, 15 pass                          |
| dictationHost.ts (`1407eb80`)  | pending branch → always `Removed`          | both P3 host tests fail, 2 pass                                         |
| linuxDictation.ts (`1df7875a`) | `Disabled` → `Removed`                     | disabled-press test fails, 8 pass                                       |

### Verification on this rig

- Focused suites: native helper 6 passed; helperLocation 16 passed;
  linuxDictationHost 4 passed; linuxDictation 9 passed; helper+model+driver
  33 passed; dictationHost+voiceBundle+pins 27 passed, 1 pre-existing
  Windows-only skip.
- `npm run typecheck` clean; `eslint --max-warnings=0` and `prettier
--check` clean on all changed files (one `unicorn/no-object-as-default-parameter`
  and one formatting warning in the new native test were fixed, not waived).
- `npm run build` exits 0: activation 553.2 / 600 KiB, voice 45,142 bytes /
  51,200 bytes, Model API 515.8 KiB unchanged.
- No test in this change needs a browser, microphone, loopback server or
  network: there is nothing the lead must run outside the sandbox for these
  findings. Real-helper recognition with the pinned model still awaits the
  release assets (unchanged from the review).
