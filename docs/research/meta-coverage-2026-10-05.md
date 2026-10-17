# Meta Model API and Muse Code coverage audit (2026-10-05)

A read-only audit of what the Meta Model API and the Muse Code CLI/SDK offer
against what Muse Spark Code uses. It feeds PLAN.md D85/M105 (multimodal
input) and D86/M106 (agent-loop wire guarantees).

## Method and evidence

- **Sources.** Meta's public documentation (dev.meta.ai/docs), read with
  plain GETs; five API-reference pages that need a dev.meta.ai sign-in
  (Responses schemas, Files schemas and upload, Models schemas and list,
  Messages schemas) and the Muse Code changelog, each read once in a browser,
  read-only, and closed; the `@muse-code/sdk@1.4.2` type declarations from
  unpkg. The raw copies (the 1.4.2 `.d.ts`, the Responses schema text and the
  changelog) were kept outside the repository; nothing in them is private,
  and nothing from an account page beyond the published schema text was
  recorded.
- **No inference in the audit itself.** The audit made no model call, paid
  call, credential read or upload. The live captures that AGENTS.md rule 13
  requires (§5 lists them) ran later the same evening, with the owner's
  authorization, and §6 records what they found. Where §1–§4 rest on
  documentation and §6 contradicts it, §6 wins.
- **Refs.** Evidence lines are at `origin/release/train-0.14.0` @ `6baacdb77`
  (released as 0.14.0, now `main`). Also sampled:
  - M95 at `refs/rigs/kubuntu/m95/int` @ `ad13e83af` (bring-your-own codecs,
    not yet wired) and its lane branches;
  - M101 lane C2 at `refs/rigs/kubuntu/m101/c2` (overflow and automatic
    compaction, off by default);
  - M102 at `feature/m102-usage`.

  None of them adds video, audio, the Files API, `previous_response_id`,
  structured output, strict tools, tool search, computer use, rate-limit
  headers or spatial grounding.

- **Abbreviations.** Host = `src/core/backends/modelapi/ModelApiHost.ts`;
  schemas = `…/modelapi/schemas.ts`; client = `…/modelapi/client.ts`;
  const = `src/shared/constants.ts`. CAPAUDIT = the multi-vendor capability
  audit of the same day (its findings are carried by M95 lane N's
  `capabilityRecord.ts` and PLAN.md D81.2).

**Notes added by the lead.**

- The audit did not see M104 lane C's companion server (branch `m104/c`):
  the loopback companion page exists, with a one-use launch code in the URL
  fragment, a per-window bearer and no cookies. D84's all-editors ruling
  supersedes D30's "no web app of ours" for that loopback page.
- Strict tool schemas are already being built for M101 item 24 by its lane
  P2 fix lane (FIXM101P2: the strict-subset rewrite). M106 consumes that work.

## Ten biggest gaps

1. **Video is missing everywhere.** Meta takes mp4 as `input_video` (URL,
   data URI or `file_id`, with `fps`) or as an uploaded `input_file`, and the
   model also hears the audio track. `.mp4`, `.mp3` and `.wav` are refused;
   `.mov` and `.webm` silently become @mentions; paste and drop ignore them.
2. **No Files API.** Every PDF and image is re-sent as base64 on every tool
   round. Video needs an upload and a `file_id` (1 GiB per file, a 100 GiB
   pool, an expiry).
3. **Web search is unusable in VS Code.** `hasPaidDailyBudget` is always true
   there, so search is refused for "no verified limit"; Meta's
   `max_tool_calls` (unused) is the bound that would make it reservable.
4. **Strict tool schemas are never requested** (`strict: false` is a literal
   type), though Meta documents strict mode as its guarantee of valid
   arguments.
5. **Structured output is unused.** The reviewer, the judge, hooks and the
   verify loop parse free text.
6. **Screen recording does not exist anywhere.**
7. **Tool calls run serially, and streamed tool arguments are ignored.**
8. **Media cost estimates are far too high.** Capped sessions count media at
   one token per encoded byte (a 5 MB image is about 6.7 million "tokens"), so
   a video would block any capped session; the `input_tokens` pre-count is
   used only after compaction.
9. **Output is capped at 32,768 tokens** against Meta's recommended 131,072,
   and an `incomplete` reply for `max_output_tokens` is treated as final.
