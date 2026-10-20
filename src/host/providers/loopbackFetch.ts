// The local-server probe's fetch (M95 step 1, PLAN.md D74): plain
// `node:http` GETs to loopback only, never through a proxy.
//
// VS Code patches the extension host's `fetch` to honor `http.proxy`
// (@vscode/proxy-agent), so a probe through it can fail on proxy auth or a
// refused tunnel, or hand request metadata to the proxy. Loopback needs no
// proxy at all, so the probe does not use that fetch. Anything that is not
// an `http:` URL on 127.0.0.1 or ::1 is refused before any lookup or
// connection, as is any URL carrying credentials or a non-GET method; bodies
// past the cap are refused rather than read, and the probe reports those as
// unanswered. `localhost` is refused too: it can resolve off loopback, and
// the probe's targets always name 127.0.0.1 literally.

import { request as httpRequest } from 'node:http'
import {
  LOOPBACK_FETCH_DEFAULT_PORT,
  LOOPBACK_FETCH_MAX_BODY_BYTES,
  LOOPBACK_FETCH_NULL_BODY_STATUSES,
} from '../../shared/constants'

/** The only hosts this fetch ever dials (brackets stripped: see below). */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1'])

/** Why a loopback fetch was refused before any connection. */
function refuse(what: string): Promise<never> {
  return Promise.reject(new Error(`loopback fetch refuses ${what}`))
}

/**
A `fetch` for the local-server probe: GETs an `http:` loopback URL over
`node:http` with no proxy, no redirect following and no credentials.
*/
export function fetchLoopback(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  let url: string
  if (typeof input === 'string') {
    url = input
  } else if (input instanceof Request) {
    url = input.url
  } else {
    url = input.href
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return refuse('an unparsable URL')
  }
  if (parsed.protocol !== 'http:') {
    return refuse(`a ${parsed.protocol} URL`)
  }
  // Node keeps the brackets in an IPv6 URL's hostname (`[::1]`), so strip
  // them before the allowlist check or every `http://[::1]/...` probe is
  // refused before connect (C-M95-4 R2).
  const host = parsed.hostname.replaceAll(/^\[|\]$/g, '')
  if (!LOOPBACK_HOSTS.has(host)) {
    return refuse(`a non-loopback host (${parsed.hostname})`)
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return refuse('a URL carrying credentials')
  }
  const method =
    init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
  if (method !== 'GET') {
    return refuse(`a ${method} request`)
  }
  const port = parsed.port === '' ? LOOPBACK_FETCH_DEFAULT_PORT : Number(parsed.port)
  return new Promise<Response>((resolve, reject) => {
    // Every path below settles the promise exactly once through `settle`:
    // nothing here may throw or reject outside it, or the probe hangs
    // until its timeout (C-M95-4 R2: a 204's empty body used to throw in
    // the `'end'` handler, past `isSettled = true`, unsettled forever).
    let isSettled = false
    const settle = (run: () => void): void => {
      if (isSettled) {
        return
      }
      isSettled = true
      run()
    }
    const fail = (error: Error): void => {
      settle(() => {
        request.destroy()
        reject(error)
      })
    }
    const request = httpRequest(
      {
        host,
        port,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
      },
      (incoming) => {
        const status = incoming.statusCode
        if (status === undefined) {
          fail(new Error('loopback fetch refuses a response without a status'))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        incoming.on('data', (chunk: Buffer) => {
          size += chunk.byteLength
          if (size > LOOPBACK_FETCH_MAX_BODY_BYTES) {
            fail(
              new Error(
                `loopback fetch refuses a body past ${String(LOOPBACK_FETCH_MAX_BODY_BYTES)} bytes`,
              ),
            )
            return
          }
          chunks.push(chunk)
        })
        incoming.on('end', () => {
          let response: Response
          try {
            const headers = new Headers()
            for (const [name, value] of Object.entries(incoming.headers)) {
              if (Array.isArray(value)) {
                for (const item of value) {
                  headers.append(name, item)
                }
              } else if (value !== undefined) {
                headers.set(name, value)
              }
            }
            // A null-body status with a body throws; an empty buffer is
            // still a body, so these answers ride `null` (C-M95-4 R2).
            const body = LOOPBACK_FETCH_NULL_BODY_STATUSES.includes(status)
              ? null
              : Buffer.concat(chunks)
            response = new Response(body, { status, headers })
          } catch (error) {
            const cause =
              error instanceof Error
                ? error
                : new Error('loopback fetch refuses an unreadable answer')
            fail(cause)
            return
          }
          settle(() => {
            resolve(response)
          })
        })
        incoming.on('error', fail)
      },
    )
    request.on('error', fail)
    const signal = init?.signal
    if (signal !== undefined && signal !== null) {
      const abort = (): void => {
        settle(() => {
          request.destroy()
          reject(
            signal.reason instanceof Error ? signal.reason : new Error('loopback fetch aborted'),
          )
        })
      }
      if (signal.aborted) {
        abort()
        return
      }
      signal.addEventListener('abort', abort, { once: true })
    }
    request.end()
  })
}
