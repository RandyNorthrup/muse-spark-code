import { estimateRefusalDetail, isEstimateRefusal } from '../shared/estimate'
import { fill, UI_TEXT } from '../shared/l10n/text'
import {
  collectEstimate,
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
}): AcpEstimatePort {
  return {
    async run(text, cwd, signal) {
      const args = estimateSlashArguments(text)
      const parsed = args === undefined ? undefined : parseEstimateOptions(args)
      if (parsed === undefined || parsed.kind === 'invalid') return UI_TEXT.estimateUsage
      if (parsed.kind === 'help') return `${UI_TEXT.estimateUsage}\n${UI_TEXT.estimateCliHelp}`
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
        if (isEstimateRefusal(error)) {
          const refusal = estimateRefusalDetail(error)
          return fill(UI_TEXT.estimateFailed, { detail: refusal ?? 'estimate-unavailable' })
        }
        throw error
      }
    },
  }
}
