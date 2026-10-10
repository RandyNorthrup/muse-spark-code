# M105 capture evidence and lead handoff

Lane M105-0 wrote the first version on Kubuntu, 2026-10-05, base `1262a926` on
`m105/l0`. That lane made no live calls. The lead's capture record below was
added on the Windows 11 host on 2026-10-08, on branch `m105/captures` from
`rel017/money3` (`a7f6f604`). It covers three owner-authorized Model API
rounds, one Muse Code subscription turn and the U6c dashboard read.

## Runs, workspaces and raw records

| Run     | When (PT)         | Workspace                                                                                        | Steps                                     |
| ------- | ----------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Round 1 | 2026-10-05 ~17:30 | scratchpad `meta-coverage/captures` (script `capture.mjs`), fixtures `meta-coverage/fixtures`    | U1–U11, U13, U14, U17 count               |
| Round 2 | 2026-10-05 ~19:22 | scratchpad `meta-coverage/captures` (script `capture2.mjs`)                                      | U9b, U18 (containers), U3b, U17b, U19     |
| Round 3 | 2026-10-08 08:49  | new empty scratchpad folder `m105-live-2026-10-08` (script `capture3.mjs`, copied fixtures only) | U17b gaps, U18 through a converter        |
| U16     | 2026-10-08 08:54  | new empty scratchpad folder `m105-u16-2026-10-08/ws` holding only `clip.mp4`                     | one Muse Code 1.4.2 MSP subscription turn |
| U6c     | 2026-10-08 09:15  | the owner's signed-in Chrome, one new tab, read-only, closed afterwards                          | Usage, Billing and Dashboard pages        |

PLAN step 1 named `C:\muse-live-ws`. The runs used the scratchpad folders
above instead; the round-3 and U16 folders were new and empty apart from the
synthetic fixtures. All media are synthetic and throwaway: ffmpeg colour bars
with on-screen words, Windows SAPI voices reading fixed sentences, and solid
colour PNGs (`meta-coverage/fixtures/MANIFEST.md`). The round-3 WAV inputs
were extracted with ffmpeg 7.1.1 on the Linux laptop rig
(`-vn -ac 1 -ar 16000 -c:a pcm_s16le`). The mp4 and mov soundtracks gave
byte-identical WAVs (SHA-256 `18c8ce14…`).

The key reached each child process only through the DPAPI helpers
(`run-capture*.ps1`), which never print it. Only contributor models were
called. Round 3 was capped in code at 14 `POST /responses` and 3
`POST /asr/transcribe`, with no automatic retries.

The scrubbed raw records are in `docs/research/m105-captures/`:

| File                                | Contents                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `round1-2026-10-05.jsonl`           | Every round-1 call with its request and response body (U1–U11, U13, U14, U17); U6's Files frames |
| `round1-u14-models.json`            | `GET /models`, identical with `?client=vscode` and `?client=muse-code`                           |
| `round2-2026-10-05.jsonl`           | Every round-2 call and note, including all 253 deletes and the U19 file attribution              |
| `round2-u9b-sse.jsonl`              | Every U9b SSE event (strict tool, argument deltas)                                               |
| `round2-u18-t6-sse-compact.jsonl`   | T6's endpointing event stream; its 7,476 `audioProgress` events are run-length rows              |
| `round2-files-cleanup.json`         | The two round-2 stragglers, found and deleted by the follow-up cleanup                           |
| `round3-2026-10-08.jsonl`           | Every round-3 call and note, with the deletion and `GET` 404 receipts                            |
| `u16-2026-10-08.jsonl`              | The U16 MSP notifications, `usage/read` and `session/read` (delta chunks and stderr dropped)     |
| `u16-trace-attempts-2026-10-08.txt` | The CLI trace's `model.attempt.lifecycle` lines for that turn                                    |
| `media-calibration-seeds.json`      | The estimator's seed points (below)                                                              |

Scrubbing (`scrub.mjs` in the round-3 folder) replaces each file id, response
and item id, request id, `proxy-status` blob, UUID, account tier id, long
numeric id and local path with a labelled placeholder (`<file-id-12>`,
`<header-x-request-id-3>`, `<uuid-40>`, `<account-tier-1>`, `<home>`,
`<scratchpad>`). The same value gets the same label in every file, so an
upload, the turns that use it and its delete still line up. Base64 payloads
and `encrypted_content` were already replaced by byte or character counts
when the records were written. A value-blind check (`check-key-absent.ps1`)
found 0 occurrences of the key, of its first 12 characters and of its last 12
characters in every file. The grep for long opaque strings found only public
build ids, fixture hashes and capture session labels.

