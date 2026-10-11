import * as z from 'zod/mini'
import { redactSecrets } from '../redact'
import { fill, UI_TEXT } from '../../shared/l10n/text'

/** Pure validation allocation: bundles using only the error type omit the renderer. */
const diagnosticSchema = /* @__PURE__ */ (() => {
  /** Closed application codes; payload characters and secrets are checked separately. */
  const DIAGNOSTIC_CODES = new Set(
    [
      'account-selection-limit advice-only catalog-options conflictingCiHistory conflictingEngineHistory conflictingHistory conflictingLaneIdentity conflictingReviewHistory cost-overflow coupled-resources',
      'cycle dispatch-uncertain duplicate-lane duplicate-price duplicateHistoryLane duration-class duration-coverage duration-model-overflow duration-overflow endpoint-refused',
      'estimate-unavailable forecast-quantiles help historyCleanupFailed historyIdentityMismatch historyReadFailed historyRecordTooLarge historySourceUnavailable historyWriteFailed invalid-distribution',
      'invalid-duration invalid-duration-evidence invalid-duration-model invalid-input invalid-lane invalid-lane-finished invalid-snapshot invalid-model-evidence invalidBaseAge invalidCalibrationQuery invalidEngine invalidHistory',
      'invalidHistoryFile invalidHistoryLane invalidHistorySource invalidReviewState invalidSnapshot lane-limit malformed-starts merged-duration minimum-duration missing-associations',
      'missing-boundary missing-dependency missing-estimate missing-fit missing-infeasibility-reason missing-lane missing-node missing-plan missing-selection missing-slot',
      'missing-trial mixedHistoryBasis model-identity model-limit no-capacity no-feasible-setup nonrelative-file plan-drift pool-as-of pool-changes-existing-resources',
      'pool-changes-shared-resources prerequisite-audit prerequisites price-machine price-provenance quota-horizon recommendation-search-limit rental-class-mismatch request-mismatch review-horizon',
      'running schedule-cycle schedule-date-overflow self-dependency snapshot-asOf source-incomplete source-unavailable source-waiting unknown-capacity unknown-demand',
      'unknown-duration-model unknown-goal unknown-os-architecture unknown-prerequisite unknown-release-member unknown-review-modules unknown-rig unknownHistoryBasis unknownHistoryVersion unschedulable',
      'unsupported-platform usage',
    ]
      .join(' ')
      .split(' '),
  )

  return z.string().check(
    z.regex(/^[\w .,:;-]+$/),
    z.refine((detail) =>
      detail.split(';').every((part) => DIAGNOSTIC_CODES.has(part.split(':', 1)[0]?.trim() ?? '')),
    ),
    z.refine((detail) => redactSecrets(detail) === detail),
  )
})()

/** Application refusals retain their identity across independently loaded bundles. */
export class EstimateDiagnosticError extends Error {
  constructor(
    public readonly estimateDiagnostic: string,
    message?: string,
  ) {
    super(message ?? fill(UI_TEXT.estimateFailed, { detail: estimateDiagnostic }))
  }
}

/** Render at the consumer's installed language; never expose an Error's raw message. */
export function estimateFailureText(error: unknown): string {
  const parsed = diagnosticSchema.safeParse(
    typeof error === 'object' && error !== null && 'estimateDiagnostic' in error
      ? error.estimateDiagnostic
      : undefined,
  )
  if (!parsed.success) return fill(UI_TEXT.estimateFailed, { detail: 'estimate-unavailable' })
  if (parsed.data === 'usage') return UI_TEXT.estimateUsage
  if (parsed.data === 'help') return `${UI_TEXT.estimateUsage}\n${UI_TEXT.estimateCliHelp}`
  return parsed.data === 'advice-only'
    ? UI_TEXT.estimateAdvice
    : fill(UI_TEXT.estimateFailed, { detail: parsed.data })
}

/** Preserve application refusals while replacing external errors with a fixed code. */
export function asEstimateDiagnostic(error: unknown, detail: string): EstimateDiagnosticError {
  return error instanceof EstimateDiagnosticError ? error : new EstimateDiagnosticError(detail)
}

/** Zod's input details can contain paths/content; schema refusals use a fixed code. */
export function parseEstimate<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new EstimateDiagnosticError('invalid-input')
  return parsed.data
}
