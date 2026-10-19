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
6. `docs/PRIVACY.md` — the voice exception added here ("once before the
   first recording in a window", from README Paid features) was wrong: the
   consent gate is per recording (`PAID_USE_REGISTRY` voice `once: 'use'`,
   "Every paid recording asks; Allow once covers one recording (CM352)"),
   proven by driving it (two uses ask twice; Tab asks once). Correction on
   `revcatch/auditdocs`: PRIVACY.md and `README.md` now say Muse Voice asks
   before each recording with Allow once covering one recording.

## Fixed in code (committed)

7. `scripts/build.mjs` — the bounded-pool refactor dropped `reportInputs`
   and `playbookSchedulesInputs` from the production bundle map, so
   `npm run build` failed its size gate with two MISS lines. Both bundles
   kept their watch contexts, size budgets, `.vscodeignore`, knip and ACP
   package entries; only the production pool lost them. Two lines restore
   them beside `reportingPanel`; pool size stays 8. Proven by the production
   `npm run build` size gate: the MISS lines are gone. No new unit test:
   a test asserting bundle-name parity
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

## Fixed in words, continued (uncommitted at record time)

8. `CHANGELOG.md` 0.19.0 Highlights 9 → 5 (the What's New cap is five);
   duplicate/internal subsections removed (`### Documentation`,
   `### Release infrastructure`, two `### Pending` merges, Other-CI
   clusters, test-only detail); report-kind, provider, voice and Tab-hook
   bullets condensed to user-visible behaviour.
9. `CHANGELOG.md` 0.19.0 media cluster condensed: the lane-V feature
   bullet (attaching video/audio, transcription ask-first, trusted
   converter, one-use attachments), the RVMEDIAV byte-integrity fix, the
   RVMEDIAV2–V4 ownership record, the media-accounting core and the
   non-Meta video refusal — implementation detail (digest checks, refund
   paths, bundle KiB trivia, per-surface failure-message enumerations)
   removed, user outcomes kept.
10. `CHANGELOG.md` 0.19.0 M123 Git/PR bullet condensed to its user truth
    (lanes merged and switched off; nothing changes for users yet).
11. `CHANGELOG.md` 0.19.0: three verbatim cross-release duplicates
    deleted from the 0.19.0 section only (oldest sections keep the
    record, verified byte-identical full blocks before removal):
    the release-train bundle-diet note (states "no user-visible
    change"), the What's New content-budget mechanism note, and the
    exact-money Node-version fix round. Plus two small cuts (an
    internal "Fakes only" line, a duplicated display-table perf line).
    Two-release What's New plain now 75,956 bytes; 0.19.0 and 0.18.2
    both ship full, unshortened.
12. CLI `--help` screens (`node dist/acp.js <command> --help`, built):
    top-level, `report`, `estimate`, `schedule`, `providers`, `auth`
    claims checked against `src/runtime/cliArgs.ts` and the code they
    name — no false claim found. `exec --help` and `scan-secrets --help`
    print the generic reference text rather than command usage
    (pre-existing routing, true as written, left alone).

## Fixed in code, continued (uncommitted at record time)

13. `scripts/build.mjs` + `scripts/lib/deferredBundles.mjs` —
    `productionMediaEntry.ts` was missing from `DEFERRED_OUTFILES`, so it
    inlined into `modelApi.js` (572.3 KiB) and `productionAudio.js`
    (141.2 KiB). One mapping row restored: `modelApi.js` 514.9 KiB
    (cap 525), `productionAudio.js` 66.8 KiB (cap 75).
14. New `src/host/conversation/conversationTransferEntry.ts` →
    `dist/conversationTransfer.js` (23.2 KiB, 50 KiB budget): the
    export/import/share flows (`exportConversation.ts`,
    `sessionImport.ts`, `sessionTransfer.ts`, `transcriptMarkdown.ts`)
    lazy-load out of `dist/conversation.js` (254.9 → 241.6 KiB, cap
    250), following the `conversationGit.js` precedent. Language table
    installed by the caller (`setUiText(UI_TEXT, uiLocale())`).
    `scripts/check-bundle-size.mjs` (new 50 KiB budget row),
    `scripts/check-bundle-split.mjs`, `scripts/check-host-globals.mjs`,
    `.vscodeignore`, `knip.jsonc` and
    `src/shared/lazyBundles.generated.ts` updated for the new bundle.
    An experimental `sandboxReadiness.ts` extraction that saved nothing
    was fully reverted.
15. `src/host/conversation/conversationController.ts` — the new
    `loadTransfer()` call sites assigned the awaited bundle before member
    access (`unicorn/no-await-expression-member`) and the memoized
    `transferBundle` field sits with the other private fields beside
    `reportHandler` (`unicorn/consistent-class-member-order`).

## Limits-as-features report (brief item 3)

No limit of ours is described as a feature in 0.19.0's person-facing
words. Every bound a person reads is either a provider's published limit
(the media/table rows verified against the repo's Meta records above)
or a person-settable setting with its default named (hooks 1–8 default
8, subagents 1–64 default 8, media expiry 1–30 default 7, Tab spend
defaults). No code change was needed.

## Left open (for the lead)

1. `dist/runtime.js` named in the brief does not exist in this tree; the
   shipped binary is `dist/acp.js` (`scripts/package-acp.mjs` bin). Help
   screens were audited there.
2. No en.ts string changed, so no pack regeneration was needed; `npm run
check:l10n` covers the walkthrough edit (walkthrough pages ship
   untranslated by design).
3. Thin budget headroom after the diet: `productionAudio.js` 66.8/75
   KiB, `modelApi.js` 514.9/525 KiB. Future merges may re-overflow;
   budgets stay as committed.
