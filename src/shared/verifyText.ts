// The verify loop's words for the user (M68, PLAN.md D49), shared by the
// transcript's rows and the Markdown export so both say the same (the M68
// review): the line under a "Check edits" or "Run checks" row, and how an
// edit's `then_run` ended. Shared by host and webview: no `vscode`, Node or
// DOM imports.

import type { ThenRunResult, VerifySummary } from './agentEvents'
import { UI_TEXT } from './constants'
import { fill, formatNumber, plural } from './l10n/text'

const PART_SEPARATOR = ' · '
const DETAIL_SEPARATOR = ': '

/**
 * "2 errors, 1 warning · 1 file not checked · lint failed · test passed", or
 * undefined for nothing to say. Errors and warnings count only the files
 * whose diagnostics were read.
 */
export function verifySummaryText(summary: VerifySummary | undefined): string | undefined {
  if (summary === undefined) {
    return undefined
  }
  const parts: string[] = []
  const { errors, warnings, unchecked } = summary
  if (errors !== undefined && warnings !== undefined) {
    parts.push(
      errors === 0 && warnings === 0
        ? UI_TEXT.verifyClean
        : `${plural(UI_TEXT.verifyErrors, errors)}, ${plural(UI_TEXT.verifyWarnings, warnings)}`,
    )
  }
  if (unchecked !== undefined && unchecked > 0) {
    parts.push(plural(UI_TEXT.verifyUnchecked, unchecked))
  }
  for (const check of summary.checks) {
    parts.push(fill(UI_TEXT.checkOutcomes[check.outcome], { name: check.name }))
  }
  return parts.length === 0 ? undefined : parts.join(PART_SEPARATOR)
}

/** How a `then_run` command ended, in words: never "Stopped" for one that failed. */
export function thenRunOutcomeText(result: ThenRunResult): string {
  switch (result.outcome) {
    case 'notRun': {
      const reason = result.skip === undefined ? '' : UI_TEXT.checkSkips[result.skip]
      return fill(UI_TEXT.thenRunNotRun, {
        reason:
          result.detail === undefined ? reason : `${reason}${DETAIL_SEPARATOR}${result.detail}`,
      })
    }
    case 'timedOut': {
      return UI_TEXT.thenRunTimedOut
    }
    case 'cancelled': {
      return UI_TEXT.toolStopped
    }
    case 'passed':
    case 'failed': {
      return result.exitCode === undefined
        ? UI_TEXT.thenRunNoExitCode
        : fill(UI_TEXT.userShellExitCode, { code: formatNumber(result.exitCode) })
    }
  }
}
