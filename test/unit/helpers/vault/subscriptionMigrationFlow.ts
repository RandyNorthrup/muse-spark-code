// Shared steps for the real-store migration suites (Windows and POSIX):
// the installed-shape subscription record with generated test-only
// tokens, the real controller over a real session/reader/store, and the
// migrated-slot assertion. Every step drives real code over the real
// broker and the real native store; nothing here substitutes for one.
import { AsyncEntry } from '@napi-rs/keyring'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect } from 'vitest'
import type { VaultBrokerClient } from '../../../../src/core/vault/broker/client'
import { VaultFirstPartyReader } from '../../../../src/core/vault/broker/firstParty'
import { chatgptSubscriptionMigrationCredential } from '../../../../src/core/vault/migrate/chatgptSubscription'
import { recordingLogger } from '../recordingLogger'
import { VaultManageSession } from '../../../../src/core/vault/broker/manageClient'
import { encodeVaultMaterial } from '../../../../src/core/vault/crypto'
import { keyringSecretStore } from '../../../../src/runtime/keyStore'
import { FileAccountsMetadata } from '../../../../src/runtime/providers/providersFileStore'
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

/** Two installed-shape subscription records: the sign-in and its rotation. */
export function chatgptSeeds(): { initial: () => string; rotated: () => string } {
  return {
    initial: () => JSON.stringify(installedChatGptRecord()),
    rotated: () => JSON.stringify(installedChatGptRecord()),
  }
}

/**
Two installed-shape pooled account records in the installed writer's key
order: the stored credential and its rotation. Secrets are generated and
never sent.
*/
export function pooledAccountSeeds(
  provider: string,
  account: string,
  origin: string,
): { initial: () => string; rotated: () => string } {
  const one = () =>
    JSON.stringify({
      provider,
      account,
      origin,
      v: 1,
      auth: 'oauth',
      secret: `test-token-${randomBytes(16).toString('hex')}`,
    })
  return { initial: one, rotated: one }
}

/**
Seed the runtime's account-pool file with one provider row carrying the
named accounts: the same file the CLI, ACP and headless read.
*/
export function writeAccountPool(
  file: string,
  provider: string,
  origin: string,
  accounts: readonly string[],
): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(
    file,
    `${JSON.stringify({
      providers: {
        [provider]: {
          id: provider,
          policyProvider: provider,
          product: provider,
          auth: 'oauth',
          origin,
          accounts: accounts.map((id, order) => ({ id, label: id, order, thresholds: {} })),
        },
      },
    })}\n`,
    'utf8',
  )
}

/** Pooled account ids through the real file-backed metadata, as the runtime reads them. */
export function filePoolAccounts(file: string): (provider: string) => Promise<readonly string[]> {
  const metadata = new FileAccountsMetadata(file)
  return async (provider) => {
    const entry = await metadata.read(provider)
    return entry?.accounts?.map((row) => row.id) ?? []
  }
}

export interface MigrationFlow {
  readonly controller: CredentialMigrationController
  readonly shell: MigrationShell
}

