// C-M109-1 (a): protocol v2's management side and the setup flow (lead
// decisions 1, 2 and 8, 2026-10-10). Lane (b)'s broker process constructs one
// beside the broker and wires the broker's onApproval/onLocked/onRevoked
// callbacks to noteApproval/noteLocked/noteRevoked.

import { randomBytes } from 'node:crypto'
import { VAULT_APPROVAL_TTL_MS, VAULT_KEY_BYTES, VAULT_LIMITS } from '../../../shared/constants'
import {
  vaultItemMetadataSchema,
  type VaultApprovalRequest,
  type VaultClockPort,
  type VaultItem,
  type VaultItemMetadata,
  type VaultSlotRecord,
} from '../../../shared/vault'
import {
  type VaultBrokerEvent,
  type VaultBrokerSnapshot,
  type VaultStatus,
} from '../../../shared/vaultProtocol'
import { eraseVaultMaterial, randomVaultBytes, VaultError } from '../crypto'
import { createRecoverySlot, unlockRecoverySlot } from '../keyslots'
import { VaultStore, type VaultFilePort } from '../store'
import { VaultManagementError, type VaultManagementPort } from './ports'
import {
  type VaultAnchorPort,
  type VaultSlotProvider,
  type VaultSlotUnlock,
  type VaultStoreRepository,
} from './repository'

/** The broker calls the management side needs; never a value path. */
export interface VaultManagementBroker {
  status(): Promise<VaultStatus>
  unlock(slotId: string | null): Promise<void>
  policyChanged(itemId: string): Promise<void>
}
export interface VaultManagementDeps {
  readonly files: VaultFilePort
  readonly anchor: VaultAnchorPort
  readonly repository: VaultStoreRepository
  readonly unlock: VaultSlotUnlock
  readonly slots: Pick<VaultSlotProvider, 'osStore'>
  readonly broker: VaultManagementBroker
  readonly clock: VaultClockPort
  /** M's file importer over the open store's encrypted batch writer. */
  readonly importFile: (path: string) => Promise<void>
}
interface PendingSetup {
  readonly setupId: string
  readonly vaultId: string
  readonly key: Buffer
  readonly recovery: VaultSlotRecord
  readonly expiresAt: number
}
const newId = (): string => randomBytes(VAULT_LIMITS.idBytes).toString('hex')
/** The store's in-transaction refusal (absent, removed, other kind) as the management reason. */
async function refusingInvalid(commit: Promise<void>): Promise<void> {
  try {
    await commit
  } catch (error: unknown) {
    if (error instanceof VaultError && error.code === 'invalid')
      throw new VaultManagementError('invalid')
    throw error
  }
}

export class VaultManagement implements VaultManagementPort {
  private pending: PendingSetup | null = null
  /** A setup whose "I Saved It" is being committed: owned here, never expired underneath. */
  private confirming: PendingSetup | null = null
  private readonly approvals = new Map<string, VaultApprovalRequest>()
  private readonly listeners = new Set<(event: VaultBrokerEvent) => void>()
  private setupTail: Promise<void> = Promise.resolve()
  constructor(private readonly deps: VaultManagementDeps) {
    // Grant commits from any route reach every watching view.
    deps.repository.subscribeCommitted(() => {
      this.changed()
    })
  }