Scrub correction (lane MONEY017E, 2026-10-08): the sentence above overstated
the item-id replacement. Sixteen response output item ids in
`round1-2026-10-05.jsonl` kept the last four UUID groups after a placeholder
prefix, shaped `<msg-id-N>-hhhh-hhhh-hhhh-hhhhhhhhhhhh` (and the equivalent
reasoning-item shape). Each whole id is now a bare labelled placeholder
(`<msg-id-8>` through `<msg-id-23>`, one per id, each occurring once), so no
original hex remains and no cross-file label collides. A rescan of every file
under `docs/research/m105-captures/` with the patterns below now reports zero
residual private identifiers (before → after: partial-UUID
`-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}` 16 → 0; full-UUID
`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}` 0 → 0; raw
`msg_…`/`resp_…`/`req_…` ids 0 → 0; email addresses 0 → 0; absolute user paths
0 → 0). The remaining `file-…` hits are the scrub's own `<file-id-N>`
placeholders. The remaining 24+-character hex runs are synthetic fixture
`sha256` values, the public CLI build id in the U16 user agent, and the public
MSP schema fingerprint — none of them account or key material. The
`test/unit/m105CaptureScrub.test.ts` suite re-runs this scan, so a future
capture that reintroduces one of these shapes fails the gate.

## Calls by type

| Kind                                   | PLAN estimate | Round 3 | U16 | Round 2 (10-05) | Round 1 (10-05) |
| -------------------------------------- | ------------: | ------: | --: | --------------: | --------------: |
| Inference turns (`POST /responses`)    |           ~12 |      13 |   — |              16 |   9 (1 refused) |
| Transcription (`POST /asr/transcribe`) |            ~3 |       3 |   — |   6 (3 refused) |               0 |
| Calls that infer nothing               |           ~10 |      13 |   — |             262 |              36 |
| Muse Code turns (subscription)         |             1 |       — |   1 |               — |               — |
| Muse Code model attempts (trace)       |             — |       — |   6 |               — |               — |

Round 3 and U16 are this run and stay within 1.5x of the plan. Rounds 1 and 2
are the lead's 2026-10-05 records, now scrubbed and receipted. Round 2's 262
non-inference calls are mostly its 253 deletes: 250 server-saved inline images
(U19 below) and 3 uploads. Round 3 reproduced none of the round-2 rows; it filled only the
gaps.

Round 3's 13 non-inference calls: 3 `GET /files` listings (before, after,
after the deletes), 1 `GET /models`, 3 uploads, 3 deletes and 3 per-file
`GET /files/{id}` checks.

## Receipts

Prices are the published contributor rates read on 2026-10-08
(`dev.meta.ai/docs/pricing-rate-limits`): $0.10 per million input tokens,
$0.002 cached, $0.20 output. Muse Voice Transcribe costs $0.18 per audio
hour, rounded down to whole seconds. Every U17b and U3b turn used the same
prompt, `max_output_tokens` 64 and `reasoning.effort` minimal. Each one ended
`incomplete` on `max_output_tokens`, so its usage is the input bill, not an
answer. Each row is one attempt.

