// `add-new-account` verification is tied to the newly selected account. The
// terminal command (`runChatGptProviderCommand`) refuses with `already-added`
// when a grant is already stored and leaves the old grant unchanged; the ACP
// `verify` must then stay failed instead of accepting that untouched grant.
// These drive the real authentication methods over the real runtime host and
// a writable in-memory store: the abstract command is never run here, only
// the stored-grant states it leaves behind (refused = unchanged,
// succeeded = a different account's grant).
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import type { SignInMethod } from '../../src/acp/agent'
import {
  ChatGptSignInError,
  type ChatGptHostPort,
} from '../../src/core/providers/subscriptions/chatgpt'
import { createRuntimeChatGptHost } from '../../src/runtime/chatGptHost'
import {
  chatGptAuthenticationMethods,
  chatGptCommandText,
} from '../../src/runtime/chatGptProviderCommands'
import { testGrantRecord, testSecretStore } from './helpers/chatGptGrant'

const ACCOUNT_A = 'add-new-account-a'
const ACCOUNT_B = 'add-new-account-b'

/**
 * The real host, signalling when its first `readRecord` resolves. The
 * methods capture their baseline with the first host they build, so the
 * test writes the post-command grant only after that signal: no timing.
 */
function watchFirstRead(
  createHost: () => Promise<ChatGptHostPort>,
  onFirstRead: () => void,
): () => Promise<ChatGptHostPort> {
  let reads = 0
  return async () => {
    const host = await createHost()
    const readRecord = host.readRecord.bind(host)
    return {
      ...host,
      readRecord: async () => {
        const stored = await readRecord()
        if (reads++ === 0) onFirstRead()
        return stored
      },
    }
  }
}

function rawHostFor(secrets: ReturnType<typeof testSecretStore>): () => Promise<ChatGptHostPort> {
  return () =>
    createRuntimeChatGptHost({
      secrets,
      fetch: globalThis.fetch,
      openBrowser: () => Promise.resolve(),
      callbackText: () => '',
    })
}

function method(methods: SignInMethod[], id: string): () => Promise<string | undefined> {
  const found = methods.find((candidate) => candidate.id === id)
  if (found?.verify === undefined) throw new Error(`missing auth method ${id}`)
  return found.verify
}

/** Store one account's grant through a fresh host, the way sign-in leaves it. */
async function storeGrant(
  rawHost: () => Promise<ChatGptHostPort>,
  accountSubject: string,
): Promise<void> {
  const host = await rawHost()
  await host.writeRecord(testGrantRecord(accountSubject))
}

describe('chatgpt add-new-account verification', () => {
  it('stays failed when the grant never changed, passes on the new account', async () => {
    const secrets = testSecretStore()
    const rawHost = rawHostFor(secrets)
    await storeGrant(rawHost, ACCOUNT_A)
    const baseline = Promise.withResolvers<undefined>()
    // The methods are built with account A's grant stored: the baseline.
    const methods = chatGptAuthenticationMethods(
      watchFirstRead(rawHost, () => {
        baseline.resolve(undefined)
      }),
    )
    const verifyNewAccount = method(methods, 'chatgpt-add-new-account')
    await baseline.promise
    // The refused command leaves account A's grant: verification fails with
    // the refusal's own sentence instead of reporting success.
    await expect(verifyNewAccount()).resolves.toBe(chatGptCommandText().failure('already-added'))
    // The successful command stores account B's grant: verification passes.
    await storeGrant(rawHost, ACCOUNT_B)
    await expect(verifyNewAccount()).resolves.toBeUndefined()
  })

  it('passes a first different-account sign-in with no grant stored', async () => {
    const secrets = testSecretStore()
    const rawHost = rawHostFor(secrets)
    const baseline = Promise.withResolvers<undefined>()
    // Built with no grant stored: the baseline is absent.
    const methods = chatGptAuthenticationMethods(
      watchFirstRead(rawHost, () => {
        baseline.resolve(undefined)
      }),
    )
    await baseline.promise
    await storeGrant(rawHost, ACCOUNT_B)
    await expect(method(methods, 'chatgpt-add-new-account')()).resolves.toBeUndefined()
  })

  it('surfaces a startup host failure through verify, never as an unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const methods = chatGptAuthenticationMethods(() =>
        Promise.reject(new ChatGptSignInError('request-failed')),
      )
      // Let the captured baseline settle with no verifier attached yet: a
      // bare baseline promise rejects here, outside any `await`.
      await delay(25)
      for (const id of [
        'chatgpt-add',
        'chatgpt-add-new-account',
        'chatgpt-remove',
        'chatgpt-status',
      ]) {
        await expect(method(methods, id)()).resolves.toBe(
          chatGptCommandText().failure('request-failed'),
        )
      }
      await delay(25)
      expect(unhandled).toEqual([])
    } finally {
      process.removeListener('unhandledRejection', onUnhandled)
    }
  })

  it('leaves the other methods as they were', async () => {
    const secrets = testSecretStore()
    const rawHost = rawHostFor(secrets)
    await storeGrant(rawHost, ACCOUNT_A)
    const methods = chatGptAuthenticationMethods(rawHost)
    // An ordinary stored grant still verifies an `add`, and still fails a `remove`.
    await expect(method(methods, 'chatgpt-add')()).resolves.toBeUndefined()
    await expect(method(methods, 'chatgpt-remove')()).resolves.toBe(
      chatGptCommandText().failure('still-signed-in'),
    )
  })
})