10. **The Muse Code SDK is pinned at 1.3.0** (1.4.2 is current). MSP has no
    video part, though the CLI's own `read_file` attaches MP4 and MOV. Unused:
    per-model effort tiers, `feedback/submit`, rate-limit headers, tool search
    and server compaction.

## 1a. Meta Model API inventory

Status words: _used_, _partial_, _missing_. Value and effort are the audit's
estimates. "Multi-vendor" names where the same capability exists elsewhere,
so a feature built for it is gated by capability (D81.2), never "Meta only".

| #   | Capability                 | Meta API                                                | Doc                        | Status                                                | Evidence (P)                                | Missing                                              | Value    | Effort | Multi-vendor                                    |
| --- | -------------------------- | ------------------------------------------------------- | -------------------------- | ----------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- | -------- | ------ | ----------------------------------------------- |
| 1   | Responses agent wire       | `POST /v1/responses`                                    | /docs/protocols/responses  | used                                                  | Host:3138-3167                              | —                                                    | —        | —      | OpenAI, xAI                                     |
| 2   | Stateless reasoning replay | `include` `reasoning.encrypted_content`, `store: false` | /docs/reasoning            | used                                                  | Host:3532-3536, 4347-4371                   | —                                                    | —        | —      | CAPAUDIT F1                                     |
| 3   | Server state               | `store: true` + `previous_response_id`                  | /docs/protocols/responses  | missing by design                                     | schemas:354                                 | optional mode, owner privacy ruling                  | Med      | M      | OpenAI, xAI                                     |
| 4   | Message phase              | resend `phase` on every assistant message               | Responses schemas          | partial (commentary only)                             | Host:4319-4327                              | resend `final_answer`                                | Med      | S      | OpenAI                                          |
| 5   | Reasoning effort           | minimal … max                                           | /docs/reasoning            | used                                                  | const:918-927                               | —                                                    | —        | —      | per model                                       |
| 6   | Summary profiles           | auto, concise, detailed                                 | /docs/reasoning            | partial (auto)                                        | Host:3160                                   | a detailed option                                    | Low      | S      | OpenAI                                          |
| 7   | Prompt caching             | `prompt_cache_key`, retention                           | /docs/prompt-caching       | used                                                  | promptCache.ts:23-28                        | —                                                    | —        | —      | OpenAI, Anthropic                               |
| 8   | Function tools             | name rules                                              | /docs/tool-calling         | used                                                  | schemas:325-331                             | —                                                    | —        | —      | all                                             |
| 9   | Strict schemas             | `strict: true`                                          | /docs/tool-calling         | **missing**                                           | schemas:330                                 | strict for harness tools and convertible MCP tools   | High     | S-M    | OpenAI, Anthropic, Gemini                       |
| 10  | `tool_choice`              | auto only on Responses                                  | /docs/tool-calling         | used                                                  | schemas:348                                 | —                                                    | Low      | —      | all                                             |
| 11  | Parallel calls             | `parallel_tool_calls`                                   | /docs/tool-calling         | partial: executed serially                            | Host:10094-10110                            | concurrent read-only calls                           | Med      | M      | all                                             |
| 12  | Streamed arguments         | `function_call_arguments.delta` / `.done`               | /docs/tool-calling         | **missing** (parsed, ignored)                         | schemas:210-215; Host:4016-4018             | a live preview of long writes                        | Med      | S-M    | OpenAI, Anthropic, Gemini                       |
| 13  | Custom freeform tools      | `type: custom`                                          | /docs/tool-calling         | missing                                               | —                                           | apply_patch-style tools                              | Low-Med  | M      | OpenAI                                          |
| 14  | Tool search                | `tool_search` + `defer_loading`                         | /docs/tool-search          | missing                                               | —                                           | defer MCP tools per server                           | Med-High | M      | Anthropic, OpenAI                               |
| 15  | Web search                 | `web_search` + options, $2.50 per 1,000                 | /docs/search-grounding     | partial, off in VS Code                               | Host:3321-3345; extension.ts:2297           | the `max_tool_calls` bound, options, sources         | High     | S-M    | Anthropic, OpenAI, Gemini, xAI                  |
| 16  | `max_tool_calls`           | caps hosted calls per response                          | Responses schemas          | missing                                               | —                                           | unblocks 15                                          | High     | S      | OpenAI, Anthropic                               |
| 17  | Structured output          | `text.format` `json_schema`, strict                     | /docs/structured-output    | **missing**                                           | schemas:343-361                             | reviewer, judge, hooks, verify, titles; headless     | High     | M      | all                                             |
| 18  | Images                     | `input_image`; 50 MB; 50 per request; `detail`          | /docs/image-understanding  | used (10 MiB, auto)                                   | Host:1595-1600; const:938-949               | `original` for screenshots; `file_id`; `.ico`        | Med      | S      | OpenAI                                          |
| 19  | PDF                        | `input_file` data, URL or `file_id`; `detail`           | /docs/file-handling        | used, inline only                                     | schemas:271-280                             | `detail: high`; `file_id`                            | Med      | S      | Anthropic, OpenAI, Gemini                       |
| 20  | Video and audio-in-video   | `input_video` / `input_file`; mp4; Messages video block | /docs/video-understanding  | **missing everywhere**                                | const:1017-1037; Composer.tsx:241-249       | all of §2                                            | High     | L      | Gemini, OpenRouter Gemini routes, local Qwen-VL |
| 21  | Audio                      | `input_audio` wav/mp3; degraded on 1.3                  | /docs/video-understanding  | missing                                               | acp/agent.ts:1173; mcp/functions.ts:405-407 | route to 1.2, or transcribe                          | Med      | M      | OpenAI, Gemini, Voxtral                         |
| 22  | Files API                  | `POST/GET/DELETE /v1/files`, `expires_after`            | /docs/file-handling        | **missing**                                           | mediaBudget.ts:4-8                          | upload once, `file_id` replay, lifecycle             | High     | M      | OpenAI, Anthropic, Gemini                       |
| 23  | Token pre-count            | `POST /responses/input_tokens`                          | /docs/token-counting       | partial (after compaction)                            | client:505-512; sessionBudget.ts:5-15       | pre-count media                                      | Med-High | S      | OpenAI, Anthropic, Gemini                       |
| 24  | Voice Transcribe           | realtime + batch `/v1/asr/transcribe`                   | /docs/speech-to-text       | partial (realtime only; not on the Model API backend) | extension.ts:2963-2975                      | batch for attached audio                             | Med      | M      | Whisper, Gemini                                 |
| 25  | Muse Image                 | generations, edits, `n`, `reasoning_strength`           | /docs/image-generation     | used (`n=1`); result not shown to the model           | imageGeneration.ts:276-328                  | `n>1`, `reasoning_strength`, image back to the model | Low-Med  | S      | OpenAI, Gemini, xAI                             |
| 26  | Spatial grounding          | 0–1000 points and boxes                                 | /docs/image-understanding  | missing                                               | —                                           | an overlay on screenshots                            | Med      | M      | Gemini `box_2d`                                 |
| 27  | Computer use               | `computer` tool                                         | /docs/computer-use         | missing                                               | —                                           | browser UI verification                              | Low-Med  | L      | OpenAI, Anthropic, Gemini                       |
| 28  | Server compaction          | `context_management` compaction                         | Responses schemas          | missing                                               | Host:10583-10599                            | an evaluated arm                                     | Med      | M      | OpenAI, Anthropic                               |
| 30  | Background mode            | `background: true`                                      | /docs/protocols/responses  | missing                                               | execFetch.ts:134                            | needs `store: true`                                  | Low-Med  | M      | OpenAI                                          |
| 32  | Output cap                 | 131,072 recommended                                     | /docs/coding-agents        | partial, 32,768                                       | const:1597; Host:3988-3993                  | raise; continue automatically                        | Med      | S      | per model                                       |
| 33  | `safety_identifier`        | hashed user id                                          | /docs/protocols/responses  | missing                                               | —                                           | a hashed install id                                  | Low      | S      | OpenAI, Anthropic                               |
| 34  | `metadata`                 | key-value pairs                                         | Responses schemas          | missing                                               | —                                           | tag side calls                                       | Low      | S      | OpenAI, Anthropic                               |
| 36  | Rate-limit headers         | `x-ratelimit-*`; Contributor 100 RPM                    | /docs/pricing-rate-limits  | missing (M102 plans storage)                          | —                                           | show; pace fan-out                                   | Med      | S      | OpenAI, Groq, Anthropic                         |
| 37  | Retry                      | 429/5xx with jitter                                     | cookbook                   | used                                                  | client:176-186                              | 504 is not retried                                   | Low      | S      | all                                             |
| 38  | Models list                | `?client=` metadata                                     | /docs/api-reference/models | used (ids)                                            | client:493-502                              | `?client=`; a static modality table                  | Low      | S      | CAPAUDIT F12                                    |
| 39  | Status                     | `GET /v1/status`                                        | API reference              | missing                                               | —                                           | diagnostics                                          | Low      | S      | —                                               |
| 43  | Muse Glimmer open weights  | vLLM, SGLang, llama.cpp                                 | /docs/overview             | partial (M95 presets, not wired)                      | —                                           | a named preset                                       | Low-Med  | S      | local                                           |

