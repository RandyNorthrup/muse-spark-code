import type { UiText } from '../l10n/en'
import type { ReferenceText } from '../featureCatalog'
import type { ReferenceModel } from './types'

export function referenceText(
  ref: ReferenceText,
  model: ReferenceModel,
  nls: Readonly<Record<string, string>>,
  table: UiText,
): string {
  if ('ui' in ref) return table[ref.ui]
  if ('tip' in ref) return table.paletteTips[ref.tip]
  if ('command' in ref) {
    const command = model.commands.find((entry) => entry.id === ref.command)
    return command?.nameKey === undefined
      ? (command?.name ?? ref.command)
      : (nls[command.nameKey] ?? command.name)
  }
  const setting = model.settings.find((entry) => entry.id === `museSpark.${ref.setting}`)
  return setting?.descriptionKey === undefined
    ? (setting?.description ?? ref.setting)
    : (nls[setting.descriptionKey] ?? setting.description)
}

export function referenceName(
  ref: ReferenceText,
  model: ReferenceModel,
  nls: Readonly<Record<string, string>>,
  table: UiText,
): string {
  return 'setting' in ref ? `museSpark.${ref.setting}` : referenceText(ref, model, nls, table)
}
