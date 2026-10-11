import { UI_TEXT } from './constants'
import { fill, formatTokenWindow } from './l10n/text'

// The formatters' one home is `l10n/text`; the palette modules import them from here.
export { backendLabel, formatTokenWindow } from './l10n/text'

/** "200K context": a model's context window. */
export function contextWindowLabel(tokens: number): string {
  return fill(UI_TEXT.modelContextWindow, { tokens: formatTokenWindow(tokens) })
}
