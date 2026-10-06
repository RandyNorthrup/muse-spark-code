import { describe, expect, it } from 'vitest'
import {
  createEncryptedBackup,
  encryptedBackupSlot,
  restoreEncryptedBackup,
} from '../../../src/core/vault/backup'
import { createRecoverySlot, unlockRecoverySlot } from '../../../src/core/vault/keyslots'
import { randomVaultBytes } from '../../../src/core/vault/crypto'
import { VaultStore } from '../../../src/core/vault/store'
import { FakeVaultClock } from '../helpers/vault/core'
import { item } from '../helpers/vault/fixtures'
import { freshVault, jsonRecord, MemoryVaultAnchor, MemoryVaultFiles } from './storeFixtures'

const backupLimit = 16 * 1024 * 1024
describe('encrypted vault backup', () => {
  it('authenticates chunk order, count and total length for backups larger than one frame', async () => {
    const vault = await freshVault()
    for (const index of [1, 2, 3]) {
      const secret = item()
      secret.metadata.id = randomVaultBytes(16).toString('hex')
      secret.metadata.name = `large-${index.toString()}`
      secret.metadata.handle = `secret://${secret.metadata.name}`
      secret.material = { kind: 'secret', value: randomVaultBytes(1024 * 1024) }
      await vault.store.write(secret)
    }
    const bytes = await createEncryptedBackup(vault.store, vault.key, vault.recovery.slot)
    const backup = jsonRecord(bytes)
    const blocks = backup['blocks']
    if (!Array.isArray(blocks) || blocks.length < 2) throw new Error('chunked backup')
    const options = {
      files: new MemoryVaultFiles(),
      anchor: new MemoryVaultAnchor(),
      key: vault.key,
    }
    const restored = await restoreEncryptedBackup(options, bytes, backupLimit)
    const restoredItems = await restored.list()
    expect(restoredItems.length).toBe(3)
    for (const changed of [
      { ...backup, blocks: blocks.toReversed() },
      { ...backup, blocks: blocks.slice(1) },
      { ...backup, length: 1 },
    ])
      await expect(
        restoreEncryptedBackup(options, Buffer.from(JSON.stringify(changed)), backupLimit),
      ).rejects.toThrow()
  })
  it('restores on a new device through a recovery slot, retaining only ciphertext and increasing generation', async () => {
    const vault = await freshVault()
    const secret = item()
    await vault.store.write(secret)
    const portable = createRecoverySlot(vault.key, vault.vaultId, new FakeVaultClock())
    const expectedKey = Buffer.from(vault.key)
    const backup = await createEncryptedBackup(vault.store, vault.key, portable.slot)
    expect(vault.key).toEqual(expectedKey)
    expect(backup.includes(secret.metadata.name)).toBe(false)
    expect(backup.includes(secret.metadata.label)).toBe(false)
    expect(backup.includes(vault.key)).toBe(false)
    const hint = encryptedBackupSlot(backup, backupLimit)
    const key = unlockRecoverySlot(hint, portable.code)
    const options = { files: new MemoryVaultFiles(), anchor: new MemoryVaultAnchor(), key }
    const restored = await restoreEncryptedBackup(options, backup, backupLimit)
    expect(await restored.read(secret.metadata.id)).toEqual(secret)
    const snapshot = await restored.exportSnapshot()
    expect(snapshot.document.generation).toBe(3)
    expect(snapshot.slots.records.map((slot) => slot.id)).toEqual([portable.slot.id])
    restored.lock()
    const reopened = await VaultStore.open(options, vault.vaultId)
    expect(await reopened.list()).toEqual([secret.metadata])
  })
  it('refuses an older backup on the original device, restores current backups, and detects payload/slot mutations', async () => {
    const vault = await freshVault()
    const backup = await createEncryptedBackup(vault.store, vault.key, vault.recovery.slot)
    await vault.store.write(item())
    await expect(restoreEncryptedBackup(vault.options, backup, backupLimit)).rejects.toMatchObject({
      code: 'rollback',
    })
    const emptyDestination = new MemoryVaultFiles()
    await expect(
      restoreEncryptedBackup({ ...vault.options, files: emptyDestination }, backup, backupLimit),
    ).rejects.toMatchObject({ code: 'rollback' })
    expect(emptyDestination.data.size).toBe(0)
    const current = await createEncryptedBackup(vault.store, vault.key, vault.recovery.slot)
    const restored = await restoreEncryptedBackup(vault.options, current, backupLimit)
    const restoredSnapshot = await restored.exportSnapshot()
    expect(restoredSnapshot.document.generation).toBe(3)
    const tampered = jsonRecord(current)
    const slot = tampered['slot']
    if (slot === null || typeof slot !== 'object') throw new Error('slot')
    Reflect.set(slot, 'createdAt', 2)
    await expect(
      restoreEncryptedBackup(vault.options, Buffer.from(JSON.stringify(tampered)), backupLimit),
    ).rejects.toThrow()
    await expect(
      restoreEncryptedBackup({ ...vault.options, key: randomVaultBytes() }, current, backupLimit),
    ).rejects.toThrow()
    await expect(
      createEncryptedBackup(vault.store, randomVaultBytes(), vault.recovery.slot),
    ).rejects.toThrow()
  })
  it('refuses nonportable slots, foreign vaults, invalid envelopes and size abuse', async () => {
    const vault = await freshVault()
    const foreign = createRecoverySlot(vault.key, 'b'.repeat(32), new FakeVaultClock())
    await expect(createEncryptedBackup(vault.store, vault.key, foreign.slot)).rejects.toThrow()
    const platform = { ...vault.recovery.slot, tier: 'osStore', provider: 'loginKeychain' } as const
    await expect(createEncryptedBackup(vault.store, vault.key, platform)).rejects.toThrow()
    for (const bytes of [Buffer.from('{'), Buffer.from('{}'), Buffer.alloc(100)])
      expect(() => encryptedBackupSlot(bytes, 2)).toThrow()
    const backup = await createEncryptedBackup(vault.store, vault.key, vault.recovery.slot)
    expect(() => encryptedBackupSlot(backup, 0)).toThrow()
    expect(() => encryptedBackupSlot(backup, 1)).toThrow()
  })
  it('authenticates every item and destination identity before restore changes any file or anchor', async () => {
    const vault = await freshVault()
    await vault.store.write(item())
    const snapshot = await vault.store.exportSnapshot()
    const block = snapshot.document.items[0]?.block
    if (!block) throw new Error('block')
    block.ciphertext = randomVaultBytes().toString('base64')
    const files = new MemoryVaultFiles()
    const anchor = new MemoryVaultAnchor()
    await expect(VaultStore.restore({ files, anchor, key: vault.key }, snapshot)).rejects.toThrow()
    expect(files.data.size).toBe(0)
    expect(anchor.states.size).toBe(0)
    const other = await freshVault()
    const current = await vault.store.exportSnapshot()
    await expect(VaultStore.restore(other.options, current)).rejects.toThrow()
    const otherSnapshot = await other.store.exportSnapshot()
    expect(otherSnapshot.document.generation).toBe(1)
    await expect(VaultStore.restore(vault.options, {})).rejects.toThrow()
  })
  it('refuses unmatched authenticated generations and backs up only fully authenticated items', async () => {
    const files = new MemoryVaultFiles()
    const vault = await freshVault(files)
    const old = await vault.store.exportSnapshot()
    await vault.store.write(item())
    const current = await vault.store.exportSnapshot()
    const destination = {
      files: new MemoryVaultFiles(),
      anchor: new MemoryVaultAnchor(),
      key: vault.key,
    }
    await expect(
      VaultStore.restore(destination, { document: current.document, slots: old.slots }),
    ).rejects.toMatchObject({ code: 'rollback' })
    const block = current.document.items[0]?.block
    if (!block) throw new Error('block')
    block.tag = randomVaultBytes(16).toString('base64')
    files.data.set('vault.v1', Buffer.from(JSON.stringify(current.document)))
    await expect(
      createEncryptedBackup(vault.store, vault.key, vault.recovery.slot),
    ).rejects.toThrow()
  })
})
