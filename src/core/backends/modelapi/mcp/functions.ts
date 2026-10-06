// An MCP server's tools as Meta's function calling takes them, and their
// results as the model reads them (M50, PLAN.md D42).
//
// Names: `mcp__<server>__<tool>`, as Muse Code names them, so the row reads
// "tool (server)" (M43). Meta allows `[A-Za-z0-9_.-]` and at most one dot
// (tool-calling, "Function name rules"); every other character, and every
// dot, becomes `_`. The server's part never holds `__`, so the row's label
// splits the name where it was joined. A name over 64 characters, or one
// another tool already has, ends in a hash of the real names instead.
//
// Parameters: the server's JSON Schema, cut to Meta's documented limits
// (structured-output, "Stay within schema constraints"): a request past one
// is a 400 for the whole turn. Local `$ref`s are written out in place (a
// recursive one is cut where it recurs, since Meta refuses recursion), a
// remote one becomes "any value", and anything nested past ten levels is
// cut. A schema still past the limits after that is offered as "an object"
// and the model is told so in the description; the server checks the
// arguments either way.
//
// Results: text, and pictures as `input_image` parts of the function's
// output (the Responses schema's `FunctionCallOutputContentListParam`,
// read 2026-09-25), each checked to be a PNG, JPEG, GIF or WebP within
// MAX_IMAGE_BYTES first, since a picture Meta cannot read would fail every
// later request of the conversation. Audio, links and binary resources are
// described in words.

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import {
  MAX_IMAGE_BYTES,
  MCP_FUNCTION_HASH_CHARS,
  MCP_FUNCTION_NAME_MAX_CHARS,
  MCP_FUNCTION_PREFIX,
  MCP_FUNCTION_SEPARATOR,
  MCP_SCHEMA_LIMITS,
  MCP_TOOL_DESCRIPTION_MAX_CHARS,
  MODEL_API_MODEL_TEXT,
  TOOL_OUTPUT_CLIP_MARKER,
  TOOL_OUTPUT_MAX_CHARS,
} from '../../../../shared/constants'
import { readImageInfo } from '../../../imageDimensions'
import {
  type FunctionOutputPart,
  type FunctionToolDefinition,
  NON_STRICT_TOOL,
  withStrictTools,
} from '../schemas'
import {
  type CallToolResult,
  type ContentBlock,
  contentBlockSchema,
  type McpToolInfo,
} from './protocol'

type JsonObject = Record<string, unknown>

const NOT_ALLOWED_IN_NAME = /[^A-Za-z0-9_-]/g
const UNDERSCORES = /_+/g
const EDGE_UNDERSCORES = /^_+|_+$/g
// The server's part is kept short, so a long tool name is what gets cut.
const SERVER_PART_MAX_CHARS = 20
const FALLBACK_SERVER = 'server'
const FALLBACK_TOOL = 'tool'
const HASH_JOINER = '_'

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function mcpServerPart(server: string): string {
  const part = server
    .replaceAll(NOT_ALLOWED_IN_NAME, '_')
    .replaceAll(UNDERSCORES, '_')
    .replaceAll(EDGE_UNDERSCORES, '')
    .slice(0, SERVER_PART_MAX_CHARS)
    .replaceAll(EDGE_UNDERSCORES, '')
  return part === '' ? FALLBACK_SERVER : part
}

function toolPart(tool: string): string {
  const part = tool.replaceAll(NOT_ALLOWED_IN_NAME, '_')
  return part === '' ? FALLBACK_TOOL : part
}

