# Z.ai (GLM models, API and GLM Coding Plan): models, features, limits — research and product comparison

Research date 2026-10-17. Official sources only (§1); every value read on
2026-10-17. Product: `main` at `3d30a73214` (read only). Owner's rule
(2026-10-17, binding): "the limits we set on our agents hardcoded are **ONLY**
the limit set from the providers" and "**ALL** every model available through
every provider all hooks all features all limits etc".

Classes: **(a)** matches Z.ai; **(b)** differs (both values given); **(c)**
missing from the product; **(d)** hard-coded in the product but not a Z.ai
limit. "not documented" rows name the capture that would settle them (§6).

How the product reaches Z.ai: preset `zai` (`presets.ts:663-686`: origin
`https://api.z.ai`, Bearer, Chat Completions wire, models list
`/api/paas/v4/models`, `reasoning_content` replay, key shape
`<32 hex>.<secret>`), `tool_stream: true` (`configured.ts:542`), terminal
error codes 1113 and 1308 (`providerClient.ts:146`); records from the
snapshot's 18 `zai` rows (`configured.ts:436-454`). The GLM Coding Plan is
not modelled.

## 1. Sources

| Key      | URL                                                                         | Read       |
| -------- | --------------------------------------------------------------------------- | ---------- |
| PRICE    | https://docs.z.ai/guides/overview/pricing                                   | 2026-10-17 |
| OVERVIEW | https://docs.z.ai/guides/overview/overview                                  | 2026-10-17 |
| M        | https://docs.z.ai/guides/llm/&lt;model&gt; (glm-5.3, glm-5.1, glm-4.7 read) | 2026-10-17 |
| ERR      | https://docs.z.ai/api-reference/api-code                                    | 2026-10-17 |
| PLAN     | https://docs.z.ai/devpack/overview                                          | 2026-10-17 |

## 2. Summary

- **Models.** PRICE lists **25** models (16 text GLM, 5 vision GLM-V, 2 image,
  1 video, 1 audio) plus 3 priced agents; OVERVIEW details 9 of them. All 25
  models and the 3 agents are covered in §5.
- **Counts** (class tags on the 61 classified rows of §3-§5; a row may
  carry two): **(a) 34, (b) 6, (c) 23, (d) 1**. Itemised changes (§6):
  3 (b), 4 (c), 1 (d).
- **Most important mismatches.**
  1. **GLM-5.3 thinking cannot be turned off**: "`thinking.type` accepts only
     `enabled`"; `reasoning_effort` `low`, `high`, `max`, default `max` (M).
     The product sends `reasoning_effort: "none"` for Thinking off (no
     Thinking-off switch on the Z.ai preset; `modelPolicy.ts:157-172`).
  2. **Toggle models never turn thinking off**: GLM-5.1, 5, 4.7, 4.6, 4.5 take
     `thinking: {type: "enabled"/"disabled"}`, default enabled (M); the
     snapshot gives them only a toggle (no effort list), so the Chat codec
     sends no reasoning field (`configured.ts:516-518`) and Thinking off does
     nothing. DeepSeek's switch (`presets.ts:507-510`) is the same wire shape
     but is declared only for DeepSeek.
  3. **Usage-limit errors are retried**: 1310 (weekly/monthly), 1316-1321
     (5-hour / 7-day Coding Plan limits), 1309 (plan expired), 1311 (model not
     in plan), 1313 (fair use) are all HTTP 429 with a `next_flush_time` where
     a reset exists (ERR); only 1113 and 1308 are terminal in the product
     (`providerClient.ts:146`), so the rest are retried four times as rate
     limits, and `next_flush_time` is never read.
  4. **GLM Coding Plan** (Lite 2,000 credits per 5 hours / 10,000 per week;
     Pro 12,000 / 60,000; Max 28,000 / 140,000; GLM-5.3 and GLM-5.3-Flash;
     older ids routed to them) is not modelled (PLAN).
  5. **Records**: `glm-5.3-flash`, `-flashx`, `glm-5.3`, `glm-5.2` snapshot
     rows match the 1M context; GLM-4.5-X, GLM-4.5-AirX, GLM-4-32B-0414-128K,
     GLM-4.6V-FlashX, GLM-OCR have no snapshot row.

