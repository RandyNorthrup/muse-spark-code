// MCP 2025-06-18, the revision negotiated by this client:
// https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation
// Only flat primitive forms are offered. No values enter logs or events.
import * as z from 'zod/mini'
import type { ElicitationField } from '../../../../shared/agentEvents'
import { McpError } from './protocol'

const annotations = { title: z.optional(z.string()), description: z.optional(z.string()) }
const lengthSchema = z.int().check(z.minimum(0))
const primitiveSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('string'),
    ...annotations,
    minLength: z.optional(lengthSchema),
    maxLength: z.optional(lengthSchema),
    format: z.optional(z.enum(['email', 'uri', 'date', 'date-time'])),
    enum: z.optional(z.array(z.string()).check(z.minLength(1))),
    enumNames: z.optional(z.array(z.string())),
    default: z.optional(z.string()),
  }),
  z.strictObject({
    type: z.enum(['number', 'integer']),
    ...annotations,
    minimum: z.optional(z.number()),
    maximum: z.optional(z.number()),
    default: z.optional(z.number()),
  }),
  z.strictObject({ type: z.literal('boolean'), ...annotations, default: z.optional(z.boolean()) }),
])
const formSchema = z.strictObject({
  type: z.literal('object'),
  ...annotations,
  properties: z.record(z.string(), z.unknown()),
  required: z.optional(z.array(z.string())),
})
const paramsSchema = z.object({
  mode: z.optional(z.string()),
  message: z.string(),
  requestedSchema: z.optional(z.unknown()),
})
const outcomeSchema = z.object({
  action: z.enum(['accept', 'decline', 'cancel']),
  content: z.optional(z.nullable(z.record(z.string(), z.unknown()))),
})
export type ElicitationOutcome = z.infer<typeof outcomeSchema>
export type McpElicitationHandler = (request: {
  readonly params: unknown
  readonly signal: AbortSignal
}) => Promise<ElicitationOutcome>

export function checkElicitationOutcome(outcome: unknown): ElicitationOutcome {
  const parsed = outcomeSchema.safeParse(outcome)
  if (!parsed.success) {
    throw new McpError('the elicitation answer is not accept, decline or cancel')
  }
  return parsed.data.action === 'accept'
    ? { action: 'accept', content: { ...parsed.data.content } }
    : { action: parsed.data.action }
}

export interface ParsedElicitation {
  readonly message: string
  readonly requestedSchema: unknown
}

export function parseElicitationParams(raw: unknown): ParsedElicitation {
  const parsed = paramsSchema.safeParse(raw)
  if (!parsed.success || parsed.data.message.trim() === '') {
    throw new McpError('elicitation/create was sent without a message and a schema')
  }
  const { mode, message, requestedSchema } = parsed.data
  if (mode !== undefined && mode !== 'form') {
    throw new McpError(
      mode === 'url'
        ? 'elicitation/create asked for a browser flow (url mode), which this client does not show'
        : 'elicitation/create asked for an unknown mode',
    )
  }
  if (requestedSchema === undefined) {
    throw new McpError('elicitation/create was sent without a message and a schema')
  }
  return { message, requestedSchema }
}

export type ElicitationSchemaCheck =
  | { readonly ok: true; readonly fields: readonly ElicitationField[] }
  | { readonly ok: false; readonly reason: string }

/** Schema keywords come from the negotiated spec, not a general JSON Schema validator. */
export function validateElicitationSchema(schema: unknown): ElicitationSchemaCheck {
  const parsed = formSchema.safeParse(schema)
  if (!parsed.success) {
    return { ok: false, reason: 'requestedSchema is not a supported flat object schema' }
  }
  const { properties, required = [] } = parsed.data
  if (required.some((name) => !Object.hasOwn(properties, name))) {
    return { ok: false, reason: 'requestedSchema requires a field it does not define' }
  }
  const fields: ElicitationField[] = []
  for (const [name, raw] of Object.entries(properties)) {
    const checked = primitiveSchema.safeParse(raw)
    if (!checked.success) {
      return { ok: false, reason: `field ${name} is not a supported primitive schema` }
    }
    const field: ElicitationField = { ...checked.data, name, required: required.includes(name) }
    if (field.enumNames !== undefined && field.enumNames.length !== field.enum?.length) {
      return { ok: false, reason: `field ${name} has enum labels that do not fit its options` }
    }
    if (
      (field.minLength !== undefined &&
        field.maxLength !== undefined &&
        field.minLength > field.maxLength) ||
      (field.minimum !== undefined &&
        field.maximum !== undefined &&
        field.minimum > field.maximum) ||
      (field.enum !== undefined && new Set(field.enum).size !== field.enum.length)
    ) {
      return { ok: false, reason: `field ${name} has inconsistent constraints` }
    }
    if (field.default !== undefined && checkValue(field, field.default) !== undefined) {
      return { ok: false, reason: `field ${name} has a default that does not fit it` }
    }
    fields.push(field)
  }
  return { ok: true, fields }
}

