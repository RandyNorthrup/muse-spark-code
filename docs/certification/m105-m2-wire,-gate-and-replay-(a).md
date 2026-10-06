# M105 M2 — wire, gate and replay (a)

Kubuntu; branch `m105/m2`, base `b52350255`; 2026-10-06.
Read the rig brief, common rules, AGENTS.md, PLAN D85/M105, the coverage
research and lane 0/F/M1 certification. No merge, rebase, push, credential
access, provider call, paid call, dependency installation or gate change.
Tests use the repository's default timeout and at most three complete files
per run. Full quality belongs to the integrating lead under the rig brief.

## Implementation

- `modalityGate.ts` consumes a verified projection of M95's selected-model
  capability record. It distinguishes no/unknown, checks formats, byte and
  duration bounds and fps, refuses audio without evidence that it is heard,
  and exposes the 1.3 soundtrack warning. No vendor allowlist or guessed
  model preset is installed.
- `replayMedia.ts` retains metadata and provider-local IDs, with no bytes or
  paths in its durable parts. A provider-scoped ledger streams approved
  sources and verifies SHA-256; IDs survive model switches and forks.
  Missing uploads get one replacement per provider/digest per model call;
  a generic HTTP 404 is insufficient to trigger a model retry.
- The Responses codec port separates inline and uploaded encoding. The
  uploaded encoder receives no original inline part. Inline encoding reports
  its actual character count for the existing combined byte budget.
- Model API request building projects the selected model's media anew;
  successful fitting retains canonical metadata rather than committing an
  omission note. History snapshots include F's ownership references; fork
  copies restore the metadata map. Uploaded images no longer expose their
  old transient base64 through `sentImages`.
- Upload-bound images/PDFs enter admission as zero inline bytes while keeping
  their slots. The regression test failed before the early-admission fix.
- Transcript/export text includes localized media names/duration/size, without
  upload IDs or bytes. Model-facing notes come from the required English codec.
- Video consumes one of the shared 50 media slots. Uploaded PDFs consume
  their bounded page count (50 when unknown). Fresh media must fit whole;
  older replay can be omitted. No existing budget is raised.
- Compaction sends model-facing metadata for managed media, preserving the
  complete recent turns selected by the injected M101 C1 tail port. The
  old no-media compaction bytes remain unchanged. C1 owns the structured
  summary and its cut-boundary semantics; this lane does not invent them.

## Required integration handoffs

These are real, required injected interfaces. There is no production fake
encoder, capability record, source reader, storage adapter or consent grant.

- **M2-M95-capability:** map the validated, evidence-bearing
  `ModelCapabilityRecord` into `MediaModelCapabilities`. That M95 module is
  absent from this base. Unknown is off, even when a vendor markets vision.
- **M2-captured-Responses-codec:** bind `ResponsesMediaCodec` after the raw
  U5/U6 request frames and their workspace/attempt ledger are supplied and
  lane 0 widens `schemas.ts`'s input types. The captured adapter must encode
  `input_video` by `file_id`/fps, PDFs by `input_file`/`file_id`, and the
  captured inline QuickTime MIME. No Meta `input_audio` is enabled.
  `isMissingFile` must identify the captured file-specific failure, not
  simply status 404. Vendor V supplies its own captured adapters.
- **M2-English-model-notes:** the codec's required `metadataText` and
  `omittedText` bind English templates in the appropriate declared
  `MODEL_TEXT` region. Stored History metadata uses the existing translated
  `UI_TEXT.media` templates at use time. No untranslated UI key is added.
- **M2-F-provider-ledgers:** bind `ledger(provider)` to F's account/provider
  storage and transport. Preserve every provider reference in `fileRefs`;
  the session-store lifecycle binding must route those references to their
  corresponding ownership ledgers. Every dispatch uses the owning account
  digest. F's storage-billing admission remains required; U6c is still open.
- **M2-E1/E2-approved-source:** `attachment` resolves session-bound host-issued
  tokens and legacy image/PDF parts into sniffed metadata plus SHA-256.
  Ordinary text, named text and skills return `undefined`, preserving their
  existing text path. E2/W must register validated `read_file`/generated
  media through the same canonical port; those bindings may not bypass it.
  `source` returns a fresh bounded stream after confinement and approval on
  every open. Source paths, bytes and credentials never enter session files.
  A missing source is an explicit reattach refusal when a new upload is needed.
- **M2-C/A-admission:** `authorize` binds calibrated capped-session and daily
  budget admission, Contributor choices and the soundtrack action. It is
  required before any source opens or upload starts. E1/E2/E3 must set the
  durable `isScreenRecording` classification on recording metadata; C/A must
  use it for the Contributor question on every recording, including restores
  and forks. No default grant is
  supplied. Apply the owner's on-by-default/first-charge three-choice modal
  ruling with prices and `museSpark.paidDailyBudgetUsd` there.
