// Web fetch's transport (M69, PLAN.md D49): one HTTPS GET made to the
// address the fetch checked, never to a name looked up again. Node's `https`
// is asked to connect to that IP address; TLS still sends and verifies the
// page's own name (`servername`), and the `Host` header carries it.
//
// Through VS Code's proxy: VS Code patches Node's `https` module in place
// for every extension (proxyResolver.ts in VS Code 1.125 and later, with
// @vscode/proxy-agent), so this request takes the user's proxy (`http.proxy`,
// the system's or a PAC file's, `http.noProxy`) and their certificates as
// the Model API's `fetch` does (M56). Its proxy agent tunnels with
// `CONNECT <address>:<port>` for the address given here, and upgrades the
// tunnel to TLS with our `servername`, so a proxy never resolves the name
// either: the request stays pinned or fails. VS Code's patched `fetch`
// cannot pin: it replaces a caller's dispatcher with its own agent, which
// keeps only the certificates and HTTP/2 options (@vscode/proxy-agent's
// `createFetchPatch`, read 2026-09-27), so the fetch uses `https`.
//
// Only an answer that came over TLS is read. A proxy that refuses the tunnel
// (a policy against addresses, missing credentials) answers the CONNECT
// itself, and https-proxy-agent hands that answer to the request on a plain
// socket; it is refused as the proxy's (WEB_FETCH_NOT_TLS_CODE), never read
// as the page's.
//
// The proxy decision sees the address too. @vscode/proxy-agent 0.45.0 (VS
// Code 1.139.1's) builds the URL it resolves a proxy for from the request's
// `host` (agent.js: `hostname: opts.host`), and `http.noProxy` and the
// environment's NO_PROXY match that host name's suffix (index.js
// `noProxyFromConfig`). With the pinned address there, a PAC rule or a
// no-proxy entry written for a host name does not match; one written for
// addresses does. Giving the name instead would let the proxy resolve it
// again, which pinning exists to prevent, so the address stays.

import type { ClientRequest, IncomingMessage } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import type { Socket } from 'node:net'
import { TLSSocket } from 'node:tls'
import type { PinnedResponse, PinnedTarget } from '../../core/web/webFetch'
import { addressFamily } from '../../core/web/publicAddress'
import {
  WEB_FETCH_ACCEPT,
  WEB_FETCH_ACCEPT_ENCODING,
  WEB_FETCH_DEFAULT_PORT,
  WEB_FETCH_NOT_TLS_CODE,
  WEB_FETCH_USER_AGENT,
} from '../../shared/constants'

/** Node's `https.request`, or a test's stand-in with the same shape. */
export type RequestFunction = (
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => ClientRequest

/** The request options for a pinned GET: the address to connect to, the name to verify. */
export function pinnedOptions(target: PinnedTarget, signal: AbortSignal): RequestOptions {
  const { url } = target
  return {
    method: 'GET',
    host: target.address,
    family: target.family,
    port: url.port === '' ? WEB_FETCH_DEFAULT_PORT : Number(url.port),
    path: `${url.pathname}${url.search}`,
    // An IP address in the URL is verified as an address; a name is sent
    // and verified as a name (a name, never an address, may go in SNI).
    ...(addressFamily(target.host) === undefined && { servername: target.host }),
    headers: {
      host: url.host,
      'user-agent': WEB_FETCH_USER_AGENT,
      accept: WEB_FETCH_ACCEPT,
      'accept-encoding': WEB_FETCH_ACCEPT_ENCODING,
    },
    signal,
  }
}

/** A response's headers as the fetch reads them: one string each, names in lower case. */
function headersOf(response: IncomingMessage): Readonly<Record<string, string | undefined>> {
  const headers: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(response.headers)) {
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
  }
  return headers
}

/** Whether the answer arrived over TLS, as only the pinned server's can. */
function isOverTls(socket: Socket | null): boolean {
  return socket !== null && 'encrypted' in socket && socket.encrypted === true
}

/**
 * Whether a TLS socket has finished its handshake: its Finished message is
 * there only then (`getProtocol` may name a version before it is done).
 */
function isHandshakeDone(socket: TLSSocket): boolean {
  return socket.getFinished() !== undefined
}

/**
 * Calls `onConnected` once the request's connection is up: its TLS handshake
 * done (to the pinned address, or through the proxy's tunnel to it), or for
 * the tests' plain server its TCP connection. A socket kept alive from an
 * earlier request is up already.
 */
function watchConnection(
  outgoing: ClientRequest,
  isTlsRequired: boolean,
  onConnected: () => void,
): void {
  outgoing.once('socket', (socket: Socket) => {
    if (socket instanceof TLSSocket) {
      if (isHandshakeDone(socket)) {
        onConnected()
      } else {
        socket.once('secureConnect', onConnected)
      }
      return
    }
    if (isTlsRequired) {
      return
    }
    if (socket.connecting) {
      socket.once('connect', onConnected)
    } else {
      onConnected()
    }
  })
}

/** The error for an answer that did not come over TLS: a proxy refused the tunnel. */
function notOverTls(status: number, address: string): Error {
  return Object.assign(
    new Error(
      `Proxy response (${String(status)}) instead of a TLS connection to ${address}; nothing was read`,
    ),
    { code: WEB_FETCH_NOT_TLS_CODE, status },
  )
}

/**
 * One pinned GET; `onConnected` once its connection is up. Rejects when it
 * cannot be made, when a proxy answered instead of the server, or when the
 * signal aborts. `isTlsRequired` is off only for the tests' plain loopback
 * server.
 */
export function pinnedHttpsRequest(
  target: PinnedTarget,
  signal: AbortSignal,
  onConnected: () => void,
  request: RequestFunction = httpsRequest,
  isTlsRequired = true,
): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const outgoing = request(pinnedOptions(target, signal), (response) => {
      if (isTlsRequired && !isOverTls(response.socket)) {
        response.destroy()
        outgoing.destroy()
        reject(notOverTls(response.statusCode ?? 0, target.address))
        return
      }
      resolve({
        status: response.statusCode ?? 0,
        headers: headersOf(response),
        body: response,
        close: () => {
          response.destroy()
          outgoing.destroy()
        },
      })
    })
    watchConnection(outgoing, isTlsRequired, onConnected)
    outgoing.on('error', reject)
    outgoing.end()
  })
}
