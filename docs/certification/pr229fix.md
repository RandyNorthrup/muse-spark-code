# PR #229 review threads — triage and fixes (lane PR229FIX, branch `fix/nolimits-1-fin`)

One line per thread; each item ends FIXED in this lane or ANSWERED with the
earlier commit / a measured reason. No model calls, no credentials.

## Triage W1 (lane PR229W1, branch `fix/nolimits-1-final-w1`, head `5990cc56d2`)

One line per thread (11) and per CI failure; each ends FIXED earlier, FIX in
this lane, or ANSWERED with a measured reason. T1–T6 stand FIXED/ANSWERED by
the commits named below (verified present on this branch); T7–T11 and the CI
goldens are fixed in this lane.

- T1 `imageGeneration.ts` ten-source edit limit — FIXED earlier by `e0f4e8af4f`
  (Meta's own 1–10 range in runtime schema and tool definition).
- T2 `bestOfN.ts:76` eager attempt materialization — FIXED earlier by
  `7f07354f1b` (lazy per-item creation after consent, with cancellation).
- T3 `execArgs.ts:131` large budget vs ledger — FIXED earlier by `10a1951e63`
  (ledger `units()` holds BigInt micro-USD with no ceiling).
- T4 `rename.test.ts:17` invented fixtures — ANSWERED earlier by `d3ef3d00fd`
  (drives the real `mergePlacedEdits` with plain internal-type literals; no
  mocks, no wire boundary, fails with the old ceiling restored).
- T5 `promptCommands.ts:272` unbounded share filename — FIXED earlier by
  `bf1ffe8a06` (title unlimited; suggested filename cut to 255 bytes).
- T6 `mcpBridge.ts:642` duplicated check names — FIXED earlier by `570ef7dd84`
  (deduplicate names before scheduling; distinct checks unbounded).
- T7 `checkout.ts:822` tree-listing ceiling — FIX in this lane: the `ls-tree`
  still runs through the fixed `GIT_OUTPUT_MAX_BYTES` buffer; stream the
  listing (the module already owns a spawn/stream port) instead of keeping a
  hard-coded ceiling.
- T8 `sources.ts:114` unbounded report concat — FIX in this lane: the default
  path retains every chunk plus a full concat plus the full string; decode
  incrementally so one large source is never held several times over.
- T9 `sessionTransfer.ts:674` bytes-vs-tokens replay check — FIX in this
  lane: measure the replay in tokens with the established
  `MODEL_API_CONTEXT_BYTES_PER_TOKEN` estimator instead of comparing UTF-8
  bytes to a token window.
- T10 `goals.ts:135` goal vs context window — FIX in this lane: refuse a goal
  whose pinned objective section cannot fit the selected model's recorded
  context window (provider's own limit), measured with the same estimator.
- T11 `planStore.ts:190` plan brief vs attachment ceiling — FIX in this
  lane: the brief path hits the fixed `MAX_TEXT_ATTACHMENT_BYTES` before the
  model-derived bound; admit plan briefs by backend/model capability.
- CI `invariants.test.ts` golden drift (06-subagent-child, 08-team-on,
  strict/06) — FIX in this lane: the T1 fix changed the real `edit_image`
  tool definition, so the recorded golden bytes are stale; regenerate the
  affected goldens from the real builders (recorded input untouched).

## Fixes W1 (lane PR229W1)

- CI goldens: re-baselined `06-subagent-child.json` (3/3 requests),
  `strict/06-subagent-child.json` (3/3) and `08-team-on.json` (1/1) from the
  real builders with `temp/regen-goldens.ts` (esbuild-bundled, run once,
  recorded input/instructions/model untouched). Byte diff, and nothing else:
  (a) the `edit_image` tool gains `minItems: 1, maxItems: 10` and the "one
  to ten" description (the T1 provider-limit fix `e0f4e8af4f`); (b) the
  `delegate` tool drops "one to 6" and `maxItems: 6` (the A28 ceiling
  removal `f345149261`); (c) the three `prompt_cache_key` digests that cover
  those tool lists. `invariants.test.ts` 42/42 green on the repo default
  timeout, no `--testTimeout`.
- T9 (`sessionTransfer.ts`): `oversizeReason` measures the replay in tokens
  with the established `MODEL_API_CONTEXT_BYTES_PER_TOKEN` estimator — the
  same lower estimate the send-time `assertContextFits` preflight applies to
  the complete first request (instructions, tools, replay, new message) —
  instead of comparing UTF-8 bytes to the token window. A repetitive ~2 MB
  transcript (≈500K tokens) is now accepted (the old code refused it); past
  the window in estimated tokens still refuses with the same message.
  `sessionTransfer.test.ts` 25/25.
- T10 (`goals.ts`): `create_goal` and the `set`/`edit` verbs refuse an
  objective whose whole pinned section (objective plus the mandatory rules
  prose, measured with the same estimator) alone exceeds the selected
  model's recorded `contextTokens` — the provider's own limit — before the
  goal activates; unknown window means no check, and the per-request
  remainder stays the send-time preflight's guard. `GoalContext` carries the
  window from `contextModelFor(this.deps, this.modelId)` at both host call
  sites. New `MODEL_API_MODEL_TEXT.goalObjectiveTooLarge` plus
  `UI_TEXT.goalObjectiveTooLarge` (English in all 14 tables, listed in
  `l10n/untranslated.json`); `check:l10n` 0 problems. `goals.test.ts`
  15/15, `goalCommand.test.ts` green; the new refusal test was seen to fail
  with the comparison inverted.
- T7 (`heldTree.ts`, runtime `checkout.ts`, `heldCheckout.ts`): `ls-tree`
  streams NUL records through the new `ListingRecords` splitter straight
  into `heldTreeFromRecords` on both paths (runtime: new `runGitListing`
  over the existing spawn port with the module's gate/deadline/Cancel
  discipline; extension: the lane's already-streaming `gitProcess`), so no
  fixed `GIT_OUTPUT_MAX_BYTES` buffer stands between git and the validator
  and a 64 MiB+ tree reads like any other; the old `MAXBUFFER`→unreadable
  mapping is gone with the buffer. `heldTree()` keeps its whole-string
  shape over the splitter. `heldTree.test.ts` 64/64 with the file (split
  mid-`é`, streamed-equals-buffered, undecodable-refuses; the splitter test
  was seen to fail with the NUL match broken), plus a real-use drill:
  this repo's 4,932-entry `ls-tree -z` in hostile 1/7/65536/3-byte chunks
  validates byte-identical to the buffered read.
- T8 (`reporting/sources.ts`): `read()` decodes chunks straight into the
  returned string through one streaming `TextDecoder` instead of retaining
  every chunk plus a second `Buffer.concat` plus the string; the default
  still reads at any size (the N3 17 MB test stands unweakened) and an
  explicit finite `maxBytes` still refuses past itself, with identical
  `invalid`/`limit` mapping including mid-stream bad bytes.
  `reportSourceSize.test.ts` 3/3 with the new split-`é`/bad-bytes case
  (seen to fail with `{ stream: true }` removed).

## Final gates (lane PR229W1, final tree)

- Suites on the repo default timeout, never `--testTimeout`: invariants
  42/42, sessionTransfer 25/25, goals 15/15 + goalCommand green,
  attachments 19/19, heldTree 57/57 + heldCheckoutCore green,
  reportSourceSize 3/3; `vitest related` for the changed core/runtime
  sources 510 passed / 4 skipped, and for the host/runtime checkout paths
  green (rest environment-skipped).
- `npm run typecheck` exit 0 (one fix after T7: explicit `Buffer` field
  type in `ListingRecords`, committed as its own follow-up).
- `eslint --max-warnings=0` on every lane-changed source/test/script
  file: clean. `prettier --check`: clean. `check:l10n` 0 problems,
  `check:reference` current, `check:plan` 0 drift, `npm run build`
  exit 0 with budgets green.
- T11 (`attachments.ts`, `ModelApiHost.ts`): the Model API text admission
  compared UTF-8 bytes to the token-window-minus-reserve number, and a fixed
  1 MiB pre-check fired first, so provider-valid plans (>1 MiB, inside the
  window in tokens) could never be implemented. Admission and the send-time
  aggregate guard now both estimate tokens high with
  `MODEL_API_CONTEXT_BYTES_PER_TOKEN` against the renamed
  `MODEL_API_TEXT_BUDGET_TOKENS` (same 786,432 count, now honestly tokens);
  Muse Code keeps its own 1 MiB file ceiling. Reference regenerated
  (`modelApiTextAllowanceTokens`). `attachments.test.ts` 19/19 (the slow
  20×4 MB case became 3 shared-buffer attempts after a 5 s timeout; the new
  plan-brief test was seen to fail with the comparison inverted).

## Triage (committed first)

- T1 `imageGeneration.ts:59` ten-source edit limit — FIX in this lane: enforce
  Meta's documented 1–10 edit-item range in the runtime schema and tool
  definition (the provider's own limit, so the Limits rule allows it).
- T2 `bestOfN.ts:76` eager attempt materialization — FIX in this lane: build
  attempts lazily after the account/consent checks with a cancellation point
  per item; launches already pass through background resource admission.
- T3 `execArgs.ts:131` large budget vs ledger — FIX in this lane: drop the
  `Number.MAX_SAFE_INTEGER` ceiling in the ledger's `units()` so it supports
  the same range the parser accepts (BigInt throughout).
- T4 `rename.test.ts:17` invented fixtures — ANSWERED by `d3ef3d00fd`:
  the suite drives the real `mergePlacedEdits` with plain internal-type
  literals (no mocks, no stand-ins, no wire boundary), and was seen to fail
  with the old ceiling restored; there is no outside-world input here for
  the recorded-exchange rule to govern.
- T5 `promptCommands.ts:272` unbounded share filename — FIX in this lane:
  keep the title unlimited, bound the derived suggested filename to the
  platform's component limit where the save dialog default is built.
- T6 `mcpBridge.ts:642` duplicated check names — FIX in this lane:
  deduplicate the requested names before scheduling; distinct checks stay
  unbounded.

## Fixes (commits on `fix/nolimits-1-final-fix`)

- T1 (`e0f4e8af4f`): `editImageArgs` enforces Meta's own 1–10 range
  (`IMAGE_EDIT_SOURCE_MIN/MAX` in `src/shared/constants.ts`); the shared
  `EDIT_IMAGE_PARAMETERS` names one-to-ten with min/maxItems, so both the
  Model API tool and the `ide` tool refuse 0 and 11+ before any source is
  read or the paid-use question is asked. `imageArgs.test.ts` proves 10
  parses and 11 refuses (the old schema accepted 11); prompt length stays
  unbounded.
- T2 (`7f07354f1b`): `BestOfNRunner.start()` no longer pushes N entries up
  front. The run is registered empty, the account/budget/consent checks run,
  then the worktree loop materializes one attempt at a time with a
  cancellation point per item; launches still pass through background
  resource admission. No ceiling added, no new test (a `start()` test would
  need stand-ins for the coordinator/git/worktree deps, which policy
  forbids); verified by typecheck, eslint and build.
- T3 (`10a1951e63`): the ledger's `units()` holds micro-USD as BigInt with
  no ceiling — only negative refuses — matching the parser and `microUsd()`
  in `runExec.ts`. Extended the existing D121 tests: `9007199255` USD
  parses in `execArgs.test.ts` and admits with exact `capUsd`/`remainingUsd`
  in `runLedger.test.ts` (9,007,199,255,000,000 > 9,007,199,254,740,991, so
  the old ceiling refused it).
- T4 (answered, no change): `d3ef3d00fd` already covers it — see Triage.
- T5 (`bf1ffe8a06`): new pure `promptShareFilename()` in
  `src/shared/prompts.ts` keeps the title unlimited and cuts only the
  suggested filename component to 255 bytes on a UTF-8 boundary; the save
  dialog in `promptEntry.ts` uses it. `prompts.test.ts` proves short names
  are unchanged, 240 ASCII chars fit exactly, and multibyte titles (including
  a cut landing mid-sequence) stay valid and within budget.
- T6 (`570ef7dd84`): `bridgeRunChecks` deduplicates `names` before
  scheduling, keeping order; distinct checks stay unbounded. No new test
  (the call needs routing deps no real-code test can supply).

## Gates on the final tree (all exit 0)

- prettier `--check` on all 13 changed files: clean
- eslint `--max-warnings=0` on all changed src/test files: clean
- `npm run typecheck` (all five projects): 0
- `npm run check:plan`: 0 drift; `node scripts/check-l10n.mjs`: 0 problems
- `npm run build` (production + size/split/host-globals/notices): 0
- suites: `imageArgs` 4/4, `toolImages` 6/6, `runLedger` + `execArgs` 91/91,
  `prompts` 26/26, `bestOfN` 15/15, `rename` 2/2 — repo default timeout,
  no `--testTimeout`
- T2/T6 ship without new unit tests for the measured reason above (a test
  would need stand-ins for runner/routing deps, which policy forbids);
  covered by typecheck, eslint and build.
