// M95 lane K (PLAN.md D74, M95 acceptance 5): provider credential records
// are bound to the exact origin they were entered for.

import { describe, expect, it } from 'vitest'
import {
  deleteProviderCredential,
  isOriginBound,
  providerSecretKey,
  readProviderCredential,
  saveProviderCredential,
  type CredentialRecord,
} from '../../src/host/providers/credentialRecords'
import { memorySecrets } from './helpers/fakes'

const RECORD: CredentialRecord = {
  v: 1,
  auth: 'apiKey',
  origin: 'https://openrouter.ai',
  secret: 'sk-or-test-key',
}

describe('provider credential records', () => {
  it('names each secret after its provider id', () => {
    expect(providerSecretKey('openrouter')).toBe('museSpark.provider.openrouter')
  })

  it('round-trips a record through the secret store', async () => {
    const secrets = memorySecrets()
    await saveProviderCredential(secrets, 'openrouter', RECORD)
    expect(await readProviderCredential(secrets, 'openrouter')).toEqual(RECORD)
  })

  it('reads no record as absent, never as damaged', async () => {
    const secrets = memorySecrets()
    expect(await readProviderCredential(secrets, 'openrouter')).toBeUndefined()
  })

  it('refuses a stored value that is not a record', async () => {
    const secrets = memorySecrets()
    await secrets.store(providerSecretKey('openrouter'), 'not json{')
    await expect(readProviderCredential(secrets, 'openrouter')).rejects.toThrow()
    await secrets.store(providerSecretKey('openrouter'), JSON.stringify({ v: 1 }))
    await expect(readProviderCredential(secrets, 'openrouter')).rejects.toThrow()
  })

  it('tolerates fields a newer writer added', async () => {
    const secrets = memorySecrets()
    await secrets.store(
      providerSecretKey('openrouter'),
      JSON.stringify({ ...RECORD, refreshToken: 'later' }),
    )
    expect(await readProviderCredential(secrets, 'openrouter')).toEqual(RECORD)
  })

  it('deletes the record on removal', async () => {
    const secrets = memorySecrets()
    await saveProviderCredential(secrets, 'openrouter', RECORD)
    await deleteProviderCredential(secrets, 'openrouter')
    expect(await readProviderCredential(secrets, 'openrouter')).toBeUndefined()
  })
})

describe('origin binding', () => {
  it('accepts the exact origin the credential was entered for', () => {
    expect(isOriginBound(RECORD, 'https://openrouter.ai/v1/chat')).toBe(true)
  })

  it('refuses another scheme, host or port on the same host', () => {
    // The plain-HTTP URL is the point: a downgraded scheme must be refused
    // (PLAN.md §8). Test-only.
    // eslint-disable-next-line unicorn/prefer-https
    expect(isOriginBound(RECORD, 'http://openrouter.ai/v1')).toBe(false)
    expect(isOriginBound(RECORD, 'https://api.openrouter.ai/v1')).toBe(false)
    expect(isOriginBound(RECORD, 'https://openrouter.ai:8443/v1')).toBe(false)
  })

  it('refuses when either side is not a URL', () => {
    expect(isOriginBound(RECORD, 'not a url')).toBe(false)
    expect(
      isOriginBound(
        { v: 1, auth: 'apiKey', origin: 'https://openrouter.ai', secret: 'sk-or-test-key' },
        '',
      ),
    ).toBe(false)
  })
})
