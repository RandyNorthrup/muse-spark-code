import * as z from 'zod/mini'
import { fingerprint } from '../../core/verify/fingerprint'
import {
  EXEC_PROMPT_MAX_BYTES,
  EXEC_OUTPUT_SCHEMA_LIMITS,
  MCP_SCHEMA_LIMITS,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatNumber } from '../../shared/l10n/text'

/** Typed records are built only after the shared input preflight refuses lossy keys. */
function execRecordSchema<T>(valueSchema: z.ZodMiniType<T>): z.ZodMiniType<Record<string, T>> {
  return z.pipe(
    z.record(z.string(), valueSchema),
    z.transform((record) => {
      Object.setPrototypeOf(record, null)
      return record
    }),
  )
}

/** One bounded preflight per input, before any record, grammar or answer schema runs. */
export function parseExecRecord(value: unknown): Record<string, unknown> {
  let nodes = 0
  const copy = (item: unknown, depth: number): unknown => {
    nodes += 1
    if (nodes > MCP_SCHEMA_LIMITS.nodes || depth > MCP_SCHEMA_LIMITS.depth * 2 + 2)
      throw new Error('depth / nodes')
    if (Array.isArray(item)) return item.map((child: unknown) => copy(child, depth + 1))
    if (typeof item !== 'object' || item === null) return item
    const record: Record<string, unknown> = {}
    Object.setPrototypeOf(record, null)
    for (const [key, child] of Object.entries(item)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw new Error('forbidden record key')
      record[key] = copy(child, depth + 1)
    }
    return record
  }
  return execRecordSchema(z.unknown()).parse(copy(value, 0))
}

const types = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'] as const
type SchemaType = (typeof types)[number]
interface SchemaNode {
  type?: SchemaType | SchemaType[]
  properties?: Record<string, SchemaNode>
  required?: string[]
  additionalProperties?: false
  items?: SchemaNode
  anyOf?: SchemaNode[]
  enum?: (string | number | boolean | null)[]
  title?: string
  description?: string
  $defs?: Record<string, SchemaNode>
  $ref?: string
}
const nodeSchema: z.ZodMiniType<SchemaNode> = z.lazy(() =>
  z.pipe(
    execRecordSchema(z.unknown()),
    z.strictObject({
      type: z.exactOptional(z.union([z.enum(types), z.array(z.enum(types))])),
      properties: z.exactOptional(execRecordSchema(nodeSchema)),
      required: z.exactOptional(z.array(z.string())),
      additionalProperties: z.exactOptional(z.literal(false)),
      items: z.exactOptional(nodeSchema),
      anyOf: z.exactOptional(z.array(nodeSchema)),
      enum: z.exactOptional(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
      title: z.exactOptional(z.string()),
      description: z.exactOptional(z.string()),
      $defs: z.exactOptional(execRecordSchema(nodeSchema)),
      $ref: z.exactOptional(z.string()),
    }),
  ),
)

// Build from the validation bundle's existing mini API; z.json is not exported there.
export const outputJsonSchema: z.ZodMiniType<z.core.util.JSONType> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(outputJsonSchema),
    execRecordSchema(outputJsonSchema),
  ]),
)

export interface OutputSchema {
  /** Digest of the exact file bytes, including whitespace. No path or schema in the ledger. */
  readonly sha256: string
  readonly schema: Record<string, unknown>
  parseAnswer(text: string):
    | { readonly ok: true; readonly value: z.core.util.JSONType }
    | {
        readonly ok: false
        readonly detail: string
        readonly kind?: 'output_schema_validation_budget'
      }
}

function tooComplex(count: number): never {
  throw new Error(fill(UI_TEXT.outputSchemaTooComplex, { count: formatNumber(count) }))
}

function invalid(detail: string): never {
  throw new Error(fill(UI_TEXT.outputSchemaInvalid, { detail }))
}

/** Bound nesting before recursive zod parsing; grammar depth counts schema nodes separately. */
function isBounded(value: unknown): boolean {
  const pending = [{ value, depth: 0 }]
  let nodes = 0
  while (pending.length > 0) {
    const next = pending.pop()
    if (next === undefined) break
    nodes += 1
    if (nodes > MCP_SCHEMA_LIMITS.nodes || next.depth > MCP_SCHEMA_LIMITS.depth * 2 + 2)
      return false
    if (typeof next.value === 'object' && next.value !== null)
      for (const child of Object.values(next.value))
        pending.push({ value: child, depth: next.depth + 1 })
  }
  return true
}

/**
 * A conservative strict subset, never a rewrite: closed objects with every key
 * required, homogeneous arrays, scalar enums, nullable types, nested anyOf and
 * local references. Constraints we cannot enforce are refused, never discarded.
 * Uses the existing strict JSON grammar's resource limits (MCP_SCHEMA_LIMITS).
 */
