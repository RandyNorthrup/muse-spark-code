# M105 M1 — Media core (a)

## RVM105M12 corrections (2026-10-06, Kubuntu)

Read the rig brief, all shared lane rules and the full RVM105M12 report.
Both P2 findings are fixed; there are no remaining P1/P2/P3 review findings.
Changes stay in the media core, its owned tests and the plan/certification/
changelog records. No dependency, install, model/network call, merge, push,
new command/setting, wider guard or gate change. Existing localized refusal
messages are retained; raw sampler errors, private paths and process output
are never displayed.

**P2-1 — encoder close and resource sampling.** Close stops new watcher/
watchdog checks, awaits the bounded in-flight check and performs a final
output/RSS check before success. Failure accounting remains effective after
close; a closed child is never killed. Every sample retains its 100 ms
deadline, including a stalled sample after close. Stop and the encoding
deadline remain effective through final sampling. Excessive/invalid/failed/
unavailable or stalled readings refuse and remove the private output.

Linux no longer maps a missing `/proc/<pid>/status` to zero. An explicitly
reported zombie/exited kernel state still proves zero resident memory;
an unavailable reading proves nothing and refuses. A reaped process will
normally have no readable status, so default Linux conversion can now safely
refuse at the final sample. The existing **M105-M1-resource-monitor-binding**
handoff (PLAN §9, M107/W/E1/E2) must supply a retained, verifiable final reading
through the governor/native monitor. The real-process positive control injects
a known final sampler; it does not claim Linux can read a reaped process.
Every editor uses the same portable conversion contract.

**P2-2 — conflicting ISO-BMFF structure.** Reject repeated top-level `ftyp`,
`moov`, `meta`, `pdin` and `mfra`, and repeated metadata fields the parser
consumes as singletons (`mvhd`, `tkhd`, `mdia`, `hdlr`). Audio/video kind,
soundtrack, duration and dimensions therefore come from one readable movie
and its unambiguous metadata. If another top-level header cannot be checked
within the head/tail windows, refuse instead of accepting an earlier movie.
Repeated `mdat`/`moof` remain valid. The two-order duplicate-movie regression
also separates the movies with a large `mdat` to exercise both windows;
single audio and video movies remain positive controls.

New tests were run against unchanged production code first: the close-race,
final-reading and duplicate-structure regressions failed. The first Linux
regression used a polling call-count assertion that could miss its sample;
it now awaits an explicit sampling promise. Its fallback-to-zero red drill
below proves the corrected regression fails for the intended reason.

### Red drills (full files, default timeouts)

Each mutation ran `npx vitest run test/unit/<file>.test.ts --maxWorkers=3`
with no test-name filter or timeout override. All eight exited 1 at the named
regression, then restored the source bytes and compared SHA-256 before
continuing. All eight were rerun against the final shared fake-child fixture;
again every named regression failed and every restored SHA matched.
Logs/scripts remain ignored under `temp/rvm105m12-*`.

| Guard deliberately broken               | Named failing regression                                                             | Result               |
| --------------------------------------- | ------------------------------------------------------------------------------------ | -------------------- |
| failure accounting after close          | refuses an in-flight excessive RSS sample that settles after successful close        | exit 1; SHA restored |
| await in-flight sample                  | waits for an in-flight RSS sample and a final sample after successful close          | exit 1; SHA restored |
| sample deadline refusal                 | refuses an in-flight stalled RSS sample that settles after successful close          | exit 1; SHA restored |
| final resource sample                   | refuses a final excessive resource sample after successful close                     | exit 1; SHA restored |
| unavailable Linux RSS (substitute zero) | refuses unavailable Linux RSS after close instead of substituting zero               | exit 1; SHA restored |
| unique top-level boxes                  | refuses duplicate audio/video moov boxes with video first=false and video first=true | exit 1; SHA restored |
| unique nested metadata                  | refuses duplicate unique structural boxes while allowing repeated media/fragments    | exit 1; SHA restored |
| complete top-level window traversal     | refuses unscanned top-level headers that could hide a conflicting movie              | exit 1; SHA restored |

Restoration hashes for every drill:

