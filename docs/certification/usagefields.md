# USAGEFIELDS lane certification (2026-10-12, branch `feat/provider-usage-fields`)

Every usage and price field a provider reports is read and shown. Money shown
is what the provider reported for that request; where the reply gives no
number the product says "not reported", never a guess and never the highest
list price as the bill. Amounts are exact decimal text end to end. The spend
ledger and the reservation rule are untouched.

No live or paid model call was sent from this lane. Every wire shape below
rests on the provider's own documentation, quoted with its address and read
date, and is marked **UNVERIFIED** until a real request confirms it. The
exact confirmation requests are
[usagefields-capture-plan.json](usagefields-capture-plan.json) (10 requests,
committed first as `e594ba5`).

## GQ-G01 — Groq cached tokens (done, UNVERIFIED envelope path and billing)

- Built: `GROQ_PRESET.cachedUsageFields` names
  `prompt_tokens_details.cached_tokens` (`src/core/providers/presets.ts`);
  the chat codec already reads that path generically. Catalogue cards fill a
  missing Groq cached rate at half the input rate
  (`cataloguePriceCard`, `src/core/providers/priceCard.ts`), so cached
  tokens settle below the full input price.
- Rests on: "Prompt caching works automatically on all your API requests
  with no code changes required" and "There is a 50% discount for cached
  input tokens" (`https://console.groq.com/docs/prompt-caching`, read
  2026-10-12). The usage examples name `cached_tokens` beside
  `prompt_tokens` without an envelope path; the OpenAI-compatible nested
  path is assumed.
- UNVERIFIED until GQ-C1/C2: the exact usage chunk path and the billed
  50% on a real receipt. If Groq sends a top-level field, the codec drops
  it today.
- Person's steps: add a Groq provider, chat twice with the same long
  system prompt, run `/usage`: the second turn counts cached tokens and its
  cost sits near half the first turn's input cost.

## DS-G03 — DeepSeek reasoning price (done, UNVERIFIED envelope semantics)

- Built: catalogue `cost.reasoning` maps into `PriceCard.reasoning`
  (`cataloguePriceCard`); settlement prices the reported reasoning-token
  subset at that rate and the rest of output at the output rate; reservation
  takes the dearer of the two; the count threads through
  `modelPricedUsage`. A reasoning count outside output fails closed
  (unknown cost, budget closes) instead of mispricing.
- Rests on: `vendor/models-dev/snapshot.json` deepseek rows carry
  `cost.reasoning` (0.6 with output 0.6; 1.98 with output 1.98); today's
  rows settle exactly as before. The pricing page
  (`https://api-docs.deepseek.com/quick_start/pricing/`, read 2026-10-12)
  bills input and output tokens with no separate reasoning line.
- UNVERIFIED until DS-C1: whether `completion_tokens` already includes
  reasoning tokens (OpenAI semantics, assumed) and the exact
  `completion_tokens_details.reasoning_tokens` path.
- Person's steps: add a DeepSeek provider, send a thinking reply, run
  `/usage`: output tokens include the thought count and the cost matches
  the output price; a future catalogue row with a divergent reasoning price
  splits automatically.

## GEM-G01 — Tiered prices past 200K (done, tier application UNVERIFIED)

- Built: catalogue `tiers[]` (context type) and `context_over_200k` map
  into `PriceCard.longContextTier` for every preset, not only Gemini. All
  existing reserve/settle tier logic applies unchanged.
- Rests on: Gemini 2.5 Pro Standard —
  "Input price … $1.25, prompts <= 200k tokens $2.50, prompts > 200k tokens"
  and "Output price (including thinking tokens) … $10.00 … $15.00"
  (`https://ai.google.dev/gemini-api/docs/pricing`, read 2026-10-12),
  matching the snapshot tiers exactly (2.5/15/0.25 from 200000).
- UNVERIFIED until GEM-C1: the `usageMetadata` count paths (already mapped
  in the codec) against a real reply; tier billing itself needs a >200k
  prompt receipt.
- Person's steps: price a long Gemini 2.5 Pro session estimate past 200k
  input tokens: the reservation uses $2.50/$15, not $1.25/$10.

## HF-G01 — The routed upstream's price (done, routed signal UNVERIFIED)

- Built: `huggingFaceUpstreamCards` parses the live `/v1/models` row into
  per-upstream cards; with `upstream` chosen the panel shows that
  upstream's card, otherwise the dearest list card still bounds the bill.
- Rests on: the live list itself (126 rows fetched 2026-10-12; per-upstream
  `pricing{input,output}`), e.g. Qwen3.8-27B novita 0.42/3, ovhcloud
  0.47/3.19, deepinfra 0.2/2.5.
