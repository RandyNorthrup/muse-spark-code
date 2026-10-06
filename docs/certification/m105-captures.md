# M105 capture evidence and lead handoff

Lane M105-0, Kubuntu, 2026-10-05. Base `1262a926` on `m105/l0`.
This lane makes **zero** live, paid, subscription or external HTTP calls,
reads no credentials, and creates no provider uploads.

## Evidence available here

`docs/research/meta-coverage-2026-10-05.md` §6 records the
owner-authorized 2026-10-05 run, about 17:40 PT. Its totals are **9 Responses
attempts**, including one invalid-schema 400 before inference, **36 other
calls**, and **4 uploads**, all deleted and confirmed absent. The models
were contributor models. The summary does not name the original workspace
or report spend; those facts must come from the lead's capture ledger.

| Capture               | Available finding                                                                                                                                                                                                    | Contract implication                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| U1, U2, U3, U17 count | About 170 input tokens regardless of video length, fps, image detail or image count; a 600-second video counted 169                                                                                                  | Never use this count as a media reservation                              |
| U3                    | 51 media were accepted at count time                                                                                                                                                                                 | The client still enforces its 50-media bound; real-turn U3b remains open |
| U4                    | 1.3 Contributor saw the 10-second clip but did not hear speech; 1.2 Contributor transcribed it                                                                                                                       | Soundtrack capability differs by model                                   |
| U4 usage              | 2,751 input tokens on 1.3, 1,671 on 1.2, for a 10-second roughly 0.5 MB clip                                                                                                                                         | A first observation, not a calibrated upper bound                        |
| U5                    | mp4 and mov accepted inline and uploaded; WebM refused                                                                                                                                                               | Sniffed mov is `video/quicktime`; conversion can be offered for WebM     |
| U6                    | Multipart `purpose=user_data`, `expires_after[anchor]=created_at`, `expires_after[seconds]=3600`; `expires_at` returned; content SHA-256 matched; delete returned `deleted: true` and removed the file from the list | Always request expiry; cleanup is observable                             |
| U6b                   | `store: false` with `input_file` and an uploaded `file_id` worked                                                                                                                                                    | Stateless turns can replay upload references                             |
| U7                    | Inline wav/mp3 and uploaded wav were accepted by the count path; 1.2 said no audio arrived on a turn                                                                                                                 | No Meta `input_audio` dispatch is enabled                                |
| U11                   | `compact_threshold` below 1,000 refused; no compaction item with `store: false` and about 6.2k tokens                                                                                                                | Server compaction stays an evaluated arm                                 |
| U14                   | Model list unchanged by `?client=`                                                                                                                                                                                   | Model names alone establish no modality bounds                           |

This is an **evidence summary**, not a scrubbed raw capture. The audit says
raw records were kept outside the repository. None is present in this base
or supplied at a permitted path. No full Files response, video wire schema,
provider record, or batch transcription schema is invented from the summary.
The test Files server accepts **injected response frames** so lane F can use
the exact scrubbed U6 bodies when the lead supplies them. Its own smoke test
uses labelled test-only projections, not claimed live frames.

## Still required from the lead

- Scrubbed U1–U7 and U17 request/response bodies; original workspace,
  per-capture attempt counts, trace/request ledger, spend and deletion receipts.
- U17b: 30-, 120-, 600-second clips at default fps and `fps: 1` on 1.3 and
  1.2 Contributor; images at every detail, including original; reported usage.
- U3b: real Responses turns with 50 and 51 media.
- U18: Muse Voice batch transcription with mp4 and mov (and standalone
  wav/mp3 where needed), including exact responses and price receipts.
- U16: one subscription turn with `@clip.mp4` over MSP on Muse Code 1.4.2.
- U6c: read-only billing dashboard after a day with uploads. Storage billing
  stays unknown; no free or paid upload default is selected by this lane.
- Vendor wire captures before Gemini or compatible `video_url` codecs turn on.

The plan estimates about 12 inference turns, 3 transcription calls, 10
non-inference calls and one Muse Code turn for the remaining run. These are
**planned counts**, not receipts. The lead deletes every new upload and
confirms absence afterwards.

## Upstream request drafts

Four drafts live in `docs/research/m105-upstream-*.md`, with title, body,
reproduction and expected behavior. No dedupe search, post or filing took
place: the lane brief permits local drafts only. The lead dedupes, files
through Meta's developer support or the appropriate tracker, and records
links here.
