# M105 lane V (C-M105-4): vendor codec media refusals, plus R2 (RVCM1054)

Lane: C-M105-4, worktree `/home/randy/lanes/CM1054`, branch `c/m105-4`.
Base `68e6e7206` (the finished port of the accepted media work onto 0.17.1).
Lane V commit `0bf5172cd`; R2 commit `f1cc2723e`; R3 commit `e5ea171b7`
(RVCM1054B: every finding fixed as a class, drills D-R3-1…D-R3-5 below).
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

R3 drills (RVCM1054B, each against the committed `e5ea171b7` tree, file
restored and SHA-256 verified equal to the pre-drill value):

- D-R3-1, `providers/subscriptions/registry.ts`: the codec-refusal branch
  replaced with `if (false)`; the 2 ChatGPT subscription tests (EN, DE)
  failed with the generic retry event instead of the refusal sentence, the
  Copilot leg still passed (it already yielded `error.message`). Restored to
  SHA-256 `ca90e2f80ee5376646c82fb18bb53664b519f4c427f2dcd7a455ec1c63edb329`.
- D-R3-2, `acp/agent.ts`: the `RequestError` mapping line removed; the ACP
  codec test failed with `got 'Internal error'`, proving the SDK
  generalizes a raw start failure (the second instance of the P2 class,
  found by this lane's own sweep). Restored to SHA-256
  `cf3b26389b682b97b470776bd986e453fc4d81c968c68926a052dd2b7d3788e1`.
- D-R3-3, `codecs/chat.ts`: the assistant-role refusal downgraded to a plain
  `Error` (same sentence). The strengthened assistant-message test (which
  now pins the type, since a plain `Error` there would become the generic
  unavailable message in the production client) failed with `expected a
codec refusal`; message-only tests still passed. Restored to SHA-256
  `f2ecaeae4e169891bb1d71a194f72661720de1b4b69b691d195da42eb20a1045`.
- D-R3-4, `vendorMediaCodecs.test.ts`: the `PLAN_KEY_PRESETS` rows dropped
  (a route without a row). The coverage guard failed with `mistral-plan:
expected false to be true`. Restored to SHA-256
  `f89ed3412ccd20e08b4e437c5d004d0c8fb88926d122a55a4e75d5a5024f9fd0`.
- D-R3-5, this record: one body key unquoted. The fenced-JSON test failed
  with `Expected property name or '}' in JSON`, the same error the review
  used to confirm the finding. Restored to SHA-256
  `84f0194ec658c25aef7566591bdfa996711244566e33db7417ee699c5a3bff8a`.
- The four removed `unknown`-to-`Error` casts (two cited, two pre-existing
  siblings in `configuredProviders.test.ts` and `modelapiChatCodec.test.ts`)
  are narrowed with `instanceof`, verified by `typecheck:unit`,
  `typecheck:host` and zero-warning ESLint; `grep -n "as Error"` over the
  four test files is empty, so no AGENTS.md rule 4 register entry is owed.
- Post-drill run: `vendorMediaCodecs.test.ts` 46 passed.

R4 (RVCM1054C: 1 P2, 5 P3; reviewer notes RVCM1054C.notes.md beside the
report). Every finding fixed as a class, no residuals. The lane's files
only: `src/host/providers/copilotClient.ts`, `src/acp/agent.ts`,
`test/unit/copilotClient.test.ts`, `test/unit/vendorMediaCodecs.test.ts`,
`test/unit/acpAgent.test.ts`, `test/unit/execRun.test.ts`, this record, the
changelog. No new dependency, no guard widened, no l10n key added or
changed (`formatUnsupported` and `videoUnknown` already in all tables).

- P2, the Copilot leg (`copilotClient.ts:160-176`): `content()` had no
  codec — any non-text part fell to `fail('unsupported-content')`, which
  the production wiring reads as the generic "Copilot models are
  unavailable" text. A held video now throws the shared typed refusal with
  `UI_TEXT.media.videoUnknown` for the model, and an image the model cannot
  take (no vision, or another provider's held file with no URL to send)
  throws it with `UI_TEXT.media.formatUnsupported` (`format: 'image'`), the
  gate's own image sentence shape — both before any request. The refusal
  also passes through `countInputTokens` and `streamResponse` unmapped
  (`:264`, `:409`). Proven through the client `connectCopilotFromClick`
  returns (fake VS Code port only): `copilotClient.test.ts` refuses a held
  video in English and German asserting the sentence with `sendRequest` and
  `countTokens` never called, and the former unsupported-image case now
  asserts the model's own sentence; `vendorMediaCodecs.test.ts` drives the
  real client behind the real subscription client, asserting the error event
  is exactly the sentence with zero Meta sends, zero subscription sends, no
  `sendRequest`, no `countTokens`, no usage recorded.
- P3, ACP (`acp/agent.ts:897-900`, `:1971-1976`): the R3 branch guarding a
  `sendTurn` rejection with `ChatCodecError` is DELETED as unreachable —
  the real Model API session's `submitTurn` (`ModelApiHost.ts:15126-15186`)
  starts `runTurn` detached and resolves, rejecting only for a disposed
  session, a refused child task, the text-attachment budget or a stale git
  draft; a codec refusal fails the turn as `turnCompleted` with
  `reason = describe(error)` (`ModelApiHost.ts:14055`), settled before this
  range at `settle`. Nothing else throws `ChatCodecError` into a session:
  the Copilot client (the only other thrower) sits behind the subscription
  client's catch, which yields the error event there. The rewritten
  `acpAgent.test.ts` case drives the REAL agent with the REAL chat encoder
  producing the sentence (no hand-built error) and a session double that
  replays only the real session's observable contract (sendTurn resolves,
  then failed `turnCompleted` with the sentence as reason): the prompt
  rejects with exactly `Internal error: gpt-6-astra is not known to take
video.` The editor therefore shows the sentence under the SDK's fixed
  "Internal error: " prefix — today's shape for every failed turn at ACP,
  left for the lead to rule on.
- P3, exec (`execRun.test.ts`, in `M105 headless attachment entry`): a
  codec refusal through the real run — real `runExec`, real in-process ACP
  agent, real runtime backend/host, real tap and ledger — with only the
  turn's model call doubled as in the ACP case and the sentence from the
  real encoder. The result carries the sentence in both `error.message`
  (`Internal error: <sentence>`, kind `failed`) and `incompleteReason`,
  `terminal: 'failed'`, exit code 4 per the exec contract, ledger
  `usage.requests` 0, zero `/responses` dispatches (the only fetch is the
  `/models` catalogue lookup at session setup), zero response bodies.
- P3, zero requests: every refusal assertion now counts. Configured
  families and mistral-plan assert the counting transport sent 0; ChatGPT
  leg asserts subscription sends 0 and Meta requests 0; Copilot leg asserts
  both plus `sendRequest`/`countTokens`/usage untouched; Meta passthrough
  asserts both legs 0; the accounting case asserts `daily.reserve` never
  called, ledger requests 0, no refusal/started/settled callbacks and zero
  Meta requests; ACP asserts one `sendTurn` and no other provider exists
  behind the contract replay (the sentence is pure encode, no transport);
  exec asserts ledger requests 0, no `/responses` dispatch, no bodies.
- P3, route matrix: the guard now compares the covered set against the
  written-out `EXPECTED_ROUTES` (19 registry routes plus both subscription
  legs), so a registry route without a row fails the equality instead of
  passing vacuously; the Copilot leg (no encoder) is covered by name in
  `CLIENT_COVERED_ROUTES` and pinned through the real client; `mistral-plan`
  runs through the REAL production client with zero sends, not only through
  the encoder.
- P3, capture recipes (check 4), all five bullets: item 5 video parts carry
  `"type": "video_url"` in all three bodies, with an M0 step reading the
  exact served id from `GET /v1/models` (known only at run time); item 2
  polls the uploaded file until `state` is `ACTIVE` before call 1 (every
  poll GET counted) and both file-deletion confirms record the status the
  vendor answers instead of fixing 404; item 6's Gemini refusal row is
  addressed to `gemma-4-31b-it` (text+image input only per the catalog
  snapshot — the flash models all take video and would likely answer and
  bill); item 3's M1/call 2 run only when call 1's error body names a
  file-id form, otherwise the run stops after call 1; item 4's call 2 names
  the concrete catalog id `o3-mini` (text-only input) with a
  substitute-or-skip rule, never a paid guess.
- Class sweep, the three side callers (one sentence each, with the proving
  type): the legal explanation cannot hold media — `explainLegal` takes
  only `result: LegalScanResult` (zod-parsed finding/category/severity/
  license strings) and builds the body internally as one `input_text` part
  (`legalExplanation.ts:109`); the hook model cannot hold media —
  `runHookModelTurn` takes only `HookModelTurnInput` (`{ kind, system:
string, user: string }`, `hookModelEntry.ts:46-50`) and builds history
  internally as one `input_text` message (`:201-203`); the Reviewer cannot
  hold media — `reviewPaidCall` takes only `tool: string, action: string`
  over a `ReviewRequest` of strings (`autoReviewer.ts:26-36`) and builds the
  body internally as one `input_text` message (`reviewerEntry.ts:230`).
  The Meta passthrough is pinned by test (rethrows the typed refusal
  itself); the Model API session's throw-to-reason mapping is read at
  `ModelApiHost.ts:14055` and exercised downstream by the ACP and exec
  tests above.

R4 drills (each file restored and SHA-256 verified equal to the pre-drill
value):

- D-R4-1, `host/providers/copilotClient.ts`: the video branch reverted to
  `throw this.fail('drill')`; both held-video tests (en, de) failed.
  Restored to SHA-256
  `ddca14d6848ccc1d1626d512050fbc7a31ba49c48f2c57f827ce9f822109fb8c`.
- D-R4-2, `acp/agent.ts`: `settle` changed to drop `event.reason`; the
  rewritten ACP test failed with `Internal error: failed` instead of the
  sentence. Restored to SHA-256
  `6cea1aaa13ff5d59c0dba7a95ddf9c7539a751b0fc1c5b8683a072ae6da8da53`.
- D-R4-3, `providers/subscriptions/registry.ts`: the Meta passthrough
  replaced with `throw`; the passthrough test failed with `expected the
typed codec refusal`. Restored to SHA-256
  `ca90e2f80ee5376646c82fb18bb53664b519f4c427f2dcd7a455ec1c63edb329`.
- D-R4-4, `providers/presets.ts` (drill-only change, production file
  untouched by the lane): a `drill-plan` route added without a row; the
  route guard failed (`20` covered vs `19` expected). Restored to SHA-256
  `dc012b2625d666dded5243b72b5f7ed46133e6ee9c304e004863e6870e6beea4`.
- D-R4-5, `runtime/exec/runExec.ts`: `observe` changed to drop
  `event.reason`; the exec test failed on `incompleteReason`. Restored to
  SHA-256
  `f292330077ae4f2aef18d25365a07094926192d21e8f4d777c5bd88638356c37`.
- D-R4-6, this record: one body key unquoted; the fenced-JSON test failed.
  Restored to SHA-256
  `10c22c74f82cb6aa45decedaeb4ca2de51082d5b779eb5422458d7322738ae40`.
- D-R4-7, `providers/configured.ts` (production file untouched by the
  lane): the `isChatCodecError` rethrow dropped; all five family refusal
  tests failed (the mistral-plan test shares the same `productionRefusal`
  path). Restored to SHA-256
  `181faef079b1164ff6b3ca711b14fe832f2bcae25264d2f0da7415335fb3abcb`.
- D-R4-8, `runtime/runtimeAccountingEntry.ts` (production file untouched by
  the lane): a `daily.reserve` forced before the inner call; the settlement
  test failed with `reserve called 1 times`. Restored to SHA-256
  `3bb71629fab19ad103dbb9e61b9353f9ac72c4769589b86cf38f5443c0342450`.
- Post-drill runs: `vendorMediaCodecs.test.ts` 48 passed,
  `copilotClient.test.ts` 52 passed, `acpAgent.test.ts` codec case passed,
  `execRun.test.ts` codec case passed (repository timeout, linuxlt,
  `--maxWorkers=3`).

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
only, never values: set the `$VAR` names from your own key store before
pasting; no key material goes in the record. Substitute a current catalog id
where a named one has retired, and record the exact id used. Every `json`
block below parses as written (`vendorMediaCodecs.test.ts` parses each one);
save a block to the named file, then paste its `sh` block. `<angle>`
placeholders inside a JSON string are the only substitutions.

1. Gemini video, inline path (2 model calls, no uploads). Endpoint,
   verified in `codecs/gemini.ts:42-45`
   (`geminiStreamPath`): `POST
https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse`
   (the product sends `streamGenerateContent`, not `generateContent`).
   Model: `gemini-flash-latest` (catalog id at time of writing). Header
   names: `x-goog-api-key`, `Content-Type`.

   Call 1 body, save as `/tmp/m105-gemini-inline-1.json`:

   ```json
   {
     "systemInstruction": { "parts": [{ "text": "describe this clip" }] },
     "contents": [
       {
         "role": "user",
         "parts": [
           { "text": "describe this clip" },
           {
             "inlineData": {
               "mimeType": "video/mp4",
               "data": "<base64-of-a-small-mp4-under-1-MiB>"
             }
           }
         ]
       }
     ],
     "generationConfig": { "maxOutputTokens": 1024 }
   }
   ```

   ```sh
   curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent?alt=sse" \
     -H "x-goog-api-key: $GEMINI_API_KEY" \
     -H "Content-Type: application/json" \
     -d @/tmp/m105-gemini-inline-1.json
   ```

   Call 2 runs only if call 1 refuses: the same body with `"mimeType":
"video/quicktime"` and `"data": "<base64-of-a-small-mov>"`, saved as
   `/tmp/m105-gemini-inline-2.json` and sent with the same `curl` line
   pointed at that file. Record per call: HTTP status, the full response
   bytes, `usageMetadata` (the pricing rows need it: input/output/cached
   counts), and the exact accepted mime set and byte limit from any error
   body.

2. Gemini video, Files path (2 model calls; per upload: upload, poll
   GETs until ACTIVE, delete, GET-confirm — count every management call;
   one upload required, a second only if call 1 succeeds). The product has
   no Files caller yet, so this capture defines it: confirm the exact
   upload path against the live response and record the path used.

   M1, upload the small mp4 from item 1 (`/tmp/m105-clip.mp4`):

   ```sh
   curl -X POST "https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=media" \
     -H "x-goog-api-key: $GEMINI_API_KEY" \
     -H "Content-Type: video/mp4" \
     --data-binary @/tmp/m105-clip.mp4
   ```

   Record the `name` and `uri` from the JSON response (under `file` per
   the Files API; confirm against the live response and record the path
   used); `<files-uri-from-M1>` below is that `uri`, `<file-id-from-M1>`
   the trailing id of that `name`.

   After M1, poll the file until its `state` is `ACTIVE` and only then
   send call 1: an uploaded video is not usable before that, and a call
   sent at once can fail on the file's state, which would mis-record a
   state failure as "call 1 refuses". `<file-name-from-M1>` is the `name`
   recorded above:

   ```sh
   curl "https://generativelanguage.googleapis.com/v1beta/<file-name-from-M1>" \
     -H "x-goog-api-key: $GEMINI_API_KEY"
   ```

   Repeat until `"state": "ACTIVE"`; count every poll GET as a management
   call.

   Call 1 body, save as `/tmp/m105-gemini-files-1.json`:

   ```json
   {
     "systemInstruction": { "parts": [{ "text": "describe this clip" }] },
     "contents": [
       {
         "role": "user",
         "parts": [
           { "text": "describe this clip" },
           { "fileData": { "mimeType": "video/mp4", "fileUri": "<files-uri-from-M1>" } }
         ]
       }
     ],
     "generationConfig": { "maxOutputTokens": 1024 }
   }
   ```

   ```sh
   curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent?alt=sse" \
     -H "x-goog-api-key: $GEMINI_API_KEY" \
     -H "Content-Type: application/json" \
     -d @/tmp/m105-gemini-files-1.json
   ```

   Call 2 and upload M2 run only if call 1 succeeds: upload the mov as in
   M1, then the same body with `"mimeType": "video/quicktime"` and the
   second upload's uri, saved as `/tmp/m105-gemini-files-2.json`. Record as
   in item 1, plus whether audio rides `inlineData`. Delete each upload and
   confirm it is gone; the file must be gone — record the status the vendor
   answers (a gone file reads as 404) rather than calling any other status
   a failure:

   ```sh
   curl -X DELETE "https://generativelanguage.googleapis.com/v1beta/files/<file-id-from-M1>" \
     -H "x-goog-api-key: $GEMINI_API_KEY"
   curl "https://generativelanguage.googleapis.com/v1beta/files/<file-id-from-M1>" \
     -H "x-goog-api-key: $GEMINI_API_KEY"
   ```

3. OpenAI Responses audio (call 1 plus, only when its error body names
   a file-id form, M1 and call 2; 3 management calls when M1 runs: upload,
   delete, GET-confirm). Endpoint, verified in
   `src/core/providers/configured.ts:633`:
   `POST https://api.openai.com/v1/responses`. Model: `gpt-5.4` (catalog id
   at time of writing; must be an audio-input model — if it refuses, record
   the refusal and stop: that refusal shape is item 6's OpenAI row). Header
   names: `Authorization`, `Content-Type`.

   Call 1 body, save as `/tmp/m105-openai-responses-1.json` (field names are
   the candidate shape; confirm against the live error body and record the
   exact accepted shape):

   ```json
   {
     "model": "gpt-5.4",
     "input": [
       {
         "type": "message",
         "role": "user",
         "content": [
           { "type": "input_text", "text": "transcribe this" },
           { "type": "input_audio", "audio": "<base64-of-a-short-wav>", "format": "wav" }
         ]
       }
     ],
     "instructions": "Transcribe the attached audio exactly.",
     "stream": true
   }
   ```

   ```sh
   curl -X POST "https://api.openai.com/v1/responses" \
     -H "Authorization: Bearer $OPENAI_API_KEY" \
     -H "Content-Type: application/json" \
     -d @/tmp/m105-openai-responses-1.json
   ```

   M1 and call 2 run only if call 1's error body names a file-id form
   for the `audio` field. Otherwise stop after call 1 and record the
   validation error as-is: a base64 validation error says nothing about a
   file-id form, and sending call 2 anyway would spend a paid call learning
   nothing. When the error names the form, upload the wav
   (`/tmp/m105-clip.wav`); record the `id` from the JSON response
   (`<file-id-from-M1>` below) and the accepted `purpose` (first attempt
   `user_data`):

   ```sh
   curl -X POST "https://api.openai.com/v1/files" \
     -H "Authorization: Bearer $OPENAI_API_KEY" \
     -F "file=@/tmp/m105-clip.wav" \
     -F "purpose=user_data"
   ```

   Call 2 body, save as `/tmp/m105-openai-responses-2.json` (the file id in
   place of inline bytes; same confirm-and-record as call 1):

   ```json
   {
     "model": "gpt-5.4",
     "input": [
       {
         "type": "message",
         "role": "user",
         "content": [
           { "type": "input_text", "text": "transcribe this" },
           { "type": "input_audio", "audio": "<file-id-from-M1>", "format": "wav" }
         ]
       }
     ],
     "instructions": "Transcribe the attached audio exactly.",
     "stream": true
   }
   ```

   Send it with the call-1 `curl` line pointed at
   `/tmp/m105-openai-responses-2.json`. Record per call: HTTP status, full
   response bytes, billed usage. Delete the file and confirm it is gone;
   the file must be gone — record the status the vendor answers (a gone
   file reads as 404) rather than calling any other status a failure:

   ```sh
   curl -X DELETE "https://api.openai.com/v1/files/<file-id-from-M1>" \
     -H "Authorization: Bearer $OPENAI_API_KEY"
   curl "https://api.openai.com/v1/files/<file-id-from-M1>" \
     -H "Authorization: Bearer $OPENAI_API_KEY"
   ```

4. OpenAI Chat Completions audio (2 model calls, no uploads). Path
   pattern, verified in `src/core/providers/configured.ts:643`
   (`modelsList.path` with `models` replaced by `chat/completions`): `POST
https://api.openai.com/v1/chat/completions`. Model: `gpt-5.4` as in item 3.
   Header names: `Authorization`, `Content-Type`.

   Call 1 body, save as `/tmp/m105-openai-chat-1.json` (field names are the
   candidate shape; confirm against the live error body and record the exact
   accepted shape):

   ```json
   {
     "model": "gpt-5.4",
     "messages": [
       {
         "role": "user",
         "content": [
           { "type": "text", "text": "transcribe this" },
           {
             "type": "input_audio",
             "input_audio": { "data": "<base64-of-a-short-wav>", "format": "wav" }
           }
         ]
       }
     ],
     "stream": true
   }
   ```

   ```sh
   curl -X POST "https://api.openai.com/v1/chat/completions" \
     -H "Authorization: Bearer $OPENAI_API_KEY" \
     -H "Content-Type: application/json" \
     -d @/tmp/m105-openai-chat-1.json
   ```

   Call 2 targets `o3-mini`, which the catalog marks voice-incapable
   (text-only input in `vendor/models-dev/snapshot.json` at time of
   writing): the exact replacement body, save as
   `/tmp/m105-openai-chat-2.json` (only the model id changes; record the id
   used; if `o3-mini` has retired, substitute a current text-only catalog
   id, or skip call 2 and record the skip — never burn a paid call on a
   guess):

   ```json
   {
     "model": "o3-mini",
     "messages": [
       {
         "role": "user",
         "content": [
           { "type": "text", "text": "transcribe this" },
           {
             "type": "input_audio",
             "input_audio": { "data": "<base64-of-a-short-wav>", "format": "wav" }
           }
         ]
       }
     ],
     "stream": true
   }
   ```

   Send it with the call-1 `curl` line pointed at
   `/tmp/m105-openai-chat-2.json`. Record whether call 2 refuses and with
   what HTTP status and error body (a zod schema is written from that capture
   before any codec use).

5. vLLM/SGLang video (2 model calls, owner-hosted, no uploads). Who
   hosts it: the owner on the lead machine. Server: a vLLM release the owner
   pins at run time (record the version); launch line recorded verbatim, e.g.
   `vllm serve Qwen/Qwen2-VL-2B-Instruct --port 8000`. Endpoint (chat format,
   loopback preset, default port 8000 per `presets.ts` vLLM row): `POST
http://127.0.0.1:8000/v1/chat/completions`. Header names: `Content-Type`
   (plus `Authorization` only if served with `--api-key`).

   M0, read the exact served id (it is known only at run time) and use it
   for `<served-id>` in every body below, recording the id used:

   ```sh
   curl http://127.0.0.1:8000/v1/models
   ```

   Call 1 body, save as `/tmp/m105-vllm-1.json` (URL form data vs http to
   confirm against the live error shape; record the accepted form; every
   content part carries its `type`, as the audio parts elsewhere do):

   ```json
   {
     "model": "<served-id>",
     "messages": [
       {
         "role": "user",
         "content": [
           { "type": "text", "text": "describe this clip" },
           {
             "type": "video_url",
             "video_url": { "url": "data:video/mp4;base64,<base64-of-a-small-mp4>" }
           }
         ]
       }
     ],
     "stream": true
   }
   ```

   ```sh
   curl -X POST "http://127.0.0.1:8000/v1/chat/completions" \
     -H "Content-Type: application/json" \
     -d @/tmp/m105-vllm-1.json
   ```

   Call 2a runs if call 1 succeeds: the http(s)-URL form, save as
   `/tmp/m105-vllm-2a.json`:

   ```json
   {
     "model": "<served-id>",
     "messages": [
       {
         "role": "user",
         "content": [
           { "type": "text", "text": "describe this clip" },
           {
             "type": "video_url",
             "video_url": { "url": "https://<owner-host>/m105-clip.mp4" }
           }
         ]
       }
     ],
     "stream": true
   }
   ```

   Call 2b runs instead if call 1 refuses: the same body as call 1 with
   `"url": "data:video/quicktime;base64,<base64-of-a-small-mov>"`, saved as
   `/tmp/m105-vllm-2b.json`. Send the chosen branch with the call-1 `curl`
   line pointed at that file. Record per call: HTTP status, full response
   bytes, the accepted mime set and limits from any error body, and the
   server version.

6. Refusal shapes, one concrete request per vendor (5 model calls, one per
   row; each must refuse before inference). Each row reuses its item's
   endpoint, method and header names with a held-media body addressed to a
   model with no video/audio binding. If a named model unexpectedly accepts
   the media, record the acceptance instead: it defines a capture need rather
   than a refusal shape. Record per call: HTTP status and the full error body
   (a zod schema is written from each before any codec use), plus billed
   usage where the vendor reports any.

   OpenAI refusal (item 3's endpoint and shape), save as
   `/tmp/m105-refuse-openai.json`:

   ```json
   {
     "model": "gpt-5.4-nano",
     "input": [
       {
         "type": "message",
         "role": "user",
         "content": [
           { "type": "input_text", "text": "transcribe this" },
           { "type": "input_audio", "audio": "<base64-of-a-short-wav>", "format": "wav" }
         ]
       }
     ],
     "instructions": "Transcribe the attached audio exactly.",
     "stream": true
   }
   ```

   ```sh
   curl -X POST "https://api.openai.com/v1/responses" \
     -H "Authorization: Bearer $OPENAI_API_KEY" \
     -H "Content-Type: application/json" \
     -d @/tmp/m105-refuse-openai.json
   ```

   Anthropic refusal (`POST https://api.anthropic.com/v1/messages`, header
   names `x-api-key`, `anthropic-version`, `Content-Type`; version value
   `2023-06-01` per `codecs/anthropic.ts`). Anthropic's message blocks carry
   no audio part, so the probe sends the clip as a document with an audio
   mime; record how the vendor refuses it. Save as
   `/tmp/m105-refuse-anthropic.json`:

   ```json
   {
     "model": "claude-haiku-4-5",
     "max_tokens": 1024,
     "messages": [
       {
         "role": "user",
         "content": [
           { "type": "text", "text": "transcribe this" },
           {
             "type": "document",
             "source": {
               "type": "base64",
               "media_type": "audio/wav",
               "data": "<base64-of-a-short-wav>"
             }
           }
         ]
       }
     ],
     "stream": true
   }
   ```

   ```sh
   curl -X POST "https://api.anthropic.com/v1/messages" \
     -H "x-api-key: $ANTHROPIC_API_KEY" \
     -H "anthropic-version: 2023-06-01" \
     -H "Content-Type: application/json" \
     -d @/tmp/m105-refuse-anthropic.json
   ```

   Gemini refusal (item 1's endpoint and inline shape), addressed to
   `gemma-4-31b-it`, which the catalog marks video/audio-incapable
   (text and image input only in `vendor/models-dev/snapshot.json` at time
   of writing; the flash models all take video, so one of them would most
   likely answer — and bill — instead of refusing). If it has retired,
   substitute a current text-only catalog id. Save as
   `/tmp/m105-refuse-gemini.json`:

   ```json
   {
     "systemInstruction": { "parts": [{ "text": "describe this clip" }] },
     "contents": [
       {
         "role": "user",
         "parts": [
           { "text": "describe this clip" },
           {
             "inlineData": {
               "mimeType": "video/mp4",
               "data": "<base64-of-a-small-mp4-under-1-MiB>"
             }
           }
         ]
       }
     ],
     "generationConfig": { "maxOutputTokens": 1024 }
   }
   ```

   ```sh
   curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:streamGenerateContent?alt=sse" \
     -H "x-goog-api-key: $GEMINI_API_KEY" \
     -H "Content-Type: application/json" \
     -d @/tmp/m105-refuse-gemini.json
   ```

   xAI refusal (`POST https://api.x.ai/v1/responses`: origin `api.x.ai` and
   `responses` format per the `presets.ts` xAI row, path `/v1/responses` as in
   `configured.ts`). Save as `/tmp/m105-refuse-xai.json`:

   ```json
   {
     "model": "grok-4.5",
     "input": [
       {
         "type": "message",
         "role": "user",
         "content": [
           { "type": "input_text", "text": "describe this clip" },
           { "type": "input_video", "video": "<base64-of-a-small-mp4-under-1-MiB>" }
         ]
       }
     ],
     "instructions": "Describe the attached clip.",
     "stream": true
   }
   ```

   ```sh
   curl -X POST "https://api.x.ai/v1/responses" \
     -H "Authorization: Bearer $XAI_API_KEY" \
     -H "Content-Type: application/json" \
     -d @/tmp/m105-refuse-xai.json
   ```

   Ollama refusal (`POST http://127.0.0.1:11434/api/chat`, path
   `OLLAMA_CHAT_PATH` in `codecs/ollama.ts`; header name `Content-Type`).
   The lane test uses `llama3.2` as the text-only native id. Save as
   `/tmp/m105-refuse-ollama.json`:

   ```json
   {
     "model": "llama3.2",
     "messages": [
       { "role": "user", "content": "describe this clip", "images": ["<base64-of-a-small-mp4>"] }
     ],
     "stream": false
   }
   ```

   ```sh
   curl -X POST "http://127.0.0.1:11434/api/chat" \
     -H "Content-Type: application/json" \
     -d @/tmp/m105-refuse-ollama.json
   ```

Until these land, PLAN.md M105 acceptance 4 ("provider × modality table")
and the "Delivery b" checklist row stay open, correctly: the table's
non-Meta cells read as quoted above, and the codecs now say the same in the
user's language at the point of refusal.
