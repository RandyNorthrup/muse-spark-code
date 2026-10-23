// The VS Code side of the subscription loopback: the documented
// /auth/callback, bound before the browser opens, with the promise also
// retaining an early callback. One server serves every subscription
// provider; each provider binds its own callback parse, page text and
// failure class.
import { createServer } from 'node:http'
import { HTTP_STATUS, OAUTH_LOOPBACK_HOST, UI_TEXT } from '../../shared/constants'
import { chatGptCallbackBinding, grokCallbackBinding } from '../backend/subscriptionsEntry'

export function fileErrorCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined
}

export interface HostSubscriptionCallback {
  readonly bindHost: string
  readonly redirectUri: string
  waitForCallback(): Promise<string>
  close(): void
}

export interface HostSubscriptionCallbackBinding<E extends Error> {
  /** Validate one callback URL; throw the provider's failure where it does not match. */
  parse(url: string, redirectUri: string): void
  fail(
    code: 'invalid-callback' | 'callback-timeout' | 'local-failed',
    reason?: string,
    cause?: unknown,
  ): E
  isFailure(error: unknown): error is E
  /** Log one fixed line; refused callbacks carry no request text. */
  log(message: string): void
}

/** Bound before the browser opens; the promise also retains an early callback. */
export async function startHostSubscriptionCallback<E extends Error>(
  state: string,
  timeoutMs: number,
  pageText: () => string,
  binding: HostSubscriptionCallbackBinding<E>,
): Promise<HostSubscriptionCallback> {
  const server = createServer()
  const completion: { resolve?: (outcome: string | Error) => void } = {}
  const waiting = new Promise<string | Error>((resolve) => {
    completion.resolve = resolve
  })
  let isSettled = false
  const finish = (value: string | Error): void => {
    if (isSettled) return
    isSettled = true
    clearTimeout(timer)
    server.close()
    server.closeAllConnections()
    completion.resolve?.(value)
  }
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, OAUTH_LOOPBACK_HOST, () => {
        server.off('error', reject)
        resolve()
      })
    })
  } catch (error) {
    // The loopback listener could not open: this machine's cause, with its code.
    const code = fileErrorCode(error)
    throw binding.fail('local-failed', typeof code === 'string' ? code : 'listen', error)
  }
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw binding.fail('invalid-callback')
  }
  let isClaimed = false
  const redirectUri = `http://${OAUTH_LOOPBACK_HOST}:${String(address.port)}/auth/callback`
  server.on('error', () => {
    finish(binding.fail('invalid-callback'))
  })
  server.on('request', (request, response) => {
    const answer = (status: number): void => {
      response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(pageText())
    }
    if (request.method !== 'GET') {
      answer(HTTP_STATUS.methodNotAllowed)
      return
    }
    if (isClaimed || isSettled) {
      answer(HTTP_STATUS.badRequest)
      return
    }
    try {
      const url = new URL(request.url ?? '/', redirectUri)
      if (
        request.headers.host !== new URL(redirectUri).host ||
        url.origin !== new URL(redirectUri).origin
      ) {
        answer(HTTP_STATUS.badRequest)
        return
      }
      if (url.pathname !== '/auth/callback') {
        answer(HTTP_STATUS.notFound)
        return
      }
      // A callback carrying another attempt's state is not this attempt's:
      // it is logged without any request text and settles nothing, so
      // whoever sent it cannot end this sign-in.
      if (url.searchParams.get('state') !== state) {
        binding.log('a sign-in callback arrived that this attempt did not send')
        answer(HTTP_STATUS.badRequest)
        return
      }
      binding.parse(url.href, redirectUri)
      isClaimed = true
      // Let the response finish before forcibly closing idle sockets.
      response.on('finish', () => {
        finish(url.href)
      })
      answer(HTTP_STATUS.ok)
    } catch (error) {
      isClaimed = true
      // A callback this attempt did not send arrived (a refusal, another
      // attempt's state): the arrival is logged without any request text,
      // and the waiter says the parser's own failure below.
      binding.log('a sign-in callback arrived that this attempt did not send')
      const outcome = binding.isFailure(error) ? error : binding.fail('invalid-callback')
      response.on('finish', () => {
        finish(outcome)
      })
      answer(HTTP_STATUS.badRequest)
    }
  })
  const timer = setTimeout(() => {
    finish(binding.fail('callback-timeout'))
  }, timeoutMs)
  timer.unref()
  return {
    bindHost: address.address,
    redirectUri,
    waitForCallback: async () => {
      const outcome = await waiting
      if (outcome instanceof Error) throw outcome
      return outcome
    },
    close: () => {
      finish(binding.fail('invalid-callback'))
    },
  }
}

/** The ChatGPT binding; the saved issued client a reauthorization's callback may omit. */
export async function startChatGptCallback(
  state: string,
  timeoutMs: number,
  /** The saved issued client a reauthorization's callback may omit. */
  clientId: string | undefined,
  log: (message: string) => void,
): Promise<HostSubscriptionCallback> {
  return await startHostSubscriptionCallback(state, timeoutMs, () => UI_TEXT.oauthCallbackDone, {
    ...chatGptCallbackBinding(state, clientId),
    log,
  })
}

/** The Grok binding: this app's configured client needs no callback echo. */
export async function startGrokCallback(
  state: string,
  timeoutMs: number,
  log: (message: string) => void,
): Promise<HostSubscriptionCallback> {
  return await startHostSubscriptionCallback(state, timeoutMs, () => UI_TEXT.acpGrok.callback, {
    ...grokCallbackBinding(state),
    log,
  })
}
