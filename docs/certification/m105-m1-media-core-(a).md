# M105 M1 — Media core (a)

Kubuntu, 2026-10-06. Branch `m105/m1`, base `10ff139c7` (lane 0 and F,
including F's review fixes). Read the rig brief, shared rules, AGENTS.md,
PLAN.md D85/M105 in full, the coverage audit and M105 capture/research records.
No credential files, network, live/paid/subscription calls or uploads were used.
No dependency, gate, timeout, configuration or bundle cap was changed.

## Scope and contracts

- `sniff/{isoBmff,ebml,riff,mp3}.ts` inspect metadata without decoding frames.
  ISO-BMFF supports the planned brands, compatible brands, ordinary/extended
  box sizes, version 0/1 movie/track headers, moov first/last and fragments.
  Missing/zero/sentinel duration stays null; missing sound metadata stays null.
  Unknown dimensions stay absent. Tail lookup follows top-level box boundaries;
  an apparent moov inside a media payload is never trusted.
- `limits.ts` exports `MediaSource` (size plus an injected confined range read),
  `sniffMedia`, `sniffMediaBytes`, `MediaFileInfo`, `MediaLimits` and
  `checkMediaLimits`. Total requested bytes per sniff are at most
  `MEDIA_SNIFF_MAX_BYTES`, with disjoint head/tail windows for large files.
  Incorrect reads, truncated containers and impossible sizes are refused.
  WAV PCM/float and complete MP3 frames yield duration; Xing/Info/VBRI counts
  can describe a partial MP3, otherwise its duration remains unknown.
- Admission uses the existing 200 MiB default and 1 GiB ceiling, optional
  selected-model formats/duration, and the capped-session unknown-duration
  refusal. Default format admission refuses WebM, Matroska and m4a. A captured
  vendor's supplied formats can admit them. Conversion is offered only after
  the machine converter probe succeeds and the selected model accepts the
  resulting mp4 (including QuickTime converted for an mp4-only model). This format gate does not establish
  audio/video model capability; M2 still owns that gate.
- `AttachmentStore`'s M1 region takes `AttachmentMediaPort` as its optional
  third constructor argument (`sniff`, `check`, `part`), or installs it with
  `installMediaPort` on first media use while preserving attachments already
  in the composer. Byte dispatch precedes
  filename dispatch. `addMedia(name, info)` accepts a previously confined,
  sniffed host file through the same gate. Media entries hold metadata and
  their injected wire binding, never source bytes/base64. Existing image,
  PDF/text delivery and composer/mixed-media limits remain covered by tests.
  There is no runtime import of the sniffers in the attachment store.

The wire binding is an explicit injected dependency, not an invented media
part or a production fake. Lane 0's generated fixtures supply local file
headers, not claimed provider frames. This lane writes no provider schema;
U5's acceptance/refusal findings remain those in `m105-captures.md`.

## Named integration handoffs

| Owner      | Binding                                                                                                                                                                                                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M2, E1, E2 | Load media on first use and install the attachment port; bind its `check` to the selected-model modality gate plus `checkMediaLimits`; bind `part` to the real upload/file-id or captured inline wire. Supply confined `MediaSource` reads and retain the source outside the webview. No Model API audio dispatch is enabled here. |
| A          | Use the converter locator/contract for sound extraction or wrapping through A's real implementation; M1 does not invent transcription responses.                                                                                                                                                                                   |
| W          | Export these functions from the portable lazy `dist/media.js` and wire both extension/runtime entry points. Measure its own budget; do not increase startup/deferred caps.                                                                                                                                                         |
| W          | Update README/CHANGELOG and the editor/feature registry with the delivered bindings. `featureCatalog.ts` is absent on this base: list bounded media detection, size/duration refusal and the installed-converter action in the integration reference.                                                                              |

Suggested `[Unreleased]` entry for W (its docs are not edited across ownership):
“Added bounded video/audio metadata inspection, media size/duration admission,
and a lazy attachment port for streamed media; optional installed conversion
returns a verified private mp4. Editor and wire bindings are integrated separately.”

## Core red drills

Each mutation ran the complete owned test file(s), at most three per run, with
`npx vitest run <files> --maxWorkers=3` and the repository's default timeout.
No test-name filter or raised timeout was used. Every row below exited 1 and
failed the named test. Each source was restored byte-exact, checked by SHA-256.

Five initial mutations stayed green because the original malformed fixture hit
a second guard. The tests now include standalone malformed ftyp, a supplied
EBML window beyond file size, full ID3 streams with invalid versions/revisions,
a synchsafe overflow aligned to real frames, and removal of both frame-size
checks for the same invariant. Rerunning each produced its required red result.
No guard was weakened to obtain green.

| Guard deliberately broken              | Named failing test                                                                                                               | Result               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| bounded head and tail read             | M105 bounded media sniffing finds a tail moov by skipping a large mdat while total reads stay bounded                            | exit 1; SHA restored |
| source size validity                   | M105 bounded media sniffing rejects invalid size, short/oversized reads and reader failures explicitly                           | exit 1; SHA restored |
| exact head read length                 | M105 hostile and partial metadata rejects incorrect head/tail read lengths even when the bytes would otherwise parse             | exit 1; SHA restored |
| exact tail read length                 | M105 hostile and partial metadata rejects incorrect head/tail read lengths even when the bytes would otherwise parse             | exit 1; SHA restored |
| ISO box size and overflow              | M105 bounded media sniffing rejects truncated files, huge/unsafe boxes and malformed nested boxes                                | exit 1; SHA restored |
| ISO ftyp brand                         | M105 hostile and partial metadata refuses unknown/malformed ftyp brands and malformed movie/track/media boxes                    | exit 1; SHA restored |
| ISO ftyp complete layout               | M105 hostile and partial metadata refuses unknown/malformed ftyp brands and malformed movie/track/media boxes                    | exit 1; SHA restored |
| ISO complete top-level header          | M105 bounded media sniffing rejects truncated files, huge/unsafe boxes and malformed nested boxes                                | exit 1; SHA restored |
| ISO unknown duration sentinel          | M105 bounded media sniffing keeps zero, unknown and invalid metadata unknown instead of inventing values                         | exit 1; SHA restored |
| ISO unknown zero duration              | M105 bounded media sniffing keeps zero, unknown and invalid metadata unknown instead of inventing values                         | exit 1; SHA restored |
| ISO dimensions positive                | M105 bounded media sniffing keeps zero, unknown and invalid metadata unknown instead of inventing values                         | exit 1; SHA restored |
| ISO missing soundtrack handler unknown | M105 hostile and partial metadata does not invent sound or dimensions from missing/unreadable track fields                       | exit 1; SHA restored |
| ISO soundtrack detection               | M105 bounded media sniffing reads isom metadata with moov first/last, sound and fragmentation                                    | exit 1; SHA restored |
| EBML document type                     | M105 hostile and partial metadata refuses duplicate/unknown EBML DocTypes and malformed lengths                                  | exit 1; SHA restored |
| EBML header bound                      | M105 hostile and partial metadata refuses duplicate/unknown EBML DocTypes and malformed lengths                                  | exit 1; SHA restored |
| EBML child bound                       | M105 hostile and partial metadata refuses duplicate/unknown EBML DocTypes and malformed lengths                                  | exit 1; SHA restored |
| EBML duplicate document type           | M105 hostile and partial metadata refuses duplicate/unknown EBML DocTypes and malformed lengths                                  | exit 1; SHA restored |
| RIFF declared file bound               | M105 bounded media sniffing reads wav duration from fmt/data, skips padded chunks, refuses truncation                            | exit 1; SHA restored |
| RIFF chunk bound                       | M105 hostile and partial metadata refuses RIFF boundaries, short fmt and zero block alignment before deriving duration           | exit 1; SHA restored |
| RIFF fmt boundary                      | M105 hostile and partial metadata refuses RIFF boundaries, short fmt and zero block alignment before deriving duration           | exit 1; SHA restored |
| RIFF zero rate/alignment               | M105 bounded media sniffing reads wav duration from fmt/data, skips padded chunks, refuses truncation                            | exit 1; SHA restored |
| MP3 header sync                        | M105 hostile and partial metadata validates MP3 version/layer/sync/rate and ID3 version/size boundaries                          | exit 1; SHA restored |
| MP3 version/layer/sync flags           | M105 hostile and partial metadata validates MP3 version/layer/sync/rate and ID3 version/size boundaries                          | exit 1; SHA restored |
| MP3 bitrate/sample rate                | M105 bounded media sniffing refuses invalid ID3 sizes, reserved/free-rate frames and trailing garbage                            | exit 1; SHA restored |
| MP3 ID3 syntax                         | M105 hostile and partial metadata validates MP3 version/layer/sync/rate and ID3 version/size boundaries                          | exit 1; SHA restored |
| MP3 synchsafe ID3 size                 | M105 hostile and partial metadata validates MP3 version/layer/sync/rate and ID3 version/size boundaries                          | exit 1; SHA restored |
| MP3 ID3 file bound                     | M105 hostile and partial metadata validates MP3 version/layer/sync/rate and ID3 version/size boundaries                          | exit 1; SHA restored |
| MP3 frame file bound                   | M105 bounded media sniffing validates mp3 with ID3=true and counts complete frames                                               | exit 1; SHA restored |
| MP3 complete stream bound              | M105 bounded media sniffing refuses invalid ID3 sizes, reserved/free-rate frames and trailing garbage                            | exit 1; SHA restored |
| invalid configured media limits        | M105 media admission enforces default/configured/hard byte limits and exact boundary acceptance                                  | exit 1; SHA restored |
| invalid metadata admission             | M105 media admission refuses empty/invalid metadata before admission                                                             | exit 1; SHA restored |
| upload size limit                      | M105 media admission enforces default/configured/hard byte limits and exact boundary acceptance                                  | exit 1; SHA restored |
| unsupported format refusal             | M105 media admission refuses WebM/Matroska/m4a with conversion offered only after the machine probe                              | exit 1; SHA restored |
| converter availability offer           | M105 media admission refuses WebM/Matroska/m4a with conversion offered only after the machine probe                              | exit 1; SHA restored |
| conversion target model format         | M105 media admission offers conversion only when the selected model accepts the resulting mp4                                    | exit 1; SHA restored |
| unknown capped/model-limited duration  | M105 media admission enforces duration and refuses unknown duration under a cap/model maximum                                    | exit 1; SHA restored |
| maximum duration                       | M105 media admission enforces duration and refuses unknown duration under a cap/model maximum                                    | exit 1; SHA restored |
| bytes win over extension               | M105 lazy AttachmentStore media port dispatches renamed video by bytes before PDF/text/image names and gates before storing      | exit 1; SHA restored |
| attachment media gate                  | M105 lazy AttachmentStore media port dispatches renamed video by bytes before PDF/text/image names and gates before storing      | exit 1; SHA restored |
| mixed attachment slots                 | M105 lazy AttachmentStore media port keeps host-file metadata only, applies the injected model gate, and preserves mixed budgets | exit 1; SHA restored |
| streamed composer count                | M105 lazy AttachmentStore media port enforces the composer count for streamed and embedded media and names malformed input       | exit 1; SHA restored |
| lazy media port installation           | M105 lazy AttachmentStore media port installs the lazy media port after construction without losing existing attachments         | exit 1; SHA restored |

Restoration hashes (before and after the final drill for each source):

- `src/core/media/limits.ts`: `81e0892554452c9816cbbd0c2ae95cceb08bb42a634f9a0d5ee9fac3e11329ad`.
- `src/core/media/sniff/isoBmff.ts`: `c626b7a68ba2875d4e2589085196bd784ad9eb4762c5e873b31578e6eca6a9b3`.
- `src/core/media/sniff/ebml.ts`: `d7304bccddfd548c0b902a4bfce1a1fe17ddd5082b0ffcd41d20c70123209a67`.
- `src/core/media/sniff/riff.ts`: `94d8fd1c0f51c89dcd30b8f3a78579d964a832ac1c018da091dc227bab5592f4`.
- `src/core/media/sniff/mp3.ts`: `6641d50851e0ff9db6d26800e6a3a56c071926e287784e39605c2c80216c4f67`.
- `src/core/attachments.ts`: `e886357c9e4f480c46af3abdf622bea6a202b686e12391e626d4983a392677a1`.

Core focused baseline: **34/34 tests passed** across `mediaSniff`,
`mediaSniffMalformed`, and `mediaLimits`, with default timeouts. The first
commit is `a7de924c1`; the later installation method keeps existing attachments
when the integrating lane loads media. Its mutation and the four attachment
admission mutations were rerun and restored against the final source hash.

## Conversion and its red drills

`convert.ts` finds only a preinstalled system avconvert on macOS or an ffmpeg
in an absolute PATH directory. It installs nothing. Its real process boundary
uses argument arrays, no shell, suppressed stdin/stdout/stderr, a hard deadline,
Stop, and waits for process close before cleanup. Every credential variable is
removed from the child environment, without modifying the host's environment.
Input is sniffed before launch; ffmpeg gets a fixed demuxer, only the file
protocol, and no external QuickTime track references. Output must be a regular,
sniffed mp4 within admission limits before success. Failure/Stop removes the
private output; success returns its path/metadata and an idempotent disposer.

POSIX directories/files use 0700/0600, including a converter that changes the
file's mode. **Windows binding: R2/E1/E2/W must supply
`MediaConversionOptions.createPrivateDirectory`, a fresh directory with an
owner-only ACL, through the host/native runtime.** Without this port, Windows
conversion refuses before any process starts; chmod is not treated as a Windows
privacy guarantee. Tests inject this factory only in test code. A relative
factory result is refused without deleting it. Native ACL certification remains
with those Windows/native bindings, not with a POSIX rig claim.

The converter's injected `run` is a real process port; it must honor the supplied
signal/deadline and resolve only once its process closes. There is a complete
production process implementation when no port is supplied. It carries no key,
provider endpoint or network call. A's sound extraction/wrapping remains A's
implementation, using this discovery contract and its own real conversion port.

Four initial converter mutations were masked by another guard. Tests now align
symlink metadata size to a real clip, exercise source sniffing through avconvert,
and use a finite fake child with an independent deadline to prove Stop fires.
Each rerun failed the intended named test. Fake children terminate independently
in 200 ms if their Stop guard is deliberately removed; no test needs a raised
Vitest timeout or leaves a long-lived child.

| Guard deliberately broken                | Named failing test                                                                                                     | Result               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------- |
| converter discovery absent               | M105 converter discovery offers conversion only for an installed converter on an absolute PATH                         | exit 1; SHA restored |
| converter absolute command               | M105 private local conversion refuses relative commands/inputs, directories and invalid timeouts before launch         | exit 1; SHA restored |
| converter absolute source                | M105 private local conversion refuses relative commands/inputs, directories and invalid timeouts before launch         | exit 1; SHA restored |
| converter configured deadline            | M105 private local conversion refuses relative commands/inputs, directories and invalid timeouts before launch         | exit 1; SHA restored |
| converter input file                     | M105 private local conversion refuses a symbolic-link source before launching a converter                              | exit 1; SHA restored |
| converter sniffed input                  | M105 private local conversion refuses unrecognized input before launching a decoder or creating output                 | exit 1; SHA restored |
| converter local demuxer/protocol options | M105 private local conversion uses an argument array, private directory/file, and verifies mp4 metadata before success | exit 1; SHA restored |
| converter external tracks forbidden      | M105 private local conversion uses an argument array, private directory/file, and verifies mp4 metadata before success | exit 1; SHA restored |
| converter owner-only directory           | M105 private local conversion uses an argument array, private directory/file, and verifies mp4 metadata before success | exit 1; SHA restored |
| converter owner-only file                | M105 private local conversion uses an argument array, private directory/file, and verifies mp4 metadata before success | exit 1; SHA restored |
| converter credential environment         | M105 private local conversion drops every credential variable, including mixed-case names, without changing the host   | exit 1; SHA restored |
| converter output file                    | M105 private local conversion refuses symbolic-link output and cleans the private directory                            | exit 1; SHA restored |
| converter output sniff                   | M105 private local conversion refuses malformed/wrong-format output and deletes it                                     | exit 1; SHA restored |
| converter output limits                  | M105 private local conversion enforces output size/duration limits and removes refused conversions                     | exit 1; SHA restored |
| converter final Stop                     | M105 private local conversion honors cancellation during final output admission                                        | exit 1; SHA restored |
| converter process close failure          | M105 private local conversion waits for process close after timeout/Stop and suppresses process output                 | exit 1; SHA restored |
| converter process timeout                | M105 private local conversion waits for process close after timeout/Stop and suppresses process output                 | exit 1; SHA restored |
| converter process abort                  | M105 private local conversion waits for process close after timeout/Stop and suppresses process output                 | exit 1; SHA restored |
| converter before-launch cancellation     | M105 private local conversion cancels during preflight without starting a process                                      | exit 1; SHA restored |
| Windows private directory required       | M105 private local conversion requires the Windows private-directory port and refuses relative factory results safely  | exit 1; SHA restored |
| private directory absolute result        | M105 private local conversion requires the Windows private-directory port and refuses relative factory results safely  | exit 1; SHA restored |
| converter failure cleanup                | M105 private local conversion removes output after failure and never surfaces stderr, private paths or arguments       | exit 1; SHA restored |

`convert.ts` before/after each drill: `ccd74ab8eab6700111ce0b429727067fd9d2c052f944be8d4085321cb55e1f43`.

**64 distinct red drills proven** (42 core, 22 conversion). No skips,
filters, thresholds, timeout overrides or ignores were introduced.

## Installed converter check

On Kubuntu, the real locator found the existing `/usr/bin/ffmpeg`. A local
generated blue 64×48 WebM with a 440 Hz soundtrack converted through the
production process implementation, not an injected runner. The verified MP4
was 11,849 bytes, 64×48, with sound and a 1.015-second movie-header duration.
Its directory/file modes were 0700/0600; disposal removed the output, and the
generated input was removed in finally. No tool was installed.

An independent installed ffprobe agreed on dimensions and sound and reported
1.013991 seconds from stream timestamps. Two exploratory exact-duration
assertions (one second, then ffprobe equality) were invalid references for
integer movie-header ticks and codec/edit-list timestamps. No production code
changed for those assertions. The final check used a two-millisecond
conservative comparison and observed a 1.009-millisecond difference. The
committed fixture tests still assert exact movie-header values; their gates
and coverage thresholds are unchanged.

## Final lane verification

All commands ran directly on Kubuntu, sequentially for compiler/linter/build
and Vitest work. The two final Vitest batches used `--maxWorkers=3`, at most
three files, and the repository's default timeout:

- `mediaSniff.test.ts`, `mediaSniffMalformed.test.ts`, `mediaLimits.test.ts`:
  **34/34 passed**. Focused sniff/limits coverage: 98.08% statements,
  96.59% branches, 100% functions and 100% lines.
- `mediaConvert.test.ts`, the existing `attachments.test.ts`,
  `mediaLimits.test.ts`: **44/44 passed**. Focused converter/attachment
  coverage: 95.77% statements, 91.25% branches, 97.77% functions and
  95.91% lines. These batches cover **68 distinct tests**; the ten admission
  tests run in both.
- `npm run typecheck`: all five projects passed.
- Changed-file ESLint with `--max-warnings=0` and Prettier: passed.
  `git diff --check`: passed.
- `npm run deadcode` (plain knip): passed; only the existing two configuration
  hints. `npx jscpd`: passed, zero clones. `npm run cycles`: passed,
  563 files, no circular dependencies.
- `node scripts/check-l10n.mjs`: 14 tables, 164 manifest strings,
  600 source files, **0 problems**. Existing media strings are read at runtime;
  no new strings or translations were needed.
- `node scripts/check-host-globals.mjs`: passed for all shipped Node bundles.
  `node scripts/third-party-notices.mjs`: passed, 83 bundled packages.

The rig brief reserves full quality, full unit, integration, accessibility and
cross-platform gates to the lead. They were not run in this lane. There is no
new UI, command, setting, dependency, license acceptance or install.

### Existing integration blockers remain enforced

`npm run check:host-api` exits 1 because its generated Node-import count table
is stale (buffer 39→43, child_process 13→14, crypto 46→48, fs 33→34,
fs/promises 47→48, os 9→10, path 84→85). It still reports 332 VS Code APIs,
31 files importing vscode and 61 theme variables. No media core file imports
vscode. **W must regenerate and review the host record** with
`npm run check:host-api -- --write`; that file is explicitly W-owned.

`npm run build` compiles production successfully, then exits 1 at the unchanged
browser deferred-JS cap: **51.1 KiB against 50 KiB**. Independently running
`node scripts/check-bundle-split.mjs` exits 1 because predecessor lane F's
`src/core/backends/modelapi/files.ts` is on neither classification list.
Both blockers, and the stale crypto count, already appear in PLAN.md §9's
`M105-F-integration-gates` record on this base. M1 adds no browser imports.
The remaining build subchecks were run directly, as listed above.

| Production artifact                | Measured KiB | Unchanged cap KiB |
| ---------------------------------- | -----------: | ----------------: |
| extension                          |        442.6 |               600 |
| conversation                       |        201.6 |               250 |
| Model API                          |        449.9 |               475 |
| ACP                                |        822.8 |               850 |
| shared English fallback            |         49.3 |               125 |
| browser startup and static imports |        899.1 |               900 |
| browser deferred JS                |         51.1 |                50 |

W owns the docs, host record, split classification, browser budget correction
and `dist/media.js` wiring/budget. They were not changed across lane ownership.
No cap, classification, ignore or threshold was weakened. The feature remains
behind the explicit editor/wire ports until those named integrations land;
Windows conversion additionally requires its native private-directory binding.