| Capture            | Model                       | Row                                                                 | Usage (in / cached / out)                                               | Price                                                      | Deletion receipt                                        |
| ------------------ | --------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| U17b base          | 1.3 contrib.                | B13 prompt alone                                                    | 28 / 0 / 64                                                             | $0.000016                                                  | —                                                       |
| U17b base          | 1.2 contrib.                | B12 prompt alone                                                    | 28 / 0 / 64                                                             | $0.000016                                                  | —                                                       |
| U17b video         | 1.3 contrib.                | R03 30 s default fps (r2)                                           | 8,207 / 0 / 64                                                          | $0.000834                                                  | clip30 `deleted: true`, r2                              |
| U17b video         | 1.3 contrib.                | R04 30 s `fps: 1` (r2)                                              | 8,207 / 8,163 / 64                                                      | $0.000034                                                  | same upload                                             |
| U17b video         | 1.3 contrib.                | V13f2 30 s `fps: 2` (r3)                                            | 8,207 / 0 / 64                                                          | $0.000834                                                  | clip30 `deleted: true`, `GET` 404 `file_not_found`, r3  |
| U17b video         | 1.3 contrib.                | O1 120 s default fps (r2)                                           | 32,731 / 0 / 64                                                         | $0.003286                                                  | clip120 `deleted: true`, r2                             |
| U17b video         | 1.3 contrib.                | R07 120 s `fps: 1` (r2)                                             | 32,731 / 0 / 64                                                         | $0.003286                                                  | same upload                                             |
| U17b video         | 1.3 contrib.                | R05 600 s default fps (r2)                                          | 85,531 / 0 / 64                                                         | $0.008566                                                  | clip600 `deleted: true`, r2                             |
| U17b video         | 1.3 contrib.                | R06 600 s `fps: 1` (r2)                                             | 85,531 / 0 / 64                                                         | $0.008566                                                  | same upload                                             |
| U17b video         | 1.2 contrib.                | R12 30 s default fps (r2)                                           | 4,967 / 0 / 64                                                          | $0.000510                                                  | clip30, r2                                              |
| U17b video         | 1.2 contrib.                | R13 30 s `fps: 1` (r2)                                              | 4,967 / 4,963 / 64                                                      | $0.000023                                                  | clip30, r2                                              |
| U17b video         | 1.2 contrib.                | V12d 120 s default fps (r3)                                         | 19,771 / 0 / 64                                                         | $0.001990                                                  | clip120 `deleted: true`, `GET` 404 `file_not_found`, r3 |
| U17b video         | 1.2 contrib.                | V12f 120 s `fps: 1` (r3)                                            | 10,651 / 1,507 / 64                                                     | $0.000930                                                  | same upload                                             |
| U17b video         | 1.2 contrib.                | R14 600 s default fps (r2)                                          | 53,131 / 0 / 64                                                         | $0.005326                                                  | clip600, r2                                             |
| U17b video         | 1.2 contrib.                | R15 600 s `fps: 1` (r2)                                             | 53,131 / 53,091 / 64                                                    | $0.000123                                                  | clip600, r2                                             |
| U17b image         | 1.3 contrib.                | I13a/l/h/o big3000 alone, auto/low/high/original, by `file_id` (r3) | 4,086 each / 0–4,067 / 64                                               | $0.000023–$0.000421 each                                   | big3000 `deleted: true`, `GET` 404 `file_not_found`, r3 |
| U17b image         | 1.2 contrib.                | I12a/l/h/o, as above (r3)                                           | 4,086 each / 0–4,067 / 64                                               | $0.000023–$0.000421 each                                   | same upload                                             |
| U17b image (mixed) | 1.3 contrib.                | R08/R09/R10 49 swatches + big3000 at low/high/original (r2)         | 4,625 each / 0 / 64                                                     | $0.000475 each                                             | 50 server-saved copies each, deleted, r2                |
| U3b                | 1.3 contrib.                | R01 50 images (r2)                                                  | 578 / 0 / 64                                                            | $0.000071                                                  | 50 server-saved copies, deleted, r2                     |
| U3b                | 1.3 contrib.                | R02 51 images (r2), **accepted**                                    | 4,636 / 0 / 64                                                          | $0.000476                                                  | 50 server-saved copies, deleted, r2                     |
| U18 T7             | Voice 1.0                   | clip30.mp4 soundtrack as WAV, DIARIZATION                           | 30,080 ms, 30 s billable                                                | $0.001500                                                  | no file stored (U19)                                    |
| U18 T8             | Voice 1.0                   | clip30.mov soundtrack as WAV, DIARIZATION                           | 30,080 ms, 30 s billable                                                | $0.001500                                                  | no file stored                                          |
| U18 T9             | Voice 1.0                   | speech.mp3 as WAV, PUSH_TO_TALK                                     | 3,360 ms, 3 s billable                                                  | $0.000150                                                  | no file stored                                          |
| U18 T1/T5/T6 (r2)  | Voice 1.0                   | wav 3.36 s, 120 s, 598 s                                            | 721 s billable                                                          | $0.036050                                                  | no file stored                                          |
| U18 T2/T3/T4 (r2)  | Voice 1.0                   | mp3, mp4, mov sent as-is                                            | 400, not billed                                                         | $0                                                         | —                                                       |
| U16                | 1.3 contrib. (subscription) | one `@clip.mp4` turn                                                | 6 attempts; main turn 24,999 + 25,790 in (24,945 cached), 770 + 117 out | subscription: 5-hour window <1%, weekly 36% after the turn | the workspace file is local; nothing uploaded           |

