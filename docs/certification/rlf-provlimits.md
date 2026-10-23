# RLF-PROVLIMITS — the provider-documented limits RLM95 named and left unencoded

Lane: RLF-PROVLIMITS, rig macmini, branch `rec/rlf-provlimits` on main at
0.19.0 (`bbb152f35`). No merges: `rec/rlm95` already equals the base, and
RLF-M108 (merging RLM108) has no branch yet — RLM108's pacer and codec
files are older than main's on every hunk, so there is nothing to take
from it. Per the brief the source footprint stays on the pacer and codec
files, plus the transport's inseparable admission wiring, documented-limit
constants, their sentences, and the generated records the gates require.
No provider call was made on this lane.

## What was encoded

Each limit is encoded as its provider documents it, with the source and
its read date in the code (D121: a provider's documented limit). Each
limit says in words which provider limit it applied. Live 429 handling
(`observe`, the retry loop, backoff, `providerWaitMs`) is untouched.

### 1. DeepSeek concurrency (pacer admission)

- Documented: account-level concurrency, 2500 for `deepseek-flash`, 500
  for `deepseek-v4-pro`; one request counts from send until the model
  response is complete, regardless of API key; past the limit answers
  HTTP 429 (`api-docs.deepseek.com/quick_start/rate_limit`, "Concurrency
  Limit", read 2026-10-23; first recorded by RLM95 on 2026-10-22).
- DeepSeek sends no limit headers at all (recorded
  `docs/certification/m95-captures/deepseek/02-tool-call-stream.json`),
  so no header reader paces it: `deepseekConcurrencyLimit` carries the
  table, and models the table does not name stay unpaced under the live
  429 pause.
- The pacer holds one slot per governed admission until the returned
  lease runs; the transport runs it when the model response completes
  (a settled-body wrapper frees it at end, cancel, or error; failure
  reads and dispatch failures free it on the spot). Background waits for
  a slot name `DeepSeek`'s account concurrency ceiling; the foreground
  holds a slot without waiting, as with 429 pauses, and its own retry
  loop answers the provider's 429. Slots are counted per model on the
  account bucket; a second key on the same account keeps its own bucket
  and the 429 pause covers the remainder (noted in code).
- The concurrency gate runs ahead of the unobserved bypass on purpose:
  DeepSeek buckets never observe, so the ceiling is the only gate.

### 2. Azure 1 s / 10 s burst evaluation (pacer shaping)

- Documented: RPM enforcement expects requests evenly distributed over
  the minute and evaluates the incoming rate over short windows,
  typically 1 or 10 seconds, answering 429 past the window's expected
  share — 600 RPM over 1-second windows allows 10 per window
  (`learn.microsoft.com/azure/foundry/openai/how-to/quota`, read
  2026-10-23; first recorded by RLM95 on 2026-10-22).
- Observed Azure per-minute request limits additionally spread
  admissions across the trailing 1-second and 10-second shares
  (floored past the expected share; never below one, so a lone request
  is never stranded and the per-minute bucket still caps the minute
  rate). Foreground admissions count toward the windows without waiting.
  Unobserved buckets run no burst math: without Azure's own capture
  there is no header reader and no per-minute limit to share out, so
  the gate stays dormant and RLM95's Azure waiting state stands.
- A burst wait names Azure's small-window rate evaluation.

### 3. Anthropic many-image dimensions and request cap (codec refusals)

- Documented: past 20 image blocks in one request every image must fit
  the stricter per-image dimension limit — neither side over 2000 px
  stays under it on every platform — counting resent turns and images
  inside `tool_result` (`platform.claude.com/docs/en/build-with-claude/vision`,
  "Request limits", read 2026-10-23); the Messages endpoint allows
  32 MB, past it 413 `request_too_large`
  (`platform.claude.com/docs/en/api/overview`, "Request size limits",
  read 2026-10-23; both first recorded by RLM95 on 2026-10-22).
- The codec refuses both in words before sending: over-2000px images
  past 20 images (file-id references count while the provider judges
  their size, as do images whose bytes decode to no readable
  dimensions; document blocks are left out, since they count only on
  partner platforms and this preset is the direct API), and encoded
  request bodies past 32 MB.

## Proof

- Real-code suites over the real pacer and the real codec, in their own
  files: `test/unit/providerPacing.test.ts` (+19: the DeepSeek table and
  capture proof, slot admission/wait/release/foreground/Stop behavior,
  the 600-RPM shares and both sub-window gates, the wait sentences, the
  settled-body release) and `test/unit/anthropicCodec.test.ts` (+10: the
  2000 px and 32 MB refusals with their boundaries and controls).
- Red/green drills, one per limit (a fourth for the second Anthropic
  limit), each breaking the shipped code and watching the test fail:
  - DeepSeek: `provider === 'deepseek'` → `'deepseek-broken'` in
    `acquire`: "holds a slot per admission and waits past the
    documented 500" red (exit 1), green on revert (exit 0).
  - Azure: `provider === 'azure'` → `'azure-broken'` in the burst
    branch: "spreads a burst across the 1-second share" red (exit 1),
    green on revert (exit 0).
  - Anthropic dimensions: `ANTHROPIC_MANY_IMAGES_THRESHOLD` → `+ 1`:
    "refuses an over-2000px image past 20 images" red (exit 1), green
    on revert (exit 0).
  - Anthropic size: `bytes >` → `bytes <` the cap: "refuses a request
    past the documented 32 MB" red (exit 1), green on revert (exit 0).

## Gates (lane's own runs on this tree)

- `npx vitest run test/unit/providerPacing.test.ts
test/unit/anthropicCodec.test.ts`: 133 passed.
- `npx vitest related` over pacing + transport: 72 files, 796 passed
  (2 files / 12 tests skipped, pre-existing).
- `npx vitest related` over the Anthropic codec + constants: 727 files,
  22,104 passed; 19 files / 59 tests fail, all pre-existing
  rig-sensitive suites (schedule, vault, native-git, resource
  lifecycle): none imports the pacer, the transport, or the codec, and
  the same files fail the same way on the clean base tree
  (`scheduleFireFailures`, `treesLifecycleNative`,
  `nativeGitPullRequestReads`: 5-7 timing failures on `bbb152f35` with
  no lane changes present).
- `npx vitest related` over `en.ts` + `statusPhrases.ts`: 737 files,
  22,173 passed; 17 files / 51 tests fail, the same pre-existing
  rig-sensitive set plus `vsixCompression` (its pinned zopfli Python
  package is not installed on this rig — the suite's own refusal; the
  lane touches nothing it compresses).
- `npm run typecheck`: exit 0 (all five projects).
- `eslint --max-warnings 0` on every touched source and test file: clean.
- `prettier --check` on every touched file: clean.
- `node scripts/check-l10n.mjs`: 0 problems (4 new sentences in English
  plus all 14 tables, with real translations).
- `npm run check:catches`: matches the baseline (the two new catches
  are REPORTED: both rethrow; the dispatch catch's baseline identity
  regenerated for its added release line, class unchanged).
- `npm run check:reference`: exit 0. `npm run check:host-api`: exit 0
  after regenerating the record for the codec's `node:buffer` import.
- `npm run check:roadmap`: exit 0. `npm run duplication`: 0 clones.
  `npm run cycles`: no circular dependency. `npm run deadcode`: exit 0.
- `npm run build`: exit 0; `dist/modelApi.js` measured 525.0 KiB
  against its 525 KiB cap, moved to 575 KiB per D6 (+5%, this budget's
  own margin, rounded up to 25 KiB) with the one-line reason in
  `scripts/check-bundle-size.mjs`.
- SAST (`SSL_CERT_FILE=/etc/ssl/cert.pem SEMGREP_ENABLE_VERSION_CHECK=0
npm run security:sast`): 0 findings on 4010 files.
- `npm run check:plan`: fails on the pre-existing 85% tripwire only
  (3,576,723 bytes; RLM95's §7 deferral stands; the lane's status line
  added 993 bytes and its phrase its reviewed vocabulary entry).
