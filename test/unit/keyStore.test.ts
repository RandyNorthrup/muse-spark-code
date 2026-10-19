import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  keyringSecretStore,
  StoreUnavailableError,
  storeOperation,
} from '../../src/runtime/keyStore'

describe('storeOperation failure guard', () => {
  it('maps a secret-bearing failure onto the fixed word with its cause', async () => {
    const native = new Error('keyring refused account hunter2')
    let failure: unknown
    try {
      await storeOperation((): Promise<never> => {
        throw native
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(StoreUnavailableError)
    if (!(failure instanceof StoreUnavailableError)) throw new Error('unreachable')
    expect(failure.message).toBe('store-unavailable')
    expect(failure.name).toBe('StoreUnavailableError')
    expect(String(failure.stack)).not.toContain('hunter2')
    expect(failure.cause).toBe(native)
  })

  it('keeps a typed store failure typed through the locked read', async () => {
    const typed = new StoreUnavailableError()
    const store = keyringSecretStore(
      () => ({
        getPassword: (): Promise<never> => {
          throw typed
        },
        setPassword: () => Promise.resolve(),
        deletePassword: () => Promise.resolve(false),
      }),
      { lockScope: randomUUID() },
    )
    let failure: unknown
    try {
      await store.get('account')
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(StoreUnavailableError)
    if (!(failure instanceof StoreUnavailableError)) throw new Error('unreachable')
    expect(failure.message).toBe('store-unavailable')
  })
})
