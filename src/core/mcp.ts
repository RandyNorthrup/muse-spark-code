// The Model Context Protocol server side, reduced to what an IDE tool server
// needs: JSON-RPC 2.0 messages over the streamable-HTTP transport
// (`initialize`, `notifications/initialized`, `ping`, `tools/list`,
// `tools/call`). Verified against `muse serve` 1.3.0 on 2026-09-22: it
// speaks protocol 2025-06-18, sends `initialize`, the initialized
// notification and `tools/list` at session start. Pure: the host owns the
// socket and the tool implementations.

import * as z from 'zod/mini'
import { JSON_RPC_ERRORS, MCP_PROTOCOL_VERSION } from '../shared/constants'

export interface McpTool {
  readonly name: string
  readonly description: string
  /** JSON Schema for the arguments. */
  readonly inputSchema: Readonly<Record<string, unknown>>
  /** The tool's text result; throw to report a tool error. */
  readonly call: (args: Readonly<Record<string, unknown>>) => Promise<string>
}

export interface McpServerInfo {
  readonly name: string
  readonly version: string
}

/** What the transport does with a message: answer it, or just accept it. */
export type McpOutcome =
  | { readonly kind: 'response'; readonly body: Readonly<Record<string, unknown>> }
  | { readonly kind: 'accepted' }

const messageSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.optional(z.union([z.string(), z.number(), z.null()])),
  method: z.optional(z.string()),
  params: z.optional(z.record(z.string(), z.unknown())),
})

const JSON_RPC_VERSION = '2.0'

function errorResponse(id: unknown, code: number, message: string): McpOutcome {
  return {
    kind: 'response',
    body: { jsonrpc: JSON_RPC_VERSION, id: id ?? null, error: { code, message } },
  }
}

function resultResponse(id: unknown, result: unknown): McpOutcome {
  return { kind: 'response', body: { jsonrpc: JSON_RPC_VERSION, id, result } }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function callTool(
  tools: readonly McpTool[],
  params: Readonly<Record<string, unknown>> | undefined,
): Promise<unknown> {
  const name = params?.['name']
  const tool = tools.find((candidate) => candidate.name === name)
  if (tool === undefined) {
    return { content: [{ type: 'text', text: `Unknown tool: ${String(name)}` }], isError: true }
  }
  const rawArgs = params?.['arguments']
  const args =
    typeof rawArgs === 'object' && rawArgs !== null ? (rawArgs as Record<string, unknown>) : {}
  try {
    return { content: [{ type: 'text', text: await tool.call(args) }] }
  } catch (error: unknown) {
    return { content: [{ type: 'text', text: describe(error) }], isError: true }
  }
}

/**
 * Handles one raw request body. A notification (no `id`) is accepted without
 * a body; anything else gets a JSON-RPC response, including parse errors.
 */
export async function handleMcpMessage(
  raw: string,
  tools: readonly McpTool[],
  serverInfo: McpServerInfo,
): Promise<McpOutcome> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return errorResponse(null, JSON_RPC_ERRORS.parseError, 'Parse error')
  }
  const result = messageSchema.safeParse(parsed)
  if (!result.success) {
    return errorResponse(null, JSON_RPC_ERRORS.invalidRequest, 'Invalid request')
  }
  const message = result.data
  if (message.id === undefined || message.id === null) {
    return { kind: 'accepted' }
  }
  switch (message.method) {
    case 'initialize': {
      const requested = message.params?.['protocolVersion']
      return resultResponse(message.id, {
        protocolVersion: typeof requested === 'string' ? requested : MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo,
      })
    }
    case 'ping': {
      return resultResponse(message.id, {})
    }
    case 'tools/list': {
      return resultResponse(message.id, {
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      })
    }
    case 'tools/call': {
      return resultResponse(message.id, await callTool(tools, message.params))
    }
    default: {
      return errorResponse(
        message.id,
        JSON_RPC_ERRORS.methodNotFound,
        `Method not found: ${message.method ?? ''}`,
      )
    }
  }
}
