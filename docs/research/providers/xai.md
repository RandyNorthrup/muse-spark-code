# xAI API: models, features, limits — research and product comparison

Research date 2026-10-17. Official sources only (§1); every value read on
2026-10-17. Product: `main` at `3d30a73214` (read only). Owner's rule
(2026-10-17, binding): "the limits we set on our agents hardcoded are **ONLY**
the limit set from the providers" and "**ALL** every model available through
every provider all hooks all features all limits etc".

Classes: **(a)** matches xAI; **(b)** differs (both values given); **(c)**
missing from the product; **(d)** hard-coded in the product but not an xAI
limit. "not documented" rows name the capture that would settle them (§6).

How the product reaches xAI: preset `xai` (`presets.ts:354-378`: origin
`https://api.x.ai`, Bearer, Responses wire, models list `/v1/models` with
`context_length` and integer prices, encrypted reasoning replay), the same
Responses body as OpenAI (`ModelApiHost.ts:4504-4521`) and the snapshot's 7
`xai` rows at request time (`configured.ts:436-454`).

## 1. Sources

| Key    | URL                                                                | Read       |
| ------ | ------------------------------------------------------------------ | ---------- |
| MODELS | https://docs.x.ai/docs/models                                      | 2026-10-17 |
| RL     | https://docs.x.ai/docs/key-information/consumption-and-rate-limits | 2026-10-17 |
| REASON | https://docs.x.ai/docs/guides/reasoning                            | 2026-10-17 |
| IMG    | https://docs.x.ai/docs/guides/image-understanding                  | 2026-10-17 |
| FC     | https://docs.x.ai/docs/guides/function-calling                     | 2026-10-17 |

## 2. Summary

- **Models.** MODELS prices **18** entries: 8 text models, 6 Imagine
  (image/video) models, 4 voice entries (two without a model id). All 18 are
  covered in §5. Aliases follow `<model>`, `<model>-latest`, `<model>-<date>`
  (MODELS; none listed per model).
- **Counts** (class tags on the 68 classified rows of §3-§5; a row may
  carry two): **(a) 37, (b) 15, (c) 26, (d) 3**. Itemised changes (§6):
  4 (b), 4 (c), 3 (d).
- **Most important mismatches.**
  1. **Thinking off sends `reasoning.effort: "none"`** (`modelPolicy.ts:157-172`);
     xAI: "There is no 'none' level. 'Reasoning cannot be disabled'" on
     grok-4.7, 4.6, 4.5 (REASON). The snapshot lists `none` for grok-4.3,
     which REASON does not name among the models that accept
     `reasoning_effort`.
  2. **Rate limits are per second**: RPS = RPM ÷ 48 (minimum 2) and TPM, per
     model per team, Tiers 0-4 by cumulative spend (RL); the product paces a
     60 s window with Meta's reader (`pacing.ts:30-44`, `constants.ts:2257-2260`).
     xAI documents no rate-limit headers.
  3. **Images**: xAI takes JPG/JPEG and PNG only, up to 20 MiB, with "No
     limit" on count (IMG); the product sends GIF and WEBP too
     (`constants.ts:1305`), refuses above 10 MiB (`constants.ts:1316`) and
     above 50 images (`constants.ts:1492-1494`).
  4. **Error codes dropped**: xAI answers on the Responses wire, whose
     `parseError` keeps no `type`/`code` (`configured.ts:638-640`).
  5. **Long-prompt pricing** (≥ 200k prompt tokens doubles every rate) is not
     in the price card (`configured.ts:458-469`).
  6. **Not used**: web search and X search (server-side tools), up to 350 tools
     per request (FC), Imagine and voice models.

## 3. Model list: provider vs product

