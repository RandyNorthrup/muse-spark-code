# M105 E3: companion, native plugins and Muse Code

linuxlt (Ubuntu rig), 2026-10-06; branch `m105/e3`, base `c1d6cf6ed`.
Read rig brief, common rules, gotcha register, AGENTS.md, D85/M105,
coverage research and lane-0/M1/M2 capture/certification records.
Zero live, paid, subscription or external HTTP calls. Fake HTTP binds loopback
only. No credentials read, dependencies installed, branch merges or pushes.

## Streamed upload delivered

`src/runtime/companion/upload.ts` is a route handler, not a server. M104 C
must inject its exact loopback origin, per-window bearer/custom headers,
window lifetime/deadline and captured epoch predicate. Session replacement
must abort the old lifetime; `isCurrent` compares against that captured epoch,
not merely whether some session is active. Every request checks method,
Host, Origin, Fetch Metadata, custom header, bearer and absence of cookies.
It streams raw HTTP into an exclusively created 0600 file in a 0700 temporary
directory; SHA-256 is incremental. Sniffing uses M1 bounded windows, with
existing image/PDF sniffers. Browser names never become disk paths.
A required admission port checks selected-model formats, duration, caps,
storage billing and consent before a required consumer handles the private
source. Consumer completion returns a validated opaque token and metadata.
Epoch and cancellation are checked before admission, after admission and
after consumption. Success, failures, cancellation and disconnected clients remove temporary
bytes. Unexpected policy/provider errors are not echoed to the browser.

All text reuses lane-0's translated media region and existing generic wording;
no manifest entries, settings, commands or language tables added by E3.

## Controls, native bridge and Muse Code delivered

The companion controls and approved tool-video player each have a React lazy
entry. Picker/drop/paste pass the original File directly to a Fetch body with credentials omitted; the
page does not read or encode bytes and never carries a provider key. Honest start/completion progress
and Stop share one upload owner; Fetch has no native upload byte-progress events. Strict HTTP response validation checks the
exact response URL, status, request id, name, size and metadata-only token.
The required attachment epoch remount cancels stale uploads and recordings.
The recording port has no production fake: R3 supplies capture. Audio choices
start off and reset after each recording. A stopped recording has a Blob URL
preview, warning, Attach and Discard; no upload starts before Attach. Discard,
unmount and late results dispose the recording and revoke its URL. Only MP4
output within the byte cap reaches preview (codec parameters are accepted).

The native adapter validates a local projection of the four planned
`attachments/*` methods and their results. One queue owns pick/drop/remove/
record; bridge-owned interactive-user and captured-session predicates guard
intake, queued work and stale replies. JSON cannot claim a user gesture.
JCEF, WebView2 and SWT are JSON round-trip fakes, not installed IDE receipts.
Native chooser, confinement, streaming, admission and preview are required
ports; no filesystem path or byte array enters their response shape.

Muse Code refuses video/audio before `turn/start` or `turn/steer`, including
media mislabeled as image/file. Its existing PDF refusal remains unchanged.
`toolPresentation` marks MP4/MOV read-file paths, normalizing Windows paths;
the lazy player consumes only resources approved by its required host port.
No new MSP content schema, `@path` behavior or video payload was invented.

## Validation

All runs below are directly on linuxlt, repository-default test timeouts,
whole files, at most three files/workers per invocation. No skips or filters.

| Whole suites (`npx vitest run … --maxWorkers=3`)  | Result  |
| ------------------------------------------------- | ------- |
| companionUpload                                   | 45/45   |
| nativeAttachments                                 | 23/23   |
| museCodeMedia                                     | 9/9     |
| companionMedia                                    | 12/12   |
| companionMediaTransport                           | 15/15   |
| toolVideo                                         | 3/3     |
| companionMediaBrowser                             | 6/6     |
| Existing MuseCodeHost, toolPresentation, toolRows | 143/143 |

113 owned tests and 143 existing regressions pass. Real Chromium exercises a
File through real XHR and the guarded fake loopback route, checks sniffed bytes
and eventual deletion, and scans controls/recording preview in all four VS Code
themes at 320 px with axe WCAG 2/2.1/2.2 AA tags. Keyboard Discard and zero
horizontal overflow pass. Capture is fake-only; this does not certify actual
`getDisplayMedia` or `MediaRecorder`.

