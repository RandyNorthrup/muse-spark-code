import type { UiText } from '../l10n/en'
import type { ReferenceText } from '../featureCatalog'
import type { ReferenceModel } from './types'

export function referenceText(
  ref: ReferenceText,
  model: ReferenceModel,
  nls: Readonly<Record<string, string>>,
  table: UiText,
): string {
  if ('cli' in ref) return table.referenceCliOptions[ref.cli]
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

/** Translate nested schema annotations while retaining structural values. */
export function referenceSchema(value: unknown, nls: Readonly<Record<string, string>>): unknown {
  if (Array.isArray(value)) return value.map((entry: unknown) => referenceSchema(entry, nls))
  if (typeof value !== 'object' || value === null) return value
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([key]) => !key.endsWith('Key'))
      .map(([key, entry]) => {
        const annotation = fields[`${key}Key`]
        return [
          key,
          typeof annotation === 'string' ? (nls[annotation] ?? entry) : referenceSchema(entry, nls),
        ]
      }),
  )
}
