// CM1094R7 (RVCM1094F findings 1-4): migration engine lifecycle regressions.
// Finding 1: a stale lease must wipe the legacy read buffer before refusing.
// Finding 2: a vault-side validation failure keeps the retire intent instead
// of reporting a changed legacy copy. Finding 3: startup recovery settles a
// first store interrupted after its journal intent commits but before its
// first vault write — a kill at every await of store, rotate, delete and
// retire, then recovery, leaves the old state whole or the new state whole
// with a schema-valid record. Finding 4: a delete after an interrupted
// rotation records a schema-valid final row. Every drill runs on fakes with
// generated material only; only the crash itself is a rejected port.
import { describe, expect, it, vi } from 'vitest'
import { InMemoryVault } from '../helpers/vault/core'
import { VaultMigration } from '../../../src/core/vault/migrate/migrate'
import {
  migrationRecordSchema,
  type MigrationCredential,
  type MigrationDeps,
  type MigrationLease,
  type MigrationRecord,
} from '../../../src/core/vault/migrate/ports'
import { eraseItem } from '../../../src/core/vault/migrate/material'
import { modelApiMigrationCredential } from '../../../src/core/vault/migrate/modelApi'
import { providerCredentialMigrationCredential } from '../../../src/core/vault/migrate/providerCredentials'
import { accountSecretMigrationCredential } from '../../../src/core/vault/migrate/accountSecrets'
import { saveProviderCredential } from '../../../src/host/providers/credentialRecords'
import { secretStorageAccountVault } from '../../../src/host/providers/accountSecrets'
import type { SecretStore } from '../../../src/host/auth/credentialStore'
import { generatedKey, migrationFixture } from './migrationFixture'

type CrashPort =
  | 'vault.list'
  | 'vault.read'
  | 'vault.write'
  | 'vault.remove'
  | 'legacy.read'
  | 'legacy.write'
  | 'legacy.remove'
  | 'journal.read'
  | 'journal.write'

function interrupted(): Error {
  return new Error('crash: interrupted before commit')
}

/** Engine over fakes with a programmable single-shot crash on one port call. */
function crashFixture(credential: MigrationCredential) {
  const vault = new InMemoryVault()
  const legacy = new Map<string, Uint8Array>()
  const journal = new Map<string, MigrationRecord>()
  const writtenRows: unknown[] = []
  let queue = Promise.resolve()
  let release = 10
  let crash: { port: CrashPort; call: number } | null = null
  const counts = new Map<CrashPort, number>()
  function isArmed(port: CrashPort): boolean {
    const call = (counts.get(port) ?? 0) + 1
    counts.set(port, call)
    return crash !== null && crash.port === port && crash.call === call
  }
  const deps: MigrationDeps = {
    vault: {
      list: () => (isArmed('vault.list') ? Promise.reject(interrupted()) : vault.list()),
      read: (id) => (isArmed('vault.read') ? Promise.reject(interrupted()) : vault.read(id)),
      write: (item, authorize) => {
        if (isArmed('vault.write')) return Promise.reject(interrupted())
        authorize()
        return vault.write(item)
      },
      remove: (id, authorize) => {
        if (isArmed('vault.remove')) return Promise.reject(interrupted())
        authorize()
        return vault.remove(id)
      },
    },
    legacy: {
      read: (key) => {
        if (isArmed('legacy.read')) return Promise.reject(interrupted())
        const value = legacy.get(key)
        return Promise.resolve(value ? Uint8Array.from(value) : null)
      },
      write: (key, value, authorize) => {
        if (isArmed('legacy.write')) return Promise.reject(interrupted())
        authorize()
        legacy.set(key, Uint8Array.from(value))
        return Promise.resolve()
      },
      remove: (key, authorize) => {
        if (isArmed('legacy.remove')) return Promise.reject(interrupted())
        authorize()
        legacy.delete(key)
        return Promise.resolve()
      },
    },
    journal: {
      sourceId: 'test-crash-source',
      read: (key) =>
        isArmed('journal.read')
          ? Promise.reject(interrupted())
          : Promise.resolve(structuredClone(journal.get(key) ?? null)),
      write: (row, authorize) => {
        if (isArmed('journal.write')) return Promise.reject(interrupted())
        authorize()
        writtenRows.push(structuredClone(row))
        journal.set(row.key, structuredClone(row))
        return Promise.resolve()
      },
    },
    owner: {
      async run<T>(work: (lease: MigrationLease) => Promise<T>): Promise<T> {
        const previous = queue
        let releaseOwner!: () => void
        queue = new Promise<void>((resolve) => {
          releaseOwner = (): void => {
            resolve()
          }
        })
        await previous
        try {
          return await work({ assertCurrent: () => undefined })
        } finally {
          releaseOwner()
        }
      },
    },
    minorRelease: () => release,
    onRetired: vi.fn(),
  }
  return {
    vault,
    legacy,
    journal,
    writtenRows,
    deps,
    service: new VaultMigration(deps, [credential]),
    arm: (port: CrashPort, call = 1): void => {
      // Seeding calls do not consume kill numbers: the count restarts here,
      // so `call` names the Nth call of the crashed operation itself.
      counts.clear()
      crash = { port, call }
    },
    advanceRelease: () => {
      release += 1
    },
  }
}

