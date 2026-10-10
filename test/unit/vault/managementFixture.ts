// The real management, repository, slot unlock and store over generated
// in-memory ports, shared by the C-M109-1 suites. Material is generated; no
// broker, OS store or network is used.

import { vi } from 'vitest'
import { type VaultSlotRecord } from '../../../src/shared/vault'
import { type VaultStatus } from '../../../src/shared/vaultProtocol'
import { VaultManagement } from '../../../src/core/vault/broker/management'
import {
  VaultSlotUnlock,
  VaultStoreRepository,
  type VaultAnchorPort,
} from '../../../src/core/vault/broker/repository'
import { FakeVaultClock, FakeVaultSlot } from '../helpers/vault/core'
import { MemoryVaultAnchor, MemoryVaultFiles } from './storeFixtures'

export class AnchorWithId extends MemoryVaultAnchor implements VaultAnchorPort {
  vaultId(): Promise<string | null> {
    const [first] = this.states.keys()
    return Promise.resolve(first ?? null)
  }
}
const noUnsubscribe = (): void => {
  /* The fake platform reports no screen lock. */
}
export async function stateOf(management: VaultManagement): Promise<string> {
  const snapshot = await management.snapshot()
  return snapshot.status.state
}

/** `wrapHold` delays the OS-store wrap; the provider reads the key only after it. */
export function managementFixture(wrapHold?: Promise<void>) {
  const clock = new FakeVaultClock()
  const files = new MemoryVaultFiles()
  const anchor = new AnchorWithId()
  const repository = new VaultStoreRepository(files, anchor)
  const osStore = new FakeVaultSlot('osStore')
  const wrapped: Uint8Array[] = []
  const wrapping = { started: 0 }
  const slots = {
    slotFor: (record: VaultSlotRecord) => (record.tier === 'osStore' ? osStore : null),
    osStore: (vaultId: string, slotId: string) => ({
      tier: 'osStore' as const,
      wrap: async (key: Uint8Array) => {
        wrapping.started += 1
        await wrapHold
        wrapped.push(Uint8Array.from(key))
        const record = await osStore.wrap(key)
        return { ...record, vaultId, id: slotId }
      },
      unwrap: (slot: VaultSlotRecord, use: string) => osStore.unwrap(slot, use),
    }),
    presence: () => Promise.resolve(false),
    onScreenLock: () => noUnsubscribe,
  }
  const unlock = new VaultSlotUnlock(files, anchor, slots)
  let status: VaultStatus = {
    state: 'locked',
    lockEpoch: 0,
    tier: null,
    provider: null,
    silentUnlock: true,
    itemCount: 0,
    reason: null,
  }
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
    lock: () => {
      repository.current().lock()
      status = { ...status, state: 'locked' }
    },
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
  return {
    clock,
    files,
    anchor,
    repository,
    osStore,
    unlock,
    broker,
    management,
    importFile,
    wrapped,
    wrapping,
  }
}