## 3. Model list: provider vs product

| #     | Model (PRICE)                                                                               | Kind                                  | Product today       | Class          |
| ----- | ------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------- | -------------- |
| 1     | GLM-5.3-Flash (`glm-5.3-flash`)                                                             | text (native multimodal per OVERVIEW) | snapshot row        | (a)            |
| 2     | GLM-5.3-FlashX (`glm-5.3-flashx`)                                                           | text                                  | snapshot row        | (a)            |
| 3     | GLM-5.3 (`glm-5.3`)                                                                         | text                                  | snapshot row        | (a)            |
| 4     | GLM-5.2 (`glm-5.2`)                                                                         | text                                  | snapshot row        | (a)            |
| 5     | GLM-5.1 (`glm-5.1`)                                                                         | text                                  | snapshot row        | (a)            |
| 6     | GLM-5 (`glm-5`)                                                                             | text                                  | snapshot row        | (a)            |
| 7     | GLM-4.7 (`glm-4.7`)                                                                         | text                                  | snapshot row        | (a)            |
| 8     | GLM-4.6 (`glm-4.6`)                                                                         | text                                  | snapshot row        | (a)            |
| 9     | GLM-4.7-FlashX (`glm-4.7-flashx`)                                                           | text                                  | snapshot row        | (a)            |
| 10    | GLM-4.5 (`glm-4.5`)                                                                         | text                                  | snapshot row        | (a)            |
| 11    | GLM-4.5-X                                                                                   | text                                  | **no snapshot row** | (c)            |
| 12    | GLM-4.5-Air (`glm-4.5-air`)                                                                 | text                                  | snapshot row        | (a)            |
| 13    | GLM-4.5-AirX                                                                                | text                                  | **no snapshot row** | (c)            |
| 14    | GLM-4-32B-0414-128K                                                                         | text                                  | **no snapshot row** | (c)            |
| 15    | GLM-4.7-Flash (`glm-4.7-flash`)                                                             | text, free                            | snapshot row        | (a)            |
| 16    | GLM-4.5-Flash (`glm-4.5-flash`)                                                             | text, free                            | snapshot row        | (a)            |
| 17    | GLM-4.6V (`glm-4.6v`)                                                                       | vision                                | snapshot row        | (a)            |
| 18    | GLM-OCR                                                                                     | vision/OCR                            | no client           | (c)            |
| 19    | GLM-4.6V-FlashX                                                                             | vision                                | **no snapshot row** | (c)            |
| 20    | GLM-4.5V (`glm-4.5v`)                                                                       | vision                                | snapshot row        | (a)            |
| 21    | GLM-4.6V-Flash (`glm-4.6v-flash`)                                                           | vision, free                          | snapshot row        | (a)            |
| 22-23 | GLM-Image, CogView-4                                                                        | image generation                      | no client           | (c)            |
| 24    | CogVideoX-3                                                                                 | video generation                      | no client           | (c)            |
| 25    | GLM-ASR-2512                                                                                | audio                                 | no client           | (c)            |
| —     | GLM Slide/Poster Agent (beta), General-Purpose Translation, Special Effects Video Templates | agents                                | no client           | (c)            |
| —     | snapshot-only ids `glm-5v-turbo`, `glm-5-turbo`                                             | not on PRICE                          | listed              | not documented |

## 4. Provider-wide features and limits

