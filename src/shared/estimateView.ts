import type { EstimateSection } from './estimate'
import { fill, UI_TEXT } from './l10n/text'

/** Validated portable application data; no external Error message is carried. */
export interface EstimateDiagnostic {
  readonly estimateDiagnostic: string
}

/** The only estimate display state, shared by browser, session and terminal. */
export type EstimateViewState =
  | { readonly status: 'idle' | 'loading' }
  | { readonly status: 'showing'; readonly section: EstimateSection }
  | { readonly status: 'failed'; readonly diagnostic: EstimateDiagnostic }
/** Render at the consumer's installed language; never expose an Error's raw message. */
export function estimateFailureText(diagnostic: EstimateDiagnostic): string {
  const { estimateDiagnostic: detail } = diagnostic
  if (detail === 'usage') return UI_TEXT.estimateUsage
  if (detail === 'help') return `${UI_TEXT.estimateUsage}\n${UI_TEXT.estimateCliHelp}`
  return detail === 'advice-only'
    ? UI_TEXT.estimateAdvice
    : fill(UI_TEXT.estimateFailed, { detail })
}
