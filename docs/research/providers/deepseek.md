# DeepSeek API: models, features, limits — research and product comparison

Research date 2026-10-17. Official sources only (§1); every value read on
2026-10-17. Product: `main` at `3d30a73214` (read only). Owner's rule
(2026-10-17, binding): "the limits we set on our agents hardcoded are **ONLY**
the limit set from the providers" and "**ALL** every model available through
every provider all hooks all features all limits etc".

Classes: **(a)** matches DeepSeek; **(b)** differs (both values given); **(c)**
missing from the product; **(d)** hard-coded in the product but not a DeepSeek
limit. "not documented" rows name the capture that would settle them (§6).

How the product reaches DeepSeek: preset `deepseek` (`presets.ts:486-513`:
origin `https://api.deepseek.com`, Bearer, Chat Completions wire, models list
`/models`, `reasoning_content` replay, Thinking off as the documented
`thinking: {type: "disabled"}` switch), codec `codecs/chat.ts`, request-time
record from the snapshot's 4 `deepseek` rows (`configured.ts:436-454`).

## 1. Sources

| Key   | URL                                                  | Read       |
| ----- | ---------------------------------------------------- | ---------- |
| PRICE | https://api-docs.deepseek.com/quick_start/pricing    | 2026-10-17 |
| RL    | https://api-docs.deepseek.com/quick_start/rate_limit | 2026-10-17 |
| THINK | https://api-docs.deepseek.com/guides/thinking_mode   | 2026-10-17 |

## 2. Summary

- **Models.** PRICE lists **2** current models — `deepseek-flash`
  (DeepSeek-V4.1-Flash-1017) and `deepseek-v4-pro` (DeepSeek-V4-Pro-0813) —
  and **2** legacy ids "still accepted but retired" (`deepseek-v4-flash`,
  `deepseek-v4-flash-vision-exp`, served by Flash-1017 at the Flash price).
  All 4 are covered in §5; no `deepseek-chat` / `deepseek-reasoner` aliases
  appear.
- **Counts** (class tags on the 29 classified rows of §3-§5; a row may
  carry two): **(a) 21, (b) 3, (c) 7, (d) 1**. Itemised changes (§6): 3 (b),
  3 (c), 2 (d).
- **Most important mismatches.**
  1. **Concurrency, not RPM**: DeepSeek limits concurrent requests per
     account — `deepseek-flash` 2,500, `deepseek-v4-pro` 500 — and answers 429
     past it (RL). The product paces requests per minute with Meta's reader
     (`pacing.ts:30-44`) and has no concurrency model.
  2. **Peak pricing**: rates double during peak hours (01:00-04:00 and
     06:00-10:00 UTC, Monday-Friday, excluding Chinese public holidays); the
     snapshot carries the off-peak rates only, so cost estimates are half the
     bill at peak (`configured.ts:458-469`).
  3. **Waiting requests**: the server keeps a waiting request alive with empty
     lines or `: keep-alive` SSE comments and closes it if inference has not
     started after 10 minutes (RL); the product's 300 s idle timer counts only
     decoded events (`constants.ts:2326`), so a request queued longer than
     300 s is cut before DeepSeek's own 10-minute limit.

## 3. Model list: provider vs product

| #   | Model                          | DeepSeek                                            | Product today           | Class           |
| --- | ------------------------------ | --------------------------------------------------- | ----------------------- | --------------- |
| 1   | `deepseek-flash`               | current (V4.1-Flash-1017)                           | snapshot row            | (a)             |
| 2   | `deepseek-v4-pro`              | current (V4-Pro-0813)                               | snapshot row            | (a)             |
| 3   | `deepseek-v4-flash`            | legacy, retired but accepted (served by Flash-1017) | snapshot row, no notice | (a); (c) notice |
| 4   | `deepseek-v4-flash-vision-exp` | legacy, retired but accepted                        | snapshot row, no notice | (a); (c) notice |

## 4. Provider-wide features and limits

