// The credential reads' failure boundary (D119): a store that cannot be
// read answers absence-or-unknown with the failure's kind in words, never
// as absence and never with the raw error, whose message can name a
// keyring path.
import { describe, expect, it } from 'vitest'
import { SECRET_KEYS } from '../../src/shared/constants'
import {
  getApiKey,
  readModelApiCredential,
  type CredentialReadPort,
} from '../../src/host/auth/credentialRead'

function port(secrets: CredentialReadPort['secrets'], warns: string[]): CredentialReadPort {
  return {
    owner: {},
    secrets,
    warn: (message: string) => {
      warns.push(message)
    },
    storeName: 'the test store',
  }
}

function failingWith(failure: Error): CredentialReadPort['secrets'] {
  return {
    get: () => Promise.reject(failure),
    store: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  }
}

class KeyringLockedError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'KeyringLockedError'
  }
}
class StoreDeniedError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'StoreDeniedError'
  }
}

describe('credential read failures', () => {
  it('reads a store failure as no key, with the kind in words', async () => {
    const failure = new KeyringLockedError('secret storage is locked for user 1000')
    const warns: string[] = []
    const key = await getApiKey(port(failingWith(failure), warns))
    expect(key).toBe(undefined)
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('KeyringLocked')
    expect(warns[0]).not.toContain('secret storage is locked for user 1000')
  })

  it('warns once per owner while the store stays unreadable, re-armed by a healthy read', async () => {
    const failure = new KeyringLockedError('secret storage is locked for user 1000')
    const warns: string[] = []
    const own = port(failingWith(failure), warns)
    expect(await getApiKey(own)).toBe(undefined)
    expect(await getApiKey(own)).toBe(undefined)
    expect(warns).toHaveLength(1)
    const healthy: CredentialReadPort = {
      ...own,
      secrets: {
        get: () => Promise.resolve('key'),
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
    }
    expect(await getApiKey(healthy)).toBe('key')
    expect(await getApiKey(own)).toBe(undefined)
    expect(warns).toHaveLength(2)
  })

  it('reads a denied store as unreadable with its kind', async () => {
    const failure = Object.assign(new StoreDeniedError('permission denied'), { code: 'EACCES' })
    const warns: string[] = []
    const read = await readModelApiCredential({
      ...port(failingWith(failure), warns),
      providerIds: () => Promise.resolve([]),
    })
    expect(read).toEqual({ outcome: 'unreadable', kind: 'denied' })
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('StoreDenied')
    expect(warns[0]).not.toContain('permission denied')
  })

  it('stays silent when the store answers', async () => {
    const warns: string[] = []
    const read = await readModelApiCredential({
      ...port(
        {
          get: () => Promise.resolve(undefined),
          store: () => Promise.resolve(),
          delete: () => Promise.resolve(),
        },
        warns,
      ),
      providerIds: () => Promise.resolve([]),
    })
    expect(read).toEqual({ outcome: 'absent' })
    expect(warns).toEqual([])
  })

  it('scans past an unreadable provider entry instead of calling it absent', async () => {
    const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const warns: string[] = []
    const read = await readModelApiCredential({
      ...port(
        {
          get: (key: string) =>
            key === SECRET_KEYS.modelApiKey ? Promise.resolve(undefined) : Promise.reject(failure),
          store: () => Promise.resolve(),
          delete: () => Promise.resolve(),
        },
        warns,
      ),
      providerIds: () => Promise.resolve(['meta']),
    })
    expect(read).toEqual({ outcome: 'unreadable', kind: 'denied' })
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('meta')
  })
})
