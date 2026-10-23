# RLPROVSYNC: provider-survey MUST and SHOULDs (2026-10-22)

Recovery lane on base `0.19.0` (`f3941b8548f3d9ef9126f1dd48ce94ba28f3e53b`),
worktree `/Users/user/lanes/RLPROVSYNC` on rig `macbook`. Implements the
provider-survey SHOULDs from `~/lanes/_ctx/codex/sdk-survey-2026-10-22.md`;
every claim below was verified against its linked source first. No provider
call was made from the rig (it holds no keys); wire proofs replay the
recorded captures under `docs/certification/m95-captures/`.

Commits: `bdd9ef181` (items 1-3), `18b4a8478` (item 5), item 4 below.

## 1. MUST: Anthropic count failures and separate count pacing

- `src/runtime/runtimeAccountingEntry.ts`: a failed Anthropic token count
  logs its HTTP status and `error.type` (redacted, no content) via
  `countFailureDetail()`; the over-length rejection has its own message and
  bound (`bytes-over-length`), rendered by `inputBoundInfoLine()`.
- `src/core/backends/modelapi/transport.ts`: count requests pace in their
  own bucket (`account:count`), apart from message requests, per the
  documented independent rate limit.
- Sources: `platform.claude.com/docs/en/build-with-claude/token-counting`
  (free counts, separate limits), API changelog.

## 2. SHOULD: Anthropic API version and live capabilities

- `ANTHROPIC_VERSION='2026-10-21'` at all three send sites (codec constant,
  configured headers, list headers); goldens moved version-only.
- `nativeCapabilityEvidence('anthropic', …)` reads
  `capabilities.thinking.types.disabled`/`between_tools` and
  `lifecycle`/`deprecated_at`/`retires_at` from the live Models API;
  per-field identity merge in `capabilityRecord.ts`. `claude-sonnet-4-5`
  end of life 2026-11-30 rides the live lifecycle record.
- Sources: `platform.claude.com/docs/en/api/versioning`,
  `…/migration-2026-10-21`, `…/api/models/list`,
  `…/release-notes/overview` (all read 2026-10-22).

## 3. SHOULD: catalogue re-sync 2026-10-22

- `node scripts/sync-provider-catalog.mjs --fetch`, reviewed in `$TMPDIR`,
  sealed with `--sync --from … --date 2026-10-22`: `e53f98…fb5e`.
  `--check` passes. Diff matches the survey (OpenAI −2 chat-latest,
  Mistral −3, Azure reprices).

## 4. SHOULD: OpenAI cache TTL and cache-write pricing

- New machine-scoped setting `museSpark.modelApiPromptCacheTtl`
  (`default` | `12h`, default `default`): `default` sends nothing.
- `src/core/providers/configured.ts` threads the live choice to the
  responses codec as `cacheTtl`; the codec sends
  `prompt_cache_options: { ttl }` only on wire ids parsing as GPT-5.6+,
  never on the ChatGPT plan route, never on Meta's verbatim path.
  `prompt_cache_retention` still rides beside it where accepted.
- Decode maps reported `cache_write_tokens_details` onto the canonical
  flat `cache_write_tokens_12h` counter and drops the carrier; a breakdown
  above the written total refuses as `invalid_cache_write_split`; a
  breakdown below it stays accepted for a later TTL.
- Settlement prices reported 12-hour writes at an explicit tier/card rate
  where one exists, else at the documented 2.5x multiple of the applicable
  input rate; 30-minute writes settle at the card's `cache_write` (the
  sealed gpt-5.6 row carries exactly 1.25x). Reserve bounds explicit 12-hour
  rates; user cards accept `cacheWrite12h`; journal, aggregates, export,
  review sentence and usage display carry the subset.
- Source: `developers.openai.com/api/docs/guides/prompt-caching` (TTL
  values, 400 on unsupported, `ttl_30m_tokens`/`ttl_12h_tokens` disjoint
  summing to `cache_write_tokens`, 1.25x/2.5x total write rates;
  read 2026-10-22).

## 5. xAI facts, safety id, retired DeepSeek

- xAI facts cover grok-4.5/4.6/4.7 with documented default effort `high`;
  per-entry `safetyIdentifier` rides as `safety_identifier` (xAI only).
- `deepseek-v4-flash` and `deepseek-v4-vision-exp` facts removed.
- Sources: `docs.x.ai/docs/release-notes`,
  `…/developers/model-capabilities/text/reasoning`,
  `api-docs.deepseek.com/updates` (read 2026-10-22).

## Tests and drills

Real-code tests; request bodies come from the real builders; the catalogue
gate runs on the new snapshot. Red/green drills, each reverted to green:

- D1 detail-reader (2 failed), D2 over-length line (1 failed), D3 pacing
  wire `false` (1 failed), D5 version revert (goldens + proof fail),
  D6+D7 live `between_tools` + dropped `retires_at` (2 failed).
- Item 5 triple-break (3 failed), codec `redacted` (1 failed), schema
  `z.string()` (1 failed).
- D8 version floor 6→7 (3 failed), D9 fallback 2.5x→1x (2 failed),
  D10 dropped TTL mapper (3 failed), D10b equality instead of upper bound
  (1 failed: the future-TTL test), D11 double-counted split (2 failed),
  D12 manifest enum order (1 failed).
- `splitCacheWrites` returning `{ standard, oneHour, twelveHour }` is a
  deliberate contract evolution for the 12-hour split; its two `toEqual`
  shapes were extended, not weakened.
- One `restoredToolText` wrap fixed a checkpoint-A test's type error
  (bare string where `BoundedToolText` is required).

Final verification, repo timeout throughout, no `--testTimeout`:

- Item files: responsesCodec 76, providersModel 24, journalRecord 14,
  providersModels 22, usageContracts, manifest 41, plus checkpoint files
  (execCountBound, providerPacing, anthropicCodec, capabilityRecord,
  tokenCount, providersPresets): all green.
- Regression sweep over every unit file importing a touched module:
  13 runs, 850 tests, all green.
- `npm run typecheck` (all five projects), eslint `--max-warnings 0` on
  every touched source, prettier, `check:l10n` (0 problems),
  `check:reference`, `sync-provider-catalog.mjs --check`,
  `check:catches`, production `npm run build` (exit 0; 14 pre-existing
  lazy-registry warnings naming only test/harness files).

## Residuals for the lead (outside the sandbox)

- The live free Anthropic count is the lead's on the owner PC (brief item 1).
- Real-life proof of item 4: set `museSpark.modelApiPromptCacheTtl` to
  `12h` in the packed product, send on GPT-5.6+, and confirm the usage
  journal shows 12-hour writes settling at 2.5x (the settings read itself
  is not unit-tested, RVRETRYLIMITS precedent).
- `npm run ui:look -- models` and the usage scenes for the new setting
  row, wizard field and 12-hour rows: Chrome is EPERM-blocked in this
  sandbox, so the look runs outside it.
