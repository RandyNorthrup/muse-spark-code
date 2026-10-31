// Separate lazy host bundle. W supplies protected engine callbacks and U's UI.
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { createVscodeMakerHost, type VscodeMakerDeps } from '../vscode/maker/vscodeMakerHost'
import type { MakerPreviewPanelDeps } from '../vscode/maker/makerPreviewPanel'
import { MakerCommands, type MakerCommandsDeps } from '../vscode/maker/makerCommands'
import { ideMakerTools, type IdeMakerToolsDeps } from '../ide/makerTools'

export async function createMakerHost(deps: VscodeMakerDeps, table: UiText, locale: string) {
  setUiText(table, locale)
  return await createVscodeMakerHost(deps)
}
export async function createMakerPreviewPanel(deps: MakerPreviewPanelDeps) {
  const preview = await import('./makerPreviewEntry')
  return preview.createPreviewPanel(deps)
}
export function createMakerCommands(deps: MakerCommandsDeps, table: UiText, locale: string) {
  setUiText(table, locale)
  return new MakerCommands(deps)
}
export function createMakerTools(deps: IdeMakerToolsDeps, table: UiText, locale: string) {
  setUiText(table, locale)
  return ideMakerTools(deps)
}
