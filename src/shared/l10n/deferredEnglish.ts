// Production chat splits optional English from the canonical fallback.
// Source/test/independent-page tables already carry these values inline.
import { UI_TEXT } from './text'

function hasLoader(table: unknown): table is { loadDeferred: () => Promise<void> } {
  return (
    typeof table === 'object' &&
    table !== null &&
    'loadDeferred' in table &&
    typeof table.loadDeferred === 'function'
  )
}

export async function loadDeferredEnglish(): Promise<void> {
  const table: unknown = UI_TEXT
  if (hasLoader(table)) {
    await table.loadDeferred()
  }
}
