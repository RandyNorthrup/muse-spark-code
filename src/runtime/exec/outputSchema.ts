import * as z from 'zod/mini'
import { fingerprint } from '../../core/verify/fingerprint'
import { EXEC_PROMPT_MAX_BYTES, MCP_SCHEMA_LIMITS, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

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
  z.strictObject({
    type: z.exactOptional(z.union([z.enum(types), z.array(z.enum(types))])),
    properties: z.exactOptional(z.record(z.string(), nodeSchema)),
    required: z.exactOptional(z.array(z.string())),
    additionalProperties: z.exactOptional(z.literal(false)),
    items: z.exactOptional(nodeSchema),
    anyOf: z.exactOptional(z.array(nodeSchema)),
    enum: z.exactOptional(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
    title: z.exactOptional(z.string()),
    description: z.exactOptional(z.string()),
    $defs: z.exactOptional(z.record(z.string(), nodeSchema)),
    $ref: z.exactOptional(z.string()),
  }),
)

// Build from the validation bundle's existing mini API; z.json is not exported there.
export const outputJsonSchema: z.ZodMiniType<z.core.util.JSONType> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(outputJsonSchema),
    z.record(z.string(), outputJsonSchema),
  ]),
)

export interface OutputSchema {
  /** Digest of the exact file bytes, including whitespace. No path or schema in the ledger. */
  readonly sha256: string
  readonly schema: Record<string, unknown>
  parseAnswer(
    text: string,
  ):
    | { readonly ok: true; readonly value: z.core.util.JSONType }
    | { readonly ok: false; readonly detail: string }
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
  const parsed = nodeSchema.safeParse(decoded)
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
  const checkReferenceCycle = (node: SchemaNode, seen: Set<SchemaNode>): void => {
    if (node.type !== undefined) return
    if (seen.has(node) || seen.size > MCP_SCHEMA_LIMITS.depth) invalid('$ref cycle')
    seen.add(node)
    if (node.$ref !== undefined) checkReferenceCycle(target(node.$ref), seen)
    const children = node.anyOf ?? []
    for (const child of children) checkReferenceCycle(child, new Set(seen))
  }
  let propertyCount = 0
  let stringChars = 0
  const check = (node: SchemaNode, depth: number): void => {
    if (depth > MCP_SCHEMA_LIMITS.depth) invalid('depth')
    for (const text of [node.title, node.description, ...(node.enum ?? [])])
      if (typeof text === 'string') stringChars += text.length
    if (stringChars > MCP_SCHEMA_LIMITS.stringChars) invalid('strings')
    if (node.$defs !== undefined) {
      if (node !== root) invalid('$defs')
      for (const definition of Object.values(node.$defs)) check(definition, depth + 1)
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
      if (
        hasReference ||
        hasUnion ||
        isObject ||
        isArray ||
        node.enum.length === 0 ||
        node.enum.length > MCP_SCHEMA_LIMITS.enumValues ||
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
    if (hasReference || hasUnion) checkReferenceCycle(node, new Set())
    if (node.anyOf === undefined) {
      return
    }

    if (node.anyOf.length < 2) invalid('anyOf')
    for (const child of node.anyOf) check(child, depth + 1)
  }
  check(root, 0)
  const validators = new Map<SchemaNode, z.ZodMiniType>()
  const compile = (node: SchemaNode): z.ZodMiniType => {
    const existing = validators.get(node)
    if (existing !== undefined) return existing
    // Register before resolving refs so recursive objects are supported.
    const lazy = z.lazy(() => {
      let validator: z.ZodMiniType
      if (node.$ref !== undefined) validator = compile(target(node.$ref))
      else if (node.anyOf === undefined) {
        const typed = (type: SchemaType): z.ZodMiniType => {
          switch (type) {
            case 'object': {
              return z.strictObject(
                Object.fromEntries(
                  Object.entries(node.properties ?? {}).map(([key, value]) => [
                    key,
                    compile(value),
                  ]),
                ),
              )
            }
            case 'array': {
              return z.array(compile(node.items ?? invalid('items')))
            }
            case 'string': {
              return z.string()
            }
            case 'number': {
              return z.number()
            }
            case 'integer': {
              return z.number().check(z.int())
            }
            case 'boolean': {
              return z.boolean()
            }
            case 'null': {
              return z.null()
            }
          }
        }
        validator = Array.isArray(node.type)
          ? z.union(node.type.map((type) => typed(type)))
          : typed(node.type ?? invalid('type'))
      } else {
        validator = z.union(node.anyOf.map((child) => compile(child)))
      }
      const values = new Set<unknown>(node.enum)
      return node.enum === undefined
        ? validator
        : validator.check(z.refine((value) => values.has(value)))
    })
    validators.set(node, lazy)
    return lazy
  }
  const validator = compile(root)
  return {
    sha256: fingerprint(source),
    schema: z.record(z.string(), z.unknown()).parse(decoded),
    parseAnswer(text) {
      let answer: unknown
      try {
        answer = JSON.parse(text)
      } catch {
        return { ok: false, detail: 'JSON' }
      }
      if (!isBounded(answer)) return { ok: false, detail: 'depth / nodes' }
      const checked = validator.safeParse(answer)
      return checked.success
        ? { ok: true, value: outputJsonSchema.parse(checked.data) }
        : { ok: false, detail: 'schema' }
    },
  }
}

function isType(type: SchemaType, value: unknown): boolean {
  if (type === 'null') return value === null
  return type === 'integer'
    ? typeof value === 'number' && Number.isSafeInteger(value)
    : typeof value === type
}