| Feature / limit  | Z.ai                                                                                                                                                                                                                                                                                                                                                                     | Source | Product today (file:line)                                                                    | Class              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------- | ------------------ |
| Endpoint / auth  | `https://api.z.ai`, Chat Completions, Bearer                                                                                                                                                                                                                                                                                                                             | M      | `presets.ts:671-679`                                                                         | (a)                |
| Key shape        | not documented                                                                                                                                                                                                                                                                                                                                                           | —      | `<32 hex>.<16>` refused otherwise (`presets.ts:674-675`; `constants.ts:7141`)                | (d) hint           |
| Thinking         | `thinking.type` `enabled`/`disabled` (default enabled) on 5.1, 5, 4.7, 4.6, 4.5; GLM-5.3 `enabled` only with `reasoning_effort` `low`/`high`/`max` (default `max`); interleaved and preserved reasoning on 4.7                                                                                                                                                           | M      | effort from the record or `none`; no Thinking-off switch for Z.ai                            | (b)                |
| Reasoning replay | reasoning kept across turns (preserved)                                                                                                                                                                                                                                                                                                                                  | M      | `reasoning_content` replay (`presets.ts:683`)                                                | (a)                |
| Capabilities     | streaming, function calling, structured output, context caching, MCP (5.1)                                                                                                                                                                                                                                                                                               | M      | functions, `tool_stream: true` (`configured.ts:542`); structured output and caching not sent | (c)                |
| Cache            | cached input priced; cached storage "Limited-time Free"                                                                                                                                                                                                                                                                                                                  | PRICE  | `prompt_tokens_details.cached_tokens` read (`presets.ts:684`); no cache key                  | (a) usage; (c) key |
| Errors           | 1113 balance, 1302 rate limit, 1305 overload, 1308 usage limit (`next_flush_time`), 1309 plan expired, 1310 weekly/monthly limit (`next_flush_time`), 1311 model not in plan, 1313 fair-use limit, 1314/1315 enterprise package, 1316-1321 Coding Plan 5-hour / 7-day limits (`next_flush_time`) — all HTTP 429; 1261 "Prompt too long" (400); 1301 unsafe content (400) | ERR    | terminal: 1113, 1308 (`providerClient.ts:146`); others retried; `next_flush_time` not read   | (b)                |
| Rate limits      | not documented on the pages read (the rate-limits page returns 404)                                                                                                                                                                                                                                                                                                      | —      | Meta's reader                                                                                | not documented     |
| Web search tool  | $0.01 per use                                                                                                                                                                                                                                                                                                                                                            | PRICE  | not sent                                                                                     | (c)                |
| Coding Plan      | Lite / Pro / Max; credits per 5 hours and per week (2,000 / 10,000; 12,000 / 60,000; 28,000 / 140,000); 5-hour credits refresh 5 hours after use; weekly every 7 days; GLM-5.3 and GLM-5.3-Flash (5.2/5.1 → 5.3, 4.7 → 5.3-Flash); off-peak 50% credit rate; supported tools include Claude Code, Codex, OpenCode, Cline                                                 | PLAN   | not modelled                                                                                 | (c)                |

## 5. Per-model tables

### `glm-5.3`

| Item                 | Z.ai                                                               | Source | Product today                                 | Class               |
| -------------------- | ------------------------------------------------------------------ | ------ | --------------------------------------------- | ------------------- |
| Context / max output | 1M / 128K                                                          | M      | 1,000,000 / 131,072                           | (a)                 |
| Thinking             | always on; `reasoning_effort` `low`, `high`, `max` (default `max`) | M      | levels `low`, `high`, `max`; off sends `none` | (a) levels; (b) off |
| Modalities           | text input                                                         | M      | text                                          | (a)                 |
| Price per 1M         | $1.4 / cached $0.26 / $4.4                                         | PRICE  | $1.4 / $4.4 / cache $0.26                     | (a)                 |

### `glm-5.3-flash` and `glm-5.3-flashx`