- UNVERIFIED until HF-C1: no reply field naming the routed upstream is
  known; the reply's suffixed model id is the only trace. Settlement still
  uses the catalogue card until a routed-bill receipt confirms the live
  card matches the bill.
- Person's steps: refresh the Hugging Face models list, pick a model with
  several upstreams: the price shown is the dearest; set `upstream` and it
  becomes that upstream's price.

## HF-G02 — Per-upstream context (done)

- Built: the capability record takes the smallest live `context_length`
  for auto routing, or the chosen upstream's window when pinned
  (`nativeCapabilityEvidence`, `src/core/providers/modelMetadata.ts`).
- Rests on: the live list (Qwen3.8-27B: novita 1000000, ovhcloud/deepinfra
  262144, captured 2026-10-12).
- Person's steps: scan the Hugging Face list for that model: context shows
  262144, never the 1M only one upstream honours.

## HF-G03 — Per-upstream tools/structured flags (done)

- Built: the record consults live `supports_tools` /
  `supports_structured_output` (unanimous among stating upstreams, or the
  chosen upstream's flags when pinned); the price fingerprint now carries
  per-upstream status, context and flags so a flag flip re-fingerprints on
  the next refresh.
- Rests on: the live list flags (captured 2026-10-12).
- Person's steps: compare two upstreams' flags in a refresh diff after a
  provider changes support: the fingerprint changes and tool availability
  follows the unanimous/chosen answer.

## HF-G04 — Upstream routing choice (done, send UNVERIFIED)

- Built: `providers.json` entries take `upstream` (Hugging Face entries
  only, validated); the chat codec sends the documented `model:upstream`
  suffix; policies `:cheapest`, `:fastest`, `:preferred` pass through the
  same field. README documents it.
- Rests on: "You can also select the provider of your choice by appending
  the provider name to the model id (e.g. `"openai/gpt-oss-120b:groq"`)",
  with `:cheapest`, `:preferred` and `:fastest` (default) policies
  (`https://huggingface.co/docs/inference-providers`, read 2026-10-12).
- UNVERIFIED until HF-C2: the suffix has never been sent from this product.
- Person's steps: set `"upstream": "novita"` on the Hugging Face entry
  and chat: the request goes to `model:novita` and the reply names it.

## OR-G04 — Credit balance (done, numbers UNVERIFIED)

- Built: the key test keeps its `GET /api/v1/key` body; the host parses
  `usage*`, `limit`, `limit_remaining` (else `effective_budget`) into the
  existing `KeyUsageSnapshot`; a tested key forwards it to Account & usage
  at once. Stream `cost` settlement is unchanged.
- Rests on: the `getCurrentKey` example in
  `https://openrouter.ai/openapi.json` (read 2026-10-12).
- UNVERIFIED until OR-C1: the example's fields against a real key reply.
- Person's steps: Test an OpenRouter key in Models & agents, then open
  Account & usage: remaining credit shows without sending a chat.

## FW-G01 — Isolation key (done, acceptance UNVERIFIED)

- Built: Fireworks requests send `prompt_cache_isolation_key` with the
  same stable key as `prompt_cache_key`, gated on the record accepting a
  key (`ChatPresetQuirks.sendCacheIsolationKey`,
  `src/core/backends/modelapi/codecs/chat.ts`).
- Rests on: "Isolation key for prompt caching to separate cache entries"
  (`https://docs.fireworks.ai/api-reference/post-chatcompletions`, read
  2026-10-12).
- UNVERIFIED until FW-C1: acceptance (no 400/422) on a real request.
- Person's steps: chat twice on Fireworks with shared prefix: the second
  request carries both key fields; cache hits behave as before.

## Also changed

- Catalogue `cache_write` prices now map (132 snapshot rows carried them
  unread; settlement previously priced writes at the input rate).
- `PriceCard.reasoning` and `PricedUsage.reasoningTokens` are new optional
  fields; `isValidUsage` requires the reasoning subset inside output.
- One new user-facing string (`providerText.schema.upstream`) in English
  and all 14 locales.

## Proof

- New `test/unit/providerUsageFields.test.ts`: 27 pure tests through the
  real modules (whole request bodies asserted, not fragments). 27 passed
  at repository timeouts.
- Dependents: `modelapiChatCodec` 92 passed; `providerOpenRouter` +
  `geminiCodec` 76 passed; `vitest related` over the changed files (see
  final message). `configuredProviders` loopback/stream cases (6) time out
  identically on the untouched base in the same conditions (measured, not
  labelled): the sandbox admits no loopback listener here.
- Static gates on the final tree (see final message): typecheck, ESLint and
  Prettier on changed files, `check:l10n`, `check:reference`, `deadcode`,
  `check:cycles`, duplication, `build`.
- Packed product run by the lane (see final message).
