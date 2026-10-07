// M102's UsageApp supplies this factory to React.lazy inside its usage surface.
import { loadDeferredEnglish } from '../../shared/l10n/deferredEnglish'

export async function loadAccountsSection() {
  await loadDeferredEnglish()
  return await import('./AccountsSection')
}