| #     | Model                                                                                                             | Kind    | Product today       | Class |
| ----- | ----------------------------------------------------------------------------------------------------------------- | ------- | ------------------- | ----- |
| 1     | `grok-4.7`                                                                                                        | text    | snapshot row        | (a)   |
| 2     | `grok-4.6`                                                                                                        | text    | snapshot row        | (a)   |
| 3     | `grok-4.5`                                                                                                        | text    | snapshot row        | (a)   |
| 4     | `grok-4.3`                                                                                                        | text    | snapshot row        | (a)   |
| 5     | `grok-4.20-0309-reasoning`                                                                                        | text    | snapshot row        | (a)   |
| 6     | `grok-4.20-0309-non-reasoning`                                                                                    | text    | snapshot row        | (a)   |
| 7     | `grok-build-0.1`                                                                                                  | text    | snapshot row        | (a)   |
| 8     | `grok-4.20-multi-agent-0309`                                                                                      | text    | **no snapshot row** | (c)   |
| 9-14  | `grok-imagine-image`, `-image-2.0`, `-image-quality`, `grok-imagine-video-1.5`, `-1.5-lite`, `grok-imagine-video` | Imagine | no client           | (c)   |
| 15-18 | `grok-voice-2.0` (deprecated), `grok-voice-3.0`, Speech to Text, Text to Speech                                   | voice   | no client           | (c)   |

## 4. Provider-wide features and limits

| Feature / limit                 | xAI                                                                                                                                                                                               | Source            | Product today (file:line)                                                                              | Class                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------- |
| Endpoint, auth                  | `https://api.x.ai`, Bearer; Responses and Chat Completions                                                                                                                                        | MODELS, REASON    | Responses, Bearer (`presets.ts:362-366`)                                                               | (a)                             |
| Key shape                       | not documented                                                                                                                                                                                    | —                 | prefix `xai-`, min 20 (`presets.ts:366`)                                                               | (d) hint                        |
| Reasoning                       | effort on grok-4.7/4.6 `low`, `medium`, `high` (default), `xhigh`; grok-4.5 `low`..`high` (`xhigh` → `high`); no `none`; multi-agent uses effort for 4 or 16 agents                               | REASON            | record levels or `none` (`modelPolicy.ts:157-172`)                                                     | (b) off                         |
| Encrypted reasoning             | `include: ["reasoning.encrypted_content"]`; grok-4.7 always returns it; pass reasoning items back unchanged; `store` controls `previous_response_id`                                              | REASON            | include + `store: false` + replay (`ModelApiHost.ts:4517-4518`; `presets.ts:374`)                      | (a)                             |
| Reasoning tokens                | reported as `reasoning_tokens`; billed                                                                                                                                                            | REASON            | read                                                                                                   | (a)                             |
| Unsupported on reasoning models | `presencePenalty`, `frequencyPenalty`, `stop` return an error; `logprobs`/`top_logprobs` ignored on grok-4.20+                                                                                    | REASON, MODELS    | none of them sent                                                                                      | (a)                             |
| Tools                           | up to 350 per request; `tool_choice` `auto` (default), `required`, `none`, named; parallel calls on by default (`parallel_tool_calls: false` disables)                                            | FC                | `auto`; no total tool check; MCP 128 per server (`constants.ts:4812`)                                  | (a); total (c); per-server (d)  |
| Strict / structured outputs     | not mentioned on FC                                                                                                                                                                               | FC                | `supportsStrictTools: false` (responses default, `presets.ts:173`)                                     | not documented                  |
| Server-side tools               | web search, X search                                                                                                                                                                              | FC                | not sent                                                                                               | (c)                             |
| Images                          | JPG/JPEG, PNG; ≤ 20 MiB; "No limit" on count; URL or base64                                                                                                                                       | IMG               | GIF/WEBP also sent (`constants.ts:1305`); 10 MiB (`constants.ts:1316`); 50 (`constants.ts:1492-1494`)  | (b) types and count; (d) 10 MiB |
| PDFs / files                    | not mentioned on IMG                                                                                                                                                                              | IMG               | inline PDF when the record lists `pdf` (snapshot says pdf for every text model)                        | not documented                  |
| Rate limits                     | per model per team; RPS (RPM ÷ 48, min 2) and TPM; Tiers 0 ($0), 1 ($50), 2 ($250), 3 ($1,000), 4 ($5,000) cumulative since 2026-01-01; prompt, completion, reasoning and cached tokens all count | RL                | 60 s window, Meta's reader, one bucket per key (`pacing.ts:30-44,96-117`)                              | (b)                             |
| Rate-limit headers              | not named                                                                                                                                                                                         | RL                | `x-ratelimit-*` read if present                                                                        | not documented                  |
| 429                             | "Exceeding any limit returns a `429 Too Many Requests` error"; examples back off 2^attempt s, up to 5 attempts                                                                                    | RL                | 4 retries, 1-60 s (`constants.ts:2316-2318`)                                                           | (a)                             |
| Error envelope                  | not documented on the pages read                                                                                                                                                                  | —                 | generic error, no code (`configured.ts:638-640`)                                                       | not documented                  |
| Pricing                         | per model, two prompt tiers (< 200k, ≥ 200k)                                                                                                                                                      | MODELS            | catalogue price, one tier (`configured.ts:458-469`)                                                    | (c) tier                        |
| Models list                     | live list carries `context_length` and integer prices                                                                                                                                             | (product capture) | read at scan only (`configured.ts:870-894`); request-time uses the catalogue (`configured.ts:499-500`) | (c)                             |