Round-1 receipts (U1–U11) are in `round1-2026-10-05.jsonl`: 9 Responses
attempts, $0.00225. Its 4 uploads were deleted and absent from the following
listing.

**Spend.** At list contributor prices: round 3 $0.008712 ($0.005562 tokens,
$0.003150 for 63 audio seconds); round 2 $0.068658 ($0.032608 tokens,
$0.036050 for 721 audio seconds); round 1 $0.002250. The total is $0.0796. The
dashboard shows **$0.00** spend and **0** requests, tokens and audio seconds
for 2026-10-02 to 2026-10-08 on the owner's project (U6c below). It attributes
none of these calls, including round 3's, which ran 25 minutes before the
read. The figures above are computed from the reported usage, not read from
a bill.

**Deletions confirmed.**

- Round 3: 3 uploads, each `deleted: true`. Each `GET /files/{id}` then
  returned 404 `file_not_found`, and the complete listing showed 0 files. The
  `file_id` turns left no server-saved copies.
- Round 2: 3 uploads plus 250 server-saved copies. 252 deletes returned
  `deleted: true`. One delete got no response, and one copy appeared late.
  The follow-up cleanup (`round2-files-cleanup.json`) deleted both.
  Round 3's complete `before` listing confirms neither id remains, and the
  account held 0 files.
- Round 1: 4 uploads, each `deleted: true`, absent from the following listing.

## Findings

**U17b, video.** On a single-video turn, usage grows with duration but not
linearly. The rate falls on long clips, and default and explicit fps are not
interchangeable.

- **1.3 Contributor.**
  - 10 s: 2,751 tokens (round-1 prompt).
  - 30 s: 8,207 at default fps, at `fps: 1` and at `fps: 2`.
  - 120 s: 32,731 at both default and `fps: 1`.
  - 600 s: 85,531 at both. That is about 142.5 tokens per second, against
    about 273 per second for the shorter clips.
- **1.2 Contributor.**
  - 10 s: 1,671.
  - 30 s: 4,967 at both default and `fps: 1`.
  - 120 s: **19,771 at default fps but 10,651 at `fps: 1`**.
  - 600 s: 53,131 at both.

The prompt alone bills 28 tokens on both models. `fps: 2` was accepted and
billed the same as `fps: 1`. Higher fps values were not tried. The
estimator's separate default-fps and explicit-fps variants are therefore
needed, and its largest-rate upper bound is what keeps a reservation above
the 120-second 1.2 default bill.

**U17b, images.** `detail` does not change usage on either model: `auto`,
`low`, `high` and `original` all billed 4,086 tokens for the 3000×2000 PNG
alone. That is 4,058 for the image after the prompt's 28. Size does change
usage: a 64×64 swatch costs about 11 tokens ((578 − 28) / 50). Images larger
than 3000×2000 were not tried.

**U3b.** A real 1.3 turn with 51 images was accepted (HTTP 200, 4,636
tokens), as was the 50-image turn. Meta does not enforce the documented
50-per-request bound, so ours stays client-side (D85.6).

**U19, upload path.** Inline images on real turns are saved as account files.
In round 2 that was 250 `purpose=user_data` files with UUID names and no
expiry. Round 3 sent every image and video by `file_id` from our own uploads,
which carried a 3600 s expiry. That left nothing behind: the listing after the
turns held only our 3 uploads. `input_image` by `file_id` works on both
models. This supports D85.2: upload with expiry and send `file_id`s.

**U18.** The batch endpoint refuses the containers. mp4, mov and mp3 sent
as-is all return HTTP 400 `invalid_request_error`, `param: "audio"`: "The
'audio' part must be a mono 16-bit PCM WAV at 16 or 24 kHz" (round 2). The
same soundtracks converted locally to 16 kHz mono PCM WAV succeed:

- T7, from the mp4: `{"transcript":"The blue llama counts to seven at the harbor. A green otter paints the lighthouse at noon.","audioDurationMs":30080,"turns":[{"turnId":0,"startMs":2300,"endMs":6780,"speaker":"A",…},{"turnId":1,"startMs":20140,"endMs":24220,"speaker":"B",…}]}`.
  Both expected onsets (2.13 s, 20.11 s) fall within 0.2 s.
- T8, from the mov: the same transcript, with turns at 2,060 ms and
  20,060 ms.