/** The function name for a server's tool, unique among `taken`. */
export function mcpFunctionName(server: string, tool: string, taken: ReadonlySet<string>): string {
  const plain = `${MCP_FUNCTION_PREFIX}${mcpServerPart(server)}${MCP_FUNCTION_SEPARATOR}${toolPart(tool)}`
  if (plain.length <= MCP_FUNCTION_NAME_MAX_CHARS && !taken.has(plain)) {
    return plain
  }
  const hash = createHash('sha256')
    .update(`${server}\u{0}${tool}`)
    .digest('hex')
    .slice(0, MCP_FUNCTION_HASH_CHARS)
  const suffix = `${HASH_JOINER}${hash}`
  return `${plain.slice(0, MCP_FUNCTION_NAME_MAX_CHARS - suffix.length)}${suffix}`
}

// --- parameters ---

/** Keys whose value is one subschema. */
const SCHEMA_KEYS: ReadonlySet<string> = new Set([
  'items',
  'additionalProperties',
  'additionalItems',
  'contains',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
  'unevaluatedItems',
  'unevaluatedProperties',
])
/** Keys whose value is a list of subschemas. */
const SCHEMA_LIST_KEYS: ReadonlySet<string> = new Set(['anyOf', 'oneOf', 'allOf', 'prefixItems'])
/** Keys whose value maps names to subschemas. */
const SCHEMA_MAP_KEYS: ReadonlySet<string> = new Set([
  'properties',
  'patternProperties',
  'dependentSchemas',
])
/** Written out where referenced, then dropped; and the root's own metadata. */
const DROPPED_KEYS: ReadonlySet<string> = new Set(['$defs', 'definitions', '$schema', '$id'])
const LOCAL_REF = /^#(\/.*)?$/
const POINTER_SLASH = /~1/g
const POINTER_TILDE = /~0/g

interface Walk {
  readonly root: JsonObject
  nodes: number
  properties: number
  stringChars: number
  enumValues: number
  readonly notes: Set<string>
}

/** A local JSON pointer (`#/$defs/Name`) resolved in the root; undefined when it names nothing. */
function resolvePointer(root: JsonObject, ref: string): unknown {
  const pointer = LOCAL_REF.exec(ref)?.[1]
  if (pointer === undefined) {
    return LOCAL_REF.test(ref) ? root : undefined
  }
  let node: unknown = root
  for (const raw of pointer.slice(1).split('/')) {
    let key: string
    try {
      key = decodeURIComponent(raw)
    } catch {
      return undefined
    }
    key = key.replaceAll(POINTER_SLASH, '/').replaceAll(POINTER_TILDE, '~')
    node = isObject(node) ? node[key] : undefined
  }
  return node
}

function countEnum(values: readonly unknown[], walk: Walk): readonly unknown[] | undefined {
  const strings = values.filter((value): value is string => typeof value === 'string')
  const chars = strings.reduce((sum, value) => sum + value.length, 0)
  if (
    strings.length > MCP_SCHEMA_LIMITS.largeEnumValues &&
    chars > MCP_SCHEMA_LIMITS.largeEnumChars
  ) {
    walk.notes.add('an enum too large for the Model API was dropped')
    return undefined
  }
  walk.enumValues += values.length
  walk.stringChars += chars
  return values
}

function walkMap(
  value: unknown,
  key: string,
  depth: number,
  refs: readonly string[],
  walk: Walk,
): unknown {
  if (!isObject(value)) {
    return value
  }
  const entries = Object.entries(value)
  if (key === 'properties') {
    walk.properties += entries.length
    walk.stringChars += entries.reduce((sum, [name]) => sum + name.length, 0)
  }
  return Object.fromEntries(
    entries.map(([name, sub]) => [name, walkSchema(sub, depth + 1, refs, walk)]),
  )
}

function walkKey(
  key: string,
  value: unknown,
  depth: number,
  refs: readonly string[],
  walk: Walk,
): unknown {
  if (SCHEMA_KEYS.has(key)) {
    return Array.isArray(value)
      ? value.map((sub) => walkSchema(sub, depth + 1, refs, walk))
      : walkSchema(value, depth + 1, refs, walk)
  }
  if (SCHEMA_LIST_KEYS.has(key)) {
    return Array.isArray(value) ? value.map((sub) => walkSchema(sub, depth + 1, refs, walk)) : value
  }
  if (SCHEMA_MAP_KEYS.has(key)) {
    return walkMap(value, key, depth, refs, walk)
  }
  if (key === 'enum' && Array.isArray(value)) {
    return countEnum(value, walk)
  }
  if (key === 'const' && typeof value === 'string') {
    walk.stringChars += value.length
  }
  return value
}

