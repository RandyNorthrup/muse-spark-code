import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  accountBindingSchema,
  accountSecretKey,
  AccountStoreError,
  boundCredential,
  credentialRecordSchema,
  type AccountBinding,
  type AccountCredential,
  type AccountCredentialVault,
} from '../../src/core/providers/credentialRecord'
import { AccountSecrets, secretStorageAccountVault } from '../../src/host/providers/accountSecrets'
import {
  countSecretMatches,
  redactableSlices,
  redactSecrets,
  registerSecretValue,
} from '../../src/core/redact'
import { createLogger } from '../../src/host/logger'
import { memorySecrets } from './helpers/fakes'
import { CURRENT_SHAPE_KEYS } from './helpers/modelApiKeys'

const binding: AccountBinding = {
  provider: 'openai',
  account: 'work',
  origin: 'https://provider.invalid',
}
const record: AccountCredential = {
  ...binding,
  v: 1,
  auth: 'apiKey',
  secret: 'synthetic-unprefixed-work-canary',
}
const disposals: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
})

function harness() {
  const storage = memorySecrets()
  const revoke = vi.fn(() => Promise.resolve())
  const vault = secretStorageAccountVault(storage)
  const secrets = new AccountSecrets({ vault, revokeSignIn: revoke })
  disposals.push(() => {
    secrets.dispose()
  })
  return { storage, vault, secrets, revoke }
}

