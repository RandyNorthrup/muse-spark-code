// The one-shot 127.0.0.1 OAuth callback server (M95 lane K, PLAN.md
// D74). OpenRouter's connect runs its PKCE flow through this (M95b reuses
// it for ChatGPT plan sign-in): S256, a loopback callback on 127.0.0.1
// with a random port and `state`, the code exchanged once, the server
// closed in every path. Plain `node:http`, no `vscode`, so it is
// unit-tested against real loopback requests.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { HTTP_STATUS, OAUTH_LOOPBACK_TIMEOUT_MS, UI_TEXT } from '../../shared/constants'

/** The loopback listens here, and nowhere else. */
const LOOPBACK_HOST = '127.0.0.1'
const CALLBACK_PATH = '/callback'

export interface OAuthLoopback {
  /** The host the server is bound to (always 127.0.0.1). */
  readonly bindHost: string
  /** The redirect URI to register (`http://127.0.0.1:<port>/callback`). */
  readonly redirectUri: string
  /**
   * The provider's code, once. Rejects on a wrong `state`, a provider
   * refusal, the ten-minute end, or `close`. The server is closed however
   * this settles.
   */
  waitForCode(): Promise<string>
  /** Stops listening; a pending `waitForCode` rejects. Idempotent. */
  close(): void
}

/** Minimal HTML escaping for the callback page's single sentence. */
function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function callbackPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>OK</title></head>
<body><p>${escapeHtml(UI_TEXT.oauthCallbackDone)}</p></body>
</html>
`
}

function answer(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
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
  let settle: ((code: string) => void) | undefined
  let rejectWait: ((error: Error) => void) | undefined
  let isSettled = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const finish = (outcome: { readonly code: string } | { readonly error: Error }): void => {
    if (isSettled) {
      return
    }
    isSettled = true
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    server.close()
    if ('code' in outcome) {
      settle?.(outcome.code)
    } else {
      rejectWait?.(outcome.error)
    }
    settle = undefined
    rejectWait = undefined
  }

  server.on('request', (request: IncomingMessage, response: ServerResponse) => {
    if (isSettled) {
      answer(response, HTTP_STATUS.badRequest, callbackPage())
      return
    }
    if (request.method !== 'GET') {
      response.writeHead(HTTP_STATUS.methodNotAllowed, { allow: 'GET' })
      response.end()
      return
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(HTTP_STATUS.notFound)
      response.end()
      return
    }
    const refused = url.searchParams.get('error')
    if (refused !== null) {
      const detail = url.searchParams.get('error_description') ?? refused
      finish({ error: new Error(`The provider refused the connection: ${detail}`) })
      answer(response, HTTP_STATUS.badRequest, callbackPage())
      return
    }
    if (url.searchParams.get('state') !== state) {
      finish({ error: new Error('The callback carried the wrong state') })
      answer(response, HTTP_STATUS.badRequest, callbackPage())
      return
    }
    const code = url.searchParams.get('code')
    if (code === null || code === '') {
      finish({ error: new Error('The callback carried no code') })
      answer(response, HTTP_STATUS.badRequest, callbackPage())
      return
    }
    finish({ code })
    answer(response, HTTP_STATUS.ok, callbackPage())
  })

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

  return {
    bindHost: LOOPBACK_HOST,
    redirectUri,
    waitForCode: () =>
      new Promise<string>((resolve, reject) => {
        if (isSettled) {
          reject(new Error('The OAuth callback already settled'))
          return
        }
        settle = resolve
        rejectWait = reject
        timer = setTimeout(() => {
          finish({ error: new Error('The OAuth callback timed out') })
        }, timeoutMs)
        timer.unref()
      }),
    close: () => {
      finish({ error: new Error('The OAuth callback server closed') })
    },
  }
}
