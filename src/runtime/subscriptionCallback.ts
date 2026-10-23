// The subscription callback is the documented /auth/callback, never
// /callback. A waiting promise exists before the URL is printed, and the
// deadline starts when the listener opens, even if nobody calls
// waitForCallback. One server serves every subscription provider; each
// provider binds its own callback parse and failure class.
import { createServer, type ServerResponse } from 'node:http'
// The sign-in cores stay in dist/subscriptions.js; this bundle reads them
// through subscriptionsEntry (one `instanceof` across the boundary).
import { chatGptCallbackBinding, grokCallbackBinding } from '../host/backend/subscriptionsEntry'
import { pkce } from '../host/backend/providersEntry'
const { isPkceState } = pkce
import { HTTP_STATUS, OAUTH_CODE_TTL_MS, OAUTH_LOOPBACK_HOST } from '../shared/constants'

export interface SubscriptionCallback {
  readonly redirectUri: string
  waitForCallback(): Promise<string>
  close(): void
}

export interface SubscriptionCallbackBinding<E extends Error> {
  /** Validate one callback URL; throw the provider's failure where it does not match. */
  parse(url: string, redirectUri: string): void
  fail(
    code: 'invalid-callback' | 'callback-timeout' | 'cancelled' | 'local-failed',
    reason?: string,
    cause?: unknown,
  ): E
  isFailure(error: unknown): error is E
}

/** Localized page text is supplied by the runtime/editor, never provider text. */
export async function startSubscriptionCallback<E extends Error>(
  state: string,
  timeoutMs: number,
  pageText: () => string,
  binding: SubscriptionCallbackBinding<E>,
  signal?: AbortSignal,
): Promise<SubscriptionCallback> {
  if (
    !isPkceState(state) ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > OAUTH_CODE_TTL_MS
  )
    throw binding.fail('invalid-callback')
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

  const finish = (value?: string | E, isFlushing = false): void => {
    if (isSettled) return
    isSettled = true
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    server.close()
    if (!isFlushing) server.closeAllConnections()
    if (typeof value === 'string') resolveWait?.(value)
    else rejectWait?.(value ?? binding.fail('invalid-callback'))
  }
  const cancel = () => {
    finish()
  }
  // No answer in time and a caller's cancel are their own causes.
  const expire = () => {
    finish(binding.fail('callback-timeout'))
  }
  const abort = () => {
    finish(binding.fail('cancelled'))
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
      binding.parse(url.href, redirectUri)
      answer(response, HTTP_STATUS.ok)
      finish(url.href, true)
    } catch (error) {
      answer(response, HTTP_STATUS.badRequest)
      // Let the fixed page flush, then destroy every connection. Preserve
      // only our validated failure (a refusal, another attempt's state),
      // never arbitrary request/error text.
      finish(binding.isFailure(error) ? error : undefined, true)
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
    if (address === null || typeof address === 'string') throw binding.fail('invalid-callback')
    redirectUri = `http://${OAUTH_LOOPBACK_HOST}:${String(address.port)}/auth/callback`
    timer = setTimeout(expire, timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted === true) abort()
    return {
      redirectUri,
      waitForCallback: () => {
        if (hasWaiter) return Promise.reject(binding.fail('invalid-callback'))
        hasWaiter = true
        return waiting
      },
      close: cancel,
    }
  } catch (error) {
    finish()
    if (binding.isFailure(error)) throw error
    // The loopback listener could not open: this machine's cause, with its code.
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    throw binding.fail('local-failed', typeof code === 'string' ? code : 'listen', error)
  }
}

/** The ChatGPT binding; the saved issued client a reauthorization's callback may omit. */
export async function startChatGptCallback(
  state: string,
  timeoutMs: number,
  pageText: () => string,
  signal?: AbortSignal,
  clientId?: string,
): Promise<SubscriptionCallback> {
  return await startSubscriptionCallback(
    state,
    timeoutMs,
    pageText,
    chatGptCallbackBinding(state, clientId),
    signal,
  )
}

/** The Grok binding: this app's configured client needs no callback echo. */
export async function startGrokCallback(
  state: string,
  timeoutMs: number,
  pageText: () => string,
  signal?: AbortSignal,
): Promise<SubscriptionCallback> {
  return await startSubscriptionCallback(
    state,
    timeoutMs,
    pageText,
    grokCallbackBinding(state),
    signal,
  )
}