## 5. Per-model tables

#### `grok-4.7`

| Item                                            | xAI                                                                                  | Source (2026-10-17) | Product today                                                                         | Class                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------- | ------------------------- |
| Status                                          | listed (text)                                                                        | MODELS              | snapshot row                                                                          | (a)                       |
| Context                                         | 500k                                                                                 | MODELS              | 500000                                                                                | (a)                       |
| Max output                                      | not documented                                                                       | —                   | 500000 (snapshot)                                                                     | not documented            |
| Reasoning effort                                | low, medium, high, xhigh; default `high`; no `none` ("Reasoning cannot be disabled") | REASON              | levels low, medium, high, xhigh; Thinking off sends `none` (`modelPolicy.ts:157-172`) | (a); off (b)              |
| Price per 1M (< 200k prompt: in / cached / out) | $2.0 / $0.5 / $6.0; ≥ 200k: $4.0 / $1.0 / $12.0                                      | MODELS              | $2 / $0.5 / $6 (catalogue; the live list's integer prices are scan-only)              | (a); long-prompt tier (c) |
| Rate limits (Tier 0 → Tier 4)                   | 150 RPS / 50M TPM → 500 RPS / 100M TPM; RPS = RPM ÷ 48 (min 2)                       | RL                  | Meta's per-minute reader; no per-model bucket                                         | (b)                       |
| Notes                                           | encrypted reasoning returned on every Responses answer                               | MODELS, REASON      | —                                                                                     | —                         |

#### `grok-4.6`

| Item                                            | xAI                                                                                  | Source (2026-10-17) | Product today                                                                         | Class                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------- | ------------------------- |
| Status                                          | listed (text)                                                                        | MODELS              | snapshot row                                                                          | (a)                       |
| Context                                         | 500k                                                                                 | MODELS              | 500000                                                                                | (a)                       |
| Max output                                      | not documented                                                                       | —                   | 500000 (snapshot)                                                                     | not documented            |
| Reasoning effort                                | low, medium, high, xhigh; default `high`; no `none` ("Reasoning cannot be disabled") | REASON              | levels low, medium, high, xhigh; Thinking off sends `none` (`modelPolicy.ts:157-172`) | (a); off (b)              |
| Price per 1M (< 200k prompt: in / cached / out) | $2.0 / $0.5 / $6.0; ≥ 200k: $4.0 / $1.0 / $12.0                                      | MODELS              | $2 / $0.5 / $6 (catalogue; the live list's integer prices are scan-only)              | (a); long-prompt tier (c) |
| Rate limits (Tier 0 → Tier 4)                   | 150 RPS / 50M TPM → 500 RPS / 100M TPM; RPS = RPM ÷ 48 (min 2)                       | RL                  | Meta's per-minute reader; no per-model bucket                                         | (b)                       |

#### `grok-4.5`

| Item                                            | xAI                                                                           | Source (2026-10-17) | Product today                                                                  | Class                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------ | ------------------------- |
| Status                                          | listed (text)                                                                 | MODELS              | snapshot row                                                                   | (a)                       |
| Context                                         | 500k                                                                          | MODELS              | 500000                                                                         | (a)                       |
| Max output                                      | not documented                                                                | —                   | 500000 (snapshot)                                                              | not documented            |
| Reasoning effort                                | low, medium, high; default `high`; no `none` ("Reasoning cannot be disabled") | REASON              | levels low, medium, high; Thinking off sends `none` (`modelPolicy.ts:157-172`) | (a); off (b)              |
| Price per 1M (< 200k prompt: in / cached / out) | $2.0 / $0.3 / $6.0; ≥ 200k: $4.0 / $0.6 / $12.0                               | MODELS              | $2 / $0.3 / $6 (catalogue; the live list's integer prices are scan-only)       | (a); long-prompt tier (c) |
| Rate limits (Tier 0 → Tier 4)                   | 150 RPS / 50M TPM → 500 RPS / 100M TPM; RPS = RPM ÷ 48 (min 2)                | RL                  | Meta's per-minute reader; no per-model bucket                                  | (b)                       |
| Notes                                           | `xhigh` is treated as `high`                                                  | MODELS, REASON      | —                                                                              | —                         |

#### `grok-4.3`

| Item                                            | xAI                                                          | Source (2026-10-17) | Product today                                                                 | Class                     |
| ----------------------------------------------- | ------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------- | ------------------------- |
| Status                                          | listed (text)                                                | MODELS              | snapshot row                                                                  | (a)                       |
| Context                                         | 1M                                                           | MODELS              | 1000000                                                                       | (a)                       |
| Max output                                      | not documented                                               | —                   | 30000 (snapshot)                                                              | not documented            |
| Reasoning effort                                | not among the models that accept `reasoning_effort`          | REASON              | levels none, low, medium, high                                                | (b)                       |
| Price per 1M (< 200k prompt: in / cached / out) | $1.25 / $0.2 / $2.5; ≥ 200k: $2.5 / $0.4 / $5.0              | MODELS              | $1.25 / $0.2 / $2.5 (catalogue; the live list's integer prices are scan-only) | (a); long-prompt tier (c) |
| Rate limits (Tier 0 → Tier 4)                   | 37 RPS / 10M TPM → 208 RPS / 85M TPM; RPS = RPM ÷ 48 (min 2) | RL                  | Meta's per-minute reader; no per-model bucket                                 | (b)                       |
| Notes                                           | not named among the models that accept `reasoning_effort`    | MODELS, REASON      | —                                                                             | —                         |

#### `grok-4.20-0309-reasoning`

| Item                                            | xAI                                                          | Source (2026-10-17) | Product today                                                                 | Class                     |
| ----------------------------------------------- | ------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------- | ------------------------- |
| Status                                          | listed (text)                                                | MODELS              | snapshot row                                                                  | (a)                       |
| Context                                         | 1M                                                           | MODELS              | 1000000                                                                       | (a)                       |
| Max output                                      | not documented                                               | —                   | 30000 (snapshot)                                                              | not documented            |
| Reasoning effort                                | not among the models that accept `reasoning_effort`          | REASON              | none listed → `none` sent                                                     | not documented            |
| Price per 1M (< 200k prompt: in / cached / out) | $1.25 / $0.2 / $2.5; ≥ 200k: $2.5 / $0.4 / $5.0              | MODELS              | $1.25 / $0.2 / $2.5 (catalogue; the live list's integer prices are scan-only) | (a); long-prompt tier (c) |
| Rate limits (Tier 0 → Tier 4)                   | 37 RPS / 10M TPM → 208 RPS / 85M TPM; RPS = RPM ÷ 48 (min 2) | RL                  | Meta's per-minute reader; no per-model bucket                                 | (b)                       |
| Notes                                           | logprobs ignored                                             | MODELS, REASON      | —                                                                             | —                         |

#### `grok-4.20-0309-non-reasoning`

| Item                                            | xAI                                                          | Source (2026-10-17) | Product today                                                                 | Class                     |
| ----------------------------------------------- | ------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------- | ------------------------- |
| Status                                          | listed (text)                                                | MODELS              | snapshot row                                                                  | (a)                       |
| Context                                         | 1M                                                           | MODELS              | 1000000                                                                       | (a)                       |
| Max output                                      | not documented                                               | —                   | 30000 (snapshot)                                                              | not documented            |
| Reasoning effort                                | not among the models that accept `reasoning_effort`          | REASON              | none listed → `none` sent                                                     | not documented            |
| Price per 1M (< 200k prompt: in / cached / out) | $1.25 / $0.2 / $2.5; ≥ 200k: $2.5 / $0.4 / $5.0              | MODELS              | $1.25 / $0.2 / $2.5 (catalogue; the live list's integer prices are scan-only) | (a); long-prompt tier (c) |
| Rate limits (Tier 0 → Tier 4)                   | 37 RPS / 10M TPM → 208 RPS / 85M TPM; RPS = RPM ÷ 48 (min 2) | RL                  | Meta's per-minute reader; no per-model bucket                                 | (b)                       |
| Notes                                           | logprobs ignored                                             | MODELS, REASON      | —                                                                             | —                         |

#### `grok-build-0.1`

| Item                                            | xAI                                                          | Source (2026-10-17) | Product today                                                            | Class                     |
| ----------------------------------------------- | ------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------ | ------------------------- |
| Status                                          | listed (text)                                                | MODELS              | snapshot row                                                             | (a)                       |
| Context                                         | 256k                                                         | MODELS              | 256000                                                                   | (a)                       |
| Max output                                      | not documented                                               | —                   | 256000 (snapshot)                                                        | not documented            |
| Reasoning effort                                | not among the models that accept `reasoning_effort`          | REASON              | none listed → `none` sent                                                | not documented            |
| Price per 1M (< 200k prompt: in / cached / out) | $1.0 / $0.2 / $2.0; ≥ 200k: $2.0 / $0.4 / $4.0               | MODELS              | $1 / $0.2 / $2 (catalogue; the live list's integer prices are scan-only) | (a); long-prompt tier (c) |
| Rate limits (Tier 0 → Tier 4)                   | 37 RPS / 10M TPM → 208 RPS / 85M TPM; RPS = RPM ÷ 48 (min 2) | RL                  | Meta's per-minute reader; no per-model bucket                            | (b)                       |

#### `grok-4.20-multi-agent-0309`

| Item                          | xAI                                                         | Source (2026-10-17) | Product today                                 | Class          |
| ----------------------------- | ----------------------------------------------------------- | ------------------- | --------------------------------------------- | -------------- |
| Status                        | listed (text)                                               | MODELS              | no snapshot row                               | (c)            |
| Context                       | 1M                                                          | MODELS              | unknown                                       | (c)            |
| Reasoning effort              | not among the models that accept `reasoning_effort`         | REASON              | none listed → `none` sent                     | not documented |
| Rate limits (Tier 0 → Tier 4) | 9 RPS / 2.5M TPM → 56 RPS / 21M TPM; RPS = RPM ÷ 48 (min 2) | RL                  | Meta's per-minute reader; no per-model bucket | (b)            |
| Notes                         | `reasoning.effort` picks 4 or 16 collaborating agents       | MODELS, REASON      | —                                             | —              |

#### `grok-imagine-image`

| Item           | xAI                                            | Source (2026-10-17) | Product today                  | Class |
| -------------- | ---------------------------------------------- | ------------------- | ------------------------------ | ----- |
| Status / price | $0.02 per image; limits not on the models page | MODELS              | no client for Imagine or voice | (c)   |

#### `grok-imagine-image-2.0`

| Item           | xAI                                            | Source (2026-10-17) | Product today                  | Class |
| -------------- | ---------------------------------------------- | ------------------- | ------------------------------ | ----- |
| Status / price | $0.04 per image; limits not on the models page | MODELS              | no client for Imagine or voice | (c)   |

#### `grok-imagine-image-quality`

| Item           | xAI                                            | Source (2026-10-17) | Product today                  | Class |
| -------------- | ---------------------------------------------- | ------------------- | ------------------------------ | ----- |
| Status / price | $0.05 per image; limits not on the models page | MODELS              | no client for Imagine or voice | (c)   |

#### `grok-imagine-video-1.5`

| Item           | xAI                                              | Source (2026-10-17) | Product today                  | Class |
| -------------- | ------------------------------------------------ | ------------------- | ------------------------------ | ----- |
| Status / price | $0.080 per second; limits not on the models page | MODELS              | no client for Imagine or voice | (c)   |

#### `grok-imagine-video-1.5-lite`

| Item           | xAI                                              | Source (2026-10-17) | Product today                  | Class |
| -------------- | ------------------------------------------------ | ------------------- | ------------------------------ | ----- |
| Status / price | $0.020 per second; limits not on the models page | MODELS              | no client for Imagine or voice | (c)   |

#### `grok-imagine-video`

| Item           | xAI                                              | Source (2026-10-17) | Product today                  | Class |
| -------------- | ------------------------------------------------ | ------------------- | ------------------------------ | ----- |
| Status / price | $0.050 per second; limits not on the models page | MODELS              | no client for Imagine or voice | (c)   |

#### `grok-voice-2.0 (deprecated)`

| Item           | xAI                                                                                     | Source (2026-10-17) | Product today                  | Class |
| -------------- | --------------------------------------------------------------------------------------- | ------------------- | ------------------------------ | ----- |
| Status / price | $0.08 per minute ($4.80 per hour); $0.004 per text input; limits not on the models page | MODELS              | no client for Imagine or voice | (c)   |

#### `grok-voice-3.0`

| Item           | xAI                                                                                     | Source (2026-10-17) | Product today                  | Class |
| -------------- | --------------------------------------------------------------------------------------- | ------------------- | ------------------------------ | ----- |
| Status / price | $0.08 per minute ($4.80 per hour); $0.004 per text input; limits not on the models page | MODELS              | no client for Imagine or voice | (c)   |

#### `Speech to Text (no id on the page)`

| Item           | xAI                                                                              | Source (2026-10-17) | Product today                  | Class |
| -------------- | -------------------------------------------------------------------------------- | ------------------- | ------------------------------ | ----- |
| Status / price | $0.10 per hour (REST), $0.20 per hour (streaming); limits not on the models page | MODELS              | no client for Imagine or voice | (c)   |

#### `Text to Speech (no id on the page)`

| Item           | xAI                                                     | Source (2026-10-17) | Product today                  | Class |
| -------------- | ------------------------------------------------------- | ------------------- | ------------------------------ | ----- |
| Status / price | $15.00 per 1M characters; limits not on the models page | MODELS              | no client for Imagine or voice | (c)   |

## 6. Every (b), (c) and (d) item with the exact product change

| #   | Class | Item                                             | Product (file:line)                         | Exact change                                                                                                                                       |
| --- | ----- | ------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| XB1 | (b)   | Thinking off sends `none`                        | `modelPolicy.ts:157-172`                    | for xAI, Thinking off = the lowest listed level (`low`) with a notice that reasoning cannot be disabled; grok-4.3 / 4.20 / build: omit `reasoning` |
| XB2 | (b)   | 60 s pacing window                               | `pacing.ts:30-44`; `constants.ts:2257-2260` | per-model RPS/TPM buckets; cold start from RL's Tier 0 values                                                                                      |
| XB3 | (b)   | Image types and count                            | `constants.ts:1305,1492-1494`               | JPG/PNG only, no count limit for xAI                                                                                                               |
| XB4 | (b)   | grok-4.3 effort list with `none` in the snapshot | snapshot row                                | documented list (REASON names only 4.7/4.6/4.5)                                                                                                    |
| XC1 | (c)   | `grok-4.20-multi-agent-0309` record              | `configured.ts:436-454`                     | live list (`context_length`) into the request-time record                                                                                          |
| XC2 | (c)   | Long-prompt price tier                           | `configured.ts:458-469`                     | two-tier price card                                                                                                                                |
| XC3 | (c)   | Web search, X search, total tool count (350)     | `codecs/responses.ts`; request builder      | encode server tools per model; check the total                                                                                                     |
| XC4 | (c)   | Imagine, voice                                   | —                                           | owner decision                                                                                                                                     |
| XD1 | (d)   | 10 MiB per image                                 | `constants.ts:1316`                         | xAI's 20 MiB                                                                                                                                       |
| XD2 | (d)   | MCP 128 tools per server, names 64 chars         | `constants.ts:4808-4812`                    | xAI's 350 per request                                                                                                                              |
| XD3 | (d)   | Key prefix refusal                               | `presets.ts:366`                            | hint only                                                                                                                                          |

## 7. Not documented / not verified

- Maximum output tokens per model (the snapshot's 500,000 / 30,000 are on no
  xAI page read); rate-limit response headers; the error envelope; PDF input;
  structured outputs and strict tools; prices of server-side tools.
- Whether `reasoning.effort: "none"` is rejected or ignored on grok-4.7/4.6/4.5
  (capture: one request each).
