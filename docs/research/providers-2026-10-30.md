# Provider upstream research, 2026-10-30 (RLF-UPPROV)

Base: `int/recovery` b781451b94. Last catalogue sync: RLPROVSYNC,
2026-10-22 (`vendor/models-dev/VENDOR.json` `fetchedAt`). Everything
below was read on 2026-10-30 from the page named; secondary sources are
marked as such and never carry a code change alone.

## Catalogue (models.dev)

- Live `https://models.dev/api.json`, 5,954,957 bytes, SHA-256
  `c26577caf4fee14bf9342ebc1099761a2b204cd79d466fc52e68544163bf501d`,
  diffed model-by-model against the 2026-10-22 snapshot. Headline
  drift: `gpt-6.1-terra` added (OpenAI, Azure, OpenRouter); Azure adds
  `deepseek-v4-flash`/`deepseek-v4-pro`, drops `claude-opus-4-1`;
  Mistral drops six retired ids and halves `mistral-large-4`
  ($1.36/$4.18 → $0.70/$2.10); OpenRouter drops twelve ids (incl.
  `openai/gpt-3.5-turbo`, `gpt-4-turbo`, `o1`, `o3-mini`, `o4-mini`)
  and reprices the DeepSeek V4 family; Fireworks adds three routers;
  Hugging Face swaps three ids. New cost fields `input_audio` /
  `output_audio` appear on Gemini and OpenAI audio rows.
- `moonshotai` (6 tool models) and `ollama-cloud` (23) sections exist
  upstream and match our preset ids; neither was in the sync table.

## OpenAI

