# Mistral AI API (and Mistral plan keys): models, features, limits — research and product comparison

Research date 2026-10-17. Official sources only (§1); every value read on
2026-10-17. Product: `main` at `3d30a73214` (read only). Owner's rule
(2026-10-17, binding): "the limits we set on our agents hardcoded are **ONLY**
the limit set from the providers" and "**ALL** every model available through
every provider all hooks all features all limits etc".

Classes: **(a)** matches Mistral; **(b)** differs (both values given); **(c)**
missing from the product; **(d)** hard-coded in the product but not a Mistral
limit. "not documented" rows name the capture that would settle them (§6).

How the product reaches Mistral: preset `mistral` (`presets.ts:515-538`:
origin `https://api.mistral.ai`, Bearer, Chat Completions wire, models list
`/v1/models` with `max_context_length`, reasoning as a content list) and the
plan-key preset `mistral-plan` (`presets.ts:548-576`: same endpoint and keys,
`pricing: plan`, `limitsUrl` to Mistral's subscriptions page); request-time
records from the snapshot's 31 `mistral` rows (`configured.ts:436-454`).

## 1. Sources

| Key      | URL                                                                            | Read       |
| -------- | ------------------------------------------------------------------------------ | ---------- |
| OVERVIEW | https://docs.mistral.ai/getting-started/models/models_overview/                | 2026-10-17 |
| M        | https://docs.mistral.ai/models/&lt;slug&gt; (model pages linked from OVERVIEW) | 2026-10-17 |
| SUBS     | https://docs.mistral.ai/admin/billing-usage/subscriptions                      | 2026-10-17 |

## 2. Summary

- **Models.** OVERVIEW lists **71** entries: **23 active** and **48
  deprecated or retired** (with deprecation and retirement dates). All 71 are
  covered: active models in §5.1-§5.3 (one table each), deprecated ones in
  §5.4 (one row each with dates and the product's catalogue state).
- **Counts** (class tags on the 74 classified rows of §3-§5; a row may
  carry two): **(a) 31, (b) 8, (c) 36, (d) 1**. Itemised changes (§6):
  2 (b), 4 (c), 1 (d).
- **Most important mismatches.**
  1. **Retired models stay in the product's catalogue.** The snapshot keeps
     rows for ids Mistral has retired (e.g. `mistral-large-2411` retired
     2026-05-31, `devstral-2512` 2026-07-31, `mistral-small-2506` 2026-07-31,
     `mistral-medium-2508` 2026-08-31, `open-mixtral-8x22b` 2025-03-30); the
     product shows no lifecycle and requests to them fail.
  2. **New active models without a record**: `mistral-large-4-0` (1M
     context), `ministral-14b-2512`, `ministral-8b-2512`, `ministral-3b-2512`
     (256k) have no snapshot row; `ministral-8b-latest` / `ministral-3b-latest`
     carry 128,000 and `codestral-latest` 256,000 where the current versions
     state 256k and 128k.
  3. **Plan keys**: Mistral plans (Free, Pro, Education, Team, Enterprise)
     share a monthly allowance across Studio, the API and Vibe Code; without
     pay-as-you-go, usage "can stop until the next billing period" (SUBS). The
     product only links the subscriptions page (`presets.ts:574`) and reads no
     allowance.
  4. **Not used**: structured outputs, predicted outputs, document Q&A,
     built-in tools, agents/conversations, FIM, OCR, audio, embeddings,
     moderation; the Chat retry table is unused (`transport.ts:1087`).

## 3. Model list: provider vs product (active models)

| #     | Model (API name)                                                                                               | Kind                      | Product today                                                               | Class     |
| ----- | -------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------- | --------- |
| 1     | Z.ai GLM 5.3 (`zai-glm-5-3`)                                                                                   | generalist                | snapshot row                                                                | (a)       |
| 2     | Mistral Medium 3.5 (`mistral-medium-3-5` page; snapshot `mistral-medium-2604`, `mistral-medium-latest`)        | generalist, multimodal    | snapshot rows                                                               | (a)       |
| 3     | Mistral Small 4 (`mistral-small-2603`)                                                                         | generalist                | snapshot row                                                                | (a)       |
| 4     | Mistral Large 4 (`mistral-large-4-0`)                                                                          | generalist, multimodal    | **no snapshot row**                                                         | (c)       |
| 5     | Mistral Large 3 (`mistral-large-2512`)                                                                         | generalist, multimodal    | snapshot rows (`mistral-large-2512`, `mistral-large-latest`)                | (a)       |
| 6-8   | Ministral 3 14B / 8B / 3B (`ministral-14b-2512`, `ministral-8b-2512`, `ministral-3b-2512`)                     | generalist, text + vision | no dated rows; `ministral-8b-latest`, `ministral-3b-latest` rows at 128,000 | (b) / (c) |
| 9-10  | OCR 4.1 (`mistral-ocr-4-1`), OCR 3                                                                             | OCR                       | no client                                                                   | (c)       |
| 11-14 | Voxtral TTS, Voxtral Mini Transcribe 2, Voxtral Mini Transcribe Realtime, Voxtral Small (`voxtral-small-2507`) | audio                     | Voxtral Small has a row (audio input unwired); the others no client         | (c)       |
| 15    | Codestral (`codestral-2508`)                                                                                   | code                      | `codestral-latest` row at 256,000 / 4,096                                   | (b)       |
| 16-17 | Codestral Embed, Mistral Embed                                                                                 | embeddings                | no client                                                                   | (c)       |
| 18-19 | Shieldstral 1.0, Mistral Moderation 2 (`mistral-moderation-2603`)                                              | moderation                | no client                                                                   | (c)       |
| 20-23 | Timestral 1.0 123M / 28M / 5M / 209M                                                                           | time series               | no client                                                                   | (c)       |

## 4. Provider-wide features and limits

| Feature / limit            | Mistral                                                                                                                                                                                                                      | Source   | Product today (file:line)                                                      | Class          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------ | -------------- |
| Endpoint / auth            | `https://api.mistral.ai`; chat completions; Bearer                                                                                                                                                                           | M        | Chat, Bearer (`presets.ts:522-525`)                                            | (a)            |
| Key shape                  | not documented                                                                                                                                                                                                               | —        | any, min 16 (`presets.ts:527`)                                                 | (d) hint       |
| Capabilities (generalists) | function calling, structured outputs, predicted outputs, document Q&A, prefix, batching, agents/conversations, built-in tools (per page)                                                                                     | M        | function calling only; reasoning content list (`presets.ts:534`)               | (c) the rest   |
| Reasoning effort values    | not stated on the model pages read                                                                                                                                                                                           | M        | snapshot `none`/`high` for Small 4, Medium 3.5, Medium 2604                    | not documented |
| Prompt cache               | cached input priced on Large 4 ($0.07 sale / $0.14) and GLM 5.3 ($0.14)                                                                                                                                                      | M        | `sendCacheKey` from `record.cache.acceptsKey`, never set (`configured.ts:540`) | (c)            |
| Rate limits / tiers        | not on the pages read (the tier page linked from older docs returns 404)                                                                                                                                                     | —        | Meta's reader (`pacing.ts:30-44`)                                              | not documented |
| Plans                      | Free mode (default), Pro, Education, Team, Enterprise; monthly allowance shared by Studio, the API and Vibe Code, consumed first; then pay-as-you-go credits if enabled, else usage "can stop until the next billing period" | SUBS     | plan preset links SUBS (`presets.ts:574`); no allowance read                   | (c)            |
| Lifecycle                  | deprecation and retirement dates per model (§5.4)                                                                                                                                                                            | OVERVIEW | not shown                                                                      | (c)            |
| Retry                      | not documented on the pages read                                                                                                                                                                                             | —        | Meta's table (`transport.ts:1087`); Mistral's Chat table unused                | not documented |

## 5. Per-model tables

### 5.1 Generalists

#### `zai-glm-5-3` (Z.ai GLM 5.3 on Mistral)

| Item                 | Mistral                                                                                                                           | Source | Product today                        | Class          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------ | -------------- |
| Context / max output | 1M / 128k                                                                                                                         | M      | 1,000,000 / 131,072                  | (a)            |
| Capabilities         | chat completions, function calling, structured outputs, predicted outputs, prefix, batching; reasoning (effort values not stated) | M      | snapshot effort `low`, `high`, `max` | not documented |
| Price per 1M         | $1.4 in / $4.4 out / cached $0.14                                                                                                 | M      | $1.4 / $4.4 / $0.14                  | (a)            |

#### Mistral Medium 3.5 (`mistral-medium-2604` / `mistral-medium-latest`)

| Item         | Mistral                                                                                                                                          | Source | Product today                                 | Class                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | --------------------------------------------- | -------------------------- |
| Context      | 256k                                                                                                                                             | M      | 262,144                                       | (a)                        |
| Capabilities | multimodal; function calling, structured outputs, predicted outputs, document Q&A, prefix, batching, agents, built-in tools; reasoning indicated | M      | image input; effort `none`, `high` (snapshot) | (a); effort not documented |
| Price per 1M | $1.50 / $7.50                                                                                                                                    | M      | $1.5 / $7.5 / cache $0.15                     | (a)                        |

#### Mistral Small 4 (`mistral-small-2603`)

| Item         | Mistral                                                                                                                                           | Source | Product today                                          | Class          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------ | -------------- |
| Context      | 256k                                                                                                                                              | M      | 256,000 (`mistral-small-2603`, `mistral-small-latest`) | (a)            |
| Capabilities | hybrid instruct/reasoning/coding; function calling, structured outputs, predicted outputs, document Q&A, prefix, batching, agents, built-in tools | M      | effort `none`, `high` (snapshot)                       | not documented |
| Price per 1M | $0.15 / $0.60                                                                                                                                     | M      | $0.15 / $0.6                                           | (a)            |

#### Mistral Large 4 (`mistral-large-4-0`)

| Item         | Mistral                                                                     | Source   | Product today                                        | Class |
| ------------ | --------------------------------------------------------------------------- | -------- | ---------------------------------------------------- | ----- |
| Status       | active (v26.10)                                                             | OVERVIEW | **no snapshot row**                                  | (c)   |
| Context      | 1M; multimodal (1.6B vision encoder)                                        | M        | unknown; output 32,768 (`ModelApiHost.ts:4452-4455`) | (c)   |
| Price per 1M | sale $0.68 in / $2.09 out / cached $0.07 (originally $1.36 / $4.18 / $0.14) | M        | unpriced                                             | (c)   |

#### Mistral Large 3 (`mistral-large-2512`)

| Item         | Mistral                                                                                                  | Source | Product today | Class |
| ------------ | -------------------------------------------------------------------------------------------------------- | ------ | ------------- | ----- |
| Context      | 256k                                                                                                     | M      | 262,144       | (a)   |
| Capabilities | multimodal; structured outputs, function calling, document Q&A, prefix, batching, agents, built-in tools | M      | image input   | (a)   |
| Price per 1M | $0.5 and $1.5 (labels not given)                                                                         | M      | $0.5 / $1.5   | (a)   |

#### Ministral 3 14B / 8B / 3B (`ministral-14b-2512`, `ministral-8b-2512`, `ministral-3b-2512`)

| Item         | Mistral                                                                               | Source | Product today                                                                  | Class |
| ------------ | ------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ | ----- |
| Context      | 256k each                                                                             | M      | no dated rows; `ministral-8b-latest` and `ministral-3b-latest` rows at 128,000 | (b)   |
| Capabilities | text and vision; structured outputs, function calling, document Q&A, prefix, batching | M      | text only in the `-latest` rows                                                | (b)   |
| Price per 1M | 14B $0.2 / $0.2; 8B $0.15 / $0.15; 3B $0.1 / $0.1                                     | M      | 8B $0.1 / $0.1; 3B $0.04 / $0.04 (`-latest` rows)                              | (b)   |

### 5.2 Code and audio

#### Codestral (`codestral-2508`)

| Item         | Mistral                                         | Source | Product today                      | Class   |
| ------------ | ----------------------------------------------- | ------ | ---------------------------------- | ------- |
| Context      | 128k                                            | M      | `codestral-latest` 256,000 / 4,096 | (b)     |
| Capabilities | FIM via `/v1/fim/completions`; function calling | M      | chat only                          | (c) FIM |
| Price per 1M | $0.3 / $0.9                                     | M      | $0.3 / $0.9                        | (a)     |

#### Voxtral Small (`voxtral-small-2507`)

| Item    | Mistral                               | Source | Product today                                           | Class          |
| ------- | ------------------------------------- | ------ | ------------------------------------------------------- | -------------- |
| Context | 32k; audio input for instruct use     | M      | 32,000; audio input unwired (`mediaProviders.ts:55-56`) | (a); (c) audio |
| Price   | $0.004/min; $0.1 / $0.4 per 1M tokens | M      | $0.1 / $0.3                                             | (b)            |

### 5.3 Specialist models (no product client)

| Model                                                                                               | Mistral                                                                       | Source   | Product today | Class |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------- | ------------- | ----- |
| OCR 4.1 (`mistral-ocr-4-1`)                                                                         | $4 per 1,000 pages; $5 per 1,000 annotated pages; limits not in the part read | M        | none          | (c)   |
| OCR 3 (v25.12)                                                                                      | page not read                                                                 | OVERVIEW | none          | (c)   |
| Voxtral TTS (v26.03), Voxtral Mini Transcribe 2 (v26.02), Voxtral Mini Transcribe Realtime (v26.02) | audio models; pages not read                                                  | OVERVIEW | none          | (c)   |
| Codestral Embed (v25.05), Mistral Embed (v23.12)                                                    | embeddings                                                                    | OVERVIEW | none          | (c)   |
| Shieldstral 1.0                                                                                     | moderation, text and image                                                    | OVERVIEW | none          | (c)   |
| Mistral Moderation 2 (`mistral-moderation-2603`)                                                    | 128k; free                                                                    | M        | none          | (c)   |
| Timestral 1.0 123M / 28M / 5M / 209M                                                                | time series                                                                   | OVERVIEW | none          | (c)   |

### 5.4 Deprecated and retired models (48)

Product column: whether the snapshot still carries the id (it would be
offered with no lifecycle notice).

| Model (API name)                                                                                                                                     | Deprecated → retired                                      | Product today                                                               | Class |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- | ----- |
| Z.ai GLM 5.2 (`zai-glm-5-2`)                                                                                                                         | 2026-09-29 → 2026-10-31                                   | snapshot row, no notice                                                     | (c)   |
| Leanstral 1.5 (`labs-leanstral-1-5`)                                                                                                                 | 2026-09-29 → 2026-09-30                                   | —                                                                           | (a)   |
| Leanstral (`labs-leanstral-2603`)                                                                                                                    | 2026-05-22 → 2026-06-30                                   | —                                                                           | (a)   |
| Mistral Medium 3.1 (`mistral-medium-2508`)                                                                                                           | 2026-05-22 → 2026-08-31                                   | snapshot row (retired)                                                      | (c)   |
| Mistral Small 3.2 (`mistral-small-2506`)                                                                                                             | 2026-04-30 → 2026-07-31                                   | snapshot row (retired)                                                      | (c)   |
| OCR 4.0 (`mistral-ocr-4-0`)                                                                                                                          | 2026-09-29 → 2026-09-30                                   | —                                                                           | (a)   |
| Voxtral Mini Transcribe / Voxtral Mini (`voxtral-mini-2507`)                                                                                         | 2026-02-27 → 2026-05-31                                   | —                                                                           | (a)   |
| Devstral 2 (`devstral-2512`)                                                                                                                         | 2026-05-22 → 2026-07-31                                   | snapshot row (retired)                                                      | (c)   |
| Magistral Medium 1.1 (`magistral-medium-2507`)                                                                                                       | 2025-10-31 → 2025-11-30                                   | —                                                                           | (a)   |
| Mistral Small Creative (`labs-mistral-small-creative`)                                                                                               | 2026-03-31 → 2026-04-30                                   | —                                                                           | (a)   |
| Devstral Small 2 (`labs-devstral-small-2512`)                                                                                                        | 2026-02-27 → 2026-03-31                                   | snapshot row (retired)                                                      | (c)   |
| Magistral Medium 1.2 (`magistral-medium-2509`)                                                                                                       | 2026-05-22 → 2026-07-31                                   | `magistral-medium-latest` row                                               | (c)   |
| Magistral Small 1.2 / 1.1 / 1.0 (`magistral-small-2509`, `-2507`, `-2506`)                                                                           | 2026-04-30 → 2026-07-31; 2025-10-31 → 2025-11-30          | —                                                                           | (a)   |
| Devstral Medium 1.0 (`devstral-medium-2507`)                                                                                                         | 2026-02-27 → 2026-05-31                                   | snapshot row (retired)                                                      | (c)   |
| Devstral Small 1.1 / 1.0 (`devstral-small-2507`, `-2505`)                                                                                            | 2026-02-27 → 2026-05-31; 2025-10-31 → 2025-11-30          | snapshot rows (retired)                                                     | (c)   |
| Magistral Medium 1.0 (`magistral-medium-2506`)                                                                                                       | 2025-10-31 → 2025-11-30                                   | —                                                                           | (a)   |
| OCR 2 (`mistral-ocr-2505`), OCR (`mistral-ocr-2503`)                                                                                                 | 2026-02-27 → 2026-05-31; 2025-12-02 → 2025-12-31          | —                                                                           | (a)   |
| Mistral Medium 3 (`mistral-medium-2505`)                                                                                                             | 2026-05-22 → 2026-08-31                                   | snapshot row (retired)                                                      | (c)   |
| Mistral Small 3.1 / 3.0 / 2.0 / 1.0 (`mistral-small-2503`, `-2501`, `-2409`, `-2402`)                                                                | retired 2025-11-30 / 2025-11-30 / 2025-11-30 / 2025-06-16 | —                                                                           | (a)   |
| Mistral Saba (`mistral-saba-2502`)                                                                                                                   | 2025-06-10 → 2025-09-30                                   | —                                                                           | (a)   |
| Codestral (`codestral-2501`, `codestral-2405`), Codestral Mamba (`open-codestral-mamba`)                                                             | retired 2025-11-30, 2025-06-16, 2025-06-06                | —                                                                           | (a)   |
| Mistral Large 2.1 (`mistral-large-2411`), 2.0 (`-2407`), 1.0 (`-2402`)                                                                               | retired 2026-05-31, 2025-03-30, 2025-06-16                | `mistral-large-2411` snapshot row (retired)                                 | (c)   |
| Pixtral Large (`pixtral-large-2411`), Pixtral 12B (`pixtral-12b-2409`)                                                                               | retired 2026-05-31, 2025-12-31                            | `pixtral-large-latest`, `pixtral-12b` rows                                  | (c)   |
| Mistral Moderation (`mistral-moderation-2411`)                                                                                                       | 2026-03-31 → 2026-06-30                                   | —                                                                           | (a)   |
| Ministral 3B / 8B (`ministral-3b-2410`, `ministral-8b-2410`)                                                                                         | 2025-12-02 → 2025-12-31                                   | `-latest` rows (see §5.1)                                                   | (b)   |
| Mistral Nemo 12B (`open-mistral-nemo-2407`)                                                                                                          | 2026-05-22 → 2026-07-31                                   | `open-mistral-nemo`, `mistral-nemo` rows (retired)                          | (c)   |
| Mathstral 7B; Mistral Next                                                                                                                           | dates not listed                                          | —                                                                           | (a)   |
| Mistral 7B (`open-mistral-7b`), Mixtral 8x22B (`open-mixtral-8x22b`), Mixtral 8x7B (`open-mixtral-8x7b`), Mistral Medium 1.0 (`mistral-medium-2312`) | retired 2025-03-30 / 2025-06-16                           | `open-mistral-7b`, `open-mixtral-8x22b`, `open-mixtral-8x7b` rows (retired) | (c)   |

## 6. Every (b), (c) and (d) item with the exact product change

| #   | Class | Item                                                                                                             | Product (file:line)     | Exact change                                                                                                                                 |
| --- | ----- | ---------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| MB1 | (b)   | `-latest` rows with old limits (Ministral 128,000; Codestral 256,000 / 4,096)                                    | snapshot                | records per dated version from the model pages; resolve `-latest` through the live list                                                      |
| MB2 | (b)   | Voxtral Small price                                                                                              | snapshot                | $0.1 / $0.4 per 1M plus $0.004/min audio                                                                                                     |
| MC1 | (c)   | Lifecycle (deprecation / retirement dates)                                                                       | `configured.ts:436-454` | read dates from the live list or OVERVIEW; hide retired ids                                                                                  |
| MC2 | (c)   | Records for `mistral-large-4-0` and the 2512 Ministral models                                                    | `configured.ts:436-454` | live `max_context_length` at request time (lead's C2)                                                                                        |
| MC3 | (c)   | Plan allowance                                                                                                   | `presets.ts:548-576`    | show the allowance from Admin Panel › Subscription if an API exposes it; otherwise keep the link and stop on the documented exhaustion error |
| MC4 | (c)   | Structured outputs, predicted outputs, FIM, OCR, audio, embeddings, moderation, built-in tools, prompt-cache key | `codecs/chat.ts`        | per-feature owner decision; cache key per record                                                                                             |
| MD1 | (d)   | Key length refusal                                                                                               | `presets.ts:527`        | hint only                                                                                                                                    |

## 7. Not documented / not verified

- Rate limits and tiers, retry guidance, error envelope, reasoning-effort
  values, max output per model (none on the pages read; capture: one 429 and
  one request with each effort).
- Specialist model pages (OCR 3, Voxtral TTS / Transcribe, embeddings,
  Shieldstral, Timestral) were not read.
- Whether "256k" means 256,000 or 262,144 tokens (the snapshot uses both).
