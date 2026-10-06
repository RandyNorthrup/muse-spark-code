import { afterEach, describe, expect, it, vi } from 'vitest'
import * as vaultCrypto from '../../../src/core/vault/crypto'
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
afterEach(() => vi.restoreAllMocks())

describe('encrypted vault backup', () => {
  it('refuses unconfirmed restores before decrypting, changing files or advancing the anchor', async () => {
    const vault = await freshVault()
    const backup = await createEncryptedBackup(vault.store, vault.key, vault.recovery.slot)
    const files = new MemoryVaultFiles()
    const anchor = new MemoryVaultAnchor()
    const options = { files, anchor, key: vault.key }
    const snapshot = await vault.store.exportSnapshot()
    const decrypt = vi.spyOn(vaultCrypto, 'openVaultBlock')
    await expect(restoreEncryptedBackup(options, backup, backupLimit)).rejects.toMatchObject({
      code: 'invalid',
    })
    await expect(VaultStore.restore(options, snapshot)).rejects.toMatchObject({ code: 'invalid' })
    expect(files.data.size).toBe(0)
    expect(anchor.states.size).toBe(0)
    expect(decrypt).not.toHaveBeenCalled()
  })
  it('refuses same-generation restored forks even when all authenticated files are copied', async () => {
    const original = await freshVault()
    const secret = item()
    await original.store.write(secret)
    const backup = await createEncryptedBackup(original.store, original.key, original.recovery.slot)
    const targetFiles = new MemoryVaultFiles()
    const donorFiles = new MemoryVaultFiles()
    const targetOptions = { files: targetFiles, anchor: new MemoryVaultAnchor(), key: original.key }
    const donorOptions = { files: donorFiles, anchor: new MemoryVaultAnchor(), key: original.key }
    const target = await restoreEncryptedBackup(targetOptions, backup, backupLimit, true)
    const donor = await restoreEncryptedBackup(donorOptions, backup, backupLimit, true)
    const revoked = item()
    revoked.metadata.policy.mode = 'never'
    const allowed = item()
    allowed.metadata.policy.mode = 'alwaysAllow'
    await target.write(revoked)
    await donor.write(allowed)
    const current = await target.exportSnapshot()
    const fork = await donor.exportSnapshot()
    expect(fork.document.generation).toBe(current.document.generation)
    targetFiles.data.set('vault.v1', Buffer.from(JSON.stringify(fork.document)))
    await expect(target.read(secret.metadata.id)).rejects.toThrow()
    targetFiles.data.set('slots.v1', Buffer.from(JSON.stringify(fork.slots)))
    await expect(VaultStore.open(targetOptions, original.vaultId)).rejects.toMatchObject({
      code: 'rollback',
    })
    targetFiles.data.set('vault.v1', Buffer.from(JSON.stringify(current.document)))
    targetFiles.data.set('slots.v1', Buffer.from(JSON.stringify(current.slots)))
    await expect(VaultStore.restore(targetOptions, fork, undefined, true)).rejects.toMatchObject({
      code: 'rollback',
    })
    expect(await target.read(secret.metadata.id)).toEqual(revoked)
    await target.remove(secret.metadata.id)
    await donor.write(allowed)
    await donor.write(allowed)
    const newer = await createEncryptedBackup(donor, original.key, original.recovery.slot)
    const before = new Map(targetFiles.data)
    const anchored = await targetOptions.anchor.minimum(original.vaultId)
    await expect(
      restoreEncryptedBackup(targetOptions, newer, backupLimit, true),
    ).rejects.toMatchObject({ code: 'rollback' })
    expect(targetFiles.data).toEqual(before)
    expect(await targetOptions.anchor.minimum(original.vaultId)).toEqual(anchored)
    expect(await target.list()).toEqual([])
  })
  it('refuses newer fork backups after policy revocation or removal, even with confirmation', async () => {
    const ownedFiles = new MemoryVaultFiles()
    const vault = await freshVault(ownedFiles)
    const secret = item()
    secret.metadata.policy.mode = 'alwaysAllow'
    await vault.store.write(secret)
    const initial = await createEncryptedBackup(vault.store, vault.key, vault.recovery.slot)
    const donor = await restoreEncryptedBackup(
      { files: new MemoryVaultFiles(), anchor: new MemoryVaultAnchor(), key: vault.key },
      initial,
      backupLimit,
      true,
    )
    secret.metadata.policy.mode = 'never'
    await vault.store.write(secret)
    await donor.write(item())
    await donor.write(item())
    const newer = await createEncryptedBackup(donor, vault.key, vault.recovery.slot)
    for (const isRemoved of [false, true]) {
      if (isRemoved) await vault.store.remove(secret.metadata.id)
      const files = new Map(ownedFiles.data)
      const anchored = await vault.anchor.minimum(vault.vaultId)
      await expect(
        restoreEncryptedBackup(vault.options, newer, backupLimit, true),
      ).rejects.toMatchObject({ code: 'rollback' })
      expect(ownedFiles.data).toEqual(files)
      expect(await vault.anchor.minimum(vault.vaultId)).toEqual(anchored)
    }
    expect(await vault.store.list()).toEqual([])
  })
  it('publishes restored slots in their validated canonical order', async () => {
    const vault = await freshVault()
    const snapshot = await vault.store.exportSnapshot()
    const slot = structuredClone(vault.recovery.slot)
    for (const name of Object.keys(slot).toReversed()) {
      const value: unknown = Reflect.get(slot, name)
      Reflect.deleteProperty(slot, name)
      Reflect.set(slot, name, value)
    }
    const restored = await VaultStore.restore(vault.options, snapshot, [slot], true)
    expect(await restored.list()).toEqual([])
    const reopened = await VaultStore.open(vault.options, vault.vaultId)
    expect(await reopened.list()).toEqual([])
  })
  it('recovers confirmed restore jumps before anchor advancement by open or retry, without advancing twice', async () => {
    const vault = await freshVault()
    await vault.store.write(item())
    await vault.store.write(item())
    const backup = await createEncryptedBackup(vault.store, vault.key, vault.recovery.slot)
    for (const mode of ['open', 'retry', 'anchored'] as const) {
      const isRetry = mode === 'retry'
      const files = new MemoryVaultFiles()
      const anchor = new MemoryVaultAnchor()
      const options = { files, anchor, key: vault.key }
      if (mode === 'anchored') {
        const minimum = await vault.anchor.minimum(vault.vaultId)
        if (!minimum) throw new Error('anchor')
        anchor.states.set(vault.vaultId, minimum)
      }
      const before = await anchor.minimum(vault.vaultId)
      const advance = anchor.advance.bind(anchor)
      anchor.advance = () => Promise.reject(new Error('generated anchor failure'))
      await expect(restoreEncryptedBackup(options, backup, backupLimit, true)).rejects.toThrow()
      expect(files.data.has('pending.v1')).toBe(true)
      expect(await anchor.minimum(vault.vaultId)).toEqual(before)
      anchor.advance = advance
      const restored = isRetry
        ? await restoreEncryptedBackup(options, backup, backupLimit, true)
        : await VaultStore.open(options, vault.vaultId)
      expect(await restored.list()).toEqual([item().metadata])
      const committed = await anchor.minimum(vault.vaultId)
      expect(committed?.generation).toBe(4)
      const reopened = await VaultStore.open(options, vault.vaultId)
      expect(await reopened.list()).toEqual(await restored.list())
      expect(await anchor.minimum(vault.vaultId)).toEqual(committed)
      expect(files.data.has('pending.v1')).toBe(false)
    }
  })

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
    const restored = await restoreEncryptedBackup(options, bytes, backupLimit, true)
    const restoredItems = await restored.list()
    expect(restoredItems.length).toBe(3)
    for (const changed of [
      { ...backup, blocks: blocks.toReversed() },
      { ...backup, blocks: blocks.slice(1) },
      { ...backup, length: 1 },
    ])
      await expect(
        restoreEncryptedBackup(options, Buffer.from(JSON.stringify(changed)), backupLimit, true),
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
    const restored = await restoreEncryptedBackup(options, backup, backupLimit, true)
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
    await expect(
      restoreEncryptedBackup(vault.options, backup, backupLimit, true),
    ).rejects.toMatchObject({
      code: 'rollback',
    })
    const emptyDestination = new MemoryVaultFiles()
    await expect(
      restoreEncryptedBackup(
        { ...vault.options, files: emptyDestination },
        backup,
        backupLimit,
        true,
      ),
    ).rejects.toMatchObject({ code: 'rollback' })
    expect(emptyDestination.data.size).toBe(0)
    const current = await createEncryptedBackup(vault.store, vault.key, vault.recovery.slot)
    const restored = await restoreEncryptedBackup(vault.options, current, backupLimit, true)
    const restoredSnapshot = await restored.exportSnapshot()
    expect(restoredSnapshot.document.generation).toBe(3)
    const tampered = jsonRecord(current)
    const slot = tampered['slot']
    if (slot === null || typeof slot !== 'object') throw new Error('slot')
    Reflect.set(slot, 'createdAt', 2)
    await expect(
      restoreEncryptedBackup(
        vault.options,
        Buffer.from(JSON.stringify(tampered)),
        backupLimit,
        true,
      ),
    ).rejects.toThrow()
    await expect(
      restoreEncryptedBackup(
        { ...vault.options, key: randomVaultBytes() },
        current,
        backupLimit,
        true,
      ),
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
    await expect(
      VaultStore.restore({ files, anchor, key: vault.key }, snapshot, undefined, true),
    ).rejects.toThrow()
    expect(files.data.size).toBe(0)
    expect(anchor.states.size).toBe(0)
    const other = await freshVault()
    const current = await vault.store.exportSnapshot()
    await expect(VaultStore.restore(other.options, current, undefined, true)).rejects.toThrow()
    const otherSnapshot = await other.store.exportSnapshot()
    expect(otherSnapshot.document.generation).toBe(1)
    await expect(VaultStore.restore(vault.options, {}, undefined, true)).rejects.toThrow()
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
      VaultStore.restore(
        destination,
        { document: current.document, slots: old.slots },
        undefined,
        true,
      ),
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
