// The one-shot 127.0.0.1 OAuth callback server (M95 lane K, PLAN.md
// D74). OpenRouter's connect runs its PKCE flow through this (M95b reuses
// it for ChatGPT plan sign-in): S256, a loopback callback on 127.0.0.1
// with a random port and `state`, the code exchanged once, the server
// closed in every path. Plain `node:http`, no `vscode`, so it is
// unit-tested against real loopback requests.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import * as z from 'zod/mini'
import { HTTP_STATUS, OAUTH_LOOPBACK_TIMEOUT_MS, UI_TEXT } from '../../shared/constants'

/** The loopback listens here, and nowhere else. */
const LOOPBACK_HOST = '127.0.0.1'
const CALLBACK_PATH = '/callback'

/**
 * What the provider's callback carried (M101 BYO 12): the code plus every
 * callback parameter, so a sign-in that answers with more than a code
 * (ChatGPT's plan sign-in) keeps what it needs for the exchange and the
 * refresh. The waiter takes no abort signal: a token refresh runs outside
 * the turn's abort, and stopping a turn must never break a sign-in.
 */
export interface OAuthCallback {
  /** The `code` the exchange sends. */
  readonly code: string
  /** Every query parameter the callback carried, including `code`. */
  readonly params: Readonly<Record<string, string>>
}

export interface OAuthLoopback {
  /** The host the server is bound to (always 127.0.0.1). */
  readonly bindHost: string
  /** The redirect URI to register (`http://127.0.0.1:<port>/callback`). */
  readonly redirectUri: string
  /**
   * The provider's callback, once. Ignores unrelated requests; rejects on a provider
   * refusal with the right state, the ten-minute end, or `close`. The server is closed however
   * this settles.
   */
  waitForCode(): Promise<OAuthCallback>
  /** Stops listening; a pending `waitForCode` rejects. Idempotent. */
  close(): void
}

function answer(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(body)
}

/**
 * Starts the one-shot callback server for one connect flow. `state` is the
 * flow's unguessable value (lane P's `pkce.ts` makes it); only a callback
 * carrying it releases the code.
 */
export async function startOAuthLoopback(
  state: string,
  timeoutMs: number = OAUTH_LOOPBACK_TIMEOUT_MS,
): Promise<OAuthLoopback> {
  const server: Server = createServer()
  const callbackSchema = z.object({
    code: z.string().check(z.minLength(1)),
    state: z.literal(state),
  })
  let isSettled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let settle: ((callback: OAuthCallback) => void) | undefined
  let rejectWait: ((error: Error) => void) | undefined
  // Node 20 (VS Code's minimum host) lacks Promise.withResolvers. Keep
  // the native resolvers inside the executor's delivery closures.
  const waited = new Promise<OAuthCallback>((resolve, reject) => {
    settle = (callback) => {
      resolve(callback)
    }
    rejectWait = (error) => {
      reject(error)
    }
  })
  // A browser may fail before the caller claims the callback promise.
  void waited.catch(() => {
    /* waitForCode returns the original rejection. */
  })

  const finish = (
    outcome: { readonly callback: OAuthCallback } | { readonly error: Error },
  ): void => {
    if (isSettled) {
      return
    }
    isSettled = true
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    // No keep-alive connection survives the one use: without this a
    // browser-held socket answers the next callback as already settled.
    server.closeAllConnections()
    server.close()
    if ('callback' in outcome) {
      settle?.(outcome.callback)
    } else {
      rejectWait?.(outcome.error)
    }
    settle = undefined
    rejectWait = undefined
  }

  // Request lines Node's own parser rejects never reach the handler: refuse
  // them on the socket with the same 400 instead of dropping the connection.
  server.on('clientError', (_error: unknown, socket: Socket) => {
    try {
      if (!socket.destroyed && socket.writable)
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      else socket.destroy()
    } catch {
      try {
        socket.destroy()
      } catch {
        // Nothing is left to refuse on.
      }
    }
  })
  // No malformed request line or URL may escape this handler: anything it
  // cannot parse is answered with 400 and ignored.
  server.on('request', (request: IncomingMessage, response: ServerResponse) => {
    try {
      serveCallback(request, response)
    } catch {
      try {
        answer(response, HTTP_STATUS.badRequest, UI_TEXT.oauthCallbackDone)
      } catch {
        // The socket is already dead; the flow still waits for its callback.
      }
    }
  })
  const serveCallback = (request: IncomingMessage, response: ServerResponse): void => {
    if (isSettled) {
      answer(response, HTTP_STATUS.badRequest, UI_TEXT.oauthCallbackDone)
      return
    }
    if (request.method !== 'GET') {
      response.writeHead(HTTP_STATUS.methodNotAllowed, { allow: 'GET' })
      response.end()
      return
    }
    // The settle destroys every connection, so it waits until this answer
    // has flushed; a socket that dies first still settles the waiter.
    const settleOnceAnswered = (
      outcome: { readonly callback: OAuthCallback } | { readonly error: Error },
    ): void => {
      response.once('finish', () => {
        finish(outcome)
      })
      response.once('close', () => {
        finish(outcome)
      })
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(HTTP_STATUS.notFound)
      response.end()
      return
    }
    const names = new Set<string>()
    for (const [name] of url.searchParams) {
      if (names.has(name)) {
        answer(response, HTTP_STATUS.badRequest, UI_TEXT.oauthCallbackDone)
        return
      }
      names.add(name)
    }
    if (url.searchParams.get('state') !== state) {
      answer(response, HTTP_STATUS.badRequest, UI_TEXT.oauthCallbackDone)
      return
    }
    const refused = url.searchParams.get('error')
    if (refused !== null) {
      settleOnceAnswered({ error: new Error('The provider refused the connection') })
      answer(response, HTTP_STATUS.badRequest, UI_TEXT.oauthCallbackDone)
      return
    }
    const code = url.searchParams.get('code')
    if (code === null || code === '') {
      answer(response, HTTP_STATUS.badRequest, UI_TEXT.oauthCallbackDone)
      settleOnceAnswered({ error: new Error('The callback carried no code') })
      return
    }
    const params = z.record(z.string(), z.string()).parse(Object.fromEntries(url.searchParams))
    const parsed = callbackSchema.safeParse(params)
    if (!parsed.success) {
      settleOnceAnswered({ error: new Error('The callback was invalid') })
      answer(response, HTTP_STATUS.badRequest, UI_TEXT.oauthCallbackDone)
      return
    }
    answer(response, HTTP_STATUS.ok, UI_TEXT.oauthCallbackDone)
    settleOnceAnswered({ callback: { code: parsed.data.code, params } })
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, LOOPBACK_HOST, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) {
    server.close()
    throw new Error('The OAuth callback server has no address')
  }
  const redirectUri = `http://127.0.0.1:${String(address.port)}${CALLBACK_PATH}`
  let isClaimed = false
  timer = setTimeout(() => {
    finish({ error: new Error('The OAuth callback timed out') })
  }, timeoutMs)
  timer.unref()

  return {
    bindHost: LOOPBACK_HOST,
    redirectUri,
    waitForCode: () => {
      if (isClaimed) return Promise.reject(new Error('The OAuth callback already settled'))
      isClaimed = true
      return waited
    },
    close: () => {
      finish({ error: new Error('The OAuth callback server closed') })
    },
  }
}
