import { createRequire } from 'node:module'
import type { core, ZodMiniType } from 'zod/mini'
import type * as SchemaWriter from './validationSchemaEntry'

// This callable same-build export is checked before use (PLAN §8).
function isSchemaWriter(value: unknown): value is typeof SchemaWriter {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toJSONSchema' in value &&
    typeof value.toJSONSchema === 'function'
  )
}

/** The parser stays small; conversion loads only when a caller requests it. */
export function toJSONSchema(schema: ZodMiniType, params?: core.ToJSONSchemaParams) {
  const writer: unknown = createRequire(__filename)('./validationSchema.js')
  if (!isSchemaWriter(writer)) throw new Error('validation-schema-unavailable')
  return writer.toJSONSchema(schema, params)
}
