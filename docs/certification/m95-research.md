# M95 research: bring-your-own model providers (2026-10-04)

Recorded 2026-10-04 on branch `feature/m95-byo-providers`, from main
`1e93c67c` (0.12.1). PLAN.md D74, M95 and M95b. This record holds research
only: no code changed and no model was called. The processes run were the
local Muse Code CLI's offline help and version commands, and key-less
requests to OpenRouter's public model and key endpoints. Every fact below
names its source and the date it was read (§7); **UNVERIFIED** marks what
no official source settles, and each such item is a capture step in M95 or
M95b before code depends on it. Raw copies of the pages read are in the
session scratchpad, not in the repository.

## Answers in brief

- **The seam.** The Model API backend already speaks one canonical format
  (Meta's Responses API) and reaches the network through one `client` with
  six calls. A `ProviderClient` with those calls, Meta's client as its
  first implementation, and one codec per wire format beneath it keep
  `ModelApiHost` and every harness feature unchanged (§3, §4).
- **Five codecs cover every provider asked for.** OpenAI Responses (OpenAI,
  Azure, xAI; OpenAI's current reasoning models call tools only there),
  Chat Completions (OpenRouter, Groq, DeepSeek, Mistral, Together,
  Fireworks, LM Studio, vLLM, llama.cpp, any compatible server), Anthropic
  Messages (also Claude on Bedrock), Gemini `generateContent`, and Ollama's
  native API (only it can set the context window per request; the default
  can be 4k) (§1).
- **Prompt caching and reasoning replay differ per provider and bind the
  cached prefix**: breakpoints on Anthropic, automatic with routing keys on
  OpenAI and others, implicit or paid stored caches on Gemini, nothing
  priced locally; per-model cache-read and cache-write prices; reasoning
  replayed only to its own provider, in its own form (§1, §5).
- **Two findings change our harness.** Anthropic's preserved thinking makes
  replayed thinking invalid after any edit of earlier history, which
  ObservationPack's swap and the media budget make; and several providers
  refuse or penalise a compaction request with no tools (§5).
- **The leaders.** Plain-text key files are common (Cline, OpenCode, Kilo,
  Continue) and three let a workspace file redirect a key (Continue,
  OpenCode, Roo); Zed and Copilot BYOK keep keys in the keychain. Continue
  is read-only and Roo archived this year (§2).
- **The catalogue.** models.dev (MIT, per-million prices with cache reads
  and writes, base URLs, capability flags), vendored as a filtered, dated,
  checksummed snapshot; no run-time fetch (§2.10).
- **`vscode.lm`.** Exposing our models through the stable API lets any
  extension spend the user's key without a consent prompt; consuming
  Copilot's models works for tools but not for the cached prefix, cache
  economics, exact budgets or usage (§2.8, §6.2).
- **Subscriptions.** Real today: **Sign in with ChatGPT** with plan usage
  (DevDay, 2026-09-29; Plus and Pro; open-source local apps need no
  registration; loopback `127.0.0.1` only; preview rules forbid
  `max_output_tokens` and `prompt_cache_retention`); **Copilot through
  `vscode.lm`** (reduced); **OpenRouter** account connection (a key, not a
  plan); **Hugging Face** OAuth (the publisher registers the app);
  plan-backed keys from MiniMax, Alibaba and Mistral. Prohibited:
  **Anthropic** plans in a third-party loop, and **Google**'s consumer
  tiers (which also stopped serving Google's own clients on 2026-06-18).
  Partner-only: xAI's SuperGrok OAuth, Z.ai's coding plan (§6).
- **Muse Code 1.4.2 has providers of its own**
  (`--provider echo|meta|local`) and owns `<config home>/muse/` (§3.4).

## 1. Wire formats and capabilities

### 1.1 OpenAI: Responses and Chat Completions

- **Base and endpoints.** `https://api.openai.com/v1`,
  `Authorization: Bearer`; `POST /responses`, `POST /chat/completions`,
  `POST /responses/input_tokens` (same body as a response, returns
  `input_tokens`), `GET /models` [O8, O13, O14].
- **Chat Completions is no longer a full fallback.** From GPT-5.4 it has no
  tool calling unless `reasoning_effort` is `none`; on GPT-6 Astra and
  GPT-6.1 Sol it has no function calling at all [O3, O4]. So OpenAI's
  models go through the Responses codec, the shape our harness already
  speaks.
- **Tools.** Responses
  `{type: "function", name, description, parameters, strict}`; an omitted `strict` is normalised to strict where possible, and
  an explicit `strict: false` keeps it non-strict, as we send [O2, O4].
  `tool_choice`
  `auto | required | none | {type: "function", name} | allowed_tools`; `none` or `allowed_tools`, rather than dropping tools,
  keeps the cached prefix [O1, O2]. Streaming: `output_item.added`
  (`function_call`), `function_call_arguments.delta` and `.done`,
  `output_item.done` [O2]. Other events to tolerate: `response.queued`,
  `reasoning_text.*`, `reasoning_summary_part.*`, `content_part.*`,
  `response.compaction.compacting` [O12]. `function_call_output.output`
  takes strings or content arrays with images [O2].
- **Reasoning.** `reasoning` takes `effort` (`none`, `minimal`, `low`,
  `medium`, `high`, `xhigh` or `max`), `summary`, `context` and `mode`; with `store: false` the encrypted
  content now comes back by default (the `include` still works); replay
  every output item, reasoning and message `phase` included; reasoning is
  reused only within a model family [O3, O11].
- **Prompt caching changed with GPT-5.6** [O1, O11]:
  - Writes cost 1.25× input and reads 0.1× (0.05× on GPT-6.1 Sol); breakpoints
    are implicit (the end of the latest eligible message) or explicit
    (`prompt_cache_breakpoint` on content blocks,
    `prompt_cache_options {mode, ttl: "30m", prewarm}`), up to 4 writes per request; top-level
    `instructions` cannot hold a breakpoint; TTL at least 30 minutes.
  - `prompt_cache_retention` is deprecated there; earlier models keep
    `in_memory` or `24h` with no write charge, and `prompt_cache_key`
    routes (under about 15 requests a minute per key).
  - New usage field `input_tokens_details.cache_write_tokens`;
    `cached_tokens` counts toward TPM.
  - **Prefix breakers**: `model`, `tools` (names, descriptions, schemas,
    order), `parallel_tool_calls`, `text.format`, **`reasoning.effort`**
    (it rewrites hidden instructions; on GPT-6 append a
    `configuration_update` item instead), `text.verbosity`, and editing an
    earlier message instead of appending [O1].
- **Usage.** Responses: `response.completed` usage with
  `input_tokens_details {cached_tokens, cache_write_tokens}` and
  `output_tokens_details.reasoning_tokens` [O11]. Chat: a final
  `choices: []` chunk with `stream_options.include_usage`, lost if the
  stream is cut [O9, O10].
- **Models and errors.** `/models` gives only `id`, `created`, `owned_by`,
  `shutdown_date`: no context window [O13]. Errors
  `error {type, code, param, message}`; 429 codes include `rate_limit_error`,
  `credit_balance_exhausted`, `*_spend_limit_exceeded`; quota and billing
  errors must not be retried; `Retry-After` in seconds and
  `x-ratelimit-*` headers [O5, O6].

### 1.2 Azure OpenAI (v1 API)

- `https://{resource}.openai.azure.com/openai/v1/` (or
  `{resource}.services.ai.azure.com`), no `api-version` needed; `api-key`
  header or an Entra bearer token; `model` is the **deployment name**
  [AZ1, AZ6]. The wizard must ask for the resource, the deployment and the
  model family behind it: names are the user's, so caching and reasoning
  gates cannot be read from them.
- Responses as OpenAI's, stored 30 days unless `store: false`; a blocked
  input is a 400 `content_filter` [AZ3]. Sending `prompt_cache_options` or a
  breakpoint to a pre-5.6 model is a 400, so they are gated by family [AZ2].
  Retention on 5.4 and older defaults to `in_memory` [AZ2].
- `GET /openai/v1/models` gives no window and may list base models rather
  than deployments (UNVERIFIED); deployments are listed through Azure's
  management API [AZ5, AZ6]. A 429 carries `retry-after-ms` [AZ5].

### 1.3 xAI

- `https://api.x.ai/v1`, Bearer; `/v1/responses` recommended,
  `/v1/chat/completions` "Deprecated/legacy", the Anthropic-style
  `/v1/messages` "fully deprecated" [X9, X8].
- `store` defaults to true; `max_output_tokens` covers visible output only
  and defaults to 128,000; `prompt_cache_key` maps to `x-grok-conv-id`
  [X6, X9]. **Function calls arrive whole in one chunk**, so the codec
  synthesises the argument events [X3]. Reasoning cannot be turned off on
  grok-4.x; encrypted reasoning comes back and must be replayed unchanged
  [X2].
- Caching automatic, no TTL guarantee; dropping earlier reasoning is "the
  top cause of cache misses"; from 200k prompt tokens every token,
  cached included, is billed at the long-context rate [X1, X4].
- `GET /v1/models` gives `context_length`, prompt, cached and completion
  prices (USD cents per 100M tokens), the long-context threshold and
  supported efforts [X5]. The error body is not documented (UNVERIFIED).

### 1.4 DeepSeek and Mistral

- **DeepSeek** (`https://api.deepseek.com`, Bearer; Chat, Responses,
  `/anthropic`) [D1, D4, D10]. Models `deepseek-flash` and
  `deepseek-v4-pro`, 1M context [D1]. Thinking is on by default;
  `reasoning_content` comes beside `content`; **with `tools` in the
  request, every earlier turn's `reasoning_content` must go back, or the
  request is a 400**; `tool_choice` `required` or named is a 400 in
  thinking mode [D2, D3]. Its Responses API ignores `prompt_cache_key` and
  `encrypted_content` and treats `developer` as `user` [D4], so DeepSeek
  goes through the Chat codec. Disk caching is automatic;
  `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` (and
  `cached_tokens`); prices halve off-peak, so cost depends on the hour; no
  write surcharge [D1, D5, D6]. `GET /models` gives `context_window`,
  `max_output_tokens` and effort levels [D7]. Keep-alives are
  `: keep-alive` comments [D9].
- **Mistral** (`https://api.mistral.ai/v1`, Bearer, Chat only) [M3, M5].
  `parallel_tool_calls` on by default, 128 tools at most; tool results
  carry `name` and `tool_call_id` [M1, M4]. Reasoning (`reasoning_effort`
  on `mistral-small-latest` and `mistral-medium-3-5`) turns `content` into
  a list of `thinking` chunks (with a `signature`) and text, and the whole
  assistant message must be replayed with them [M2]. `prompt_cache_key`;
  cached tokens at 10% of input in 64-token blocks [M3]. Errors are flat
  (`{object: "error", message, type, param, code}`) [M5, M6].
  `GET /v1/models` gives `max_context_length` and `capabilities` [M6]. Several
  pages contradict the OpenAPI file (`stream_options`, cached-token usage,
  image size) [M4, M6, M8].

### 1.5 Anthropic Messages

- **Base URL and auth.** `https://api.anthropic.com`: `POST /v1/messages`,
  `POST /v1/messages/count_tokens`, `GET /v1/models` [A-ov]. The documented
  header is now `Authorization: Bearer <key>`; `x-api-key` is a "legacy
  fallback, still supported" [A-ov]. `anthropic-version: 2023-06-01` is
  required; betas go in `anthropic-beta` [A-ov, A-pt]. Requests up to 32 MB.
- **System and tools.** `system` is a string or text blocks (which take
  `cache_control`) [A-pc]. A tool is `{name, description, input_schema}`
  (names `^[a-zA-Z0-9_-]{1,128}$`); the reply is a
  `tool_use {id, name, input}` block with `stop_reason: "tool_use"`; results go back as
  `tool_result {tool_use_id, content, is_error}` blocks, first in the next
  user message, one per call, images allowed inside [A-dt, A-ht]. Parallel
  calls are on by default; `disable_parallel_tool_use` sits inside
  `tool_choice` [A-pl]. `tool_choice` is `auto | any | tool | none`, but the
  5.5-generation models answer 400 to `any` and `tool` [A-dt, A-er]: our
  `auto`-only harness fits. Changing `tool_choice` invalidates the message
  cache [A-dt].
- **Streaming.** SSE: `message_start`, then per block `content_block_start`,
  `content_block_delta` (`text_delta`, `input_json_delta` with
  `partial_json`, `thinking_delta`, `signature_delta`),
  `content_block_stop`, then `message_delta` (stop reason, **cumulative**
  usage), `message_stop`; `ping` anywhere; mid-stream `event: error` with
  `overloaded_error`; unknown event types must be tolerated, and a new
  `fallback` block can appear [A-st].
- **Images.** base64, URL or file id; jpeg, png, gif, webp; 10 MB and
  8000×8000 px each, stricter above 20 images, 100 or 600 per request [A-vi].
- **Reasoning.** `thinking: {type: "enabled", budget_tokens}` is refused
  (400) from 4.7 and deprecated on 4.6; current models take
  `thinking: {type: "adaptive"}` with `output_config.effort` (`low`,
  `medium`, `high`, `xhigh` or `max`) [A-et, A-th]. Thinking is always on for Opus 5.5
  and the 5.x Fable and Mythos models (`disabled` is a 400); on 5.x the
  thinking text defaults to omitted and the `signature` carries the
  encrypted reasoning [A-th]. Within a tool-use turn every `thinking` and
  `redacted_thinking` block must go back exactly as received, or the
  request is a 400 [A-th, A-er].
- **Preserved thinking binds replay to the prefix.** On Fable 5.1, Opus 5.5
  and Sonnet 5.5, a replayed thinking block is valid only while `system`,
  `tools` and every earlier message are unchanged; accounts created on or
  after 2026-08-31 get a 400 when that is broken, unless the request opts in
  to `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` (beta
  `thinking-binding-controls-2026-08-01`). Shortening an earlier
  `tool_result` counts as an edit; moving `cache_control` markers does not.
  Anthropic's guidance: compaction that summarises the whole session into
  one message is safe; keep-tail compaction fails without `drop_block`
  [A-pt, A-er].
- **Prompt caching.**
  `cache_control: {type: "ephemeral", ttl: "5m" | "1h"}`, at most 4 breakpoints over tools, system and messages; a
  top-level `cache_control` now places one on the last cacheable block
  [A-pc]. The prefix order is tools → system → messages; writes happen only
  at breakpoints and reads look back at most 20 blocks (a run of `tool_use`
  or of `tool_result` counts as one); the TTL counts from the start of the
  request [A-pc]. Minimum cacheable prefix: 512 tokens on 5.x, 1,024 to
  4,096 on older models; below it nothing is cached, silently [A-pc].
  Writes cost 1.25× input (5 m) or 2× (1 h); reads 0.1× input, but 0.05× on
  Opus 5.5 and 0.025× on Fable and Mythos 5.1 [A-pr, A-pc]. Usage reports
  `input_tokens` (after the last breakpoint), `cache_creation_input_tokens`,
  `cache_read_input_tokens` and the TTL split
  `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`;
  total input is their sum [A-pc]. What breaks the cache: tool or system
  changes, `tool_choice`, adding or removing images, any change of thinking
  type, budget or effort, dropped thinking blocks [A-pc, A-th].
- **Models, counting, errors.** `GET /v1/models` now carries
  `max_input_tokens`, `max_tokens` and a `capabilities` object (thinking
  types, effort levels, image input), paginated [A-ml]. `count_tokens` is
  free and an estimate [A-tc]. Errors are
  `{"type": "error", "error": {"type", "message"}, "request_id"}`: 400 `invalid_request_error`, 401,
  402 `billing_error`, 403, 404, 413, 429 `rate_limit_error`, 500
  `api_error`, 504, 529 `overloaded_error` [A-er]; a spend-cap 429 has no
  `retry-after` and says `enforced_spend_limit_reached` [A-rl]. Headers:
  `retry-after`, `anthropic-ratelimit-*`, `request-id` [A-rl].
- **Its OpenAI-compatible endpoint** (`/v1/` Chat Completions) is "for
  testing", with no prompt caching, no thinking content and empty cache
  usage [A-oa]: not usable for M74's economics.

### 1.6 Google Gemini

- **Two APIs.** Google now calls the Interactions API its primary interface
  (GA June 2026); `generateContent` "remains fully supported", and explicit
  caching exists only there (search results for the migration guide; not
  fetched). M95 targets `generateContent`.
- **Base URL and auth.** `https://generativelanguage.googleapis.com/v1beta`,
  `x-goog-api-key` [G-gc, G-ak]; since 2026-05-28 new AI Studio keys are
  bound to service accounts [G-ak]. `POST models/{m}:generateContent` and
  `:streamGenerateContent?alt=sse`; roles `user` and `model`;
  `systemInstruction` is text only [G-gc, G-tg].
- **Tools.** `functionDeclarations {name, description, parameters}` in an
  OpenAPI 3.0.3 subset; `functionCallingConfig.mode`
  `AUTO | ANY | NONE | VALIDATED`; `functionCall {id, name, args}` (Gemini 3 always returns an
  id) answered by `functionResponse {id, name, response}` with role `user`;
  parallel results may come in any order, matched by id [G-fc].
- **Thought signatures.** `thoughtSignature` must go back in the exact part
  it came in; with parallel calls only the first `functionCall` part carries
  one; on Gemini 3 the first call of every step in the current turn must
  carry its signature or the request is a 400; signed and unsigned parts
  must never be merged; foreign or injected history may use the documented
  dummy value `skip_thought_signature_validator` [G-ts, G-fc, G-g3].
- **Thinking.** `thinkingConfig.thinkingLevel` (`minimal`, `low`,
  `medium`, `high`, per model) on 3.x; `thinkingBudget` on 2.5; never both;
  `includeThoughts` returns `thought: true` summary parts;
  `usageMetadata.thoughtsTokenCount` is billed as output [G-th, G-g3].
- **Images.** `inline_data {mime_type, data}`, the whole request under
  20 MB [G-im].
- **Caching.** Implicit caching is on for 2.5 and later, from 4,096 tokens
  on the 3.x models, best effort; explicit `cachedContents` are immutable
  apart from their TTL (default 1 h) and billed per stored token-hour (for
  example $1.00 per million token-hours on 3.5 Flash) on top of the
  reduced read rate (about 10% of input) [G-cc, G-ca, G-pr]. Cached tokens
  count toward the token rate limit [G-cc].
- **Usage and models.** `usageMetadata`: `promptTokenCount` (cached
  included), `cachedContentTokenCount`, `candidatesTokenCount`,
  `thoughtsTokenCount`, `toolUsePromptTokenCount`, `totalTokenCount`, on
  every streamed chunk [G-gc, G-tg]. `models.list` gives `inputTokenLimit`,
  `outputTokenLimit`, `supportedGenerationMethods` and `thinking` [G-mo];
  `:countTokens` takes a whole request [G-tk].
- **Errors.** `{"error": {"code", "message", "status", "details"}}`;
  429 and 402 `RESOURCE_EXHAUSTED` (rate limit, depleted prepay), 500
  `INTERNAL`, 503 `UNAVAILABLE`, 504 `DEADLINE_EXCEEDED` [G-er]; no
  rate-limit headers are documented [G-rl].
- **Its OpenAI-compatible endpoint** (`/v1beta/openai/`, Bearer) serves
  Chat Completions only (no Responses), maps `reasoning_effort` to levels or
  budgets, carries thought signatures as `extra_content.google.thought_signature`
  and is "still in beta" [G-oa, G-ts]. The native API is the one that
  exposes cached-token usage and thought signatures as documented.

### 1.7 AWS Bedrock

- **Endpoints.** `bedrock-runtime.{region}.amazonaws.com` serves Converse,
  InvokeModel, OpenAI Chat Completions and Responses under `/openai/v1`, and
  the **Anthropic Messages API** under `/anthropic/v1/messages`;
  `bedrock-mantle.{region}.api.aws` serves Responses, Chat Completions and
  Messages [B-ep, B-ra, B-ma]. The compatibility table lists Messages for
  Claude 5.x, Opus 4.7/4.8 and Haiku 4.5, and no Chat Completions or
  Responses for Claude [B-ac].
- **Auth.** SigV4 everywhere; or Bedrock API keys as a bearer token:
  short-term (up to 12 h, minted from AWS credentials, "recommended") or
  long-term ("for exploration only") [B-ak]. On the `/anthropic/` routes the
  key goes in `x-api-key` with `anthropic-version` [B-ma, A-br].
- **Messages on Bedrock** is "standard SSE streaming" with prompt caching,
  thinking, tools and vision, and Anthropic-shaped errors; no models
  endpoint, no Files API, no server tools [A-br, B-ma, B-ct].
- **Converse and InvokeModel streams** are `application/vnd.amazon.eventstream`
  (binary, length-prefixed, CRC32) [B-iw]; Converse usage reports
  `inputTokens` (uncached), `cacheReadInputTokens`, `cacheWriteInputTokens`
  [B-cs, B-pc].
- **Responses on Bedrock** serves OpenAI's GPT models only; `store`
  defaults to true (30 days), so `store: false` must always be sent [B-ra].
- **Models.** `ListFoundationModels` has no context window or output limit
  [B-fm]; a static table is needed.
- **Quotas.** `input + max_tokens` is reserved at the start and output burns
  quota at 5× to 15× by model; cache reads do not count [B-qr, B-tb].
- **Conclusion.** A Bedrock adapter needs neither the AWS SDK nor an
  event-stream decoder: Claude goes through the Anthropic codec with a
  regional base URL and `x-api-key`, GPT through the Responses codec. Only a
  long-term key works without SigV4, and AWS calls it exploration-only;
  short-term keys need SigV4 to mint. Bedrock is therefore wave two.

### 1.8 OpenAI-compatible hosts

- **OpenRouter** (`https://openrouter.ai/api/v1`, Bearer) [OR-ref].
  - `GET /api/v1/models` is public (466 models without a key on
    2026-10-04): `context_length`, `top_provider.max_completion_tokens`,
    `supported_parameters`, and per-token USD prices as decimal strings
    (`prompt`, `completion`, `input_cache_read`, `input_cache_write`, and,
    beyond the docs, `input_cache_write_1h` and tiered `overrides`); a price
    that does not apply is left out, not `"0"` [OR-models, live check].
    `parallel_tool_calls` is listed for only 13 models [live check].
  - **The key test is `GET /api/v1/key`**: "free and does not consume
    credits", 401 without a key (checked), with limits and free-tier use
    [OR-limits]. `/models` cannot test a key.
  - Usage is always returned now, in the last SSE message, a separate
    accounting frame before `[DONE]`: `prompt_tokens_details.cached_tokens`,
    `cache_write_tokens`, `completion_tokens_details.reasoning_tokens`,
    `cost` [OR-usage, OR-stream]. Keep-alive comments
    `: OPENROUTER PROCESSING` must be skipped [OR-stream].
  - Caching passes through: automatic for OpenAI, DeepSeek, Grok and Groq
    upstreams; `cache_control` (top-level or per block) for Anthropic and
    Gemini; sticky routing to the same upstream for 10 minutes, or
    `session_id` / `x-session-id` [OR-cache].
  - Reasoning: `reasoning: {effort | max_tokens | exclude | enabled}` in;
    `message.reasoning` and `reasoning_details[]` (summary, encrypted, text
    with signature) out; with tool calls `reasoning_details` must go back
    "unmodified" and in order [OR-reason].
  - "The `tools` parameter must be included in every request" [OR-tools].
    Routing: `provider.data_collection` (`allow` by default) and `zdr`
    [OR-routing].
  - Errors: `{"error": {"code": <number>, "message", "metadata"}}`, 402 for
    credits, 403 moderation; mid-stream errors keep HTTP 200 with a string
    `code` and `finish_reason: "error"` [OR-err, OR-stream]. A stateless
    Responses API (beta) and an Anthropic-style `/api/v1/messages` exist
    [OR-resp, OR-msgs].
- **OpenRouter as a first-class provider** (the owner asked for it on
  2026-10-04; [OR2-*] keys are the follow-up read the same day).
  - **Connect, no copy-paste.**
    `https://openrouter.ai/auth?callback_url=… &code_challenge=…&code_challenge_method=S256` (plus `key_label`,
    `state`); "Localhost callbacks are supported on any port" (https and
    `localhost`/`127.0.0.1`); a custom `vscode://` scheme is not
    documented; with no `callback_url` the page shows a code to paste
    (needs the challenge), which suits remote windows. Exchange with
    `POST https://openrouter.ai/api/v1/auth/keys`
    `{code, code_verifier, code_challenge_method}` → `{key, user_id}`; codes are single-use and
    last 10 minutes; no registration [OR2-oauth, OR2-spec]. A key cannot be
    given a limit through the browser flow; the user sets one on the key's
    page, deep-linked by the key's SHA-256
    (`https://openrouter.ai/keys/{hash}`), and revokes it at
    `/settings/keys` [OR2-oauth, OR2-spec].
  - **Credits and usage.** `GET /api/v1/key` (free, a normal key) gives
    `limit`, `limit_remaining`, `limit_reset`, `usage` and its daily,
    weekly and monthly parts, `is_free_tier` and
    `free_model_daily_requests`; `/api/v1/credits` and the key-management
    API need a separate management key, which cannot run inference
    [OR2-limits, OR2-mgmt].
  - **Attribution.** `HTTP-Referer` creates the app's page;
    `X-OpenRouter-Title` names it (`X-Title` still accepted);
    `X-OpenRouter-Categories` takes up to two of a fixed list
    (`ide-extension`); all optional [OR2-attr].
  - **Privacy routing.** `provider.data_collection: "deny"` ("use only
    providers which do not collect user data"; `allow`, the default, may
    "store user data non-transiently and may train on it") and
    `provider.zdr: true` (ZDR "means that a provider will not store your
    data for any period of time"; the request can turn it on, never off,
    against the account's setting); `order`, `allow_fallbacks`, `only`,
    `ignore`, `sort`, `max_price`; no matching provider is a 503
    [OR2-route, OR2-zdr, OR2-err]. `GET /api/v1/models?zdr=true` (331
    models) and `/api/v1/endpoints/zdr` need no key [live]. Some `:free`
    endpoints train on or publish prompts [OR2-free].
  - **Prices for budgets.** USD per token as decimal strings: `prompt`,
    `completion`, `input_cache_read`, `input_cache_write` (5 min),
    `input_cache_write_1h`, `internal_reasoning`, per-request `request`,
    per-image `image`, a `discount`, and `overrides` tiers (by prompt size
    or a UTC window); missing keys mean the price does not apply
    [OR2-spec, live]. `/models?supported_parameters=tools` filtered 376
    models (with `parallel_tool_calls`, 9) [live]. Per-upstream endpoints,
    each with its own prices and context, at
    `/api/v1/models/{author}/{slug}/endpoints` without a key [live]. The
    final usage carries the actual `cost` [OR-usage].
  - **Caching and reasoning.** `cache_control` on text parts, on tools and
    at the top level (four breakpoints, `1h` on Anthropic, Bedrock and
    Vertex upstreams; for Gemini only the last breakpoint counts); usage
    `cached_tokens` and `cache_write_tokens` [OR2-cache].
    `reasoning {effort}` in; `reasoning_details` back, "The entire sequence of
    consecutive reasoning blocks must match", with formats
    `anthropic-claude-v1`, `openai-responses-v1`, `google-gemini-v1`;
    signatures survive by design (UNVERIFIED live) [OR2-reason].
  - **Errors.** `metadata.error_type` (`authentication`,
    `payment_required`, `permission_denied`, `rate_limit_exceeded`,
    `context_length_exceeded`…); a 402 names `limit_source`
    (`openrouter_credits`, `openrouter_key_limit`,
    `openrouter_in_flight_budget`) with a `remedy_hint` [OR2-err].
- **Groq** (`https://api.groq.com/openai/v1`) [GQ-compat, GQ-ref].
  `messages[].name`, `logprobs`, `logit_bias` and `n ≠ 1` are a 400;
  `max_completion_tokens`; `parallel_tool_calls` on by default but not on
  the GPT-OSS models [GQ-tools]; reasoning through `reasoning_format`
  (`parsed` → `message.reasoning`, `raw` → `<think>` in content, refused
  with tools) and `reasoning_effort` [GQ-reason]. The models list gives
  `context_window` and `max_completion_tokens`, no prices [GQ-ref]. Prompt
  caching only on the gpt-oss models: automatic, 50% off, 2 h TTL, in
  `prompt_tokens_details.cached_tokens` [GQ-cache]. Usage may arrive as
  `usage` or `x_groq.usage` (partly UNVERIFIED) [GQ-sdk]. Errors
  `{"error": {"message", "type"}}`, plus 498 and 499; `x-ratelimit-*`
  headers always [GQ-err, GQ-rl].
- **Together** (`https://api.together.ai/v1`) [TG-compat]. `GET /v1/models`
  is a bare array with `context_length` and `pricing` (input, output,
  `cached_input`) [TG-sdk, TG-models]; `max_tokens` only, no
  `parallel_tool_calls` or `stream_options` in its types; `finish_reason`
  can be `eos`; a final usage-only chunk [TG-chat, TG-gptoss]. Reasoning is
  `reasoning`, `reasoning_content` or `<think>`, by model, replayed
  unmodified [TG-reason]. Caching automatic and best effort on models with
  a cached price; its usage field is UNVERIFIED [TG-pricing]. 403 can mean
  "input + max_tokens over the context length" [TG-err].
- **Fireworks** (`https://api.fireworks.ai/inference/v1`) [FW-compat].
  `max_completion_tokens` is an alias of `max_tokens` (never both);
  `context_length_exceeded_behavior` defaults to `truncate`, silently
  lowering `max_tokens`; `reasoning_content`; arguments stream in pieces;
  usage on the finish chunk without opt-in [FW-compat, FW-fc, FW-reason].
  Caching is on, 50% by default, with `x-session-affinity` or
  `prompt_cache_key` for affinity [FW-cache]. The models list is an
  account API (`/v1/accounts/fireworks/models`, `contextLength`,
  `supportsTools`, `skuInfos` prices), not OpenAI's shape [FW-models]. Its
  Responses API stores by default [FW-resp]. Validation errors are FastAPI
  `{"detail": [...]}` [FW-chat].

### 1.9 Local servers

- **Ollama** (v0.35.1, 2026-09-29).
  - Native `/api/chat` streams NDJSON by default; `think` (bool or a
    model's level), `options.num_ctx`, `images[]` base64,
    `tool_calls[].function.arguments` as an object, `thinking` on messages,
    `tool_name` on results; the last line has `prompt_eval_count`,
    `prompt_eval_cached_count`, `eval_count`; errors `{"error": "…"}`, also
    as a mid-stream line [OL-chat, OL-usage, OL-err].
  - `/api/show` gives `capabilities` (`tools`, `thinking`, `vision`) and
    `model_info["<arch>.context_length"]`, the **trained** maximum; `/api/ps`
    the loaded context [OL-openapi].
  - **The effective context defaults by VRAM: under 24 GiB 4k, 24–48 GiB
    32k, 48 GiB and up 256k**; it is set by `OLLAMA_CONTEXT_LENGTH`, the
    app, a Modelfile, or `options.num_ctx` on the native API only; the docs
    recommend at least 64k for agents [OL-ctx, OL-faq].
  - The OpenAI-compatible `/v1/chat/completions` has no `tool_choice`, no
    image URLs and **no way to set `num_ctx`**; tool calls come whole;
    `reasoning` field; cached tokens from `prompt_eval_cached_count`
    [OL-oai, OL-go]. Also a stateless `/v1/responses` and an Anthropic-style
    `/v1/messages` without `cache_control` [OL-oai, OL-anth].
  - **So M95 speaks Ollama's native API**: our system prompt and tools
    alone would overflow a 4k default, silently, through `/v1`.
- **LM Studio** (`http://localhost:1234/v1`, auth off by default, Bearer
  when on) [LM-oai, LM-auth]: Chat Completions with tools (native for some
  models, prompt-injected for others), `include_usage` since 0.3.18,
  `reasoning` since 0.3.23, a stateful `/v1/responses` since 0.3.29, an
  Anthropic-style `/v1/messages` since 0.4.1 [LM-chg]. Its REST
  `GET /api/v1/models` gives `max_context_length`, the loaded
  `context_length` and `capabilities.trained_for_tool_use` [LM-rest-list].
- **vLLM** (v0.30.0, 2026-09-22): tool calls need `--enable-auto-tool-choice
--tool-call-parser`; **an empty `tools: []` is rejected**; calls stream
  whole; the reasoning field is `reasoning` (formerly `reasoning_content`);
  cached tokens only with `--enable-prompt-tokens-details`; `/v1/models`
  carries `max_model_len`; `--api-key` [VL-tools, VL-reason, VL-cli,
  VL-proto].
- **llama.cpp server** (README of 2026-10-03): `--jinja` on by default;
  `-c 0` uses the trained context; `/props` gives `n_ctx` and `/v1/models`
  `meta.n_ctx_train`; `tool_choice` only as a string; arguments stream in
  fragments after a header chunk; `reasoning_content` with
  `--reasoning-format deepseek`; `cache_prompt` on by default and
  `prompt_tokens_details.cached_tokens`; errors include
  `exceed_context_size_error` [LC-readme, LC-src].
- None of the four has prices: local use costs no tokens.

### 1.10 The Chat Completions family: what one adapter must absorb

| Concern               | What differs                                                                                                                                                                 | What the adapter does                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Tool-call deltas      | fragments keyed by `index` with `id` and `name` once (llama.cpp, LM Studio, Fireworks, OpenAI); whole calls in one chunk (Ollama `/v1`, vLLM); Together's `index` is a float | key by `index`, else a running ordinal; append arguments; parse at the finish          |
| `parallel_tool_calls` | accepted by some, absent or refused by others (Groq rejects unknown fields)                                                                                                  | send only where the preset says so                                                     |
| `tool_choice`         | `auto` almost everywhere; Ollama has none; llama.cpp only strings                                                                                                            | send `auto`, or omit where the preset says                                             |
| Empty tools           | vLLM rejects `tools: []`; OpenRouter wants `tools` on every request                                                                                                          | never send an empty list; see §5 on compaction                                         |
| Reasoning out         | `reasoning` (OpenRouter, Groq, vLLM, Ollama, LM Studio), `reasoning_content` (Fireworks, llama.cpp, DeepSeek), `reasoning_details` (OpenRouter), `<think>` in content        | read all, split `<think>` tags, unclosed ones too                                      |
| Reasoning replay      | back under the same field, unmodified, to the same provider (OpenRouter, Fireworks, Together, DeepSeek)                                                                      | keep the raw payload and field per turn; drop it for any other provider                |
| Usage in stream       | always (OpenRouter, Fireworks, Together), opt-in `stream_options.include_usage` (Groq, vLLM, Ollama, LM Studio, llama.cpp)                                                   | ask where allowed; any chunk carrying `usage` is accounting, even with empty `choices` |
| Cached tokens         | `prompt_tokens_details.cached_tokens` (most), `cache_write_tokens` (OpenRouter), `created_cache_tokens` (vLLM), `prompt_cache_hit_tokens` (DeepSeek)                         | normalise to read and write counts; missing means unknown, not zero                    |
| `finish_reason`       | `eos` (Together), `error`, `abort`, `repetition` (vLLM), `length` with empty content (reasoning ran out)                                                                     | map to completed, incomplete or failed                                                 |
| Errors                | `code` number or string, `{"error": "text"}`, `{"detail": [...]}`, 403 for context overflow (Together), mid-stream errors under HTTP 200                                     | one tolerant parser; classify overflow by type or message                              |
| Output cap            | `max_completion_tokens` (Groq, vLLM), `max_tokens` (Together, Ollama, LM Studio), either but never both (Fireworks)                                                          | per preset                                                                             |
| Keep-alives           | SSE comments (OpenRouter), NDJSON (Ollama native)                                                                                                                            | skip comments; a separate NDJSON reader                                                |
| Context window        | `context_length`, `context_window`, `max_model_len`, `max_context_length`, `n_ctx`, or none                                                                                  | per preset; prefer the loaded value to the trained maximum                             |

## 2. How the leaders configure providers

Two of them changed status this year: **Continue is read-only** ("no
longer actively maintained", final 2.0.0 on 2026-06-19, the Hub removed)
and **Roo Code is archived** (last release v3.54.0, 2026-05-15) [CN-repo,
RO-repo]. Kilo Code is now a fork of OpenCode [KI-readme].

### 2.1 Continue (final release)

- `~/.continue/config.yaml`: `models:` with `name`, `provider`, `model`,
  `apiBase`, `roles`, `capabilities` (`tool_use`, `image_input`) and
  `defaultCompletionOptions.contextLength` [CN-config, CN-ref].
- Onboarding shows password fields for three providers, then writes the key
  **into `config.yaml` as plain text** with a fixed model list and
  hard-coded limits; or the user writes `${{ secrets.NAME }}`, resolved from
  the workspace `.env`, then `.continue/.env`, then `~/.continue/.env`, then
  the process environment [CN-onboarding, CN-faq]. No prices anywhere.
  Ollama `AUTODETECT` lists installed models [CN-ollama].
- Workspace `.continue/models` blocks are "applied automatically"; no trust
  gate was found, so a committed model file could pair a hostile `apiBase`
  with a secret from the user's `.env` (inference) [CN-workspace].

### 2.2 Cline (v4.1.22)

- About 50 providers; gear → provider → key or OAuth → model [CL-docs].
- **Keys moved out of VS Code's SecretStorage into
  `~/.cline/data/secrets.json`**, plain JSON with mode 0600; the migration
  copied them and left the SecretStorage copies in place [CL-storage,
  CL-migration]. The webview only ever sees a masked key; the host attaches
  it [CL-openaicompat].
- Prices and windows come from a **models.dev catalogue checked in at build
  time** ("requires both upstream sources to succeed so an outage cannot
  replace the bundled catalogs with partial data") with a live refresh;
  `ModelInfo` carries `contextWindow`, `maxTokens`, `inputPrice`,
  `outputPrice`, `cacheReadsPrice`, `cacheWritesPrice` and `tiers`
  [CL-catalog, CL-api].
- A custom OpenAI-compatible provider asks for base URL, key, model id,
  headers, images, context window, max output and prices [CL-openaicompat].
  Plan and Act can use different models [CL-state].

### 2.3 Roo Code (archived)

- API configuration profiles, chosen per mode and remembered per task;
  keys in VS Code's SecretStorage as one JSON blob; exports carry keys in
  plain text [RO-profiles, RO-manager, RO-export]. A hard-coded catalogue
  plus live router lists (OpenRouter's prices and windows) [RO-anthropic,
  RO-openrouter]. `autoImportSettingsPath` is read with workspace values,
  so a trusted workspace can import provider profiles (inference)
  [RO-autoimport].

### 2.4 Kilo Code and OpenCode

- **OpenCode** (now `anomalyco/opencode`): config merged from remote,
  global, project and `.opencode` sources; a provider is `npm`,
  `options {apiKey, baseURL}`, `models` with `limit` and `cost`; `{env:VAR}` and
  `{file:path}` substitution [OC-config, OC-provider]. `opencode auth login`
  writes `~/.local/share/opencode/auth.json`, **plain JSON** (0600), API
  keys and OAuth tokens alike [OC-providers, OC-auth]. The catalogue is
  models.dev through a mirror, a bundled snapshot as fallback, refreshed
  hourly [OC-modelsdev]. **No trust prompt: a cloned repository's
  `opencode.json` can override a provider's `baseURL`**, sending the stored
  key elsewhere (inference) [OC-configts].
- **Kilo Code** v7.8.3 rebuilt its extension on its OpenCode fork; its own
  gateway needs only a sign-in, and BYOK keys go to its web platform and
  route through the gateway; a custom provider takes id, name, API format
  (OpenAI-compatible, Responses, Anthropic Messages), base URL, key, models
  and headers, with models fetched from `/v1/models` [KI-providers,
  KI-byok, KI-openaicompat]. Its own migration plan flags the plain-text
  `auth.json` and asks whether SecretStorage should be used [KI-plan].

### 2.5 Zed

- Keys "saved through Zed are stored in the system keychain, not in
  `settings.json`"; non-empty environment variables take precedence; "Do
  not put API keys in `settings.json`"; in remote projects the keys come
  from the local keychain [Z1].
- Settings → AI → LLM Providers: **Add Provider** asks for a name, API URL,
  model id and context window [Z1, Z4]. `openai_compatible` models carry
  `max_tokens` (the window, mandatory: "You must provide the model's
  context window"), `max_output_tokens`, `reasoning_effort` and
  `capabilities` with defaults `tools: true`, `images: false`,
  `parallel_tool_calls: false`, `prompt_cache_key: false`,
  `chat_completions: true` (false sends Responses),
  `interleaved_reasoning: false`; `anthropic_compatible` has `prompt_caching`, off by default,
  "leave it disabled if the provider rejects requests containing them"
  [Z1]. Headers Zed manages (Authorization and the provider's auth) are
  ignored with a warning when set by hand [Z1].
- Ollama's pulled models are discovered; Zed sends `num_ctx`, default 4096,
  overridable per model; llama.cpp's window and tool support come from
  `/props` [Z2].
- Subscriptions: ChatGPT Plus/Pro through an OpenAI sign-in; Claude Pro/Max
  has "No direct Zed LLM provider path" [Z5].
- A project-settings restriction on providers is UNVERIFIED.

### 2.6 Aider

- LiteLLM for providers, `provider/model` names [AI1]. Keys from flags
  (`--api-key provider=key`), environment variables, `.env` files (home,
  git root, cwd, later wins) and `.aider.conf.yml` [AI2, AI3, AI7].
- Unknown models: `.aider.model.metadata.json` in LiteLLM's format
  (`max_input_tokens`, `input_cost_per_token`…), from the same places;
  without it Aider warns "Unknown context window size and costs, using sane
  defaults" and "will use an unlimited context window and assume the model
  is free" [AI4, AI5].

### 2.7 GitHub Copilot BYOK in VS Code

- **Chat: Manage Language Models** opens the Language Models editor
  (capabilities, context size, billing, visibility); **Add Models** → a
  provider → a group name → the key or URL; when more is needed VS Code
  opens `chatLanguageModels.json` [V1]. Built in: Anthropic, xAI, Google,
  OpenRouter, OpenAI, Azure and a Custom Endpoint (`apiType`
  `chat-completions`, `responses` or `messages`, model fields `toolCalling`,
  `vision`, `maxInputTokens`, `maxOutputTokens`, `thinking`,
  `reasoningEffortFormat`, `zeroDataRetentionEnabled`, `requestHeaders`);
  Ollama and "OpenAI Compatible" are deprecated in favour of extensions and
  the Custom Endpoint [V1, V11].
- Keys: `"apiKey": "${input:…}"` in the file, the value in VS Code's secret
  storage under `chat.lm.secret.<hash>` [V1, V10].
- "BYOK models work without signing into a GitHub account and without a
  Copilot plan"; Business and Enterprise since 2026-04-22, under a policy
  on by default; billed by the provider [V1, V3]. Completions, semantic
  search and embeddings still need GitHub; agent mode lists only models
  with tool calling; an untrusted workspace shows only Auto [V1].

### 2.8 VS Code's Language Model API

- **Exposing models.** `contributes.languageModelChatProviders` and
  `vscode.lm.registerLanguageModelChatProvider`, finalized in 1.104 (August 2025) [V13, V5, V7]: `LanguageModelChatInformation` (`maxInputTokens`,
  `maxOutputTokens`, `capabilities.toolCalling`, `imageInput`),
  `provideLanguageModelChatResponse`, `provideTokenCount`. Contributed
  models appear in the chat picker and the Language Models editor without a
  Copilot plan [V1, V5]. Still proposed, so not publishable on the
  Marketplace [V15]: consent gating (`requiresAuthorization`), thinking
  parts, prices (`languageModelPricing`, in AI credits), the system role
  [V8]. **The consent prompt for another extension calling our models runs
  only for providers with the proposal, so through the stable API any
  installed extension could spend the user's key without a prompt** [V9,
  source].
- **Consuming models.** `vscode.lm.selectChatModels` and
  `LanguageModelChat.sendRequest` with tool parts [V6, V7]: no system
  messages ("the Language Model API doesn't support the use of system
  messages"), no usage, token, cost, cache or stop-reason fields in the
  stable stream, a consent dialog for Copilot's models, rate blocks, and
  Copilot wraps another extension's request in its own system message
  (`SafetyRules`, `EditorIntegrationRules`) [V6, V7, V12, source]. Use is
  under GitHub's Copilot extensibility policy [V6, V16].
- **What that means for us.** Exposing is cheap but needs our own per-model
  opt-in until consent can be required, and our budgets would still see the
  usage because we make the HTTP call. Consuming would break M74's cache
  economics (no cache control, no cache usage), M82's dollar budgets (no
  usage or price), reasoning replay and the byte-stable prefix (Copilot's
  injected system text). Two pickers and two key entries would coexist;
  neither extension can read the other's secrets [V7, V10].

### 2.9 Claude Code

- `apiKeyHelper` runs a shell command and sends its output as both
  `X-Api-Key` and `Authorization: Bearer`, re-run after a TTL (five minutes,
  `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`), a 401 or 403, or an expired JWT; a
  helper from project or local settings runs only after the workspace trust
  prompt, and the docs say "Don't put the credential in a project's
  `.claude/settings.json`" [C1, C2].
- Gateways: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_CUSTOM_HEADERS`; a gateway must expose Anthropic Messages,
  Bedrock InvokeModel or Vertex rawPredict, stream unbuffered, forward
  `cache_control` unchanged ("if it is stripped, every turn bills as
  uncached input and there is no error") and return error bodies unmodified
  [C3, C5]. Model discovery from a gateway is opt-in and "treats redirects
  as failure" [C5]. Anthropic "doesn't support routing Claude Code to
  non-Claude models through any gateway" [C4].

### 2.10 The catalogue: models.dev or LiteLLM

|                | models.dev                                                                               | LiteLLM `model_prices_and_context_window.json`                                                  |
| -------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Licence        | MIT, "Copyright (c) 2025 models.dev", the data included [MD-license]                     | MIT (outside `enterprise/`), Copyright (c) 2023 Berri AI [LL-license]                           |
| Size           | `api.json` 5,314,706 bytes, 226 providers, 8,388 model entries [MD-api, measured]        | 3,041,091 bytes, 4,473 entries, 139 providers [LL-file, measured]                               |
| Prices         | USD per million tokens: `cost.input`, `output`, `cache_read`, `cache_write`, `reasoning` | USD per token, with cache-creation over 1 h and batch variants                                  |
| Limits         | `limit.context`, `input`, `output`                                                       | `max_input_tokens`, `max_output_tokens`                                                         |
| Capabilities   | `tool_call`, `reasoning`, `attachment`, `modalities`, `open_weights`, `status`           | `supports_function_calling`, `supports_prompt_caching`, `supports_reasoning`, `supports_vision` |
| Provider facts | base URL, key variable names, docs link                                                  | provider name only                                                                              |
| Cadence        | 603 commits in the 7 days to 2026-10-04, mostly automated syncs                          | 538 commits to the file since 2026-09-04                                                        |
| Used by        | Cline (checked in at build), OpenCode (bundled snapshot)                                 | LiteLLM, Aider                                                                                  |

**Choice: models.dev, vendored.** It is per million (what the wizard
shows), carries base URLs and capability flags, and its MIT licence permits
a dated copy with the notice. A sync script filters it to the presets'
providers and their tool-capable chat models, checks the download's
SHA-256 into `VENDOR.json` as D68 does, and refuses partial data, as Cline
does. No run-time fetch: D4 allows network calls only to the providers the
user chose.

### 2.11 What M95 takes, and where it departs

- **Taken.** Keys only in secret storage, the webview never seeing one
  (Cline's mask, Zed's keychain, Copilot's `${input:}`); presets for known
  providers and a custom endpoint with capability flags and conservative
  defaults (Zed, Copilot); the window required for an unknown model (Zed);
  live model lists joined with a vendored catalogue (Cline, OpenCode);
  prices per million with cache read and write (Cline, models.dev); the
  model pinned per conversation (Roo, Kilo); a key test that bills nothing
  (OpenRouter's `/key`).
- **Departed from.** Plain-text key files (Cline, OpenCode, Kilo, Continue);
  workspace files that can set an endpoint or a key (Continue, OpenCode,
  Roo's auto-import); environment-variable keys (Zed, Aider); unknown models
  assumed free (Aider) or limited to 0 (Kilo); a run-time catalogue fetch
  (OpenCode).

## 3. Our code: where the Model API backend is Meta-specific

Read at `1e93c67c`. Paths are under `src/` unless they say otherwise; line
numbers are that commit's.

### 3.1 The seam that already exists

`ModelApiHost` reaches the wire only through its `client` dependency
(`core/backends/modelapi/ModelApiHost.ts:390`), and only through these calls:

| Call                              | Where                                                                                                              | What for                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `streamResponse`                  | `ModelApiHost.ts:3542` (a turn's request), `:8599` (compaction's), `reviewerEntry.ts:227` (the paid Auto reviewer) | the streamed `POST /responses`                                    |
| `countInputTokens`                | `ModelApiHost.ts:8708`, once, after a compaction                                                                   | the context gauge and M82's budget base; a failure is only logged |
| `listModels`                      | `ModelApiHost.ts:10408`                                                                                            | the picker's list                                                 |
| `currentKeyDigest`                | `ModelApiHost.ts:3921`, `:5053`, `:5075`                                                                           | binding a consent or child grant to the key                       |
| `retryDelayMs`, `waitBeforeRetry` | `ModelApiHost.ts:3483`, `:3495`                                                                                    | whole-stream retries                                              |
| `createImage`, `editImage`        | `imageGeneration.ts:286`, `host/ide/imageTools.ts:81`                                                              | Meta's image endpoints (M34, M44)                                 |

Everything the host builds and reads is one canonical shape, Meta's
Responses API: `CreateResponseBody` (`schemas.ts:343`), the `StreamEvent`
union (`:196`), `ResponseObject` (`:180`) and `Usage` (`:164`). The request
is assembled in `body()` (`ModelApiHost.ts:2552`), keyed for the prompt
cache in `keyed()` (`:2170`) and capped by the M82 budget in `budgeted()`
(`:2215`); the stream is applied in `applyStreamEvent` (`:3317`) and the
output adopted into the replay in `adoptOutput` (`:3641`). The tools, the
permission engine, checkpoints, `then_run` (M68), ObservationPack and
`recall_output` (M73, `observationPack.ts` reads only the generic
`function_call` / `function_call_output` shapes), the verify loop and the
hooks runner work on that shape and name no host. So a provider adapter can
sit entirely under `client`: translate the canonical request to the
provider's wire and the provider's stream back into canonical events.

### 3.2 Inventory of Meta-specific places

| Area           | Where                                                                                                                                                                                                                                                                 | What is Meta's                                                                                                                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL       | `shared/constants.ts:1120` `MODEL_API_BASE_URL`; passed at `host/backend/modelApiBackendManager.ts:246-256`, `extension.ts:1209-1220` (the activation key client for Muse Code's image tools), `core/eval/runner.ts:114`, `runtime/exec/execFetch.ts:90` (origin pin) | `https://api.meta.ai/v1`; `HostInfo` names `meta-model-api` (`constants.ts:1121`, `ModelApiHost.ts:10018`)                                                                                                                            |
| Paths          | `client.ts:415` `/models`, `:426` `/responses/input_tokens`, `:443`/`:452` `/images/*`, `:494` `/responses`; `constants.ts:1994` `EXEC_ENDPOINTS`                                                                                                                     | Responses-only paths                                                                                                                                                                                                                  |
| Auth           | `client.ts:224-236` `headers()`                                                                                                                                                                                                                                       | `Authorization: Bearer`, the key's SHA-256 as `keyDigest`                                                                                                                                                                             |
| Key            | `constants.ts:2978` `MODEL_API_KEY_PATTERN` (`LLM_…`), `:2979` `SECRET_KEYS.modelApiKey`; `host/auth/credentialStore.ts:14-57`; `extension.ts:368` the password box; `runtime/authCommands.ts:33`, `runtime/exec/keyInput.ts:100-129`                                 | one secret, Meta's key shape only                                                                                                                                                                                                     |
| Account        | `modelApiBackendManager.ts:440` `accountId()` = SHA-256 of the Meta key; budgets, schedules and stored sessions are keyed on it (`ModelApiHost.ts:2321`, `:8760`, `:10030`; `sessionStore.ts:88`)                                                                     | identity is the Meta key                                                                                                                                                                                                              |
| Request        | `schemas.ts:343-358`; `ModelApiHost.ts:2552-2578`                                                                                                                                                                                                                     | `tool_choice: 'auto'` only; effort `none` sent as `minimal` (`constants.ts:1268`); `include: ['reasoning.encrypted_content']`; `store: false`; `max_output_tokens` 32,768 (`:1163`); message `phase: 'commentary'` (`schemas.ts:260`) |
| System prompt  | `core/backends/modelapi/instructions.ts:97`                                                                                                                                                                                                                           | "You are Muse Spark"; the date is in the prompt (`:127-131`), so the prefix changes daily                                                                                                                                             |
| Prompt cache   | `promptCache.ts:21-29`; `constants.ts:1186-1198`, `settings.ts:108`                                                                                                                                                                                                   | `prompt_cache_key` over model, instructions and tools; `prompt_cache_retention` `in_memory` or `24h`                                                                                                                                  |
| Stream         | `client.ts:460-559`; `schemas.ts:196-230`; `ModelApiHost.ts:3317-3395`                                                                                                                                                                                                | Responses events; `[DONE]` skipped; `MODEL_API_RETRYABLE_STREAM_CODES` (`constants.ts:1199-1214`: `server_shutting_down`, `service_overloaded`, `backend_unavailable`)                                                                |
| Replay         | `ModelApiHost.ts:3641-3713`; `sessionStore.ts:184-223`                                                                                                                                                                                                                | reasoning kept only with Meta's `encrypted_content`; the stored session has no provider id                                                                                                                                            |
| Usage          | `ModelApiHost.ts:3065-3145` `noteUsage`, `:1000` `isCountedUsage`                                                                                                                                                                                                     | `input_tokens`, `cached_tokens` inside it, `reasoning_tokens`; no cache-write count                                                                                                                                                   |
| Models         | `ModelApiHost.ts:10407-10419`; `constants.ts:924`, `:1125`, `:1162`; `shared/effort.ts:35-40`; `core/import/agentImport.ts:701`                                                                                                                                       | ids filtered to `muse-spark-`; every model gets the 1,048,576 window; effort tiers by id prefix; a custom agent's model must start with `muse-spark-`                                                                                 |
| Prices         | `constants.ts:1131-1140`; `shared/paid.ts:74` `modelApiPaidTier`; `core/usage/insights.ts:191` `estimateCostUsd`; `sessionBudget.ts:159` `reserveRequest`; `runtime/exec/execFetch.ts:140-171`, `runExec.ts:541-566`                                                  | two tiers with input, cached input and output only; **the two helpers disagree**: `modelApiPaidTier` knows only the whitelist, `estimateCostUsd` prices any id without `-contributor` at the Standard rate                            |
| Unpriced       | `ModelApiHost.ts:2248` `hasUnknownCost`; `sessionBudget.ts` `sessionBudgetUnpriced`; `runtime/exec/execProtocol.ts:35`; `paid/paidFeatures.ts` `addReviewerUsage` etc. throw for an unpriced model                                                                    | already partly modelled                                                                                                                                                                                                               |
| Errors         | `client.ts:68-126`, `:248-375`; `ModelApiHost.ts:1049` `isAuthFailure`, `:2911` `allowRateLimitedRetry` (recognises a 429 by the reason text `HTTP 429:`), `:8581`                                                                                                    | Meta's envelope `{error: {message, type, code}}`; retry on 429, 500, 502, 503; **redirects followed** (`client.ts:318-323` sets no `redirect`, so the Bearer header rides a redirect), where exec and MCP set `redirect: 'error'`     |
| Network advice | `core/networkFailure.ts:154`; `shared/l10n/en.ts:2059-2061`                                                                                                                                                                                                           | "Meta's server could not be reached", "allows api.meta.ai"                                                                                                                                                                            |
| Hooks          | `ModelApiHost.ts:1929` `model_provider: 'meta'`; `modelCallHooks.ts:105`, `:125`, `:176-178`; `constants.ts:430` `MODEL_API_HOOK_PROVIDER`                                                                                                                            | provider literal, option keys `meta.reasoning.effort`, `meta.session_id`; LLM hook matchers match the string `meta`                                                                                                                   |
| Media          | `constants.ts:566-595`, `:662-665`; `ModelApiHost.ts:1384-1450`, `:4134-4177`                                                                                                                                                                                         | Meta's types and limits (50 per request, 50 PDF pages, PDFs inline as `input_file`); images from `read_file` go in a user message                                                                                                     |
| Paid tools     | web search `ModelApiHost.ts:2680`, `:2725`, `:2923`; images `imageGeneration.ts:278`, `ModelApiHost.ts:4431`; voice `core/voice/museVoice.ts:187` (`wss://api.meta.ai/v1/asr/realtime`, `constants.ts:2837`); prices `constants.ts:491-495`                           | all three are Meta-hosted and billed to the Meta key                                                                                                                                                                                  |
| Headless       | `runtime/exec/execFetch.ts:29-52`, `:90-121`                                                                                                                                                                                                                          | origin, path allowlist, function tools only, the image model literal                                                                                                                                                                  |
| Evaluation     | `core/eval/wire.ts:191-272`                                                                                                                                                                                                                                           | refuses any model but `muse-spark-1.3-contributor` and any other host                                                                                                                                                                 |

Not built, so not Meta-specific yet: M74's automatic compaction and its
cache economics (PLAN.md M74 "Not built", Q-M74: "using the supported
model's existing cache prices and window limit"; no cache-write price
exists anywhere) and M73's Evidence-Preserving Reducer.

### 3.3 Settings, keys and network today

- **Scopes.** Every `museSpark.modelApi*` setting except
  `modelApiReplyUsage` and `modelApiRepositoryRules` is machine-scoped; none
  is application-scoped. No workspace setting can name an endpoint today;
  `modelApiRepositoryRules` can only tighten (`package.json:773`).
- **Fetch.** `liveFetch` (`host/networkPosture.ts:37`) calls
  `globalThis.fetch` per request, so VS Code's patched fetch carries the
  proxy, PAC, proxy authentication and system certificates (D43). The ACP
  agent's Node `fetch` uses no proxy unless `NODE_USE_ENV_PROXY` is on
  (Q66, `runtime/proxyWarning.ts`). There is no custom TLS agent and no
  `rejectUnauthorized` anywhere.
- **Address checks.** `core/web/publicAddress.ts` `isPublicAddress`
  (boolean) over `NON_PUBLIC_IPV4_RANGES` and the IPv6 ranges
  (`constants.ts:1420-1457`, metadata 169.254/16 and Azure's
  168.63.129.16 included); `core/web/webFetch.ts:232` pins every DNS answer.
  Reusable for endpoint classification, but it does not tell loopback,
  private and link-local apart, and its pinned transport is GET-only over
  `node:https` (`host/web/pinnedRequest.ts:144`).
- **Redaction** (`core/redact.ts:118-256`). Already caught: Meta `LLM_…`,
  `Bearer`, `sk-` (OpenAI, Anthropic `sk-ant-`, OpenRouter `sk-or-v1-`,
  DeepSeek), Google `AIza…`, AWS `AKIA`/`ASIA`, `x-api-key:` and
  `api-key:` headers, `*_TOKEN=` assignments. Missing: Groq `gsk_`, xAI
  `xai-`, Bedrock `ABSK…` and `bedrock-api-key-…`, Fireworks `fw_`, Hugging
  Face `hf_`, and keys with no prefix (Mistral, Azure's 32 hex), which only
  the header and field rules catch. The `MAY_HOLD_SECRET` prefilter
  (`:263`) must gain every new prefix.
- **Credential variables.** The ACP agent and every child lose `*_API_KEY`
  and the named ones (`runtime/credentialVariables.ts`,
  `constants.ts:447-454`); not stripped today: `AWS_BEARER_TOKEN_BEDROCK`,
  `ANTHROPIC_AUTH_TOKEN`, `HF_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS`.
- **Picker.** `modelOptionSchema` (`shared/protocol.ts:207-213`) and
  `ModelSummary` (`core/agent/agentBackend.ts:234`) have no provider field;
  the composer pill opens `Palette.tsx` `modelRows`; both backends switch
  model per conversation (`ModelApiHost.ts:9203`, `MuseCodeHost.ts:962`);
  no conversation switches backend.
- **Bundles** (`scripts/check-bundle-size.mjs`, last measured in
  `docs/certification/m90.md`): `dist/extension.js` 580.4 of 600 KiB
  (about 20 KiB left), `dist/modelApi.js` 420.6 of 475 KiB.

### 3.4 Muse Code's own providers

Muse Code 1.4.2 (`muse --version`: 1.4.2-R4684.1, run 2026-10-04, offline
help only, no model call) takes `--provider echo|meta|local` on `muse` and
`muse serve` ("Startup provider for this host … default: from your
settings, else meta"), `--base-url` ("Override the Meta provider base
URL"), and `muse auth set --provider meta --api-key-stdin` (the only
provider value accepted). Its settings file on the owner's machine holds
`schema_version`, `tui` and `mcpServers`, no providers block. So Muse Code
owns `<config home>/muse/` and is growing providers of its own; how its
`local` provider is configured is not in its help. M95 is for the
extension's Model API harness and leaves Muse Code's providers alone.

## 4. The proposed seam

The smallest change that keeps `ModelApiHost` and every feature intact is to
put the provider under the `client` the host already has.

```ts
// src/core/backends/modelapi/providerClient.ts
export interface ProviderClient {
  readonly provider: ProviderIdentity // id, label, origin, format, auth mode, isLocal
  readonly capabilities: (modelId: string) => ModelCapabilities
  streamResponse(
    body: CreateResponseBody,
    signal: AbortSignal,
    onRetry?: (notice: RetryNotice) => void,
    budget?: RetryBudget,
    admitAttempt?: ResponseAttemptGuard,
    confirmed?: ConfirmedModelRequest,
  ): AsyncGenerator<StreamEvent> // canonical events, ending in a canonical response
  countInputTokens(body: Omit<CreateResponseBody, 'stream'>): Promise<number>
  listModels(): Promise<readonly ProviderModel[]>
  currentKeyDigest(): Promise<string>
  retryDelayMs(attempt: number): number
  waitBeforeRetry(ms: number, signal: AbortSignal): Promise<void>
}

// src/core/backends/modelapi/codecs/*.ts: one per wire format
export interface WireCodec {
  readonly format: 'responses' | 'chat' | 'anthropic' | 'gemini' | 'ollama'
  encode(body: CreateResponseBody, model: ProviderModel): NativeRequest // path, headers, JSON
  decode(response: Response, model: ProviderModel): AsyncGenerator<StreamEvent>
  parseError(status: number, body: unknown, headers: Headers): ModelApiError
  models: ModelsListSpec // path and parser, or a static table
  countTokens?: CountTokensSpec // where the provider has a free count
}
```

- **Meta** is the existing `ModelApiClient`, which already has this shape;
  its image calls stay on the class and only Meta's identity carries them.
- **Every other provider** is `new CodecClient(transport, codec, preset)`.
  `transport.ts` is `client.ts`'s request loop moved unchanged (retries,
  `Retry-After`, the idle stall, admission, scheduled-run confirmation, the
  key read per attempt), plus the origin check, `redirect: 'error'` and the
  per-format error parser.
- **The host** asks `ProviderRegistry.clientFor(modelId)` at its nine call
  sites instead of using `deps.client`; a bare id is Meta's. It gates the
  hosted tools on the identity (web search and Meta's images), reads the
  window, output cap, effort tiers and price card from the registry instead
  of the Meta constants, keeps the turn's tools in compaction where the
  capabilities say so, and puts the provider id and qualified model in the
  hook payloads.
- **Canonical additions**, all optional and never sent to Meta:
  `input_tokens_details.cache_write_tokens` (with the 1 h part where a
  provider reports it) in `Usage`; the provider and model that produced
  each replay entry, kept in the replay wrapper and the stored session, not
  in the wire item; a provider's own reasoning (Anthropic's signed thinking
  blocks, Gemini's signatures, OpenRouter's `reasoning_details`,
  DeepSeek's and Mistral's text) carried in a canonical reasoning item's
  `encrypted_content` as an opaque string only its codec reads.
- **Auth modes.** `ProviderIdentity.auth` is `apiKey`, `none` (a local
  server) or `subscription` (§6); the transport asks an `AuthSource` for
  the request's headers, so a subscription changes how the header is
  obtained and nothing above it.
- **Why not translate in the host.** The host's 10,700 lines would carry
  five formats' branches, and every feature (packing, hooks, budgets) would
  have to learn them. Under the client, a codec is a pure function with a
  golden test, and the host's own tests stay valid.

## 5. Findings that bind the plan

1. **Anthropic preserved thinking vs. our history edits.** ObservationPack's
   sticky swap shortens an earlier `tool_result`; the media budget omits
   older images; both are "edits" under Anthropic's rule, which makes
   later replayed thinking blocks invalid (a 400 on accounts from
   2026-08-31, or dropped with the `drop_block` beta) [A-pt]. Within a
   tool-use turn those blocks are also required [A-th]. So on those models
   the swap must wait for a user-turn boundary, and stale blocks before a
   new user turn are left out; M73's summary-only compaction is the safe
   pattern Anthropic names. To be captured before it is built.
2. **Compaction with `tools: []`.** Meta's compaction sends no tools. vLLM
   rejects an empty list [VL-proto], OpenRouter wants `tools` on every
   request [OR-tools], and Anthropic invalidates the cache when tools change
   [A-pc]; whether Anthropic and Bedrock refuse tool history without tool
   definitions is UNVERIFIED (to capture). Keeping the turn's tools with
   `tool_choice: auto` serves all of them and keeps the cached prefix.
3. **Gemini thought signatures** must go back in the exact part, unmerged,
   and Gemini 3 refuses a step whose first call lacks one [G-ts, G-g3].
4. **Ollama needs its native API**: `/v1` cannot set `num_ctx`, and the
   default window can be 4k [OL-ctx, OL-oai].
5. **Prices are per model, with writes.** Anthropic's read multiplier is
   0.1×, 0.05× or 0.025× by model, writes 1.25× or 2×; OpenAI's GPT-5.6
   and later charge 1.25× writes; OpenRouter lists `input_cache_write_1h`
   and long-context `overrides`; xAI bills every token at the long-context
   rate from 200k; DeepSeek halves off-peak [A-pr, O1, OR-models live, X1,
   D1]. M74's economics need the card, not a multiplier.
6. **Effort changes break the prefix** on OpenAI (it rewrites hidden
   instructions) and Anthropic (any change of thinking settings) [O1,
   A-pc]. The user may still change effort; nothing automatic does.
7. **`store` defaults to true** on xAI, Fireworks's and Bedrock's Responses
   APIs [X9, FW-resp, B-ra]: the codec always sends `store: false`.
8. **Our client follows redirects with the Bearer header** (`client.ts`
   sets no `redirect`, where exec and MCP set `'error'`).
9. **`estimateCostUsd` prices any id it does not know at Meta's Standard
   rate** (`insights.ts:191`); with BYO ids that would silently misprice.
10. **The key test.** Lists are free where documented; OpenRouter's
    `/models` is public, so its `/key` is the test [OR-limits]; Azure and
    Bedrock offer no free check of a deployment.
11. **`vscode.lm`.** Exposing through the stable API lets any extension
    spend the user's key with no consent prompt [V9]; consuming loses the
    system role, usage, cache control and the stable prefix [V6, V7, V12].
12. **Muse Code 1.4.2 has providers of its own** and owns
    `<config home>/muse/` (§3.4), so M95's file lives in its own folder.
13. **Two leaders stopped** (Continue read-only, Roo archived); plain-text
    key files are common (Cline, OpenCode, Kilo, Continue); workspace
    configs that redirect keys exist in three (Continue, OpenCode, Roo).

## 6. Subscription sign-in: what each provider allows today

Added the same day, when the owner asked: "where we can i would like to
build in connecting your account subscription and use your inference. i
know openai just released this as a capability". Only official,
provider-sanctioned flows count; another application's client id or stored
tokens (Codex CLI's, Claude Code's, Gemini CLI's, the Copilot extension's)
are never reused.

### 6.1 OpenAI: Sign in with ChatGPT, with ChatGPT plan usage

- **What it is.** "Sign in with ChatGPT" has two permissions: identity, and
  **ChatGPT plan usage**, "complete eligible AI requests with usage
  included in the user's ChatGPT plan or available credits" [SW-cb]. It
  shipped at DevDay on 2026-09-29 [SW-cm]; the protocol calls it token
  sharing (scope `chatgpt.tokens.use.direct`, errors
  `subscription_sharing_*`) [SW-d].
- **Who may use it.** "ChatGPT plan usage is available to open-source
  projects, personal projects that run locally, and selected private apps";
  paid or remotely hosted apps join a waitlist first [SW-cb, SW-d
  `/siwc/quickstart`]. Listed users include OpenCode, Kilo Code, Warp and
  Devin [SW-l]. **No pre-registration for an open-source local app**: the
  first sign-in sends `client_id=dynamic_agent_client` with an
  `agent_name_hint` and a persistent, opaque `ext_agent_host_id`, and the
  callback returns a client id issued for that user (`oaiapp_…`), kept and
  used for every later exchange and refresh; "This direct flow needs
  neither a client secret nor a partner API key" [SW-d
  `/siwc/token-sharing-open-source/sign-in`]. No SIWC-specific developer
  agreement was found; the docs point to OpenAI's policies and brand
  guidelines [SW-cb]. Muse Spark Code is MIT, public and runs on the user's
  machine; whether OpenAI counts a Marketplace extension as "open-source
  … that run[s] locally" is the owner's call (settled in D74: treated as eligible).
- **The flow** [SW-d sign-in, token-reference, profiles-and-sessions;
  SW-oidc]. Issuer `https://auth.openai.com`; authorize
  `/api/accounts/authorize`, token `/api/accounts/oauth/token`, revoke
  `/api/accounts/oauth/revoke`, JWKS; PKCE `S256` only, no client secret.
  Scopes
  `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct` with `resource=https://api.openai.com/v1`,
  plus `state` and `nonce`. **The redirect must be
  `http://127.0.0.1:<port>/auth/callback`: "Only the port may vary … Do not
  substitute with `localhost`"**; no custom scheme is documented, so a
  `vscode://` URI handler is not an option. The ID token is validated
  (signature, `iss`, `aud` = the issued client, `exp`, nonce) and the
  granted scopes must include `chatgpt.tokens.use.direct`. Access tokens
  last 1 hour; refresh tokens 30 days, rotated on every refresh, with
  `earliest_refresh_at`; refreshes must be serialised. Sign-out revokes the
  refresh token; a user can also disconnect in ChatGPT's settings, and the
  app is not told. For remote machines OpenAI's method is to sign in
  locally and copy the credential over [SW-d self-hosted-vms]; VS Code's
  port forwarding is UNVERIFIED.
- **What the token calls** [SW-d models-and-inference,
  preview-limitations]. `POST https://api.openai.com/v1/responses`
  ("do not point it at ChatGPT's `backend-api` endpoints"); models from
  `GET /v1/models` as a `models[]` array of `slug`, `display_name`,
  `visibility`. Preview rules: `store: false` and `stream: true` required;
  full history every turn; `role: "system"` refused; **not supported:
  `max_output_tokens`, `prompt_cache_retention`, `max_tool_calls`,
  `temperature`, `metadata`, `user`, `background`**; function tools must be
  grouped in namespaces or sent as `additional_tools` items (whether plain
  top-level function tools work is UNVERIFIED); no hosted image
  generation, file search, code interpreter or hosted MCP. UNVERIFIED:
  `reasoning` with encrypted content, `prompt_cache_key`, and usage with
  cached tokens in `response.completed`.
- **Plans and billing.** Plus and Pro only; others get 403
  `subscription_sharing_user_not_eligible` [SW-d quickstart, SW-l]. Usage
  draws on the plan's Codex and work allowance and "does not add a new
  allowance"; Plus shares one five-hour limit across such apps, Pro has
  none; users can cap an app's weekly share and may let apps spend credits
  after the plan limit; "OpenAI does not silently switch the request to
  another billing path"; nothing is billed to the developer [SW-l, SW-d].
  No remaining-quota API: apps link to `https://chatgpt.com/settings/usage`;
  the limit is a 429 `subscription_sharing_usage_limit_exceeded`, also as a
  mid-stream `response.failed`, with no reset time to infer [SW-d
  errors-and-recovery].
- **Required UI** [SW-d `/siwc/ui-ux-guidelines`]: a "Continue with
  ChatGPT" button with approved branding; a one-time "You're using your
  ChatGPT plan" modal; a "Using ChatGPT plan" indicator near the composer
  or model picker with **Manage usage**; a usage-limit screen; the app must
  say which of its plans support plan usage.
- **Licence caution.** OpenAI's DevKit is under a Noncommercial licence
  whose modified copies must keep it [SW-dk]; M95b writes its own code from
  the documentation.
- **Codex CLI is not the route.** Its own client signs in with other scopes
  and sends traffic to `chatgpt.com/backend-api/codex` [SW-cx]; nothing
  permits reusing its client or `~/.codex/auth.json`.

### 6.2 GitHub Copilot through VS Code's Language Model API

- **What is offered.** `vscode.lm.selectChatModels({vendor: 'copilot'})`
  returns the models of the user's own Copilot picker, filtered by plan and
  organisation policy: Free and Student get `auto` only; Pro adds models
  such as Sonnet 5.5, Gemini 3.8 Flash and GPT-5.6; Pro+, Max, Business and
  Enterprise add Opus 5.5, Fable 5.1 and the GPT-6 Sol models [CP-g1, CP-s1
  source]. Premium models are not held back from other extensions [CP-s1].
- **Billing.** Since 2026-06-01 Copilot bills AI credits "based on token
  usage, including input, output, and cached tokens" (1 credit = $0.01; Pro
  1,500 a month, Pro+ 7,000, Max 20,000) [CP-g2, CP-g3, CP-g4]. Copilot's
  source sends another extension's calls as user-initiated, tagged with
  its id, so each turn of our loop spends the user's credits; GitHub's list
  of billed features does not name extensions (UNVERIFIED in the docs)
  [CP-s1, CP-s4]. Exhaustion shows as `LanguageModelError.Blocked`, a
  `ChatQuotaExceeded` error, or `ChatRateLimited` [CP-s1].
- **Stable at our 1.99 floor** [CP-d1, CP-d2]: model selection, requests,
  `countTokens`, `maxInputTokens` and the change event (1.90); tools,
  tool calls and tool results with `toolMode` Auto and Required (1.95).
  Not at 1.99: images and data parts (1.106), the system role, reasoning
  parts and capabilities (still proposed). Images are feature-detected.
- **Consent.** The first request, from a user action, shows "The extension
  '…' wants to access the language models provided by …" with our
  justification; the grant persists and is revoked under Accounts →
  **Manage Language Model Access…** [CP-s3, CP-d3].
- **What does not come back.** No usage, stop reason or cache control in the
  stable API; `countTokens` uses Copilot's local tokenizer (approximate for
  Claude and Gemini); an undocumented `usage` data part arrives on 1.106+;
  every request from another extension gets Copilot's `SafetyRules` and
  `EditorIntegrationRules` prepended and may be pruned [CP-s1, CP-s2,
  CP-s4]. So the cached prefix is Copilot's, not ours.
- **Terms.** Publishing means following GitHub's Copilot extensibility
  acceptable-use policy: our own safety testing, telling users they see
  AI-generated content, a way to report bad output to
  copilot-partners@github.com, a privacy policy, no scraping or databases
  of the data [CP-d3, CP-g5]. GitHub's additional-products terms add a
  **competitive-benchmarking clause**: offering a competing product waives
  restrictions on GitHub benchmarking it [CP-g6]. On individual plans,
  inputs and outputs may be used for training unless the user opts out
  [CP-g7].
- **Forks.** Copilot Chat is not on Open VSX; VSCodium ships it disabled;
  Cursor said in 2025 it exposes no models this way; Positron and Theia
  have their own Copilot integrations [CP-f1 – CP-f5]. VS Code only.
- **Verdict.** Our tool loop, hooks and checkpoints run on it; the
  byte-stable cached prefix, cache-price compaction, exact budgets and
  exact usage do not. Only as an opt-in, labelled reduced provider.

### 6.3 Google

- **No sanctioned consumer-plan path.** Gemini CLI's "Login with Google"
  uses Google's own client against the internal Code Assist API
  (`cloudcode-pa.googleapis.com`, `v1internal`) [GP-1, GP-2], an API
  "developed for Google-provided clients only" [GP-9]. Its terms: "Directly
  accessing the services powering Gemini CLI … using third-party software
  … is a violation of applicable terms and policies", and the supported
  route for third-party agents is "a Vertex AI or Google AI Studio API key"
  [GP-3, GP-4].
- **The consumer tiers are gone anyway.** "Starting June 18, 2026, Gemini
  Code Assist IDE extensions stopped serving requests for the Gemini Code
  Assist for individuals, Google AI Pro, and Google AI Ultra tiers. This
  also applies to usage of Gemini CLI" [GP-6, GP-7]. Its successor,
  Antigravity, forbids "using the Service in connection with products not
  provided by us" [GP-11].
- **What does exist.** A Gemini API key, or OAuth to the Gemini API with
  the app's own Google client (documented as a testing setup, verification
  beyond 100 users), both billed to a Cloud project, not the plan [GP-14,
  GP-15, GP-16]. AI Pro and Ultra include $10, $40 or $100 of monthly
  Cloud credits that can pay for Gemini API use [GP-17, GP-18]: the wizard
  says so.

### 6.4 Anthropic

- **Prohibited.** "Anthropic does not permit third-party developers to offer
  Claude.ai login into their own applications, or to route requests
  through Free, Pro, or Max plan credentials on behalf of their users.
  Moreover, developers may not collect, store, or intermediate Claude.ai
  credentials or session tokens" [AP-1]. The Agent SDK: "Unless previously
  approved, Anthropic does not allow third party developers to offer
  claude.ai login or rate limits for their products" [AP-2, AP-3].
  Applications that "route third-party traffic against subscription
  limits" are prohibited [AP-5].
- **The one opening** is the user signing in to "the unmodified Claude Code
  binary with their own Claude subscription", under Anthropic's Commercial
  Terms for the product that runs it: no modification, no sign-in method
  removed, no paying for, reselling or intermediating usage [AP-1]. Driving
  `claude -p` as a model under our own tool loop is a grey zone Anthropic
  answers with "contact sales" (UNVERIFIED either way). That would be a
  third backend like Muse Code, not a provider (D74 plans it as its own milestone after M95b).

### 6.5 Others

- **OpenRouter account connection** (OAuth PKCE): see §1.8; no
  registration, any loopback port, a pay-as-you-go key the user controls.
- **Hugging Face** "Sign in with HF" with the `inference-api` scope ("Make
  inference requests to Inference Providers on behalf of the user"):
  self-serve app registration, public clients with PKCE or device code, any
  loopback port; the router `https://router.huggingface.co/v1` is
  OpenAI-compatible with prices and windows in its models list; PRO
  includes $2.00 a month of credits, then pay-as-you-go [OT-hf-oauth,
  OT-hf-ip, OT-hf-pricing]. The app must be registered by the publisher.
- **xAI.** SuperGrok OAuth exists only for announced partners (OpenCode,
  Hermes Agent, Kilo Code); xAI's backend "enforces its own allowlist", and
  docs.x.ai documents API keys only [OT-xai-oc, OT-xai-kilo, OT-hermes,
  OT-xai-docs].
- **Plan-backed API keys** (the user copies a key from the plan's
  dashboard; an API-key preset with plan billing):
  - **MiniMax M Plan**: usable in "any AI tool that supports the
    OpenAI-compatible or Anthropic-compatible protocol", for "individual,
    interactive developer use"; 5-hour and weekly windows [OT-mm].
  - **Alibaba Model Studio Coding Plan**: "any third-party programming tool
    compatible with OpenAI or Anthropic API protocols that allows custom
    endpoints", not automation or backends; 6,000 requests per 5 hours;
    no token view [OT-ali, OT-ali-faq] (page of 2026-09-28).
  - **Kimi Code**: named third-party agents and "tampering with the client
    identifier (User-Agent) will be treated as a violation"; whether other
    tools are allowed is UNVERIFIED [OT-kimi].
  - **Mistral**: each plan's monthly credits are shared across Studio, the
    API and Vibe ($15 on Pro), and any API key draws on them [OT-mistral].
  - **Z.ai GLM Coding Plan**: "strictly limited to use within officially
    supported tools"; an unlisted extension would break its terms [OT-zai].
  - **Ollama Cloud** (API keys, plan credits; whether API calls draw on them
    is UNVERIFIED) and **Cerebras Code** (sold out) [OT-ollama, OT-cerebras].
- **Gone or unconfirmed.** GitHub Models was retired on 2026-07-30
  [OT-ghm]. Perplexity's monthly API credit for Pro is UNVERIFIED. Qwen's
  free OAuth tier ended on 2026-04-15 and was first-party only [OT-qwen].

### 6.6 Summary

| Provider                  | What a third-party extension may do today                                    | How                                                                                   | Plan-billed                          | Who must act first                                                               |
| ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| OpenAI                    | Run on a ChatGPT Plus or Pro plan                                            | Sign in with ChatGPT: OAuth PKCE, dynamic client, `127.0.0.1` loopback, Responses API | yes                                  | nobody, if D74 treats the extension as "open-source … local"; else OpenAI's form |
| GitHub Copilot            | Run on the user's Copilot models, reduced                                    | `vscode.lm`, VS Code's consent dialog                                                 | yes, AI credits                      | nobody (D74: built, opt-in)                                                      |
| OpenRouter                | Connect the account and get a key                                            | OAuth PKCE, any loopback port or a pasted code                                        | no, pay-as-you-go                    | nobody                                                                           |
| Hugging Face              | Run on the user's HF account                                                 | OAuth with `inference-api`                                                            | PRO's $2 credits, then pay-as-you-go | the owner registers the app                                                      |
| MiniMax, Alibaba, Mistral | Use a plan's key                                                             | API key from the plan's dashboard                                                     | yes                                  | nobody                                                                           |
| Kimi Code                 | Use a plan's key, honest User-Agent                                          | API key                                                                               | yes                                  | not offered (D74)                                                                |
| xAI, Z.ai                 | Only if the provider approves the app                                        | partner OAuth, allowlist                                                              | yes                                  | the provider                                                                     |
| Google                    | Nothing on a consumer plan; an API key, paid from AI Pro/Ultra Cloud credits | API key                                                                               | no                                   | nobody                                                                           |
| Anthropic                 | Nothing in our loop; only the user's unmodified Claude Code                  | (a backend, not a provider)                                                           | yes                                  | the owner accepts Anthropic's terms                                              |

## 7. Sources

Every page was read on 2026-10-04. A date in parentheses is the page's own
"last updated" date (or, for a repository file, its last commit) where one
was shown; most provider pages show none.

**Anthropic** (`https://platform.claude.com/docs/en/…`): A-pc
`build-with-claude/prompt-caching`; A-st `build-with-claude/streaming`; A-et
`build-with-claude/extended-thinking`; A-th `build-with-claude/thinking`;
A-pt `build-with-claude/preserved-thinking`; A-dt
`agents-and-tools/tool-use/define-tools`; A-ht
`agents-and-tools/tool-use/handle-tool-calls`; A-pl
`agents-and-tools/tool-use/parallel-tool-use`; A-ml `api/models/list`; A-tc
`build-with-claude/token-counting`; A-er `api/errors`; A-rl
`api/rate-limits`; A-ov `api/overview`; A-vi `build-with-claude/vision`; A-oa
`cli-sdks-libraries/libraries/openai-sdk`; A-pr `about-claude/pricing`; A-br
`build-with-claude/claude-in-amazon-bedrock`.

**Google** (`https://ai.google.dev/…`): G-gc `api/generate-content`; G-ca
`api/caching` (2026-09-11); G-mo `api/models` (2026-09-23); G-tk
`api/tokens` (2026-08-17); G-ts
`gemini-api/docs/generate-content/thought-signatures` (2026-09-04); G-th
`…/generate-content/thinking` (2026-09-25); G-fc
`…/generate-content/function-calling`; G-cc `…/generate-content/caching`
(2026-09-11); G-g3 `…/generate-content/gemini-3` (2026-09-03); G-im
`…/generate-content/image-understanding` (2026-09-04); G-tg
`…/generate-content/text-generation` (2026-09-17); G-er
`…/generate-content/api-errors` (2026-09-20); G-oa `gemini-api/docs/openai`
(2026-09-02); G-pr `gemini-api/docs/pricing` (2026-10-01); G-rl
`gemini-api/docs/rate-limits` (2026-09-02); G-ak `gemini-api/docs/api-key`
(2026-09-25).

**AWS** (`https://docs.aws.amazon.com/bedrock/latest/…`): B-pc
`userguide/prompt-caching.html`; B-ak `userguide/api-keys.html`; B-cc
`userguide/inference-chat-completions.html`; B-ra
`userguide/inference-responses-api.html`; B-ma
`userguide/inference-messages-api.html`; B-ac
`userguide/models-api-compatibility.html`; B-ep `userguide/endpoints.html`;
B-at `userguide/claude-messages-adaptive-thinking.html`; B-qr
`userguide/quotas-runtime.html`; B-tb `userguide/quotas-token-burndown.html`;
B-ct `userguide/count-tokens.html`; B-te
`userguide/troubleshooting-api-error-codes.html`; B-cs
`APIReference/API_runtime_ConverseStream.html`; B-iw
`APIReference/API_runtime_InvokeModelWithResponseStream.html`; B-ty the
`APIReference/API_runtime_*` content-block types; B-fm
`APIReference/API_FoundationModelSummary.html`.

**OpenAI** (`https://developers.openai.com/api/…`): O1
`docs/guides/prompt-caching`; O2 `docs/guides/function-calling`; O3
`docs/guides/reasoning`; O4 `docs/guides/migrate-to-responses`; O5
`docs/guides/rate-limits`; O6 `docs/guides/error-codes`; O7
`docs/guides/images-vision`; O8 `docs/guides/token-counting`; O9
`reference/resources/chat`; O10
`reference/resources/chat/subresources/completions/streaming-events`; O11
`reference/resources/responses/methods/create`; O12
`reference/resources/responses/streaming-events`; O13
`reference/resources/models/methods/list`; O14 `reference/overview`.

**Azure** (`https://learn.microsoft.com/en-us/azure/foundry/openai/…`): AZ1
`api-version-lifecycle` (2026-06-05); AZ2 `how-to/prompt-caching`
(2026-08-11); AZ3 `how-to/responses` (2026-08-18); AZ4 `how-to/reasoning`
(2026-09-29); AZ5 `how-to/quota` (2026-08-13); AZ6
`https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/models`
(2026-05-27).

**xAI** (`https://docs.x.ai/developers/…`): X1 `models`; X2
`model-capabilities/text/reasoning`; X3 `tools/function-calling`; X4
`advanced-api-usage/prompt-caching`; X5 `rest-api-reference/inference/models`;
X6 `…/inference/responses`; X7 `…/inference/chat-completions`; X8
`…/inference/legacy`; X9 `model-capabilities/text/comparison`; X10
`rate-limits`; X11 `debugging`; X12 `advanced-api-usage/regions`.

**DeepSeek** (`https://api-docs.deepseek.com/…`, changelog to 2026-09-10): D1
`quick_start/pricing`; D2 `guides/thinking_mode`; D3 `guides/tool_calls`; D4
`guides/responses_api`; D5 `guides/kv_cache`; D6 `api/create-chat-completion`;
D7 `api/list-models`; D8 `quick_start/error_codes`; D9 `quick_start/rate_limit`;
D10 `guides/anthropic_api`; D11 `updates`; D12 `guides/vision`.

**Mistral** (`https://docs.mistral.ai/…`): M1
`studio/conversations/function-calling`; M2 `studio/conversations/reasoning`;
M3 `studio/conversations/advanced/prompt-caching`; M4
`resources/known-limitations`; M5 `resources/error-glossary`; M6
`openapi.yaml`; M7 `resources/deprecated/native-reasoning`; M8
`studio/conversations/vision`.

**OpenRouter** (`https://openrouter.ai/docs/…`): OR-ref
`api/reference/overview`; OR-usage `use-cases/usage-accounting`; OR-cache
`features/prompt-caching`; OR-models `guides/overview/models`; OR-reason
`use-cases/reasoning-tokens`; OR-limits `api-reference/limits`; OR-err
`api-reference/errors`; OR-routing `features/provider-routing`; OR-tools
`guides/features/tool-calling`; OR-params `api/reference/parameters`;
OR-stream `api/reference/streaming`; OR-resp `api/reference/responses/overview`;
OR-msgs `api/api-reference/anthropic-messages/create-a-message`; live:
`https://openrouter.ai/api/v1/models` read without a key, and `/api/v1/key`
answering 401 without one.

**Groq** (`https://console.groq.com/docs/…`): GQ-compat `openai`; GQ-ref
`api-reference`; GQ-cache `prompt-caching`; GQ-reason `reasoning`; GQ-tools
`tool-use/overview`; GQ-local `tool-use/local-tool-calling`; GQ-err `errors`;
GQ-rl `rate-limits`; GQ-resp `responses-api`; GQ-models `models`; GQ-so
`structured-outputs`; GQ-vision `vision`; GQ-sdk
`https://github.com/groq/groq-python`
`src/groq/types/chat/chat_completion_chunk.py`.

**Together** (`https://docs.together.ai/…`): TG-compat
`docs/openai-api-compatibility`; TG-models `reference/models-1`; TG-chat
`reference/chat-completions-1`; TG-reason `docs/inference/chat/reasoning`;
TG-pricing `docs/inference/pricing`; TG-serverless `docs/serverless/models`;
TG-gptoss `docs/gpt-oss`; TG-err `docs/error-codes`; TG-fc
`docs/function-calling`; TG-sdk `https://github.com/togethercomputer/together-py`
`src/together/types` (2026-10-02).

**Fireworks** (`https://docs.fireworks.ai/…`): FW-compat
`tools-sdks/openai-compatibility`; FW-chat `api-reference/post-chatcompletions`;
FW-reason `guides/reasoning`; FW-fc `guides/function-calling`; FW-cache
`guides/prompt-caching`; FW-resp `guides/response-api`; FW-anth
`tools-sdks/anthropic-compatibility`; FW-models `api-reference/list-models`;
FW-rl `guides/inference-error-codes`.

**Ollama** (v0.35.1, 2026-09-29): OL-chat `https://docs.ollama.com/api/chat`;
OL-oai `https://docs.ollama.com/api/openai-compatibility`; OL-ctx
`https://docs.ollama.com/context-length`; in
`https://github.com/ollama/ollama`: OL-anth
`docs/api/anthropic-compatibility.mdx`, OL-err `docs/api/errors.mdx`,
OL-usage `docs/api/usage.mdx`, OL-openapi `docs/openapi.yaml`, OL-faq
`docs/faq.mdx`, OL-go `openai/openai.go`.

**LM Studio** (`https://lmstudio.ai/docs/developer/…`): LM-oai
`openai-compat`; LM-tools `openai-compat/tools`; LM-auth
`core/authentication`; LM-chg `api-changelog`; LM-rest-list `rest/list`;
LM-v0 `rest`; LM-anth `anthropic-compat`.

**vLLM** (v0.30.0, 2026-09-22; `https://docs.vllm.ai/en/latest/…`): VL-serve
`serving/online_serving/`; VL-tools `features/tool_calling.html`; VL-reason
`features/reasoning_outputs.html`; VL-cli `cli/serve/`; in
`https://github.com/vllm-project/vllm`: VL-proto
`vllm/entrypoints/openai/chat_completion/protocol.py` and the serve and
generate protocol files, VL-engine `vllm/v1/engine/__init__.py`, VL-cache-cfg
`vllm/config/cache.py`.

**llama.cpp** (`https://github.com/ggml-org/llama.cpp`): LC-readme
`tools/server/README.md` (2026-10-03); LC-src `tools/server/server-common.cpp`
and `server-task.cpp`; LC-chat.cpp `common/chat.cpp`; LC-schema
`tools/server/server-schema.cpp`.

**Continue** (`https://github.com/continuedev/continue`, read-only): CN-repo
the README and PR #12634 (2026-06-15); CN-onboarding
`core/config/onboarding.ts` and the GUI's `OnboardingProvidersTab.tsx`;
CN-config `https://docs.continue.dev/customize/deep-dives/configuration`;
CN-ref `https://docs.continue.dev/reference`; CN-faq
`https://docs.continue.dev/faqs`; CN-ollama
`https://docs.continue.dev/guides/ollama-guide`; CN-workspace
`https://docs.continue.dev/guides/configuring-models-rules-tools` and
`core/config/loadLocalAssistants.ts`.

**Cline** (`https://github.com/cline/cline`, v4.1.22): CL-docs
`https://docs.cline.bot/getting-started/selecting-your-model`; CL-storage
`.clinerules/storage.md` and `apps/vscode/src/shared/storage/storage-context.ts`;
CL-migration `apps/vscode/src/hosts/vscode/vscode-to-file-migration.ts`;
CL-openaicompat the webview's `settings/providers/OpenAICompatible.tsx`;
CL-catalog `sdk/packages/llms/src/catalog/README.md` and
`apps/vscode/src/core/controller/models/refreshOpenRouterModels.ts`; CL-api
`apps/vscode/src/shared/api.ts`; CL-state
`apps/vscode/src/shared/storage/state-keys.ts`.

**Roo Code** (`https://github.com/RooCodeInc/Roo-Code`, archived): RO-repo
the repository; RO-profiles
`https://roocodeinc.github.io/Roo-Code/features/api-configuration-profiles`
(2026-05-15); RO-export `…/features/settings-management` (2026-05-15);
RO-manager `src/core/config/ProviderSettingsManager.ts`; RO-anthropic
`packages/types/src/providers/anthropic.ts`; RO-openrouter
`src/api/providers/fetchers/openrouter.ts`; RO-autoimport `src/package.json`
and `src/utils/autoImportSettings.ts`.

**Kilo Code** (its GitHub repository, v7.8.3): KI-readme the README;
KI-providers `packages/kilo-docs/pages/ai-providers/index.md`; KI-byok
`…/getting-started/byok.md`; KI-openaicompat `…/ai-providers/openai-compatible.md`;
KI-plan `packages/kilo-vscode/docs/opencode-migration-plan.md`.

**OpenCode** (`https://github.com/anomalyco/opencode`): OC-config
`https://opencode.ai/docs/config/` (2026-10-03); OC-providers
`https://opencode.ai/docs/providers/` (2026-10-03); OC-provider
`packages/core/src/v1/config/provider.ts`; OC-auth
`packages/opencode/src/auth/index.ts`; OC-modelsdev
`packages/core/src/models-dev.ts`; OC-configts
`packages/opencode/src/config/config.ts`.

**Catalogues**: MD-license `https://github.com/anomalyco/models.dev`
`LICENSE`; MD-api `https://models.dev/api.json` (measured); LL-license
`https://github.com/BerriAI/litellm` `LICENSE`; LL-file
`model_prices_and_context_window.json` (measured).

**Zed** (`https://zed.dev/docs/ai/…`): Z1 `use-api-access` (2026-09-23); Z2
`use-a-local-model` (2026-09-19); Z3 `use-a-gateway` (2026-10-03); Z4
`agent-settings`; Z5 `use-an-existing-subscription`.

**Aider** (`https://aider.chat/docs/…`): AI1 `llms/other.html`; AI2
`config/api-keys.html` (2025-05-21); AI3 `config/dotenv.html` and
`config/aider_conf.html`; AI4 `config/adv-model-settings.html` (2026-04-25);
AI5 `llms/warnings.html`; AI6 `llms/openai-compat.html`; AI7
`config/options.html`.

**VS Code and Copilot**: V1
`https://code.visualstudio.com/docs/agent-customization/language-models`
(2026-09-30); V2 `https://github.com/microsoft/vscode-docs`
`blogs/2026/06/18/byok-vscode.md`; V3
`https://github.blog/changelog/2026-04-22-bring-your-own-language-model-key-in-vs-code-now-available/`;
V4 `https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-enterprise/use-your-own-api-keys`;
V5 `https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider`
(2026-09-30); V6 `https://code.visualstudio.com/api/extension-guides/ai/language-model`
(2026-09-30); V7 `https://github.com/microsoft/vscode`
`src/vscode-dts/vscode.d.ts`; V8 the `vscode.proposed.*.d.ts` files beside it
(`chatProvider`, `languageModelPricing`, `languageModelThinkingPart`,
`languageModelCapabilities`, `languageModelSystem`); V9
`src/vs/workbench/api/common/extHostLanguageModels.ts`; V10
`src/vs/workbench/contrib/chat/common/languageModels.ts`; V11
`extensions/copilot/package.json` (Copilot Chat 0.69.0); V12
`extensions/copilot/src/extension/conversation/vscode-node/languageModelAccess.ts`;
V13 `https://code.visualstudio.com/updates/v1_104`; V14
`https://code.visualstudio.com/blogs/2025/10/22/bring-your-own-key`; V15
`https://code.visualstudio.com/api/advanced-topics/using-proposed-api`; V16
`https://docs.github.com/en/early-access/copilot/github-copilot-extensibility-platform-partnership-plugin-acceptable-development-and-use-policy`.

**Claude Code** (`https://code.claude.com/docs/en/…`): C1
`settings-reference`; C2 `llm-gateway-connect`; C3 `llm-gateway-protocol`; C4
`llm-gateway`; C5 `env-vars`; C6 `amazon-bedrock`; C7 `google-vertex-ai`.

**Muse Code**: `muse --help`, `muse serve --help`, `muse auth --help`,
`muse auth set --help`, `muse model-profile --help` and `muse --version`
(1.4.2-R4684.1), run on the owner's Windows host on 2026-10-04 (offline, no
model call), and the key names of his `~/.config/muse/settings.json`.

**OpenRouter, follow-up** (`https://openrouter.ai/…`): OR2-oauth
`docs/guides/overview/auth/oauth` and `docs/use-cases/oauth-pkce`; OR2-spec
`openapi.json` (113 paths); OR2-limits `docs/api-reference/limits`; OR2-mgmt
`docs/guides/overview/auth/management-api-keys`; OR2-attr
`docs/app-attribution`; OR2-route `docs/guides/routing/provider-selection`;
OR2-zdr `docs/guides/features/zdr`; OR2-free
`docs/guides/routing/model-variants/free`; OR2-cache
`docs/features/prompt-caching`; OR2-reason `docs/use-cases/reasoning-tokens`;
OR2-err `docs/api-reference/errors`; live, without a key: `/api/v1/models`
(with `?zdr=true` and `?supported_parameters=tools`),
`/api/v1/models/anthropic/claude-sonnet-4.5/endpoints`, `/api/v1/endpoints/zdr`.

**Sign in with ChatGPT**: SW-d the SIWC documentation as exported at
`https://developers.openai.com/siwc/llms-full.txt`, cited by page path
(`/siwc/quickstart`, `/siwc/token-sharing-open-source`,
`/siwc/token-sharing-open-source/sign-in`, `…/token-reference`,
`…/profiles-and-sessions`, `…/models-and-inference`,
`…/preview-limitations`, `…/errors-and-recovery`, `…/self-hosted-vms`,
`…/codex-app-server`, `/siwc/ui-ux-guidelines`, `/siwc/website`); SW-cb
`https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt`;
SW-oidc `https://auth.openai.com/.well-known/openid-configuration` (fetched);
SW-dk `https://github.com/openai/sign-in-with-chatgpt-devkit` (created
2026-09-29, README and LICENSE); SW-l
`https://learn.chatgpt.com/docs/sign-in-with-chatgpt`; SW-cm
`https://community.openai.com/t/devday-2026-announcements-and-developer-resources/1402006`
(2026-09-29); SW-cx `https://github.com/openai/codex`
`codex-rs/login/src/auth/manager.rs`, `login/src/server.rs`,
`model-provider-info/src/lib.rs`, and `https://learn.chatgpt.com/docs/auth`.
`help.openai.com` articles 20001542 and 20001410 and
`openai.com/index/devday-2026-recap/` answered 403; only search excerpts
were read, and nothing above rests on them alone.

**Copilot through `vscode.lm`**: CP-d1 `vscode.d.ts` at the tags 1.90.0,
1.94.0, 1.95.0, 1.99.0, 1.104.0, 1.105.0, 1.106.0 and main
(`https://github.com/microsoft/vscode/blob/<tag>/src/vscode-dts/vscode.d.ts`);
CP-d2 `https://code.visualstudio.com/updates/v1_90`, `v1_95`, `v1_104`; CP-d3
`https://code.visualstudio.com/api/extension-guides/ai/language-model`
(2026-09-30); in `https://github.com/microsoft/vscode`: CP-s1
`extensions/copilot/src/extension/conversation/vscode-node/languageModelAccess.ts`,
CP-s2 `languageModelAccessPrompt.tsx` beside it, CP-s3
`src/vs/workbench/api/common/extHostLanguageModels.ts`,
`src/vs/workbench/api/browser/mainThreadLanguageModels.ts` and
`src/vs/workbench/contrib/chat/browser/actions/chatLanguageModelActions.ts`,
CP-s4 `extensions/copilot/src/platform/endpoint/common/endpointTypes.ts`,
`platform/networking/common/openai.ts` and
`extension/prompt/node/chatMLFetcher.ts`; CP-g1
`https://docs.github.com/en/copilot/reference/ai-models/supported-models`;
CP-g2 `https://docs.github.com/copilot/concepts/billing/usage-based-billing-for-individuals`;
CP-g3 `https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing`;
CP-g4 `https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/`
(2026-04-27); CP-g5 the Copilot extensibility acceptable-use policy (V16);
CP-g6 `https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features`;
CP-g7 `https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#j-ai-features-training-and-your-data`;
CP-f1 VSCodium `docs/ext-github-copilot.md` (2025-11-11); CP-f2 code-server
`docs/FAQ.md`; CP-f3 `https://open-vsx.org/api/GitHub/copilot-chat`; CP-f4
`https://forum.cursor.com/t/vscode-lm-api-in-vscode-extensions/26563/3`;
CP-f5 `https://positron.posit.co/assistant-providers.html`.

**Google, plans**: GP-1 and GP-2 `https://github.com/google-gemini/gemini-cli`
`packages/core/src/code_assist/oauth2.ts` and `server.ts`; GP-3
`docs/resources/tos-privacy.md` there (2026-04-10); GP-4
`docs/resources/faq.md` there (2026-04-10); GP-6
`https://developers.google.com/gemini-code-assist/resources/faqs`
(2026-09-02); GP-7
`https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/`
(2026-05-19); GP-9
`https://docs.cloud.google.com/gemini/docs/codeassist/security-privacy-compliance`
(2026-09-30); GP-11 `https://antigravity.google/terms`; GP-14
`https://ai.google.dev/gemini-api/docs/oauth` (2026-08-24); GP-15
`https://ai.google.dev/gemini-api/docs/billing` (2026-09-28); GP-16
`https://support.google.com/cloud/answer/7454865`; GP-17
`https://developers.google.com/profile/help/benefits` (2026-09-28); GP-18
`https://blog.google/innovation-and-ai/technology/developers-tools/gdp-premium-ai-pro-ultra/`
(2026-01-27).

**Anthropic, plans**: AP-1 `https://code.claude.com/docs/en/legal-and-compliance`;
AP-2 `https://code.claude.com/docs/en/agent-sdk/overview`; AP-3
`https://code.claude.com/docs/en/agent-sdk/quickstart`; AP-5
`https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account`.

**Others**: OT-hf-oauth `https://huggingface.co/docs/hub/oauth`; OT-hf-ip
`https://huggingface.co/docs/inference-providers/index`; OT-hf-pricing
`https://huggingface.co/docs/inference-providers/pricing`; OT-xai-oc
`https://x.ai/news/grok-opencode` (2026-05-21); OT-xai-kilo
`https://x.ai/news/grok-kilocode` (2026-05-27); OT-hermes
`https://hermes-agent.nousresearch.com/docs/guides/xai-grok-oauth`;
OT-xai-docs `https://docs.x.ai/developers/quickstart`; OT-mm
`https://platform.minimax.io/docs/m-plan/faq`; OT-ali
`https://www.alibabacloud.com/help/en/model-studio/other-tools-coding-plan`
(2026-09-28); OT-ali-faq
`https://www.alibabacloud.com/help/en/model-studio/coding-plan-faq`; OT-kimi
`https://www.kimi.com/en/help/kimi-code/third-party-agents`; OT-mistral
`https://docs.mistral.ai/admin/billing-usage/subscriptions` and
`https://docs.mistral.ai/admin/identity-access/api-keys`; OT-zai
`https://docs.z.ai/devpack/faq`; OT-ollama
`https://docs.ollama.com/api/authentication`; OT-cerebras
`https://www.cerebras.ai/code`; OT-ghm
`https://github.blog/changelog/2026-07-30-github-models-is-now-retired/`
(2026-07-30); OT-qwen
`https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/`.