- **M2-M101-C1-tail:** bind `compactionTail` to C1's recent complete turns.
  The engine preserves their canonical parts and ownership references;
  invalid/foreign turn IDs refuse. C1 must also reconcile the structured
  summary's boundary with the retained tail when that milestone integrates.
- **M2-W-lazy-binding:** install `createMediaReplay(sessionId)` from the lazy
  portable media bundle in extension and runtime. A stored media session
  refuses when that adapter is unavailable. The factory is absent by default
  on this base, preserving today's requests for its single-model user.
  The structural `MediaReplayPort` lets W forward through a lazy adapter without
  inheriting the engine. W owns bundle entries/split guards, source bindings,
  manifests and docs.
- **M2-W-docs/reference:** `featureCatalog.ts` is absent. Register modality
  gating, upload replay/model-switch notes and metadata-only History in the
  help reference on integration. W owns README/PRIVACY/CHANGELOG and must
  describe the actual shipped bindings, not advertise these ports as enabled.

The available capture record is an evidence summary, not raw frames. It
reports 9 Responses attempts (one refused before inference), 36 other calls
and four deleted uploads, on Contributor models, 2026-10-05 about 17:40 PT.
The original workspace, per-capture ledger and spend are still with the
lead. All encoder markers in the new tests are explicitly synthetic. **No
new media wire golden or live Meta receipt is claimed.** Existing no-media
raw-byte goldens are compared without regeneration.

## Provider × modality matrix

Every provider uses the same gate. The generated-record tests prove support
on, no off, and unknown off independently of vendor. These cells describe
availability on this unbound base; captured codec activation belongs to W/V.

| Provider/model | Image                    | PDF                      | Video                                                                | Standalone audio                            |
| -------------- | ------------------------ | ------------------------ | -------------------------------------------------------------------- | ------------------------------------------- |
| Meta 1.3       | on: existing inline path | on: existing inline path | off: M95/raw codec binding; captured mp4/mov accepted, sound unheard | off: U7 silently ignored                    |
| Meta 1.2       | on: existing inline path | on: existing inline path | off: M95/raw codec binding; captured mp4/mov and sound accepted      | off: U7 silently ignored                    |
| Meta 1.1       | on: existing inline path | on: existing inline path | off: unknown capture                                                 | off: unknown/unsupported hearing            |
| OpenAI         | off: M95 binding absent  | off: M95 binding absent  | off: selected record/codec evidence absent                           | off: selected record/codec evidence absent  |
| Anthropic      | off: M95 binding absent  | off: M95 binding absent  | off: selected record/codec evidence absent                           | off: selected record/codec evidence absent  |
| Gemini         | off: M95 binding absent  | off: M95 binding absent  | off: vendor capture/codec binding                                    | off: vendor capture/codec binding           |
| xAI            | off: M95 binding absent  | off: M95 binding absent  | off: selected record/codec evidence absent                           | off: selected record/codec evidence absent  |
| OpenRouter     | off: M95 binding absent  | off: M95 binding absent  | off: selected route's capture/codec binding                          | off: selected route's capture/codec binding |
| Ollama/local   | off: M95 binding absent  | off: M95 binding absent  | off: served model's capture/codec binding                            | off: served model's capture/codec binding   |
| Custom         | off: M95 binding absent  | off: M95 binding absent  | off: selected record/codec evidence absent                           | off: selected record/codec evidence absent  |

The portable core imports no VS Code API. VS Code-family editors, remote
hosts, MHP native plugins, ACP/companion editors and headless runs consume
these same ports; E1/E2/E3/W bind their surfaces and permissions. No editor
is enabled through an editor-specific branch here.

## Verification and red drills

Each control changed one guard, ran its entire test file with
`npx vitest run <file> --maxWorkers=3` and the default test timeout, observed
exit 1 and a named assertion failure, then restored the original bytes in
`finally`. SHA-256 matched before/after every control. All 73 controls below
fired; scratch logs are in the ignored `temp/m105m2-drill-*.log` files.

Initial non-firing controls were not certified: the first video mutation
hit admission rather than dispatch; the large-inline guard needed a
restored legacy case; snapshot/compaction needed small pending inline
canaries; no-Files needed an admission-call assertion; `sentImages` needed
its assertion after inline-to-upload promotion. The tests/targets were
strengthened and each control rerun to a named red result.