  private emit(event: VaultBrokerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        /* A failing watcher cannot hide the event from the others. */
      }
    }
  }
  private changed(): void {
    this.emit({ kind: 'changed', v: 2 })
  }
  /** Lazily expires an unconfirmed setup: its key and code never outlive the approval window. */
  private current(): PendingSetup | null {
    if (this.pending !== null && this.deps.clock.now() >= this.pending.expiresAt) this.discard()
    return this.pending
  }
  private discard(): void {
    this.pending?.key.fill(0)
    this.pending = null
  }
  private store(): VaultStore {
    try {
      return this.deps.repository.current()
    } catch {
      throw new VaultManagementError('locked')
    }
  }
  /** One setup step at a time; a second window's setup waits for the first. */
  private async serialize<T>(step: () => Promise<T>): Promise<T> {
    const previous = this.setupTail
    const run = (async () => {
      await previous
      return await step()
    })()
    this.setupTail = (async () => {
      try {
        await run
      } catch {
        /* Its caller receives the failure; the next step still runs. */
      }
    })()
    return await run
  }

  private async recoverNow(code: Uint8Array): Promise<void> {
    const records = await this.deps.unlock.records()
    const slot = records.find((record) => record.tier === 'recovery')
    if (slot === undefined) throw new VaultManagementError('invalid')
    let key: Buffer
    try {
      key = unlockRecoverySlot(slot, code)
    } catch {
      throw new VaultManagementError('invalid')
    }
    this.deps.unlock.offerRecovery(slot.id, key)
    try {
      await this.deps.broker.unlock(slot.id)
    } finally {
      // A failed unlock never leaves the recovered key waiting in memory.
      this.deps.unlock.discardRecovery()
    }
    this.changed()
  }
  noteApproval(request: VaultApprovalRequest): void {
    this.approvals.set(request.id, structuredClone(request))
    this.emit({ kind: 'approval', v: 2, request })
  }
  noteLocked(epoch: number): void {
    this.approvals.clear()
    this.emit({ kind: 'locked', v: 2, lockEpoch: epoch })
  }
  noteRevoked(requesterId: string, grantId: string | null): void {
    this.emit({ kind: 'revoked', v: 2, requesterId, grantId })
  }
  /** Repository commits from any route (grants from the broker) reach watchers too. */
  noteChanged(): void {
    this.changed()
  }

  async snapshot(): Promise<VaultBrokerSnapshot> {
    const pending = this.current() ?? this.confirming
    const broker = await this.deps.broker.status()
    const hasVault = await VaultStore.exists(this.deps.files)
    let state: VaultStatus['state'] = hasVault ? broker.state : 'uncreated'
    if (pending !== null) state = 'setupPending'
    const status = { ...broker, state }
    if (state !== 'unlocked')
      return { status, setupId: pending?.setupId ?? null, items: [], grants: [], pending: [] }
    const now = this.deps.clock.now()
    for (const [id, request] of this.approvals)
      if (request.expiresAt <= now || request.lockEpoch !== status.lockEpoch)
        this.approvals.delete(id)
    const store = this.store()
    const items = await store.list()
    const grants = await store.grants()
    const approvals: VaultApprovalRequest[] = []
    for (const request of this.approvals.values()) approvals.push(request)
    return {
      status: { ...status, itemCount: items.length },
      setupId: null,
      items: [...items],
      grants: [...grants],
      pending: approvals,
    }
  }

  async add(item: VaultItem): Promise<void> {
    try {
      const store = this.store()
      const items = await store.list()
      if (items.some((entry) => entry.id === item.metadata.id || entry.name === item.metadata.name))
        throw new VaultManagementError('exists')
      // Checked again inside the writer transaction (RVCM1091A F6).
      await refusingInvalid(store.write(item, 'absent'))
    } finally {
      eraseVaultMaterial(item.material)
    }
    this.changed()
  }
  async edit(item: VaultItem): Promise<void> {
    try {
      const store = this.store()
      const items = await store.list()
      const current = items.find((entry) => entry.id === item.metadata.id)
      if (current?.kind !== item.metadata.kind) throw new VaultManagementError('invalid')
      // Presence and kind are rechecked in the commit's own transaction (F6).
      await refusingInvalid(store.write(item, 'present'))
    } finally {
      eraseVaultMaterial(item.material)
    }
    await this.deps.broker.policyChanged(item.metadata.id)
    this.changed()
  }
  async editMetadata(input: VaultItemMetadata): Promise<void> {
    const metadata = vaultItemMetadataSchema.parse(input)
    // One transaction: a removed item is never resurrected and a rotated
    // secret never overwritten with older material (RVCM1091A F6).
    await refusingInvalid(this.store().updateMetadata(metadata))
    await this.deps.broker.policyChanged(metadata.id)
    this.changed()
  }
  async remove(itemId: string): Promise<void> {
    await this.store().remove(itemId)
    await this.deps.broker.policyChanged(itemId)
    this.changed()
  }
  async importFile(path: string): Promise<void> {
    this.store()
    await this.deps.importFile(path)
    this.changed()
  }
  async publicKey(itemId: string): Promise<string> {
    const items = await this.store().list()
    const item = items.find((entry) => entry.id === itemId)
    if (item?.kind !== 'sshKey' || item.publicKey === null)
      throw new VaultManagementError('invalid')
    return item.publicKey
  }

  async setup(): Promise<{ setupId: string; code: Buffer }> {
    return await this.serialize(async () => {
      if (
        this.current() !== null ||
        (await this.deps.anchor.vaultId()) !== null ||
        (await VaultStore.exists(this.deps.files))
      )
        throw new VaultManagementError('exists')
      const vaultId = newId()
      const key = randomVaultBytes(VAULT_KEY_BYTES)
      try {
        const { code, slot } = createRecoverySlot(key, vaultId, this.deps.clock)
        this.pending = {
          setupId: newId(),
          vaultId,
          key,
          recovery: slot,
          expiresAt: this.deps.clock.now() + VAULT_APPROVAL_TTL_MS,
        }
        // No change event: nothing is persisted, and the requesting window's
        // own echo must not retire its code dialog (RVCM1091A F4).
        return { setupId: this.pending.setupId, code }
      } catch (error: unknown) {
        key.fill(0)
        throw error
      }
    })
  }
  /** "I Saved It": only now is the vault written, wrapped in the OS store, then unlocked. */
  async confirmSetup(setupId: string): Promise<void> {
    await this.serialize(async () => {
      const pending = this.current()
      if (pending?.setupId !== setupId) throw new VaultManagementError('invalid')
      // Take ownership before the first await: expiry or a snapshot can no
      // longer erase the key this confirmation wraps (RVCM1091A F1).
      this.pending = null
      this.confirming = pending
      let isCreated = false
      try {
        let osStore: VaultSlotRecord
        try {
          osStore = await this.deps.slots.osStore(pending.vaultId, newId()).wrap(pending.key)
        } catch {
          throw new VaultManagementError('io')
        }
        const store = await VaultStore.create(
          { files: this.deps.files, anchor: this.deps.anchor, key: pending.key },
          pending.vaultId,
          [osStore, pending.recovery],
        )
        store.lock()
        isCreated = true
      } finally {
        this.confirming = null
        // A failed confirmation stays pending inside its window (retry or
        // cancel); after the window, or once created, the key is erased.
        if (isCreated || this.deps.clock.now() >= pending.expiresAt) pending.key.fill(0)
        else this.pending = pending
      }
      this.changed()
    })
    try {
      await this.deps.broker.unlock(null)
    } catch {
      // The vault exists; the snapshot shows it locked with the slot's reason.
      throw new VaultManagementError('locked')
    } finally {
      this.changed()
    }
  }
  async cancelSetup(setupId: string): Promise<void> {
    await this.serialize(() => {
      if (this.current()?.setupId !== setupId) throw new VaultManagementError('invalid')
      this.discard()
      this.changed()
      return Promise.resolve()
    })
  }
  async recover(code: Uint8Array): Promise<void> {
    // Serialized with setup: one offered recovery key at a time.
    await this.serialize(async () => {
      await this.recoverNow(code)
    })
  }
  subscribe(listener: (event: VaultBrokerEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
