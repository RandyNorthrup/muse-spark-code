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
  the machine converter probe succeeds. This format gate does not establish
  audio/video model capability; M2 still owns that gate.
- `AttachmentStore`'s M1 region takes `AttachmentMediaPort` as its optional
  third constructor argument (`sniff`, `check`, `part`). Byte dispatch precedes
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

| Owner      | Binding                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M2, E1, E2 | Bind the attachment port's `check` to the selected-model modality gate plus `checkMediaLimits`; bind `part` to the real upload/file-id or captured inline wire. Supply confined `MediaSource` reads and retain the source outside the webview. No Model API audio dispatch is enabled here. |
| A          | Use the converter locator/contract for sound extraction or wrapping through A's real implementation; M1 does not invent transcription responses.                                                                                                                                            |
| W          | Export these functions from the portable lazy `dist/media.js` and wire both extension/runtime entry points. Measure its own budget; do not increase startup/deferred caps.                                                                                                                  |
| W          | Update README/CHANGELOG and the editor/feature registry with the delivered bindings. `featureCatalog.ts` is absent on this base: list bounded media detection, size/duration refusal and the installed-converter action in the integration reference.                                       |

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
| unknown capped/model-limited duration  | M105 media admission enforces duration and refuses unknown duration under a cap/model maximum                                    | exit 1; SHA restored |
| maximum duration                       | M105 media admission enforces duration and refuses unknown duration under a cap/model maximum                                    | exit 1; SHA restored |
| bytes win over extension               | M105 lazy AttachmentStore media port dispatches renamed video by bytes before PDF/text/image names and gates before storing      | exit 1; SHA restored |
| attachment media gate                  | M105 lazy AttachmentStore media port dispatches renamed video by bytes before PDF/text/image names and gates before storing      | exit 1; SHA restored |
| mixed attachment slots                 | M105 lazy AttachmentStore media port keeps host-file metadata only, applies the injected model gate, and preserves mixed budgets | exit 1; SHA restored |
| streamed composer count                | M105 lazy AttachmentStore media port enforces the composer count for streamed and embedded media and names malformed input       | exit 1; SHA restored |

Restoration hashes (before and after):

- `src/core/media/limits.ts`: `7246a293842b93a613029b299ea490772e6411b0bb0719a0c8f1a004db161a0a`.
- `src/core/media/sniff/isoBmff.ts`: `c626b7a68ba2875d4e2589085196bd784ad9eb4762c5e873b31578e6eca6a9b3`.
- `src/core/media/sniff/ebml.ts`: `d7304bccddfd548c0b902a4bfce1a1fe17ddd5082b0ffcd41d20c70123209a67`.
- `src/core/media/sniff/riff.ts`: `94d8fd1c0f51c89dcd30b8f3a78579d964a832ac1c018da091dc227bab5592f4`.
- `src/core/media/sniff/mp3.ts`: `6641d50851e0ff9db6d26800e6a3a56c071926e287784e39605c2c80216c4f67`.
- `src/core/attachments.ts`: `51886fdf23a2b46023c80a730731d0d575938566bc97f44d0adca56f7cdfd7e2`.

Core focused baseline: **32/32 tests passed** across `mediaSniff`,
`mediaSniffMalformed`, and `mediaLimits`, with default timeouts.
Conversion certification and final lane gates are recorded below when complete.
