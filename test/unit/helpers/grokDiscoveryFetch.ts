// The recorded xAI discovery document and a fetch that answers ONLY with
// it: every other request refuses, so the Grok tests assert our own
// request shapes and refusal codes instead of inventing xAI's answers.
// Capture: `curl -sm 20 https://auth.x.ai/.well-known/openid-configuration`
// (2026-10-22) into `test/fixtures/grok/discovery.json`.
import { readFileSync } from 'node:fs'

/** A documented-shaped placeholder: xAI has issued this app no client id. */
export const CLIENT_ID = 'muse-spark-code.test-client'
export const DISCOVERY_URL = 'https://auth.x.ai/.well-known/openid-configuration'

export function discoveryFixture(): unknown {
  return JSON.parse(
    readFileSync(new URL('../../fixtures/grok/discovery.json', import.meta.url), 'utf8'),
  )
}

function jsonResponse(json: unknown, status = 200): Response {
  return Response.json(json, { status })
}

export interface FetchCall {
  readonly url: string
  readonly method: string
  readonly form: URLSearchParams | undefined
}

/** One fetch call's address, method and form body, for the recording fetches. */
export function readFetchCall(url: Parameters<typeof fetch>[0], init?: RequestInit): FetchCall {
  const href = url instanceof Request ? url.url : String(url)
  const method = init?.method ?? (url instanceof Request ? url.method : 'GET')
  const body = init?.body
  let form: URLSearchParams | undefined
  if (typeof body === 'string') form = new URLSearchParams(body)
  else if (body instanceof URLSearchParams) form = body
  return { url: href, method, form }
}

/**
A fetch that answers only with the recorded discovery document and refuses
everything else: the tests assert our request shapes from its calls, and
xAI's other answers are never invented here.
*/
export function discoveryOnlyFetch(
  options: {
    readonly discovery?: unknown
    readonly calls?: FetchCall[]
  } = {},
): typeof fetch {
  const discovery = options.discovery === undefined ? discoveryFixture() : options.discovery
  const stub: typeof fetch = (url, init) => {
    const call = readFetchCall(url, init)
    options.calls?.push(call)
    return call.url === DISCOVERY_URL && call.method === 'GET'
      ? Promise.resolve(jsonResponse(discovery))
      : Promise.reject(new Error(`no recorded answer for ${call.method} ${call.url}`))
  }
  return stub
}

/** The endpoints the recorded discovery advertises; our requests must name these. */
export function discoveryEndpoints(): {
  readonly authorization: string
  readonly token: string
  readonly device: string
  readonly revocation: string
} {
  const fields = discoveryFixture() as Record<string, unknown>
  const pick = (name: string): string => {
    const value = fields[name]
    if (typeof value !== 'string' || value === '')
      throw new Error(`the recorded discovery no longer names ${name}`)
    return value
  }
  return {
    authorization: pick('authorization_endpoint'),
    token: pick('token_endpoint'),
    device: pick('device_authorization_endpoint'),
    revocation: pick('revocation_endpoint'),
  }
}