| Guard removed/weakened | Named failing test (first where several fired) | Restoration hash |
| ---------------------- | ---------------------------------------------- | ---------------- |

| unknown modality refuses | refuses unknown video before dispatch with a distinct reason | H1 |
| unsupported modality refuses | gates meta by the record, independently of vendor | H1 |
| captured format required | refuses an uncaptured format and enforces the selected upload or inline bound | H1 |
| standalone audio must be heard (U7) | never enables silently ignored standalone audio; captured hearing is required | H1 |
| selected byte limit | refuses an uncaptured format and enforces the selected upload or inline bound | H1 |
| known duration under a limit | enforces duration and fps bounds, refusing unknown duration under a duration limit | H1 |
| maximum duration | enforces duration and fps bounds, refusing unknown duration under a duration limit | H1 |
| fps range and evidence | enforces duration and fps bounds, refusing unknown duration under a duration limit | H1 |
| soundtrack warning | accepts captured mp4/mov and distinguishes 1.3 soundtrack from 1.2 | H1 |
| metadata rejects bytes and source paths | rejects metadata bytes, invalid expiry and mismatched digest, MIME or size | H2 |
| bounded metadata name | rejects metadata bytes, invalid expiry and mismatched digest, MIME or size | H2 |
| SHA-256 shape | rejects metadata bytes, invalid expiry and mismatched digest, MIME or size | H2 |
| positive metadata fps | rejects metadata bytes, invalid expiry and mismatched digest, MIME or size | H2 |
| uploaded receipt metadata and expiry | rejects metadata bytes, invalid expiry and mismatched digest, MIME or size | H2 |
| upload digest matches metadata | rejects metadata bytes, invalid expiry and mismatched digest, MIME or size | H2 |
| upload size matches metadata | rejects metadata bytes, invalid expiry and mismatched digest, MIME or size | H2 |
| upload MIME matches metadata | rejects metadata bytes, invalid expiry and mismatched digest, MIME or size | H2 |
| admission capability guard | refuses unknown video and 51 fresh videos before a model request or upload | H2 |
| historical unknown/no skips paid work | replaces switched media with a temporary note and restores its unexpired ID on switching back | H2 |
| per-request capability projection | replaces switched media with a temporary note and restores its unexpired ID on switching back | H2 |
| paid/Contributor/sound admission before upload | does not start ensure after cancellation during admission | H2 |
| initial cancellation before admission | refuses cancellation, a mismatched model record and a foreign provider upload | H2 |
| missing approved source refuses before ensure | requires paid/Contributor/sound admission and refuses missing or changed approved sources before ensure | H2 |
| approved source name matches | refuses mismatched approved source metadata {"name":"wrong"} before ensure | H2 |
| approved source MIME matches | refuses mismatched approved source metadata {"mime":"audio/wav"} before ensure | H2 |
| approved source bytes match | refuses mismatched approved source metadata {"bytes":1} before ensure | H2 |
| returned provider matches selected provider | refuses cancellation, a mismatched model record and a foreign provider upload | H2 |
| bounded source replacement per provider/digest | bounds repeated missing-ID replacement before a second upload can open the source | H2 |
| video uploads even below 1 MiB | uploads video before encoding, forwards fps and never supplies inline bytes to the uploaded encoder | H3 |
| large image/PDF moves to upload | promotes restored legacy large inline media before replay | H3 |
| delivered inline image moves to upload | keeps inline small images initially, uploads larger PDFs and moves delivered images to IDs | H3 |
| uploaded encoder never gets inline content | uses provider-scoped ledgers and keeps both IDs when switching vendors and back | H3 |
| encoded character count is valid | refuses invalid encoder byte counts and fresh inline media beyond the combined cap | H3 |
| fresh encoded media must fit whole | refuses invalid encoder byte counts and fresh inline media beyond the combined cap | H3 |
| inline encoded bytes enter the budget | refuses invalid encoder byte counts and fresh inline media beyond the combined cap | H3 |
| video consumes a media slot | counts uploaded video in the shared 50-media budget while its bytes consume no inline budget | H4 |
| PDF unknown pages reserve 50 slots | weighs uploaded PDFs by known pages and reserves 50 slots when pages are unknown | H4 |
| fresh 50-media maximum | counts uploaded video in the shared 50-media budget while its bytes consume no inline budget | H4 |
| fresh inline byte maximum | refuses invalid encoder byte counts and fresh inline media beyond the combined cap | H4 |
| metadata-only snapshots | snapshots pending and delivered small inline images as metadata without bytes | H3 |
| model switches retain canonical media | replaces switched media with a temporary note and restores its unexpired ID on switching back | H3 |
| delivered state persists | snapshots pending and delivered small inline images as metadata without bytes | H3 |
| snapshots do not share mutable delivery state | does not mutate a saved snapshot when a delivery completes | H3 |
| captured file-specific recovery only | recovers only a captured file-specific error and only when ensure replaces an ID | H3 |
| fork restores managed metadata | dispatches uploaded references, saves metadata-only history and preserves IDs across model switches and forks | H5 |
| only one model-call missing-file retry | recovers a captured missing-file error once, but does not retry a second missing-file error | H5 |
| snapshots carry ownership refs | compacts an image of 1 bytes as metadata and preserves its uploaded tail on continuation | H5 |
| missing media adapter refuses resume | retains pre-existing F references and refuses a media session when its adapter is missing | H5 |
| model summary names media instead of bytes | uses English codec metadata for compaction, preserves its selected recent turns and rejects a forged tail | H3 |
| host summary uses metadata projection | compacts an image of 1 bytes as metadata and preserves its uploaded tail on continuation | H5 |
| host compaction retains selected media tail | compacts an image of 1 bytes as metadata and preserves its uploaded tail on continuation | H5 |
| exports include media metadata | dispatches uploaded references, saves metadata-only history and preserves IDs across model switches and forks | H5 |
| stored replay belongs to a user message | keeps uploaded replay parts metadata-only and rejects bytes, invalid indices and non-user placement | H6 |
| stored uploaded replay cannot contain bytes | keeps uploaded replay parts metadata-only and rejects bytes, invalid indices and non-user placement | H6 |
| provider portfolio is unique | rejects metadata bytes, invalid expiry and mismatched digest, MIME or size | H3 |
| current model record matches requested ID | refuses cancellation, a mismatched model record and a foreign provider upload | H3 |
| provider chooses its own ledger | uses provider-scoped ledgers and keeps both IDs when switching vendors and back | H3 |
| cancellation after admission | does not start ensure after cancellation during admission | H3 |
| cancellation after source resolution | does not start ensure after cancellation during source | H3 |
| compaction tail must belong to this replay | uses English codec metadata for compaction, preserves its selected recent turns and rejects a forged tail | H3 |
| replay metadata indices are unique | keeps uploaded replay parts metadata-only and rejects bytes, invalid indices and non-user placement | H6 |
| replay index must address existing content | keeps uploaded replay parts metadata-only and rejects bytes, invalid indices and non-user placement | H6 |
| no paid work for unsupported file references | never falls back to base64 for an uploaded file when the selected model cannot use Files | H3 |
| no inline replay of an uploaded file when Files is unavailable | never falls back to base64 for an uploaded file when the selected model cannot use Files | H3 |
| sentImages drops uploaded original bytes | compacts an image of 1 bytes as metadata and preserves its uploaded tail on continuation | H5 |
| missing-file retry shares the HTTP retry budget | does not add a missing-file retry after the shared HTTP retry budget is exhausted | H5 |
| upload-bound attachments omit transient bytes before fresh admission | counts an upload-bound image as slots with zero inline bytes before dispatch | H3 |
| restore checks the media index | restores fork/rewind metadata without bytes, retains recent-tail IDs and releases compacted references | H3 |
| unmanaged attachments preserve the no-media path | does not consult media capabilities or encoders when there is no media | H3 |
| no-media preparation avoids capability lookup | does not consult media capabilities or encoders when there is no media | H3 |
| no-media projection preserves identity without capability lookup | does not consult media capabilities or encoders when there is no media | H3 |
| no-media compaction retains the old empty tail | does not consult media capabilities or encoders when there is no media | H3 |

