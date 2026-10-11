# M105 lane V (C-M105-4): vendor codec media refusals, plus R2 (RVCM1054)

Lane: C-M105-4, worktree `/home/randy/lanes/CM1054`, branch `c/m105-4`.
Base `68e6e7206` (the finished port of the accepted media work onto 0.17.1).
Lane V commit `0bf5172cd`; R2 commit `f1cc2723e`.
Scope kept to the lane's named files: `src/core/backends/modelapi/codecs/`
(chat, gemini, responses, anthropic, ollama, shared), plus the lane's own
test and docs. No shared hunks with sibling lane PORTM105R2 (attach path):
this lane touches no media-core, attach, ledger, schema or preset file.

## What this lane builds, and why only this

D85.1's vendor rows (Gemini Files/inline data, OpenAI `input_audio`,
vLLM/SGLang `video_url`) have no captured wire: the repository holds Meta
captures only (`docs/research/m105-captures/`, rounds U1-U7/U13/U14/U17/U18),
and AGENTS.md rules 13-14 forbid writing a row, parser or schema from a
guess. No live or paid call was made in this lane. The positive carry shapes
therefore stay unbound, and the gate keeps refusing them before dispatch
(`unknown` support refuses with "not known to take video/audio", D85.1).

What the lane completes instead is the codec stage of the same rule. R2
(RVCM1054) found lane V's codec stage incomplete in two ways and its record
inexact in three; all five are fixed here:

- P2-1: the chat/Gemini refusals threw a plain `Error`, which the
  production client (`streamResponse` in `src/core/providers/configured.ts`,
  rethrowing only `ChatCodecError` by name at `:772` and `RangeError`) replaced
  with "Models & Agents is not available in this build." Every encoder now
  throws the one typed refusal `ChatCodecError` (defined once in
  `codecs/shared.ts:174`, matched by name), carrying
  `UI_TEXT.media.videoUnknown` read from the installed table at call time.
  `configured.ts` is untouched: the client already passes this type through.
- P2-2: responses forwarded Meta's `file_id` shape to OpenAI/Azure/xAI and
  the ChatGPT subscription route, while Anthropic dropped the part and
  Ollama ignored it. `responses.ts:205` (replay path) and `:429` (ChatGPT
  route, which bypasses the replay mapping) refuse; `anthropic.ts:449`
  (entry scan, before effort validation) and `:551` (fail-closed conversion
  guard) refuse; `ollama.ts:322` refuses. Meta's own path never reaches
  these encoders (its delegate client encodes separately), so Meta's
  captured `file_id` shape still sends.
- P3-1: the "byte-identical around the refusal" test now compares full
  request bytes against inline goldens and fails when either refusal is
  removed (drills D1/D2 below).
- P3-2: the lane-V record's drill count, table quote and CHANGELOG sentence
  are corrected (see "Corrections to the lane-V record").
- P3-3: the five lead capture requests are rewritten so each runs as
  written (see "Lead capture requests").

Audio needs no codec change: the canonical schema carries no audio part
(`InputContentPart`, `src/core/backends/modelapi/schemas.ts`), a tool result
can hold only text and images, and Meta's media codec throws for audio, so no
encoder can receive an audio part; audio stays refused at the gate and routed
to transcription (U7, D85.5, unchanged).

`responses.ts` Meta concern (review finding 2): `createResponsesCodec`'s
`encodeRequest` is called in production only from `configured.ts:686`
(OpenAI, Azure, xAI and custom Responses servers) and
`subscriptions/registry.ts:250` (the ChatGPT subscription route). Meta models
resolve through the separate `meta` delegate client (`configured.ts:809`),
never through this encoder. No existing Responses codec test encodes a video
part, and the full Responses suites pass unchanged (see Evidence).

## Evidence