type CrashFixture = ReturnType<typeof crashFixture>
type CodecKind = 'modelApi' | 'provider' | 'account'

const CRASH_PROVIDER = 'openai'
const CRASH_ACCOUNT = 'work'
const CRASH_ORIGIN = 'https://api.openai.com'

const CREDENTIAL_FACTORIES = {
  provider: () => providerCredentialMigrationCredential(CRASH_PROVIDER, () => 1000),
  account: () => accountSecretMigrationCredential(CRASH_PROVIDER, CRASH_ACCOUNT, () => 1000),
  modelApi: () => modelApiMigrationCredential(() => 1000),
} as const

function credentialFor(kind: CodecKind): MigrationCredential {
  return CREDENTIAL_FACTORIES[kind]()
}

/** Legacy bytes through the real installed writer, so `decode` meets installed bytes. */
async function legacyBytesFor(kind: CodecKind, secret: string): Promise<Uint8Array> {
  if (kind === 'modelApi') return Buffer.from(secret, 'utf8')
  const entries = new Map<string, string>()
  const secrets: SecretStore = {
    get: (key) => Promise.resolve(entries.get(key)),
    store: (key, value) => {
      entries.set(key, value)
      return Promise.resolve()
    },
    delete: (key) => {
      entries.delete(key)
      return Promise.resolve()
    },
  }
  if (kind === 'provider') {
    await saveProviderCredential(secrets, CRASH_PROVIDER, {
      v: 1,
      auth: 'apiKey',
      origin: CRASH_ORIGIN,
      secret,
    })
  } else {
    await secretStorageAccountVault(secrets).write(
      { provider: CRASH_PROVIDER, account: CRASH_ACCOUNT, origin: CRASH_ORIGIN },
      {
        provider: CRASH_PROVIDER,
        account: CRASH_ACCOUNT,
        origin: CRASH_ORIGIN,
        v: 1,
        auth: 'apiKey',
        secret,
      },
    )
  }
  const credential = credentialFor(kind)
  const stored = entries.get(credential.key)
  if (stored === undefined) throw new Error('seed writer missed the credential key')
  return Buffer.from(stored, 'utf8')
}

function secretFor(kind: CodecKind, tag: string): string {
  return kind === 'modelApi'
    ? `LLM_TestOnly${tag}00000000000000000000`
    : `test-only-${tag}-${kind}-secret`
}

/** The vault's current value for the credential, or null when no item is listed. */
async function vaultValue(
  f: CrashFixture,
  credential: MigrationCredential,
): Promise<Uint8Array | null> {
  const listing = await f.vault.list()
  if (listing.every((metadata) => metadata.id !== credential.itemId)) return null
  const item = await f.vault.read(credential.itemId)
  try {
    return credential.encode(item)
  } finally {
    eraseItem(item)
  }
}

function expectBytes(
  actual: Uint8Array | null | undefined,
  expected: Uint8Array,
  label: string,
): void {
  expect(actual !== null && actual !== undefined, label).toBe(true)
  expect([...actual!], label).toEqual([...expected])
  actual!.fill(0)
}

function expectLegacy(
  f: CrashFixture,
  credential: MigrationCredential,
  expected: Uint8Array | null,
  label: string,
): void {
  const stored = f.legacy.get(credential.key)
  if (expected === null) {
    expect(stored, label).toBeUndefined()
    return
  }
  expectBytes(stored ? Uint8Array.from(stored) : null, expected, label)
}