/**
 * A subschema with its `$ref`s written out, and the references that took
 * (for the recursion check below it). A reference that recurs, or names
 * nothing here, is dropped with a note; its siblings stay.
 */
function dereferenced(
  node: JsonObject,
  refs: readonly string[],
  walk: Walk,
): { readonly schema: JsonObject; readonly refs: readonly string[] } {
  let schema = node
  let chain = refs
  for (;;) {
    const { $ref: ref, ...siblings } = schema
    if (typeof ref !== 'string') {
      return { schema, refs: chain }
    }
    const target = LOCAL_REF.test(ref) ? resolvePointer(walk.root, ref) : undefined
    if (!isObject(target) || chain.includes(ref)) {
      walk.notes.add(
        chain.includes(ref) ? 'a recursive reference was cut' : 'an unresolved reference was cut',
      )
      return { schema: siblings, refs: chain }
    }
    // The target's own `$ref`, if any, is followed on the next round.
    schema = { ...target, ...siblings }
    chain = [...chain, ref]
  }
}

/** One subschema rewritten within the limits; `refs` are the references being written out. */
function walkSchema(node: unknown, depth: number, refs: readonly string[], walk: Walk): unknown {
  if (!isObject(node)) {
    return node
  }
  walk.nodes += 1
  if (depth > MCP_SCHEMA_LIMITS.depth) {
    walk.notes.add(`parts nested deeper than ${String(MCP_SCHEMA_LIMITS.depth)} levels were cut`)
    return {}
  }
  const resolved = dereferenced(node, refs, walk)
  const out: JsonObject = {}
  for (const [key, value] of Object.entries(resolved.schema)) {
    if (DROPPED_KEYS.has(key)) {
      continue
    }
    const rewritten = walkKey(key, value, depth, resolved.refs, walk)
    if (rewritten !== undefined) {
      out[key] = rewritten
    }
  }
  return out
}

function isWithinLimits(walk: Walk): boolean {
  return (
    walk.nodes <= MCP_SCHEMA_LIMITS.nodes &&
    walk.properties <= MCP_SCHEMA_LIMITS.properties &&
    walk.stringChars <= MCP_SCHEMA_LIMITS.stringChars &&
    walk.enumValues <= MCP_SCHEMA_LIMITS.enumValues
  )
}

export interface FunctionParameters {
  readonly parameters: JsonObject
  /** What was cut, for the log; empty when the schema went through whole. */
  readonly notes: readonly string[]
  /** The schema could not be kept at all: the model gets "an object". */
  readonly isReplaced: boolean
}

const ANY_OBJECT: JsonObject = { type: 'object', properties: {}, additionalProperties: true }

/** A tool's `inputSchema` as a function's `parameters` Meta accepts. */
export function functionParameters(inputSchema: unknown): FunctionParameters {
  const root = isObject(inputSchema) ? inputSchema : {}
  const walk: Walk = {
    root,
    nodes: 0,
    properties: 0,
    stringChars: 0,
    enumValues: 0,
    notes: new Set(),
  }
  const rewritten = walkSchema(root, 0, [], walk)
  const parameters: JsonObject = isObject(rewritten) ? rewritten : {}
  parameters['type'] ??= 'object'
  if (parameters['type'] !== 'object' || !isWithinLimits(walk)) {
    return {
      parameters: { ...ANY_OBJECT },
      notes: [...walk.notes, 'the schema is past the Model API limits or not an object'],
      isReplaced: true,
    }
  }
  return { parameters, notes: [...walk.notes], isReplaced: false }
}