function isMatchingFormat(format: ElicitationField['format'], value: string): boolean {
  switch (format) {
    case 'date': {
      return z.iso.date().safeParse(value).success
    }
    case 'date-time': {
      return z.iso.datetime({ offset: true }).safeParse(value).success
    }
    case 'email': {
      return z.email().safeParse(value).success
    }
    case 'uri': {
      return URL.canParse(value)
    }
    case undefined: {
      return true
    }
  }
}

function checkValue(field: ElicitationField, value: unknown): string | undefined {
  switch (field.type) {
    case 'string': {
      if (typeof value !== 'string') return 'is not text'
      // JSON Schema counts Unicode code points, not grapheme clusters.
      const length = value.match(/./gsu)?.length ?? 0
      if (
        (field.minLength !== undefined && length < field.minLength) ||
        (field.maxLength !== undefined && length > field.maxLength)
      )
        return 'does not fit the length bounds'
      if (field.enum !== undefined && !field.enum.includes(value))
        return 'is not one of the offered options'
      return isMatchingFormat(field.format, value) ? undefined : 'does not fit the requested format'
    }
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'is not a number'
      if (field.type === 'integer' && !Number.isSafeInteger(value)) return 'is not a whole number'
      return (field.minimum !== undefined && value < field.minimum) ||
        (field.maximum !== undefined && value > field.maximum)
        ? 'does not fit the numeric bounds'
        : undefined
    }
    case 'boolean': {
      return typeof value === 'boolean' ? undefined : 'is not true or false'
    }
  }
}

export type ElicitationValuesCheck =
  | { readonly ok: true; readonly content: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly refusal: { readonly field: string; readonly reason: string } }

export function validateElicitationValues(
  fields: readonly ElicitationField[],
  values: Readonly<Record<string, unknown>>,
): ElicitationValuesCheck {
  const known = new Set(fields.map((field) => field.name))
  for (const name of Object.keys(values)) {
    if (!known.has(name)) {
      return { ok: false, refusal: { field: name, reason: 'is not a field that was asked for' } }
    }
  }
  const content: [string, unknown][] = []
  for (const field of fields) {
    const value = Object.hasOwn(values, field.name) ? values[field.name] : undefined
    if (value === undefined) {
      if (field.required)
        return { ok: false, refusal: { field: field.name, reason: 'is required' } }
      continue
    }
    const reason = checkValue(field, value)
    if (reason !== undefined) return { ok: false, refusal: { field: field.name, reason } }
    content.push([field.name, value])
  }
  return { ok: true, content: Object.fromEntries(content) }
}

// Lane E owns real dispatch. Only explicit user-scope answers may be accepted.
export interface ElicitationHookInput {
  readonly server: string
  readonly message: string
  readonly fieldNames: readonly string[]
  readonly requiredNames: readonly string[]
}
export interface ElicitationHookVerdict {
  readonly decision: 'proceed' | 'decline' | 'cancel' | 'answer'
  readonly source?: 'project' | 'user'
  readonly reason?: string
  readonly values?: Readonly<Record<string, unknown>>
}
export interface ElicitationResultInput {
  readonly server: string
  readonly fieldNames: readonly string[]
  readonly action: ElicitationOutcome['action']
}
export interface ElicitationHookSeam {
  fireElicitation(input: ElicitationHookInput): Promise<ElicitationHookVerdict>
  fireElicitationResult(input: ElicitationResultInput): Promise<void>
}
// The unwired seam deliberately proceeds to the explicit user form.
export const ALLOW_ELICITATION_SEAM: ElicitationHookSeam = {
  fireElicitation: () => Promise.resolve({ decision: 'proceed' }),
  fireElicitationResult: () => Promise.resolve(),
}
export function elicitationFieldNames(fields: readonly ElicitationField[]): readonly string[] {
  return fields.map((field) => field.name)
}
export function describeElicitationForLog(
  server: string,
  fieldNames: readonly string[],
  action: ElicitationOutcome['action'],
): string {
  return `MCP server ${server} elicitation ${action} (fields: ${fieldNames.join(', ')})`
}
