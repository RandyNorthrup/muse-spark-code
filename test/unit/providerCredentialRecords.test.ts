// M95 lane K (PLAN.md D74, M95 acceptance 5): provider credential records
// are bound to the exact origin they were entered for.

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  deleteProviderCredential,
  isOriginBound,
  payingKeyDigest,
  providerIdentities,
  providerKeyDigest,
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

function metaAccount(): Promise<string | undefined> {
  return Promise.resolve('meta-account')
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

  // P2-4: offers compare quota rows against the digest of the credential the
  // provider actually uses. Only the digest leaves the store, never the key.
  it('digests an apiKey record, and nothing else, for quota identity', async () => {
    const secrets = memorySecrets()
    await saveProviderCredential(secrets, 'openai', { ...RECORD, secret: 'openai-key' })
    expect(await providerKeyDigest(secrets, 'openai')).toBe(
      createHash('sha256').update('openai-key').digest('hex'),
    )
    await saveProviderCredential(secrets, 'oauth', { ...RECORD, auth: 'oauth' })
    expect(await providerKeyDigest(secrets, 'oauth')).toBeUndefined()
    expect(await providerKeyDigest(secrets, 'missing')).toBeUndefined()
    await secrets.store(providerSecretKey('damaged'), 'not json{')
    expect(await providerKeyDigest(secrets, 'damaged')).toBeUndefined()
  })

  // P2-A: the preview's quote bills the account that pays: a
  // bring-your-own model's own provider credential, Meta's account
  // otherwise. The quote, the per-attempt admission and the final
  // transport admission compare this one value.
  it('names the paying credential per model for the preview quote', async () => {
    const secrets = memorySecrets()
    await saveProviderCredential(secrets, 'openai', { ...RECORD, secret: 'openai-key' })
    const openaiDigest = createHash('sha256').update('openai-key').digest('hex')
    const meta = metaAccount
    expect(await payingKeyDigest(secrets, 'openai/gpt-5', meta)).toBe(openaiDigest)
    expect(await payingKeyDigest(secrets, 'muse-spark-1.3', meta)).toBe('meta-account')
    expect(await payingKeyDigest(secrets, 'meta/custom', meta)).toBe('meta-account')
    // A replaced provider key quotes the new digest, voiding the old approval.
    await saveProviderCredential(secrets, 'openai', { ...RECORD, secret: 'openai-next' })
    expect(await payingKeyDigest(secrets, 'openai/gpt-5', meta)).toBe(
      createHash('sha256').update('openai-next').digest('hex'),
    )
    // No record for the provider: no identity to quote.
    expect(await payingKeyDigest(secrets, 'xai/grok', meta)).toBeUndefined()
  })

  // P2-4: the per-provider identity map behind the offers: Meta keeps the
  // generic account, apiKey records contribute digests, anything else keeps
  // legacy unattributed matching with no entry.
  it('maps each provider to its spending identity for quota offers', async () => {
    const secrets = memorySecrets()
    await saveProviderCredential(secrets, 'openai', { ...RECORD, secret: 'openai-key' })
    await saveProviderCredential(secrets, 'oauth', { ...RECORD, auth: 'oauth' })
    const identities = await providerIdentities(
      secrets,
      ['meta', 'openai', 'oauth', 'missing'],
      'meta-account',
    )
    expect(identities.get('meta')).toBe('meta-account')
    expect(identities.get('openai')).toBe(createHash('sha256').update('openai-key').digest('hex'))
    expect(identities.has('oauth')).toBe(false)
    expect(identities.has('missing')).toBe(false)
    // No Meta account signed in: Meta keeps no entry either.
    const signedOut = await providerIdentities(secrets, ['meta', 'openai'], undefined)
    expect(signedOut.has('meta')).toBe(false)
    expect(signedOut.get('openai')).toBe(identities.get('openai'))
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
