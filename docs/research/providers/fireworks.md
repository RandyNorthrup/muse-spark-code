# Fireworks AI: models, features, limits — research and product comparison

Research date 2026-10-17. Official sources only (§1). Product: `main` at
`3d30a73214` (read only). Owner's rule (2026-10-17, binding): "the limits we
set on our agents hardcoded are **ONLY** the limit set from the providers" and
"**ALL** every model available through every provider all hooks all features
all limits etc".

Classes: **(a)** matches Fireworks; **(b)** differs (both values given);
**(c)** missing from the product; **(d)** hard-coded in the product but not a
Fireworks limit.

How the product reaches Fireworks: preset `fireworks` (`presets.ts:608-635`:
origin `https://api.fireworks.ai`, Bearer, Chat Completions with `max_tokens`,
models list `/inference/v1/models`, cached-token usage), records from the
snapshot's 22 `fireworks` rows (`configured.ts:436-454`).

## 1. Sources

| Key     | URL                                                       | Read       |
| ------- | --------------------------------------------------------- | ---------- |
| LIBRARY | https://fireworks.ai/models (Serverless filter)           | 2026-10-17 |
| RL      | https://docs.fireworks.ai/guides/quotas_usage/rate-limits | 2026-10-17 |

The documented serverless list page (`docs.fireworks.ai/getting-started/serverless-models`)
returned 404 on 2026-10-17; the id-bearing models API (`/inference/v1/models`)
needs an API key, which this research does not use. The model library page
was read instead; its HTML was cut off after **251** entries and it shows
display names, not ids.

## 2. Summary

- **Models.** 251 entries were visible in the library under the Serverless
  filter (the page was truncated; the full count is higher and not
  documented). §4.1 compares the 22 snapshot rows with the library entries
  that carry the same model by name; §4.2 lists every visible entry.
- **Counts** (class tags on the classified rows of §3-§4.1; a row may carry
  two): **(a) 12, (b) 3, (c) 4, (d) 2**. Itemised changes (§5): 2 (b), 2 (c),
  2 (d).
- **Most important mismatches.**
  1. **Account-wide RPM**: 10 RPM with no payment method or credits, up to
     6,000 RPM with one (a fixed ceiling); serverless TPM bounded by spend tier
     (legacy self-serve Tier 1 $50, Tier 2 $500, Tier 3 $5,000, Tier 4
     $50,000 maximum monthly spend) (RL). The product paces with Meta's
     per-minute reader (`pacing.ts:30-44`); a 429 on an on-demand or dedicated
     deployment "usually means deployment saturation (GPUs busy)" (RL).
  2. **Only 22 records**: every other serverless model lacks a request-time
     record (context unknown, output 32,768).

## 3. Provider-wide features and limits

| Feature / limit         | Fireworks                                                                                                                        | Source  | Product today (file:line)                                                                                                                               | Class          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Endpoint / auth         | OpenAI-compatible inference, Bearer                                                                                              | LIBRARY | Chat, Bearer (`presets.ts:616-619`)                                                                                                                     | (a)            |
| Key shape               | not documented                                                                                                                   | —       | prefix `fw_`, min 20 (`presets.ts:619`)                                                                                                                 | (d) hint       |
| Account RPM             | 10 RPM without payment method or credits; up to 6,000 RPM with them; fixed ceiling; above → 429                                  | RL      | not modelled; Meta's reader (`pacing.ts:30-44`)                                                                                                         | (c)            |
| Spend tiers             | legacy self-serve postpaid maximum monthly spend: $50 / $500 / $5,000 / $50,000; unlimited via sales; tiers bound serverless TPM | RL      | none                                                                                                                                                    | n/a            |
| Serverless TPM, headers | on a separate "Serverless rate limits" page (not read); no header names on RL                                                    | RL      | Meta's reader                                                                                                                                           | not documented |
| 429 on deployments      | "deployment saturation (GPUs busy)", still counts toward account limits                                                          | RL      | retried as a rate limit                                                                                                                                 | (a)            |
| Output cap              | `max_tokens`                                                                                                                     | LIBRARY | `max_tokens` (`presets.ts:630`)                                                                                                                         | (a)            |
| Cache                   | cached tokens reported                                                                                                           | —       | `prompt_tokens_details.cached_tokens` (`presets.ts:632`); cache key never sent although captured as accepted (`codecs/chat.ts:92`; `configured.ts:540`) | (c) key        |
| Stream bounds           | none documented                                                                                                                  | —       | Chat streams 16 MiB (`configured.ts:571-576`)                                                                                                           | (d)            |

