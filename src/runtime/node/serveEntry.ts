import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { serveNode, type ServeNodeOptions } from './serve'

/** N loads dist/nodeServe.js when serve starts, installing its own language table. */
export function runNodeServe(
  options: ServeNodeOptions,
  table: UiText,
  locale: string,
): Promise<void> {
  setUiText(table, locale)
  return serveNode(options)
}
