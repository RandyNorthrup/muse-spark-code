# M95 captures: live wire formats per provider preset (2026-10-04)

Recorded 2026-10-04 on `feature/m95-byo-providers` (plan at `05e15893`) for
PLAN.md D74 and M95, under AGENTS.md rule 13: a preset is listed only once its
wire has been captured. This record names each capture, its workspace and its
counted model attempts. The frames themselves are in
`docs/certification/m95-captures/<provider>/`, one JSON file per request
(request with headers and body, response status, headers, and the parsed SSE
events or JSON body), with `calls.json` as each run's ledger.

## How the captures were made

- **Where.** This Windows host, because the twelve capture keys ("muse-spark-code
  capture") are DPAPI-bound to its user. Each key was decrypted in memory by a
  PowerShell helper and written to the capture script's standard input. No key
  was ever in an argument, an environment variable or a file. Node 24's
  `fetch` was used with `redirect: 'manual'`.
- **Workspace.** None. The scripts called each API directly from the session
  scratchpad, and the extension did not run. Every prompt was synthetic: the
  system prompt is a ~1,300-token block of numbered filler rules, the user
  asks for the time, and the one tool is `get_time(timezone)`. No repository
  content was sent.
- **Per provider.**
  - The model list, which is free.
  - One streaming request with the tool, then the follow-up carrying the tool
    result and the streamed final answer.
  - An invalid model name (`no-such-model-m95`), which is free.
  - A cache pair where the brief asks for one:
    - Anthropic: a `cache_control` breakpoint;
    - OpenAI: implicit, with a prefix of at least 1,024 tokens;
    - Gemini: implicit;
    - OpenRouter: pass-through to an Anthropic upstream.
  - The key or usage endpoint where one exists (OpenRouter `/api/v1/key`,
    Hugging Face `whoami-v2`, stored as shape only).
- **Output caps.** About 64 output tokens on plain models. Reasoning models got
  512 to 2,048 so that a tool call fits after the reasoning; at these prices
  the difference is a fraction of a cent.
- **Scrubbing.** Every frame was scrubbed before it was written:
  - Authorization, `x-api-key` and `x-goog-api-key` values become `<redacted>`.
  - Strings shaped like `sk-…`, `gsk_…`, `xai-…`, `hf_…`, `fw_…`, `AIza…`,
    `tgp_v1_…` and Z.ai's `<32 hex>.<16>` become `<redacted>`, as does the
    exact key value.
  - E-mails, account, organization, project, workspace and team ids (fields,
    headers, and ids inside error prose), and key labels become `<redacted>`.
  - Home paths become `<home>`.
- **Checks before committing.** `gitleaks detect --no-git --source
docs/certification/m95-captures` reported no leaks. A second scan fed each
  real key in over stdin and searched all 93 files for the key and for every
  10-character slice of it: 0 hits for all twelve keys.
- **Model lists are trimmed.** Each is stored as its count, top-level keys, the
  union of entry keys, and full sample entries: the first two plus the models
  used. Nothing in a list is secret, but OpenRouter's alone is about 700 KB.

## Totals

| Provider     | Model calls attempted | Completed (billed) | Refused, not billed | Free requests | Approx. cost (USD)            |
| ------------ | --------------------: | -----------------: | ------------------: | ------------: | ----------------------------- |
| OpenAI       |                     4 |                  4 |                   0 |             2 | 0.0009                        |
| xAI          |                     2 |                  2 |                   0 |             3 | 0.0032 (reported)             |
| Anthropic    |                    13 |                 13 |                   0 |             3 | 0.0526                        |
| Gemini       |                     4 |                  4 |                   0 |             3 | 0.0051 (paid rate; free tier) |
| OpenRouter   |                     5 |                  5 |                   0 |             4 | 0.0055 (reported)             |
| Groq         |                     2 |                  2 |                   0 |             2 | 0.0003                        |
| Mistral      |                     2 |                  2 |                   0 |             2 | 0.0002                        |
| Together     |                     4 |                  2 |                   2 |             5 | 0.0005                        |
| Fireworks    |                     2 |                  2 |                   0 |             3 | 0.0004                        |
| DeepSeek     |                     3 |                  3 |                   0 |             2 | 0.0008 (peak rate)            |
| Hugging Face |                     2 |                  2 |                   0 |             3 | 0.0003                        |
| Z.ai         |                     3 |                  3 |                   0 |             4 | 0.0004                        |
| **Total**    |                **46** |             **44** |               **2** |        **36** | **≈ 0.070**                   |

The free column counts the requests logged by the capture runs. Before them, a
model-choice pass made 16 more free list requests whose output stayed in the
scratchpad, so 52 free requests in all. Costs come from each response's
reported usage at published prices, or from the provider's own reported cost
(xAI `cost_in_usd_ticks`, OpenRouter `cost`). Mistral's and Fireworks' prices
are approximate (OpenRouter's listing and Fireworks' public rate).

Anthropic's $0.053 passes the brief's $0.05 estimate by three tenths of a cent,
because two extra loops were needed to see a thinking block (see §
Anthropic). The owner has said spend is no concern; the numbers are counted
here as always.

## OpenAI (`responses`)

| Item               | Captured                                                                                                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint           | `POST https://api.openai.com/v1/responses`, `Authorization: Bearer`                                                                                                                                                                                                                       |
| Models list        | `GET /v1/models`: **1** model (`gpt-5.6-luna`), the list the key's project allows; fields `id, object, created, owned_by, shutdown_date` only (no window, no price)                                                                                                                       |
| Model used         | `gpt-5.6-luna` with the harness's own body shape: `instructions`, `store: false`, `include: ["reasoning.encrypted_content"]`, `prompt_cache_key`, `max_output_tokens`, `reasoning.effort: "low"`, `strict: false` tools                                                                   |
| Tool-call stream   | `response.created`, `in_progress`, `output_item.added` (function_call), **5** `function_call_arguments.delta` fragments, `.done`, `output_item.done`, `completed`. No reasoning item at effort `low` (`reasoning_tokens: 0`). Replay `user, function_call, function_call_output` accepted |
| Usage              | `input_tokens` (includes cached and written), `input_tokens_details.{cached_tokens, cache_write_tokens}`, `output_tokens_details.reasoning_tokens`, `total_tokens`                                                                                                                        |
| Cache              | Implicit, with the write reported. Tool loop: 1,444 written, then 1,444 read and 50 written. Cache pair (prefix in `instructions`): 1,574 written, then 1,574 read                                                                                                                        |
| Error              | 404 `{"error": {"message", "type": "invalid_request_error", "param": null, "code": "model_not_found"}}`                                                                                                                                                                                   |
| Rate-limit headers | `x-ratelimit-{limit,remaining,reset}-{requests,tokens}`; `openai-organization` and `openai-project` headers (redacted)                                                                                                                                                                    |
| Calls / cost       | 4 billed, 2 free; ≈ $0.0009 (`$0.20` in, `$0.02` cached, `$0.25` write, `$1.20` out per million)                                                                                                                                                                                          |

## xAI (`responses`)

| Item               | Captured                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint           | `POST https://api.x.ai/v1/responses`, Bearer                                                                                                                                                                                                                                                                                                                                                            |
| Models list        | `GET /v1/models`: **14** (`context_length`, `long_context_threshold`, prices as integers in 1e-10 USD per token: `prompt_text_token_price`, `cached_prompt_text_token_price`, `completion_text_token_price` and their `_long_context` forms, `capabilities.reasoning_effort`); `GET /v1/language-models`: 8 (adds modalities, `fingerprint`)                                                            |
| Model used         | `grok-4.3`, `reasoning.effort: "low"`; the same body as OpenAI's. **`instructions` was accepted**                                                                                                                                                                                                                                                                                                       |
| Tool-call stream   | A reasoning item **with a streamed summary nobody asked for** (`reasoning_summary_part.*`, `reasoning_summary_text.delta`), closed with `encrypted_content` (971 chars). Then `output_item.added` (function_call), **one** `function_call_arguments.delta` holding the whole arguments, `.done`, `output_item.done`. Replay `user, reasoning (encrypted), function_call, function_call_output` accepted |
| Usage              | `input_tokens_details.cached_tokens`, `output_tokens_details.reasoning_tokens`, **`cost_in_usd_ticks`** (1e-10 USD: 23,184,000 = $0.0023), `num_sources_used`, `num_server_side_tools_used`, `context_details`                                                                                                                                                                                          |
| Cache              | Automatic. The follow-up read 1,664 of 1,874 input tokens; the first call read 192                                                                                                                                                                                                                                                                                                                      |
| Error              | 404, flat and not OpenAI's envelope: `{"code": "not-found", "error": "<sentence naming the account's team id>"}`. The team id is redacted here, and must be redacted before any log or notice                                                                                                                                                                                                           |
| Rate-limit headers | `x-ratelimit-{limit,remaining}-{requests,tokens}` (no reset headers)                                                                                                                                                                                                                                                                                                                                    |
| Calls / cost       | 2 billed, 3 free; $0.0032 as reported                                                                                                                                                                                                                                                                                                                                                                   |

## Anthropic (`anthropic`)

| Item               | Captured                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint           | `POST https://api.anthropic.com/v1/messages`, `anthropic-version: 2023-06-01`. **`Authorization: Bearer` and `x-api-key` both accepted**: the list was fetched both ways, and every Messages call used Bearer                                                                                                                                                                                                                                                  |
| Models list        | `GET /v1/models?limit=1000`: **13** (`max_input_tokens`, `max_tokens`, `capabilities`, `line`, `display_name`)                                                                                                                                                                                                                                                                                                                                                 |
| Models used        | `claude-haiku-4-5-20251001` (main loop, tool history without tools); `claude-sonnet-5-5` (adaptive thinking at `low` and `high`, cache pair, a thinking loop with a reasoning prompt); `claude-opus-5-5` (adaptive at `low`)                                                                                                                                                                                                                                   |
| Tool-call stream   | `message_start`, `content_block_start` (tool_use), `ping`, `input_json_delta` fragments, `content_block_stop`, `message_delta` (stop `tool_use`, cumulative usage), `message_stop`. New fields: `tool_use.caller: {type: "direct"}`, `message.container`, `stop_details`. Replaying `caller` was accepted                                                                                                                                                      |
| Thinking           | **Adaptive thinking emitted no thinking block** for the plain time prompt on Sonnet 5.5 (`low` and `high`) and on Opus 5.5 (`low`): `thinking_tokens: 0`. With a prompt that needs reasoning, Sonnet 5.5 `high` sent a `thinking` block whose text is **omitted** (one empty `thinking_delta`) and whose 972-char `signature_delta` carries it, before `tool_use`. Replayed unchanged, it was accepted, and the final answer began with another thinking block |
| Usage              | `input_tokens` (after the last breakpoint), `cache_creation_input_tokens`, `cache_read_input_tokens`, `cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`, `output_tokens`, **`output_tokens_details.thinking_tokens`** (5.x), `service_tier`, `inference_geo`; `message_start` and `message_delta` both carry them                                                                                                                        |
| Cache              | Breakpoint on the system block: 1,925 written, then 1,925 read (Sonnet 5.5). In the tool loop, a system breakpoint cached tools plus system (2,054 tokens), read on the follow-up and again by the next run within five minutes                                                                                                                                                                                                                                |
| Tool history       | A follow-up carrying `tool_use` and `tool_result` but **no `tools`** was accepted (200, Haiku 4.5)                                                                                                                                                                                                                                                                                                                                                             |
| Error              | 404 `{"type": "error", "error": {"type": "not_found_error", "message"}, "request_id"}`, with header `x-should-retry: false`                                                                                                                                                                                                                                                                                                                                    |
| Rate-limit headers | `anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-{limit,remaining,reset}`; `anthropic-organization-id` and `anthropic-workspace-id` (redacted)                                                                                                                                                                                                                                                                                                |
| Calls / cost       | 13 billed, 3 free; ≈ $0.053. Directories `anthropic/`, `anthropic-opus-thinking/`, `anthropic-sonnet-thinking-high/` and `anthropic-sonnet-thinking-riddle/`                                                                                                                                                                                                                                                                                                   |

## Google Gemini (`gemini`)

| Item               | Captured                                                                                                                                                                                                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint           | `POST https://generativelanguage.googleapis.com/v1beta/models/{m}:streamGenerateContent?alt=sse`, `x-goog-api-key`                                                                                                                                                                                                          |
| Models list        | `GET /v1beta/models?pageSize=1000`: **61** (`inputTokenLimit`, `outputTokenLimit`, `supportedGenerationMethods`, `thinking`)                                                                                                                                                                                                |
| Model used         | `gemini-3.5-flash-lite`, `thinkingConfig {thinkingLevel: "low", includeThoughts: true}`                                                                                                                                                                                                                                     |
| Tool-call stream   | One chunk with `functionCall {name, args, id: "call_…"}` and `thoughtSignature` (132 chars) **on the same part**, whole. Then a chunk with an empty text part and **`finishReason: "STOP"`**, not a tool-call reason. Replaying the parts as received, plus `functionResponse {id, name, response}` as `user`, was accepted |
| Usage              | `usageMetadata` on every chunk: `promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`, `promptTokensDetails[{modality, tokenCount}]`, `thoughtsTokenCount` (when it thought), `serviceTier`                                                                                                                         |
| Cache              | Implicit caching **was not observed**: two back-to-back calls with a 5,514-token prompt returned no `cachedContentTokenCount`                                                                                                                                                                                               |
| Error              | HTTP 404 sent as **`content-type: text/event-stream` with a pretty-printed JSON body** (not SSE): `{"error": {"code": 404, "message", "status": "NOT_FOUND"}}`                                                                                                                                                              |
| Rate-limit headers | None                                                                                                                                                                                                                                                                                                                        |
| Calls / cost       | 4 billed, 3 free (the error probe was redone once, after the capture script learned to read a JSON body under `text/event-stream`); ≈ $0.005 at the paid rate (`$0.30` in, `$2.50` out), $0 if the key is on the free tier                                                                                                  |

## OpenRouter (`chat`)

| Item               | Captured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Endpoint           | `POST https://openrouter.ai/api/v1/chat/completions`, Bearer, the three attribution headers of D74 on every request                                                                                                                                                                                                                                                                                                                                                                                                            |
| Lists and key      | `/api/v1/models?supported_parameters=tools`: **376** (adds `benchmarks`, `knowledge_cutoff`, `reasoning`, `links`, `expiration_date` to D74's fields; `:batch` variants listed); `/models/openai/gpt-oss-20b/endpoints`; `/api/v1/key`: `limit`, `limit_remaining`, `limit_reset`, `usage{,_daily,_weekly,_monthly}`, `byok_usage*`, `is_free_tier`, `expires_at`, `free_model_daily_requests {used, limit, remaining}`, `include_byok_in_limit`, `allowed_data_regions`, `workspace_id` (redacted), a deprecated `rate_limit` |
| Model used         | `openai/gpt-oss-20b` with `provider: {zdr: true}` (a ZDR endpoint was found) and `reasoning: {effort: "low"}`                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Tool-call stream   | Delta keys `content, role, reasoning, reasoning_details, tool_calls`; arguments in fragments after a header chunk (`id`, `name`, `""`); **usage on the finish chunk** (non-empty `choices`, with `native_finish_reason`). `reasoning_details` replayed in order was accepted. No `: OPENROUTER PROCESSING` comments in these short calls                                                                                                                                                                                       |
| Usage              | `cost`, `is_byok`, `prompt_tokens_details.{cached_tokens, cache_write_tokens, audio_tokens, video_tokens}`, `cost_details.{upstream_inference_cost, upstream_inference_prompt_cost, upstream_inference_completions_cost}`, `completion_tokens_details.reasoning_tokens`                                                                                                                                                                                                                                                        |
| Cache              | Pass-through on `anthropic/claude-sonnet-5.5` with `cache_control` on the system text part: 1,925 written ($0.0049), then 1,925 read ($0.00046)                                                                                                                                                                                                                                                                                                                                                                                |
| Tool history       | A follow-up with tool history and no `tools` was accepted (200) on this upstream, despite the docs                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Error              | 400 `{"error": {"message", "code": 400}, "user_id": "<redacted>"}`, with **the account's user id at top level**                                                                                                                                                                                                                                                                                                                                                                                                                |
| Rate-limit headers | None; `x-generation-id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Calls / cost       | 5 billed, 4 free; $0.0055 as reported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Groq (`chat`)

| Item               | Captured                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Endpoint           | `POST https://api.groq.com/openai/v1/chat/completions`, Bearer                                                                                                                                                                                         |
| Models list        | **11**, **now priced**: `pricing {prompt, completion, input_cache_read, image, request}` as USD-per-token strings; also `context_window`, `max_completion_tokens`, `supported_features` (`tools`, `reasoning`…)                                        |
| Model used         | `openai/gpt-oss-20b`, `reasoning_effort: "low"`, `max_completion_tokens`, `stream_options.include_usage` (accepted)                                                                                                                                    |
| Tool-call stream   | The call arrives **whole in one chunk** (`id: "fc_…"`); reasoning streams as `reasoning` with a `channel: "analysis"` key; usage on a final chunk with `choices: []` and `x_groq {id, seed}`. Replaying `reasoning` on the assistant turn was accepted |
| Usage              | `prompt_tokens`, `completion_tokens`, `completion_tokens_details.reasoning_tokens`, `queue_time`, `prompt_time`, `completion_time`, `total_time`; **no cached-token field**, even on the follow-up                                                     |
| Cache              | None reported                                                                                                                                                                                                                                          |
| Error              | 404 `{"error": {"message", "type": "invalid_request_error", "code": "model_not_found"}}`                                                                                                                                                               |
| Rate-limit headers | `x-ratelimit-{limit,remaining,reset}-{requests,tokens}`                                                                                                                                                                                                |
| Calls / cost       | 2 billed, 2 free; ≈ $0.0003                                                                                                                                                                                                                            |

## Mistral (`chat`)

| Item               | Captured                                                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint           | `POST https://api.mistral.ai/v1/chat/completions`, Bearer                                                                                                                                             |
| Models list        | **53** (`capabilities {function_calling, reasoning, vision, completion_fim, …}`, `max_context_length`, `aliases`, `deprecation`); no prices. It also lists Z.ai GLM models (`zai-glm-5-3` and others) |
| Model used         | `ministral-3b-latest`, `prompt_cache_key`, `stream_options.include_usage` (accepted), tool results with `name`                                                                                        |
| Tool-call stream   | Three events: role, then **one chunk holding the whole tool call, `finish_reason: "tool_calls"` and the usage together**, then `[DONE]`                                                               |
| Usage              | `prompt_tokens_details.cached_tokens`, `service_tier`                                                                                                                                                 |
| Cache              | `prompt_cache_key`: the follow-up read 1,536 of 1,602                                                                                                                                                 |
| Error              | 400, flat: `{"object": "error", "message", "type": "invalid_model", "param": null, "code": "1500", "raw_status_code": 400}`                                                                           |
| Rate-limit headers | Only `x-max-retry-attempts-reached`                                                                                                                                                                   |
| Calls / cost       | 2 billed, 2 free; ≈ $0.0002                                                                                                                                                                           |

## Together (`chat`)

| Item               | Captured                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint           | `POST https://api.together.ai/v1/chat/completions`, Bearer (`api.together.xyz` serves the same list)                                                                                                                                                                                                                                                     |
| Models list        | **264**, a bare array (`pricing {input, output, hourly, …}` with no cached price, `context_length`, `type`, `running`, `uuid`). **A listed, priced model is not necessarily callable**: `openai/gpt-oss-20b` was refused 400 `model_not_available` ("non-serverless … create and start a new dedicated endpoint"), and every entry says `running: false` |
| Model used         | `openai/gpt-oss-120b`, `reasoning_effort: "low"`                                                                                                                                                                                                                                                                                                         |
| Tool-call stream   | A header chunk, then arguments in fragments (10 chunks); delta keys `token_id, role, content, reasoning, tool_calls`; usage on a final chunk with `choices: []`. Replaying `reasoning` was accepted, but **the final text began with a leaked `final` channel word** (`"finalIt is currently 12:00 UTC."`)                                               |
| Usage              | `prompt_tokens_details.cached_tokens` (48 and 79: small), `completion_tokens_details.reasoning_tokens`                                                                                                                                                                                                                                                   |
| Error              | 404 `{"id", "error": {"message", "type": "invalid_request_error", "param", "code": "model_not_available"}}`, the same code as the non-serverless 400                                                                                                                                                                                                     |
| Rate-limit headers | None observed                                                                                                                                                                                                                                                                                                                                            |
| Calls / cost       | 4 model-call attempts (2 refused as non-serverless before inference, nothing billed), 2 billed, 5 free; ≈ $0.0005                                                                                                                                                                                                                                        |

## Fireworks (`chat`)

| Item               | Captured                                                                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Endpoint           | `POST https://api.fireworks.ai/inference/v1/chat/completions`, Bearer                                                                                                                                                                                                                |
| Models list        | `GET /inference/v1/models`: **20**, now with `supports_tools`, `supports_chat`, `supports_image_input` and `context_length`. The account API `GET /v1/accounts/fireworks/models` gave 200 per page (`contextLength`, `supportsTools`, `supportsServerless`). **No prices in either** |
| Model used         | `accounts/fireworks/models/gpt-oss-120b`, `reasoning_effort: "low"`, `prompt_cache_key`                                                                                                                                                                                              |
| Tool-call stream   | A header chunk (`id`, `name`), then arguments in fragments (9 chunks); `reasoning_content`; usage on a final chunk with `choices: []`                                                                                                                                                |
| Usage              | `prompt_tokens_details.cached_tokens`, both `completion_tokens_details.reasoning_tokens` and `output_tokens_details.reasoning_tokens`; headers `fireworks-prompt-tokens` and `fireworks-sampling-options` (the defaults applied)                                                     |
| Cache              | `prompt_cache_key`: the follow-up read 1,521 of 1,594                                                                                                                                                                                                                                |
| Error              | 404 `{"error": {"message", "param": "model", "code": "NOT_FOUND", "type": "error"}, "request_id"}`                                                                                                                                                                                   |
| Rate-limit headers | `x-ratelimit-over-limit`                                                                                                                                                                                                                                                             |
| Calls / cost       | 2 billed, 3 free; ≈ $0.0004                                                                                                                                                                                                                                                          |

## DeepSeek (`chat`)

| Item               | Captured                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Endpoint           | `POST https://api.deepseek.com/chat/completions`, Bearer                                                                                                                                                                             |
| Models list        | **2** (`deepseek-flash`, which is DeepSeek-V4.1-Flash, and `deepseek-v4-pro`): `context_window`, `max_output_tokens`, `effort {supported_levels, default_level}`, `api_capabilities`, modalities                                     |
| Model used         | `deepseek-flash`, `reasoning_effort: "low"` (accepted)                                                                                                                                                                               |
| Tool-call stream   | `reasoning_content` deltas, then a header chunk and arguments in fragments (11 chunks); usage on the finish chunk (`reasoning_content: null` there)                                                                                  |
| Replay rule        | **A follow-up without the turn's `reasoning_content` was accepted** (200), where the docs promise a 400. Its `prompt_tokens` (1,790) equal the replayed request's, so for the current turn the field is neither required nor counted |
| Usage              | `prompt_tokens_details.cached_tokens`, `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, `completion_tokens_details.reasoning_tokens`                                                                                           |
| Cache              | Automatic: the follow-up hit 1,536 of 1,790                                                                                                                                                                                          |
| Error              | **400** (not 404) `{"error": {"message": "The supported API model names are …", "type": "invalid_request_error", "param": null, "code": "invalid_request_error"}}`                                                                   |
| Rate-limit headers | None                                                                                                                                                                                                                                 |
| Calls / cost       | 3 billed (one is the without-reasoning probe), 2 free; ≈ $0.0008 at the peak rate                                                                                                                                                    |

## Hugging Face (`chat`, router)

| Item               | Captured                                                                                                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint           | `POST https://router.huggingface.co/v1/chat/completions`, Bearer (token)                                                                                                                                                                                  |
| Models list        | `GET /v1/models`: **136**, each with `providers[]` entries `{provider, status, context_length, pricing {input, output}, supports_tools, supports_structured_output, is_free, first_token_latency_ms, throughput}`, so prices and windows are per upstream |
| Key test           | `GET https://huggingface.co/api/whoami-v2` returned 200; only its shape is stored                                                                                                                                                                         |
| Model used         | `openai/gpt-oss-20b` with no policy suffix (`:fastest`), served by Groq (`x-inference-provider: groq`)                                                                                                                                                    |
| Tool-call stream   | **The upstream's stream passed through unchanged**: Groq's whole-call chunk, `channel`, `reasoning`, and usage with `queue_time` and the other timings                                                                                                    |
| Usage / cache      | As Groq's; no cached-token field                                                                                                                                                                                                                          |
| Error              | 400 `{"error": {"message", "type": "invalid_request_error", "param": "model", "code": "model_not_found"}}`                                                                                                                                                |
| Rate-limit headers | The upstream's `x-ratelimit-*`; `ratelimit` and `ratelimit-policy` on huggingface.co                                                                                                                                                                      |
| Calls / cost       | 2 billed, 3 free; ≈ $0.0003                                                                                                                                                                                                                               |

## Z.ai (`chat`)

| Item                       | Captured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint                   | `POST https://api.z.ai/api/paas/v4/chat/completions`, Bearer (verified: the general pay-as-you-go API)                                                                                                                                                                                                                                                                                                                                                                                        |
| Models list                | **11** (`id, object, created, owned_by` only: no window, no price)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Model used                 | `glm-5.3-flash` (thinking is forced on) with `tool_stream: true`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Tool-call stream           | `reasoning_content` deltas, then **arguments in fragments (5 chunks) because of `tool_stream`**, `id` on the first; usage on the finish chunk                                                                                                                                                                                                                                                                                                                                                 |
| Usage                      | `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens`                                                                                                                                                                                                                                                                                                                                                                                                           |
| Cache                      | Automatic: the follow-up read 1,536 of 1,634                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Error                      | 400 `{"error": {"code": "1211", "message": "Unknown Model, please check the model code."}}`, with the business code as a string                                                                                                                                                                                                                                                                                                                                                               |
| Anthropic-compatible route | `https://api.z.ai/api/anthropic` works with the same pay-as-you-go key (list of 11; one tool turn: a `thinking` block with streamed text and a 24-hex-char `signature`, then `tool_use` with `input_json_delta`). `message_start` usage is all zeros; the final usage has `input_tokens`, `output_tokens`, `cache_read_input_tokens` (1,536, **shared with the chat route's cache**) and `server_tool_use`, but no `cache_creation_input_tokens`. Error: Anthropic-shaped with `code: "1211"` |
| Rate-limit headers         | None                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Calls / cost               | 3 billed (two on chat, one on the Anthropic route), 4 free; ≈ $0.0004                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Differences from D74 and the research, and how each is settled

Each is settled the fuller, more robust way, as the owner prefers, and is
carried into PLAN.md D74 and M95.

1. **Z.ai joins the first release** (the owner: "i want to also be able to use
   glm models from z ai"). It is a `chat` preset at
   `https://api.z.ai/api/paas/v4`, not the Anthropic route. _Reason:_
   - the general API is the documented pay-as-you-go endpoint, and Z.ai
     documents the Anthropic route for its Coding Plan;
   - the Anthropic route's signature is not Anthropic's, it reports no cache
     writes, and its `message_start` usage is zero;
   - the chat route reports cached and reasoning tokens.

   The preset sends `tool_stream: true`, so arguments stream on the GLM-5
   family, and replays `reasoning_content`. Its window and prices come from
   the catalogue, since the list has neither. Business codes 1113
   (insufficient balance) and 1308 (usage limit) arrive as HTTP 429 and are
   not retried. A user who wants the Anthropic route can still add it as a
   Custom server (Anthropic Messages).

2. **Anthropic auth.** The Anthropic preset sends `Authorization: Bearer`,
   the documented header, which was accepted on lists and Messages. The
   Anthropic-format Custom server defaults to `x-api-key`, which Bedrock's
   route, Z.ai's route and gateways take. _Reason:_ each origin gets the header
   it documents; the header is preset data.
3. **Anthropic thinking may be absent.** Adaptive thinking sent no block on a
   trivial tool call even on Opus 5.5, which is "always thinking". When it
   does think, the 5.x text is omitted and the signature carries it. So the
   codec never assumes a thinking block precedes `tool_use`, keeps an empty
   thinking text with its signature byte for byte, and treats
   `output_tokens_details.thinking_tokens` as optional. New fields
   (`tool_use.caller`, `container`, `stop_details`, `inference_geo`) are kept
   and replayed as they came (rule 13).
4. **Tool history without `tools`** was accepted by Anthropic (Haiku 4.5) and by
   OpenRouter (a gpt-oss upstream). D74's compaction rule (keep the turn's
   tools with `tool_choice: auto`) stays for every non-Meta codec. _Reason:_
   the cached prefix (tools come first) and vLLM's refusal of an empty list
   still need it, and the rule costs nothing.
5. **xAI emits the argument events itself**, as one `function_call_arguments.delta`
   holding the whole arguments. The research expected the codec to synthesise
   them. The Responses codec therefore just accepts a single delta, and never
   synthesises one. xAI also streams a reasoning summary unasked, which is
   shown like any reasoning summary.
6. **Reported cost.** xAI's `cost_in_usd_ticks` (1e-10 USD) joins OpenRouter's
   `cost` as a settlement source. xAI's list prices use the same unit per
   token.
7. **Prices from the providers' lists.** Groq's list now prices models (USD per
   token, as OpenRouter's), and Hugging Face's router prices each upstream.
   Both join the list-priced sources, with Hugging Face reserving at its
   highest upstream as OpenRouter does. Fireworks' lists carry **no** prices,
   so Fireworks moves to the catalogue. Fireworks' `/inference/v1/models` now
   gives `supports_tools` and `context_length`, so it is the scan; the account
   API is extra detail.
8. **Windows from lists.** Fireworks and Hugging Face are added. OpenAI and
   Z.ai give none (catalogue).
9. **Together: listed is not callable.** A listed, priced model can be
   non-serverless (a free 400 `model_not_available`). The scan keeps every
   chat model. The Recommended and Cheapest-capable badges and the default
   suggestion draw only on models the catalogue marks serverless. The codec
   maps the refusal to "This model needs a dedicated endpoint on Together",
   with the link Together returns. The preset uses `api.together.ai`, the
   documented host. The `final` word leaked after replaying `reasoning` was
   seen once: the preset keeps replaying (Together documents it), and M95's
   live turn on Together checks it again; if it recurs, the preset drops the
   replay for gpt-oss models.
10. **DeepSeek's replay rule.** The documented 400 for a missing
    `reasoning_content` did not occur within the current turn. The codec
    still replays it on every earlier turn when tools are sent, as the docs
    require across turns. The test asserts the replay, not a refusal.
11. **Gemini.**
    - A function call ends with `finishReason: "STOP"`, so the codec detects
      tool calls by `functionCall` parts.
    - An error comes as JSON under `text/event-stream`, so the transport's
      error parser reads any 4xx/5xx body by its content, not its content type.
    - Implicit caching did not appear in two calls, so Gemini's cached count
      is "unknown, not zero", and M74's economics get the window rule only
      until a hit is captured.
12. **Usage can share a chunk with content.** Mistral sends the whole tool call,
    the finish reason and the usage in one chunk. DeepSeek, OpenRouter and Z.ai
    put usage on the finish chunk. Groq, Together and Fireworks use a separate
    `choices: []` chunk. The `chat` codec reads deltas and usage from every
    chunk. "Any chunk carrying usage is accounting" stays, but never at the
    cost of its deltas.
13. **`stream_options.include_usage` was accepted** by every Chat preset sent
    it: Mistral (where the research found the pages contradictory), Groq,
    Together, Fireworks, DeepSeek, Hugging Face, Z.ai and OpenRouter. The
    preset flag stays for local servers.
14. **Account ids in errors and headers.** Several places carry them:
    - xAI's error text names the team id;
    - OpenRouter's error and `/key` bodies carry `user_id`, `creator_user_id`
      and `workspace_id`;
    - Anthropic's and OpenAI's headers carry organization, workspace and
      project ids.

    Lane S's redaction gains these (the id fields, those headers, and a UUID
    after "team", "account", "organization" or "project" in prose), so no
    error a user sees or a log holds names the account.

15. **OpenAI lists only the key's allowed models.** This key's project allowed
    one model, and the list showed one. The scan therefore reflects the key, and
    "no models" from a valid key says the project restricts models, not that
    the key failed.

## Not captured here

- **Azure OpenAI.** It needs a resource and a deployment the owner has not
  given.
- **The local servers** (Ollama's native API, LM Studio, vLLM, llama.cpp
  server) and the generic formats served from them. These are M95 step 1 on
  the rigs, free.
- **The Copilot and ChatGPT-plan sign-ins.** M95b.

These presets stay out of the panel until their own capture is recorded
(rule 13).
