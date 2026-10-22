// The Model Context Protocol as the Model API backend's client speaks it
// (M50, PLAN.md D42; both eras, PLAN.md D213): JSON-RPC 2.0 messages, and
// the results of the requests it sends (`server/discover`, `initialize`,
// `tools/list`, `tools/call`). The shapes are the MCP specification's,
// revision 2025-06-18 (schema.ts), which Muse Code's own client
// advertises, and revision 2026-07-28 for the modern era. They are read
// leniently: unknown fields pass, and a malformed tool or content block
// is passed over by its caller rather than failing the whole server. Pure.

import * as z from 'zod/mini'
import {
  MCP_ERROR_UNSUPPORTED_PROTOCOL_VERSION,
  MCP_MODERN_PROTOCOL_VERSIONS,
} from '../../../../shared/constants'

export const JSON_RPC_VERSION = '2.0'

const requestIdSchema = z.union([z.string(), z.number()])
export type RequestId = z.infer<typeof requestIdSchema>

const errorObjectSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.optional(z.unknown()),
})

/** Any message a server sends: a response, a request of its own, or a notification. */
export const incomingMessageSchema = z.object({
  jsonrpc: z.literal(JSON_RPC_VERSION),
  id: z.optional(z.nullable(requestIdSchema)),
  method: z.optional(z.string()),
  params: z.optional(z.unknown()),
  result: z.optional(z.unknown()),
  error: z.optional(errorObjectSchema),
})
export type IncomingMessage = z.infer<typeof incomingMessageSchema>

/** A message this client sends. */
export type OutgoingMessage =
  | {
      readonly jsonrpc: typeof JSON_RPC_VERSION
      readonly id: RequestId
      readonly method: string
      readonly params?: Readonly<Record<string, unknown>>
    }
  | {
      readonly jsonrpc: typeof JSON_RPC_VERSION
      readonly method: string
      readonly params?: Readonly<Record<string, unknown>>
    }
  | { readonly jsonrpc: typeof JSON_RPC_VERSION; readonly id: RequestId; readonly result: unknown }
  | {
      readonly jsonrpc: typeof JSON_RPC_VERSION
      readonly id: RequestId
      readonly error: { readonly code: number; readonly message: string }
    }

/** Whether a message expects an answer (it carries an id and a method). */
export function isRequest(
  message: OutgoingMessage,
): message is Extract<OutgoingMessage, { readonly method: string; readonly id: RequestId }> {
  return 'id' in message && 'method' in message
}

export const initializeResultSchema = z.object({
  protocolVersion: z.string(),
  capabilities: z.object({
    tools: z.optional(z.object({ listChanged: z.optional(z.boolean()) })),
  }),
  serverInfo: z.optional(z.object({ name: z.string(), version: z.optional(z.string()) })),
})

export const listToolsResultSchema = z.object({
  tools: z.array(z.unknown()),
  nextCursor: z.optional(z.nullable(z.string())),
})

/** One tool as `tools/list` describes it; only what the client uses. */
export const toolInfoSchema = z.object({
  name: z.string(),
  title: z.optional(z.string()),
  description: z.optional(z.string()),
  inputSchema: z.optional(z.record(z.string(), z.unknown())),
  annotations: z.optional(
    z.object({ title: z.optional(z.string()), readOnlyHint: z.optional(z.boolean()) }),
  ),
})
export type McpToolInfo = z.infer<typeof toolInfoSchema>

export const callToolResultSchema = z.object({
  content: z.optional(z.array(z.unknown())),
  structuredContent: z.optional(z.unknown()),
  isError: z.optional(z.boolean()),
})
export type CallToolResult = z.infer<typeof callToolResultSchema>

/** The content blocks a tool result may hold (spec `ContentBlock`). */
export const contentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() }),
  z.object({ type: z.literal('audio'), data: z.string(), mimeType: z.string() }),
  z.object({
    type: z.literal('resource_link'),
    uri: z.string(),
    name: z.optional(z.string()),
    description: z.optional(z.string()),
  }),
  z.object({
    type: z.literal('resource'),
    resource: z.object({
      uri: z.string(),
      mimeType: z.optional(z.string()),
      text: z.optional(z.string()),
      blob: z.optional(z.string()),
    }),
  }),
])
export type ContentBlock = z.infer<typeof contentBlockSchema>

/** `notifications/message`: a server's own log line. */
export const logMessageSchema = z.object({
  level: z.string(),
  logger: z.optional(z.string()),
  data: z.unknown(),
})

/** A JSON-RPC error answer, or a failure this client names itself. */
export class McpError extends Error {
  public constructor(
    message: string,
    /** The JSON-RPC error code, when the server answered with one. */
    public readonly code?: number,
    /** The error's `data`, when the server sent one (a `-32022` names its versions here). */
    public readonly data?: unknown,
  ) {
    super(message)
    this.name = 'McpError'
  }
}

/** `server/discover`'s answer; only what the client uses (the versions, the tools capability). */
export const discoverResultSchema = z.object({
  supportedVersions: z.array(z.string()),
  capabilities: z.object({
    tools: z.optional(z.object({ listChanged: z.optional(z.boolean()) })),
  }),
})
export type DiscoverResult = z.infer<typeof discoverResultSchema>

/**
A `-32022`'s `data`: the versions the server serves, and what was asked
for. `requested` is absent when the request named none (the v2 SDK
answers that shape, captured 2026-10-22).
*/
export const unsupportedVersionDataSchema = z.object({
  supported: z.array(z.string()),
  requested: z.optional(z.string()),
})
export type UnsupportedVersionData = z.infer<typeof unsupportedVersionDataSchema>

/** The versions off a `-32022`, or undefined when the error names none usable. */
export function unsupportedVersions(error: McpError): UnsupportedVersionData | undefined {
  if (error.code !== MCP_ERROR_UNSUPPORTED_PROTOCOL_VERSION) {
    return undefined
  }
  const parsed = unsupportedVersionDataSchema.safeParse(error.data)
  return parsed.success ? parsed.data : undefined
}

/**
The newest modern revision both sides speak, or undefined when they
share none (`MCP_MODERN_PROTOCOL_VERSIONS` runs oldest to newest).
*/
export function newestMutualModern(supported: readonly string[]): string | undefined {
  let mutual: string | undefined
  for (const version of MCP_MODERN_PROTOCOL_VERSIONS) {
    if (supported.includes(version)) {
      mutual = version
    }
  }
  return mutual
}

const resultTypeSchema = z.object({ resultType: z.optional(z.unknown()) })

/**
A result's `resultType` (spec `basic/index#resulttype`): the value, or
undefined when the result names none (a legacy answer reads as `complete`).
*/
export function resultTypeOf(result: unknown): unknown {
  const parsed = resultTypeSchema.safeParse(result)
  return parsed.success ? parsed.data.resultType : undefined
}

/**
An `input_required` tools/call result (spec `basic/patterns/mrtr`): the
rounds the client must run, and the opaque state echoed back untouched.
*/
export const inputRequiredResultSchema = z.object({
  resultType: z.literal('input_required'),
  inputRequests: z.optional(z.record(z.string(), z.unknown())),
  requestState: z.optional(z.string()),
})
export type InputRequiredResult = z.infer<typeof inputRequiredResultSchema>

/** One `inputRequests` entry: the server-side method and its params. */
export const inputRequestSchema = z.object({
  method: z.string(),
  params: z.optional(z.unknown()),
})
