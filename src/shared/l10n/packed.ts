// Packaged tables omit repeated keys; English owns the stable sorted layout.
// Translation sources remain complete tables checked before packaging.
import * as z from 'zod/mini'
import { EN } from './en'
import { isPluralForms } from './forms'

const packedSchema = z.strictObject({ format: z.literal(1), values: z.array(z.unknown()) })

export function unpackUiTable(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('format' in value)) return value
  const packed = packedSchema.parse(value)
  let index = 0
  function restore(reference: unknown): unknown {
    if (typeof reference !== 'object' || reference === null || isPluralForms(reference)) {
      if (index >= packed.values.length) throw new Error('Truncated localization table')
      const entry = packed.values[index]
      index += 1
      return entry
    }
    return Object.fromEntries(
      Object.entries(reference)
        .toSorted(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([key, entry]) => [key, restore(entry)]),
    )
  }
  const table = restore(EN)
  function assertComplete(): void {
    if (index !== packed.values.length) throw new Error('Unexpected localization entries')
  }
  assertComplete()
  return table
}
