# M105 E2 — ACP, headless and read_file (a)

MacBook Pro Intel rig; branch `m105/e2`, base `c1d6cf6e`; 2026-10-06.
Read the rig brief, shared rules/gotchas, AGENTS.md, PLAN D85/M105 in full,
the media coverage research, capture handoff and M1/M2 certification.
No merge, rebase, push, credential access, network/provider/paid call,
dependency installation, gate weakening or timeout override.

## Implementation

- ACP embedded PDFs become document parts, images remain image parts, and
  video/audio go through the injected lazy media adapter. Declared MIME must
  agree with sniffed bytes. Malformed/oversized base64 and unknown formats
  receive named refusals. Audio is advertised at the agent level; a model
  that does not hear standalone audio refuses it before preparation.
- `/attach <path>` queues an attachment for the next turn. `/record` invokes
  only the interactive options/Stop/preview port, then queues an explicitly
  accepted preview. Both run between turns without an inference turn.
  Preparing a file/preview holds the existing busy barrier. Cancellation
  aborts preparation; a late preview is disposed. Failed submission keeps
  queued attachments; delivery or session release disposes recordings.
- `exec --attach <path>` repeats, retains order, confines each link before
  backend/key access, and passes it through the same ACP adapter. Invalid
  paths, count/format limits and absent bindings use usage exit 2. Headless
  recording is refused both as `--record` and as the `/record` prompt.
  Accepted inputs appear in the existing metadata-only receipt (name, bytes,
  chunks 0 and complete); no attachment bytes or provider IDs enter exec output.
- `read_file` recognizes mp4/mov/mp3/wav and the convertible format suffixes,
  retains its confinement/policy checks, and delegates model/consent/budget
  admission to a required port. It returns validated file-id metadata in
  `ToolOutcome.mediaFile`, never the private source or bytes.
- `ToolIo.readMedia` lazily loads M1's sniffers, samples bounded head/tail
  windows, hashes one approved handle in bounded chunks, and closes it.
  Upload reopens the approved canonical path, checks identity, rejects
  growth/truncation/change and verifies the digest. A renamed PDF receives
  its document cap from the sniffed header. IO leaves format admission to
  the selected model record; an explicit WebM-capable test record works. No whole-file media
  buffer, recorder tool, dependency, provider schema or model preset added.
- ACP local attachments reject private/protected names and symlink escapes,
  check session policy before opening bytes, and repeat the selected-model
  gate. Windows separators and file URI escaping have portable fake tests.

## Named integration handoffs

| Name                          | Owner            | Required binding                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M105-E2-runtime-media         | W/M95/M2/F/C/A   | Install `AcpAgentDeps.media` and `ExecDeps.media` lazily. Bind the selected capability record, approved private sources and metadata carriers to M2 replay, the provider/account ledger, Contributor/soundtrack choices and exact reservation/settlement. Repeat confinement/policy before source opens. The headless path must connect media liability to its existing per-attempt ledger and captured request validation; no unpriced dispatch. Missing bindings refuse today. |
| M105-E2-tool-media            | W/M2/F/C/A       | Bind `ToolContext.media.prepare` and consume `ToolOutcome.mediaFile` after the tool round through M2's file-id replay and shared media budget. Enforce model capabilities, consent and exact admission before any upload; preserve touched-file policy rechecks. Do not bind preparation without the outcome consumer.                                                                                                                                                           |
| M105-E2-record-preview        | W/R1/R2/R3       | Supply `recordAndPreview` with user-selected options, countdown/Stop, bounded native driver and explicit Attach/Discard. Return an approved source only after Attach; maintain owner-only temporary-file cleanup. `interactive: false` refuses before this callback.                                                                                                                                                                                                             |
| M105-E2-bundles               | W                | Export the portable implementation from lazy `dist/media.js`; preserve startup/deferred caps, package it for ACP, register split lists and update the generated host inventory. The first-media factories and sniffers remain behind explicit seams here.                                                                                                                                                                                                                        |
| M105-E2-shipped-docs-and-help | W                | README modality matrix, CHANGELOG, PRIVACY, `docs/acp.md` blob/audio/`/attach`/`/record` guide, `docs/ci.md` repeated `--attach` and usage/2 refusals, packaged help and all editor rows. `src/shared/featureCatalog.ts` is absent on this base: add the two ACP commands, CLI flag and media `read_file` entry during integration, then regenerate/check reference. Existing fully translated media strings are reused; no key added.                                           |
| M105-E2-editor-visual-checks  | W/recorders/M104 | ACP SDK fake-client notification/command tests apply equally to all ACP editors. Native bridge/editor and recording-preview browser screenshots remain with their owners; this rig has no Chrome. No React/CSS/GUI layout changed in E2.                                                                                                                                                                                                                                         |