- All five typecheck projects: passed.
- Changed-file ESLint, CSS lint and Prettier: passed.
- Plain knip/dead-code, jscpd/duplication, cycles: passed.
- Localization, source and packaged: 14 tables, zero problems; no new text
  keys, settings or manifest entries.
- Node bundle host-globals: passed, zero navigator references.
- Hooks: active for every local commit, lint-staged and staged gitleaks passed.
- Full quality/full unit runs forbidden by the lane brief; lead owns them.

The first exploratory upload run exposed a stream-close hang from a file
handle whose write stream kept autoClose off. The implementation now uses
an auto-closing write stream then a separately closed read handle. No timeout
was raised. Exploratory GET/declared-length mutations timed out and are not
counted as assertion receipts. PUT and a declared-length test with an absent
temporary root now produce named assertion failures, then pass when restored.
Exploratory pure-white contrast and two insufficient HTTP-response tests did
not fire; improved near-white contrast and response/origin regressions do.
A malformed syntax mutation of image validation was discarded and rerun as a
valid identity function; its zero-dimension assertion fires.

## Enforced integration gates and measured chunks

`npm run build` compiles production successfully, then exits 1 at the existing
W-owned deferred-browser size gate: 51.1/50 KiB. Other measured caps include
extension 443.8/600 KiB, Model API 453.9/475 KiB, ACP 823.9/850 KiB,
UI text 49.3/125 KiB and browser startup 899.3/900 KiB. No cap changed.
The standalone split check still refuses the inherited `files.ts` and
`codecs/responses.ts` missing classifications. Host API check refuses the
outdated generated inventory: buffer 39→45, child_process 13→14, crypto 46→50,
fs 33→35, fs/promises 47→49, http 4→5, os 9→10, path 84→86, stream 12→13,
stream/promises 2→3; plus the new media stylesheet source. No VS Code API was
added; the inventory remains 332 APIs, 31 VS Code-importing files, 25 builtins.
W must update its owned build/split/host records before the integrated gate.

A separate production esbuild, split ESM measurement of `media/entry.tsx`,
`media/toolEntry.tsx` and `media/transport.ts` gives controls 4,363 bytes,
transport 1,685, player 870, lazy shims 190/175, CSS 939. Shared JS (English
fallback, constants, React and validation included) brings the standalone
three-entry graph to 199,217 bytes (194.5 KiB); CSS duplicates are not included
in that JS total. This is a measurement, not a shipped gate receipt. These
unbound modules do not enter the normal production graph yet. W must add an
independent companion-page budget and split/entry registration, including R3's
recorder and the actual companion page graph; never add them to the already
full 50 KiB optional-chat total or raise an existing cap.

## Upload red drills

Every row runs the whole owning test file, exits 1 with the named failure,
and restores source bytes with SHA-256 verification. No test filters,
timeout overrides or committed mutations.

| Guard removed                | Named failing test                                                                     | Receipt              |
| ---------------------------- | -------------------------------------------------------------------------------------- | -------------------- |
| exact Host                   | refuses foreign Host before intake                                                     | exit 1; SHA restored |
| exact Origin                 | refuses foreign Origin before intake                                                   | exit 1; SHA restored |
| bearer                       | refuses wrong bearer before intake                                                     | exit 1; SHA restored |
| custom header                | refuses wrong custom header before intake                                              | exit 1; SHA restored |
| Fetch Metadata site          | refuses Fetch Metadata site before intake                                              | exit 1; SHA restored |
| Fetch Metadata mode          | refuses Fetch Metadata mode before intake                                              | exit 1; SHA restored |
| Fetch Metadata destination   | refuses Fetch Metadata destination before intake                                       | exit 1; SHA restored |
| cookies                      | refuses cookies before intake                                                          | exit 1; SHA restored |
| content type                 | refuses content type before intake                                                     | exit 1; SHA restored |
| window at intake             | refuses a stopped window and non-POST methods                                          | exit 1; SHA restored |
| metadata strictness          | refuses invalid/byte-bearing metadata and never uses browser paths                     | exit 1; SHA restored |
| streamed cap                 | enforces the streamed cap without Content-Length and removes partial bytes             | exit 1; SHA restored |
| owner-only directory         | streams sniffed bytes into private files and returns only metadata/token after cleanup | exit 1; SHA restored |
| owner-only file              | streams sniffed bytes into private files and returns only metadata/token after cleanup | exit 1; SHA restored |
| recording mp4                | recordings must sniff as mp4 video; audio renamed mp4 is refused                       | exit 1; SHA restored |
| post-admission epoch         | checks the window again after admission                                                | exit 1; SHA restored |
| cancellation after admission | cancellation during policy work prevents consumption and cleans up                     | exit 1; SHA restored |
| opaque token validation      | validates consumer tokens and cleans up on failure                                     | exit 1; SHA restored |
| cleanup                      | streams sniffed bytes into private files and returns only metadata/token after cleanup | exit 1; SHA restored |
| HTTP method                  | refuses a stopped window and non-POST methods                                          | exit 1; SHA restored |
| admission                    | streams sniffed bytes into private files and returns only metadata/token after cleanup | exit 1; SHA restored |
| sniffed kind                 | rejects unknown or nonaccepted sniffed formats                                         | exit 1; SHA restored |

