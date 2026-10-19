import { EstimateDiagnosticError } from '../core/estimator/diagnostic'
import { estimateRefusalDetail, isEstimateRefusal } from '../shared/estimate'
import { estimateDiagnostic } from '../shared/estimateDiagnostic'
import { UI_TEXT } from '../shared/l10n/text'
import { estimateFailureText as estimateFailureSentence } from '../shared/estimateView'
import {
  collectEstimate,
  estimateFailureText,
  estimateSlashArguments,
  parseEstimateOptions,
  renderEstimate,
  type EstimateContext,
  type EstimateFormatPort,
  type EstimateRunPort,
} from '../runtime/estimator/command'

/** Agent imports this type only; W's lazy loader supplies the implementation. */
export interface AcpEstimatePort {
  readonly isAvailable?: boolean
  run(text: string, cwd: string, signal: AbortSignal): Promise<string>
}

export function createAcpEstimate(deps: {
  context(cwd: string): EstimateContext
  runner(cwd: string): EstimateRunPort
  readonly money: EstimateFormatPort
  /** Every plan problem for `/estimate --check-plan`; absent refuses the check. */
  checkPlan?(cwd: string, signal: AbortSignal): Promise<readonly string[]>
}): AcpEstimatePort {
  return {
    async run(text, cwd, signal) {
      const args = estimateSlashArguments(text)
      const parsed = args === undefined ? undefined : parseEstimateOptions(args)
      if (parsed === undefined || parsed.kind === 'invalid') return UI_TEXT.estimateUsage
      if (parsed.kind === 'help') return `${UI_TEXT.estimateUsage}\n${UI_TEXT.estimateCliHelp}`
      if (parsed.kind === 'check-plan') {
        if (deps.checkPlan === undefined)
          return estimateFailureText(new EstimateDiagnosticError('estimate-unavailable'))
        try {
          const problems = await deps.checkPlan(cwd, signal)
          return problems.join('\n')
        } catch (error: unknown) {
          signal.throwIfAborted()
          return estimateFailureText(error)
        }
      }
      try {
        const section = await collectEstimate(
          parsed.options,
          deps.context(cwd),
          deps.runner(cwd),
          signal,
        )
        return renderEstimate(section, parsed.options.format, deps.money)
      } catch (error: unknown) {
        // Cancellation stays cancellation (an abort throws past Error). The
        // estimator's own refusal stays its sentence for the agent; anything
        // else keeps its kind past the boundary (D119).
        if (signal.aborted) signal.throwIfAborted()
        // The validated property first: a refusal with its own message
        // (a cycle names its lanes) never matches a sentence template.
        // Then the worded message form. Either way the code is the
        // diagnostic, special sentences included, as on every surface.
        const validated = estimateDiagnostic(error)
        const refusal =
          validated.estimateDiagnostic === 'estimate-unavailable'
            ? (estimateRefusalDetail(error) ?? 'estimate-unavailable')
            : validated.estimateDiagnostic
        if (validated.estimateDiagnostic !== 'estimate-unavailable' || isEstimateRefusal(error)) {
          return estimateFailureSentence({ estimateDiagnostic: refusal })
        }
        throw error
      }
    },
  }
}
