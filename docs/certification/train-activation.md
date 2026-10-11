# TRAINACT release-train activation repair

Rig: macmini, 2026-10-11. Base: `d36f5fa2d4`; branch:
`fix/train-activation`. No subagents, network/model calls, installs, merge,
push, cap, baseline, allow-list or localization changes. Aggregate quality
belongs to the lead under the explicit rig/common brief; PLAN §7 records
that scope. AGENTS rule 10 requires an Unreleased engineering note despite
no user-visible change. No new chunk.

## First cut: automatic-compaction admission

Move the admission constructor and model reader to `modelApiEntry.ts`,
behind existing `dist/modelApi.js`, instead of retaining the admission in
activation with two injected helpers. This removes the full admission and
its cost-model dependency from both manager callers. `modelPolicy` supplies
image counting in the backend; the first prepared attempt loads existing
`dist/providers.js` for exact price-card reservation. A missing pricing port
refuses before consent; absent/failed pricing refuses before reservation.
Authorization is checked again after the new async load.

| Step                       | Baseline | Current | Growth before | Growth after |
| -------------------------- | -------: | ------: | ------------: | -----------: |
| Train base                 |  561,352 | 571,429 |             — |       10,077 |
| Admission behind Model API |  561,352 | 566,730 |        10,077 |        5,378 |

Production build passes all size rows, split, host globals and notices.
The unchanged budget test still fails at 5,378; the second cut is pending.
Owning suites: admission/manager 50 passed; modelApiAutoCompact,
runtimeAccounting, autoCompactionBundle 79 passed at repository timeouts.
Host typecheck and changed-file ESLint pass.

### Red drills

1. Remove the missing-port early refusal: the new regression
   `refuses a missing pricing dependency before consent or reservation`
   fails (an admission object is returned), with 24 other tests passing.
   Restore SHA-256
   `7edcddff6bfaa3fb4dbd40ef884c18f39d191e22cc43b4b5752d05e190b828c3`.
2. Put the admission's two imports and calls back to direct value imports;
   run the actual production build and split checker. Exact failure and
   byte-exact restoration receipt follow below.

   ```text
   bundle split: 2 problem(s); see PLAN.md D6 and M57
     dist/modelApi.js carries src/core/providers/priceCard.ts, which loads only in dist/providers.js
     dist/modelApi.js carries src/core/providers/priceCard.ts, which loads only in dist/providers.js
   ```

   Restored the same admission SHA-256 as drill 1 byte for byte.