Upload source SHA-256 before/after these drills: `72642c53d11c9a0531b42690895fa079690726619ed37a39c53eb9c1380068f1`.

## Additional red drills

Together with the 22 upload rows above, these 41 rows make 63 guard drills.
Each runs the whole owning file, exits 1 on a named assertion, restores the
source in `finally`, and verifies the original SHA-256. Scratch receipts are
local under ignored `temp/`; the following table is the durable record.

| Guard removed                      | Named failing test                                                                    | Receipt              |
| ---------------------------------- | ------------------------------------------------------------------------------------- | -------------------- |
| native request strictness          | refuses malformed or byte-bearing method attachments/pick                             | exit 1; SHA restored |
| native token maximum               | refuses malformed or byte-bearing method attachments/attach                           | exit 1; SHA restored |
| native result strictness           | validates native results before returning them to the panel                           | exit 1; SHA restored |
| native attachment count            | validates native results before returning them to the panel                           | exit 1; SHA restored |
| interactive user only              | a tool or headless caller cannot claim a user gesture in JSON                         | exit 1; SHA restored |
| stale native work                  | discards stale picker replies and refuses queued work after close                     | exit 1; SHA restored |
| native serialization               | serializes two picker/drop actions through one owner                                  | exit 1; SHA restored |
| page never reads file bytes        | sends the File as the HTTP body with guards and no content in bridge metadata         | exit 1; SHA restored |
| transport response URL             | refuses redirects and HTTP failures                                                   | exit 1; SHA restored |
| transport request correlation      | rejects an invalid request in the response                                            | exit 1; SHA restored |
| transport name correlation         | rejects an invalid name in the response                                               | exit 1; SHA restored |
| transport size correlation         | rejects an invalid size in the response                                               | exit 1; SHA restored |
| Stop aborts HTTP                   | Stop aborts the request; no stale token survives it                                   | exit 1; SHA restored |
| UI byte cap                        | refuses over-cap media before HTTP                                                    | exit 1; SHA restored |
| late upload refusal                | Stop cancels upload and never attaches a late result                                  | exit 1; SHA restored |
| browser named refusal              | shows browser-specific refusal before capture                                         | exit 1; SHA restored |
| per-recording microphone choice    | explicit microphone/system audio options reach the recorder                           | exit 1; SHA restored |
| per-recording system audio choice  | explicit microphone/system audio options reach the recorder                           | exit 1; SHA restored |
| MP4 recording only                 | disposes unsupported recording output and never uploads it                            | exit 1; SHA restored |
| preview cleanup                    | starts only on user click with audio off, shows countdown and requires preview Attach | exit 1; SHA restored |
| object URL cleanup                 | starts only on user click with audio off, shows countdown and requires preview Attach | exit 1; SHA restored |
| approved video resources           | refuses an unapproved resource URL                                                    | exit 1; SHA restored |
| tool video cancellation            | changing paths aborts the old read and never renders its late resource                | exit 1; SHA restored |
| Muse Code refuses uncaptured media | refuses video/mp4 disguised as an MSP image before start or steer                     | exit 1; SHA restored |
| Windows video path presentation    | marks captured read_file path clip.mp4 for an approved lazy video preview             | exit 1; SHA restored |
| route configuration                | refuses unsafe route configuration                                                    | exit 1; SHA restored |
| explicit admission refusal         | returns a named admission refusal without consuming bytes                             | exit 1; SHA restored |
| unknown bytes refused              | dispatches sniffed image without trusting its filename                                | exit 1; SHA restored |
| transport endpoint origin          | refuses another loopback window origin before creating HTTP objects                   | exit 1; SHA restored |
| HTTP status                        | rejects an HTTP error even if its body contains valid upload metadata                 | exit 1; SHA restored |
| already aborted HTTP               | refuses an already aborted request before creating HTTP objects                       | exit 1; SHA restored |
| late HTTP load after Stop          | ignores a late load event after Stop                                                  | exit 1; SHA restored |
| sniffed image metadata validated   | validates sniffed image dimensions before admission or consumption                    | exit 1; SHA restored |
| accessible theme contrast          | light has no accessibility violations in controls or recording preview                | exit 1; SHA restored |
| lazy browser controls              | loads the controls and preview only through a lazy browser chunk                      | exit 1; SHA restored |
| session epoch remount              | a session epoch change cancels the old upload and refuses its late attachment         | exit 1; SHA restored |
| declared byte cap                  | refuses an oversized declared length before creating a file                           | exit 1; SHA restored |
| post-consumption epoch             | refuses a consumed token after session change                                         | exit 1; SHA restored |
| post-consumption cancellation      | refuses a consumed token after cancellation                                           | exit 1; SHA restored |
| pre-admission epoch                | refuses admission after a streamed session change                                     | exit 1; SHA restored |
| pre-admission cancellation         | refuses admission after a streamed cancellation                                       | exit 1; SHA restored |

