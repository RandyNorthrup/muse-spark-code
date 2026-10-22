// Shared steps for the real-store migration suites (Windows and POSIX):
// the installed-shape subscription record with generated test-only
// tokens, the real controller over a real session/reader/store, and the
// migrated-slot assertion. Every step drives real code over the real
// broker and the real native store; nothing here substitutes for one.
import { AsyncEntry } from '@napi-rs/keyring'
import { randomBytes } from 'node:crypto'
import { expect } from 'vitest'
import type { VaultFirstPartyReader } from '../../../../src/core/vault/broker/firstParty'
import type { VaultManageSession } from '../../../../src/core/vault/broker/manageClient'
import { keyringSecretStore } from '../../../../src/runtime/keyStore'
import { eraseItem } from '../../../../src/core/vault/migrate/material'
import type { MigrationCredential } from '../../../../src/core/vault/migrate/ports'
import { CredentialMigrationController } from '../../../../src/host/vault/migrateCredentials'
import {
  createMigrationShell,
  type MigrationShell,
} from '../../../../src/host/vault/migrationShell'
import type { SecretStore } from '../../../../src/host/auth/credentialStore'
import type { Logger } from '../../../../src/host/logger'
import { UI_TEXT, VAULT_PROTOCOL_VERSION } from '../../../../src/shared/constants'

/** Installed-shape ChatGPT subscription record; tokens are generated and never sent. */
export function installedChatGptRecord() {
  return {
    v: 1 as const,
    auth: 'subscription' as const,
    origin: 'https://api.openai.com',
    issuer: 'https://auth.openai.com',
    clientId: `oaiapp_${randomBytes(8).toString('hex')}`,
    hostId: randomBytes(8).toString('hex'),
    accessToken: `test-access-${randomBytes(16).toString('hex')}`,
    refreshToken: `test-refresh-${randomBytes(16).toString('hex')}`,
    expiresAt: Date.now() + 3_600_000,
    scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    nonce: randomBytes(16).toString('hex'),
  }
}

export interface MigrationFlow {
  readonly controller: CredentialMigrationController
  readonly shell: MigrationShell
}

/**
The real controller over the real session, reader and store, with the
providers seam answering no providers: a slot that still migrates proves
the controller found it itself.
*/
export function chatgptMigrationFlow(deps: {
  secrets: SecretStore
  session: VaultManageSession
  reader: VaultFirstPartyReader
  log: Logger
}): MigrationFlow {
  const controller = new CredentialMigrationController({
    secrets: deps.secrets,
    listProviderIds: () => Promise.resolve([]),
    ports: {
      snapshot: () => deps.session.snapshot(),
      write: (...args) => deps.session.write(...args),
      remove: (...args) => deps.session.remove(...args),
      firstPartyRead: (...args) => deps.reader.read(...args),
    },
    minorRelease: () => 19,
    now: Date.now,
    log: deps.log,
    label: UI_TEXT.vault.secret,
  })
  const shell = createMigrationShell(deps.secrets)
  shell.bind(controller)
  return { controller, shell }
}

/** Set up the broker and confirm it, wiping the recovery code. */
export async function confirmBrokerSetup(session: VaultManageSession): Promise<void> {
  const setup = await session.setup()
  try {
    await session.confirmSetup(setup.setupId)
  } finally {
    setup.code.fill(0)
  }
}

/**
A uniquely named real native store, owning only this run's generated
entries; no person's key is read.
*/
export function uniqueKeyringStore(lockScope: string): SecretStore {
  const service = `Muse RLM109 ${randomBytes(16).toString('hex')}`
  return keyringSecretStore((_service, account) => new AsyncEntry(service, account), {
    lockScope,
  })
}

/** A different origin must not read the row; its failure (if any) stays a refusal. */
export async function expectOriginRefused(deps: {
  reader: VaultFirstPartyReader
  itemId: string
  origin: string
  message: string
}): Promise<void> {
  let isOriginRefused = false
  try {
    const unexpected = await deps.reader.read({
      v: VAULT_PROTOCOL_VERSION,
      kind: 'firstPartyRead',
      itemId: deps.itemId,
      origin: deps.origin,
      client: 'provider',
    })
    unexpected.fill(0)
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error
    isOriginRefused = true
  }
  expect(isOriginRefused, deps.message).toBe(true)
}