describe('M108 account credentials', () => {
  it('keeps the legacy default names and isolates each additional account', () => {
    expect(accountSecretKey('openai')).toBe('museSpark.provider.openai')
    expect(accountSecretKey('openai', 'work')).toBe('museSpark.provider.openai.account.work')
    expect(accountSecretKey('meta')).toBe('museSpark.modelApiKey')
    expect(accountSecretKey('meta', 'work')).toBe('museSpark.provider.meta.account.work')
    expect(() => accountSecretKey('../openai', 'work')).toThrow()
    expect(() => accountSecretKey('openai', '../work')).toThrow()
  })

  it('retains a default provider credential without rewriting it', async () => {
    const h = harness()
    const legacy = { v: 1, auth: 'apiKey', origin: binding.origin, secret: record.secret }
    h.storage.values.set('museSpark.provider.openai', JSON.stringify(legacy))
    expect(await h.secrets.read({ ...binding, account: 'default' })).toEqual({
      ...legacy,
      provider: 'openai',
      account: 'default',
    })
    expect(h.storage.values.get('museSpark.provider.openai')).toBe(JSON.stringify(legacy))
    expect(redactSecrets(record.secret)).toBe('[redacted]')
  })

  it('reads Meta’s original default entry without moving it, and stores another key separately', async () => {
    const h = harness()
    const meta = { provider: 'meta', account: 'default', origin: 'https://api.meta.ai' }
    h.storage.values.set('museSpark.modelApiKey', CURRENT_SHAPE_KEYS[0])
    expect(await h.secrets.read(meta)).toEqual({
      ...meta,
      v: 1,
      auth: 'apiKey',
      secret: CURRENT_SHAPE_KEYS[0],
    })
    const second = { ...meta, account: 'work' }
    await h.secrets.write(second, {
      ...second,
      v: 1,
      auth: 'apiKey',
      secret: CURRENT_SHAPE_KEYS[1],
    })
    expect(h.storage.values.get('museSpark.modelApiKey')).toBe(CURRENT_SHAPE_KEYS[0])
    expect(h.storage.values.get('museSpark.provider.meta.account.work')).toContain(
      CURRENT_SHAPE_KEYS[1],
    )
    await h.secrets.remove(second)
    expect(h.storage.values.has('museSpark.provider.meta.account.work')).toBe(false)
    expect(h.storage.values.get('museSpark.modelApiKey')).toBe(CURRENT_SHAPE_KEYS[0])
    expect(h.revoke).not.toHaveBeenCalled()
    await h.secrets.write(meta, { ...meta, v: 1, auth: 'apiKey', secret: CURRENT_SHAPE_KEYS[1] })
    expect(h.storage.values.get('museSpark.modelApiKey')).toBe(CURRENT_SHAPE_KEYS[1])
  })

  it.each([
    { provider: 'different' },
    { account: 'personal' },
    { origin: 'https://elsewhere.invalid' },
    { origin: ['http:', '//provider.invalid'].join('') },
    { origin: 'https://provider.invalid:8443' },
  ])(
    'refuses account/provider/origin mismatch %j before saving or returning a secret',
    async (change) => {
      const h = harness()
      await expect(h.secrets.write(binding, { ...record, ...change })).rejects.toMatchObject({
        code: 'originMismatch',
      })
      expect(h.storage.values.size).toBe(0)
      h.storage.values.set(
        accountSecretKey('openai', 'work'),
        JSON.stringify({ ...record, ...change }),
      )
      await expect(h.secrets.read(binding)).rejects.toMatchObject({ code: 'originMismatch' })
      await expect(h.vault.read(binding)).rejects.toMatchObject({ code: 'originMismatch' })
    },
  )

  it.each([
    'not a URL',
    '',
    'https://provider.invalid/path',
    'https://user:pass@provider.invalid',
    'file:///tmp',
    'data:text/plain,test',
  ])('rejects noncanonical or non-HTTP origins: %s', (origin) => {
    expect(accountBindingSchema.safeParse({ ...binding, origin }).success).toBe(false)
  })

  it('rejects malformed records, copied legacy records on a nondefault account, and empty keys', async () => {
    const h = harness()
    const name = accountSecretKey('openai', 'work')
    for (const stored of [
      'invalid-json',
      '{}',
      JSON.stringify({ v: 1, auth: 'apiKey', origin: binding.origin, secret: record.secret }),
      JSON.stringify({ ...record, secret: '' }),
      JSON.stringify({ ...record, v: 2 }),
    ]) {
      h.storage.values.set(name, stored)
      await expect(h.secrets.read(binding)).rejects.toMatchObject({ code: 'invalidCredential' })
    }
    expect(credentialRecordSchema.safeParse({ ...record, apiKey: 'canary' }).success).toBe(false)
    expect(() => boundCredential({ ...record, secret: '' }, binding)).toThrow(AccountStoreError)
    h.storage.values.set(name, '')
    expect(await h.secrets.read(binding)).toBeUndefined()
    h.storage.values.clear()
    expect(await h.secrets.read(binding)).toBeUndefined()
  })

  it('restricts Meta’s raw default to valid API keys at its fixed origin', async () => {
    const h = harness()
    const meta = { provider: 'meta', account: 'default', origin: 'https://api.meta.ai' }
    h.storage.values.set('museSpark.modelApiKey', 'not-a-meta-key')
    await expect(h.secrets.read(meta)).rejects.toMatchObject({ code: 'invalidCredential' })
    h.storage.values.set('museSpark.modelApiKey', CURRENT_SHAPE_KEYS[0])
    await expect(
      h.secrets.read({ ...meta, origin: 'https://elsewhere.invalid' }),
    ).rejects.toMatchObject({ code: 'originMismatch' })
    await expect(h.vault.read({ ...meta, origin: 'https://elsewhere.invalid' })).rejects.toThrow(
      'originMismatch',
    )
    await expect(
      h.secrets.write(meta, { ...meta, v: 1, auth: 'apiKey', secret: 'not-a-meta-key' }),
    ).rejects.toMatchObject({ code: 'invalidCredential' })
    await expect(
      h.vault.write(meta, { ...meta, v: 1, auth: 'oauth', secret: CURRENT_SHAPE_KEYS[0] }),
    ).rejects.toMatchObject({ code: 'invalidCredential' })
    const otherOrigin = { ...meta, account: 'work', origin: 'https://elsewhere.invalid' }
    await expect(
      h.secrets.write(otherOrigin, {
        ...otherOrigin,
        v: 1,
        auth: 'apiKey',
        secret: CURRENT_SHAPE_KEYS[0],
      }),
    ).rejects.toThrow('originMismatch')
  })

  it.each(['oauth', 'subscription'] as const)(
    'revokes %s before deleting its secret',
    async (auth) => {
      const h = harness()
      const signIn = { ...record, auth }
      await h.secrets.write(binding, signIn)
      h.revoke.mockImplementation(() => {
        expect(h.storage.values.has(accountSecretKey('openai', 'work'))).toBe(true)
        return Promise.resolve()
      })
      await h.secrets.remove(binding)
      expect(h.revoke).toHaveBeenCalledWith(binding, signIn)
      expect(h.storage.values.size).toBe(0)
      // Late errors are redacted until the window/store ends.
      expect(redactSecrets(record.secret)).toBe('[redacted]')
    },
  )

  it('fails removal explicitly and retains the secret if sign-in revocation fails', async () => {
    const h = harness()
    await h.secrets.write(binding, { ...record, auth: 'oauth' })
    h.revoke.mockRejectedValue(new Error(`echo ${record.secret}`))
    await expect(h.secrets.remove(binding)).rejects.toThrow('unavailable')
    expect(h.storage.values.size).toBe(1)
  })

  it('sanitizes raw vault failures and registers an attempted write before a storage error', async () => {
    const h = harness()
    const vault = {
      read: vi.fn<AccountCredentialVault['read']>(() => Promise.reject(new Error(record.secret))),
      write: vi.fn(() => Promise.reject(new Error(record.secret))),
      remove: vi.fn(() => Promise.reject(new Error(record.secret))),
    }
    const secrets = new AccountSecrets({ vault, revokeSignIn: h.revoke })
    disposals.push(() => {
      secrets.dispose()
    })
    await expect(secrets.read(binding)).rejects.toThrow('unavailable')
    await expect(secrets.write(binding, record)).rejects.toThrow('unavailable')
    expect(redactSecrets(record.secret)).toBe('[redacted]')
    vault.read.mockImplementation(() => Promise.resolve(undefined))
    await expect(secrets.remove(binding)).rejects.toThrow('unavailable')
  })

  it('validates a new vault’s answers instead of trusting its account selection', async () => {
    const h = harness()
    vi.spyOn(h.vault, 'read').mockResolvedValue({ ...record, account: 'personal' })
    await expect(h.secrets.read(binding)).rejects.toThrow('originMismatch')
  })

  it('rejects work after disposal and releases all registrations exactly once', async () => {
    const h = harness()
    await expect(h.secrets.read({ ...binding, account: '../bad' })).rejects.toThrow(
      'invalidAccount',
    )
    await h.secrets.write(binding, record)
    h.secrets.dispose()
    h.secrets.dispose()
    await expect(h.secrets.read(binding)).rejects.toThrow('unavailable')
    await expect(h.secrets.write(binding, record)).rejects.toThrow('unavailable')
    await expect(h.secrets.remove(binding)).rejects.toThrow('unavailable')
    expect(redactSecrets(record.secret)).toBe(record.secret)
    await expect(h.secrets.read({ ...binding, account: '../bad' })).rejects.toThrow()
  })

  it('does not publish a pending read after the store is disposed', async () => {
    const h = harness()
    const held = Promise.withResolvers<AccountCredential | undefined>()
    vi.spyOn(h.vault, 'read').mockReturnValue(held.promise)
    const reading = h.secrets.read(binding)
    h.secrets.dispose()
    held.resolve(record)
    await expect(reading).rejects.toThrow('unavailable')
    expect(redactSecrets(record.secret)).toBe(record.secret)
  })

  it('stops deletion if disposal occurs while revocation is pending', async () => {
    const h = harness()
    await h.secrets.write(binding, { ...record, auth: 'oauth' })
    const entered = Promise.withResolvers<undefined>()
    const held = Promise.withResolvers<undefined>()
    h.revoke.mockImplementation(() => {
      entered.resolve(undefined)
      return held.promise
    })
    const removing = h.secrets.remove(binding)
    await entered.promise
    h.secrets.dispose()
    held.resolve(undefined)
    await expect(removing).rejects.toThrow('unavailable')
    expect(h.storage.values.size).toBe(1)
  })

  it('redacts every account’s unprefixed canary from real host logger output', async () => {
    const h = harness()
    await h.secrets.write(binding, record)
    const other = { ...binding, account: 'personal' }
    const otherSecret = 'synthetic-unprefixed-personal-canary'
    await h.secrets.write(other, { ...record, ...other, secret: otherSecret })
    const output: string[] = []
    const write = (line: string) => {
      output.push(line)
    }
    const log = createLogger({ trace: write, info: write, warn: write, error: write })
    const line = `echo ${record.secret} and ${otherSecret}`
    for (const method of ['trace', 'info', 'warn', 'error'] as const) log[method](line)
    expect(output).toEqual(Array.from({ length: 4 }, () => 'echo [redacted] and [redacted]'))
    expect(countSecretMatches(line, [])).toBe(2)
    expect(JSON.stringify(output)).not.toContain(record.secret)
    expect(JSON.stringify(output)).not.toContain(otherSecret)
  })

  it('keeps independent registrations alive until the last owner releases them', () => {
    const release = registerSecretValue(record.secret)
    const releaseAgain = registerSecretValue(record.secret)
    disposals.push(release, releaseAgain)
    release()
    release()
    expect(redactSecrets(record.secret)).toBe('[redacted]')
    releaseAgain()
    expect(redactSecrets(record.secret)).toBe(record.secret)
    const empty = registerSecretValue('')
    expect(redactSecrets('safe')).toBe('safe')
    empty()
  })

  it('keeps a registered multiline value intact across export chunks', () => {
    const secret = 'synthetic-first-line\nsynthetic-second-line'
    const release = registerSecretValue(secret)
    disposals.push(release)
    const text = `before\n${secret}\nafter\n`
    const slices = redactableSlices(text, 1)
    expect(slices.join('')).toBe(text)
    expect(slices.map((slice) => redactSecrets(slice)).join('')).toBe('before\n[redacted]\nafter\n')
  })
})