export function compileOutputSchema(bytes: Uint8Array): OutputSchema {
  if (bytes.byteLength > EXEC_PROMPT_MAX_BYTES) invalid('bytes')
  let decoded: unknown
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    decoded = JSON.parse(source.replace(/^\u{FEFF}/u, ''))
  } catch {
    invalid('JSON / UTF-8')
  }
  if (!isBounded(decoded)) invalid('depth / nodes')
  let record: Record<string, unknown>
  try {
    record = parseExecRecord(decoded)
  } catch (error: unknown) {
    invalid(error instanceof Error ? error.message : 'record')
  }
  const parsed = nodeSchema.safeParse(record)
  if (!parsed.success) invalid('keywords / types')
  const root = parsed.data
  if (root.type !== 'object' || root.$ref !== undefined || root.anyOf !== undefined)
    invalid('root object')
  const target = (reference: string): SchemaNode => {
    if (reference === '#') return root
    const prefix = '#/$defs/'
    if (!reference.startsWith(prefix)) invalid('$ref')
    const label = reference.slice(prefix.length)
    if (label.includes('/') || /~(?![01])/u.test(label)) invalid('$ref')
    const name = label.replaceAll('~1', '/').replaceAll('~0', '~')
    const definition = Object.hasOwn(root.$defs ?? {}, name) ? root.$defs?.[name] : undefined
    if (definition === undefined) invalid('$ref')
    return definition
  }
  const references = new Map<SchemaNode, SchemaNode>()
  const nodes: SchemaNode[] = []
  let propertyCount = 0
  let enumValues = 0
  let stringChars = 0
  const check = (node: SchemaNode, depth: number): void => {
    nodes.push(node)
    if (depth > MCP_SCHEMA_LIMITS.depth) invalid('depth')
    for (const text of [node.title, node.description, ...(node.enum ?? [])])
      if (typeof text === 'string') stringChars += text.length
    if (stringChars > MCP_SCHEMA_LIMITS.stringChars) invalid('strings')
    if (node.$defs !== undefined) {
      if (node !== root) invalid('$defs')
      for (const [name, definition] of Object.entries(node.$defs)) {
        stringChars += name.length
        if (stringChars > MCP_SCHEMA_LIMITS.stringChars) invalid('strings')
        check(definition, depth + 1)
      }
    }
    const hasReference = node.$ref !== undefined
    const hasUnion = node.anyOf !== undefined
    if (Number(hasReference) + Number(hasUnion) + Number(node.type !== undefined) !== 1)
      invalid('type / anyOf / $ref')
    const nodeTypes = node.type === undefined ? [] : [node.type].flat()
    if (
      Array.isArray(node.type) &&
      (nodeTypes.length !== 2 || new Set(nodeTypes).size !== 2 || !nodeTypes.includes('null'))
    )
      invalid('nullable type')
    const isObject = nodeTypes.includes('object')
    const isArray = nodeTypes.includes('array')
    if (
      !isObject &&
      [node.properties, node.required, node.additionalProperties].some((v) => v !== undefined)
    )
      invalid('object keywords')
    if (!isArray && node.items !== undefined) invalid('items')
    if (isObject) {
      const names = Object.keys(node.properties ?? {})
      if (
        node.properties === undefined ||
        node.additionalProperties !== false ||
        node.required?.length !== names.length ||
        new Set(node.required).size !== names.length ||
        names.some((name) => !node.required?.includes(name))
      )
        invalid('required / additionalProperties')
      propertyCount += names.length
      stringChars += names.join('').length
      if (
        propertyCount > MCP_SCHEMA_LIMITS.properties ||
        stringChars > MCP_SCHEMA_LIMITS.stringChars
      )
        invalid('properties / strings')
      const children = Object.values(node.properties ?? {})
      for (const child of children) check(child, depth + 1)
    }
    if (isArray) {
      if (node.items === undefined) invalid('items')
      check(node.items, depth + 1)
    }
    if (node.enum !== undefined) {
      enumValues += node.enum.length
      if (
        hasReference ||
        hasUnion ||
        isObject ||
        isArray ||
        node.enum.length === 0 ||
        enumValues > MCP_SCHEMA_LIMITS.enumValues ||
        new Set(node.enum).size !== node.enum.length ||
        node.enum.some((value) => nodeTypes.every((type) => !isType(type, value)))
      )
        invalid('enum')
      if (
        node.enum.length > MCP_SCHEMA_LIMITS.largeEnumValues &&
        node.enum.reduce<number>((sum, value) => sum + String(value).length, 0) >
          MCP_SCHEMA_LIMITS.largeEnumChars
      )
        invalid('enum strings')
    }
    if (node.$ref !== undefined) references.set(node, target(node.$ref))
    if (node.anyOf === undefined) {
      return
    }

    if (node.anyOf.length < 2) invalid('anyOf')
    for (const child of node.anyOf) check(child, depth + 1)
  }
  check(root, 0)
  // Resolve once. The reference/union graph between typed nodes must be a
  // DAG; typed objects/arrays are recursion boundaries consuming answer depth.
  const expansions = new Map<SchemaNode, { count: number; depth: number }>()
  const visiting = new Set<SchemaNode>()
  const expand = (node: SchemaNode): { count: number; depth: number } => {
    const cached = expansions.get(node)
    if (cached !== undefined) return cached
    if (node.type !== undefined) {
      const leaf = { count: 1, depth: 0 }
      expansions.set(node, leaf)
      return leaf
    }
    if (visiting.has(node) || visiting.size > MCP_SCHEMA_LIMITS.depth) invalid('$ref cycle')
    visiting.add(node)
    let count = 1
    let depth = 0
    const reference = references.get(node)
    const children = reference === undefined ? (node.anyOf ?? []) : [reference]
    for (const child of children) {
      const expanded = expand(child)
      count += expanded.count
      depth = Math.max(depth, expanded.depth + 1)
      if (count > EXEC_OUTPUT_SCHEMA_LIMITS.expandedNodes) tooComplex(count)
      if (depth > MCP_SCHEMA_LIMITS.depth + 1) invalid('$ref depth')
    }
    visiting.delete(node)
    const result = { count, depth }
    expansions.set(node, result)
    return result
  }
  let expandedNodes = 0
  for (const node of nodes) {
    expandedNodes += expand(node).count
    if (expandedNodes > EXEC_OUTPUT_SCHEMA_LIMITS.expandedNodes) tooComplex(expandedNodes)
  }
  const compiled = new Map(
    nodes.map((node) => [
      node,
      {
        reference: references.get(node),
        types: node.type === undefined ? [] : [node.type].flat(),
        properties: Object.entries(node.properties ?? {}),
        values: node.enum === undefined ? undefined : new Set<unknown>(node.enum),
      },
    ]),
  )
  const isValidAnswer = (answer: z.core.util.JSONType): boolean => {
    // Primitive values compare by value; JSON containers by identity. Both are
    // stable for this immutable parse. Count cache hits as work too.
    const memo = new Map<SchemaNode, Map<z.core.util.JSONType, boolean>>()
    let steps = 0
    const spend = (count: number): void => {
      steps += count
      if (steps > EXEC_OUTPUT_SCHEMA_LIMITS.validationSteps)
        throw new Error(fill(UI_TEXT.outputSchemaWorkBudget, { count: formatNumber(steps) }))
    }
    const isMatch = (node: SchemaNode, value: z.core.util.JSONType): boolean => {
      spend(1)
      const cached = memo.get(node)?.get(value)
      if (cached !== undefined) return cached
      let isValid: boolean
      const spec = compiled.get(node) ?? invalid('node')
      if (spec.reference !== undefined) isValid = isMatch(spec.reference, value)
      else if (node.anyOf === undefined) {
        isValid = spec.types.some((type) => isType(type, value))
        if (isValid && Array.isArray(value))
          isValid = value.every((item) => isMatch(node.items ?? invalid('items'), item))
        else if (isValid && typeof value === 'object' && value !== null && !Array.isArray(value)) {
          const keys = Object.keys(value)
          spend(keys.length)
          isValid =
            keys.length === spec.properties.length &&
            spec.properties.every(
              ([key, child]) => Object.hasOwn(value, key) && isMatch(child, value[key] ?? null),
            )
        }
        if (isValid && spec.values !== undefined) isValid = spec.values.has(value)
      } else {
        isValid = node.anyOf.some((child) => isMatch(child, value))
      }
      const entries = memo.get(node) ?? new Map<z.core.util.JSONType, boolean>()
      entries.set(value, isValid)
      memo.set(node, entries)
      return isValid
    }
    return isMatch(root, answer)
  }
  return {
    sha256: fingerprint(source),
    schema: record,
    parseAnswer(text) {
      let answer: unknown
      try {
        answer = parseExecRecord(JSON.parse(text))
      } catch (error: unknown) {
        return {
          ok: false,
          detail:
            error instanceof Error &&
            ['forbidden record key', 'depth / nodes'].includes(error.message)
              ? error.message
              : 'JSON',
        }
      }
      if (!isBounded(answer)) return { ok: false, detail: 'depth / nodes' }
      const json = outputJsonSchema.safeParse(answer)
      if (!json.success) return { ok: false, detail: 'JSON' }
      try {
        return isValidAnswer(json.data)
          ? { ok: true, value: json.data }
          : { ok: false, detail: 'schema' }
      } catch (error: unknown) {
        return {
          ok: false,
          kind: 'output_schema_validation_budget',
          detail: error instanceof Error ? error.message : UI_TEXT.outputSchemaWorkBudget,
        }
      }
    },
  }
}

function isType(type: SchemaType, value: unknown): boolean {
  if (type === 'null') return value === null
  if (type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value)
  if (type === 'array') return Array.isArray(value)
  return type === 'integer'
    ? // eslint-disable-next-line unicorn/prefer-number-is-safe-integer -- JSON Schema integer means integral; transport precision is separate (PLAN §8, RVM106O2 P2-4).
      typeof value === 'number' && Number.isInteger(value)
    : typeof value === type
}
