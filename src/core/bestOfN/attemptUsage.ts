// Per-attempt reported spend (M77 C-M77-2, PLAN.md D49): the runner sums
// each attempt's validated per-response deltas so the run, the comparison
// and the take notice can show what that attempt reported. Reported cost is
// summed only from deltas that carry one; a delta without a reported cost
// marks the total partial instead of becoming an invented zero. Unknown HTTP
// tries are admission counts, never spend, and stay out of these totals.

import { modelApiPaidTier, type SubagentUsage } from '../../shared/paid'
import { sumUsd, type UsdAmount } from '../../shared/usd'
import { isValidTaskUsage } from '../paid/paidFeatures'

/** The spend one attempt has reported so far; absent fields mean none yet. */
export interface AttemptReportedUsage {
  readonly reportedInputTokens: number
  readonly reportedOutputTokens: number
  readonly reportedCostUsd?: UsdAmount | undefined
  readonly hasUnreportedCost: boolean
}

/**
 * Fold one validated per-response delta into an attempt's reported spend.
 * `previous` is the attempt record's own optional fields, so the runner
 * passes them straight through. Throws exactly where the window tally
 * would refuse the same delta: an unpriced model without a reported cost,
 * or invalid nonnegative counts.
 */
export function accumulateAttemptUsage(
  previous:
    | {
        readonly reportedInputTokens?: number | undefined
        readonly reportedOutputTokens?: number | undefined
        readonly reportedCostUsd?: UsdAmount | undefined
        readonly hasUnreportedCost?: boolean | undefined
      }
    | undefined,
  modelId: string,
  usage: SubagentUsage,
): AttemptReportedUsage {
  if (usage.costUsd === undefined && modelApiPaidTier(modelId) === undefined) {
    throw new Error('Cannot estimate best-of-N use for an unpriced model')
  }
  // One validity contract for both sides: an invalid delta throws in the
  // runner before either the attempt or the window tally records it.
  if (!isValidTaskUsage(usage)) {
    throw new Error('Best-of-N usage must be valid nonnegative token counts')
  }
  const beforeInput = previous?.reportedInputTokens ?? 0
  const beforeOutput = previous?.reportedOutputTokens ?? 0
  const beforeCost = previous?.reportedCostUsd
  const hasPartial = previous?.hasUnreportedCost ?? false
  const reported = usage.costUsd
  let total = beforeCost
  if (reported !== undefined) {
    total = beforeCost === undefined ? reported : sumUsd(beforeCost, reported)
  }
  return {
    reportedInputTokens: beforeInput + usage.inputTokens,
    reportedOutputTokens: beforeOutput + usage.outputTokens,
    ...(total !== undefined && { reportedCostUsd: total }),
    hasUnreportedCost: hasPartial || reported === undefined,
  }
}