## 4. Models

### 4.1 Snapshot rows against the library

| Snapshot id                                                                                                                                                                                                               | Library entry (context / price per 1M in-out)                                                   | Source  | Product today (snapshot context / output; price) | Class                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------ | --------------------------------- |
| `accounts/fireworks/models/ember-1`                                                                                                                                                                                       | Ember-1: 1,048,576 / $3 / $15                                                                   | LIBRARY | 1,048,576 / 131,072; $3 / $15                    | (a)                               |
| `accounts/fireworks/models/deepseek-v4p1-flash`                                                                                                                                                                           | DeepSeek V4.1 Flash: 1,048,576 / $0.3 / $1.2                                                    | LIBRARY | 1,000,000 / 384,000; $0.3 / $1.2                 | (b) context                       |
| `accounts/fireworks/models/glm-5p3-flash`                                                                                                                                                                                 | GLM 5.3 Flash: 1,048,576 / $0.15 / $0.5                                                         | LIBRARY | 1,048,573 / 131,072; $0.15 / $0.5                | (b) context                       |
| `accounts/fireworks/models/glm-5p3`                                                                                                                                                                                       | GLM-5.3: 1,048,576 / $1.4 / $4.4                                                                | LIBRARY | 1,048,573 / 262,144; $1.4 / $4.4                 | (b) context                       |
| `accounts/fireworks/models/kimi-k3`                                                                                                                                                                                       | Kimi K3: 1,048,576 / $3 / $15                                                                   | LIBRARY | 1,048,576 / 131,072; $3 / $15                    | (a)                               |
| `accounts/fireworks/models/qwen3p8-max`                                                                                                                                                                                   | Qwen 3.8 Max: context not shown / $2 / $6                                                       | LIBRARY | 262,144 / 131,072; $2 / $6                       | (a) price; context not documented |
| `accounts/fireworks/models/minimax-m3`                                                                                                                                                                                    | Minimax M3: 512,000 / $0.3 / $1.2                                                               | LIBRARY | 512,000 / 512,000; $0.3 / $1.2                   | (a)                               |
| `accounts/fireworks/models/gpt-oss-120b`                                                                                                                                                                                  | OpenAI gpt-oss-120b: 131,072 / $0.15 / $0.6                                                     | LIBRARY | 131,072 / 32,768; $0.15 / $0.6                   | (a)                               |
| `accounts/fireworks/models/nemotron-3-ultra-nvfp4`                                                                                                                                                                        | NVIDIA Nemotron 3 Ultra NVFP4: 262,144 / $0.6 / $2.4                                            | LIBRARY | 262,144 / 128,000; $0.6 / $2.4                   | (a)                               |
| `accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b`                                                                                                                                                                | Nemotron Lightning 3.5 30B A3B: 262,144 / $0.05 / $0.2                                          | LIBRARY | 262,144 / 262,144; $0.05 / $0.2                  | (a)                               |
| `accounts/fireworks/models/inkling`                                                                                                                                                                                       | Inkling: 1,048,576 / $1 / $4.05                                                                 | LIBRARY | 1,048,576 / 1,048,576; $1 / $4.05                | (a)                               |
| `accounts/fireworks/models/qwen3p8-2p4t-a95b`                                                                                                                                                                             | Qwen3.8-2.4T-A95B: 262,144 / price not shown                                                    | LIBRARY | 262,144 / 131,072; $2 / $6                       | (a) context                       |
| `accounts/fireworks/routers/*` (10: `minimax-latest`, `glm-flash-latest`, `glm-fast-latest`, `kimi-k3-fast`, `glm-5p3-fast`, `kimi-fast-latest`, `qwen-max-latest`, `kimi-latest`, `deepseek-flash-latest`, `glm-latest`) | routers are not shown in the library part read (one "FireRouter with Opus", 1,000,000, appears) | LIBRARY | snapshot rows                                    | not documented                    |
| library entries without a snapshot row (Muse Spark Open, Muse Glimmer 30B, Qwen3.8 Flash Next, MiMo-V2.6-Pro-RL, …; §4.2)                                                                                                 | —                                                                                               | LIBRARY | no record                                        | (c)                               |
| Qwen3 Embedding / Reranker, Voyage models, BGE-M3, OCR models, FLUX image models                                                                                                                                          | embeddings, rerank, OCR, image                                                                  | LIBRARY | no client                                        | (c)                               |

