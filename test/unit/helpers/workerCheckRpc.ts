// The worker's side of `run_checks`: the MCP protocol a Muse Code session speaks to its session
// server, JSON-RPC over HTTP with the task's token.
import type { WorkerCheckEndpoint } from '../../../src/host/team/workerChecks'
import { TEAM_CHECKS_SERVER } from '../../../src/shared/constants'

export interface Reply {
  readonly status: number
  readonly body?: {
    result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] }
  }
}

/** One JSON-RPC request to the task's session server. */
export async function rpc(
  endpoint: WorkerCheckEndpoint,
  method: string,
  params: unknown = {},
  signal?: AbortSignal,
): Promise<Reply> {
  const server = endpoint.servers[TEAM_CHECKS_SERVER]
  if (server === undefined || !('url' in server)) throw new Error('the endpoint has no server')
  const response = await fetch(server.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...server.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    ...(signal !== undefined && { signal }),
  })
  const text = await response.text()
  return {
    status: response.status,
    ...(text !== '' && { body: JSON.parse(text) as NonNullable<Reply['body']> }),
  }
}

export const callRunChecks = async (
  endpoint: WorkerCheckEndpoint,
  args: unknown = {},
  signal?: AbortSignal,
) => await rpc(endpoint, 'tools/call', { name: 'run_checks', arguments: args }, signal)

export const replyText = (reply: Reply) => reply.body?.result?.content?.[0]?.text ?? ''