- `src/core/media/convert.ts`:
  `acd8ddc90a9752d913c74fe5d9faa323e72cd260f7d3f03932a2422700e95f0f`.
- `src/core/media/sniff/isoBmff.ts`:
  `4fd6e5f6a31d648180d86de582dbdc41d0eed459cd8ad1c5482e8670ac6b66cf`.

### Verification for this correction

All runs are direct on Kubuntu. Final Vitest runs use the repository's default
five-second test timeout and at most three files per command:

- `npx vitest run test/unit/mediaConvert.test.ts test/unit/attachments.test.ts --maxWorkers=3`:
  **55/55 passed**.
- `npx vitest run test/unit/mediaSniff.test.ts test/unit/mediaSniffMalformed.test.ts test/unit/mediaLimits.test.ts --maxWorkers=3`:
  **39/39 passed**. The two final batches cover **94 distinct tests**.
- `npm run typecheck`: all five projects passed.
- Changed-source/test `npx eslint --max-warnings=0`: passed without
  suppressions; `git diff --check`: passed.
- Changed-file `npx prettier --check`: all seven changed files passed.
- `npm run deadcode`: passed, with the same two existing configuration hints;
  rerun successfully after extracting the test helper.
- `npx jscpd`: passed, zero clones. Its initial run found three copies of
  fake-child setup in the new converter regressions; that setup is now one
  test-only helper. The final test fixture also passes `npm run typecheck:unit`
  and changed-file ESLint. Production hashes remain identical to the drills.
- `npm run check:l10n`: 14 tables, 164 manifest strings, 600 source files,
  **0 problems**. No localization keys were added or changed.
- `npm run check:host-api`: exits 1 at the pre-existing W-owned generated
  import table. Current counts differ from its stored values: buffer 39→44,
  child_process 13→14, crypto 46→48, fs 33→34, fs/promises 47→48,
  os 9→10, path 84→85. Still 332 VS Code APIs, 31 vscode-importing files,
  25 Node built-ins and 61 theme variables. This fix adds no import or host API.
- `npm run build`: production compilation passed, then exit 1 at the
  unchanged deferred-browser cap, **51.1/50 KiB**. Direct
  `node scripts/check-bundle-split.mjs` exits 1 because lane F's `files.ts`
  is still on neither classification list. Both remain the named
  **M105-F-integration-gates** handoff (PLAN §9); no gate/cap was changed.
- The post-build checks that the cap failure prevents the aggregate script
  from reaching were run directly: `node scripts/check-host-globals.mjs`
  passed for every Node bundle; `node scripts/third-party-notices.mjs`
  passed for 83 bundled packages.

| Production artifact                | Measured KiB | Cap KiB |
| ---------------------------------- | -----------: | ------: |
| extension                          |        442.7 |     600 |
| conversation                       |        201.7 |     250 |
| Model API                          |        450.0 |     475 |
| ACP                                |        822.8 |     850 |
| shared English fallback            |         49.3 |     125 |
| browser startup and static imports |        899.2 |     900 |
| browser deferred JS                |         51.1 |      50 |

The rig override reserves full quality/full unit/integration/cross-platform
runs for the lead. No claim that those integrated gates pass is made.
The first correction commit is `63fdd1b6d`, with ESLint/Prettier and gitleaks
pre-commit hooks successful. Production hashes match the drill restoration
hashes after that commit; the following commit removes only duplicated test
setup and records final gate results.

No review finding is deferred. Existing integration handoffs and enforced
W-owned gate blockers remain as recorded below and in PLAN §9.

## RVM105M1 corrections (2026-10-06)

The follow-up rig brief and shared rules were read in full. No merge is
authorized by the rig override; work stays on `m105/m1`. Full quality remains
the lead's integrated-tree gate. All three review findings are fixed, with
no dependency, paid call, install or gate change.

**P2-2: actual ISO-BMFF tracks.** `vide` decides video; a movie with only
`soun` is `audio/mp4`, including an ordinary isom MP4, M4A and QuickTime.
A brand is only a container recognition check. Missing/unreadable track
handlers and a moov outside the bounded windows now refuse: the current
metadata contract cannot represent an unknown kind honestly. Duration can
still be unknown when readable tracks establish the kind. Audio-only
conversion output is refused by the existing video output check. Lane A
still owns wrapping audio with a real still frame.

