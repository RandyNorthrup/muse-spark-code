import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { runPanel, type RunPanelDeps } from './runPanel'
import { acpConversationFactory, type AcpCompositionOptions } from './acpComposition'

// Headless exec takes its registry from this lazy bundle, not dist/headless.js.
export { ControllerRegistry } from './controllerRegistry'

export function createAcpConversations(deps: AcpCompositionOptions, table: UiText, locale: string) {
  setUiText(table, locale)
  return acpConversationFactory(deps)
}

export async function runRuntimePanel(
  deps: RunPanelDeps,
  table: UiText,
  locale: string,
): Promise<number> {
  setUiText(table, locale)
  return await runPanel(deps)
}
