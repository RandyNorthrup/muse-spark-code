# Together AI: models, features, limits — research and product comparison

Research date 2026-10-17. Official sources only (§1). Product: `main` at
`3d30a73214` (read only). Owner's rule (2026-10-17, binding): "the limits we
set on our agents hardcoded are **ONLY** the limit set from the providers" and
"**ALL** every model available through every provider all hooks all features
all limits etc".

Classes: **(a)** matches Together; **(b)** differs (both values given);
**(c)** missing from the product; **(d)** hard-coded in the product but not a
Together limit.

How the product reaches Together: preset `together` (`presets.ts:582-606`:
origin `https://api.together.ai`, Bearer, Chat Completions with `max_tokens`,
models list `/v1/models` with `context_length` and list prices, no parallel
tool calls (`presets.ts:601-603`)), records from the snapshot's 27 `together`
rows (`configured.ts:436-454`).

## 1. Sources

| Key        | URL                                             | Read       |
| ---------- | ----------------------------------------------- | ---------- |
| SERVERLESS | https://docs.together.ai/docs/serverless-models | 2026-10-17 |
| RL         | https://docs.together.ai/docs/rate-limits       | 2026-10-17 |

## 2. Summary

- **Models.** SERVERLESS lists **81** serverless models: 21 chat (4 of them
  vision), 26 image, 25 video, 9 audio; no embeddings, rerank or moderation
  models. All 81 are covered (§4: chat one row each with limits; media one
  row each by name).
- **Counts** (class tags on the 30 classified rows of §3-§4; a row may carry
  two): **(a) 13, (b) 4, (c) 12, (d) 1**. Itemised changes (§5): 2 (b), 2 (c),
  1 (d).
- **Most important mismatches.**
  1. **11 of the 21 chat models have no snapshot row** (Muse Glimmer 30B,
     Muse Spark Open 816B, Nemotron 3.5 Super VL, Ternary Bonsai 27B, Qwen3.7
     Plus, Qwen3.8 Flash, Qwen3.8 2.4T, Beam 1.0, Tev1 4B, …): context
     unknown, output 32,768.
  2. **15 snapshot ids are no longer serverless** and stay selectable.
  3. **Rate limits are dynamic**: "Most serverless requests run without rate
     limits", but Together may limit "tokens per second and time to first
     token" under demand and apply custom limits per model; no numbers or
     headers are documented (RL). The product paces with Meta's per-minute
     header reader (`pacing.ts:30-44`).
  4. **Parallel tool calls are never sent** (`presets.ts:601-603`); Together's
     pages read do not say whether they are supported.

## 3. Provider-wide features and limits

| Feature / limit        | Together                                                                                                                                    | Source     | Product today (file:line)                       | Class          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------- | -------------- |
| Endpoint / auth        | OpenAI-compatible, Bearer                                                                                                                   | SERVERLESS | Chat, Bearer (`presets.ts:590-593`)             | (a)            |
| Key shape              | not documented                                                                                                                              | —          | any, min 16 (`presets.ts:594`)                  | (d) hint       |
| Rate limits            | mostly none; dynamic limits (tokens per second, time to first token) under demand; custom per-model limits; contracts keep purchased limits | RL         | Meta's per-minute reader (`pacing.ts:30-44`)    | (b)            |
| 429                    | lower the rate, spread requests, exponential backoff                                                                                        | RL         | retried with backoff (`constants.ts:2316-2318`) | (a)            |
| 503                    | wait briefly and retry with exponential backoff                                                                                             | RL         | retried                                         | (a)            |
| Output cap             | `max_tokens`                                                                                                                                | SERVERLESS | `max_tokens` (`presets.ts:601`)                 | (a)            |
| Parallel tool calls    | not documented on the pages read                                                                                                            | —          | never sent (`presets.ts:601-603`)               | not documented |
| Provisioned throughput | SLA via sales                                                                                                                               | RL         | none                                            | n/a            |

## 4. Every model

### 4.1 Chat and vision models (21)

