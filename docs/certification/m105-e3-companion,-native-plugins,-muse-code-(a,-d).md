# M105 E3: companion, native plugins and Muse Code

linuxlt (Ubuntu rig), 2026-10-06; branch `m105/e3`, base `c1d6cf6ed`.
Read rig brief, common rules, gotcha register, AGENTS.md, D85/M105,
coverage research and lane-0/M1/M2 capture/certification records.
Zero live, paid, subscription or external HTTP calls. Fake HTTP binds loopback
only. No credentials read, dependencies installed, branch merges or pushes.

## Streamed upload delivered

`src/runtime/companion/upload.ts` is a route handler, not a server. M104 C
must inject its exact loopback origin, per-window bearer/custom headers,
window lifetime/deadline and epoch predicate. Every request checks method,
Host, Origin, Fetch Metadata, custom header, bearer and absence of cookies.
It streams raw HTTP into an exclusively created 0600 file in a 0700 temporary
directory; SHA-256 is incremental. Sniffing uses M1 bounded windows, with
existing image/PDF sniffers. Browser names never become disk paths.
A required admission port checks selected-model formats, duration, caps,
storage billing and consent before a required consumer handles the private
source. Consumer completion returns a validated opaque token and metadata.
Success, failures, cancellation and disconnected clients remove temporary
bytes. Unexpected policy/provider errors are not echoed to the browser.

All text reuses lane-0's translated media region and existing generic wording;
no manifest entries, settings, commands or language tables added by E3.

## Validation so far

- `npx vitest run test/unit/companionUpload.test.ts --maxWorkers=3`: 27/27,
  repository default timeout, no skips or filtering.
- Upload source/test changed-file ESLint: passed.
- Unit-project typecheck passed after the first upload implementation;
  final all-project verification follows the remaining UI/bridge work.
- Full quality/full unit runs are forbidden by the brief; W/lead owns them.

The first exploratory upload run exposed a stream-close hang from a file
handle whose write stream kept autoClose off. The implementation now uses
an auto-closing write stream then a separately closed read handle. No timeout
was raised. An exploratory drill using GET hit the default timeout; it is
not counted. The revised PUT drill fails its named status assertion.

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
  its source. An unbound handler cannot silently upload to a provider.
- **E3-browser-entry (M104 C/W):** mount E3's lazy controls and transport in
  the companion page; assign their own measured chunk budget, no cap rises.
- **E3-R3-browser-recording:** R3 owns `src/webview/media/recorder/**` and
  `getDisplayMedia`/MediaRecorder. Bind its real driver through E3's port;
  Chromium fake-device capture remains an integration receipt.
- **E3-MHP-native (M104 lane 0 and b–d):** this base has no shared MHP
  schemas or JCEF/WebView2/SWT bridge implementations. E3 validates the
  attachment-method projection behind injected native ports. Bind the outer
  envelope and run each actual plugin; fakes cannot certify installed IDEs.
- **E3-U16-MSP-video (lead):** U16 and a raw video content frame are absent.
  Keep media refused with the Model API reason. No `@path` inference or new
  MSP shape is guessed. Capture is required before a content decoder binds.
- **E3-tool-video (W):** bind approved resource resolution and E3's lazy
  player in ToolRow after the captured MSP content decoder exists.
- **E3-docs-reference (W):** README modality/editor matrix, SECURITY guarded
  upload route, PRIVACY temp files/recording/training, CHANGELOG and feature
  catalog/reference entries move with shipped bindings. The feature catalog
  does not exist on this base. E3 does not edit W-owned files.

No end-to-end product availability is claimed while those bindings are absent.
