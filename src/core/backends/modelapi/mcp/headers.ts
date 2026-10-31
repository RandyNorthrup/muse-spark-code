// The mirrored HTTP headers of a modern Streamable HTTP request (PLAN.md
// D213; spec 2026-07-28 `basic/transports/streamable-http#request-metadata`
// and `server/tools#x-mcp-header`, SEP-2243): the Base64 sentinel encoding
// shared by `Mcp-Name` and `Mcp-Param-{Name}`, and the `Mcp-Param-{Name}`
// headers a `tools/call` carries for the arguments its tool's `inputSchema`
// annotates with `x-mcp-header`. A tool whose annotations break the spec's
// constraints is rejected with its reason, so the listing can exclude it.
// The walk follows the official v2 client's (`@modelcontextprotocol/client`
// 2.4.0, `scanXMcpHeaderDeclarations`, read 2026-10-23): only a chain of
// `properties` keys reaches a mirrored property; an annotation under any
// array, composition, conditional or definitions keyword rejects the tool.
// Pure.

import { Buffer } from 'node:buffer'

const PARAM_HEADER_PREFIX = 'Mcp-Param-'
const ANNOTATION = 'x-mcp-header'
const PROPERTIES = 'properties'
// The Base64 sentinel (spec `streamable-http#value-encoding`).
const SENTINEL_START = '=?base64?'
const SENTINEL_END = '?='
// An HTTP field value (RFC 9110): visible ASCII, space and tab.
const HEADER_SAFE = /^[\t \u{21}-\u{7E}]*$/u
// RFC 9110 section 5.1 `token` (`1*tchar`): no space, control or delimiter.
const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
/** The JSON Schema types an annotation may sit on: never `number` (spec). */
const MIRRORED_TYPES: ReadonlySet<string> = new Set(['string', 'integer', 'boolean'])
/**
The keywords whose subschemas a `properties` chain never passes through
(the spec's static reachability): an annotation under one of them makes
the tool definition invalid.
*/
const UNREACHABLE_KEYWORDS: readonly string[] = [
  'items',
  'prefixItems',
  'contains',
  'additionalProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'propertyNames',
  'patternProperties',
  'dependentSchemas',
  'oneOf',
  'anyOf',
  'allOf',
  'not',
  'if',
  'then',
  'else',
  '$defs',
  'definitions',
]
/** Of those, the ones whose value maps names to subschemas. */
const NAMED_SUBSCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  'patternProperties',
  'dependentSchemas',
  '$defs',
  'definitions',
])

/** One mirrored argument: its header and the exact property path it reads. */
export interface HeaderMirror {
  readonly header: string
  readonly path: readonly string[]
}

export type HeaderMirrors =
  | { readonly ok: true; readonly mirrors: readonly HeaderMirror[] }
  | { readonly ok: false; readonly reason: string }

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
A header value: as-is when it is plain header-safe ASCII, else the Base64
sentinel over its UTF-8 bytes. A value that already matches the sentinel
is encoded too, so it cannot be mistaken, and so is an empty one, which a
field-value parser or an intermediary could drop (the official v2 client
encodes it the same way).
*/
export function encodeHeaderValue(value: string): string {
  const isSentinel = value.startsWith(SENTINEL_START) && value.endsWith(SENTINEL_END)
  return value !== '' && !isSentinel && value === value.trim() && HEADER_SAFE.test(value)
    ? value
    : `${SENTINEL_START}${Buffer.from(value, 'utf8').toString('base64')}${SENTINEL_END}`
}

/** The subschemas one unreachable keyword holds. */
function subschemasOf(keyword: string, value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value
  }
  return NAMED_SUBSCHEMA_KEYWORDS.has(keyword) && isRecord(value) ? Object.values(value) : [value]
}

/**
Every `x-mcp-header` annotation of a tool's `inputSchema`, or the first
constraint one breaks: empty or not a string, not an HTTP token, named
twice (case-insensitively), on a type other than string, integer or
boolean, or off the `properties` chain. The schema came over the wire as
JSON, so it holds no cycles.
*/
export function scanHeaderMirrors(inputSchema: unknown): HeaderMirrors {
  const mirrors: HeaderMirror[] = []
  const seen = new Map<string, string>()
  const visit = (
    node: unknown,
    path: readonly string[],
    isReachable: boolean,
  ): string | undefined => {
    if (!isRecord(node)) {
      return undefined
    }
    if (Object.hasOwn(node, ANNOTATION)) {
      if (!isReachable || path.length === 0) {
        return `${path.join('.') || 'the schema root'}: x-mcp-header sits off the chain of properties keys`
      }
      const name: unknown = node[ANNOTATION]
      if (typeof name !== 'string' || name === '') {
        return `${path.join('.')}: x-mcp-header is empty or not a string`
      }
      if (!HEADER_TOKEN.test(name)) {
        return `${path.join('.')}: x-mcp-header "${name}" is not an HTTP header token`
      }
      const type: unknown = node['type']
      if (typeof type !== 'string' || !MIRRORED_TYPES.has(type)) {
        return `${path.join('.')}: x-mcp-header "${name}" is on a property that is not a string, integer or boolean`
      }
      const folded = name.toLowerCase()
      const earlier = seen.get(folded)
      if (earlier !== undefined) {
        return `x-mcp-header "${name}" is named twice (also as "${earlier}")`
      }
      seen.set(folded, name)
      mirrors.push({ header: `${PARAM_HEADER_PREFIX}${name}`, path })
    }
    const properties: unknown = node[PROPERTIES]
    if (isRecord(properties)) {
      for (const [key, child] of Object.entries(properties)) {
        const reason = visit(child, [...path, key], isReachable)
        if (reason !== undefined) {
          return reason
        }
      }
    }
    for (const keyword of UNREACHABLE_KEYWORDS) {
      if (!Object.hasOwn(node, keyword)) {
        continue
      }
      const branches = subschemasOf(keyword, node[keyword])
      for (const branch of branches) {
        const reason = visit(branch, [...path, `<${keyword}>`], false)
        if (reason !== undefined) {
          return reason
        }
      }
    }
    return undefined
  }
  const reason = visit(inputSchema, [], true)
  return reason === undefined ? { ok: true, mirrors } : { ok: false, reason }
}

/** The value at a property path of the call's arguments, or undefined. */
function valueAt(args: Readonly<Record<string, unknown>>, path: readonly string[]): unknown {
  let node: unknown = args
  for (const key of path) {
    if (!isRecord(node) || !Object.hasOwn(node, key)) {
      return undefined
    }
    // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop -- a read-only walk: the loop never assigns, and Object.hasOwn refuses inherited keys. The keys are the tool schema's property names, which an MCP server chooses, not the header token; a read cannot pollute Object.prototype (PLAN.md §8)
    node = node[key]
  }
  return node
}

/**
An argument's header text (spec type conversion): a string as-is, a
boolean in lower case, a number in decimal. A value that is absent, null,
not a primitive, not finite or past the safe integer range (where every
double is an integer, and not exactly the one sent) has none, and its
header is omitted.
*/
function headerText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }
  return Math.abs(value) > Number.MAX_SAFE_INTEGER ? undefined : String(value)
}

/** The `Mcp-Param-{Name}` headers for one call's arguments, each value encoded. */
export function mirrorHeaders(
  mirrors: readonly HeaderMirror[],
  args: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {}
  for (const mirror of mirrors) {
    const text = headerText(valueAt(args, mirror.path))
    if (text !== undefined) {
      headers[mirror.header] = encodeHeaderValue(text)
    }
  }
  return headers
}