Regression: “classifies M4A and audio-only MP4 from tracks and blocks
video-only admission”; “refuses audio-only MP4 output from a conversion
advertised as video”. All 35 sniff/malformed/admission assertions and all
35 conversion/attachment assertions passed on Kubuntu with default timeouts.
An initial adjusted malformed assertion tried `toHaveProperty` on undefined;
the assertion now checks absent kind and absent dimensions separately.

Red drills run full files, restore source byte-exact and compare SHA-256:

| Guard broken                      | Expected named failure                                                                                                                             | Outcome              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| choose kind from brand again      | classifies M4A and audio-only MP4 from tracks and blocks video-only admission; refuses audio-only MP4 output from a conversion advertised as video | exit 1; SHA restored |
| accept unknown track kind         | refuses unknown track kind when moov is outside both windows and ignores payload decoys                                                            | exit 1; SHA restored |
| assume a missing handler is video | does not invent sound or dimensions from missing/unreadable track fields                                                                           | exit 1; SHA restored |

Sniffer SHA before/after all three drills:
`86ba4e764d07eed18b22bdf56a98931b53faf4a68f8301318a047bfc44ffb47e`.

**P1: verified discovery and launch.** PATH is never read for a converter.
Candidates are explicit machine/user configuration or these documented installs:
Linux `/usr/bin/ffmpeg`, `/usr/local/bin/ffmpeg`; macOS `/usr/bin/avconvert`,
`/opt/homebrew/bin/ffmpeg`, `/usr/local/bin/ffmpeg`; Windows
`C:\Program Files\ffmpeg\bin\ffmpeg.exe`. Relative configuration is refused.
Each version process first calls `TrustedPathVerifier.verify(path,
{ leafKind: 'file' })`; each encoding launch verifies again. Only `ok`
admits. The verifier's absence, refusal or exception never starts that process.
Version stdout has a 16 KiB cap and a two-second deadline, stderr is ignored,
and credentials are scrubbed from the probe as well as the encoder. A strict
release banner is required; a help page or development/unknown banner refuses.
The ffmpeg test banner is the rig's installed 8.0.1 release banner. The
avconvert banner in tests exercises the injected boundary only, not a claimed
macOS capture. An unversioned avconvert refuses in production.

**Named handoff: M105-M1-trusted-converter-binding (REDM104L3, W, E1, E2).**
`src/runtime/trustedPath.ts` is absent on this base. Bind/adapt its shared
StrictModes/safe_path implementation to the consumer's `trustedPath` port:
realpath, root/user ownership and no group/world write on every component,
canonical-path symlink rejection and file leaf validation. Missing binding
refuses both discovery and conversion. No permissive production verifier is
provided. All editors use this portable core seam. The macOS owner must
capture a real converter version before claiming avconvert availability;
otherwise a verified, versioned ffmpeg is the available choice. This is a
binding requirement, not a remaining review finding.

P1 regressions passed: ignores workspace PATH; refuses absent/unsafe/relative
verification before probing; strictly refuses unknown/malformed/oversized
versions; kills deadline/overflow probes and waits for close; re-verifies after
probing and refuses replacements before encoding. Converter suite: **22/22**
passed under the repository's default timeout. All seven P1 guard drills exited
1, failing these named regressions, and restored the source SHA-256:
`50cc04f0848602ebee03e10ef1c1cd4bcabfc54058bddefbee38b76e1ada8bf1`.

| Guard removed                 | Named failing regression                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| verification before probe     | refuses absent verification, unsafe components and relative configuration before probing |
| verification before encoding  | re-verifies trust after probing and refuses replacements before encoding                 |
| absolute configured candidate | refuses absent verification, unsafe components and relative configuration before probing |
| strict version parser         | strictly refuses unknown, malformed and oversized version banners                        |
| returned probe byte cap       | strictly refuses unknown, malformed and oversized version banners                        |
| streaming probe byte cap      | kills a timed-out or overflowing version probe and waits for close                       |
| probe deadline                | kills a timed-out or overflowing version probe and waits for close                       |

