import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { VaultMigration } from '../../../src/core/vault/migrate/migrate'
import { type MigrationDeps, VaultMigrationFault } from '../../../src/core/vault/migrate/ports'
import { generatedKey, migrationFixture } from './migrationFixture'
import { eraseItem } from '../../../src/core/vault/migrate/material'
import { type SecretStore } from '../../../src/host/auth/credentialStore'
import { saveProviderCredential } from '../../../src/host/providers/credentialRecords'
import { providerCredentialMigrationCredential } from '../../../src/core/vault/migrate/providerCredentials'

async function readyToRetire() {
  const f = migrationFixture()
  f.legacy.set(f.credential.key, generatedKey())
  await f.service.migrate(f.credential.key)
  f.advanceRelease()
  f.advanceRelease()
  return f
}

describe('D89.14 credential migration', () => {
  it('W-M1 resumes a rotation interrupted after journal commit but before vault write', async () => {
    const f = migrationFixture()
    const old = generatedKey()
    f.legacy.set(f.credential.key, old)
    await f.service.migrate(f.credential.key)
    vi.mocked(f.deps.vault.write).mockRejectedValueOnce(new Error('precommit interruption'))
    await expect(f.service.store(f.credential.key, generatedKey())).rejects.toMatchObject({
      code: 'storage',
    })
    const resumed = new VaultMigration(f.deps, [f.credential])
    await resumed.resume(f.credential.key)
    expect(await resumed.resolve(f.credential.key)).not.toBeNull()
    expect(f.journal.get(f.credential.key)?.phase).toBe('active')
    const item = await f.vault.read(f.credential.itemId)
    const value = f.credential.encode(item)
    expect([...value]).toEqual([...old])
    value.fill(0)
    eraseItem(item)
  })
  it('W-M4 retries a pending retirement notice after the delete committed', async () => {
    const f = await readyToRetire()
    vi.mocked(f.deps.onRetired).mockImplementationOnce(() => {
      throw new Error('notice unavailable')
    })
    await expect(f.service.retire(f.credential.key)).rejects.toMatchObject({ code: 'storage' })
    expect(f.legacy.has(f.credential.key)).toBe(false)
    const resumed = new VaultMigration(f.deps, [f.credential])
    expect(await resumed.retire(f.credential.key)).toBe(true)
    expect(f.deps.onRetired).toHaveBeenCalledTimes(2)
    expect(await resumed.retire(f.credential.key)).toBe(false)
  })
  it('W-M6 concurrent editors can both resume the same deleting journal row', async () => {
    const f = migrationFixture()
    await f.service.store(f.credential.key, generatedKey())
    vi.mocked(f.deps.vault.remove).mockRejectedValueOnce(new Error('interrupted delete'))
    // Born-in-vault rows are retired with no legacy copy, so the vault copy
    // is the only copy: deleting it needs the confirmed flag.
    await expect(
      f.service.delete(f.credential.key, { destroyLastCopyConfirmed: true }),
    ).rejects.toThrow()
    const second = new VaultMigration(f.deps, [f.credential])
    await Promise.all([f.service.resume(f.credential.key), second.resume(f.credential.key)])
    expect(f.journal.get(f.credential.key)?.phase).toBe('deleted')
    expect(await f.vault.list()).toEqual([])
  })

  it('never claims retirement or logout when the native legacy store did not delete its value', async () => {
    const f = await readyToRetire()
    const remove = f.deps.legacy.remove
    f.deps.legacy.remove = vi.fn(() => Promise.resolve())
    await expect(f.service.retire(f.credential.key)).rejects.toMatchObject({ code: 'verification' })
    expect(f.deps.onRetired).not.toHaveBeenCalled()
    expect(f.journal.get(f.credential.key)?.phase).toBe('active')
    await expect(f.service.delete(f.credential.key)).rejects.toMatchObject({ code: 'verification' })
    expect(f.journal.get(f.credential.key)?.phase).toBe('deleting')
    f.deps.legacy.remove = remove
    await f.service.resume(f.credential.key)
    expect(f.legacy.has(f.credential.key)).toBe(false)
    expect(f.journal.get(f.credential.key)?.phase).toBe('deleted')
  })
  it('rejects a corrupted mirror before publishing success and rejects value-shaped journal fields', async () => {
    const f = migrationFixture()
    f.legacy.set(f.credential.key, generatedKey())
    await f.service.migrate(f.credential.key)
    f.deps.legacy.write = vi.fn<MigrationDeps['legacy']['write']>((key, _value, authorize) => {
      authorize()
      f.legacy.set(key, generatedKey())
      return Promise.resolve()
    })
    await expect(f.service.store(f.credential.key, generatedKey())).rejects.toMatchObject({
      code: 'verification',
    })
    expect(f.journal.get(f.credential.key)?.phase).toBe('writing')
    const other = migrationFixture()
    await other.service.store(other.credential.key, generatedKey())
    other.deps.journal.read = () =>
      Promise.resolve({
        ...other.journal.get(other.credential.key),
        value: generatedKey().toString(),
      })
    await expect(other.service.resolve(other.credential.key)).rejects.toMatchObject({
      code: 'storage',
    })
  })
  it('refuses activation if the source changes during copy and retains a legacy entry on an early rotation', async () => {
    const f = migrationFixture()
    f.legacy.set(f.credential.key, generatedKey())
    const changed = generatedKey()
    const write = f.deps.vault.write
    f.deps.vault.write = vi.fn<MigrationDeps['vault']['write']>(async (item, authorize) => {
      await write(item, authorize)
      f.legacy.set(f.credential.key, changed)
    })
    await expect(f.service.migrate(f.credential.key)).rejects.toMatchObject({ code: 'conflict' })
    expect(f.journal.get(f.credential.key)?.phase).toBe('copying')
    expect(f.legacy.get(f.credential.key)).toEqual(changed)
    const early = migrationFixture()
    early.legacy.set(early.credential.key, generatedKey())
    await early.service.store(early.credential.key, changed)
    expect([...early.legacy.get(early.credential.key)!]).toEqual([...changed])
    expect(early.journal.get(early.credential.key)?.retainLegacy).toBe(true)
  })
  it('checks generation at physical commit and serializes competing rotations', async () => {
    const f = migrationFixture()
    const write = f.deps.vault.write
    f.deps.vault.write = vi.fn<MigrationDeps['vault']['write']>(async (item, authorize) => {
      await Promise.resolve()
      f.invalidate()
      authorize()
      await f.vault.write(item)
    })
    await expect(f.service.store(f.credential.key, generatedKey())).rejects.toMatchObject({
      code: 'storage',
    })
    expect(await f.vault.list()).toEqual([])
    f.deps.vault.write = write
    const first = generatedKey()
    const second = generatedKey()
    await Promise.all([
      f.service.store(f.credential.key, first),
      f.service.store(f.credential.key, second),
    ])
    const item = await f.vault.read(f.credential.itemId)
    const final = f.credential.encode(item)
    expect([...final]).toEqual([...second])
    final.fill(0)
    eraseItem(item)
  })
  it('refuses a codec that exposes a migrated record to agents or binds a different item', async () => {
    const f = migrationFixture()
    const publicCodec = {
      ...f.credential,
      decode(value: Uint8Array) {
        const item = f.credential.decode(value)
        item.metadata.firstParty = false
        item.metadata.hidden = false
        item.metadata.policy.mode = 'askEveryTime'
        return item
      },
    }
    const service = new VaultMigration(f.deps, [publicCodec])
    await expect(service.store(f.credential.key, generatedKey())).rejects.toMatchObject({
      code: 'invalid',
    })
    expect(f.deps.vault.write).not.toHaveBeenCalled()
    expect(
      () => new VaultMigration(f.deps, [{ ...f.credential, itemId: 'a'.repeat(32) }]),
    ).toThrow()
  })
  it('copies, decrypts back with equal SHA-256, keeps a downgrade-readable entry and hides the item', async () => {
    const f = migrationFixture()
    const key = generatedKey()
    f.legacy.set(f.credential.key, key)
    expect(await f.service.migrate(f.credential.key)).toBe('active')
    const item = await f.vault.read(f.credential.itemId)
    try {
      expect(item.metadata).toMatchObject({
        firstParty: true,
        hidden: true,
        policy: { mode: 'never' },
        bindings: [{ origin: 'https://api.meta.ai' }],
      })
      const copied = f.credential.encode(item)
      expect(createHash('sha256').update(copied).digest('hex')).toBe(
        createHash('sha256').update(key).digest('hex'),
      )
      copied.fill(0)
      expect(f.legacy.get(f.credential.key)).toEqual(key)
      expect(f.deps.legacy.remove).not.toHaveBeenCalled()
      expect(await f.service.resolve(f.credential.key)).toEqual(f.credential.request)
      expect(JSON.stringify([...f.journal])).not.toContain(key.toString())
      expect(f.owned.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true)
    } finally {
      eraseItem(item)
      key.fill(0)
    }
  })
  it('never activates or deletes a source when decrypted verification fails', async () => {
    const f = migrationFixture()
    const key = generatedKey()
    f.legacy.set(f.credential.key, key)
    f.deps.vault.write = vi.fn<MigrationDeps['vault']['write']>(async (item, authorize) => {
      authorize()
      const corrupted = structuredClone(item)
      if (corrupted.material.kind === 'apiKey')
        corrupted.material.value[0] = corrupted.material.value[0]! ^ 1
      await f.vault.write(corrupted)
      eraseItem(corrupted)
    })
    await expect(f.service.migrate(f.credential.key)).rejects.toMatchObject({
      code: 'verification',
    })
    expect(f.journal.get(f.credential.key)?.phase).toBe('copying')
    f.advanceRelease()
    f.advanceRelease()
    expect(await f.service.retire(f.credential.key)).toBe(false)
    expect(f.deps.legacy.remove).not.toHaveBeenCalled()
    expect(f.legacy.get(f.credential.key)).toEqual(key)
  })
  it('mirrors every rotation and undo restores the latest value for the previous release', async () => {
    const f = migrationFixture()
    f.legacy.set(f.credential.key, generatedKey())
    await f.service.migrate(f.credential.key)
    const rotated = generatedKey()
    await f.service.store(f.credential.key, rotated)
    expect([...f.legacy.get(f.credential.key)!]).toEqual([...rotated])
    await f.service.undo(f.credential.key)
    expect(await f.service.resolve(f.credential.key)).toBeNull()
    expect(f.journal.get(f.credential.key)?.phase).toBe('undone')
    expect([...f.legacy.get(f.credential.key)!]).toEqual([...rotated])
    expect(await f.service.retire(f.credential.key)).toBe(false)
    await f.service.migrate(f.credential.key)
    expect(await f.service.resolve(f.credential.key)).toEqual(f.credential.request)
  })
  it('retains for two minor releases, then verifies and deletes with one value-free notice', async () => {
    const f = migrationFixture()
    f.legacy.set(f.credential.key, generatedKey())
    await f.service.migrate(f.credential.key)
    expect(await f.service.retire(f.credential.key)).toBe(false)
    f.advanceRelease()
    expect(await f.service.retire(f.credential.key)).toBe(false)
    f.advanceRelease()
    await expect(f.service.undo(f.credential.key)).rejects.toMatchObject({ code: 'window' })
    expect(await f.service.retire(f.credential.key)).toBe(true)
    expect(f.legacy.has(f.credential.key)).toBe(false)
    expect(f.deps.onRetired).toHaveBeenCalledExactlyOnceWith(f.credential.key)
    expect(await f.service.retire(f.credential.key)).toBe(false)
    await f.service.store(f.credential.key, generatedKey())
    expect(f.legacy.has(f.credential.key)).toBe(false)
  })
  it('does not delete a key changed by a downgrade or retire tampered vault bytes', async () => {
    const f = await readyToRetire()
    const changed = generatedKey()
    f.legacy.set(f.credential.key, changed)
    await expect(f.service.retire(f.credential.key)).rejects.toMatchObject({ code: 'conflict' })
    expect(f.legacy.get(f.credential.key)).toEqual(changed)
    await f.service.store(f.credential.key, changed)
    const item = await f.vault.read(f.credential.itemId)
    if (item.material.kind === 'apiKey') item.material.value[0] = item.material.value[0]! ^ 1
    await f.vault.write(item)
    eraseItem(item)
    await expect(f.service.retire(f.credential.key)).rejects.toMatchObject({ code: 'verification' })
    expect(f.deps.legacy.remove).not.toHaveBeenCalled()
  })
  it('recovers a failed mirror after restart and blocks the incomplete binding', async () => {
    const f = migrationFixture()
    f.legacy.set(f.credential.key, generatedKey())
    await f.service.migrate(f.credential.key)
    const write = f.deps.legacy.write
    f.deps.legacy.write = vi.fn(() => Promise.reject(new Error(generatedKey().toString())))
    const rotated = generatedKey()
    await expect(f.service.store(f.credential.key, rotated)).rejects.toMatchObject({
      code: 'storage',
      message: 'No access',
    })
    await expect(f.service.resolve(f.credential.key)).rejects.toMatchObject({ code: 'conflict' })
    f.deps.legacy.write = write
    const restarted = new VaultMigration(f.deps, [f.credential])
    await restarted.resume(f.credential.key)
    expect([...f.legacy.get(f.credential.key)!]).toEqual([...rotated])
    expect(await restarted.resolve(f.credential.key)).toEqual(f.credential.request)
    expect(f.owned.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true)
  })
  it('resumes an interrupted verified copy without deleting the retained entry', async () => {
    const f = migrationFixture()
    f.legacy.set(f.credential.key, generatedKey())
    const save = f.deps.journal.write
    f.deps.journal.write = vi.fn<MigrationDeps['journal']['write']>((row, authorize) =>
      row.phase === 'active'
        ? Promise.reject(new Error('test journal failure'))
        : save(row, authorize),
    )
    await expect(f.service.migrate(f.credential.key)).rejects.toBeInstanceOf(VaultMigrationFault)
    f.deps.journal.write = save
    await new VaultMigration(f.deps, [f.credential]).resume(f.credential.key)
    expect(f.journal.get(f.credential.key)?.phase).toBe('active')
    expect(f.legacy.has(f.credential.key)).toBe(true)
  })
  it('finishes a pending retire intent at open instead of leaving it lying', async () => {
    // RVCM1094E finding 1: a crash between the retire intent write and the
    // legacy delete leaves `active` with the intent and the copy present. A
    // later deletion behind the vault would then read as the engine's own
    // retire, so the vault finishes every pending intent at the next open,
    // before any other migration call: the copy still present is deleted by
    // the engine itself and the slot is recorded `retired`.
    const f = await readyToRetire()
    const remove = f.deps.legacy.remove
    f.deps.legacy.remove = vi.fn(() => Promise.reject(new Error('crash before the legacy delete')))
    await expect(f.service.retire(f.credential.key)).rejects.toMatchObject({ code: 'storage' })
    f.deps.legacy.remove = remove
    expect(f.journal.get(f.credential.key)?.retireIntent).toBe(true)
    expect(f.legacy.has(f.credential.key)).toBe(true)
    const opened = new VaultMigration(f.deps, [f.credential])
    expect(await opened.finishPendingRetires()).toEqual({ [f.credential.key]: 'retired' })
    expect(f.journal.get(f.credential.key)?.phase).toBe('retired')
    expect(f.journal.get(f.credential.key)?.retireIntent).toBeUndefined()
    expect(f.legacy.has(f.credential.key)).toBe(false)
    expect(f.deps.onRetired).toHaveBeenCalledExactlyOnceWith(f.credential.key)
    // No intent survives the open: a second call finds nothing pending.
    expect(await opened.finishPendingRetires()).toEqual({})
    expect(await opened.migrate(f.credential.key)).toBe('retired')
  })
  it('notes a pending retire intent resumed with the legacy copy already absent', async () => {
    // RVCM1094E finding 1: the intent cannot tell whose delete removed the
    // copy, so when the open finds it already absent the engine still
    // finishes to `retired` — but the journal row says the engine did not
    // see the delete, instead of reading as a watched retire.
    const f = await readyToRetire()
    const remove = f.deps.legacy.remove
    f.deps.legacy.remove = vi.fn(() => Promise.reject(new Error('crash before the legacy delete')))
    await expect(f.service.retire(f.credential.key)).rejects.toMatchObject({ code: 'storage' })
    f.deps.legacy.remove = remove
    f.legacy.delete(f.credential.key)
    const opened = new VaultMigration(f.deps, [f.credential])
    expect(await opened.finishPendingRetires()).toEqual({ [f.credential.key]: 'retired' })
    expect(f.journal.get(f.credential.key)?.phase).toBe('retired')
    expect(typeof f.journal.get(f.credential.key)?.retireNote).toBe('string')
    expect(f.deps.onRetired).toHaveBeenCalledExactlyOnceWith(f.credential.key)
  })
  it('reports a changed legacy copy at open and still finishes the other rows', async () => {
    // RVCM1094E finding 1: `finishPendingRetires` must not throw for a row
    // whose legacy copy changed after the intent — it reports that row's
    // state and goes on to the others. The engine deletes nobody else's
    // bytes: the stale intent is cleared so the change reads honestly.
    const f = migrationFixture()
    const second = providerCredentialMigrationCredential('openai', () => 1000)
    const both = new VaultMigration(f.deps, [f.credential, second])
    f.legacy.set(f.credential.key, generatedKey())
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
    const record = {
      v: 1,
      auth: 'apiKey',
      origin: 'https://api.openai.com',
      secret: 'synthetic-open-key',
    } as const
    await saveProviderCredential(secrets, 'openai', record)
    f.legacy.set(second.key, Buffer.from(entries.get(second.key)!, 'utf8'))
    expect(await both.migrate(f.credential.key)).toBe('active')
    expect(await both.migrate(second.key)).toBe('active')
    f.advanceRelease()
    f.advanceRelease()
    const remove = f.deps.legacy.remove
    f.deps.legacy.remove = vi.fn(() => Promise.reject(new Error('crash before the legacy delete')))
    await expect(both.retire(f.credential.key)).rejects.toMatchObject({ code: 'storage' })
    await expect(both.retire(second.key)).rejects.toMatchObject({ code: 'storage' })
    f.deps.legacy.remove = remove
    // Behind the vault, the provider slot's legacy copy is overwritten.
    await saveProviderCredential(secrets, 'openai', { ...record, secret: 'synthetic-changed-key' })
    const changed = Buffer.from(entries.get(second.key)!, 'utf8')
    f.legacy.set(second.key, changed)
    const opened = new VaultMigration(f.deps, [f.credential, second])
    expect(await opened.finishPendingRetires()).toEqual({
      [f.credential.key]: 'retired',
      [second.key]: 'diverged',
    })
    // The changed copy is left alone and the stale intent is gone, so the
    // change reads honestly; the other row still finished.
    expect(f.legacy.get(second.key)).toEqual(changed)
    expect(f.journal.get(second.key)?.phase).toBe('active')
    expect(f.journal.get(second.key)?.retireIntent).toBeUndefined()
    expect(f.journal.get(f.credential.key)?.phase).toBe('retired')
    expect(f.legacy.has(f.credential.key)).toBe(false)
    expect(f.deps.onRetired).toHaveBeenCalledExactlyOnceWith(f.credential.key)
    expect(await opened.migrate(second.key)).toBe('diverged')
  })
  it('keeps the two last-copy confirmations apart', async () => {
    // RVCM1094E finding 1: `destroyLastCopyConfirmed` is the ordinary delete
    // (a plain sign-out may pass it) and never answers `legacyDeleted`; the
    // `legacyDeleted` answer carries its own option after asking the person.
    // A `retired` slot takes only the ordinary one.
    const f = await readyToRetire()
    expect(await f.service.retire(f.credential.key)).toBe(true)
    await expect(
      f.service.delete(f.credential.key, { legacyDeletionConfirmed: true }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(f.journal.get(f.credential.key)?.phase).toBe('retired')
    await f.service.delete(f.credential.key, { destroyLastCopyConfirmed: true })
    expect(f.journal.get(f.credential.key)?.phase).toBe('deleted')
  })
  it('born-in-vault credentials never get a downgrade copy; logout removes both stores', async () => {
    const f = migrationFixture()
    expect(await f.service.migrate(f.credential.key)).toBe('missing')
    await f.service.store(f.credential.key, generatedKey())
    expect(f.legacy.size).toBe(0)
    expect(f.deps.legacy.write).not.toHaveBeenCalled()
    await f.service.delete(f.credential.key, { destroyLastCopyConfirmed: true })
    expect(await f.service.resolve(f.credential.key)).toBeNull()
    expect(await f.vault.list()).toEqual([])
  })
  it('copies queued input before awaiting the serialized owner and wipes stale returned plaintext', async () => {
    const f = migrationFixture()
    const input = generatedKey()
    const expected = Uint8Array.from(input)
    const storing = f.service.store(f.credential.key, input)
    input.fill(0)
    await storing
    const stored = await f.vault.read(f.credential.itemId)
    const output = f.credential.encode(stored)
    expect(output).toEqual(Buffer.from(expected))
    output.fill(0)
    eraseItem(stored)
    const read = f.deps.vault.read
    f.deps.vault.read = vi.fn<MigrationDeps['vault']['read']>(async (id) => {
      const item = await read(id)
      f.invalidate()
      return item
    })
    await expect(f.service.migrate(f.credential.key)).rejects.toMatchObject({ code: 'storage' })
    expect(f.owned.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true)
  })
  it('rejects collision, public items, duplicate mappings, malformed journals and unknown keys', async () => {
    const f = migrationFixture()
    const item = f.credential.decode(generatedKey())
    await f.vault.write(item)
    eraseItem(item)
    f.legacy.set(f.credential.key, generatedKey())
    await expect(f.service.migrate(f.credential.key)).rejects.toMatchObject({ code: 'conflict' })
    expect(() => new VaultMigration(f.deps, [f.credential, f.credential])).toThrow(
      VaultMigrationFault,
    )
    await expect(f.service.migrate('another-app')).rejects.toMatchObject({ code: 'invalid' })
    f.deps.journal.read = () => Promise.resolve({ value: generatedKey().toString() })
    await expect(f.service.resolve(f.credential.key)).rejects.toMatchObject({
      code: 'storage',
      message: 'No access',
    })
  })
})