Source SHA-256 for the additional drill batches (source may have subsequent
intentional additions; restoration is against each batch’s exact input):

| Source                                       | Before/after SHA-256                                               |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `src/runtime/companion/nativeAttachments.ts` | `1e7001da4b3bc720bfa8f95775b4957c4f0c072cf5bf222c568f9650ee4f849c` |
| `src/webview/media/transport.ts`             | `b63515344f0225fa7d2e0de2a41f1f2e34af675850b17dae33c8779c6c1f638f` |
| `src/webview/media/CompanionMedia.tsx`       | `bc9611c087b940ebb2ad385824adfd3b9b392e8d77dde8381355e03176b447b4` |
| `src/webview/media/ToolVideo.tsx`            | `d413f897a9e89104c3a84d66fa292fe6e8b231e9956a5a57e73387b1b000e638` |
| `src/core/backends/musecode/MuseCodeHost.ts` | `3263297835bc56d92e5ae6e0ad1166d838268dcd6c3916b7bc51087f159a2cfe` |
| `src/webview/toolPresentation.ts`            | `a8c9569dc7cfc86c63fab87b63339e02b37b529234c95484ecd65a6b7254ec1a` |
| `src/webview/media/media.css`                | `da8e4aba80873f4ec550e1bc74237e2dadd8cd13c6f37f2135fdf315c345d577` |
| `src/runtime/companion/upload.ts`            | `0245ddfd8fd63d6289d087e3ec88595f5a1518802541997b3f0abcf33d733302` |
| `src/webview/media/entry.tsx`                | `7129348f69e36ab2d09230541006f20d430c97f914b965782cbad67c34c4124a` |

The final epoch/remount and declared/post-consumption batch restores
`CompanionMedia.tsx` to `09eab87c86f2cdb56a09525147b9831b3eeedc87c8c0eca3f0d56f3e4fa73363`
and `upload.ts` to `0245ddfd8fd63d6289d087e3ec88595f5a1518802541997b3f0abcf33d733302`.

The final pre-admission batch restores `upload.ts` byte-exact to
`947bc16c45a03886d6454763689c705afeede1c697f914d973af556509eebba4`.

## Named integration handoffs

- **E3-C-upload-route (M104 C/W):** this base has no
  `src/runtime/companion/server.ts`. Bind the handler only after the launch
  exchange; choose the route and matching header names; impose the server's
  per-window concurrency, deadline and disconnect policy. No replacement
  listener was invented.