- `test/unit/vendorMediaCodecs.test.ts` (39 tests, repository timeout):
  - held video refused on openrouter-like and vllm-like chat quirks, golden
    `"qwen2-vl is not known to take video."` /
    `"some-model is not known to take video."`;
  - video-only, no-vision-flag and assistant-message video cases on chat;
  - held video refused on Gemini with vision true/false/absent, golden
    `"gemini-2.5-flash is not known to take video."`;
  - refusal read from the installed table (synthetic German template through
    `setUiText`, restored to English in `finally`) on all five encoders plus
    the ChatGPT profile;
  - image/text wire byte-identical: full chat `messages` and full Gemini
    request bytes pinned against inline goldens, with the video refusal
    asserted on both in the same test;
  - registry-driven matrix: one row per `PRESETS` route plus the
    ChatGPT-subscription route, each encoding text+video and video-only and
    asserting the typed refusal with the exact English sentence; a
    format-coverage test fails when a new format has no encoder, and a route
    test names the required non-Meta routes (openai, azure, xai, anthropic,
    ollama, openrouter, custom);
  - production-client proof per family (openrouter/chat, gemini, openai,
    anthropic, ollama) through `createConfiguredProviderServices` with real
    presets, catalog models and a counting fake transport: each rejects with
    the refusal's own sentence and sends zero requests; one German round
    proves the installed language arrives as itself; one round proves the
    generic unavailable error never surfaces;
  - composition through production stages on one sniffed clip: the real
    sniffer (`videoFixture` + `sniffMediaBytes`), the real gate
    (`modalityGate` over `metaMediaCapabilities`), and both real codec
    encodes agree on "not known to take video", while the captured Meta
    control (`muse-spark-1.3-contributor`) still admits the same clip.
- Owning suites green: `geminiCodec.test.ts` 67 passed,
  `modelapiChatCodec.test.ts` 92 passed (repository timeout, linuxlt).
- No new localization keys (`videoUnknown` in all 14 tables); no new
  command/setting/feature (no `featureCatalog.ts` change); no new
  dependency; `node scripts/check-l10n.mjs`: 14 UI tables, 14 usage tables,
  253 manifest strings, 1541 source files, 0 problems.
- ESLint `--max-warnings=0` on all seven touched files: clean. Prettier:
  clean. Unit typecheck (`tsc -p test/unit/tsconfig.json`): clean.

## Red drills (guard broken, failure seen, file restored byte-exact)

R2 drills, each against the committed `f1cc2723e` tree, running
`test/unit/vendorMediaCodecs.test.ts` (39 tests), file restored and SHA-256
verified equal to the pre-drill value, `git status --short` empty at the end:

- D1, `codecs/chat.ts`: `chatBlockFor` video restored to the placeholder
  return; 22 tests failed (both chat preset tests, video-only, no-vision,
  installed-table, byte goldens, composition, all 12 chat matrix rows, the
  openrouter production family, the German round, the generic-error round);
  restored to SHA-256
  `7eacdd39821e275e6855edf29ec92bdd25ea522d140e9aaf17e2c40c249823e8`.
- D2, `codecs/gemini.ts`: entry scan removed and `toNativeParts` restored to
  the placeholder push; 8 tests failed (3 Gemini vision tests,
  installed-table, byte goldens, composition, the gemini matrix row, the
  gemini production family); restored to SHA-256
  `1d94218074d9aa644ca2d2d1952f7f1c5973992dc280af0facfbb4c7418f243a`.
- D3, `codecs/responses.ts`: replay restored to `return part` and the ChatGPT
  scan removed; 6 tests failed (installed-table, the openai/azure/xai/
  chatgpt-subscription matrix rows, the openai production family); restored
  to SHA-256
  `9a385645da147d982cf7d1535adc094412f3d7c162f236fd3732bc79404df371`.
- D4, `codecs/anthropic.ts`: entry scan removed and the conversion restored
  to `return []`; 3 tests failed (installed-table, the anthropic matrix row,
  the anthropic production family); restored to SHA-256
  `8f2eb397c019e43759da1801636fecfc982c00525cb5a52bc7b30186a407a6e6`
  (verified equal to the pre-drill value at restore time).
- D5, `codecs/ollama.ts`: video check removed; 3 tests failed
  (installed-table, the ollama matrix row, the ollama production family);
  restored to SHA-256
  `6855675a83f638f11bddb815197e8e975e969c8042fce82599ac94930f7cd755`.