### 4.2 Every entry visible in the library (251, truncated)

Display names with context and price as shown (n/s = not shown). Ember-1
(1,048,576; $3/$15); DeepSeek V4.1 Flash (1,048,576; $0.3/$1.2); FireRouter
with Opus (1,000,000); GLM 5.3 Flash (1,048,576; $0.15/$0.5); GLM-5.3
(1,048,576; $1.4/$4.4); MiMo-V2.6-Pro-RL (1,048,576); Qwen3.8 Flash Next FP8
(262,144); Qwen3.8 Flash Next FP4 (262,144); Muse Spark Open (1,048,576;
$1.25/$4.25); Kimi K3 (1,048,576; $3/$15); Qwen 3.8 Max (n/s; $2/$6); Minimax
M3 (512,000; $0.3/$1.2); DeepSeek-V4-Pro-0813 (1,048,576); Muse Glimmer 30B
(131,072); DeepSeek-V4-Flash-0731 (1,048,576); Qwen3.7 Max; GLM 5.2
(1,048,576); Kimi K2.7 Code (262,144); DeepSeek-V4-Pro (1,048,576); Qwen3.6
Plus; OpenAI gpt-oss-120b (131,072; $0.15/$0.6); Gemma 4 31B IT NVFP4
(262,144); GLM-5 (202,752); Qwen3 VL 235B A22B Thinking (262,144); Qwen3 VL
235B A22B Instruct (262,144); Kimi K2 Instruct 0905 (262,144); DeepSeek V3.1
(163,840); OpenAI gpt-oss-20b (131,072); Qwen3 235B A22B (131,072); NVIDIA
Nemotron 3 Ultra NVFP4 (262,144; $0.6/$2.4); NVIDIA Nemotron 3 Ultra BF16
(262,144); NVIDIA Nemotron 3 Super 120B A12B NVFP4 (262,144); NVIDIA Nemotron
3 Super 120B A12B FP8 (262,144); Kimi K2 Thinking (262,144); GLM-4.6
(202,752); Qwen3 235B A22B Instruct 2507 (262,144); Qwen3 Coder 480B A35B
Instruct (262,144); Llama 3.3 70B Instruct (131,072); MiniMax-M2.5 (196,608);
MiniMax-M2.1 (196,608); Deepseek R1 05/28 (163,840); Qwen3 Coder 30B A3B
Instruct (262,144); DeepSeek R1 (Fast) (163,840); Nemotron Lightning 3.5 30B
A3B (262,144; $0.05/$0.2); Inkling (1,048,576; $1/$4.05); Qwen3 Reranker 8B
(40,960; $0.2 per 1M); Qwen3 Embedding 8B (40,960; $0.1 per 1M); Step 5
Preview (1,048,576); Reflection Beam-1.0-501B-A23B (1,048,576); Muse Spark
Open 816B-A42B NVFP4 (1,048,576); NVIDIA Nemotron 3.5 Super VL 120B A12B BF16
(1,048,576); NVIDIA Nemotron 3.5 Super VL 120B A12B NVFP4 (1,048,576); Drex
2.0 (262,144); Qwen3.8-2.4T-A95B (262,144); Ling 3 Flash Fin (262,144);
DeepSeek-V4-Flash-Vision-Exp (1,048,576); Nemotron 3 Embed 8B (32,768);
Qwen3.8 27B (262,144); Inkling Small (1,048,576); Ling 3 Flash (256,000);
Qwen3.5 4B (262,144); BGE-M3 (8,192); GLM 5.2 FP8 (1,048,576); PaddleOCR VL
1.6 (131,072); Voyage 4 Large (40,960); Voyage Multimodal 3.5 (32,768); Voyage
ReRank 2.5 (32,768); Voyage 4 Lite (40,960); Voyage 4 (40,960); Qwen3.7 Plus;
Step-3.7-Flash-NVFP4 (262,144); NVIDIA Nemotron 3 Super 120B A12B BF16
(262,144); Gemma 4 E4B (131,072); DeepSeek-V4-Flash (1,048,576);
MiroThinker-1.7 (262,144); Voyage 4 Nano (40,960); Qwen3.6 27B (262,144);
Qwen3.6-35B-A3B (262,144); NVIDIA Nemotron 3 Nano Omni 30B A3B (262,144);
Qwen 3.5 122B A10B (262,144); Kimi K2.6 (262,144); MiniMax M2.7 (196,608); GLM
5.1 (202,752); Qwen3.5 9B (262,144); Gemma 4 31B IT (262,144); Gemma 4 26B A4B
IT (262,144); Qwen 3.5 35B A3B (262,144); Qwen3.5 27B (262,144); Gemma 3 1B
Instruct; Qwen3.5 397B A17B (262,144); Kimi K2.5 (262,144); GLM-4.7 Flash
(202,752); Molmo2-8B (36,864); Molmo2-4B (36,864); GLM-4.7 (202,752); Qwen3
Omni 30B A3B Instruct (65,536); Gemma 3 12B Instruct (131,072); Gemma 3 4B
Instruct (131,072); NVIDIA Nemotron Nano 3 30B A3B; Seed OSS 36B Instruct
(524,288); Devstral Small 2 24B Instruct 2512; Qwen3 VL 32B Instruct;
Qwen3-VL-8B-Instruct (262,144); Mistral Large 3 675B Instruct 2512 (256,000);
Ministral 3 14B / 8B / 3B Instruct 2512 (256,000 each); Deepseek v3.2
(163,840); FARE-20B (131,072); KAT Coder (262,144); Cogito 671B v2.1
(163,840); KAT Dev 32B (131,072); KAT Dev 72B Exp (131,072); OpenAI
gpt-oss-safeguard-120b (131,072); OpenAI gpt-oss-safeguard-20b (131,072);
NVIDIA Nemotron Nano 2 VL (131,072); MiniMax-M2 (196,608); Qwen 3 4B Instruct
2507 (262,144); NVIDIA Nemotron Nano 12B v2 (128,000); NVIDIA Nemotron Nano 9B
v2 (128,000); Qwen3 VL 30B A3B Thinking / Instruct (262,144); Qwen3 Embedding
0.6B (32,768); Qwen3 Embedding 4B (40,960); Qwen3 Reranker 4B / 0.6B
(40,960); Qwen3 Next 80B A3B Thinking / Instruct; DeepSeek V3.1 Terminus
(163,840); Qwen3 Coder 480B Instruct BF16 (262,144); GLM-4.5V (131,072); Qwen3
30B A3B Instruct 2507 (262,144); ERNIE-4.5-21B-A3B-PT (131,072);
ERNIE-4.5-300B-A47B-PT (131,072); InternVL3 38B (16,384); InternVL3 78B
(16,384); MiniMax-M1-80k; three Qwen3 1.7B fp8 drafting models (262,144 /
131,072 / 40,960); Qwen3 30B A3B Thinking 2507 (262,144); Rolm OCR (128,000);
DeepSeek R1 0528 Distill Qwen3 8B (131,072); Dobby Mini Unhinged Plus Llama
3.1 8B (131,072); InternVL3 8B (16,384); Devstral-Small-2505 (131,072); FLUX.1
[schnell]; GLM-4.5-Air (131,072); GLM-4.5 (131,072); Kimi K2 Instruct
(131,072); DeepSeek Prover V2 (163,840); Llama Guard 7B (4,096); Qwen2.5 1.5B
Instruct (32,768); Zephyr 7B Beta (32,768); Cogito v1 Preview Llama 70B / 8B /
3B, Qwen 14B / 32B (131,072); Gemma 3 27B Instruct (131,072); Qwen2.5-VL 32B
Instruct (128,000); Qwen3 0.6B (40,960); Qwen3 14B (40,960); Qwen3 1.7B
(131,072); Qwen3 32B (131,072); Qwen3 4B (40,960); Qwen3 8B (40,960); DeepSeek
R1 (Basic) (163,840); Dobby-Unhinged-Llama-3.3-70B (131,072); Firesearch OCR
V6 (8,192); Qwen2.5-VL 3B / 72B / 7B Instruct (128,000); QWQ 32B (131,072);
DeepSeek R1 Distill Qwen 32B (131,072); Llama 3 8B (8,192); Qwen QWQ 32B
Preview (32,768); Qwen2-VL 2B / 72B / 7B Instruct (32,768); Qwen2.5 0.5B
Instruct (32,768); Qwen2.5-Coder 0.5B / 32B / 3B (32,768); DeepSeek V2 Lite
Chat (163,840); FLUX.1 [dev] ControlNet; Llama Guard 3 8B (131,072); Llama 3.1
70B Instruct 1B; Llama 3.1 Nemotron 70B (131,072); Qwen2.5 7B Instruct
(32,768); Qwen2.5-Coder 0.5B / 3B / 14B / 1.5B / 7B Instruct and 14B / 1.5B /
7B (32,768); Qwen2.5-Math 72B Instruct (4,096); Llama Guard v3 1B (131,072);
Llama 3.2 3B / 1B / 1B Instruct (131,072); Qwen2.5 14B / 32B / 72B / 7B
(131,072); Qwen2.5 32B / 72B / 14B Instruct (32,768); DeepSeek V2.5 (32,768);
Llama 3.1 405B Instruct Long; Llama 3.2 11B / 90B Vision Instruct (131,072);
Stable Code 3B; CodeGemma 2B (8,192); DeepSeek Coder V2 Instruct (32,768);
DeepSeek Coder V2 Lite Base / Instruct (163,840); FireFunction V2; Gemma 2 9B
Instruct (8,192); Llama 3.1 70B Instruct (131,072); Mistral Nemo Base /
Instruct 2407 (128,000); CodeQwen 1.5 7B (65,536); CodeGemma 7B (8,192);
DeepSeek Coder 1.3B Base (16,384); Qwen2 72B / 7B Instruct (32,768); Yi-Large
(32,768); Dolphin 2.9.2 Qwen2 72B (131,072); Llama 3 8B Instruct (HF version)
(8,192); Mistral 7B Instruct v0.3 (32,768); Phi-3 Mini 128k Instruct
(131,072); Phi-3.5 Vision Instruct (32,064); DBRX Instruct (32,768); DeepSeek
Coder 7B Base (4,096); Gemma 2B Instruct (8,192); Llama Guard v2 8B (8,192);
Llama 3 70B Instruct and HF version (8,192); Mixtral Moe 8x22B and Instruct
(65,536); Hermes 2 Pro Mistral 7B (32,768); Mistral 7B v0.2 (32,768);
OpenChat 3.5 0106 (8,192); Phind CodeLlama 34B Python v1, v1, v2 (16,384);
Pythia 12B (2,048); Snorkel Mistral 7B PairRM DPO. Product: only the 22
snapshot ids have records; class (c) for the rest (§4.1).