## 1b. Muse Code CLI and SDK

| #   | Capability             | Status                                                                                                       | Missing                                                                                              | Value   | Effort |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------- | ------ |
| 44  | SDK version            | 1.3.0 pinned (package.json:1229); 1.4.2 current                                                              | the bump; `feedback/submit`, `session/delete`, `deleteCompleted`, `session/started`/`closed`         | Med     | S      |
| 45  | MSP methods            | broad use (MuseCodeHost.ts:533, 1093-1184)                                                                   | `feedback/submit`; workflow controls; subagent reopen                                                | Med     | S-M    |
| 46  | Per-model effort tiers | missing                                                                                                      | `model/list` `variants`, `reasoningEffortVariants`, `defaultReasoningEffort` in the picker           | Med     | S      |
| 48  | Video in Muse Code     | MSP `TurnInputPartType` is text, image or skill (1.4.2 `.d.ts`:2039); the CLI's `read_file` attaches MP4/MOV | an upstream request for a video/file part (dedupe against sdk#48); render video content in tool rows | High    | S      |
| 49  | `exec --output-schema` | not applicable to `serve`                                                                                    | mirror it in the headless runtime                                                                    | Low-Med | S      |
| 50  | `MUSE_TRANSPORT_TRACE` | missing                                                                                                      | a diagnostics opt-in                                                                                 | Low     | S      |
| 51  | `feedback/submit`      | missing                                                                                                      | thumbs up or down to Meta                                                                            | Low-Med | S      |