- D6, `codecs/chat.ts`: video refusal downgraded to a plain `Error` (same
  sentence); the 12 chat matrix rows (which assert the type) and the 3
  openrouter production rounds failed while the message-only codec tests
  still passed, proving the production tests own finding 1; restored to
  SHA-256 `7eacdd39821e275e6855edf29ec92bdd25ea522d140e9aaf17e2c40c249823e8`.
- Post-drill run: `vendorMediaCodecs.test.ts` 39 passed.

Lane-V drills, corrected: re-running the lane-V drill 1 (chat placeholder)
fails 5 tests, not 4 as first recorded (both chat presets, the video-only
case, the installed-table case and the composition case); drill 2's count
(five) was right. Both files were restored byte-exact at the time
(`39629a62…`, `8aab8f61…`).

## Corrections to the lane-V record (RVCM1054 P3-2)

- Drill count (`:65`): drill 1 fails five tests, not four (see above).
- Table quote (`:95`): the provider × modality table
  (`docs/certification/m105-m2-wire,-gate-and-replay-(a).md`, "Provider ×
  modality matrix") has no cell reading "off: no capture". Its non-Meta
  video cells read "off: selected record/codec evidence absent" (OpenAI,
  Anthropic, xAI, Custom), "off: vendor capture/codec binding" (Gemini),
  "off: selected route's capture/codec binding" (OpenRouter) and "off:
  served model's capture/codec binding" (Ollama/local).
- CHANGELOG sentence: "previously the placeholder" holds for a Chat
  Completions message holding an image and for Gemini, but not in general:
  at `0bf5172cd` both codecs already threw the model's reason at the codec
  stage (as a plain `Error` the client replaced). The entry now says so.
- Reviewer text+video sub-claim: the report states a Chat Completions
  message with text and a video "went through `textOfParts` and threw
  `execUnknownModel`". For user messages that path is unreachable at
  `0bf5172cd` (any video part diverts to the block path, and the base test
  "refuses a video-only message …" with body text+video expects the video
  reason and passes). It holds only for assistant/developer-role messages,
  which R2 now also refuses with the typed video reason (`chat.ts:331`,
  covered by the new assistant-message test).

## Lead capture requests (needed before the positive shapes can land)

Each needs an owner-authorized live turn on a contributor/test key, counted
and recorded as in §6 of the research record, with uploads deleted and
confirmed gone. Do not implement from documentation alone. Number of model
calls is stated first per item, as the project rule requires. Header NAMES
only, never values. Substitute a current catalog id where a named one has
retired, and record the exact id used.

1. Gemini video, inline path (2 model calls). Endpoint, verified in
   `codecs/gemini.ts:42-45`: `POST
https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse`
   (the product sends `streamGenerateContent`, not `generateContent`).
   Model: `gemini-flash-latest` (catalog id at time of writing). Header
   names: `x-goog-api-key`, `Content-Type`. Body (JSON): `{ systemInstruction:
{ parts: [{ text: "describe this clip" }] }, contents: [{ role: "user",
parts: [{ text: "describe this clip" }, { inlineData: { mimeType:
"video/mp4", data: "<base64 of a small mp4, under 1 MiB" } }] }] }`.
   Call 2 repeats with an `image_url`-style data URL video part if call 1
   refuses. Record per call: HTTP status, the full response bytes,
   `usageMetadata` (the pricing rows need it: input/output/cached counts),
   and the exact accepted mime set and byte limit from any error body.
2. Gemini video, Files path (4 model calls plus 2 management calls).
   Upload the same small mp4 through Google's Files API (confirm the exact
   upload request path from the live response; the product has no Files
   caller yet, so this capture defines it), then call 1's endpoint with
   `fileData: { mimeType: "video/mp4", fileUri: "<returned uri>" }` in place
   of `inlineData`. Repeat for a second mime (e.g. video/quicktime) only if
   the first succeeds. Record as in item 1, plus whether audio rides
   `inlineData`. Delete each upload through the Files delete call and confirm
   with a GET on the file resource (expect 404); record both statuses.
