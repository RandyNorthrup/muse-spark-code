// RVMSM109: the restored migration codecs and Windows pipe contract are
// proven through their real modules only — pure decode/encode of given
// bytes, no store, vault or OS stand-in. The 2026-10-12 codec suite ran
// on an in-memory vault and a Map secret store; it stays deleted.
import { describe, expect, it } from 'vitest'
import { accountSecretMigrationCredential } from '../../../src/core/vault/migrate/accountSecrets'
import { chatgptSubscriptionMigrationCredential } from '../../../src/core/vault/migrate/chatgptSubscription'
import { providerCredentialMigrationCredential } from '../../../src/core/vault/migrate/providerCredentials'
import { VaultMigrationFault } from '../../../src/core/vault/migrate/ports'
import { isVaultPipeServerTrusted } from '../../../src/core/vault/broker/windowsPipe'

const now = () => 1_700_000_000_000
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8')

describe('provider credential migration codec', () => {
  it('round-trips a bare apiKey record to its installed bytes', () => {
    const codec = providerCredentialMigrationCredential('openrouter', now)
    const record = {
      v: 1,
      auth: 'apiKey',
      origin: 'https://openrouter.ai',
      secret: 'not-a-real-key-for-tests',
    }
    const item = codec.decode(bytes(record))
    expect(item.material.kind).toBe('apiKey')
    expect(JSON.parse(Buffer.from(codec.encode(item)).toString('utf8'))).toEqual(record)
  })

  it('refuses a record with an unknown field instead of dropping it', () => {
    const codec = providerCredentialMigrationCredential('openrouter', now)
    expect(() =>
      codec.decode(
        bytes({ v: 1, auth: 'apiKey', origin: 'https://openrouter.ai', secret: 'x', extra: 1 }),
      ),
    ).toThrow(VaultMigrationFault)
  })

  it('refuses the chatgpt slot, which another codec owns', () => {
    expect(() => providerCredentialMigrationCredential('chatgpt', now)).toThrow(VaultMigrationFault)
  })
})

describe('account secret migration codec', () => {
  const record = {
    provider: 'openrouter',
    account: 'work',
    origin: 'https://openrouter.ai',
    v: 1,
    auth: 'oauth',
    secret: 'not-a-real-token-for-tests',
  }

  it('round-trips a non-default account record', () => {
    const codec = accountSecretMigrationCredential('openrouter', 'work', now)
    const item = codec.decode(bytes(record))
    expect(JSON.parse(Buffer.from(codec.encode(item)).toString('utf8'))).toEqual(record)
  })

  it('refuses a record that names another account', () => {
    const codec = accountSecretMigrationCredential('openrouter', 'work', now)
    expect(() => codec.decode(bytes({ ...record, account: 'personal' }))).toThrow(
      VaultMigrationFault,
    )
  })
})

describe('chatgpt subscription migration codec', () => {
  // The installed writer's shape (sign-in completion writes these keys in
  // this order); values are test-only and never issued or sent.
  const record = {
    v: 1,
    auth: 'subscription',
    origin: 'https://api.openai.com',
    issuer: 'https://auth.openai.com',
    clientId: 'oaiapp_test_client',
    hostId: 'test-host-id',
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: 1_800_000_000_000,
    scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    nonce: 'test-nonce',
  }

  it('round-trips the installed record to its exact bytes, opaque and bound', () => {
    const codec = chatgptSubscriptionMigrationCredential(now)
    expect(codec.key).toBe('museSpark.provider.chatgpt')
    const item = codec.decode(bytes(record))
    expect(item.material.kind).toBe('secret')
    expect(item.metadata.hidden).toBe(true)
    expect(item.metadata.firstParty).toBe(true)
    expect(item.metadata.policy.mode).toBe('never')
    expect(item.metadata.bindings).toEqual([{ kind: 'origin', origin: 'https://api.openai.com' }])
    expect(Buffer.from(codec.encode(item)).toString('utf8')).toBe(JSON.stringify(record))
  })

  it('keeps the optional refresh fields byte-exact', () => {
    const codec = chatgptSubscriptionMigrationCredential(now)
    // Installed key order: the sign-in writer places accountIdHash after
    // hostId, and refresh appends pendingRefresh last.
    const withOptionals = {
      v: 1,
      auth: 'subscription',
      origin: 'https://api.openai.com',
      issuer: 'https://auth.openai.com',
      clientId: 'oaiapp_test_client',
      hostId: 'test-host-id',
      accountIdHash: 'a1'.repeat(32),
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: 1_800_000_000_000,
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      nonce: 'test-nonce',
      pendingRefresh: {},
    }
    const item = codec.decode(bytes(withOptionals))
    expect(Buffer.from(codec.encode(item)).toString('utf8')).toBe(JSON.stringify(withOptionals))
  })

  it('refuses a record with an unknown field instead of dropping it', () => {
    const codec = chatgptSubscriptionMigrationCredential(now)
    expect(() => codec.decode(bytes({ ...record, extra: 1 }))).toThrow(VaultMigrationFault)
    expect(() =>
      codec.decode(bytes({ ...record, pendingRefresh: { idToken: 't', extra: 1 } })),
    ).toThrow(VaultMigrationFault)
  })

  it('refuses a bare provider record and an apiKey item for this slot', () => {
    const codec = chatgptSubscriptionMigrationCredential(now)
    expect(() =>
      codec.decode(bytes({ v: 1, auth: 'apiKey', origin: 'https://api.openai.com', secret: 'x' })),
    ).toThrow(VaultMigrationFault)
    const foreign = providerCredentialMigrationCredential('openrouter', now).decode(
      bytes({ v: 1, auth: 'apiKey', origin: 'https://openrouter.ai', secret: 'x' }),
    )
    expect(foreign.material.kind).toBe('apiKey')
    expect(() =>
      codec.encode({ ...foreign, metadata: { ...foreign.metadata, id: codec.itemId } }),
    ).toThrow(VaultMigrationFault)
  })
})

describe('Windows vault pipe server check', () => {
  const server = {
    v: 1,
    processId: 4242,
    userId: 'S-1-5-21-1000',
    startedAt: 123_456,
    executable: String.raw`C:\Muse\MuseSparkVaultPipe.exe`,
    remote: false,
    ownerOnlyDacl: true,
  }
  const answer = { v: 1, id: 1, result: 'ok', ownerSid: 'S-1-5-21-1000', server }

  it('trusts only the owner SID the OS reported', () => {
    expect(isVaultPipeServerTrusted(answer, 'S-1-5-21-1000')).toBe(true)
    expect(isVaultPipeServerTrusted(answer, 'S-1-5-21-9999')).toBe(false)
    expect(
      isVaultPipeServerTrusted({ ...answer, server: { ...server, remote: true } }, 'S-1-5-21-1000'),
    ).toBe(false)
    expect(
      isVaultPipeServerTrusted(
        { ...answer, server: { ...server, ownerOnlyDacl: false } },
        'S-1-5-21-1000',
      ),
    ).toBe(false)
    expect(isVaultPipeServerTrusted('garbage', 'S-1-5-21-1000')).toBe(false)
  })
})