| Item                 | Z.ai                                                       | Source   | Product today                                             | Class          |
| -------------------- | ---------------------------------------------------------- | -------- | --------------------------------------------------------- | -------------- |
| Context              | 1M                                                         | OVERVIEW | 1,000,000 / 131,072                                       | (a)            |
| Max output, thinking | not on the pages read                                      | —        | levels `low`, `high`, `max`                               | not documented |
| Price per 1M         | Flash $0.15 / $0.03 / $0.50; FlashX $0.37 / $0.075 / $1.25 | PRICE    | Flash $0.15 / $0.5 / $0.03; FlashX $0.37 / $1.25 / $0.075 | (a)            |

### `glm-5.2`

| Item         | Z.ai                  | Source   | Product today        | Class          |
| ------------ | --------------------- | -------- | -------------------- | -------------- |
| Context      | 1M                    | OVERVIEW | 1,000,000 / 131,072  | (a)            |
| Thinking     | not on the pages read | —        | levels `high`, `max` | not documented |
| Price per 1M | $1.4 / $0.26 / $4.4   | PRICE    | match                | (a)            |

### `glm-5.1`

| Item                 | Z.ai                                                                        | Source | Product today                                | Class |
| -------------------- | --------------------------------------------------------------------------- | ------ | -------------------------------------------- | ----- |
| Context / max output | 200K / 128K                                                                 | M      | 200,000 / 131,072                            | (a)   |
| Thinking             | `enabled` / `disabled`, default enabled                                     | M      | toggle only → nothing sent; off does nothing | (b)   |
| Capabilities         | thinking, streaming, function call, context caching, structured output, MCP | M      | functions only                               | (c)   |
| Price per 1M         | $1.4 / $0.26 / $4.4                                                         | PRICE  | match                                        | (a)   |

### `glm-5`, `glm-4.7`, `glm-4.6`, `glm-4.5`

| Item         | Z.ai                                                                   | Source      | Product today                        | Class               |
| ------------ | ---------------------------------------------------------------------- | ----------- | ------------------------------------ | ------------------- |
| Context      | 200K (5, 4.7, 4.6); GLM-4.5 not stated                                 | OVERVIEW, M | 204,800 (5, 4.7, 4.6); 131,072 (4.5) | (b) 204,800 vs 200K |
| Max output   | 128K (4.7 family)                                                      | M           | 131,072                              | (a)                 |
| Thinking     | `enabled` / `disabled`, default enabled; interleaved + preserved (4.7) | M           | toggle → nothing sent                | (b)                 |
| Price per 1M | GLM-5 $1 / $0.2 / $3.2; 4.7, 4.6, 4.5 $0.6 / $0.11 / $2.2              | PRICE       | match                                | (a)                 |

### `glm-4.7-flashx`, `glm-4.7-flash`, `glm-4.5-air`, `glm-4.5-flash`

| Item             | Z.ai                                                                                       | Source | Product today                       | Class               |
| ---------------- | ------------------------------------------------------------------------------------------ | ------ | ----------------------------------- | ------------------- |
| Context / output | 200K / 128K (4.7 Flash, FlashX); 4.5 Air/Flash not stated                                  | M      | 200,000 / 131,072; 131,072 / 98,304 | (a); not documented |
| Price per 1M     | 4.7-FlashX $0.07 / $0.01 / $0.4; 4.5-Air $0.2 / $0.03 / $1.1; 4.7-Flash and 4.5-Flash free | PRICE  | match                               | (a)                 |

### GLM-4.5-X, GLM-4.5-AirX, GLM-4-32B-0414-128K

| Item         | Z.ai                                                                           | Source | Product today                  | Class |
| ------------ | ------------------------------------------------------------------------------ | ------ | ------------------------------ | ----- |
| Price per 1M | 4.5-X $2.2 / $0.45 / $8.9; 4.5-AirX $1.1 / $0.22 / $4.5; 4-32B $0.1 / — / $0.1 | PRICE  | no snapshot rows               | (c)   |
| Limits       | not on the pages read                                                          | —      | context unknown, output 32,768 | (c)   |

