# Groq: models, features, limits — research and product comparison

Research date 2026-10-17. Official sources only (§1). Product: `main` at
`3d30a73214` (read only). Owner's rule (2026-10-17, binding): "the limits we
set on our agents hardcoded are **ONLY** the limit set from the providers" and
"**ALL** every model available through every provider all hooks all features
all limits etc".

Classes: **(a)** matches Groq; **(b)** differs (both values given); **(c)**
missing from the product; **(d)** hard-coded in the product but not a Groq
limit.

How the product reaches Groq: preset `groq` (`presets.ts:461-484`: origin
`https://api.groq.com`, Bearer, Chat Completions, `max_completion_tokens`,
models list `/openai/v1/models` with `context_window` and list prices),
records from the snapshot's 7 `groq` rows (`configured.ts:436-454`).

## 1. Sources

| Key    | URL                                       | Read       |
| ------ | ----------------------------------------- | ---------- |
| MODELS | https://console.groq.com/docs/models      | 2026-10-17 |
| RL     | https://console.groq.com/docs/rate-limits | 2026-10-17 |

## 2. Summary

- **Models.** MODELS lists **14** (6 production, 8 preview); all 14 are in §4.
  The snapshot also carries `qwen/qwen3.6-27b`, which MODELS no longer lists.
- **Counts** (class tags on the 21 classified rows of §3-§4; a row may carry
  two): **(a) 8, (b) 5, (c) 11, (d) 2**. Itemised changes (§5): 3 (b), 2 (c),
  1 (d).
- **Most important mismatches.**
  1. **`x-ratelimit-limit-requests` is requests per day** and
     `x-ratelimit-remaining-requests` "RPD remaining"; the token headers are
     per minute (RL). The product reads every value as per minute with a 60 s
     window (`pacing.ts:30-44`, `constants.ts:2257-2260`).
  2. **Per-model limits are small and per organization**: e.g. gpt-oss-120b
     30 RPM, 1K RPD, 8K TPM, 200K TPD (Developer plan base, RL); also ASH/ASD
     for audio; cached tokens do not count.
  3. **Enterprise-only models priced publicly**: `llama-3.1-8b-instant`,
     `llama-3.3-70b-versatile` are "ContactSales" (Enterprise tier) on
     MODELS; the snapshot prices them at $0.05/$0.08 and $0.59/$0.79.

## 3. Provider-wide features and limits

| Feature / limit       | Groq                                                                                                                                                                                                             | Source | Product today (file:line)                                         | Class             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------- | ----------------- |
| Endpoint / auth       | OpenAI-compatible, Bearer                                                                                                                                                                                        | MODELS | Chat at `/openai/v1/chat/completions` (`configured.ts:654`)       | (a)               |
| Key shape             | not documented                                                                                                                                                                                                   | —      | prefix `gsk_`, min 20 (`presets.ts:473`)                          | (d) hint          |
| Rate-limit dimensions | RPM, RPD, TPM, TPD, ASH, ASD (some accounts ITPM/OTPM); per organization; cached tokens excluded                                                                                                                 | RL     | requests and tokens per minute only                               | (c) RPD/TPD/audio |
| Headers               | `x-ratelimit-limit-requests` = RPD; `x-ratelimit-limit-tokens` = TPM; `-remaining-requests` = RPD remaining; `-remaining-tokens` = TPM remaining; `-reset-requests` / `-reset-tokens`; `retry-after` only on 429 | RL     | all read as per-minute values; resets ignored (`pacing.ts:30-44`) | (b)               |
| 429                   | `retry-after` seconds                                                                                                                                                                                            | RL     | honoured up to 60 s (`constants.ts:2337`)                         | (a); cap (d)      |
| Output cap            | `max_completion_tokens` per model (§4)                                                                                                                                                                           | MODELS | `max_completion_tokens` (`presets.ts:480`)                        | (a)               |

## 4. Every model

