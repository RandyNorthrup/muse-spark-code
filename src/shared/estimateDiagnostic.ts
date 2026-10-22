import * as z from 'zod/mini'
import { estimateSectionSchema, type EstimateRequest } from './estimate'
import {
  estimateFailureText as renderFailure,
  type EstimateDiagnostic,
  type EstimateViewState,
} from './estimateView'
export type { EstimateDiagnostic, EstimateViewState } from './estimateView'
import { redactSecrets } from './redact'
import { fill, UI_TEXT } from './l10n/text'

export const ESTIMATE_DIAGNOSTIC_CODES = /* @__PURE__ */ (() =>
  [
    'account-selection-limit advice-only catalog-options conflictingCiHistory conflictingEngineHistory conflictingHistory conflictingLaneIdentity conflictingReviewHistory cost-overflow coupled-resources',
    'cycle dispatch-uncertain duplicate-lane duplicate-price duplicateHistoryLane duration-class duration-coverage duration-model-overflow duration-overflow endpoint-refused',
    'estimate-credential-changed estimate-unavailable fleet-account-blocked fleet-account-invalid fleet-binding-invalid fleet-caps-invalid fleet-ci-invalid forecast-quantiles help historyCleanupFailed historyIdentityMismatch historyReadFailed historyRecordTooLarge historySourceUnavailable historyWriteFailed invalid-distribution',
    'invalid-duration invalid-duration-evidence invalid-duration-model invalid-input invalid-lane invalid-lane-finished invalid-snapshot invalid-model-evidence invalidBaseAge invalidCalibrationQuery invalidEngine invalidHistory',
    'invalidHistoryFile invalidHistoryLane invalidHistorySource invalidReviewState invalidSnapshot lane-limit malformed-starts merged-duration minimum-duration missing-associations',
    'missing-boundary missing-dependency missing-estimate missing-fit missing-infeasibility-reason missing-lane missing-machine missing-node missing-plan missing-selection missing-slot',
    'missing-trial mixedHistoryBasis model-identity model-limit no-capacity no-feasible-setup nonrelative-file plan-drift pool-as-of pool-changes-existing-resources',
    'pool-changes-shared-resources prerequisite-audit prerequisites price-machine price-provenance quota-horizon recommendation-search-limit rental-class-mismatch request-mismatch review-horizon',
    'running schedule-cycle schedule-date-overflow self-dependency snapshot-asOf source-incomplete source-unavailable source-waiting unknown-capacity unknown-demand',
    'unknown-duration-model unknown-goal unknown-os-architecture unknown-prerequisite unknown-release-member unknown-review-modules unknown-rig unknownHistoryBasis unknownHistoryVersion unschedulable',
    'unsupported-platform usage',
    'catalog-egress-refused catalog-paged catalog-redirect-refused catalog-unavailable fact-source-invalid invalid-catalog invalid-clock invalid-decimal invalid-provision-clock provision unknown-catalog',
  ]
    .join(' ')
    .split(' '))()

/** Pure validation allocation: bundles using only the error type omit the renderer. */
export const estimateDiagnosticSchema = /* @__PURE__ */ (() => {
  /** Closed application codes; payload characters and secrets are checked separately. */
  const DIAGNOSTIC_CODES = new Set(ESTIMATE_DIAGNOSTIC_CODES)

  return z.strictObject({
    estimateDiagnostic: z.string().check(
      z.regex(/^[\w .,:;-]+$/),
      z.refine((detail) =>
        detail
          .split(';')
          .every((part) => DIAGNOSTIC_CODES.has(part.split(':', 1)[0]?.trim() ?? '')),
      ),
      z.refine((detail) => redactSecrets(detail) === detail),
    ),
  })
})()

/** Application refusals retain their identity across independently loaded bundles. */
export class EstimateDiagnosticError extends Error {
  constructor(
    public readonly estimateDiagnostic: string,
    message?: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message ?? fill(UI_TEXT.estimateFailed, { detail: estimateDiagnostic }), options)
  }
}

/** Only validated application data travels to a surface; external messages stay private. */
export function estimateDiagnostic(error: unknown): EstimateDiagnostic {
  const parsed = estimateDiagnosticSchema.safeParse(
    typeof error === 'object' && error !== null && 'estimateDiagnostic' in error
      ? { estimateDiagnostic: error.estimateDiagnostic }
      : undefined,
  )
  return parsed.success ? parsed.data : { estimateDiagnostic: 'estimate-unavailable' }
}

/** A failed view cannot contain the previous forecast. */
export function failedEstimate(error: unknown): EstimateViewState {
  return { status: 'failed', diagnostic: estimateDiagnostic(error) }
}

/** Normalize external errors before calling the single installed-language renderer. */
export function estimateFailureText(error: unknown): string {
  return renderFailure(estimateDiagnostic(error))
}

/** Preserve application refusals while replacing external errors with a fixed code. */
export function asEstimateDiagnostic(error: unknown, detail: string): EstimateDiagnosticError {
  if (error instanceof EstimateDiagnosticError) return error
  return new EstimateDiagnosticError(
    typeof error === 'object' &&
      error !== null &&
      'estimateDiagnostic' in error &&
      typeof error.estimateDiagnostic === 'string'
      ? error.estimateDiagnostic
      : detail,
  )
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

/** Normalize one adapter result into the shared view state, before any surface uses it. */
export async function collectEstimateView(
  request: EstimateRequest,
  run: () => Promise<unknown>,
  signal: AbortSignal,
): Promise<EstimateViewState> {
  const expected = JSON.stringify(request)
  const isCurrent = () => !signal.aborted
  try {
    const value = await run()
    if (!isCurrent()) return { status: 'idle' }
    if (typeof value === 'object' && value !== null && 'estimateDiagnostic' in value) {
      return failedEstimate(value)
    }
    const parsed = estimateSectionSchema.safeParse(value)
    if (!parsed.success)
      return { status: 'failed', diagnostic: { estimateDiagnostic: 'invalid-input' } }
    if (
      parsed.data.currentRefusal !== undefined &&
      !estimateDiagnosticSchema.safeParse({ estimateDiagnostic: parsed.data.currentRefusal })
        .success
    )
      return { status: 'failed', diagnostic: { estimateDiagnostic: 'invalid-input' } }
    return JSON.stringify(parsed.data.inputs.request) === expected
      ? { status: 'showing', section: parsed.data }
      : { status: 'failed', diagnostic: { estimateDiagnostic: 'request-mismatch' } }
  } catch (error: unknown) {
    // A cancelled run stays silent. Any other failure reaches the panel's
    // run boundary, which says it in words and keeps a foreign failure's
    // kind past the panel through the port's report (D207).
    if (!isCurrent() || (error instanceof DOMException && error.name === 'AbortError'))
      return { status: 'idle' }
    throw error
  }
}