/** The real controller over the real session, reader and store, bound to its shell. */
export function migrationFlow(deps: {
  secrets: SecretStore
  session: VaultManageSession
  reader: VaultFirstPartyReader
  log: Logger
  providers: readonly string[]
  listAccounts?: (provider: string) => Promise<readonly string[]>
  minorRelease?: () => number
}): MigrationFlow {
  const controller = new CredentialMigrationController({
    secrets: deps.secrets,
    listProviderIds: () => Promise.resolve(deps.providers),
    ...(deps.listAccounts !== undefined && { listAccounts: deps.listAccounts }),
    ports: {
      snapshot: () => deps.session.snapshot(),
      write: (...args) => deps.session.write(...args),
      remove: (...args) => deps.session.remove(...args),
      firstPartyRead: (...args) => deps.reader.read(...args),
    },
    minorRelease: deps.minorRelease ?? (() => 19),
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
An unlocked real session with its reader and a uniquely named real store.
A fresh client sets its broker up; a shared one meets whatever state the
earlier case left, so it sets up or unlocks only what the state needs.
*/
export async function openMigrationSession(deps: {
  connect: () => Promise<VaultBrokerClient>
  lockScope: string
  fresh: boolean
  /** A store this run already opened. Absent: a new uniquely named native store. */
  secrets?: SecretStore
}): Promise<{ session: VaultManageSession; secrets: SecretStore; reader: VaultFirstPartyReader }> {
  const session = new VaultManageSession(deps.connect, encodeVaultMaterial)
  if (deps.fresh) {
    await confirmBrokerSetup(session)
  } else {
    const before = await session.snapshot()
    const state = before.status.state
    if (state === 'uncreated') await confirmBrokerSetup(session)
    else if (state === 'locked') await session.unlock(null)
  }
  return {
    session,
    secrets: deps.secrets ?? uniqueKeyringStore(deps.lockScope),
    reader: new VaultFirstPartyReader(deps.connect),
  }
}

/** An open migration session with the log its driver asserts stayed quiet. */
export async function openLoggedSession(deps: {
  connect: () => Promise<VaultBrokerClient>
  lockScope: string
  fresh: boolean
  secrets?: SecretStore
}): Promise<{
  session: VaultManageSession
  secrets: SecretStore
  reader: VaultFirstPartyReader
  log: Logger
  logged: string[]
}> {
  const opened = await openMigrationSession(deps)
  const { log, logged } = recordingLogger()
  return { ...opened, log, logged }
}

/** Service name for one run's native store. Not the product keychain service. */
export function migrationKeyringService(): string {
  return `Muse RLM109 ${randomBytes(16).toString('hex')}`
}

/**
A uniquely named real native store, owning only this run's generated
entries; no person's key is read. Pass `service` when another process must
open the same entries.
*/
export function uniqueKeyringStore(
  lockScope: string,
  service = migrationKeyringService(),
): SecretStore {
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
first-party, never-agent row of the codec's own kind; the legacy copy
holds them while present, and the shell reads them either way (straight
through while present, authoritatively from the vault when retired).
Every read-back buffer is wiped; assertions report booleans, never
values.
*/
export async function assertMigratedSlot(deps: {
  reader: VaultFirstPartyReader
  session: VaultManageSession
  codec: MigrationCredential
  secrets: SecretStore
  shell: MigrationShell
  origin: string
  expected: string
  isLegacyPresent: boolean
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
    expect(
      (await deps.secrets.get(deps.codec.key)) ===
        (deps.isLegacyPresent ? deps.expected : undefined),
    ).toBe(true)
    expect((await deps.shell.store.get(deps.codec.key)) === deps.expected).toBe(true)
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
Sign-out removes both copies and the log stayed quiet: the legacy slot
is absent and the vault row is gone.
*/
export async function assertSignedOut(deps: {
  secrets: SecretStore
  session: VaultManageSession
  codec: MigrationCredential
  logged: string[]
}): Promise<void> {
  expect((await deps.secrets.get(deps.codec.key)) === undefined).toBe(true)
  const signedOut = await deps.session.snapshot()
  expect(signedOut.items.some((entry) => entry.id === deps.codec.itemId)).toBe(false)
  expect(
    deps.logged.filter((line) => line.startsWith('warn:') || line.startsWith('error:')),
  ).toEqual([])
}

/**
The whole slot drive both suites run: the installed record is taken on
unlock, a rotation mirrors through the shell, the row survives
lock/unlock, the suite's own `extra` check runs while both copies live,
then sign-out removes both and the log stayed quiet. The legacy slot is
always cleaned up. Seeds are installed-shape JSON with generated
test-only values, never issued or sent.
*/
export async function driveMigratedSlot(deps: {
  flow: MigrationFlow
  secrets: SecretStore
  session: VaultManageSession
  reader: VaultFirstPartyReader
  logged: string[]
  codec: MigrationCredential
  origin: string
  initial: () => string
  rotated: () => string
  extra?: (ctx: { reader: VaultFirstPartyReader; codec: MigrationCredential }) => Promise<void>
}): Promise<void> {
  const { controller: active, shell } = deps.flow
  const migrated = (expected: string) =>
    assertMigratedSlot({
      reader: deps.reader,
      session: deps.session,
      codec: deps.codec,
      secrets: deps.secrets,
      shell,
      origin: deps.origin,
      expected,
      isLegacyPresent: true,
    })
  try {
    // The installed sign-in wrote here before the vault ever unlocked:
    // the raw store holds the record, taken on unlock.
    const signedIn = deps.initial()
    await deps.secrets.store(deps.codec.key, signedIn)
    await active.ensureMigrated()
    await migrated(signedIn)

    // A rotation while unlocked mirrors through the shell.
    const refreshed = deps.rotated()
    await shell.store.store(deps.codec.key, refreshed)
    await migrated(refreshed)
    await deps.session.lock()
    await deps.session.unlock(null)
    await active.ensureMigrated()
    await migrated(refreshed)

    await deps.extra?.({ reader: deps.reader, codec: deps.codec })

    await shell.store.delete(deps.codec.key)
    await assertSignedOut({
      secrets: deps.secrets,
      session: deps.session,
      codec: deps.codec,
      logged: deps.logged,
    })
  } finally {
    await deps.secrets.delete(deps.codec.key)
  }
}

/**
A real session with the controller bound at an adjustable minor release:
19 until the caller moves it, so the retain window can be crossed by
setting `release.current`. The log is the one its drive asserts stayed quiet.
*/
export async function openRetireFlow(deps: {
  connect: () => Promise<VaultBrokerClient>
  lockScope: string
  fresh: boolean
  secrets?: SecretStore
}) {
  const opened = await openLoggedSession(deps)
  const release = { current: 19 }
  const flow = migrationFlow({
    secrets: opened.secrets,
    session: opened.session,
    reader: opened.reader,
    log: opened.log,
    providers: [],
    minorRelease: () => release.current,
  })
  return { ...opened, ...flow, release }
}

/**
The retire drive both suites run over the subscription slot: taken on
unlock at release 19 with its legacy entry kept; at release 21 the next
unlock retires the legacy entry, and the shell keeps reading the value
authoritatively from the vault. A locked vault reads absent (nothing
provable without the vault); unlocked again, the value is back; sign-out
removes the vault copy last, and the log stayed quiet. The legacy slot is
always cleaned up.
*/
export async function driveRetireCase(deps: {
  connect: () => Promise<VaultBrokerClient>
  lockScope: string
  fresh: boolean
}): Promise<void> {
  const {
    session,
    secrets,
    reader,
    logged,
    release,
    controller: active,
    shell,
  } = await openRetireFlow(deps)
  const codec = chatgptSubscriptionMigrationCredential(Date.now)
  const origin = 'https://api.openai.com'
  const migrated = (expected: string, isLegacyPresent: boolean) =>
    assertMigratedSlot({
      reader,
      session,
      codec,
      secrets,
      shell,
      origin,
      expected,
      isLegacyPresent,
    })
  try {
    const signedIn = JSON.stringify(installedChatGptRecord())
    await secrets.store(codec.key, signedIn)
    await active.ensureMigrated()
    await migrated(signedIn, true)

    // Two minor releases later the legacy entry retires on unlock; the
    // shell keeps serving the value from the vault.
    release.current = 21
    await active.ensureMigrated()
    await migrated(signedIn, false)

    // Locked, the retired slot reads absent; unlocked, it reads again.
    await session.lock()
    expect((await shell.store.get(codec.key)) === undefined).toBe(true)
    await session.unlock(null)
    await migrated(signedIn, false)

    await shell.store.delete(codec.key)
    await assertSignedOut({ secrets, session, codec, logged })
  } finally {
    await secrets.delete(codec.key)
  }
}

/**
One suite case over a real connection: the session, store, reader, log,
pool file (for pooled slots) and controller are built, then the slot
drive runs. Suites differ only in how they connect and what extra check
they run while both copies live.
*/
export async function driveSlotCase(deps: {
  connect: () => Promise<VaultBrokerClient>
  lockScope: string
  fresh: boolean
  codec: MigrationCredential
  origin: string
  providers: readonly string[]
  pool?: { file: string; provider: string; origin: string; accounts: readonly string[] }
  initial: () => string
  rotated: () => string
  extra?: (ctx: { reader: VaultFirstPartyReader; codec: MigrationCredential }) => Promise<void>
}): Promise<void> {
  const { session, secrets, reader, log, logged } = await openLoggedSession(deps)
  if (deps.pool !== undefined)
    writeAccountPool(deps.pool.file, deps.pool.provider, deps.pool.origin, deps.pool.accounts)
  const flow = migrationFlow({
    secrets,
    session,
    reader,
    log,
    providers: deps.providers,
    ...(deps.pool !== undefined && { listAccounts: filePoolAccounts(deps.pool.file) }),
  })
  await driveMigratedSlot({
    flow,
    secrets,
    session,
    reader,
    logged,
    codec: deps.codec,
    origin: deps.origin,
    initial: deps.initial,
    rotated: deps.rotated,
    ...(deps.extra !== undefined && { extra: deps.extra }),
  })
}