- **E3-F-M2-admission-consumption (F/M2/A/C/W):** bind admission to selected
  capability, limits and Contributor/storage/paid consent; bind consumption
  to the private pending-attachment source and Files ledger. The consumer
  must finish consuming/copying before resolving because the route deletes
  its source. The injected source/ledger owner must roll back a cancelled or
  stale provider operation and release unreferenced tokens. An unbound handler
  cannot silently upload to a provider.
- **E3-browser-entry (M104 C/W):** mount E3's lazy controls and transport in
  the companion page with its host-issued `attachmentEpoch`; install the
  current language table before rendering, and assign their own measured
  page/chunk budget, no cap rises.
- **E3-R3-browser-recording:** R3 owns `src/webview/media/recorder/**` and
  `getDisplayMedia`/MediaRecorder. Bind its real driver through E3's port;
  Chromium fake-device capture remains an integration receipt.
- **E3-MHP-native (M104 lane 0 and b–d):** this base has no shared MHP
  schemas or JCEF/WebView2/SWT bridge implementations. E3 validates the
  attachment-method projection behind injected native ports. Bind the outer
  envelope and run each actual plugin; fakes cannot certify installed IDEs. Each adapter captures the session epoch
  and derives the interactive-user predicate from its trusted bridge event.
- **E3-U16-MSP-video (lead):** U16 and a raw video content frame are absent.
  Keep media refused with the Model API reason. No `@path` inference or new
  MSP shape is guessed. Capture is required before a content decoder binds.
- **E3-tool-video (W):** bind approved resource resolution and E3's lazy
  player in ToolRow after the captured MSP content decoder exists.
- **E3-docs-reference (W):** README modality/editor matrix, SECURITY guarded
  upload route, PRIVACY temp files/recording/training, CHANGELOG and feature
  catalog/reference entries move with shipped bindings. The feature catalog
  does not exist on this base. E3 does not edit W-owned files.

The owner-only mode receipt is POSIX-only; Windows needs the server’s private
user ACL/root binding and a Windows receipt before availability is claimed.
No end-to-end product availability is claimed while those bindings are absent.

## W documentation/reference payload

`src/shared/featureCatalog.ts` and `scripts/gen-reference.mjs` are absent on this
base, so W receives these feature entries for integration: companion media
picker/drop/paste; upload progress/Stop; screen recording preview with explicit
microphone/system audio choices and Attach/Discard; native `attachments/*`;
Muse Code’s explicit media refusal; approved lazy tool video previews. Each
must name its real editor/backend availability and pending capture/binding.

Suggested `[Unreleased]` entry (publish only for bindings actually shipped):
“Add guarded streaming media attachments for the editor companion and native
panel attachment bridges, plus recording preview with Attach/Discard. Muse
Code gives an explicit Model API refusal for unsupported video/audio.”

README: explain metadata-only bridge, streamed HTTP files, selected-model
admission, pending-browser support and recording choices. SECURITY: exact
loopback origin/Host, bearer/custom header, Fetch Metadata, no cookies,
exclusive private temporary file, cancellation and epoch checks. PRIVACY:
recording includes visible screen content, microphone/system audio is explicit,
preview Discard clears local bytes, Attach uses the provider policy, temporary
upload bytes are deleted, and Contributor/storage consent remains required.
Docs must not claim U16, installed native IDEs or real browser capture certified
from E3’s fakes. Commands/settings are other lanes’ W payloads, not new E3
manifest changes.

## FIXM105E3 — RVM105E3C corrections (Kubuntu, 2026-10-07)

All four P2 findings are repaired; no P1/P3 finding was reported. No paid/live
model calls, credentials, dependencies, pushes, merges or cap changes.