The media tests use explicit test-only capability records, fixtures and
registered-carrier markers. They prove adapter behavior and privacy; they
do not claim a live provider wire capture or a shipped binding. U16/U18/U6c
and the original capture workspace/count/spend details stay with lane 0/W.

## Verification

All commands below ran directly on the MacBook, Node v26.0.0. No test timeout
was raised, no test-name filter used, and every run had at most three complete
files and `--maxWorkers=3`.

| Complete vitest file batch                                | Result                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `acpTranslate`, `acpMedia`, `attachArgs`                  | 54 passed                                                                                              |
| `acpAgent`, `toolIoMedia`, `modelApiMediaTools`           | 110 passed                                                                                             |
| `execRun`, `execArgs`, `acpRuntime`                       | 148 passed                                                                                             |
| `modelApiTools`, `toolIo`, `toolIoBounded`                | 93 passed, two inherited Windows-only skips; exit 1 for the existing reservation-handle GC error below |
| `toolIoCommandAdmission`, `acpModelApi`, `acpElicitation` | 22 passed                                                                                              |

That is **427 passing tests across 15 distinct files**. After the zero-duplicate
cleanup, complete affected files were rerun: 54 + 110 + 73 passed. The cleanup
shares URI naming and transient byte-source construction, and a real IO test
factory; it introduces no feature, ignore or threshold change.

| Check                                      | Result                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `npm run typecheck`                        | All five projects passed                                                                      |
| Changed-file `npx eslint --max-warnings=0` | Passed                                                                                        |
| `node scripts/check-l10n.mjs`              | 14 tables, 164 manifest strings, 0 problems                                                   |
| `npm run deadcode`                         | Passed; two existing configuration hints                                                      |
| `npx jscpd`                                | 0 clones, unchanged zero threshold                                                            |
| `npm run cycles`                           | No cycles                                                                                     |
| `npm run check:host-api`                   | Exit 1: generated importer record belongs to W                                                |
| `npm run build`                            | Production compilation succeeded; exit 1 at inherited deferred-browser 51.1/50 KiB budget     |
| `node scripts/check-bundle-split.mjs`      | Exit 1: inherited `files.ts` and `codecs/responses.ts` absent from backend lists; W owns them |
| `node scripts/check-host-globals.mjs`      | Passed                                                                                        |
| `node scripts/third-party-notices.mjs`     | Passed, 83 bundled packages                                                                   |

Measured budgets: extension **456.4/600 KiB**, Model API **454.9/475 KiB**,
ACP **844.8/850 KiB**, browser startup **899.2/900 KiB**. No cap increased.
W must keep the tight ACP/browser headroom when binding the portable lazy media
bundle. Host importer drift: buffer 39→45, child_process 13→14, crypto 46→51,
fs 33→34, fs/promises 47→49, os 9→10, path 84→87, url 4→6. The generated
record is left to W, rather than rewritten in another lane's files.

Full quality/full-unit, browser/visual preview and cross-platform integrated
certification remain the lead's gates under the rig brief. No gate changed.

## Red drills

Each drill ran its entire test file with `npx vitest run <file> --maxWorkers=3`,
using the repository default timeout. Every intended named test failed with
exit 1. The original bytes were restored in `finally`, and both SHA-256
values were compared byte-for-byte before continuing. No mutation remains.
Logs and machine-readable receipts are in the lane's ignored `temp/` folder.
The original preimage hashes below also identify exact restoration; several
media drills precede the final vendor-format correction.