/** Every journal row the run wrote, plus the current one, parses against the schema. */
function expectRowsValid(f: CrashFixture, credential: MigrationCredential): void {
  for (const row of f.writtenRows) migrationRecordSchema.parse(row)
  const current = f.journal.get(credential.key)
  if (current !== undefined) migrationRecordSchema.parse(current)
}

describe('RVCM1094F finding 1: a stale lease wipes before it refuses', () => {
  it('wipes the legacy read buffer when the lease goes stale after the read', async () => {
    const f = migrationFixture()
    f.legacy.set(f.credential.key, generatedKey())
    await f.service.migrate(f.credential.key)
    // The legacy read below returns live key bytes after the lock has
    // already invalidated the lease: the freshness assert then refuses, and
    // the refusal must not leave the returned bytes live.
    const read = f.deps.legacy.read
    f.deps.legacy.read = vi.fn(async (key: string) => {
      const value = await read(key)
      f.invalidate()
      return value
    })
    await expect(f.service.undo(f.credential.key)).rejects.toMatchObject({ code: 'storage' })
    expect(f.owned.length).toBeGreaterThan(0)
    for (const owned of f.owned) expect([...owned].every((byte) => byte === 0)).toBe(true)
    // The durable copy survives the refusal: only the returned buffer is wiped.
    expect(f.legacy.has(f.credential.key)).toBe(true)
  })
})

describe('RVCM1094F finding 2: a vault-side failure keeps the retire intent', () => {
  it('keeps the intent and throws instead of reporting a changed legacy copy', async () => {
    const f = migrationFixture()
    f.legacy.set(f.credential.key, generatedKey())
    await f.service.migrate(f.credential.key)
    f.advanceRelease()
    f.advanceRelease()
    // Park a pending retire intent: crash the legacy delete after the intent
    // row commits.
    vi.mocked(f.deps.legacy.remove).mockRejectedValueOnce(new Error('crash before delete'))
    await expect(f.service.retire(f.credential.key)).rejects.toMatchObject({ code: 'storage' })
    expect(f.journal.get(f.credential.key)?.retireIntent).toBe(true)
    // Break the vault side while the legacy copy is unchanged: the vault
    // now serves the item with its `hidden` migration metadata cleared, so
    // validation fails with `invalid`. (Corrupted behind the read port: the
    // stored item still validates, exactly as a vault serving bad metadata
    // would.)
    const vaultRead = f.deps.vault.read
    f.deps.vault.read = vi.fn(async (id: string) => {
      const item = await vaultRead(id)
      item.metadata.hidden = false
      return item
    })
    await expect(f.service.finishPendingRetires()).rejects.toMatchObject({ code: 'invalid' })
    // The intent is kept and nothing is deleted: a later attempt still sees
    // the vault-side failure, never a diverged legacy copy.
    expect(f.journal.get(f.credential.key)?.retireIntent).toBe(true)
    expect(f.legacy.has(f.credential.key)).toBe(true)
    await expect(f.service.migrate(f.credential.key)).rejects.toMatchObject({ code: 'invalid' })
  })
  it('still reports a genuinely changed legacy copy as diverged', async () => {
    const f = migrationFixture()
    f.legacy.set(f.credential.key, generatedKey())
    await f.service.migrate(f.credential.key)
    f.advanceRelease()
    f.advanceRelease()
    vi.mocked(f.deps.legacy.remove).mockRejectedValueOnce(new Error('crash before delete'))
    await expect(f.service.retire(f.credential.key)).rejects.toMatchObject({ code: 'storage' })
    // The legacy copy changes after the intent while the vault stays valid.
    f.legacy.set(f.credential.key, generatedKey())
    await expect(f.service.finishPendingRetires()).resolves.toEqual({
      [f.credential.key]: 'diverged',
    })
    expect(f.journal.get(f.credential.key)?.retireIntent).toBeUndefined()
  })
})

