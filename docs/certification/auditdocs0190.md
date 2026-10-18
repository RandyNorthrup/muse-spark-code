# Audit: no untrue claim ships in 0.19.0's person-facing words

Lane AUDITDOCS, branch `audit/0190-docs-truth`, base 749fb4c8c5 (features
group = release/0.19.0 plus the 0.19.0 merges). Method: every
limit/cap/default/price/platform claim in README.md, docs/_.md,
docs/\**/_.md (records skipped), package.json contributes, the walkthrough
pages, the CLI `--help` screens (built locally; see finding 1) and the
changed en.ts strings was checked against the code and, for provider
numbers, against the repository's published provider records
(docs/research/meta-coverage-2026-10-05.md, docs/certification/m94-research.md,
docs/certification/m95-research.md). New-in-0.19.0 words got the full
check via the main-now diff; older sections got their numbers and absolute
claims checked.

## Fixed in words (committed)

1. `docs/acp.md` — `/playback` "a model turn, on both backends" was false.
   `src/acp/agent.ts` `startPlaybackTurn` refuses without a Model API
   playback binding (`playbackNeedsModelApi`); only the Model API backend
   runs it, as README says. Now reads "on the Model API backend, refused
   on Muse Code".
2. `docs/acp.md:249` — stray merge-marker line
   `> > > > > > > cand/MSM95/4` after the LM Studio paragraph. Deleted.
3. `README.md` Help and reference — "`report --help` … also print it [the
   full reference]" was false. `src/runtime/cliArgs.ts` `parseReport`
   deliberately routes `report --help` to the report command's own usage
   (REALLIFE F34); verified on the built binary. `exec --help` and
   `scan-secrets --help` do print the full reference (verified). Words now
   say so.
4. `README.md` Linux dictation — "ten `linux-*` helper assets" was false.
   `src/shared/linuxHelperPins.ts` pins twelve files per architecture
   (binary, libwhisper, libggml, libggml-base, eight CPU backends). Now
   "twelve … for your architecture".
5. `resources/walkthrough/chat.md` — free dictation "on Windows and macOS"
   omitted 0.19.0's local Linux offline English dictation. Now names it.
6. `docs/PRIVACY.md` — paid features "asks again in a popup before each
   use" was stale for Muse Voice, which asks once before the first
   recording in a window (README Paid features, `en.ts` consent strings).
   Now carries both exceptions (web search once per prompt; voice once per
   window).

## Fixed in code (committed)

7. `scripts/build.mjs` — the bounded-pool refactor dropped `reportInputs`
   and `playbookSchedulesInputs` from the production bundle map, so
   `npm run build` failed its size gate with two MISS lines. Both bundles
   kept their watch contexts, size budgets, `.vscodeignore`, knip and ACP
   package entries; only the production pool lost them. Two lines restore
   them beside `reportingPanel`; pool size stays 8. Proven with a
   local-only What's New relief (finding 1, never committed): the MISS
   lines are gone. No new unit test: a test asserting bundle-name parity
   would be a text-existence test, which the repo refuses; the build gate
   itself is the check.

## Verified true (no change)

- Limits table, every row: 20 attachments (`MAX_ATTACHMENTS_PER_MESSAGE`),
  10 MiB images (`MAX_IMAGE_BYTES`), 32 MB PDFs (`MAX_DOCUMENT_BYTES`),
  50 per request / first 50 page images (`MODEL_API_MEDIA_PER_REQUEST`,
  `MODEL_API_PDF_PAGE_IMAGES`; text-from-first-100-pages and 50 MB inline
  per the repo's Meta file-handling record), 48 M encoded chars,
  1 MiB text files + 768 KiB combined wrappers (786,432 =
  `MODEL_API_CONTEXT_WINDOW` − reserve), 10 MiB Muse Code frame with 2 MiB
  headroom, 50 tool rounds, shell 2 min default / 10 max, 5 attempts
  (`MODEL_API_MAX_RETRIES + 1`), 5-minute silent stream, file tools
  10 MiB / 32 MB with 1 MiB search skip, opened outputs 16 MiB × 20 with
  33,554,432 aggregate chars, Meta 16-token output minimum.
- Tab: $1.00 default, $0.05–$50, 2 in flight, 20/min, 350 ms debounce,
  1,500 ms hook timeout, 512-char hook previews, `muse-spark-1.3` default,
  per-language defaults. $0.80/$0.05 hourly figures match the M94 research
  record's method.
- Prices: $2.50/1,000 searches, $0.01/image, $0.18/audio hour
  (`PAID_PRICES_USD`, page read 2026-09-24); token rates $1.25/$0.15/$4.25
  standard and $0.10/$0.002/$0.20 contributor per the M94 record.
- Voice bounds: 180 s cap, 80 ms frames/tail, reserve-then-connect, final
  `audioProcessedMs` rounded down. Headless reservation quotes
  ($0.108135/$1.409024 etc.) match docs/ci.md's table.
- Settings: hook bounds 1–8 default 8 (capped at Muse Code's own),
  running commands default 0, subagents 1–64 default 8 with 64 per
  conversation, media expiry 7 days (1–30), upload cap, dictation model
  77,704,715 bytes (74 MiB), helper ~7.6 MB.
- CLI: `--questions-defer-after` 60 default, 0 never, 1–9 read as 10, max
  3600 (`questionDeferSeconds`); `estimate --check-plan` exits 0 clean /
  1 problems / 2 usage (driven, not read). Engine pins Node ≥ 22,
  VS Code ^1.99.0; 15-language badge = English + 14 packs.
- Voice availability: Node 20 (1.99/1.100) has no WebSocket; 1.101–1.111
  WebSocket unrouted — matches Requirements and the 0.19.0 proxy highlight.
- Walkthrough shortcuts match package.json bindings; Ubuntu 24.04 helper
  build matches CI; playback marker matches the model text.
- Read as records, not claims (no product change): docs/orchestration/_,
  docs/design/_, docs/testing/_, docs/research/_, judge.md's stated
  qualifications, ci-other-systems.md's stated non-certification.

## Left open (blocking, for the lead)

1. **`npm run build` fails on the What's New bound — release-blocking.**
   CHANGELOG `[0.19.0]` alone decodes to 147,798 bytes over the 76,800
   bound (`WHATS_NEW_CONTENT_DECODE_MAX_BYTES`), so selection throws
   before any bundle check. 0.19.0's section is 1,908 lines / 254 bullets
   with 23 `###` subsections (duplicate Added/Fixed/Changed/Pending
   headers from keep-both merges) — 2.2× the previous largest (0.17.0,
   865 lines). Per docs/RELEASING.md the fix is trimming the notes, but
   that destroys shipped history the changelog header promises to keep;
   raising the bound grows the shipped What's New artifact (40 KiB
   budget). Either way a release-shape decision, not an audit call.
2. **Three bundle budgets OVER after the pool fix** (measured with the
   local-only relief): `dist/conversation.js` 254.9/250 KiB,
   `dist/modelApi.js` 572.3/525 KiB, `dist/productionAudio.js` 141.2/75
   KiB (grew 2.4× past its 58.4 KiB measurement as lane V's seams added
   consent/ledger/budget code to the audio path). Budgets are never
   raised; this needs diet work (further lazy splits) in its own lane.
3. `dist/runtime.js` named in the brief does not exist in this tree; the
   shipped binary is `dist/acp.js` (`scripts/package-acp.mjs` bin). Help
   screens were audited there.
4. No en.ts string changed, so no pack regeneration was needed; `npm run
check:l10n` covers the walkthrough edit (walkthrough pages ship
   untranslated by design).