| Feature / limit            | DeepSeek                                                                                                                    | Source | Product today (file:line)                                                                 | Class                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Endpoint / auth            | `https://api.deepseek.com`; OpenAI-format Chat; also Responses and Anthropic formats                                        | PRICE  | Chat, Bearer (`presets.ts:493-496`)                                                       | (a)                                                    |
| Thinking switch            | `thinking: {type: "enabled"/"disabled"}` (OpenAI format); thinking on by default, default effort `high`                     | THINK  | off = `thinking: {type: "disabled"}` (`presets.ts:507-510`)                               | (a)                                                    |
| Effort                     | `reasoning_effort` `low`/`high`/`max`; mapping minimal→low, low→low, medium→high, high→high, xhigh→high, max→max, ultra→max | THINK  | snapshot `low`, `high`, `max`; unlisted tier → nearest listed (`shared/effort.ts:97-108`) | (a)                                                    |
| `reasoning_content` replay | not needed without tools (ignored); with `tools`, all prior turns' `reasoning_content` must be passed back, else 400        | THINK  | replayed as `reasoning_content` (`presets.ts:505`)                                        | (a)                                                    |
| Sampling in thinking mode  | `temperature`, `presence_penalty`, `frequency_penalty` no effect; `top_p` clamped 0.95-1.0 on flash, ignored on pro         | THINK  | not sent                                                                                  | (a)                                                    |
| Context                    | 1M tokens (both models)                                                                                                     | PRICE  | 1,000,000 (snapshot)                                                                      | (a)                                                    |
| Max output                 | "MAXIMUM: 384K"; default not given                                                                                          | PRICE  | 393,216 (snapshot, = 384 × 1,024)                                                         | (a)                                                    |
| Features                   | JSON output, tool calls, chat prefix completion (Beta), FIM (Beta, non-thinking only); vision on flash only                 | PRICE  | tools (a); JSON output not sent; FIM/prefix not used                                      | (c) JSON output                                        |
| Concurrency                | per account, any key: flash 2,500, pro 500; 429 past it; per-`user_id` limits on expanded accounts                          | RL     | not modelled; pacing per minute (`pacing.ts:30-44`)                                       | (c)                                                    |
| Keep-alive / timeout       | empty lines or `: keep-alive`; closed if inference has not started after 10 minutes                                         | RL     | 300 s idle on decoded events only (`constants.ts:2326`)                                   | (d)                                                    |
| Retry                      | 429 for concurrency; no other status documented on RL                                                                       | RL     | Meta's table (429/5xx) applied (`transport.ts:1087`); chat table unused                   | (a)                                                    |
| Pricing                    | flash off-peak/peak: hit $0.003/$0.006, miss $0.15/$0.3, output $0.6/$1.2; pro: $0.022/$0.044, $0.66/$1.32, $1.98/$3.96     | PRICE  | off-peak only (snapshot)                                                                  | (b) peak                                               |
| Cache usage                | cache-hit tokens priced separately                                                                                          | PRICE  | `prompt_cache_hit_tokens` read (`presets.ts:506`)                                         | (a)                                                    |
| Images                     | vision on flash                                                                                                             | PRICE  | Meta's image rules (types, 10 MiB, 50) applied                                            | not documented (DeepSeek limits not on the pages read) |

## 5. Per-model tables

### 5.1 `deepseek-flash`

| Item                    | DeepSeek                                          | Source | Product today                            | Class    |
| ----------------------- | ------------------------------------------------- | ------ | ---------------------------------------- | -------- |
| Context / max output    | 1M / 384K                                         | PRICE  | 1,000,000 / 393,216                      | (a)      |
| Thinking / effort       | thinking default on; `low`, `high`, `max`         | THINK  | toggle + `low`, `high`, `max`            | (a)      |
| Vision                  | yes                                               | PRICE  | image input per snapshot (`text, image`) | (a)      |
| Price (off-peak / peak) | hit $0.003/$0.006; miss $0.15/$0.3; out $0.6/$1.2 | PRICE  | $0.15 / $0.6 / cache $0.003              | (b) peak |
| Concurrency             | 2,500                                             | RL     | none                                     | (c)      |

### 5.2 `deepseek-v4-pro`

| Item                    | DeepSeek                                             | Source | Product today                | Class    |
| ----------------------- | ---------------------------------------------------- | ------ | ---------------------------- | -------- |
| Context / max output    | 1M / 384K                                            | PRICE  | 1,000,000 / 393,216          | (a)      |
| Thinking / effort       | default on; `low`, `high`, `max`                     | THINK  | toggle + levels              | (a)      |
| Vision                  | not supported                                        | PRICE  | text only (snapshot)         | (a)      |
| Price (off-peak / peak) | hit $0.022/$0.044; miss $0.66/$1.32; out $1.98/$3.96 | PRICE  | $0.66 / $1.98 / cache $0.022 | (b) peak |
| Concurrency             | 500                                                  | RL     | none                         | (c)      |

### 5.3 `deepseek-v4-flash` and 5.4 `deepseek-v4-flash-vision-exp`

| Item   | DeepSeek                                                                      | Source | Product today                                      | Class           |
| ------ | ----------------------------------------------------------------------------- | ------ | -------------------------------------------------- | --------------- |
| Status | "still accepted but retired"; served by Flash-1017, billed at the Flash price | PRICE  | listed as ordinary models                          | (a); (c) notice |
| Limits | as `deepseek-flash`                                                           | PRICE  | 1,000,000 / 393,216; toggle + `low`, `high`, `max` | (a)             |

## 6. Every (b), (c) and (d) item with the exact product change

| #   | Class | Item                                                                   | Product (file:line)     | Exact change                                                          |
| --- | ----- | ---------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------- |
| DB1 | (b)   | Off-peak prices only                                                   | `configured.ts:458-469` | time-of-day price card (peak = 2x), with the holiday rule as a note   |
| DB2 | (b)   | Concurrency handled as RPM                                             | `pacing.ts:30-44`       | a concurrency bucket per account (2,500 / 500 cold start)             |
| DB3 | (b)   | Retired ids shown as current                                           | model list              | show "retired, served by Flash-1017"                                  |
| DC1 | (c)   | JSON output                                                            | `codecs/chat.ts`        | `response_format` per the record                                      |
| DC2 | (c)   | FIM and chat prefix completion                                         | —                       | owner decision                                                        |
| DC3 | (c)   | Per-`user_id` concurrency on expanded accounts                         | —                       | send a stable `user_id` only if the owner wants it                    |
| DD1 | (d)   | 300 s idle while DeepSeek keeps the request alive for up to 10 minutes | `constants.ts:2326`     | count keep-alive comments as liveness, or a user setting ≥ 10 minutes |
| DD2 | (d)   | Key prefix `sk-` refusal                                               | `presets.ts:498`        | hint only                                                             |

Not documented / not verified: DeepSeek's image limits, error envelope,
maximum tool count, whether the Chat codec's `max_completion_tokens`
(`presets.ts:176`) is honoured (capture: one request with a small cap), and
`logprobs` in thinking mode.