function clipDescription(text: string): string {
  return text.length > MCP_TOOL_DESCRIPTION_MAX_CHARS
    ? `${text.slice(0, MCP_TOOL_DESCRIPTION_MAX_CHARS)}…`
    : text
}

// The harness rewrite closes omitted object constraints intentionally. An MCP
// server owns its schema: closing an open object would remove valid arguments.
// Follow only schema positions; enum values and descriptions are data.
function isLosslessMcpSchema(schema: JsonObject, isOptional = false): boolean {
  const type = schema['type']
  if (
    (type === 'object' || (Array.isArray(type) && type.includes('object'))) &&
    schema['additionalProperties'] !== false
  ) {
    return false
  }
  // An added null sentinel must restore to omission. A nullable type whose
  // enum excludes null would retain that sentinel and violate the MCP enum.
  const values = schema['enum']
  if (
    isOptional &&
    Array.isArray(type) &&
    type.includes('null') &&
    Array.isArray(values) &&
    !values.includes(null)
  ) {
    return false
  }
  const properties = schema['properties']
  const required = schema['required']
  return (
    (!isObject(properties) ||
      Object.entries(properties).every(
        ([key, child]) =>
          isObject(child) &&
          isLosslessMcpSchema(child, !Array.isArray(required) || !required.includes(key)),
      )) &&
    (schema['items'] === undefined ||
      (isObject(schema['items']) && isLosslessMcpSchema(schema['items'])))
  )
}

/** The function the model is offered for a server's tool, with what its schema lost. */
export function mcpFunctionDefinition(
  name: string,
  tool: McpToolInfo,
): { readonly definition: FunctionToolDefinition; readonly notes: readonly string[] } {
  const { parameters, notes, isReplaced } = functionParameters(tool.inputSchema)
  const described = tool.description ?? tool.annotations?.title ?? tool.title ?? tool.name
  const description = clipDescription(
    isReplaced ? `${described}\n\n${MODEL_API_MODEL_TEXT.mcpSchemaReplaced}` : described,
  )
  const definition: FunctionToolDefinition = {
    type: 'function',
    name,
    description,
    parameters,
    strict: false,
  }
  // Preflight the original schema with M101's rewrite. A fitted schema can
  // already have lost a constraint (including $ref siblings), so it cannot
  // establish strict support. The existing pool logs these notes once when
  // offering the tool, naming its server and tool without schema contents.
  if (!isReplaced && notes.length === 0 && isObject(tool.inputSchema)) {
    try {
      withStrictTools([{ ...definition, parameters: tool.inputSchema }], true)
      if (isLosslessMcpSchema(tool.inputSchema)) return { definition, notes }
    } catch (error: unknown) {
      if (!(error instanceof Error) || error.message !== 'strict_tool_schema_unsupported') {
        throw error
      }
    }
  }
  return {
    definition: { ...definition, [NON_STRICT_TOOL]: true },
    notes: [...notes, 'strict: false; the schema cannot be converted losslessly'],
  }
}

// --- results ---

/** What one call gives the model and the transcript row. */
export interface McpCallOutcome {
  /** The model's text; with pictures, the text part of `outputParts`. */
  readonly output: string
  readonly outputParts?: readonly FunctionOutputPart[]
  readonly visibleOutput: string
  readonly failureReason?: string
}

const STRICT_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const WHITESPACE = /\s+/g

/** The picture as an `input_image` part, or why it is described in words instead. */
function imagePart(
  data: string,
): { readonly part: FunctionOutputPart } | { readonly reason: string } {
  const compact = data.replaceAll(WHITESPACE, '')
  if (!STRICT_BASE64.test(compact)) {
    return { reason: 'its data is not base64' }
  }
  const bytes = Buffer.from(compact, 'base64')
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { reason: `it is over ${String(MAX_IMAGE_BYTES)} bytes` }
  }
  const info = readImageInfo(bytes)
  if (info === undefined) {
    return { reason: 'it is not a PNG, JPEG, GIF or WebP image' }
  }
  return {
    part: {
      type: 'input_image',
      image_url: `data:${info.mediaType};base64,${compact}`,
      detail: 'auto',
    },
  }
}