| Finding                           | Structural repair                                                                                                                                                                                                                                    | Regression                                                                                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1: Unicode header names           | Percent-encode JSON metadata in transport; decode before strict route validation. File bytes remain the original raw Blob body.                                                                                                                      | Real Chromium filenames `録画.mp4`, `запись.mp4`, `café 100% 🎥.mp4`; transport round-trip; route Unicode/percent-name decoding and malformed encoded input.                                           |
| 2: unrelated same-origin cookies  | Fetch with `credentials: omit`, `mode: cors`, `redirect: error` and the caller's abort signal. Every existing route guard remains, including no cookies. Progress reports only dispatch and validated completion, never invented intermediate bytes. | Real Chromium with a synthetic HttpOnly `127.0.0.1` cookie: original bytes consumed and cookie absent; transport abort, late response, failure, correlation and credential options.                    |
| 3: late startup after unmount     | Cancel a late-started run and continue awaiting its result through the existing catch/dispose path.                                                                                                                                                  | Deferred `recorder.start` resolves after unmount: cancellation rejection observed, late preview disposed exactly once, no object URL or attachment.                                                    |
| 4: clean-checkout browser scratch | OS `tmpdir()` owns the suite's temporary build/upload root; no ignored checkout directory is required.                                                                                                                                               | Browser suite asserts OS scratch ownership, normalizing Windows separators. W already added parent creation for the reviewed ENOENT before this fix lane; OS scratch removes that dependency entirely. |

### Baseline regression receipts

The brief's `refs/rigs/linuxlt/m105/w` ref is unavailable on this rig. The lane
started at integration commit `95fb707f3f3eaeee6ca44bb2229485fb18b9f8c1`; that
exact committed baseline was cloned under ignored scratch with its unchanged
production source. Only the new UI/browser regressions were copied into it.
`CI=true npx --no-install vitest run test/unit/companionMedia.test.tsx
 test/unit/companionMediaBrowser.test.mjs --maxWorkers=3` used repository
(default 5-second) timeouts: exit 1, six named assertion failures and one
unhandled cancellation rejection; 19 tests passed. Failures: three Unicode
filenames never consumed, synthetic cookie sent, late preview not disposed,
and scratch root still under the checkout. The already-integrated `mkdir`
means the original reviewed ENOENT is not reproduced at this newer baseline;
the scratch ownership assertion proves the replacement removes that dependency.
No test timeout was raised, no filtered cases or skipped tests.

### Verification status

Initial complete suites: companionMedia 14, companionMediaTransport 18,
companionMediaBrowser 11, companionUpload 48, nativeAttachments 23 and
museCodeMedia 9: 123 passing tests. Final fresh-clone repetitions, gates and
byte-exact red-drill receipts are recorded below once completed.

Existing named provider, M104/editor/capture and Windows ACL integration
handoffs remain open; these fake-only fixes do not certify those bindings.

### Repair red drills

Each mutation ran the entire owning file(s) at default timeouts and exited 1
on an assertion; late-start cancellation also produced the expected unhandled
rejection. Every source was restored byte-exact in `finally`, comparing bytes
and SHA-256. All seven drills fired:

| Mutation              | Named regression                                                                    | Source before/after SHA-256                                        |
| --------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| transport-failure     | network and invalid JSON errors stay localized; Stop keeps its cancellation message | `42f39bc3df80d29588cc45c26427c71fb82045eecd9bef4696b20d0fd6c3516e` |
| metadata-encoding     | Unicode ASCII-safe round-trip and three real-browser filenames                      | `42f39bc3df80d29588cc45c26427c71fb82045eecd9bef4696b20d0fd6c3516e` |
| metadata-decoding     | Unicode/percent metadata decodes before intake                                      | `4f43a6984adf93c4691fa4f5ca96c1e7f5acdf1de5bd01f89dbfb509e0ee316d` |
| cookies-omitted       | real HttpOnly cookie upload and explicit omit transport options                     | `42f39bc3df80d29588cc45c26427c71fb82045eecd9bef4696b20d0fd6c3516e` |
| late-start-settlement | late preview disposal and observed cancellation rejection                           | `12b678ae3fadf695d68d3509d8e8f590d6aa569f5a9f60e388a53bec7e800919` |
| os-scratch            | OS scratch ownership                                                                | `986864569a3fcacfe61c731aa29b5ce7ec9f0340b0b3f092b0e9ddbfa2065721` |
| metadata-validation   | malformed encoded headers never reach admission or consumption                      | `4f43a6984adf93c4691fa4f5ca96c1e7f5acdf1de5bd01f89dbfb509e0ee316d` |
