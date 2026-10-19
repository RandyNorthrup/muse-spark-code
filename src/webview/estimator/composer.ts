import {
  estimateRefusalDetail,
  estimateRequestSchema,
  isEstimateRefusal,
  type EstimateRequest,
} from '../../shared/estimate'
import { fill, UI_TEXT } from '../../shared/l10n/text'
import { estimateSlashArguments, parseEstimateOptions } from '../../runtime/estimator/command'

/** Bind before normal submit dispatch in every shared-webview host. */
export function wasEstimateComposerHandled(
  text: string,
  port: {
    context(): Pick<EstimateRequest, 'asOf' | 'optimize'>
    open(request: EstimateRequest): void
    notice(text: string): void
  },
): boolean {
  const args = estimateSlashArguments(text)
  if (args === undefined) return false
  const parsed = parseEstimateOptions(args)
  if (parsed.kind !== 'estimate') {
    port.notice(
      parsed.kind === 'help'
        ? `${UI_TEXT.estimateUsage}\n${UI_TEXT.estimateCliHelp}`
        : parsed.reason,
    )
    return true
  }
  try {
    port.open(
      estimateRequestSchema.parse({
        ...port.context(),
        goal: parsed.options.goal,
        fleet: parsed.options.fleet,
        ...(parsed.options.deadline && { deadline: parsed.options.deadline }),
        ...(parsed.options.seed && { seed: parsed.options.seed }),
      }),
    )
  } catch (error: unknown) {
    // An unopenable estimator reads failed in its own refusal's words;
    // anything else reads failed, and keeps its kind past the composer for
    // the host log (D119).
    if (isEstimateRefusal(error)) {
      const refusal = estimateRefusalDetail(error)
      port.notice(fill(UI_TEXT.estimateFailed, { detail: refusal ?? 'estimator-unavailable' }))
      return true
    }
    port.notice(fill(UI_TEXT.estimateFailed, { detail: 'estimator-unavailable' }))
    throw error
  }
  return true
}