- Changelog (https://developers.openai.com/api/docs/changelog):
  Oct 26 — GPT-6.1 Terra released on Responses and Chat Completions
  ($1/$5, cached $0.05, per the pricing page as reported Oct 27;
  the catalogue row matches). Oct 22 — Decisions API GA (400
  questions). Oct 20 — 12-hour prompt caching, writes at 2.5× input
  (already in our Responses codec from RLPROVSYNC). Oct 6 — usage
  tiers cut from five to three (secondary:
  https://aicatchup.com/news/openai-gpt-6-1-sol).
- Deprecations (https://developers.openai.com/api/docs/deprecations):
  Oct 14 notice — `gpt-4o-2024-08-06`, `gpt-4o-2024-11-20`,
  `gpt-4o-mini-2024-07-18`, `gpt-4.1-2025-04-14`,
  `gpt-4.1-mini-2025-04-14` shut down 2027-01-14 → `gpt-6-luna`.
  Oct 1 notice — `gpt-5.3-codex`, `gpt-5.4-nano`, `gpt-5.1` shut down
  2027-04-01. The models list now carries a per-model
  `shutdown_date` field we do not read.

## Anthropic

- Release notes (https://platform.claude.com/docs/en/release-notes/overview):
  Oct 29 — Usage and Cost Analytics API beta
  (`analytics-usage-cost-2026-08-24`); the Usage and Cost API our
  spend reader uses becomes legacy (still supported). Oct 28 —
  Messages/Token Counting maximum request size 32 MB → 128 MB
  (first-party). Oct 21 — API version `2026-10-21` (already ours from
  RLPROVSYNC; sampling parameters removed there, and we send none).
- Model deprecations
  (https://platform.claude.com/docs/en/about-claude/model-deprecations):
  `claude-sonnet-4-5-20250929` deprecated 2026-09-30, retires
  2026-11-30 → `claude-sonnet-5-5`. Haiku 5.5 / Sonnet 5 return 400
  on manual `budget_tokens` and non-default sampling parameters;
  our codec sends manual thinking only where the capability record
  says `manual` and not `adaptive`, and sends no sampling fields.

## Gemini

- Deprecations (https://ai.google.dev/gemini-api/docs/deprecations,
  "Last updated 2026-10-22"): `gemini-3.7-flash` → auto-routes to
  `gemini-3.8-flash`; `gemini-3.5-flash` → auto-routes to
  `gemini-3.6-flash` (neither endpoint shuts down). Live/TTS previews
  (`gemini-3.1-flash-live-preview`, `gemini-2.5-flash-preview-tts`,
  `gemini-2.5-pro-preview-tts`,
  `gemini-2.5-flash-native-audio-preview-12-2025`,
  `gemini-3.1-flash-tts-preview`) shut down 2026-11-17.
  `gemini-3.1-flash-lite` shuts down 2027-05-07.
- Secondary (https://acceptallhq.com/diff/2026-10-09-gemini-flash-rerouted/,
  read 2026-10-30): the pricing page lists 3.6/3.8 Flash at
  $0.75/$3.75 "through December 31, 2026, then $1.50 and $7.50" — a
  scheduled rise our snapshot cannot carry; re-sync after 2026-12-31.
  The catalogue still prices the rerouted `gemini-3.5-flash` id at
  its old $1.50/$9 while requests serve (and bill as) 3.6 Flash.

## xAI

- No catalogue drift since 2026-10-22; Grok 4.7 $2/$6, cached $0.50,
  doubling at 200k (secondary, read 2026-10-30:
  https://usagebox.com/articles/grok-api-pricing-2026), matching our
  rows and the live-list tick prices we already prefer.

## DeepSeek

- Pricing (https://api-docs.deepseek.com/quick_start/pricing):
  exactly two API models, `deepseek-flash` (V4.1-Flash-1017, Oct 17)
  and `deepseek-v4-pro` (V4-Pro-0813). Legacy `deepseek-v4-flash` and
  `deepseek-v4-flash-vision-exp` are retired ids still accepted and
  billed as Flash. "Off-peak rates are half of the peak rates. Peak
  hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through
  Friday, excluding Chinese public holidays." The models.dev rates
  ($0.15/$0.60, cache hit $0.003; pro $0.66/$1.98) are the off-peak
  column verbatim. DeepSeek also opened paid Search/Fetch APIs
  ($0.75 per 1,000 calls; secondary:
  https://www.digitalapplied.com/blog/deepseek-v4-1-flash-1017-search-api-october-31).

## Mistral

- Deprecated & retired table (https://docs.mistral.ai/models, via
  secondary read 2026-10-30) and models.dev's own removal PR
  (https://github.com/anomalyco/models.dev/pull/11087):
  `devstral-small-2505` retired 2025-11-30; `devstral-small-2507`,
  `devstral-medium-2507`, `mistral-large-2411`, `pixtral-large-latest`
  retired 2026-05-31; requests to retired ids fail (404/400). All
  left our snapshot in this sync. Mistral Large 4 (Oct 6) is the
  flagship; `mistral-large-4` price halved in the catalogue.

## Moonshot (Kimi)

- Kimi K3.1 Pro launched 2026-10-23 at $2/$10, cached $0.20, with
  `kimi-k3.1-pro-highspeed` at $4/$20 (Moonshot pricing page via
  secondary: https://cellcog.ai/blog/kimi-k3-1-release-date/,
  https://venturebeat.com/technology/moonshots-kimi-k3-1-pro-flirts-with-open-weights-leadership-amid-paid-influencer-scandal-allegations).
  The models.dev `moonshotai` rows match those rates exactly.

## Groq

- Deprecations (https://console.groq.com/docs/deprecations, via
  secondary): `llama-3.3-70b-versatile` and `llama-3.1-8b-instant`
  left free/Developer plans 2026-08-16 (enterprise remains);
  `groq/compound(-mini)` shut down 2026-09-21; `qwen/qwen3.6-27b`
  replaced by `qwen/qwen3.8-27b` 2026-09-14. Our Groq prices come
  from the live list, and the catalogue already carries 3.8; it
  still also carries 3.6 and the two Llama rows (harmless where the
  live list governs, wrong as a fallback for free-plan keys).

## Together / Fireworks / OpenRouter / Hugging Face / Z.ai

- Together removed `meta-llama/Llama-3.3-70B-Instruct-Turbo` from
  serverless on 2026-10-22 (https://docs.together.ai/docs/deprecations
  via secondary https://github.com/robhunter/agentdeals/pull/2802);
  Fireworks ended serverless for seven models on 2026-09-25
  (secondary). Both are live-list priced in our presets, and the
  catalogue diff shows no Together drift and three new Fireworks
  routers. OpenRouter and Hugging Face drift is catalogue-only
  (above); both are live-list priced. Z.ai: no drift; GLM-5.3 rows
  present. No API-shape change found for any of the five since
  2026-10-22.

## Azure OpenAI

- Our preset already uses the v1 surface (`/openai/v1`, no
  `api-version`), which remains Microsoft's current route.
  Retirement dates differ from OpenAI's (e.g. `gpt-4o` 2024-05-13 on
  2026-12-09; secondary: https://benchlm.ai/blog/posts/openai-october-23-shutdown).
  Azure is still `wireCapture: false`; nothing to sync until its
  capture lands.

## Meta (Model API and Muse Code)

- Published rates unchanged since our 2026-10-22 verification:
  Spark standard $1.25/$4.25 (cached $0.15), contributor
  $0.10/$0.20 (cached $0.002), Wonder $4/$20 (cached $0.20)
  (secondary cross-check read 2026-10-30:
  https://aiusagelimits.com/api-rate-limits-pricing/). Our
  `MODEL_API_PRICES_PER_MILLION` matches. Muse Spark Open (Oct 15,
  open weights) reaches us through other hosts' catalogues
  (Ollama Cloud, OpenRouter), not the Model API whitelist.
- SDK drift (npm registry, read 2026-10-30): `@muse-code/sdk`
  latest 1.4.14 vs our pin 1.4.11; `@agentclientprotocol/sdk`
  latest 2.2.0 vs our pin 2.0.1.

## Ollama / Ollama Cloud

- Ollama is at v0.40.x (v0.40.5 Oct 14; releasebot secondary:
  https://releasebot.io/updates/ollama). Our native codec surface
  (`/api/tags`, `/api/chat`, `think` levels incl. `max`) is
  unchanged upstream; the preset remains uncaptured. Ollama Cloud
  model ids/prices now sync from models.dev `ollama-cloud`.

## Amazon Bedrock

- Still unbuilt here (M95c; PLAN.md design at the M95c section).
  Upstream moved since that design: GPT-6 Astra GA 2026-09-08 is
  served on two endpoints with different feature sets
  (`bedrock-runtime` Converse/Responses/Chat vs `bedrock-mantle`
  explicit caching; secondary:
  https://dev.to/fernando_azevedo_6844e930/gpt-6-astra-on-bedrock-the-endpoint-decides-what-you-audit-4ekh),
  and Anthropic's new-version breaking changes apply per platform
  (Bedrock keeps its own schedule). The M95c design (Anthropic codec
  at `bedrock-runtime.{region}.amazonaws.com/anthropic/v1/messages`,
  Responses for GPT) needs a refresh against the mantle split
  before it is built.
