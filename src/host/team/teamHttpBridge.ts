// Where the stdio bridge may forward (PLAN.md D250). The endpoint URL and
// its headers arrive in the environment the external agent was given. The
// bearer token in those headers is this conversation's proof, so the bridge
// posts it only to the loopback team server, never to a name that resolves
// somewhere else. A refusal is a fixed sentence: the URL itself can carry
// the token and is never repeated.

import { request as httpRequest } from 'node:http'
import * as z from 'zod/mini'

export const BRIDGE_URL_ENV = 'MUSE_TEAM_BRIDGE_URL'
export const BRIDGE_HEADERS_ENV = 'MUSE_TEAM_BRIDGE_HEADERS'
export const BRIDGE_LOOPBACK_REFUSAL = 'the team bridge only forwards to the loopback team endpoint'

const JSON_RPC_VERSION = '2.0'
const HTTP_OK_FLOOR = 200
const HTTP_OK_CEILING = 300
const JSON_RPC_INTERNAL_ERROR = -32_603

const headersSchema = z.record(z.string(), z.string())
const requestIdSchema = z.looseObject({
  id: z.optional(z.union([z.string(), z.number(), z.null()])),
})

export class BridgeEndpointError extends Error {
  public constructor() {
    super(BRIDGE_LOOPBACK_REFUSAL)
    this.name = 'BridgeEndpointError'
  }
}

// Node reports the IPv6 hostname with brackets (`[::1]`). Either spelling
// is the same address; nothing else is, including a name that merely
// resolves there.
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '[::1]'])

function isLoopbackLiteral(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname)
}

/**
The authority of `raw`, or undefined when it is not an HTTP URL. The check
uses the text the caller gave, not the address `new URL` rewrites a decimal
or hex number into: the bridge posts only to a literal `127.0.0.1` or `[::1]`.
*/
function literalAuthority(raw: string): string | undefined {
  const match = /^https?:\/\/([^/?#]*)/i.exec(raw)
  return match?.[1]
}

function isLiteralLoopbackAuthority(authority: string): boolean {
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    if (end === -1) return false
    const name = authority.slice(1, end)
    const rest = authority.slice(end + 1)
    return name === '::1' && (rest === '' || /^:\d+$/.test(rest))
  }
  const colon = authority.lastIndexOf(':')
  return colon === -1
    ? authority === '127.0.0.1'
    : authority.slice(0, colon) === '127.0.0.1' && /^\d+$/.test(authority.slice(colon + 1))
}

function isHeaderParseFailure(error: unknown): boolean {
  return (
    error instanceof SyntaxError ||
    (error instanceof Error && error.name === '$ZodError' && 'issues' in error)
  )
}

/** The endpoint the bridge will post to, or a refusal when it is not loopback HTTP. */
export function bridgeEndpoint(env: NodeJS.ProcessEnv): {
  readonly url: URL
  readonly headers: Record<string, string>
} {
  const raw = env[BRIDGE_URL_ENV]
  if (raw === undefined || raw === '') throw new Error(`${BRIDGE_URL_ENV} is not set`)
  let url: URL
  try {
    url = new URL(raw)
  } catch (error: unknown) {
    // `new URL` rejects a string that is not a URL. Anything else is a bug.
    if (error instanceof TypeError) throw new BridgeEndpointError()
    throw error
  }
  const authority = literalAuthority(raw)
  if (
    authority === undefined ||
    url.protocol !== 'http:' ||
    !isLiteralLoopbackAuthority(authority) ||
    !isLoopbackLiteral(url.hostname)
  ) {
    throw new BridgeEndpointError()
  }
  const headersRaw = env[BRIDGE_HEADERS_ENV]
  if (headersRaw === undefined) return { url, headers: {} }
  try {
    return { url, headers: headersSchema.parse(JSON.parse(headersRaw) as unknown) }
  } catch (error: unknown) {
    // A header block that does not parse can quote the bearer in the
    // parser's own message. The refusal is the fixed sentence. Anything
    // else stays loud.
    if (isHeaderParseFailure(error)) throw new BridgeEndpointError()
    throw error
  }
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
  } catch (error: unknown) {
    // A line that is not JSON carries no id to answer to; anything else is
    // a bridge fault and keeps its kind.
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

// The errno words of a loopback endpoint that is down, gone or unreachable.
const TRANSPORT_FAILURES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
])

function isTransportFailure(error: unknown): error is Error & { readonly code: string } {
  return error instanceof Error && 'code' in error && TRANSPORT_FAILURES.has(String(error.code))
}

function errorLine(id: string | number | null, message: string): string {
  return JSON.stringify({
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: { code: JSON_RPC_INTERNAL_ERROR, message },
  })
}

/**
The JSON-RPC answer for one stdio line, or undefined when the line is a
notification. A non-loopback endpoint is a said refusal and is never posted.
*/
export async function bridgeAnswer(
  line: string,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const id = requestIdOf(line)
  let target: { readonly url: URL; readonly headers: Record<string, string> }
  try {
    target = bridgeEndpoint(env)
  } catch (error: unknown) {
    // A non-loopback endpoint is refused in a fixed sentence. The URL can
    // carry the bearer, so it is never repeated. A missing endpoint
    // variable stays loud.
    if (!(error instanceof BridgeEndpointError)) throw error
    process.stderr.write(`team bridge: ${BRIDGE_LOOPBACK_REFUSAL}\n`)
    return id === undefined ? undefined : errorLine(id, error.message)
  }
  let answer: { readonly status: number; readonly text: string }
  try {
    answer = await post(target.url, target.headers, line)
  } catch (error: unknown) {
    // A named transport failure is the refusal the client reads, by its
    // errno word. Anything else is a bridge fault and keeps its kind.
    if (!isTransportFailure(error)) throw error
    process.stderr.write(`team bridge: endpoint ${error.code}\n`)
    return id === undefined
      ? undefined
      : errorLine(id, `the team endpoint is unreachable (${error.code})`)
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
