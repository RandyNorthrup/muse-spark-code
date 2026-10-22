// Best-of-N attempt text (M77 C-M77-2): the comparison's attempt line and
// the take notice, shared by host and webview so both name the same
// reported spend. Reported tokens always, reported cost only when the
// provider reported a complete one; a partial total says more is pending
// instead of stating a floor as the price.
// Shared by host and webview: no `vscode`, Node, or DOM imports.

import { UI_TEXT } from './constants'
import type { BestOfNAttempt, BestOfNRun } from './bestOfN'
import { formatUsd } from './l10n/exactUsd'
import { fill, formatNumber, plural } from './l10n/text'

/** One attempt's comparison line: requests, reported use, flags. */
export function bestOfNAttemptMeta(attempt: BestOfNAttempt): string {
  const parts = [plural(UI_TEXT.bestOfNRequests, attempt.requestsMade)]
  if (attempt.reportedInputTokens !== undefined) {
    const tokens = attempt.reportedInputTokens + (attempt.reportedOutputTokens ?? 0)
    parts.push(fill(UI_TEXT.agentTokens, { tokens: formatNumber(tokens) }))
    if (attempt.reportedCostUsd !== undefined) {
      parts.push(
        fill(
          attempt.hasUnreportedCost === true
            ? UI_TEXT.bestOfNAttemptCostPartial
            : UI_TEXT.bestOfNAttemptCost,
          { cost: formatUsd(attempt.reportedCostUsd) },
        ),
      )
    }
  }
  if (attempt.ceilingReached) {
    parts.push(UI_TEXT.bestOfNCeilingReached)
  }
  if (attempt.approvalsDenied > 0) {
    parts.push(plural(UI_TEXT.bestOfNApprovalsDenied, attempt.approvalsDenied))
  }
  if (attempt.status === 'failed' && attempt.failureReason !== undefined) {
    parts.push(fill(UI_TEXT.bestOfNAttemptFailed, { reason: attempt.failureReason }))
  }
  return parts.join(' · ')
}

/**
The take notice for a run: the taken attempt's reported use folds into
the originating conversation's view, with its reported cost only when
complete. Undefined while nothing is taken.
*/
export function bestOfNTakenNotice(run: BestOfNRun): string | undefined {
  const branch = run.takenBranch
  if (branch === undefined) {
    return undefined
  }
  const taken = run.runAttempts.find((attempt) => attempt.branch === branch)
  const tokens =
    taken?.reportedInputTokens === undefined
      ? undefined
      : taken.reportedInputTokens + (taken.reportedOutputTokens ?? 0)
  if (tokens === undefined) {
    return fill(UI_TEXT.bestOfNTaken, { branch })
  }
  const cost =
    taken?.reportedCostUsd !== undefined && taken.hasUnreportedCost !== true
      ? taken.reportedCostUsd
      : undefined
  // The slot carries its unit ("1,234 tokens"), as the comparison's
  // attempt line does; a bare count would not say what was used.
  const reportedUse = fill(UI_TEXT.agentTokens, { tokens: formatNumber(tokens) })
  if (cost === undefined) {
    return fill(UI_TEXT.bestOfNTakenSpend, { branch, tokens: reportedUse })
  }
  return fill(UI_TEXT.bestOfNTakenSpendCost, {
    branch,
    tokens: reportedUse,
    cost: formatUsd(cost),
  })
}
