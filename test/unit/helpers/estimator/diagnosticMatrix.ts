import { fill, UI_TEXT } from '../../../../src/shared/l10n/text'
import { ESTIMATE_DIAGNOSTIC_CODES } from '../../../../src/shared/estimateDiagnostic'

/** Every registered application diagnostic, crossed with every consumer below. */
export const ESTIMATE_DIAGNOSTIC_CASES = ESTIMATE_DIAGNOSTIC_CODES.map((code) => ({
  code,
  diagnostic: { estimateDiagnostic: code },
}))

/** Adding a renderer consumer requires a new matrix column and its real adapter test. */
export const ESTIMATE_SURFACES = {
  cli: 'src/runtime/estimator/command.ts',
  acp: ['src/acp/estimate.ts', 'src/acp/agent.ts'],
  transcript: 'src/host/conversation/conversationController.ts',
  session: 'src/runtime/estimator/session.ts',
  card: 'src/webview/estimator/EstimatorPanel.tsx',
  terminal: 'src/runtime/estimator/session.ts',
} as const

/** Independent localized sentence oracle: a named refusal must never become unavailable. */
export function diagnosticSentence(code: string): string {
  const special = new Map([
    ['usage', UI_TEXT.estimateUsage],
    ['help', `${UI_TEXT.estimateUsage}\n${UI_TEXT.estimateCliHelp}`],
    ['advice-only', UI_TEXT.estimateAdvice],
  ])
  return special.get(code) ?? fill(UI_TEXT.estimateFailed, { detail: code })
}
