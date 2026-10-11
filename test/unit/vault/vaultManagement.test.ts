import { describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { VAULT_APPROVAL_TTL_MS, KEYRING_SERVICE } from '../../../src/shared/constants'
import { VaultStore } from '../../../src/core/vault/store'
import { VaultError } from '../../../src/core/vault/crypto'
import {
  VaultManagementError,
  VaultStoreUnavailableError,
} from '../../../src/core/vault/broker/ports'
import type { VaultManagement } from '../../../src/core/vault/broker/management'
import { KeyringVaultAnchor, VAULT_ANCHOR_ACCOUNT } from '../../../src/runtime/vault/keyringAnchor'
import { memoryKeyring } from '../helpers/keyring'
import { approval, grant, metadata } from '../helpers/vault/fixtures'
import { freshVault } from './storeFixtures'
import { lockedVault, managementFixture, stateOf } from './managementFixture'

/** The OS store as a map; values are generated anchor records, never credentials. */

async function itemsOf(management: VaultManagement) {
  const snapshot = await management.snapshot()
  return snapshot.items
}
async function confirmNew(management: VaultManagement): Promise<void> {
  const shown = await management.setup()
  shown.code.fill(0)
  await management.confirmSetup(shown.setupId)
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
  it('F6: reset compares the complete expected state before retiring the anchor', async () => {
    const keyring = memoryKeyring(true)
    const anchor = new KeyringVaultAnchor(keyring.openEntry)
    const { anchor: generated, vaultId, key } = await freshVault()
    key.fill(0)
    const first = await generated.minimum(vaultId)
    if (first === null) throw new Error('missing generated anchor')
    await anchor.advance(vaultId, first, null)
    const second = { ...first, generation: first.generation + 1, stateDigest: '2'.repeat(64) }
    await anchor.advance(vaultId, second, first)
    await expect(anchor.reset(vaultId, first, () => undefined)).rejects.toMatchObject({
      code: 'rollback',
    })
    expect(await anchor.minimum(vaultId)).toEqual(second)
    await expect(
      anchor.reset(vaultId, second, () => {
        throw new Error('retired')
      }),
    ).rejects.toThrow('retired')
    expect(await anchor.minimum(vaultId)).toEqual(second)
    await anchor.reset(vaultId, second, () => undefined)
    expect(await anchor.vaultId()).toBeNull()
  })
  it('names one vault, advances only from its exact prior state and refuses another vault', async () => {
    const keyring = memoryKeyring(true)
    const anchor = new KeyringVaultAnchor(keyring.openEntry)
    const vaultId = 'a'.repeat(32)
    const first = {
      generation: 1,
      auditGeneration: 0,
      auditHead: '0'.repeat(64),
      stateDigest: '1'.repeat(64),
    }
    expect(await anchor.vaultId()).toBeNull()
    await anchor.advance(vaultId, first, null)
    expect(keyring.values.has(`${KEYRING_SERVICE}/${VAULT_ANCHOR_ACCOUNT}`)).toBe(true)
    expect(await anchor.vaultId()).toBe(vaultId)
    expect(await anchor.minimum(vaultId)).toEqual(first)
    const second = { ...first, generation: 2, stateDigest: '2'.repeat(64) }
    await expect(anchor.advance(vaultId, second, null)).rejects.toMatchObject({ code: 'rollback' })
    await expect(anchor.advance(vaultId, first, first)).rejects.toMatchObject({ code: 'rollback' })
    await anchor.advance(vaultId, second, first)
    await expect(anchor.minimum('b'.repeat(32))).rejects.toMatchObject({ code: 'rollback' })
    keyring.values.set(`${KEYRING_SERVICE}/${VAULT_ANCHOR_ACCOUNT}`, '{"v":1}')
    await expect(anchor.minimum(vaultId)).rejects.toMatchObject({ code: 'rollback' })
  })
  it('reports an unusable OS store as its fixed repair, never as no history (RVCM1091B 4)', async () => {
    const anchor = new KeyringVaultAnchor(() => ({
      getPassword: () => Promise.reject(new Error('generated store failure')),
      setPassword: () => Promise.reject(new Error('generated store failure')),
      deletePassword: () => Promise.reject(new Error('generated store failure')),
    }))
    await expect(anchor.vaultId()).rejects.toBeInstanceOf(VaultStoreUnavailableError)
  })
  it('resets exactly this vault by compare-and-delete and refuses another vault (round-3 anchor)', async () => {
    const keyring = memoryKeyring(true)
    const anchor = new KeyringVaultAnchor(keyring.openEntry)
    const vaultId = 'a'.repeat(32)
    const state = {
      generation: 1,
      auditGeneration: 0,
      auditHead: '0'.repeat(64),
      stateDigest: '1'.repeat(64),
    }
    // Round 5 requires the exact protected record, even when it disappeared.
    const authorize = vi.fn()
    await expect(anchor.reset(vaultId, null, authorize)).rejects.toMatchObject({ code: 'rollback' })
    await anchor.advance(vaultId, state, null)
    await expect(anchor.reset('b'.repeat(32), state, authorize)).rejects.toMatchObject({
      code: 'rollback',
    })
    expect(await anchor.vaultId()).toBe(vaultId)
    await anchor.reset(vaultId, state, authorize)
    expect(await anchor.vaultId()).toBeNull()
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
    const code = await lockedVault(f)
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
  it('erases the recovered key when the broker refuses the unlock', async () => {
    const f = managementFixture()
    const code = await lockedVault(f)
    const offered: Buffer[] = []
    const offer = f.unlock.offerRecovery.bind(f.unlock)
    vi.spyOn(f.unlock, 'offerRecovery').mockImplementation((slotId, key) => {
      offered.push(key)
      offer(slotId, key)
    })
    f.broker.unlock.mockRejectedValueOnce(new Error('generated broker refusal'))
    await expect(f.management.recover(code)).rejects.toThrow('generated broker refusal')
    expect(offered).toHaveLength(1)
    expect(offered[0]?.every((byte) => byte === 0)).toBe(true)
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