| Model                                   | Together (context / price per 1M in-out / quantization) | Source     | Product today (snapshot)        | Class       |
| --------------------------------------- | ------------------------------------------------------- | ---------- | ------------------------------- | ----------- |
| `deepseek-ai/DeepSeek-V4-Pro-0813`      | 1048576 / $1.32 / $3.96 / NVFP4                         | SERVERLESS | 1048576 / 384000; $1.32 / $3.96 | (a)         |
| `deepseek-ai/DeepSeek-V4.1-Flash`       | 1000000 / $0.3 / $1.2 / FP8                             | SERVERLESS | 1048576 / 384000; $0.3 / $1.2   | (b) context |
| `meta-models/Muse-Glimmer-30B`          | 131072 / $0.35 / $1.5 / FP8                             | SERVERLESS | no snapshot row                 | (c)         |
| `meta-models/Muse-Spark-Open-816B-A42B` | 1048576 / $1.25 / $4.25 / NVFP4                         | SERVERLESS | no snapshot row                 | (c)         |
| `MiniMaxAI/MiniMax-M3`                  | 524288 / $0.3 / $1.2 / FP4                              | SERVERLESS | 524288 / 250000; $0.3 / $1.2    | (a)         |
| `moonshotai/Kimi-K3`                    | 1048576 / $3 / $15 / -                                  | SERVERLESS | 1048576 / 131072; $3 / $15      | (a)         |
| `nvidia/NVIDIA-Nemotron-3.5-Super-VL`   | 262144 / $0.15 / $0.5 / NVFP4                           | SERVERLESS | no snapshot row                 | (c)         |
| `openai/gpt-oss-120b`                   | 131072 / $0.15 / $0.6 / MXFP4                           | SERVERLESS | 131072 / 131072; $0.15 / $0.6   | (a)         |
| `Prism-ML/Ternary-Bonsai-27B`           | 262144 / $0 / $0 / -                                    | SERVERLESS | no snapshot row                 | (c)         |
| `Qwen/Qwen3.5-9B`                       | 262144 / $0.17 / $0.25 / FP8                            | SERVERLESS | 262144 / 65536; $0.17 / $0.25   | (a)         |
| `Qwen/Qwen3.6-Plus`                     | 1000000 / $0.5 / $3 / -                                 | SERVERLESS | 1000000 / 500000; $0.5 / $3     | (a)         |
| `Qwen/Qwen3.7-Max`                      | not stated / $2.5 / $7.5 / -                            | SERVERLESS | 1000000 / 500000; $1.25 / $3.75 | (b) price   |
| `Qwen/Qwen3.7-Plus`                     | 1000000 / $0.32 / $1.28 / -                             | SERVERLESS | no snapshot row                 | (c)         |
| `Qwen/Qwen3.8-Flash`                    | 1000000 / $0.15 / $0.47 / -                             | SERVERLESS | no snapshot row                 | (c)         |
| `Qwen/Qwen3.8-2.4T-A95B`                | not stated / $2 / $6 / FP4                              | SERVERLESS | no snapshot row                 | (c)         |
| `reflection/Beam-1.0-501B-A23B`         | 1048576 / $0.4 / $1.2 / NVFP4                           | SERVERLESS | no snapshot row                 | (c)         |
| `thinkingmachines/Inkling`              | 524288 / $1 / $4.05 / NVFP4                             | SERVERLESS | 524288 / 131072; $1 / $4.05     | (a)         |
| `together/Tev1-4B-experimental`         | 32768 / $0.042 / $0 / -                                 | SERVERLESS | no snapshot row                 | (c)         |
| `zai-org/GLM-5.2`                       | 1048575 / $1.4 / $4.4 / FP4                             | SERVERLESS | 1048575 / 164000; $1.4 / $4.4   | (a)         |
| `zai-org/GLM-5.3`                       | 1048575 / $1.4 / $4.4 / FP4                             | SERVERLESS | 1048576 / 262144; $1.4 / $4.4   | (b) context |
| `zai-org/GLM-5.3-Flash`                 | 1048575 / $0.15 / $0.5 / FP4                            | SERVERLESS | 1048575 / 400000; $0.15 / $0.5  | (a)         |