Restoration hashes (each before = after; H2 predates the upload-admission fix):

- **H1** `src/core/media/modalityGate.ts`: `a6e481ab8a5a6fb0d2aa2309bcf27d1b9f4b30e41724a355b419c1976e89a7c7`
- **H2** `src/core/media/replayMedia.ts`: `948e5c68c76c6efed73e2688cb903baafd28d75c828a7be8b511d125bbed8e10`
- **H3** `src/core/media/replayMedia.ts`: `6eb6b5c76ac38ce839e29889bf0d779dafd2021656a3aa55489832e7b641603b`
- **H4** `src/core/backends/modelapi/mediaBudget.ts`: `76ade84905e22ef56c1f6b4fd54e80756ac01af6b7699feb55e3213bb5780594`
- **H5** `src/core/backends/modelapi/ModelApiHost.ts`: `579a2fdc1dbbfd4f1f610a21a7f09c9a0d6a71cb444b8e9c0b6ccb1a75b917a1`
- **H6** `src/core/backends/modelapi/sessionStore.ts`: `4ae518727bf266443663e37e7d29ad33de54b9ba02e455ed3624300d81ee14d4`

### Final scoped checks — Kubuntu

| Command/check                                                                                                                          | Result                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `npx vitest run test/unit/modalityGate.test.ts test/unit/mediaBudget.test.ts test/unit/sessionStore.test.ts --maxWorkers=3`            | 3 complete files, 40 tests passed, default timeout                                                            |
| `npx vitest run test/unit/replayMedia.test.ts test/unit/modelApiMedia.test.ts test/unit/modelApiGoldenRequests.test.ts --maxWorkers=3` | 3 complete files, 55 tests passed, default timeout                                                            |
| `npx vitest run test/unit/modelApiHost.test.ts --maxWorkers=3`                                                                         | complete file, 615 tests passed, default timeout                                                              |
| `npm run typecheck`                                                                                                                    | all five projects passed                                                                                      |
| changed-file ESLint, `--max-warnings=0`                                                                                                | passed after fixing a void-arrow assertion                                                                    |
| `npm run cycles`                                                                                                                       | no circular dependencies, 565 modules                                                                         |
| `npm run deadcode`                                                                                                                     | passed; two inherited configuration hints                                                                     |
| `npx jscpd`                                                                                                                            | zero clones; consolidated repeated synthetic capability and turn fixtures                                     |
| `npm run check:l10n`                                                                                                                   | 14 tables, 164 manifest strings, 603 source files, zero problems                                              |
| `npm run check:host-api`                                                                                                               | fails: inherited F/M1 Node importer counts need W's generated-record refresh; M2 adds no Node built-in import |
| `npm run build`                                                                                                                        | compilation passed; size gate failed at inherited deferred browser JS 51.1/50 KiB                             |
| `node scripts/check-bundle-split.mjs`                                                                                                  | fails: inherited `files.ts` and new type-only `codecs/responses.ts` need W's backend-list registration        |
| `node scripts/check-host-globals.mjs`                                                                                                  | passed, zero `navigator` references in all Node bundles                                                       |
| `node scripts/third-party-notices.mjs`                                                                                                 | passed, 83 bundled packages                                                                                   |