The first streaming-cap drill stayed green because the deadline also killed
the overflowing child. Its fixture now exits naturally before the deadline;
removing the streaming cap then fails the kill assertion. The rerun and deadline
drill both fired, with full test files, default timeouts and byte-exact restoration.

## P2-1 correction: limits during encoding

The default runner now starts a file-change watcher and a 25 ms watchdog with
the child. It stops on a non-file output or output size above the configured
cap (200 MiB by default, at most 1 GiB). ffmpeg additionally receives
`-max_alloc`; this native control supplements the RSS watchdog. Output
overflow stops and refuses conversion instead of requesting a shortened clip.
Both converter kinds have running-output overflow regressions.
RSS is sampled immediately and throughout the run against a named 512 MiB
cap. Invalid, failed or stalled samples stop the child; a sample has a 100 ms
deadline. Stop, output/memory refusal and the encoding deadline all wait for
close before deleting the private directory. Watchers and timers are disposed.
The final bytes/duration/format admission remains in place.

**Named handoff: M105-M1-resource-monitor-binding (M107/W/E1/E2).** M107's
process-ticket implementation is absent on this base. The core defaults to
Linux's `/proc/<pid>/status` RSS sampler, checking the live host's sampler
before admission. Other platforms require the injected native `readRssBytes`
port and refuse encoding without it. Bind the process governor/ticket when
available in the integrated tree, and supply equivalent monitoring in the
extension, runtime and native editor surfaces. An alternate `run` port must
enforce the supplied output/RSS/deadline contract and wait for close; no
production unbounded runner is supplied. This is an integration requirement;
no P2 review finding is left open.

Regressions: “kills ffmpeg while output grows past its byte cap”, “kills
avconvert while output grows past its byte cap”, “kills encoding on excessive,
invalid, failed or stalled RSS samples”, “refuses encoding when the platform
has no RSS monitor binding”, and “refuses invalid output byte caps before
launch”. The old final-cancellation fixture now aborts on its second limit
read, since output-cap admission correctly reads the limit before launch.

Linux sampling also distinguishes an explicitly exited/zombie child from a
live process without RSS; the former consumes no resident memory, while the
latter refuses before launch. That race and unreadable-live-RSS refusal have
one dedicated regression. The final resource suite and attachments pass
**45/45** assertions; together with the sniff/admission suites this is **80**
distinct assertions, all under the repository's default timeout.

All ten resource drills exited 1 at the named assertions, with the entire
converter test file, default timeouts and byte-exact restoration to SHA-256
`724543b67f26a3c1aceeecbed111344e4ac524d0205ef701625d35b1e91f351e`.
There are **20 follow-up red drills** in total (3 kind, 7 trust/version,
10 encoding resource guards), with no remaining review finding.

| Deliberate resource break   | Named failing regression                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| growing output cap          | kills ffmpeg while output grows past its byte cap; kills avconvert while output grows past its byte cap |
| RSS byte maximum            | kills encoding on excessive, invalid, failed or stalled RSS samples                                     |
| RSS integer validation      | kills encoding on excessive, invalid, failed or stalled RSS samples                                     |
| negative RSS refusal        | kills encoding on excessive, invalid, failed or stalled RSS samples                                     |
| RSS sample deadline         | kills encoding on excessive, invalid, failed or stalled RSS samples                                     |
| required native monitor     | refuses encoding when the platform has no RSS monitor binding                                           |
| ffmpeg allocation argument  | uses an argument array, private directory/file, and verifies mp4 metadata before success                |
| output cap admission        | refuses invalid output byte caps before launch                                                          |
| exited-child RSS exception  | allows a Linux child exiting between RSS sampling and close without accepting unreadable live RSS       |
| unreadable live RSS refusal | allows a Linux child exiting between RSS sampling and close without accepting unreadable live RSS       |

