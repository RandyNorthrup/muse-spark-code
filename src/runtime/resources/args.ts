import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { resourceSettingsSchema, type ResourceSettings } from '../../shared/resources'

/** Flags are overrides, not defaults: omitted fields retain the machine's values. */
export function resourceFlagOverrides(
  values: Readonly<Record<string, unknown>>,
): Partial<ResourceSettings> {
  const overrides: Partial<ResourceSettings> = {}
  for (const [flag, key] of [
    ['cpu-max', 'cpuMaxPercent'],
    ['memory-max', 'memoryMaxPercent'],
  ] as const) {
    const value = values[flag]
    if (value === undefined) {
      continue
    }

    if (typeof value !== 'string' || value.trim() === '')
      throw new Error(fill(UI_TEXT.acpUnknownArgument, { argument: `--${flag}` }))
    overrides[key] = Number(value)
  }
  const toggle = values['resource-governor']
  if (toggle !== undefined) {
    if (toggle !== 'on' && toggle !== 'off')
      throw new Error(fill(UI_TEXT.acpUnknownArgument, { argument: '--resource-governor' }))
    overrides.enabled = toggle === 'on'
  }
  if (!resourceSettingsSchema.safeParse(overrides).success)
    throw new Error(UI_TEXT.execNumberInvalid)
  return overrides
}
