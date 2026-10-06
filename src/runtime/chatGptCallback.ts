// The ACP callback is the documented /auth/callback, never /callback.
// A waiting promise exists before the URL is printed, and the deadline
// starts when the listener opens, even if nobody calls waitForCallback.
import { createServer, type ServerResponse } from 'node:http'
import {
  ChatGptSignInError,
  parseChatGptCallback,
  type ChatGptHostPort,
} from '../core/providers/subscriptions/chatgpt'
import { pkce } from '../host/backend/providersEntry'
const { isPkceState } = pkce
import { HTTP_STATUS, OAUTH_CODE_TTL_MS, OAUTH_LOOPBACK_HOST } from '../shared/constants'

type Callback = Awaited<ReturnType<ChatGptHostPort['startCallback']>>

/** Localized page text is supplied by the runtime/editor, never provider text. */
export async function startChatGptCallback(
  state: string,
  timeoutMs: number,
  pageText: () => string,
  signal?: AbortSignal,
): Promise<Callback> {
  if (
    !isPkceState(state) ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > OAUTH_CODE_TTL_MS
  )
    throw new ChatGptSignInError('invalid-callback')
  signal?.throwIfAborted()
  const server = createServer()
  let redirectUri = ''
  let isSettled = false
  let hasWaiter = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let resolveWait: ((value: string) => void) | undefined
  let rejectWait: ((error: Error) => void) | undefined
  const waiting = new Promise<string>((resolve, reject) => {
    resolveWait = resolve
    rejectWait = reject
    // A listener error after startup must also settle and close the flow.
    server.on('error', () => {
      finish()
    })
  })
  void waiting.catch(() => null)

  const finish = (value?: string, isFlushing = false): void => {
    if (isSettled) return
    isSettled = true
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
    server.close()
    if (!isFlushing) server.closeAllConnections()
    if (value === undefined) {
      rejectWait?.(new ChatGptSignInError('invalid-callback'))
    } else resolveWait?.(value)
  }
  const cancel = () => {
    finish()
  }
  const answer = (response: ServerResponse, status: number): void => {
    response.writeHead(status, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    })
    response.end(pageText(), () => {
      if (isSettled) server.closeAllConnections()
    })
  }
  server.on('request', (request, response) => {
    if (isSettled) {
      answer(response, HTTP_STATUS.badRequest)
      return
    }
    if (request.method !== 'GET') {
      answer(response, HTTP_STATUS.methodNotAllowed)
      return
    }
    let url: URL
    try {
      url = new URL(request.url ?? '/', redirectUri)
    } catch {
      answer(response, HTTP_STATUS.badRequest)
      return
    }
    if (
      request.headers.host !== new URL(redirectUri).host ||
      url.origin !== new URL(redirectUri).origin
    ) {
      answer(response, HTTP_STATUS.badRequest)
      return
    }
    if (url.pathname !== '/auth/callback') {
      answer(response, HTTP_STATUS.notFound)
      return
    }
    try {
      parseChatGptCallback(url.href, redirectUri, state)
      answer(response, HTTP_STATUS.ok)
      finish(url.href, true)
    } catch {
      answer(response, HTTP_STATUS.badRequest)
      // Let the fixed page flush, then destroy every connection, including
      // an incomplete request from a competing local process.
      finish(undefined, true)
    }
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, OAUTH_LOOPBACK_HOST, () => {
        resolve()
      })
    })
    const address = server.address()
    if (address === null || typeof address === 'string')
      throw new ChatGptSignInError('invalid-callback')
    redirectUri = `http://${OAUTH_LOOPBACK_HOST}:${String(address.port)}/auth/callback`
    timer = setTimeout(cancel, timeoutMs)
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted === true) cancel()
    return {
      redirectUri,
      waitForCallback: () => {
        if (hasWaiter) return Promise.reject(new ChatGptSignInError('invalid-callback'))
        hasWaiter = true
        return waiting
      },
      close: cancel,
    }
  } catch {
    finish()
    throw new ChatGptSignInError('invalid-callback')
  }
}
