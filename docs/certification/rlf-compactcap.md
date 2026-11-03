# RLF-COMPACTCAP — R2: compaction summary budget from the model (lane record)

Branch `rec/rlf-compactcap`, linuxlt rig, 2026-11-02. No `src/RLF-COMPACTCAP/*`
branches existed in the bare repo, so everything here is this lane's own
work; no merge, no live or paid model call (the brief requires none).

Research: the `pi-solpi-2026-11-02` paper was not on this rig, so the Pi
shape was verified against Pi itself at `earendil-works/pi` tag `v1.4.0`:
`generateSummary` keeps its reserve argument unused with the comment
"summaries use the model's output limit (#9512)". Pi #9075 records the
previous shape (`maxTokens = min(0.8 * reserveTokens, model.maxTokens)`)
and the failure it caused on reasoning models (thinking spend shares the
output budget, summaries stop on `length`). The port keeps Pi's remedy
(the model's own output limit) and adds the window-fit clamp the brief
orders, which Pi's provider layer does not do.

## What changed

- `src/core/backends/modelapi/autoCompact.ts`: new pure
  `compactionSummaryBudget({ policy, windowTokens, summaryInputTokens })`
  returning `max(providerMinimum, min(policy.output.maxTokens ??
COMPACTION_SUMMARY_MAX_TOKENS, windowTokens - summaryInputTokens))`.
  Only a record without an output limit keeps the fixed 8192.
- `src/core/backends/modelapi/ModelApiHost.ts`: the compaction request
  builder (`runCompaction`'s `makeBody`) measures its own fitted input
  with the send path's estimator (`estimateInput` over
  `media?.budgetParts(formatted) ?? requestParts(formatted)`) and sends
  the model budget above. A person-set output cap (`setOutputCap`, the
  `modelOutputMaxTokens` host seam, both validated as turns validate
  them) still binds through the new `personOutputCap`; the turn's
  default cap no longer shrinks a summary. The automatic-compaction
  cost estimate keeps its 8192 ceiling on purpose (an expected-size
  estimate, not the request's limit; raising it would price the first
  cost decision out of existence). Retry behaviour is untouched.
- `src/shared/constants.ts`: the 8192 constant keeps its name and value;
  its comment now says it is the unknown-record fallback and the
  economics estimate's ceiling.
- Goldens `test/fixtures/golden-requests/05-manual-compaction.json` and
  `strict/05-manual-compaction.json`: request 1 (the summary request)
  re-baselined `max_output_tokens` 8192 → 131072 (Meta muse-spark-1.3:
  record limit 131072, window 1048576, recorded input 11048). A
  character-level diff of each file shows exactly that one number
  changed, in the `max_output_tokens` position.

## Tests (real code only)

`test/unit/autoCompact.test.ts`, new `describe` block, three tests:

1. A reasoning model row yields output budget > 8192: the real
   `modelPolicyFor('muse-spark-1.3-contributor')` (reasoning affirmed,
   output limit 131072) over the real recorded summary input (11048
   tokens measured from golden 05 request 1 with the real estimator)
   budgets exactly 131072, and input plus budget fit the real
   1048576 window.
2. A small-window row clamps instead of overflowing: a real
   `createConfiguredProviderServices` registry resolves
   `compact/small` with record limits 32768/24576; the budget is
   exactly window minus input (21720), under the record's own output
   limit, with input plus budget equalling the window.
3. The legacy cap survives only for unknown records:
   `modelPolicyFor('compact/unlisted-limits')` (no output limit)
   budgets exactly `COMPACTION_SUMMARY_MAX_TOKENS`.

`test/unit/helpers/recordedFunctionTool.ts` (new): the recorded
function-tool schema shared by the golden parser above and
`test/unit/chatgptResponsesCodec.test.ts`, whose identical inline
schema it replaces with no behaviour change (the duplication gate
flagged the pair; it now reports 0 clones).

## Red/green drill

With `compactionSummaryBudget` temporarily restored to the fixed cap
(the `options.policy.output.maxTokens ??` operand removed), test 1
fails: `expected 8192 to be 131072`, `npx vitest run
test/unit/autoCompact.test.ts -t 'reasoning model'` exits 1 (1 failed,
27 skipped). Reverted; the file is green again (28 passed).

## Gates (final tree, exit codes)

- prettier --check on touched files: 0
- eslint --max-warnings 0 on touched files: 0
- npm run typecheck (all projects): 0
- node scripts/check-l10n.mjs: 0 (0 problems)
- npm run check:reference: 0
- npm run check:host-api: 0 (0 problems)
- npm run check:plan: 0 (0 drift)
- npm run check:roadmap: 0 (current)
- npm run check:catches: 0 (baseline matches; no new catch)
- npm run duplication: 0 (0 clones)
- npm run cycles: 0 (no circular dependency)
- npm run deadcode: 0
- npm run build: 0 (budgets hold)
- npm run security:audit: 0 (2 advisories, 0 exceptions)
- npm run security:sast: 0 (699 rules on 6020 files, 0 findings)
- vitest related autoCompact.ts: 0 (57 files, 502 passed, 8 skipped)
- vitest related ModelApiHost.ts: 0 (56 files, 460 passed, 8 skipped)
- vitest metaRequestGoldens: 0 (8 passed)
- vitest related constants.ts: scoped out — the change there is a
  comment only, and the file is imported across the product, so its
  related set is the whole battery, which the shared machines do not
  run locally; typecheck, lint and the targeted suites above cover it.

No UI change (no ui:look), no new reference surface, no l10n change,
no live call.
