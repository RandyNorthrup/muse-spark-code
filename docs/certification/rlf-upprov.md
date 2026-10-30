# RLF-UPPROV certification record (2026-10-30)

Findings with sources: `docs/research/providers-2026-10-30.md`.
Base `int/recovery` b781451b94; last provider sync 2026-10-22
(RLPROVSYNC). No paid provider call and no Muse model call was made.

## Gap table

| Provider                                                            | Item                                                                                                            | Upstream                                      | Our state before                                                               | Sev | Disposition                                                                  |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------ | --- | ---------------------------------------------------------------------------- |
| all catalogue                                                       | 8 days of model/price/limit drift (gpt-6.1-terra, Mistral retirements, DeepSeek V4 repricing)                   | models.dev live 2026-10-30                    | snapshot 2026-10-22                                                            | P1  | **Fixed**: re-synced through `scripts/sync-provider-catalog.mjs` (d0096931c) |
| DeepSeek                                                            | Catalogue rates are off-peak; peak (01–04, 06–10 UTC Mon–Fri) is exactly 2×                                     | api-docs.deepseek.com/quick_start/pricing     | card = off-peak, so capped sessions under-reserved 2× at peak                  | P1  | **Fixed**: card carries peak (467c50441)                                     |
| Anthropic                                                           | Messages request cap 32 MB → 128 MB, 2026-10-28                                                                 | platform.claude.com release notes             | we refused at 32 MB, a limit stricter than the provider's                      | P1  | **Fixed**: `ANTHROPIC_MAX_REQUEST_BYTES` = 128 MB (467c50441)                |
| Moonshot                                                            | K3.1 Pro/Highspeed (2026-10-23); preset declared catalogue pricing                                              | models.dev `moonshotai`                       | no catalogue section: every Moonshot model unpriced                            | P2  | **Fixed**: added to sync table (467c50441)                                   |
| Ollama Cloud                                                        | preset declared catalogue pricing                                                                               | models.dev `ollama-cloud`                     | no catalogue section: every model unpriced                                     | P2  | **Fixed**: added to sync table (467c50441)                                   |
| OpenAI                                                              | Models list carries `shutdown_date`; GPT-4o/4.1 snapshots die 2027-01-14, GPT-5.1/5.3-Codex/5.4-Nano 2027-04-01 | developers.openai.com/api/docs/deprecations   | field unread; no retirement shown                                              | P2  | Brief B1                                                                     |
| Anthropic                                                           | Usage and Cost API now legacy; Analytics API beta (Oct 29)                                                      | platform.claude.com release notes             | spend reader on legacy API (still supported)                                   | P2  | Brief B2                                                                     |
| Gemini                                                              | `gemini-3.5-flash` rerouted to 3.6 but catalogue prices old $1.50/$9; 3.6/3.8 rise to $1.50/$7.50 on 2027-01-01 | ai.google.dev deprecations; pricing secondary | over-reserves 2× on the rerouted id; January rise uncarried                    | P2  | Brief B3 (re-sync + upstream fix)                                            |
| all                                                                 | Catalogue now carries `input_audio`/`output_audio` rates (Gemini, gpt-audio)                                    | models.dev live                               | schema strips them; audio tokens would settle at text rates                    | P2  | Brief B4                                                                     |
| Meta/ACP SDKs                                                       | `@muse-code/sdk` 1.4.14, `@agentclientprotocol/sdk` 2.2.0                                                       | npm registry 2026-10-30                       | pins 1.4.11 / 2.0.1                                                            | P2  | Brief B5                                                                     |
| Bedrock                                                             | Unbuilt (M95c); upstream split into bedrock-runtime vs bedrock-mantle feature sets                              | PLAN M95c; AWS posts                          | design predates the split                                                      | P2  | Brief B6 (refresh of M95c/RLM95C remainder)                                  |
| Anthropic                                                           | `claude-sonnet-4-5-20250929` retires 2026-11-30                                                                 | model-deprecations page                       | in catalogue (correct until then); live list will drop it                      | P3  | No action; next sync                                                         |
| Groq                                                                | Catalogue fallback still lists `qwen3.6-27b` and enterprise-only Llamas                                         | console.groq.com deprecations                 | live list governs; fallback only                                               | P3  | No action                                                                    |
| MiniMax/Alibaba plans                                               | No catalogue section under plan preset ids                                                                      | models.dev `minimax`/`alibaba`                | plan pricing kind covers billing; capability evidence missing; both uncaptured | P3  | Brief B7 (after wire capture)                                                |
| DeepSeek                                                            | Peak settlement reads high off-peak (holiday calendar is not published as data)                                 | pricing page                                  | accepted conservative direction, stated in code                                | P3  | No action                                                                    |
| xAI, Together, Fireworks, OpenRouter, HF, Z.ai, Azure, Meta, Ollama | No API-shape change since 2026-10-22 found                                                                      | research doc                                  | current                                                                        | —   | —                                                                            |

## Fixed in this lane

- `d0096931c` — catalogue re-sync to 2026-10-30 via the sync script
  (`--fetch` digest `c26577ca…501d`, then `--sync --from` the saved
  download; `--check` ok). Retired ids leave with the snapshot; the
  live models list still governs what the panel offers.