| Preimage | Source file                           | Before and restored SHA-256                                        |
| -------- | ------------------------------------- | ------------------------------------------------------------------ |
| H1       | `src/acp/translate.ts`                | `02f40297837265a081527828a973b93c4aab85bac6bf12c93ba8b509ab8a546d` |
| H2       | `src/acp/media.ts`                    | `d13606e52ad7513f03759ad04e2dc1bca8daa204116736300ce8cef2c26c86fd` |
| H3       | `src/acp/agent.ts`                    | `10d653e26ef49eeae70360de054e86a8584109edcb8bae48cb6be607705cd3ba` |
| H4       | `src/runtime/exec/attachArgs.ts`      | `08b6d2b0bcc67f06f07c999bbef65811bc4c614593c8310b1fed7295f5ae97cc` |
| H5       | `src/runtime/cliArgs.ts`              | `f03a6a87492c4237d34e8da4c998434967d17996c132bae3f7f4529d65f8545d` |
| H6       | `src/acp/media.ts`                    | `7162e6891e6b3e596c3b4ecff33d6073e05460a7469fa90ddae6f39ef83518a6` |
| H7       | `src/host/backend/toolIo.ts`          | `5e6e61b1a4d25dfcc5a4fd9008f058dbd02c0f240395a8e823432cd635879c29` |
| H8       | `src/core/backends/modelapi/tools.ts` | `69cd965ec46b0083c82275bcd818811c33a5e73e241304c79775c14496847dca` |
| H9       | `src/runtime/exec/runExec.ts`         | `0b0065d6b38b438786f95668daab7cfbcb8af0213ef83e1af29c59bdc4b3e7e1` |

| Drill                      | Complete test file                     | Named failure                                      | Preimage |
| -------------------------- | -------------------------------------- | -------------------------------------------------- | -------- |
| pdf-blob-dispatch          | `test/unit/acpTranslate.test.ts`       | dispatches a PDF blob                              | H1       |
| pdf-mime                   | `test/unit/acpTranslate.test.ts`       | dispatches a PDF blob                              | H1       |
| encoded-cap                | `test/unit/acpTranslate.test.ts`       | bounds encoded blobs                               | H1       |
| malformed-base64           | `test/unit/acpTranslate.test.ts`       | bounds encoded blobs                               | H1       |
| image-mime                 | `test/unit/acpTranslate.test.ts`       | bounds encoded blobs                               | H1       |
| model-gate                 | `test/unit/acpMedia.test.ts`           | refuses unknown video support                      | H2       |
| muse-code-refusal          | `test/unit/acpMedia.test.ts`           | refuses unknown video support                      | H2       |
| blob-mime                  | `test/unit/acpMedia.test.ts`           | refuses unknown video support                      | H2       |
| audio-kind                 | `test/unit/acpMedia.test.ts`           | refuses standalone audio                           | H2       |
| media-name                 | `test/unit/acpMedia.test.ts`           | refuses invalid or oversized media names           | H2       |
| media-sniff-before-name    | `test/unit/acpMedia.test.ts`           | sniffs a media path with no media suffix           | H2       |
| canonical-confinement      | `test/unit/acpMedia.test.ts`           | refuses a symlink escape                           | H2       |
| private-name               | `test/unit/acpMedia.test.ts`           | confines resource links and checks policy          | H2       |
| read-policy                | `test/unit/acpMedia.test.ts`           | confines resource links and checks policy          | H2       |
| headless-recorder-port     | `test/unit/acpMedia.test.ts`           | never starts a recording in headless mode          | H2       |
| headless-record-command    | `test/unit/acpAgent.test.ts`           | refuses recording in headless prompts              | H3       |
| queued-count               | `test/unit/acpAgent.test.ts`           | refuses an overfull between-turn attachment queue  | H3       |
| cancel-preparation         | `test/unit/acpAgent.test.ts`           | is busy during media preparation                   | H3       |
| headless-attach-count      | `test/unit/attachArgs.test.ts`         | refuses blank, malformed, excess                   | H4       |
| headless-record-cli        | `test/unit/attachArgs.test.ts`         | refuses blank, malformed, excess                   | H5       |
| selected-format-record     | `test/unit/acpMedia.test.ts`           | honors a selected model record                     | H6       |
| pdf-path-cap               | `test/unit/toolIoMedia.test.ts`        | recognizes a renamed PDF larger                    | H7       |
| io-size-before-sniff       | `test/unit/toolIoMedia.test.ts`        | refuses size limits                                | H7       |
| io-changing-metadata       | `test/unit/toolIoMedia.test.ts`        | refuses changing handle metadata                   | H7       |
| io-growth-before-yield     | `test/unit/toolIoMedia.test.ts`        | refuses source growth                              | H7       |
| io-source-identity         | `test/unit/toolIoMedia.test.ts`        | refuses source growth                              | H7       |
| io-source-digest           | `test/unit/toolIoMedia.test.ts`        | refuses a changed same-size source digest          | H7       |
| tool-upload-metadata       | `test/unit/modelApiMediaTools.test.ts` | enforces selected-model/budget refusals            | H8       |
| no-recording-tool          | `test/unit/modelApiMediaTools.test.ts` | never registers a screen-recording tool            | H8       |
| blob-port-routing          | `test/unit/acpTranslate.test.ts`       | routes video and audio to the injected media path  | H1       |
| unbound-media-link         | `test/unit/acpTranslate.test.ts`       | refuses a media link when no confined reader       | H1       |
| blob-dispatch              | `test/unit/acpMedia.test.ts`           | dispatches sniffed video and audio blobs           | H6       |
| acp-audio-capability       | `test/unit/acpAgent.test.ts`           | advertises audio, queues /attach                   | H3       |
| attachment-refusal-reason  | `test/unit/acpAgent.test.ts`           | reports an attachment preparation refusal          | H3       |
| queued-disposal            | `test/unit/acpAgent.test.ts`           | preserves queued attachments when submission fails | H3       |
| tool-file-id-output        | `test/unit/modelApiMediaTools.test.ts` | returns file-id and media metadata                 | H8       |
| tool-unbound               | `test/unit/modelApiMediaTools.test.ts` | refuses missing bindings, policy-denied paths      | H8       |
| tool-cancellation          | `test/unit/modelApiMediaTools.test.ts` | keeps cancellation on the host stop path           | H8       |
| cli-repeat                 | `test/unit/attachArgs.test.ts`         | preserves repeated attachments                     | H5       |
| exec-canonical-confinement | `test/unit/attachArgs.test.ts`         | confines paths and symlinks                        | H4       |
| windows-uri                | `test/unit/attachArgs.test.ts`         | handles Windows separators and URI escaping        | H4       |
| exec-file-cancellation     | `test/unit/attachArgs.test.ts`         | cancellation refuses before any path lookup        | H4       |
| io-hash-metadata           | `test/unit/toolIoMedia.test.ts`        | sniffs mp4, mp3 and wav                            | H7       |
| io-approved-canonical      | `test/unit/toolIoMedia.test.ts`        | refuses a path retargeted                          | H7       |
| exec-metadata-receipts     | `test/unit/execRun.test.ts`            | hands repeatable confined links                    | H6       |
| exec-unbound-admission     | `test/unit/execRun.test.ts`            | returns usage/2 for an escaped path                | H9       |
| exec-refusal-exit          | `test/unit/execRun.test.ts`            | returns usage/2 for unsupported attached media     | H9       |