| Model                                 | Groq (context / max completion / price / status)                                              | Source     | Product today                                       | Class                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------- | --------------------- |
| `llama-3.1-8b-instant`                | 131,072 / 131,072; ContactSales; Production (Enterprise tier)                                 | MODELS     | snapshot 131,072 / 131,072, priced $0.05 / $0.08    | (a) limits; (b) price |
| `llama-3.3-70b-versatile`             | 131,072 / 32,768; ContactSales; Production (Enterprise tier)                                  | MODELS     | 131,072 / 32,768, priced $0.59 / $0.79              | (a) limits; (b) price |
| `openai/gpt-oss-120b`                 | 131,072 / 65,536; $0.15 / $0.60; Production; 30 RPM, 1K RPD, 8K TPM, 200K TPD                 | MODELS, RL | 131,072 / 65,536; $0.15 / $0.6; no per-model limits | (a); (c) limits       |
| `openai/gpt-oss-20b`                  | 131,072 / 65,536; $0.075 / $0.30; Production; 30 RPM, 1K RPD, 8K TPM, 200K TPD                | MODELS, RL | match; no per-model limits                          | (a); (c) limits       |
| `whisper-large-v3`                    | 100 MB files; $0.111 per hour; Production                                                     | MODELS     | no client                                           | (c)                   |
| `whisper-large-v3-turbo`              | 100 MB; $0.04 per hour; Production                                                            | MODELS     | no client                                           | (c)                   |
| `canopylabs/orpheus-arabic-saudi`     | 4,000 / 50,000; $40.00 per 1M characters; Preview                                             | MODELS     | no client                                           | (c)                   |
| `canopylabs/orpheus-v1-english`       | 4,000 / 50,000; $22.00 per 1M characters; Preview                                             | MODELS     | no client                                           | (c)                   |
| `meta-llama/llama-prompt-guard-2-22m` | 512 / 512; $0.03 / $0.03; Preview                                                             | MODELS     | no snapshot row                                     | (c)                   |
| `meta-llama/llama-prompt-guard-2-86m` | 512 / 512; $0.04 / $0.04; Preview                                                             | MODELS     | no snapshot row                                     | (c)                   |
| `meta-models/muse-spark-open`         | 131,072 / 131,072; ContactSales; Preview (Enterprise tier)                                    | MODELS     | no snapshot row                                     | (c)                   |
| `minimaxai/minimax-m2.7`              | 196,608 / 131,072; ContactSales; Preview (Enterprise tier)                                    | MODELS     | no snapshot row                                     | (c)                   |
| `openai/gpt-oss-safeguard-20b`        | 131,072 / 65,536; $0.075 / $0.30; Preview; 3 RPM, 1K RPD, 2K TPM, 200K TPD                    | MODELS, RL | 131,072 / 65,536; match                             | (a)                   |
| `qwen/qwen3.8-27b`                    | 131,072 / 16,384; $0.80 / $4.00; Preview; "20 MB" file size; 30 RPM, 1K RPD, 8K TPM, 200K TPD | MODELS, RL | 131,042 / 16,384; $0.8 / $4                         | (b) context           |
| `qwen/qwen3.6-27b` (snapshot only)    | not on MODELS                                                                                 | MODELS     | still selectable at 131,072 / 16,384                | (b)                   |

## 5. Itemised (b), (c) and (d)

| #    | Class | Item                                                                | Product (file:line)                         | Exact change                                                               |
| ---- | ----- | ------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| GQB1 | (b)   | Per-day request headers read as per minute                          | `pacing.ts:30-44`; `constants.ts:2257-2260` | a Groq reader: requests per day, tokens per minute, resets from `-reset-*` |
| GQB2 | (b)   | Enterprise-only models priced publicly                              | snapshot                                    | price from MODELS (ContactSales → unpriced)                                |
| GQB3 | (b)   | Stale or removed snapshot ids (`qwen/qwen3.6-27b`, 131,042 context) | `configured.ts:436-454`                     | live list at request time                                                  |
| GQC1 | (c)   | RPD, TPD, ASH, ASD; per-model buckets                               | pacing                                      | per-model buckets from the headers                                         |
| GQC2 | (c)   | Speech, TTS and prompt-guard models                                 | —                                           | owner decision                                                             |
| GQD1 | (d)   | Key prefix refusal                                                  | `presets.ts:473`                            | hint only                                                                  |

Not documented / not verified: Free-plan per-model limits (only the Developer
table was in the extracted part); Groq's error envelope and retry guidance
beyond `retry-after`; whether `max_completion_tokens` above a model's maximum
is clamped or refused (capture: one request).