Snapshot ids not on the serverless page (still selectable with 2026-10-05 values): `MiniMaxAI/MiniMax-M2.5`, `MiniMaxAI/MiniMax-M2.7`, `Qwen/Qwen2.5-7B-Instruct-Turbo`, `Qwen/Qwen3-235B-A22B-Instruct-2507-tput`, `Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8`, `Qwen/Qwen3-Coder-Next-FP8`, `Qwen/Qwen3.5-397B-A17B`, `deepseek-ai/DeepSeek-V3`, `deepseek-ai/DeepSeek-V3-1`, `deepseek-ai/DeepSeek-V4-Flash-0731`, `essentialai/Rnj-1-Instruct`, `meta-llama/Llama-3.3-70B-Instruct-Turbo`, `nvidia/nemotron-3-ultra-550b-a55b`, `zai-org/GLM-5`, `zai-org/GLM-5.1`.

### 4.2 Image (26), video (25) and audio (9) models

Product today for every row: no client (the product's image, video and voice
features call Meta). Class (c) each.

| Category   | Models                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Class |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Image (26) | black-forest-labs/FLUX.1-kontext-max, FLUX.1-kontext-pro, FLUX.1.1-pro, FLUX.2-dev, FLUX.2-flex, FLUX.2-max, FLUX.2-pro; ByteDance-Seed/Seedream-3.0, Seedream-4.0; ByteDance/Seedream-5.0-lite; google/flash-image-2.5, google/gemini-3-pro-image, google/flash-image-3.1, google/flash-image-3.1-lite; ideogram/ideogram-3.0, ideogram-4.0; openai/gpt-image-1.5, openai/gpt-image-2; prunaai/p-image-ideogram; Qwen/Qwen-Image, Qwen-Image-2.0, Qwen-Image-2.0-Pro; Rundiffusion/Juggernaut-Lightning-Flux, RunDiffusion/Juggernaut-pro-flux; stabilityai/stable-diffusion-xl-base-1.0; Wan-AI/Wan2.6-image | (c)   |
| Video (25) | alibaba/happyhorse-1.0-i2v, -r2v, -t2v; happyhorse-1.1-i2v, -r2v, -t2v; black-forest-labs/FLUX-3; ByteDance/Seedance-1.0-lite, -1.0-pro, -2.0, -2.5; google/veo-3.1, veo-3.1-lite; minimax/video-01-director, MiniMaxAI/MiniMax-H3, minimax/hailuo-02; pixverse/pixverse-v5, -v5.6, -v6; vidu/vidu-q1, vidu-q3, vidu-q3-turbo; Wan-AI/wan2.7-i2v, -r2v, -t2v                                                                                                                                                                                                                                                   | (c)   |
| Audio (9)  | canopylabs/orpheus-3b-0.1-ft; cartesia/sonic, sonic-2, sonic-3; hexgrad/Kokoro-82M; nvidia/nemotron-3-asr-streaming-0.6b, nemotron-3.5-asr-streaming-0.6b, parakeet-tdt-0.6b-v3; openai/whisper-large-v3                                                                                                                                                                                                                                                                                                                                                                                                       | (c)   |

## 5. Itemised (b), (c) and (d)

| #    | Class | Item                                                                        | Product (file:line)     | Exact change                                                        |
| ---- | ----- | --------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------- |
| TGB1 | (b)   | Stale snapshot rows (contexts, Qwen3.7 Max price) and 15 non-serverless ids | `configured.ts:436-454` | live list (`context_length`, prices) at request time                |
| TGB2 | (b)   | Per-minute header pacing                                                    | `pacing.ts:30-44`       | no pacing until a 429; then backoff (Together documents no headers) |
| TGC1 | (c)   | Records for 11 chat models                                                  | `configured.ts:436-454` | live list evidence                                                  |
| TGC2 | (c)   | Image, video, audio models                                                  | —                       | owner decision                                                      |
| TGD1 | (d)   | Key length refusal                                                          | `presets.ts:594`        | hint only                                                           |

Not documented / not verified: max output per model (not on SERVERLESS; the
snapshot's values are unverified), context for Qwen3.7 Max and Qwen3.8 2.4T,
tool and parallel-call support per model, image limits, error envelope.