The duplication gate caught 8 repeated lifecycle lines between the probe and
encoder. Both now share their Stop/error/deadline observer; neither limit nor
failure check was removed. `npx jscpd` reports zero clones. Two additional
shared-lifecycle drills removed the deadline and in-flight abort wiring: both
exited 1 at “waits for process close after timeout/Stop and suppresses process
output”, and the deadline break also failed the version-probe kill regression.
Both restored the same converter SHA above. **22 follow-up drill executions**
are recorded (20 finding controls and these two lifecycle controls).

## Follow-up final verification

The rig's `/tmp` hit its per-user quota during repeated drills. Vitest's
cache debug trace showed native write errno 122 (`EDQUOT`), then missing SSR
cache files during suite collection. No source guard or timeout was changed to
work around it. Final tests and the last resource drills use
`TMPDIR=/home/randy/lanes/M105M1/temp` (the ignored lane scratch directory).
The same conversion/attachment batch then passed 45/45. A scoped filesystem
spy remains limited to the kernel-state test; a broad builtin mock was removed
while investigating the failure. The quota, rather than that mock, was the
confirmed collection blocker. No shared temp files or machine settings were
changed, and no tool was installed. One kernel-state fixture then exposed its
mix of two fake reads with later real kernel samples during child transitions;
it now supplies a consistent fake kernel state for all child samples. The
real Linux sampler remains exercised by the ordinary process-completion cases,
and the production limit/deadline stayed unchanged. The adjusted state test
and both state guard drills passed/fired under the repository's timeout.

Final commands (Kubuntu; compiler/linter/build/Vitest ran one at a time):

- `TMPDIR=/home/randy/lanes/M105M1/temp npx vitest run test/unit/mediaSniff.test.ts test/unit/mediaSniffMalformed.test.ts test/unit/mediaLimits.test.ts --maxWorkers=3`: **35/35 passed**.
- `TMPDIR=/home/randy/lanes/M105M1/temp npx vitest run test/unit/mediaConvert.test.ts test/unit/attachments.test.ts --maxWorkers=3`: **45/45 passed**; the final converter suite runs after the state-fixture adjustment and guard restoration.
- `npm run typecheck`: all five projects passed on final production source;
  `npm run typecheck:unit` also passed after the last test-fixture change.
- Changed-file ESLint (`--max-warnings=0`), Prettier and `git diff --check`:
  passed. No lint exemption or escape hatch was added.
- `npm run deadcode`: passed (only the two existing hints).
- `npx jscpd`: passed, zero clones; its initial duplicate failure was fixed
  by sharing the converter lifecycle observer.
- `npm run check:l10n`: 14 tables, 164 manifest strings, 600 source files,
  **0 problems**. No text key, command, setting or dependency changed.
- `npm run check:host-api`: exit 1, the existing W-owned generated record is
  stale. The current Node importer counts are buffer 44, child_process 14,
  crypto 48, fs 34, fs/promises 48, os 10, path 85. It still finds 332 VS Code
  APIs, 31 vscode importers and 61 theme variables; media core imports none.
- `npm run build`: production compilation passed; exit 1 at the existing
  deferred-browser **51.1/50 KiB** cap. Other measured artifacts: extension
  **442.7/600 KiB**, conversation **201.7/250 KiB**, Model API
  **450.0/475 KiB**, ACP **822.8/850 KiB**, browser startup
  **899.2/900 KiB**. A static Windows install string avoids an unnecessary
  startup evaluation of `String.raw`. No budget was raised.
- `node scripts/check-bundle-split.mjs`: exit 1 at predecessor lane F's
  `files.ts` missing classification, unchanged and W-owned.
- `node scripts/check-host-globals.mjs`: passed for every shipped Node bundle.
- `node scripts/third-party-notices.mjs`: passed, 83 bundled packages.

Full quality, cross-platform, live media/model and shipped editor bindings
remain the lead's integration work, as required by the rig brief. No review
finding is residual. The two named trust/resource bindings refuse safely while
absent; the existing integration gates keep rejecting release. W retains the
README, CHANGELOG and reference updates for the shipped media bindings. Its
Unreleased security note should name trusted versioned conversion, running
output/RSS limits and actual audio-only MP4 classification.

## Original implementation record (before RVM105M1)

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