interface Collected {
  readonly texts: string[]
  readonly images: FunctionOutputPart[]
  readonly shown: string[]
}

function collectImage(data: string, mimeType: string, collected: Collected): void {
  const image = imagePart(data)
  if ('part' in image) {
    collected.images.push(image.part)
    collected.shown.push(`[image ${mimeType}]`)
    return
  }
  const note = `[image ${mimeType} not passed on: ${image.reason}]`
  collected.texts.push(note)
  collected.shown.push(note)
}

function collectBlock(block: ContentBlock, collected: Collected): void {
  const add = (text: string) => {
    collected.texts.push(text)
    collected.shown.push(text)
  }
  switch (block.type) {
    case 'text': {
      add(block.text)
      return
    }
    case 'image': {
      collectImage(block.data, block.mimeType, collected)
      return
    }
    case 'audio': {
      add(`[audio ${block.mimeType} not passed on: ${MODEL_API_MODEL_TEXT.mcpTextAndImagesOnly}]`)
      return
    }
    case 'resource_link': {
      const about = block.description === undefined ? '' : ` (${block.description})`
      add(`[resource link] ${block.name ?? block.uri}: ${block.uri}${about}`)
      return
    }
    case 'resource': {
      const { resource } = block
      if (resource.text !== undefined) {
        add(`[resource ${resource.uri}]\n${resource.text}`)
      } else if (resource.blob !== undefined && resource.mimeType?.startsWith('image/') === true) {
        collectImage(resource.blob, resource.mimeType, collected)
      } else {
        add(
          `[resource ${resource.uri} (${resource.mimeType ?? 'binary'}) not passed on: ${MODEL_API_MODEL_TEXT.mcpTextAndImagesOnly}]`,
        )
      }
    }
  }
}

function clip(text: string): string {
  return text.length > TOOL_OUTPUT_MAX_CHARS
    ? `${text.slice(0, TOOL_OUTPUT_MAX_CHARS)}${TOOL_OUTPUT_CLIP_MARKER}`
    : text
}

/** A `tools/call` result as the model and the row get it. */
export function mcpCallOutcome(result: CallToolResult): McpCallOutcome {
  const collected: Collected = { texts: [], images: [], shown: [] }
  const blocks = result.content ?? []
  for (const raw of blocks) {
    const block = contentBlockSchema.safeParse(raw)
    if (block.success) {
      collectBlock(block.data, collected)
    } else {
      const type = isObject(raw) && typeof raw['type'] === 'string' ? raw['type'] : 'unknown'
      const note = `[content of type ${type} not passed on]`
      collected.texts.push(note)
      collected.shown.push(note)
    }
  }
  // Structured content stands in for text only when there is none (a
  // server of revision 2025-06-18 should send both).
  if (collected.texts.length === 0 && result.structuredContent !== undefined) {
    const json = JSON.stringify(result.structuredContent, undefined, 2)
    collected.texts.push(json)
    collected.shown.push(json)
  }
  const body =
    collected.texts.length === 0 ? MODEL_API_MODEL_TEXT.mcpNoContent : collected.texts.join('\n')
  const text = clip(body)
  const visibleOutput = clip(collected.shown.length === 0 ? body : collected.shown.join('\n'))
  const output = result.isError === true ? `Error: ${text}` : text
  return {
    output,
    ...(collected.images.length > 0 && {
      outputParts: [{ type: 'input_text', text: output }, ...collected.images],
    }),
    visibleOutput,
    ...(result.isError === true && { failureReason: text }),
  }
}
