// Malformed provider bodies read as their named refusals, with real
// `Response` objects and real malformed bytes: a body that is not JSON is
// named by its status or reads unreadable, never as another fact.
import { describe, expect, it } from 'vitest'
import {
  ChatGptSignIn,
  ChatGptSignInError,
  verifyChatGptIdToken,
  type ChatGptHostPort,
  type ChatGptRecord,
} from '../../src/core/providers/subscriptions/chatgpt'
import {
  chatGptAccountId,
  chatGptCatalog,
  planRequestError,
} from '../../src/core/providers/subscriptions/registry'
import { testGrantRecord } from './helpers/chatGptGrant'

/** The real sign-in class over an unexpired grant: no callback, browser or refresh runs. */
function signInWith(record: ChatGptRecord): ChatGptSignIn {
  const host: ChatGptHostPort = {
    hostId: record.hostId,
    fetch: globalThis.fetch,
    now: Date.now,
    openBrowser: () => Promise.reject(new ChatGptSignInError('browser-unavailable')),
    startCallback: () => Promise.reject(new ChatGptSignInError('invalid-callback')),
    readRecord: () => Promise.resolve(record),
    writeRecord: () => Promise.reject(new ChatGptSignInError('store-unavailable')),
    deleteRecord: () => Promise.reject(new ChatGptSignInError('store-unavailable')),
    readRegistration: () => Promise.resolve(undefined),
    writeRegistration: () => Promise.reject(new ChatGptSignInError('store-unavailable')),
    withRefreshLock: (work) => work(),
  }
  return new ChatGptSignIn(host)
}

function part(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url')
}

/** A real malformed answer with this status, as the provider's wire would carry it. */
function malformedAnswer(status: number): typeof fetch {
  return () => Promise.resolve(new Response('{{{', { status }))
}

describe('malformed ChatGPT bodies', () => {
  it('reads token claims that decode but are not JSON as an invalid token', () => {
    // The header parses, so the claims part reaches the JSON parse: its
    // malformed bytes read as an invalid token. Reverting the SyntaxError
    // narrowing lets the parse failure escape as a SyntaxError instead.
    const token = `${part('{"alg":"RS256","kid":"k1"}')}.${part('{not json')}.${part('sig')}`
    const failure = failureOfSync(() =>
      verifyChatGptIdToken({ token, jwks: {}, clientId: 'x', nonce: 'y', now: 1 }),
    )
    expect(failure).toBeInstanceOf(ChatGptSignInError)
    expect((failure as ChatGptSignInError).code).toBe('invalid-id-token')
  })

  it('reads a catalogue answer that is not JSON as unreadable', async () => {
    const signIn = signInWith(testGrantRecord('malformed-catalogue'))
    const failure = await failureOf(chatGptCatalog(signIn, malformedAnswer(200)))
    expect(failure).toBeInstanceOf(ChatGptSignInError)
    expect((failure as ChatGptSignInError).code).toBe('catalogue-unreadable')
  })

  it('names a refused catalogue answer without JSON by its status', async () => {
    const signIn = signInWith(testGrantRecord('refused-catalogue'))
    const failure = await failureOf(chatGptCatalog(signIn, malformedAnswer(403)))
    expect(failure).toBeInstanceOf(ChatGptSignInError)
    expect((failure as ChatGptSignInError).code).toBe('catalogue-refused')
    expect((failure as ChatGptSignInError).reason).toBe('HTTP 403')
  })

  it('names a plan refusal without JSON by its status', async () => {
    const refusal = await planRequestError(new Response('{{{', { status: 500 }))
    expect(refusal.message).toContain('HTTP 500')
  })

  it('reads malformed stored grant text as grant-unreadable', () => {
    const failure = failureOfSync(() => chatGptAccountId('{not json'))
    expect(failure).toBeInstanceOf(ChatGptSignInError)
    expect((failure as ChatGptSignInError).code).toBe('grant-unreadable')
  })
})

function failureOfSync(work: () => unknown): unknown {
  try {
    work()
  } catch (error) {
    return error
  }
  return undefined
}

async function failureOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work
  } catch (error) {
    return error
  }
  return undefined
}
