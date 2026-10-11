// C-M109-1 (a): the broker's repository over the v2 store, and the unlock
// port over the platform slots. Lane (b)'s broker process composes these with
// its platform slots; nothing here knows an OS.

import { UI_TEXT } from '../../../shared/constants'
import {
  type VaultGrant,
  type VaultSlotPort,
  type VaultSlotRecord,
  type VaultUse,
} from '../../../shared/vault'
import { type vaultPrivateReadSchema } from '../../../shared/vaultProtocol'
import { VaultError } from '../crypto'
import {
  VaultStore,
  type VaultFilePort,
  type VaultGenerationPort,
  type VaultGenerationState,
} from '../store'
import {
  VaultStoreUnavailableError,
  type VaultBrokerRepository,
  type VaultUnlockPort,
} from './ports'

/** The anchor also names the one vault this user owns (lead decision 3). */
export interface VaultAnchorPort extends VaultGenerationPort {
  vaultId(): Promise<string | null>
  /** Reset Vault only: removes this vault's record (compare-and-delete). */
  reset(
    vaultId: string,
    expected: VaultGenerationState | null,
    authorize: () => void,
  ): Promise<void>
}

type RepositoryChange = Parameters<Parameters<VaultBrokerRepository['subscribe']>[0]>[0]

/** Holds the store the broker opened; the broker's lock erases its key and every call refuses. */
export class VaultStoreRepository implements VaultBrokerRepository {
  private store: VaultStore | undefined
  private readonly listeners = new Set<(change: RepositoryChange) => void>()
  private readonly committed = new Set<() => void>()
  constructor(
    private readonly files: VaultFilePort,
    private readonly anchor: VaultAnchorPort,
  ) {}
  private notifyCommitted(): void {
    for (const listener of this.committed) {
      try {
        listener()
      } catch {
        /* One failing view cannot hide the change from the rest. */
      }
    }
  }
  async open(key: Uint8Array): Promise<VaultStore> {
    const vaultId = await this.anchor.vaultId()
    if (vaultId === null) throw new VaultError('invalid')
    const store = await VaultStore.open({ files: this.files, anchor: this.anchor, key }, vaultId)
    this.store?.lock()
    this.store = store
    return store
  }
  /** The open store, or `locked`. */
  current(): VaultStore {
    if (this.store === undefined) throw new VaultError('locked')
    return this.store
  }
  async grants(): Promise<readonly VaultGrant[]> {
    return await this.current().grants()
  }
  async saveGrant(grant: VaultGrant, authorize: () => void): Promise<void> {
    await this.current().saveGrant(grant, authorize)
    // A new grant revokes nothing: subscribe() carries revocations only, which
    // the broker applies as revoked (RVCM1091A F3). Views still hear of it.
    this.notifyCommitted()
  }
  async removeGrant(id: string): Promise<void> {
    await this.current().removeGrant(id)
    this.notify({ kind: 'grant', id })
    this.notifyCommitted()
  }
  async consumeGrant(id: string, now: number): Promise<boolean> {
    return await this.current().consumeGrant(id, now)
  }
  subscribe(listener: (change: RepositoryChange) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  /** Every committed grant change, for views; never a revocation signal. */
  subscribeCommitted(listener: () => void): () => void {
    this.committed.add(listener)
    return () => {
      this.committed.delete(listener)
    }
  }
  /** Revocations and policy changes the broker must apply; each listener is isolated. */
  notify(change: RepositoryChange): void {
    for (const listener of this.listeners) {
      try {
        listener(change)
      } catch {
        /* One failing subscriber cannot hide the change from the rest. */
      }
    }
  }
}

/** The platform's slots (lanes b and c); null where this machine cannot unwrap a record. */
export interface VaultSlotProvider {
  slotFor(record: VaultSlotRecord): VaultSlotPort | null
  /** The OS-store slot a new vault is wrapped in (lead decisions 6 and 8). */
  osStore(vaultId: string, slotId: string): VaultSlotPort
  presence(
    itemId: string,
    challenge: string,
    use: VaultUse | ReturnType<typeof vaultPrivateReadSchema.parse>,
  ): Promise<boolean>
  onScreenLock(listener: () => void): () => void
}

/** Silent tiers in the order unlock tries them; prompting tiers need an explicit slot id. */
const SILENT_TIERS: readonly VaultSlotRecord['tier'][] = ['hardware', 'osStore']

export class VaultSlotUnlock implements VaultUnlockPort {
  private recovery: { slotId: string; key: Buffer } | null = null
  constructor(
    private readonly files: VaultFilePort,
    private readonly anchor: VaultAnchorPort,
    private readonly provider: VaultSlotProvider,
  ) {}
  /** The recovery code's unwrapped key, consumed by the very next unlock of that slot. */
  discardRecovery(): void {
    this.recovery?.key.fill(0)
    this.recovery = null
  }
  offerRecovery(slotId: string, key: Buffer): void {
    this.recovery?.key.fill(0)
    this.recovery = { slotId, key }
  }
  async records(): Promise<readonly VaultSlotRecord[]> {
    const vaultId = await this.anchor.vaultId()
    if (vaultId === null) throw new VaultError('invalid')
    return await VaultStore.slotRecords(this.files, vaultId)
  }
  async unlock(slotId: string | null): Promise<{ key: Uint8Array; slot: VaultSlotRecord }> {
    const offered = this.recovery
    this.recovery = null
    try {
      const records = await this.records()
      if (offered !== null) {
        const slot = records.find((record) => record.id === offered.slotId)
        if (slot?.tier !== 'recovery' || slotId !== offered.slotId) throw new VaultError('invalid')
        const key = Buffer.alloc(offered.key.length)
        key.set(offered.key)
        return { key, slot }
      }
      const candidates =
        slotId === null
          ? SILENT_TIERS.flatMap((tier) => records.filter((record) => record.tier === tier))
          : records.filter((record) => record.id === slotId && record.tier !== 'recovery')
      let isStoreUnavailable = false
      for (const slot of candidates) {
        const port = this.provider.slotFor(slot)
        if (port === null) continue
        try {
          return { key: await port.unwrap(slot, 'unlock'), slot }
        } catch (error: unknown) {
          // Another slot may still unlock (a lost TPM falls back to the OS store).
          if (error instanceof VaultStoreUnavailableError) isStoreUnavailable = true
        }
      }
      // An unusable OS store keeps its fixed repair reason (RVCM1091B 4).
      throw isStoreUnavailable ? new VaultStoreUnavailableError() : new Error(UI_TEXT.vault.locked)
    } finally {
      offered?.key.fill(0)
    }
  }
  async presence(
    itemId: string,
    challenge: string,
    use: VaultUse | ReturnType<typeof vaultPrivateReadSchema.parse>,
  ): Promise<boolean> {
    return await this.provider.presence(itemId, challenge, use)
  }
  onScreenLock(listener: () => void): () => void {
    return this.provider.onScreenLock(listener)
  }
}