The 1.4.2 changelog also records that Muse Code itself skips a video attached
to a model that cannot take video "with an inline note" and continues, and
that its `/delete` keeps video-enabled sessions with an explanation. The
harness's own rule after a model switch (D85) follows the first behaviour.

## 2. Video, audio-in-video, documents and screen recordings

### 2.1 Meta's wire (documented; captures pending)

- **Video.** `{"type":"input_video","video_url":"https://…|data:video/mp4;base64,…","file_id":"file-…","fps":n}`
  or `{"type":"input_file","file_id":…}`. `video/mp4` only; 50 MB inline, 1 GiB
  through Files. The model reads the embedded audio ("visual description and
  a transcript … in one call"). The Messages API has a `video` block with
  `fps`. Not documented: the maximum duration, the default fps and the tokens
  per second.
- **Audio.** `input_audio` `{data, format: wav|mp3}`, `audio_url` or
  `file_id`. Degraded on Muse Spark 1.3 (use 1.2, or Voice Transcribe);
  `max_output_tokens` at least 4,000.
- **PDF.** `input_file` with `file_data`, `file_url` or `file_id`; `detail`
  `low` (default) or `high`. Text from the first 100 pages; the first 50 page
  images count toward the 50-image limit. DOCX and CSV are not supported.
- **Images.** png, jpeg, gif, webp, x-icon; 50 MB; 50 per request; `detail`
  `low`, `high`, `auto` or `original`.
- **Files API.** Multipart `file`, `purpose: user_data`, `expires_after`
  `{anchor: created_at, seconds: 3600..2592000}` →
  `{id: "file-<n>", bytes, created_at, expires_at, filename, purpose}`; list,
  retrieve, content and delete. Files persist indefinitely unless an expiry
  is set. The storage price is not documented.

### 2.2 The harness today

- **VS Code.** The picker has no type filter (extension.ts:2530-2534). The
  host handler (conversationController.ts:7556-7662) refuses `.mp4`, `.mp3`
  and `.wav` (`binaryFileUnsupported`, const:1017-1037) and silently turns
  `.mov`, `.webm`, `.m4a` and `.ogg` into @path mentions. Paste and drop keep
  only `image/*`, PDF and text (Composer.tsx:241-249), with no banner.
  `AttachmentStore.add` gates by backend kind only.
- **Wire.** Images are data-URL `input_image` with `detail: auto`; PDFs are
  inline. `read_file` and browser media travel in a separate user message
  (Host:5197-5232). Every request re-sends all retained media, trimmed by
  `MediaBudget.fit`.
- **ACP.** `promptCapabilities` is `{image: true, audio: false}`; audio blocks
  are refused (translate.ts:569-571). **Bug:** an embedded resource's `blob`
  is always treated as an image (translate.ts:567), so a PDF or video blob
  gets "Only PNG, JPEG, GIF and WebP…". A `resource_link` becomes an
  @mention.
- **Headless.** No `--attach`, `--image` or `--file` (cliArgs.ts:149-200).
- **Tools.** `read_file` picks PDF or image by extension, and `.mp4` fails as
  text (tools.ts:992-999). MCP audio is replaced by a text note. The browser
  check returns PNG screenshots. Nothing uses `getDisplayMedia`,
  `MediaRecorder` or `desktopCapturer`.
- **Muse Code backend.** Images only; PDFs are refused
  (MuseCodeHost.ts:451-478).
- **Cost.** Media is counted at its encoded size, one token per byte
  (sessionBudget.ts:5-15).

### 2.3 Proposed design (adopted by D85)

1. **Sniffing and limits** (`src/core/attachments.ts`, a new
   `src/core/media/`). mp4 through the ISO-BMFF `ftyp` box, duration from
   `moov/mvhd`, an audio track through `hdlr` = `soun`, with no dependency.
   mov, webm and mkv are refused with a conversion hint (the optional
   `avconvert` on macOS, or an `ffmpeg` already on PATH; never bundled). wav
   and mp3 sniffers. Limits: 1 GiB upload maximum, 200 MB default, 50 MB
   inline; duration and media-budget rules after captures U2 and U3.
2. **Files API client** (client.ts). Streamed multipart with progress and
   abort; `purpose: user_data`; an expiry setting (default 7 days). Per
   session, sha256 → `{fileId, expiresAt, bytes, name, mime}` in the session
   store (fork and rewind reuse it). Not found on replay → re-upload once
   after a hash check, else a named refusal. Deleted with the session and by
   `cleanupPeriodDays`. An "Uploaded files" list in Account & usage with the
   total against 100 GiB. `file_id` also for large PDFs and long-lived images,
   which ends the per-round base64 re-sends.
3. **Wire** (schemas.ts). `InputVideoPart {file_id, fps?}`, `InputAudioPart`;
   `file_id` and `detail` on file and image parts; existing goldens
   byte-identical; a per-chip video detail that sets fps.
4. **Capability gate** (CAPAUDIT's modalities record). Meta 1.1–1.3: video
   yes; audio warned on 1.3 (offer 1.2, or transcribe). BYO Gemini yes;
   OpenAI, Anthropic and xAI no. Refuse before sending, with a named reason.
   After a model switch, replace a replayed video with a one-line note.
5. **Cost.** `input_tokens` pre-count with the `file_id`; a chip such as
   "2:14 · 38 MB · sound · ~N tokens · $x Standard / $y Contributor"; D78 and
   the session reservation from counted tokens; a Contributor warning that
   Meta may train on the recording.
6. **Entry points** (every editor equal). VS Code picker, drop and paste (a
   path or URI token; the host streams the file); ACP `resource_link` and
   blob resources by `mimeType` (fixing the bug), audio blocks,
   `promptCapabilities.audio: true`, `/attach <path>`; headless `--attach`
   (repeatable); `read_file` returns mp4, mp3 and wav behind the existing
   confinement and approval; the Muse Code backend refuses until MSP has a
   part (upstream request; video content previewed in tool rows); the
   companion page uses the same upload path.
7. **Screen recording** (`museSpark.attachScreenRecording`, ACP `/record`).
   macOS: a Swift helper over `screencapture -v` (`-G` for audio), then
   `avconvert` to mp4. Windows: "attach latest" from the Snipping Tool's
   `Videos\Screen Recordings` (mp4), plus an optional
   Windows.Graphics.Capture helper. Linux: the newest file in
   `~/Videos/Screencasts`, or the xdg-desktop-portal ScreenCast. The companion
   page: `getDisplayMedia` and `MediaRecorder` where supported.
8. **History, rewind, fork and export** keep metadata and the `file_id`,
   never bytes.
9. **Docs.** PRIVACY (uploads persist at Meta until they expire or are
   deleted; contributor training), and a README modality matrix per backend
   and model.

## 3. The agent loop against Meta's guidance

**Matches.** Responses only; encrypted reasoning replayed on every call,
compaction, hooks and the reviewer included; replay ordering and call ids;
retries with jitter and a resend after a dropped stream; effort high by
default; the 1,048,576-token window; `tool_choice: auto` with instruction
steering.

**Gaps.**

- **P1.** Strict schemas (schemas:330; harness tools already set
  `additionalProperties: false` at tools.ts:592-603; make every key required
  and optional ones nullable). Structured output for machine-read side calls
  (reviewerEntry.ts:171-182, modelApiSameJudge.ts:85-105,
  hookModelEntry.ts:216-227; `text.format` `json_schema` strict works with
  tools). The `max_tool_calls` bound.
- **P2.** Concurrent read-only calls returned in call order (writes, shell,
  approvals and hooks stay serial). Streamed-argument previews (never execute
  before `.done`). Output cap 131,072 plus one bounded continuation on
  `response.incomplete`. Rate-limit pacing (Contributor's 100 RPM against
  subagents, best-of-N and teams). Tool search for MCP (keeps the cache
  prefix).
- **P3.** A stuck guard (hash of tool name and arguments; stop after three
  repeats). Resend the `final_answer` phase. Server compaction as an untested
  arm (U11).

## 4. Priorities

- **P1.** Video and audio-in-video through the Files API from every editor;
  the Files API lifecycle; web search under a spend cap through
  `max_tool_calls`; screen recording; strict tools; structured output and
  headless `--output-schema`.
- **P2.** Streamed-argument previews; concurrent read-only calls; output cap
  131,072 and continuation; rate-limit headers and pacing; tool search for
  MCP; audio files (Voice Transcribe batch, or `input_audio` on 1.2; recheck
  the Muse Voice gate); Muse Code SDK 1.4.2 with effort variants, feedback,
  workflow controls and the upstream video request; detail controls; the media
  `input_tokens` pre-count; the server compaction arm; the ACP blob
  `mimeType` bug.
- **P3.** A spatial-grounding overlay; the stuck guard; the `final_answer`
  phase; `safety_identifier`, `metadata` and `/v1/status`; Muse Image extras
  (`n>1`, `reasoning_strength`, the image back to the model); computer use;
  background mode and `store: true` (an owner ruling); detailed summaries.

**Proposed lanes, as the lead renumbered them** (PLAN.md has the final
lanes):

- M105 (multimodal): Files API; media core; entry points in every editor;
  screen recording; cost.
- M106 (loop guarantees): strict tools (already in FIXM101P2); structured
  output; hosted-tool bounds (`max_tool_calls`, search re-enabled under the
  cap); loop UX and throughput (previews, concurrent reads, 131,072 and
  continuation, the repeat guard, `final_answer`); limits and health
  (rate-limit headers, pacing, `/v1/status`, the 504 retry).

Not planned by M105 or M106, and still recorded here: tool search for MCP
(item 14), spatial grounding (26), computer use (27), server compaction (28,
only as an evaluated arm), background mode and server state (3, 30; need an
owner privacy ruling), custom freeform tools (13), `safety_identifier` and
`metadata` (33, 34), Muse Image extras (25) and detailed summaries (6).

## 5. Captures needed (as planned before the run)

What ran and what it found is §6; what is still to run is in PLAN.md M105's
step 1.

On the contributor model (`muse-spark-1.3-contributor`, plus 1.2 for audio),
in an empty workspace, with throwaway media only: about ten short inference
turns, plus a few uploads and deletions that make no inference call. Each is
counted from the trace log afterwards (CLAUDE.md).

| Id  | Capture                                                                                 | Decides                                                  |
| --- | --------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| U1  | `input_tokens` with a video `file_id`: a 10 s mp4 at the default fps and `fps: 1`       | the pre-count and the chip's token figure                |
| U2  | the maximum duration, the inline limit and their error texts                            | the duration and size limits                             |
| U3  | a video against the 50-media limit                                                      | the media budget's slots                                 |
| U4  | audio-in-video on 1.3 against 1.2                                                       | the audio warning                                        |
| U5  | where and how `.mov` and `.webm` are refused                                            | the refusal text and the conversion hint                 |
| U6  | `expires_after`, `store: false` with a `file_id`, storage billing, the content endpoint | the expiry default and whether storage is a paid feature |
| U7  | `input_audio` inline against `file_id` on 1.2                                           | the audio part                                           |
| U8  | `max_tool_calls` bounding the `web_search_call` count                                   | the search reservation                                   |
| U9  | `strict: true` with streaming; the 400 text for a bad schema                            | strict tools and their refusal                           |
| U10 | `json_schema` strict with tools and effort minimal                                      | structured side calls                                    |
| U11 | `context_management` compaction with `store: false`                                     | whether a server-compaction arm can exist                |
| U12 | `x-ratelimit-*` on a streamed Responses call                                            | pacing                                                   |
| U13 | whether `phase: final_answer` is ever returned                                          | the phase resend                                         |
| U14 | `GET /v1/models?client=`                                                                | the modality table                                       |
| U15 | the batch endpoint (documentation only)                                                 | nothing yet                                              |
| U16 | `@clip.mp4` over MSP in Muse Code 1.4.2                                                 | the Muse Code backend's video path                       |
| U17 | `detail: original` on 1.3, and its token delta                                          | the screenshot detail                                    |

## 6. Live captures (2026-10-05, about 17:40 PT)

Run with the owner's authorization, on contributor models only, with
throwaway media.

- **Calls.** 9 inference calls (`POST /responses`), one of which (U9's invalid
  schema) was refused with a 400 before inference; 36 calls that inferred
  nothing.
- **Uploads.** 4, all deleted and confirmed absent afterwards.
- **Raw records.** Kept outside the repository and scrubbed (no key, no
  `Authorization` header). M105's lane 0 turns them into fixtures in
  `docs/certification/m105-captures.md`.
- **Models listed by `GET /v1/models`.** The list is the same with or without
  `?client=vscode|muse-code`:
  - sam-3.1, muse-voice-transcribe-1.0, muse-image-1.0;
  - muse-spark-1.3, muse-spark-1.3-contributor;
  - muse-spark-1.2, muse-spark-1.2-contributor;
  - muse-spark-1.1.
- **Rate limits.** The contributor key showed 150 requests and 3,000,000
  tokens per minute. `x-ratelimit-limit-requests`,
  `x-ratelimit-remaining-requests`, `x-ratelimit-limit-tokens` and
  `x-ratelimit-remaining-tokens` appear on every response, streamed or not.

### 6.1 Upload and storage

| U   | Finding                                                                                                                                                                                                                                                                                                                                            | Consequence                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| U6  | The Files API works. Upload is multipart with `purpose=user_data`, and the expiry goes as the bracket-form fields `expires_after[anchor]=created_at` and `expires_after[seconds]=3600`. Retrieve, list, content and delete all work. Content round-trips byte-exact (SHA-256 match). Delete returns `deleted: true`, and the file no longer lists. | M105 uses exactly this wire. Expiry is honoured: `expires_at` is set.                                                  |
| U6b | A `store: false` turn with the uploaded video as an `input_file` `file_id` works.                                                                                                                                                                                                                                                                  | Stateless replay can reference a `file_id`.                                                                            |
| U5  | **mp4 and mov are accepted**, both by upload and inline (`data:video/quicktime`). **WebM is refused** at upload ("Unsupported file type: `video/webm`. Supported: images, video, audio, PDF, plain text, JSON, and JSONL.") and inline ("unsupported media type … Supported: MP4").                                                                | Accept mp4 and mov. Refuse WebM and Matroska with a conversion hint. The documentation says "mp4 only", but mov works. |
| —   | After our deletes, the account's file list still held other files, none of them ours (earlier Muse Code or other use).                                                                                                                                                                                                                             | M105's "Uploaded files" view shows the account's files, marks ours, and totals them.                                   |
| —   | Storage billing could not be read from the API.                                                                                                                                                                                                                                                                                                    | Read from the billing dashboard after a day with uploads (M105's U6c).                                                 |

### 6.2 Token counting

| U               | Finding                                                                                                                                                                                                                                          | Consequence                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1, U17, U3, U2 | **`POST /responses/input_tokens` does not count media.** Every video, image, fps and detail variant counts about 170 tokens, the same as the text-only prompt. The same holds for 49 images plus a video (223) and for a 600-second video (169). | The pre-count is useless for media. Estimate media tokens from calibrated real usage, reserve the worst case in D78's and the session's budgets, and settle from actual usage. Upstream request 1. |
| U3              | 51 media in one count request were not refused by the count endpoint.                                                                                                                                                                            | The 50-media limit is not enforced at count time. Enforce it client-side, and check a real turn later (U3b).                                                                                       |

### 6.3 Media understanding

| U   | Finding                                                                                                                                                                      | Consequence                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U4  | **muse-spark-1.3-contributor did not hear the speech** in a 10-second mp4 ("No speech is audible") but saw the video. **muse-spark-1.2-contributor transcribed it exactly.** | For audio in video, route to 1.2 or transcribe first. The capability record says 1.3 takes video but does not hear its soundtrack. Upstream request 2.                                                    |
| —   | Billed usage for the 10-second, 0.5 MB clip: 1.3 billed **2,751 input tokens** (about 2,580 for the video); 1.2 billed 1,671.                                                | The media estimator's first calibration points. More lengths are captured later.                                                                                                                          |
| U7  | `input_audio` (inline wav and mp3, and an uploaded wav) is counted. On a 1.2 turn, the **model said it received no audio**: `input_audio` is silently ignored.               | Standalone audio cannot go through `input_audio` today. Use Voice Transcribe's batch endpoint, or wrap the audio in an mp4 with a still frame for 1.2 (U4 shows 1.2 hears mp4 audio). Upstream request 3. |

### 6.4 Agent-loop features

| U   | Finding                                                                                                                                                                                                               | Consequence                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| U8  | **`max_tool_calls: 1` bounds `web_search_call` to exactly one.** The model said a second search could not run.                                                                                                        | M106: bound hosted search per response and reserve searches × price in D78's budget, so search can run in VS Code under a cap.  |
| U9  | Strict tools stream normally: `function_call_arguments.delta` events (two) arrive, then `.done`. An invalid strict schema gets an immediate 400: "'additionalProperties' is required to be supplied and to be false." | M106's strict schemas and argument previews are confirmed.                                                                      |
| U10 | `text.format` `json_schema` strict works **with a function tool present**, at effort minimal; the JSON parses and matches the schema.                                                                                 | M106's structured output for side calls is confirmed.                                                                           |
| U11 | `context_management` compaction: `compact_threshold` must be at least 1,000. With `store: false` and a 6.2k-token input, no compaction item came back, though the answer was correct.                                 | Inconclusive. Server compaction may need `store: true` or larger inputs. It stays an evaluated arm only, after another capture. |
| U13 | The only `phase` value seen was `commentary`, and most messages carried none. `final_answer` was never returned.                                                                                                      | Resend a phase when present; nothing to do for `final_answer`.                                                                  |
| U14 | `?client=` changes nothing.                                                                                                                                                                                           | —                                                                                                                               |

**Not run:** U15 (batch is documentation only), U16 (the Muse Code CLI, run
separately), and storage billing (dashboard only).

### 6.5 Upstream requests to Meta's Model API (to file, deduped first)

1. `POST /responses/input_tokens` should count image, video, audio and PDF
   tokens.
2. muse-spark-1.3 does not hear audio in video; 1.2 does.
3. `input_audio` parts are silently ignored on muse-spark-1.2-contributor,
   while the count endpoint accepts them.
4. Document mov support, or reject it consistently. Document the minimum
   `compact_threshold` (1,000) and whether `store: false` supports
   compaction.

PLAN.md D85.15 makes each one a task in M105's lane 0.

## Sources

- dev.meta.ai/docs: overview, models, pricing-rate-limits, tool-calling,
  tool-search, search-grounding, image-understanding, image-generation,
  speech-to-text, video-understanding, media-segmentation, file-handling,
  reasoning, structured-output, prompt-caching, token-counting, protocols
  (responses, chat-completions, messages), computer-use, coding-agents,
  agent-frameworks, and the cookbook (basic-agent-loop,
  interleaved-reasoning-tool-use, multi-turn-context-management,
  error-handling-retry).
- The signed-in API reference: responses/schemas, files/schemas,
  files/upload-file, models/schemas, models/list-models, messages/schemas.
- Muse Code: muse-code, workflows, session-messaging and the changelog;
  github.com/meta-models/muse-code-sdk; npm `@muse-code/sdk` 1.4.2.
- Context: developer.meta.com/ai/resources/blog/build-with-muse-spark/ and
  research.meta.ai/blog/multimodal-intelligence-of-muse-spark-1-2.