- T9, from the mp3: `{"transcript":"The Blue Llama counts to seven at the harbor.","audioDurationMs":3360,"turns":[]}`.

No response carries a usage, price or rate-limit field. The price receipt is
`audioDurationMs` rounded down to seconds, times $0.18 per hour, as the
pricing page states. The dashboard's "Audio transcription seconds" chart shows
0 for the period.

So D85.5's **Transcribe the sound** is offered only where a converter is on
the machine (D85.4), and never by sending the container.

**U16.** Muse Code 1.4.2 (`muse-bin-1.4.2-R4684.1`, build `b538db0a`) over
MSP, on the subscription with `muse-spark-1.3-contributor`, did not attach
the video. The `userMessage` item has no `attachments`. The model ran one
`search` tool call with `glob: ["**/clip.mp4"]`, which returned no visible
output, and then answered: "I received the text “@clip.mp4” plus your
instruction, no viewable video or audible soundtrack." MSP 1.4.2 defines
`TurnInputPart` as `text | image | skill`, so there is no video part either.

The trace counted 6 admitted model attempts, with no retries: 2 for the main
turn and 1 each for the `skill-reminder` (twice), `goal-reminder` and
`verify-reminder` children. This selects E3's **refusal** path on Muse Code:
a video attachment there is refused with the reason, until a Muse Code
release accepts one.

**U6c, storage billing.** One sentence: on 2026-10-08, three days after the
2026-10-05 uploads (7 explicit files up to 30 MB, and 250 server-saved copies,
each held for under 25 minutes), the billing dashboard showed a Pay-as-you-go balance of
**$0.00** with "No payment due at this time" and no line items, the Usage page
has no Files-storage metric at all, the published price list names no
storage rate, and the file-handling docs describe storage only as a 100 GiB
per-team quota.

- **Usage page.** Read signed in, read-only. A screenshot was kept outside
  the repository with the scratchpad records.
  - Muse Code Power Usage subscription: current usage <1%, weekly limit 36%.
  - Pay as you go, all API keys, all models, Oct 2 to Oct 8: Spend $0.00,
    and 0 for Input tokens, Output tokens, Requests, Images, Tool calls,
    Audio transcription seconds, Video frames segmented and Images
    segmented.
  - The page says: "Usage metrics are in limited availability. Any
    discrepancies will be resolved via credit adjustment."
- **Dashboard.** 0 requests, input tokens and output tokens; $0.00 spend;
  2 API keys.
- **Billing.** Subscription plan Muse Code. Pay as you go: current balance
  $0.00, next charge at $20.00 or Nov 1, 2026. The payment-method card on
  this page was not recorded, and its screenshot was deleted.

**The dashboard cannot show storage separately.** It also shows no usage at
all for the week, although round 3's 13 turns ran 25 minutes earlier. So this
is not a measured zero for storage. It is the absence of any storage meter,
rate or charge.

**D85.6 branch: not billed.** Uploads ask nothing beyond decision 7. No
`filesStorage` paid feature, storage-day tally or storage tariff is added.
Re-check this if Meta publishes a storage rate or the dashboard gains a
storage metric. The 100 GiB team quota and "uploaded files don't expire" are
the operational constraints, and both are covered by the always-set expiry
and the cleanup in D85.2.

**Decision recorded.** PLAN.md D85.6 carries the U6c decision (2026-10-08,
lead): the not-billed branch, the absence-of-meter caveat, and the release
re-check step. The U6c prerequisite that blocked production uploads is met;
what remains open is below.

## Calibration seeds

`docs/research/m105-captures/media-calibration-seeds.json` holds 23 points in
`MediaCostEstimator`'s stored format: `provider: "meta"`, `modelId`,
`variant`, `units`, `inputTokens`, `captureId` and `upperOnly: false`.
`variant` is `video` with `fps` null for the default, or an explicit number;
or `image` with a `detail`. For video, `units` is seconds; for an image it
is 1.

Every point is a single-media turn's complete reported input. That includes
the prompt, per the C lane's conservative convention.