/**
The vault copy carries exactly the installed bytes as a hidden,
first-party, never-agent row of the codec's own kind, and the legacy copy
still holds them. Every read-back buffer is wiped; assertions report
booleans, never values.
*/
export async function assertMigratedSlot(deps: {
  reader: VaultFirstPartyReader
  session: VaultManageSession
  codec: MigrationCredential
  secrets: SecretStore
  origin: string
  expected: string
}): Promise<void> {
  const bytes = await deps.reader.read({
    v: VAULT_PROTOCOL_VERSION,
    kind: 'firstPartyRead',
    itemId: deps.codec.itemId,
    origin: deps.origin,
    client: 'provider',
  })
  const item = deps.codec.decode(Buffer.from(deps.expected))
  try {
    if (item.material.kind !== 'apiKey' && item.material.kind !== 'secret')
      throw new Error('the installed codec returned a different material kind')
    expect(Buffer.from(item.material.value).equals(bytes)).toBe(true)
    expect((await deps.secrets.get(deps.codec.key)) === deps.expected).toBe(true)
    const snapshot = await deps.session.snapshot()
    const metadata = snapshot.items.find((entry) => entry.id === deps.codec.itemId)
    expect(metadata?.kind).toBe(item.material.kind)
    expect(metadata?.hidden).toBe(true)
    expect(metadata?.firstParty).toBe(true)
    expect(metadata?.policy.mode).toBe('never')
  } finally {
    bytes.fill(0)
    eraseItem(item)
  }
}

/**
The whole subscription-slot drive both suites run: the installed record
is taken on unlock, a token refresh mirrors through the shell, the row
survives lock/unlock, the suite's own `extra` check runs while both
copies live, then sign-out removes both and the log stayed quiet. The
legacy slot is always cleaned up.
*/
export async function driveSubscriptionMigration(deps: {
  secrets: SecretStore
  session: VaultManageSession
  reader: VaultFirstPartyReader
  log: Logger
  logged: string[]
  codec: MigrationCredential
  origin: string
  extra?: () => Promise<void>
}): Promise<void> {
  const { controller: active, shell } = chatgptMigrationFlow({
    secrets: deps.secrets,
    session: deps.session,
    reader: deps.reader,
    log: deps.log,
  })
  const migrated = (expected: string) =>
    assertMigratedSlot({
      reader: deps.reader,
      session: deps.session,
      codec: deps.codec,
      secrets: deps.secrets,
      origin: deps.origin,
      expected,
    })
  try {
    // The installed sign-in wrote here before the vault ever unlocked:
    // the raw store holds the record, taken on unlock.
    const signedIn = installedChatGptRecord()
    await deps.secrets.store(deps.codec.key, JSON.stringify(signedIn))
    await active.ensureMigrated()
    await migrated(JSON.stringify(signedIn))

    // A token refresh while unlocked mirrors through the shell.
    const refreshed = {
      ...signedIn,
      accessToken: `test-access-${randomBytes(16).toString('hex')}`,
      refreshToken: `test-refresh-${randomBytes(16).toString('hex')}`,
      expiresAt: Date.now() + 3_600_000,
    }
    await shell.store.store(deps.codec.key, JSON.stringify(refreshed))
    await migrated(JSON.stringify(refreshed))
    await deps.session.lock()
    await deps.session.unlock(null)
    await active.ensureMigrated()
    await migrated(JSON.stringify(refreshed))

    await deps.extra?.()

    await shell.store.delete(deps.codec.key)
    expect((await deps.secrets.get(deps.codec.key)) === undefined).toBe(true)
    const signedOut = await deps.session.snapshot()
    expect(signedOut.items.some((entry) => entry.id === deps.codec.itemId)).toBe(false)
    expect(
      deps.logged.filter((line) => line.startsWith('warn:') || line.startsWith('error:')),
    ).toEqual([])
  } finally {
    await deps.secrets.delete(deps.codec.key)
  }
}
