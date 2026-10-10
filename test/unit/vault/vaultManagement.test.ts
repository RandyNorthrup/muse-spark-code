import { describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { VAULT_APPROVAL_TTL_MS, KEYRING_SERVICE } from '../../../src/shared/constants'
import { type VaultSlotRecord } from '../../../src/shared/vault'
import { type VaultStatus } from '../../../src/shared/vaultProtocol'
import { VaultStore } from '../../../src/core/vault/store'
import { VaultError } from '../../../src/core/vault/crypto'
import { VaultManagementError } from '../../../src/core/vault/broker/ports'
import { VaultManagement } from '../../../src/core/vault/broker/management'
import {
  VaultSlotUnlock,
  VaultStoreRepository,
  type VaultAnchorPort,
} from '../../../src/core/vault/broker/repository'
import { KeyringVaultAnchor, VAULT_ANCHOR_ACCOUNT } from '../../../src/runtime/vault/keyringAnchor'
import { type KeyringEntryFactory } from '../../../src/runtime/keyStore'
import { FakeVaultClock, FakeVaultSlot } from '../helpers/vault/core'
import { approval, grant, metadata } from '../helpers/vault/fixtures'
import { MemoryVaultFiles, MemoryVaultAnchor, freshVault } from './storeFixtures'

/** The OS store as a map; values are generated anchor records, never credentials. */
function memoryKeyring() {
  const entries = new Map<string, string>()
  const factory: KeyringEntryFactory = (service, account) => ({
    getPassword: () => Promise.resolve(entries.get(`${service}/${account}`) ?? null),
    setPassword: (password) => {
      entries.set(`${service}/${account}`, password)
      return Promise.resolve()
    },
    deletePassword: () => Promise.resolve(entries.delete(`${service}/${account}`)),
  })
  return { entries, factory }
}
class AnchorWithId extends MemoryVaultAnchor implements VaultAnchorPort {
  vaultId(): Promise<string | null> {
    const [first] = this.states.keys()
    return Promise.resolve(first ?? null)
  }
}
const lockedStatus: VaultStatus = {
  state: 'locked',
  lockEpoch: 0,
  tier: null,
  provider: null,
  silentUnlock: true,
  itemCount: 0,
  reason: null,
}

const noUnsubscribe = (): void => {
  /* The fake platform reports no screen lock. */
}
async function stateOf(management: VaultManagement): Promise<string> {
  const snapshot = await management.snapshot()
  return snapshot.status.state
}
async function itemsOf(management: VaultManagement) {
  const snapshot = await management.snapshot()
  return snapshot.items
}
async function confirmNew(management: VaultManagement): Promise<void> {
  const shown = await management.setup()
  shown.code.fill(0)
  await management.confirmSetup(shown.setupId)
}
function managementFixture() {
  const clock = new FakeVaultClock()
  const files = new MemoryVaultFiles()
  const anchor = new AnchorWithId()
  const repository = new VaultStoreRepository(files, anchor)
  const osStore = new FakeVaultSlot('osStore')
  const slots = {
    slotFor: (record: VaultSlotRecord) => (record.tier === 'osStore' ? osStore : null),
    osStore: (vaultId: string, slotId: string) => ({
      tier: 'osStore' as const,
      wrap: async (key: Uint8Array) => {
        const record = await osStore.wrap(key)
        return { ...record, vaultId, id: slotId }
      },
      unwrap: (slot: VaultSlotRecord, use: string) => osStore.unwrap(slot, use),
    }),
    presence: () => Promise.resolve(false),
    onScreenLock: () => noUnsubscribe,
  }
  const unlock = new VaultSlotUnlock(files, anchor, slots)
  let status: VaultStatus = { ...lockedStatus }
  const broker = {
    status: vi.fn(() => Promise.resolve(status)),
    unlock: vi.fn(async (slotId: string | null) => {
      const { key } = await unlock.unlock(slotId)
      try {
        await repository.open(key)
      } finally {
        key.fill(0)
      }
      status = { ...status, state: 'unlocked', tier: 'osStore' }
    }),
    policyChanged: vi.fn(() => Promise.resolve()),
  }
  const importFile = vi.fn(() => Promise.resolve())
  const management = new VaultManagement({
    files,
    anchor,
    repository,
    unlock,
    slots,
    broker,
    clock,
    importFile,
  })
  return { clock, files, anchor, repository, osStore, unlock, broker, management, importFile }
}

describe('C-M109-1 store v2 grants', () => {
  it('saves, spends to its limit, refuses an unknown item and drops grants with their item', async () => {
    const { store } = await freshVault()
    const item = {
      metadata: metadata(),
      material: { kind: 'secret' as const, value: randomBytes(16) },
    }
    await store.write(item)
    const authorize = vi.fn()
    await store.saveGrant(grant(), authorize)
    expect(authorize).toHaveBeenCalledOnce()
    expect(await store.consumeGrant(grant().id, 1)).toBe(true)
    expect(await store.consumeGrant(grant().id, 1)).toBe(true)
    // maxUses is 2: the third use is refused without spending.
    expect(await store.consumeGrant(grant().id, 1)).toBe(false)
    const [spent] = await store.grants()
    expect(spent?.uses).toBe(2)
    await expect(
      store.saveGrant({ ...grant(), id: 'a'.repeat(32), itemId: 'b'.repeat(32) }, authorize),
    ).rejects.toBeInstanceOf(VaultError)
    await store.remove(item.metadata.id)
    expect(await store.grants()).toEqual([])
  })
  it('refuses an expired grant and treats removing an absent grant as done', async () => {
    const { store } = await freshVault()
    await store.write({
      metadata: metadata(),
      material: { kind: 'secret', value: randomBytes(16) },
    })
    await store.saveGrant({ ...grant(), expiresAt: 10 }, () => undefined)
    expect(await store.consumeGrant(grant().id, 10)).toBe(false)
    await store.removeGrant('c'.repeat(32))
    await store.removeGrant(grant().id)
    expect(await store.grants()).toEqual([])
  })
})

describe('C-M109-1 keyring rollback anchor', () => {
  it('names one vault, advances only from its exact prior state and refuses another vault', async () => {
    const keyring = memoryKeyring()
    const anchor = new KeyringVaultAnchor(keyring.factory)
    const vaultId = 'a'.repeat(32)
    const first = {
      generation: 1,
      auditGeneration: 0,
      auditHead: '0'.repeat(64),
      stateDigest: '1'.repeat(64),
    }
    expect(await anchor.vaultId()).toBeNull()
    await anchor.advance(vaultId, first, null)
    expect(keyring.entries.has(`${KEYRING_SERVICE}/${VAULT_ANCHOR_ACCOUNT}`)).toBe(true)
    expect(await anchor.vaultId()).toBe(vaultId)
    expect(await anchor.minimum(vaultId)).toEqual(first)
    const second = { ...first, generation: 2, stateDigest: '2'.repeat(64) }
    await expect(anchor.advance(vaultId, second, null)).rejects.toMatchObject({ code: 'rollback' })
    await expect(anchor.advance(vaultId, first, first)).rejects.toMatchObject({ code: 'rollback' })
    await anchor.advance(vaultId, second, first)
    await expect(anchor.minimum('b'.repeat(32))).rejects.toMatchObject({ code: 'rollback' })
    keyring.entries.set(`${KEYRING_SERVICE}/${VAULT_ANCHOR_ACCOUNT}`, '{"v":1}')
    await expect(anchor.minimum(vaultId)).rejects.toMatchObject({ code: 'rollback' })
  })
  it('reports an unusable OS store as io, never as no history', async () => {
    const anchor = new KeyringVaultAnchor(() => ({
      getPassword: () => Promise.reject(new Error('generated store failure')),
      setPassword: () => Promise.reject(new Error('generated store failure')),
      deletePassword: () => Promise.reject(new Error('generated store failure')),
    }))
    await expect(anchor.vaultId()).rejects.toMatchObject({ code: 'io' })
  })
})

describe('C-M109-1 setup flow and management', () => {
  it('shows the code once, writes nothing before I Saved It, then creates, wraps and unlocks', async () => {
    const f = managementFixture()
    expect(await stateOf(f.management)).toBe('uncreated')
    const shown = await f.management.setup()
    expect(shown.code.toString('ascii')).toMatch(/^[a-f0-9]{40}$/u)
    const pending = await f.management.snapshot()
    expect(pending.status.state).toBe('setupPending')
    expect(pending.setupId).toBe(shown.setupId)
    expect(f.files.data.size).toBe(0)
    await expect(f.management.setup()).rejects.toMatchObject({ reason: 'exists' })
    await f.management.confirmSetup(shown.setupId)
    expect(await VaultStore.exists(f.files)).toBe(true)
    expect(f.broker.unlock).toHaveBeenCalledWith(null)
    const ready = await f.management.snapshot()
    expect(ready.status.state).toBe('unlocked')
    const records = await f.unlock.records()
    expect(records.map((record) => record.tier).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'osStore',
      'recovery',
    ])
    await expect(f.management.setup()).rejects.toMatchObject({ reason: 'exists' })
  })
  it('expires an unconfirmed setup and erases its key; cancel needs the matching id', async () => {
    const f = managementFixture()
    const shown = await f.management.setup()
    await expect(f.management.cancelSetup('f'.repeat(32))).rejects.toMatchObject({
      reason: 'invalid',
    })
    f.clock.advance(VAULT_APPROVAL_TTL_MS)
    expect(await stateOf(f.management)).toBe('uncreated')
    await expect(f.management.confirmSetup(shown.setupId)).rejects.toBeInstanceOf(
      VaultManagementError,
    )
    expect(f.files.data.size).toBe(0)
    const again = await f.management.setup()
    await f.management.cancelSetup(again.setupId)
    expect(await stateOf(f.management)).toBe('uncreated')
  })
  it('keeps a setup pending when the OS store refuses the wrap', async () => {
    const f = managementFixture()
    const shown = await f.management.setup()
    vi.spyOn(f.osStore, 'wrap').mockRejectedValueOnce(new Error('generated store failure'))
    await expect(f.management.confirmSetup(shown.setupId)).rejects.toMatchObject({
      reason: 'io',
    })
    expect(await stateOf(f.management)).toBe('setupPending')
    expect(f.files.data.size).toBe(0)
  })
  it('adds, edits metadata and removes items, refusing duplicates and kind changes', async () => {
    const f = managementFixture()
    await confirmNew(f.management)
    const events: string[] = []
    f.management.subscribe((event) => {
      events.push(event.kind)
    })
    const value = randomBytes(24)
    await f.management.add({ metadata: metadata(), material: { kind: 'secret', value } })
    expect(value.every((byte) => byte === 0)).toBe(true)
    await expect(
      f.management.add({
        metadata: metadata(),
        material: { kind: 'secret', value: randomBytes(8) },
      }),
    ).rejects.toMatchObject({ reason: 'exists' })
    await f.management.editMetadata({ ...metadata(), label: 'Renamed generated item' })
    expect(f.broker.policyChanged).toHaveBeenCalledWith(metadata().id)
    await expect(
      f.management.editMetadata({ ...metadata(), kind: 'password' }),
    ).rejects.toMatchObject({ reason: 'invalid' })
    const [renamed] = await itemsOf(f.management)
    expect(renamed?.label).toBe('Renamed generated item')
    await f.management.remove(metadata().id)
    expect(await itemsOf(f.management)).toEqual([])
    expect(events.filter((kind) => kind === 'changed').length).toBeGreaterThanOrEqual(3)
  })
  it('refuses item management while locked', async () => {
    const f = managementFixture()
    await expect(
      f.management.add({
        metadata: metadata(),
        material: { kind: 'secret', value: randomBytes(8) },
      }),
    ).rejects.toMatchObject({ reason: 'locked' })
    await expect(f.management.publicKey(metadata().id)).rejects.toMatchObject({
      reason: 'locked',
    })
  })
  it('recovers through the recovery code when the OS-store slot is lost, and refuses a wrong code', async () => {
    const f = managementFixture()
    const shown = await f.management.setup()
    const code = Buffer.from(shown.code)
    await f.management.confirmSetup(shown.setupId)
    f.repository.current().lock()
    f.osStore.lost = true
    await expect(f.unlock.unlock(null)).rejects.toThrow()
    const wrong = Buffer.from('0'.repeat(40), 'ascii')
    await expect(f.management.recover(wrong)).rejects.toMatchObject({ reason: 'invalid' })
    const records = await f.unlock.records()
    const recoveryId = records.find((record) => record.tier === 'recovery')?.id
    await f.management.recover(code)
    expect(f.broker.unlock).toHaveBeenLastCalledWith(recoveryId)
    expect(await stateOf(f.management)).toBe('unlocked')
    code.fill(0)
  })
  it('lists pending approvals until they expire or the vault locks', async () => {
    const f = managementFixture()
    await confirmNew(f.management)
    const request = {
      ...approval(),
      createdAt: f.clock.now(),
      expiresAt: f.clock.now() + VAULT_APPROVAL_TTL_MS,
      lockEpoch: 0,
    }
    f.management.noteApproval(request)
    const listed = await f.management.snapshot()
    expect(listed.pending.map((entry) => entry.id)).toEqual([request.id])
    f.management.noteLocked(1)
    const cleared = await f.management.snapshot()
    expect(cleared.pending).toEqual([])
  })
})
