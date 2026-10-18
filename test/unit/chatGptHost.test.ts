// The runtime ChatGPT host's failure rules: a store failure reads as the
// store's refusal, malformed entries name their entry, and typed failures
// cross host creation unchanged.
import { describe, expect, it } from 'vitest'
import { ChatGptSignInError } from '../../src/core/providers/subscriptions/chatgpt'
import type { SecretStore } from '../../src/host/auth/credentialStore'
import { createRuntimeChatGptHost } from '../../src/runtime/chatGptHost'

function mapSecrets(entries: Readonly<Record<string, string>>): SecretStore {
  const backing = new Map(Object.entries(entries))
  return {
    get: (key: string) => Promise.resolve(backing.get(key)),
    store: (key: string, value: string) => {
      backing.set(key, value)
      return Promise.resolve()
    },
    delete: (key: string) => {
      backing.delete(key)
      return Promise.resolve()
    },
  }
}

function options(secrets: SecretStore) {
  return {
    secrets,
    fetch,
    openBrowser: () => Promise.resolve(),
    callbackText: () => 'callback page',
  }
}

async function signInCode(promise: Promise<unknown>): Promise<string> {
  let failure: unknown
  try {
    await promise
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(ChatGptSignInError)
  if (!(failure instanceof ChatGptSignInError)) throw new Error('unreachable')
  return failure.code
}

describe('createRuntimeChatGptHost failure rules', () => {
  it('reads an unreadable store as the store refusal', async () => {
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' })
    const secrets: SecretStore = {
      ...mapSecrets({}),
      get: () => Promise.reject(denied),
    }
    await expect(createRuntimeChatGptHost(options(secrets))).rejects.toMatchObject({
      code: 'store-unavailable',
    })
  })

  it('names the entry a malformed grant came from', async () => {
    const secrets = mapSecrets({ 'museSpark.provider.chatgpt': '{oops' })
    const host = await createRuntimeChatGptHost(options(secrets))
    expect(await signInCode(host.readRecord())).toBe('grant-unreadable')
  })

  it('reads a browser handoff failure as browser-unavailable, never an outage', async () => {
    const host = await createRuntimeChatGptHost({
      ...options(mapSecrets({})),
      openBrowser: () => Promise.reject(new Error('no browser here')),
    })
    expect(await signInCode(host.openBrowser('http://127.0.0.1/'))).toBe('browser-unavailable')
  })

  it('carries a typed host-id failure across creation unchanged', async () => {
    const secrets = mapSecrets({ 'museSpark.provider.chatgpt.host-id': 'garbage!!!' })
    expect(await signInCode(createRuntimeChatGptHost(options(secrets)))).toBe('host-id-unreadable')
  })
})