describe('RVCM1094F finding 4: delete after an interrupted rotation', () => {
  it('records a schema-valid deleted row with no transition-only fields', async () => {
    const f = migrationFixture()
    const old = generatedKey()
    f.legacy.set(f.credential.key, old)
    await f.service.migrate(f.credential.key)
    // Interrupt the rotation before its vault commit: the journal keeps a
    // `writing` row with `previous`.
    vi.mocked(f.deps.vault.write).mockRejectedValueOnce(new Error('crash before commit'))
    const next = generatedKey()
    await expect(f.service.store(f.credential.key, next)).rejects.toMatchObject({
      code: 'storage',
    })
    expect(f.journal.get(f.credential.key)?.previous).not.toBeUndefined()
    // The legacy copy is untouched, so deleting the slot needs no flag, and
    // the terminal row must validate: no `previous`, null digest.
    await f.service.delete(f.credential.key)
    const row = f.journal.get(f.credential.key)
    expect(row?.phase).toBe('deleted')
    expect(row?.previous).toBeUndefined()
    expect(row?.digest).toBeNull()
    migrationRecordSchema.parse(row)
    expect(await f.vault.list()).toEqual([])
    expect(f.legacy.has(f.credential.key)).toBe(false)
    next.fill(0)
  })
})

describe('RVCM1094F finding 3: recovery settles every interrupted write', () => {
  const kinds = ['modelApi', 'provider', 'account'] as const
  it.each(kinds)(
    'a kill at every first-store await settles to deleted or retired (%s)',
    async (kind) => {
      // A born-in-vault slot: no legacy copy, no previous value. A kill
      // before the vault write commits leaves nothing durable, so recovery
      // records `deleted`; a kill after it completes the store to `retired`.
      const credential = credentialFor(kind)
      const next = await legacyBytesFor(kind, secretFor(kind, 'first'))
      const kills: { port: CrashPort; call: number }[] = [
        { port: 'journal.read', call: 1 },
        { port: 'vault.list', call: 1 },
        { port: 'vault.list', call: 2 },
        { port: 'legacy.read', call: 1 },
        { port: 'journal.write', call: 1 },
        { port: 'vault.write', call: 1 },
        { port: 'vault.read', call: 1 },
        { port: 'journal.write', call: 2 },
      ]
      for (const kill of kills) {
        const f = crashFixture(credential)
        f.arm(kill.port, kill.call)
        await expect(
          f.service.store(credential.key, next),
          `${kind}/${kill.port}#${String(kill.call)}`,
        ).rejects.toMatchObject({ code: 'storage' })
        await f.service.resume(credential.key)
        const row = f.journal.get(credential.key)
        const label = `${kind}/${kill.port}#${String(kill.call)}`
        if (kill.port === 'vault.read' || (kill.port === 'journal.write' && kill.call === 2)) {
          // The vault write committed: recovery completes the store.
          expect(row?.phase, label).toBe('retired')
          expectBytes(await vaultValue(f, credential), next, `${label}/vault`)
        } else if (kill.port === 'vault.write') {
          // The intent committed but the first vault write did not, and no
          // copy exists anywhere: recovery records the abandoned store.
          expect(row?.phase, label).toBe('deleted')
          expect(row?.digest, label).toBeNull()
          expect(await vaultValue(f, credential), `${label}/vault`).toBeNull()
        } else {
          // A kill before the intent committed: no row, nothing stored.
          expect(row, label).toBeUndefined()
          expect(await vaultValue(f, credential), `${label}/vault`).toBeNull()
        }
        expectRowsValid(f, credential)
      }
      next.fill(0)
    },
  )
  it.each(kinds)(
    'a kill at every first-store await with a legacy copy keeps the old value whole (%s)',
    async (kind) => {
      const credential = credentialFor(kind)
      const old = await legacyBytesFor(kind, secretFor(kind, 'old'))
      const next = await legacyBytesFor(kind, secretFor(kind, 'new'))
      const kills: { port: CrashPort; call: number }[] = [
        { port: 'journal.read', call: 1 },
        { port: 'vault.list', call: 1 },
        { port: 'vault.list', call: 2 },
        { port: 'legacy.read', call: 1 },
        { port: 'journal.write', call: 1 },
        { port: 'vault.write', call: 1 },
        { port: 'vault.read', call: 1 },
        { port: 'vault.read', call: 2 },
        { port: 'legacy.write', call: 1 },
        { port: 'legacy.read', call: 2 },
        { port: 'journal.write', call: 2 },
      ]
      for (const kill of kills) {
        const f = crashFixture(credential)
        f.legacy.set(credential.key, Uint8Array.from(old))
        f.arm(kill.port, kill.call)
        await expect(
          f.service.store(credential.key, next),
          `${kind}/${kill.port}#${String(kill.call)}`,
        ).rejects.toMatchObject({ code: 'storage' })
        await f.service.resume(credential.key)
        const row = f.journal.get(credential.key)
        const label = `${kind}/${kill.port}#${String(kill.call)}`
        if (
          (kill.port === 'journal.read' && kill.call === 1) ||
          (kill.port === 'vault.list' && (kill.call === 1 || kill.call === 2)) ||
          (kill.port === 'legacy.read' && kill.call === 1) ||
          (kill.port === 'journal.write' && kill.call === 1)
        ) {
          // The intent never committed: the legacy copy is untouched.
          expect(row, label).toBeUndefined()
          expect(await vaultValue(f, credential), `${label}/vault`).toBeNull()
          expectLegacy(f, credential, old, `${label}/legacy`)
        } else if (kill.port === 'vault.write' && kill.call === 1) {
          // The vault write never committed and the new material died with
          // the call: recovery migrates the surviving legacy copy, so the
          // old value stays whole with an `active` record.
          expect(row?.phase, label).toBe('active')
          expectBytes(await vaultValue(f, credential), old, `${label}/vault`)
          expectLegacy(f, credential, old, `${label}/legacy`)
        } else {
          // The vault write committed: recovery completes the store, and a
          // later `store` can rotate from the `active` record.
          expect(row?.phase, label).toBe('active')
          expectBytes(await vaultValue(f, credential), next, `${label}/vault`)
          expectLegacy(f, credential, next, `${label}/legacy`)
          // A later `store` can still rotate from the settled record.
          await f.service.store(credential.key, old)
          expect(f.journal.get(credential.key)?.phase, `${label}/rotate`).toBe('active')
          expectBytes(await vaultValue(f, credential), old, `${label}/rotated`)
        }
        expectRowsValid(f, credential)
      }
      old.fill(0)
      next.fill(0)
    },
  )
  it.each(kinds)('a kill at every rotation await keeps one whole value (%s)', async (kind) => {
    const credential = credentialFor(kind)
    const old = await legacyBytesFor(kind, secretFor(kind, 'old'))
    const next = await legacyBytesFor(kind, secretFor(kind, 'new'))
    const kills: { port: CrashPort; call: number }[] = [
      { port: 'journal.read', call: 1 },
      { port: 'journal.write', call: 1 },
      { port: 'vault.write', call: 1 },
      { port: 'vault.read', call: 1 },
      { port: 'vault.read', call: 2 },
      { port: 'legacy.write', call: 1 },
      { port: 'legacy.read', call: 1 },
      { port: 'journal.write', call: 2 },
    ]
    for (const kill of kills) {
      const f = crashFixture(credential)
      f.legacy.set(credential.key, Uint8Array.from(old))
      await f.service.migrate(credential.key)
      f.arm(kill.port, kill.call)
      await expect(
        f.service.store(credential.key, next),
        `${kind}/${kill.port}#${String(kill.call)}`,
      ).rejects.toMatchObject({ code: 'storage' })
      await f.service.resume(credential.key)
      const row = f.journal.get(credential.key)
      const label = `${kind}/${kill.port}#${String(kill.call)}`
      expect(row?.phase, label).toBe('active')
      if (
        (kill.port === 'journal.read' && kill.call === 1) ||
        (kill.port === 'journal.write' && kill.call === 1) ||
        (kill.port === 'vault.write' && kill.call === 1)
      ) {
        // A kill before the rotation write commits leaves the old binding
        // untouched: recovery keeps the intent row or restores the previous
        // usable row.
        expectBytes(await vaultValue(f, credential), old, `${label}/vault`)
        expectLegacy(f, credential, old, `${label}/legacy`)
      } else {
        // The rotation write committed: recovery completes it.
        expectBytes(await vaultValue(f, credential), next, `${label}/vault`)
        expectLegacy(f, credential, next, `${label}/legacy`)
      }
      expect(row?.previous, `${label}/previous`).toBeUndefined()
      expectRowsValid(f, credential)
    }
    old.fill(0)
    next.fill(0)
  })
  it.each(kinds)('a kill at every delete await destroys nothing unconfirmed (%s)', async (kind) => {
    const credential = credentialFor(kind)
    const old = await legacyBytesFor(kind, secretFor(kind, 'old'))
    const kills: { port: CrashPort; call: number }[] = [
      { port: 'journal.read', call: 1 },
      { port: 'journal.write', call: 1 },
      { port: 'legacy.read', call: 1 },
      { port: 'vault.remove', call: 1 },
      { port: 'legacy.remove', call: 1 },
      { port: 'legacy.read', call: 2 },
      { port: 'journal.write', call: 2 },
    ]
    for (const kill of kills) {
      const f = crashFixture(credential)
      f.legacy.set(credential.key, Uint8Array.from(old))
      await f.service.migrate(credential.key)
      f.arm(kill.port, kill.call)
      await expect(
        f.service.delete(credential.key),
        `${kind}/${kill.port}#${String(kill.call)}`,
      ).rejects.toMatchObject({ code: 'storage' })
      await f.service.resume(credential.key)
      const row = f.journal.get(credential.key)
      const label = `${kind}/${kill.port}#${String(kill.call)}`
      if (
        (kill.port === 'journal.read' && kill.call === 1) ||
        (kill.port === 'journal.write' && kill.call === 1) ||
        (kill.port === 'legacy.read' && kill.call === 1)
      ) {
        // A kill before the `deleting` row commits: both copies survive.
        expect(row?.phase, label).toBe('active')
        expectBytes(await vaultValue(f, credential), old, `${label}/vault`)
        expectLegacy(f, credential, old, `${label}/legacy`)
      } else {
        // The delete was confirmed when it started: recovery completes it.
        expect(row?.phase, label).toBe('deleted')
        expect(row?.previous, `${label}/previous`).toBeUndefined()
        expect(row?.digest, `${label}/digest`).toBeNull()
        expect(await vaultValue(f, credential), `${label}/vault`).toBeNull()
        expectLegacy(f, credential, null, `${label}/legacy`)
      }
      expectRowsValid(f, credential)
    }
    old.fill(0)
  })
  it.each(kinds)('a kill at every retire await keeps the intent honest (%s)', async (kind) => {
    const credential = credentialFor(kind)
    const old = await legacyBytesFor(kind, secretFor(kind, 'old'))
    const kills: { port: CrashPort; call: number }[] = [
      { port: 'journal.read', call: 1 },
      { port: 'legacy.read', call: 1 },
      { port: 'vault.read', call: 1 },
      { port: 'legacy.read', call: 2 },
      { port: 'journal.write', call: 1 },
      { port: 'legacy.read', call: 3 },
      { port: 'vault.read', call: 2 },
      { port: 'legacy.read', call: 4 },
      { port: 'legacy.remove', call: 1 },
      { port: 'legacy.read', call: 5 },
      { port: 'journal.write', call: 2 },
      { port: 'journal.write', call: 3 },
    ]
    for (const kill of kills) {
      const f = crashFixture(credential)
      f.legacy.set(credential.key, Uint8Array.from(old))
      await f.service.migrate(credential.key)
      f.advanceRelease()
      f.advanceRelease()
      f.arm(kill.port, kill.call)
      await expect(
        f.service.retire(credential.key),
        `${kind}/${kill.port}#${String(kill.call)}`,
      ).rejects.toMatchObject({ code: 'storage' })
      await f.service.resume(credential.key)
      const row = f.journal.get(credential.key)
      const label = `${kind}/${kill.port}#${String(kill.call)}`
      if (
        (kill.port === 'journal.read' && kill.call === 1) ||
        (kill.port === 'legacy.read' && (kill.call === 1 || kill.call === 2)) ||
        (kill.port === 'vault.read' && kill.call === 1) ||
        (kill.port === 'journal.write' && kill.call === 1)
      ) {
        // The intent never committed: the active binding is untouched.
        expect(row?.phase, label).toBe('active')
        expect(row?.retireIntent, `${label}/intent`).toBeUndefined()
        expectBytes(await vaultValue(f, credential), old, `${label}/vault`)
        expectLegacy(f, credential, old, `${label}/legacy`)
      } else {
        // The intent committed: recovery finishes the retire it started.
        expect(row?.phase, label).toBe('retired')
        expectBytes(await vaultValue(f, credential), old, `${label}/vault`)
        expectLegacy(f, credential, null, `${label}/legacy`)
      }
      expectRowsValid(f, credential)
    }
    old.fill(0)
  })
})