## 5. Itemised (b), (c) and (d)

| #    | Class | Item                                                                                                                            | Product (file:line)     | Exact change                                                                       |
| ---- | ----- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| FWB1 | (b)   | Context values off by a few tokens or rounded (DeepSeek V4.1 Flash 1,000,000 vs 1,048,576; GLM 5.3 rows 1,048,573 vs 1,048,576) | snapshot                | live list at request time                                                          |
| FWB2 | (b)   | Meta's per-minute reader for an account-wide RPM ceiling                                                                        | `pacing.ts:30-44`       | a Fireworks bucket (10 or 6,000 RPM by account state) until headers are documented |
| FWC1 | (c)   | Records for every serverless model outside the 22 snapshot rows                                                                 | `configured.ts:436-454` | live `/inference/v1/models` values at request time                                 |
| FWC2 | (c)   | Prompt-cache key                                                                                                                | `configured.ts:540`     | send where captured as accepted                                                    |
| FWD1 | (d)   | Key prefix `fw_` refusal                                                                                                        | `presets.ts:619`        | hint only                                                                          |
| FWD2 | (d)   | Chat stream bounds                                                                                                              | `configured.ts:571-576` | derive from the model's max output                                                 |

Not documented / not verified: the full serverless list (page truncated; the
documented list page returned 404; the models API needs a key), per-model max
output, serverless TPM per tier and rate-limit headers ("Serverless rate
limits" page not read), router models.