## Inherited Node 26 reservation failure

The final broader batch (`modelApiTools`, `toolIo`, `toolIoBounded`) ran on
Node **v26.0.0**: 93 tests passed, two existing Windows-only cases skipped by
the repository, but Vitest exited 1 for an unhandled `ERR_INVALID_STATE`.
Node 26 treats FileHandle closure during garbage collection as an error.
The unchanged reservation-region SHA-256 is
`7196a7a472da93b0e5a766aea08b8df5ce540ec7768bcdb990619aaf49940477`.
The descriptor belongs to `swapped-fill/ws/allowed/new.png`, created by the
existing test "refuses a reserved image fill after its parent becomes a
link" (`test/unit/toolIo.test.ts`). That test's rejected `reservation.fill`
leaves the handle open and does not call `release`. The reservation/fill
implementation is unchanged in this lane; E2 owns only the media-read
region. Lead/IO-write owner must close this inherited reservation path or
clean up the test's reservation, then rerun the complete file on Node 26
and CI's pinned runtime. No test, timeout or gate is disabled to hide it.

**Named handoff: M105-E2-reservation-handle (lead/IO-write owner).** This is
separate from E2's media streams, which close both inspection and upload
handles explicitly in `finally`.

## Planning status and next slice

E2's implementation and scoped fake coverage are complete. Final static/build
receipts are recorded above; all 18 changed files are committed with hooks. M105 remains planned overall:
delivery a is not marked complete because W must bind runtime/tool replay,
provider/account ownership, price/Contributor/soundtrack admission, headless
liability accounting and the lazy bundles, then finish E1/E3 and the integrated
gates. No unbound route dispatches media. Delivery b/c/d, remaining live
captures and upstream filings retain their existing unchecked status.

Next slice: W consumes the six named handoffs above; recorder/native/browser
owners run their visual and editor checks. E2 adds no browser layout or CSS.
Shipped README/CHANGELOG/help/reference changes remain explicitly W-owned.