- `467c50441` — DeepSeek peak multiple in `cataloguePriceCard`
  (preset-scoped, tiers included, source cited in code); Anthropic
  128 MB cap; Moonshot + Ollama Cloud in `CATALOG_PRESETS` and the
  re-sealed snapshot (312,754 bytes, under the 512 KiB cap).

## Red/green drills

1. DeepSeek peak: test expectations moved to peak rates first —
   `providerUsageFields.test.ts` failed 1 test
   (`maps reasoning per-token…`, card still off-peak). After the
   `priceCard.ts` change the file passes (27 tests).
2. Anthropic cap: constant expectation and the past-old-cap
   admission test were written against 128 MB before the constant
   moved (red in the same run: 1 failed file). After the change,
   `anthropicCodec.test.ts` passes (101 tests). The refusal test
   encodes two 70 MB images; it carries a named 60 s per-test
   timeout because encoding a >128 MB body is the long operation
   (a 129 M-character text body timed out at the repo's 5 s through
   the text-cleaning path — the image route is the honest one).
3. Catalogue: `node scripts/sync-provider-catalog.mjs --check`
   passes on the sealed vendor files (exit 0); a wrong digest is
   refused by the script's own checksum assertion (existing gate,
   not re-drilled here).

## Tests run (repository timeouts, `--maxWorkers=3`)

- `test/unit/providerUsageFields.test.ts` + `anthropicCodec.test.ts`:
  128 passed after fixes.
- `providersPresets` + `providersModel` + `providerUnpriced`:
  56 passed (before and after the catalogue table change).
- Related-suites and gate exit codes are in the lane's final message.

## Live calls for the lead's real-life run (not made here)

1. DeepSeek (`deepseek/deepseek-flash`): one short tool turn at a
   known UTC time inside and one outside the peak windows; compare
   the provider balance delta with our settled amount (expected:
   peak turn matches our card; off-peak turn settles at half the
   provider's charge). 2 requests, cap $0.05.
2. Moonshot capture (rule 13, unblocks the preset): `GET /v1/models`
   plus one `kimi-k3.1-pro` tool turn. ~3 requests, cap $0.05.
3. Ollama Cloud capture: `GET /v1/models` plus one tool turn on the
   cheapest listed model. ~3 requests, cap $0.05.
4. Anthropic 128 MB cap: only if a naturally large real turn arises;
   do not manufacture a 100 MB prompt to prove it.

## Lane briefs for the lead

### B1 — Surface OpenAI `shutdown_date` (and provider retirements generally)

- Platform: linuxlt. Base: `int/recovery` after RLF-UPPROV.
- Build: parse `shutdown_date` from the OpenAI/Azure/xAI models
  lists into the capability record (live-capture first, rule 13);
  show "retires YYYY-MM-DD" in the Models panel and refuse nothing.
- Proof: real-code test over a captured list body; panel look.

### B2 — Anthropic spend on the Usage and Cost Analytics API

- Platform: linuxlt. Base: after RLF-UPPROV.
- Build: move the `admin-report` spend reader to
  `/v1/organizations/analytics/{usage,cost}` behind the
  `analytics-usage-cost-2026-08-24` beta header; legacy endpoints
  remain supported, so this is currency, not rescue. Needs an
  admin-key capture by the lead first.
- Proof: captured response shape in the record; parser tests over
  the capture.

### B3 — Gemini rerouted-id pricing and the 2027-01-01 rise

- Platform: any. Base: after 2026-12-31.
- Build: re-sync the catalogue on/after 2027-01-01; file the
  `gemini-3.5-flash` stale-price row upstream at models.dev; if
  upstream keeps the old price for the rerouted id, decide whether
  a preset-level alias price (3.5-flash → 3.6-flash card) is ours
  to carry.
- Proof: sync `--check`; the two ids settle identically in a
  real-code price test over the sealed snapshot.

### B4 — Audio token pricing end to end

- Platform: linuxlt. Base: after RLF-UPPROV.
- Build: keep `input_audio`/`output_audio` in the sync schema's
  kept fields, add audio rates to `PriceCard`, read audio token
  counts from Gemini `usageMetadata` and OpenAI usage details
  (captures first), settle them at audio rates.
- Proof: usage-field tests over captured frames; settlement test
  where audio ≠ text rate.

### B5 — SDK bumps: `@muse-code/sdk` 1.4.14, ACP sdk 2.2.0

- Platform: linuxlt. Base: after RLF-UPPROV.
- Build: bump both pins (exact versions), read both changelogs,
  re-capture MSP/ACP wire shapes the bumps touch, update PLAN D3.
- Proof: integration suite inside VS Code plus the ACP host
  scripts; no claim beyond what those runs show.

### B6 — Bedrock (M95c remainder), design refresh first

- Platform: linuxlt. Base: current PLAN M95c text.
- Build: refresh the design against the bedrock-runtime /
  bedrock-mantle split and Bedrock's own Anthropic-version
  schedule, then build the presets behind wire captures (needs
  AWS credentials the rig does not have — lead captures).
- Proof: per M95c's own checklist.

### B7 — MiniMax/Alibaba plan catalogue sections

- Platform: any. Base: after each plan preset's wire capture.
- Build: add `minimax`→`minimax-plan` and `alibaba`→`alibaba-plan`
  to the sync table only once a capture proves the plan endpoints
  serve those exact ids ("names/model slugs are never fabricated").
- Proof: capture in `docs/certification/m95-captures.md`; sync check.