Changed-file Prettier and `git diff --check` also pass.

**710 final positive tests**, seven complete files. No golden fixtures were
regenerated. An additional raw-fetch test compares no-media requests with the
media port installed/absent byte for byte; capability, admission and upload
callbacks stay unused.

Production sizes: extension **443.7/600 KiB**, Model API **453.2/475 KiB**,
checkpoint store **77.0/225 KiB**, ACP **823.8/850 KiB**, browser startup JS
**899.2/900 KiB**, deferred JS **51.1/50 KiB**. M2 adds no browser UI and does
not alter the deferred browser code. W must resolve the inherited size failure
within the cap, classify both backend files, and regenerate the host record.
The observed Node counts are buffer 39→44, child_process 13→14, crypto 46→48,
fs 33→34, fs/promises 47→48, os 9→10, path 84→85.

No full quality, media wire golden, paid/live receipt, or release readiness is
claimed. The rig brief reserves full quality for the lead; the named captured
codec, M95, F/C/A/source/tail/editor bindings remain required before enablement.
No threshold, timeout, rule level, ignore or hook was weakened. No dependency
or tool was installed. No owner decision was silently defaulted: paid
on-by-default/first-charge consent belongs to the required C/A binding.

### Recording classification follow-up

After implementation commit `c764813cd` (enabled ESLint/Prettier and
gitleaks hooks passed), the default-timeout replay file failed at
**preserves screen-recording classification through persistence and forks
for Contributor admission**: the metadata schema did not accept
`isScreenRecording`. Added the optional boolean already defined by lane 0's
media-chip contract. It survives snapshot/restore/fork and reaches the
required C/A admission callback; this lane grants no Contributor consent.

Control 73 changed its boolean parser to `z.unknown()`. The complete
`replayMedia.test.ts` exited 1 at **rejects metadata bytes, invalid expiry and
mismatched digest, MIME or size** when the string `true` was accepted. The
source was restored byte-exact, before/after SHA-256 `b64bf711f94a853e348bb23f3cb7f53bfcb3879471d32682f9f5944b9a48d01e`.
The prior 72 control hashes remain the exact control-time records.

The recording follow-up also passed all five typecheck projects, the replay/host/golden batch (55 tests), the gate/budget/store batch (40 tests), changed-file ESLint/Prettier, localization, and zero-clone duplication. Production compilation passed with the same deferred-JS blocker and the final sizes above. The earlier complete host regression file contributes the remaining 615 tests; host dispatch code was unchanged by this schema-only follow-up.
