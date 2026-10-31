// The stdio-to-HTTP bridge for an external orchestrator (PLAN.md D250),
// a bundle of its own (`dist/teamHttpBridge.js`). An ACP agent that does
// not advertise HTTP MCP transport spawns this as its stdio MCP server; the
// bridge forwards every JSON-RPC line, unchanged, to the conversation's
// loopback team MCP endpoint and writes each answer back. It implements no
// tool itself — the endpoint stays the one implementation, with its
// per-conversation token, instructions and durable `command_id` answers.
//
// The endpoint and its headers arrive through the environment the client
// set in `session/new` (`MUSE_TEAM_BRIDGE_URL`,
// `MUSE_TEAM_BRIDGE_HEADERS` as a JSON object). A line that is not JSON,
// or a request the endpoint refuses at the HTTP layer, is answered with a
// JSON-RPC error naming the refusal's status — never dropped silently.

import { request as httpRequest } from 'node:http'
import { createInterface } from 'node:readline'
import * as z from 'zod/mini'

const BRIDGE_URL_ENV = 'MUSE_TEAM_BRIDGE_URL'
const BRIDGE_HEADERS_ENV = 'MUSE_TEAM_BRIDGE_HEADERS'
const JSON_RPC_VERSION = '2.0'
const HTTP_OK_FLOOR = 200
const HTTP_OK_CEILING = 300

const headersSchema = z.record(z.string(), z.string())
const requestIdSchema = z.looseObject({
  id: z.optional(z.union([z.string(), z.number(), z.null()])),
})

function endpoint(): { readonly url: URL; readonly headers: Record<string, string> } {
  const raw = process.env[BRIDGE_URL_ENV]
  if (raw === undefined || raw === '') throw new Error(`${BRIDGE_URL_ENV} is not set`)
  const url = new URL(raw)
  const headersRaw = process.env[BRIDGE_HEADERS_ENV]
  const headers =
    headersRaw === undefined ? {} : headersSchema.parse(JSON.parse(headersRaw) as unknown)
  return { url, headers }
}

/** One HTTP answer: its status and full body text (empty for a 202). */
async function post(
  url: URL,
  headers: Record<string, string>,
  body: string,
): Promise<{ readonly status: number; readonly text: string }> {
  return await new Promise((resolvePost, rejectPost) => {
    const request = httpRequest(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        response.once('error', rejectPost)
        response.once('end', () => {
          resolvePost({
            status: response.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    request.once('error', rejectPost)
    request.end(body)
  })
}

function requestIdOf(line: string): string | number | null | undefined {
  try {
    return requestIdSchema.parse(JSON.parse(line) as unknown).id
  } catch {
    return undefined
  }
}

// JSON-RPC's internal-error code, for a refusal the endpoint made at HTTP.
const JSON_RPC_INTERNAL_ERROR = -32_603

function errorLine(id: string | number | null, message: string): string {
  return JSON.stringify({
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: { code: JSON_RPC_INTERNAL_ERROR, message },
  })
}

async function forward(line: string): Promise<string | undefined> {
  const { url, headers } = endpoint()
  const id = requestIdOf(line)
  let answer: { readonly status: number; readonly text: string }
  try {
    answer = await post(url, headers, line)
  } catch {
    return id === undefined ? undefined : errorLine(id, 'the team endpoint is unreachable')
  }
  if (answer.status >= HTTP_OK_FLOOR && answer.status < HTTP_OK_CEILING) {
    return answer.text === '' ? undefined : answer.text
  }
  // A refusal the endpoint already phrased as JSON-RPC passes through; a
  // bare HTTP refusal (a wrong token's 401) becomes one, with its status.
  if (answer.text.startsWith('{') && answer.text.includes('"error"')) return answer.text
  return id === undefined
    ? undefined
    : errorLine(id, `the team endpoint refused (HTTP ${String(answer.status)})`)
}

async function main(): Promise<void> {
  const lines = createInterface({ input: process.stdin, terminal: false })
  // Serial: the endpoint's durable answers assume a request settles before
  // its retry arrives, and stdio clients read answers in order.
  for await (const line of lines) {
    if (line.trim() === '') continue
    const answer = await forward(line)
    if (answer !== undefined) process.stdout.write(`${answer}\n`)
  }
}

void main()