| Model        | Video, default fps (s → tokens)                    | Video, `fps: 1`                        | Video, `fps: 2` | Image (any detail)                    |
| ------------ | -------------------------------------------------- | -------------------------------------- | --------------- | ------------------------------------- |
| 1.3 contrib. | 10 → 2,751; 30 → 8,207; 120 → 32,731; 600 → 85,531 | 30 → 8,207; 120 → 32,731; 600 → 85,531 | 30 → 8,207      | 4,086 at auto, low, high and original |
| 1.2 contrib. | 10 → 1,671; 30 → 4,967; 120 → 19,771; 600 → 53,131 | 30 → 4,967; 120 → 10,651; 600 → 53,131 | —               | 4,086 at auto, low, high and original |

- **Mixed turns.** The 50- and 51-image turns are not seeded. As
  `upperOnly` points they would only raise bounds, and the single-image
  points already cover them: 51 × 4,086 is at least the 4,636 bill.
- **Validation.** A throwaway Vitest run (not committed) loaded the file into
  the real `MediaCostEstimator`. Every point reproduced its own bill exactly,
  each upper bound was at least that bill, and every mixed round-2 bill fell
  under the summed per-item bounds.
- **Not seeded:**
  - documents, because no PDF page bill was captured;
  - Meta audio, because `input_audio` is ignored (U7) and transcription is
    billed by seconds, not by this estimator;
  - `fps` above 2;
  - images above 3000×2000.

  Under a cap, each of these stays a named refusal, as D85.6 requires.
  `MEDIA_ESTIMATE_SAFETY_FACTOR` is still for lane W to set.

## Round-1 evidence summary (lane M105-0)

`docs/research/meta-coverage-2026-10-05.md` §6 summarises round 1. Its raw
calls are now in `round1-2026-10-05.jsonl`.

| Capture               | Available finding                                                                                                                                                                                                    | Contract implication                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| U1, U2, U3, U17 count | About 170 input tokens regardless of video length, fps, image detail or image count; a 600-second video counted 169                                                                                                  | Never use this count as a media reservation                          |
| U3                    | 51 media were accepted at count time                                                                                                                                                                                 | Real turns accept 51 too (U3b); the client keeps its 50-media bound  |
| U4                    | 1.3 Contributor saw the 10-second clip but did not hear speech; 1.2 Contributor transcribed it                                                                                                                       | Soundtrack capability differs by model                               |
| U4 usage              | 2,751 input tokens on 1.3, 1,671 on 1.2, for a 10-second roughly 0.5 MB clip                                                                                                                                         | Seeded as the 10-second points                                       |
| U5                    | mp4 and mov accepted inline and uploaded; WebM refused                                                                                                                                                               | Sniffed mov is `video/quicktime`; conversion can be offered for WebM |
| U6                    | Multipart `purpose=user_data`, `expires_after[anchor]=created_at`, `expires_after[seconds]=3600`; `expires_at` returned; content SHA-256 matched; delete returned `deleted: true` and removed the file from the list | Always request expiry; cleanup is observable                         |
| U6b                   | `store: false` with `input_file` and an uploaded `file_id` worked                                                                                                                                                    | Stateless turns can replay upload references                         |
| U7                    | Inline wav/mp3 and uploaded wav were accepted by the count path; 1.2 said no audio arrived on a turn                                                                                                                 | No Meta `input_audio` dispatch is enabled                            |
| U11                   | `compact_threshold` below 1,000 refused; no compaction item with `store: false` and about 6.2k tokens                                                                                                                | Server compaction stays an evaluated arm                             |
| U14                   | Model list unchanged by `?client=`                                                                                                                                                                                   | Model names alone establish no modality bounds                       |

The test Files server accepts injected response frames. Lane F can now take
the exact U6 bodies from `round1-2026-10-05.jsonl` (upload, retrieve, list,
content and delete), and round 3's 404 `file_not_found` frames.

## Still open

- Vendor wire captures, before Gemini or compatible `video_url` codecs turn
  on (lane V).
- A PDF page bill, if PDF pages are to be estimated rather than refused under
  a cap.
- Dashboard attribution. The project's Usage and Dashboard pages show none of
  this key's traffic. Whether the key belongs to another project, or the
  metrics lag, was not explored, because team or project switching is a UI
  action beyond a read-only look.

## Upstream request drafts

Four drafts live in `docs/research/m105-upstream-*.md`, with title, body,
reproduction and expected behavior. No dedupe search, post or filing took
place: the lane brief permits local drafts only. The lead dedupes, files
through Meta's developer support or the appropriate tracker, and records
links here. Round 2 and 3 add evidence for two of them:

- the media-token-count draft now has billed usage to contrast with the
  count route;
- the video-soundtrack draft now has U18's container refusal.
