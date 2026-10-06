import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { runPanel, type RunPanelDeps } from './runPanel'

export async function runRuntimePanel(
  deps: RunPanelDeps,
  table: UiText,
  locale: string,
): Promise<number> {
  setUiText(table, locale)
  return await runPanel(deps)
}