3. OpenAI Responses audio (2 model calls plus 2 management calls).
   Endpoint, verified in `src/core/providers/configured.ts:633`:
   `POST https://api.openai.com/v1/responses`. Model: `gpt-5.4` (catalog id
   at time of writing; must be an audio-input model — if it refuses, record
   the refusal and stop: that refusal shape is item 6's OpenAI row). Header
   names: `Authorization`, `Content-Type`. Body (JSON): `{ model:
"gpt-5.4", input: [{ type: "message", role: "user", content: [{ type:
"input_text", text: "transcribe this" }, { type: "input_audio", audio:
"<base64 of a short wav", format: "wav" }] }], instructions: "…",
stream: true }` (field names to confirm against the live error shape;
   record the exact accepted shape). Call 2 uses a file id from `POST
https://api.openai.com/v1/files` in place of inline bytes. Record per
   call: HTTP status, full response bytes, billed usage. Delete each file
   with `DELETE https://api.openai.com/v1/files/{file_id}` and confirm with
   a GET (expect 404); record both statuses.
4. OpenAI Chat Completions audio (2 model calls). Path pattern, verified in
   `src/core/providers/configured.ts:643` (`modelsList.path` with `models`
   replaced by `chat/completions`): `POST
https://api.openai.com/v1/chat/completions`. Model: `gpt-5.4` as in item 3. Header names: `Authorization`, `Content-Type`. Body (JSON):
   `{ model: "gpt-5.4", messages: [{ role: "user", content: [{ type: "text",
text: "transcribe this" }, { type: "input_audio", input_audio: { data:
"<base64 of a short wav", format: "wav" } }] }], stream: true }` (field
   names to confirm against the live error shape). Call 2 targets a model
   the catalog marks voice-incapable, if one is known; record whether it
   refuses and with what HTTP status and error body (a zod schema is written
   from that capture before any codec use).
5. vLLM/SGLang video (2 model calls, owner-hosted). Who hosts it: the owner
   on the lead machine. Server: a vLLM release the owner pins at run time
   (record the version); launch line recorded verbatim, e.g. `vllm serve
Qwen/Qwen2-VL-2B-Instruct --port 8000` (model id to confirm against what
   the server actually serves; the lane test uses `qwen2-vl` as the native
   id example). Endpoint (chat format, loopback preset, default port 8000
   per `presets.ts` vLLM row): `POST http://127.0.0.1:8000/v1/chat/completions`.
   Header names: `Content-Type` (plus `Authorization` only if served with
   `--api-key`). Body (JSON): `{ model: "<served id>", messages: [{ role:
"user", content: [{ type: "text", text: "describe this clip" }, {
video_url: { url: "data:video/mp4;base64,<small mp4" } }] }], stream:
true }` (URL forms — data vs http — to confirm against the live error
   shape). Call 2 repeats with an http(s) URL if call 1 succeeds, else with
   a second mime. Record per call: HTTP status, full response bytes, the
   accepted mime set and limits from any error body, and the server version.
6. Refusal shapes, one concrete request per vendor (5 model calls, one per
   row; each must refuse before inference). Same endpoints, methods and
   header names as items 1-5, with a held-video body (items 1/2/5) or a
   held-audio body (items 3/4) addressed to a model with no video/audio
   binding: OpenAI `gpt-5.4-nano`, Anthropic `claude-haiku-4-5` (`POST
https://api.anthropic.com/v1/messages`, header names `x-api-key`,
   `anthropic-version`, `Content-Type`), Gemini `gemini-flash-lite-latest`,
   xAI `grok-4.5` (`POST https://api.x.ai/v1/responses`), Ollama a local
   text-only model (e.g. `llama3.2` at `POST
http://127.0.0.1:11434/api/chat`, header name `Content-Type`). If a named
   model unexpectedly accepts the media, record the acceptance instead: it
   defines a capture need rather than a refusal shape. Record per call: HTTP
   status and the full error body (a zod schema is written from each before
   any codec use), plus billed usage where the vendor reports any.

Until these land, PLAN.md M105 acceptance 4 ("provider × modality table")
and the "Delivery b" checklist row stay open, correctly: the table's
non-Meta cells read as quoted above, and the codecs now say the same in the
user's language at the point of refusal.
