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
      } catch {
        signal.throwIfAborted()
        return fill(UI_TEXT.estimateFailed, { detail: 'estimate-unavailable' })
      }
    },
  }
}