### Vision: `glm-4.6v`, `glm-4.6v-flash`, GLM-4.6V-FlashX, `glm-4.5v`, GLM-OCR

| Item                 | Z.ai                                                                                                                          | Source | Product today                                          | Class                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------ | ------------------------- |
| Price per 1M         | 4.6V $0.3 / $0.05 / $0.9; 4.6V-FlashX $0.04 / $0.004 / $0.4; 4.5V $0.6 / $0.11 / $1.8; 4.6V-Flash free; GLM-OCR $0.03 / $0.03 | PRICE  | 4.6V, 4.6V-Flash, 4.5V rows match; FlashX and OCR none | (a); (c)                  |
| Limits / video input | not on the pages read                                                                                                         | —      | snapshot says image + video input; video unwired       | not documented; (c) video |

### Media and agents

| Model                                                                                            | Z.ai                                      | Source | Product today | Class |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------- | ------ | ------------- | ----- |
| GLM-Image                                                                                        | $0.015 per image                          | PRICE  | none          | (c)   |
| CogView-4                                                                                        | $0.01 per image                           | PRICE  | none          | (c)   |
| CogVideoX-3                                                                                      | $0.2 per video                            | PRICE  | none          | (c)   |
| GLM-ASR-2512                                                                                     | $0.03 per MTok (about $0.0024 per minute) | PRICE  | none          | (c)   |
| Slide/Poster Agent (beta) $0.7 per MTok; Translation $3 per MTok; video templates $0.2 per video |                                           | PRICE  | none          | (c)   |

## 6. Every (b), (c) and (d) item with the exact product change

| #   | Class | Item                                                                | Product (file:line)                                                     | Exact change                                                                                                                                            |
| --- | ----- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ZB1 | (b)   | Thinking off on Z.ai                                                | `presets.ts:681-685`; `configured.ts:516-518`; `modelPolicy.ts:157-172` | declare `thinkingOff: 'thinking-switch'` for Z.ai toggle models (as DeepSeek); for GLM-5.3 explain that thinking is always on and send the lowest level |
| ZB2 | (b)   | Usage-limit codes retried                                           | `providerClient.ts:146`                                                 | terminal for 1309, 1310, 1311, 1313-1321; wait until `next_flush_time` where given                                                                      |
| ZB3 | (b)   | 204,800 vs 200K context                                             | snapshot                                                                | documented value (or the live list)                                                                                                                     |
| ZC1 | (c)   | Records for GLM-4.5-X, 4.5-AirX, 4-32B, 4.6V-FlashX                 | `configured.ts:436-454`                                                 | documented limits and prices                                                                                                                            |
| ZC2 | (c)   | Structured output, context caching key, MCP, web search tool        | `codecs/chat.ts`                                                        | per-model settings                                                                                                                                      |
| ZC3 | (c)   | GLM Coding Plan (credits, 5-hour and weekly windows, routed models) | presets                                                                 | a plan-key preset with the documented windows and the 1316-1321 resets                                                                                  |
| ZC4 | (c)   | Image, video, audio, agents                                         | —                                                                       | owner decision                                                                                                                                          |
| ZD1 | (d)   | Key shape refusal                                                   | `presets.ts:674-675`                                                    | hint only                                                                                                                                               |

## 7. Not documented / not verified

- Rate limits / concurrency (the rate-limits page returned 404), max output
  for GLM-5.3-Flash/-FlashX/5.2/4.5 family, thinking parameters for 5.2 and
  the 5.3 Flash models, the Coding Plan's API endpoint and prices of Pro/Max.
- Whether `reasoning_effort: "none"` is rejected on GLM-5.3 (capture: one
  request).
- Snapshot-only ids `glm-5v-turbo` and `glm-5-turbo` are on no page read.
