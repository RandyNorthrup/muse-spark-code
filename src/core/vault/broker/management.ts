// C-M109-1 (a): protocol v2's management side and the setup flow (lead
// decisions 1, 2 and 8, 2026-10-10). Lane (b)'s broker process constructs one
// beside the broker and wires the broker's onApproval/onLocked/onRevoked
// callbacks to noteApproval/noteLocked/noteRevoked.

import { randomBytes } from 'node:crypto'
import nodePath from 'node:path'
import {
  UI_TEXT,
  VAULT_APPROVAL_TTL_MS,
  VAULT_KEY_BYTES,
  VAULT_LIMITS,
  VAULT_RESET_WORD,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
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
import { discoverAmbientFiles } from '../migrate/ambient'
import { VaultFileImporter, type VaultFileImportPort } from '../migrate/importFile'
import { VaultMigrationFault, type MigrationOwnerPort } from '../migrate/ports'
import { prepareImportItems } from '../migrate/prepareImport'
import {
  VaultManagementError,
  VaultStoreUnavailableError,
  type VaultImportReport,
  type VaultManagementPort,
} from './ports'
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
  /** The user's home: only files discovered there (M's ambient list) are imported. */
  readonly home: string
}
interface PendingReset {
  readonly id: string
  readonly vaultId: string
  readonly expiresAt: number
}
/** Receipts keep the file identity's bigints across the store's JSON. */
function encodeReceipt(record: unknown): string {
  return JSON.stringify(record, (_key, value: unknown) =>
    typeof value === 'bigint' ? { bigint: value.toString() } : value,
  )
}
function decodeReceipt(raw: string): unknown {
  return JSON.parse(raw, (_key, value: unknown) =>
    typeof value === 'object' &&
    value !== null &&
    'bigint' in value &&
    typeof value.bigint === 'string' &&
    Object.keys(value).length === 1
      ? BigInt(value.bigint)
      : value,
  )
}
/** The open store as M's batch import port. */
function importPort(store: VaultStore): VaultFileImportPort {
  return {
    list: async () => await store.list(),
    read: async (id) => await store.read(id),
    writeBatch: async (items, receipt, verify, authorize) => {
      await store.writeBatch(
        items,
        { id: receipt.id, record: encodeReceipt(receipt.record) },
        verify,
        authorize,
      )
    },
    readReceipt: async (id) => {
      const raw = await store.readReceipt(id)
      return raw === null ? null : decodeReceipt(raw)
    },
    forgetReceipt: async (id, authorize) => {
      await store.forgetReceipt(id, authorize)
    },
  }
}
/** One spelling per file: resolved, and case-insensitive on Windows (any drive). */
function importPathKey(file: string): string {
  const resolved = nodePath.resolve(file)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
/** M's refusals as the management reason; nothing of the file reaches it. */
function importRefusal(error: unknown): unknown {
  if (!(error instanceof VaultMigrationFault)) return error
  switch (error.code) {
    case 'conflict': {
      return new VaultManagementError('conflict')
    }
    case 'window': {
      return new VaultManagementError('locked')
    }
    case 'storage': {
      return new VaultManagementError('io')
    }
    case 'orphaned': {
      return new VaultManagementError('sourceGone')
    }
    case 'unreadable': {
      return new VaultManagementError('sourceUnreadable')
    }
    case 'invalid':
    case 'verification': {
      return new VaultManagementError('invalid')
    }
  }
}
interface PendingSetup {
  readonly setupId: string
  readonly vaultId: string
  readonly key: Buffer
  readonly recovery: VaultSlotRecord
  readonly expiresAt: number
}
const newId = (): string => randomBytes(VAULT_LIMITS.idBytes).toString('hex')
/** An OS-store failure keeps its fixed repair reason; anything else is `io`. */
function storeRefusal(error: unknown): VaultManagementError {
  return new VaultManagementError(
    error instanceof VaultStoreUnavailableError ? 'storeUnavailable' : 'io',
  )
}
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
  private pendingReset: PendingReset | null = null
  /** Rises at every Lock: an operation that started earlier never finishes after it. */
  private lockGeneration = 0
  /** One importer per open store: Keep cancels that window's in-flight Delete. */
  private importer: { store: VaultStore; importer: VaultFileImporter } | null = null
  /** Set by Lock during a confirmation: its key is erased, never restored to pending. */
  private isConfirmationCancelled = false
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
  private async serialize<T>(step: (generation: number) => Promise<T>): Promise<T> {
    // Admission belongs to the request, including time spent behind another turn.
    const generation = this.lockGeneration
    const previous = this.setupTail
    const run = (async () => {
      await previous
      this.assertSameLock(generation)
      return await step(generation)
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

  private async recoverNow(code: Uint8Array, generation: number): Promise<void> {
    // Already unlocked: nothing to recover, so no key is unwrapped at all
    // outside the broker's Lock cleanup (RVCM1091B 2).
    const status = await this.deps.broker.status()
    this.assertSameLock(generation)
    if (status.state === 'unlocked') return
    const records = await this.deps.unlock.records()
    this.assertSameLock(generation)
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
      this.assertSameLock(generation)
    } finally {
      // A failed unlock never leaves the recovered key waiting in memory.
      this.deps.unlock.discardRecovery()
    }
    this.changed()
  }
  /** Thrown at every await boundary of an operation a Lock overtook. */
  private assertSameLock(generation: number): void {
    if (this.lockGeneration !== generation) throw new VaultManagementError('locked')
  }
  private async anchoredId(): Promise<string | null> {
    try {
      return await this.deps.anchor.vaultId()
    } catch (error: unknown) {
      throw storeRefusal(error)
    }
  }
  /** M's importer bound to the open store; a lease is current only while that store is. */
  private fileImporter(): VaultFileImporter {
    const store = this.store()
    if (this.importer?.store === store) return this.importer.importer
    this.importer?.importer.dispose()
    const owner: MigrationOwnerPort = {
      run: async (work) =>
        await this.serialize(
          async () =>
            await work({
              assertCurrent: () => {
                if (this.store() !== store) throw new VaultMigrationFault('window')
                store.assertOpen()
              },
            }),
        ),
    }
    const importer = new VaultFileImporter(importPort(store), owner, this.deps.home)
    this.importer = { store, importer }
    return importer
  }
  noteApproval(request: VaultApprovalRequest): void {
    this.approvals.set(request.id, structuredClone(request))
    this.emit({ kind: 'approval', v: 2, request })
  }
  noteLocked(epoch: number): void {
    // Lock ends everything: an unconfirmed setup's key and any offered
    // recovery key are erased with the broker's own (RVCM1091B 2), and every
    // operation already running stops at its next await (RVCM1091A2 P2).
    this.lockGeneration += 1
    this.pendingReset = null
    this.discard()
    if (this.confirming !== null) this.isConfirmationCancelled = true
    this.deps.unlock.discardRecovery()
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
    if (pending === null && broker.state !== 'unlocked') {
      const anchored = await this.anchoredId()
      if (anchored !== null && (await VaultStore.isLost(this.deps.files, anchored)))
        return {
          // A lost vault names no protection either (RVCM1091E P3).
          status: {
            ...broker,
            state: 'unavailable',
            reason: 'vaultLost',
            tier: null,
            provider: null,
            silentUnlock: false,
          },
          setupId: null,
          items: [],
          grants: [],
          pending: [],
        }
    }
    const hasVault = await VaultStore.exists(this.deps.files)
    let state: VaultStatus['state'] = hasVault ? broker.state : 'uncreated'
    if (pending !== null) state = 'setupPending'
    const status = { ...broker, state }
    if (state !== 'unlocked') {
      // A vault that cannot be opened names no protection: a carried slot
      // beside "Set up" or "can no longer be opened" is stale (RVCM1091E P3).
      const observed = ['uncreated', 'setupPending', 'unavailable'].includes(state)
        ? { tier: null, provider: null, silentUnlock: false }
        : {}
      return {
        status: { ...status, ...observed },
        setupId: pending?.setupId ?? null,
        items: [],
        grants: [],
        pending: [],
      }
    }
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
        throw new VaultManagementError('conflict')
      if (items.length >= VAULT_LIMITS.items) throw new VaultManagementError('invalid')
      try {
        // Checked again inside the writer transaction (RVCM1091A F6).
        await store.write(item, 'absent')
      } catch (error: unknown) {
        if (!(error instanceof VaultError) || error.code !== 'invalid') throw error
        // Lost the race past the pre-check: re-read to name a taken id or
        // name as a collision, never as a generic failure (RVCM1091E P3).
        const current = await store.list()
        if (
          current.some(
            (entry) => entry.id === item.metadata.id || entry.name === item.metadata.name,
          )
        )
          throw new VaultManagementError('conflict')
        throw new VaultManagementError('invalid')
      }
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
  async importFile(path: string, isCurrent: () => boolean): Promise<VaultImportReport> {
    const generation = this.lockGeneration
    const importer = this.fileImporter()
    const discovered = await discoverAmbientFiles(this.deps.home)
    this.assertSameLock(generation)
    const requested = importPathKey(path)
    const file = discovered.find((entry) => importPathKey(entry.path) === requested)
    if (file === undefined) throw new VaultManagementError('invalid')
    let report: VaultImportReport
    try {
      report = await importer.import(
        file,
        (kind, bytes) => {
          try {
            return Promise.resolve(
              prepareImportItems(kind, bytes, {
                now: this.deps.clock.now(),
                label: (source, number) => fill(UI_TEXT.vault.importedLabel, { source, number }),
              }),
            )
          } catch (error: unknown) {
            return Promise.reject(
              error instanceof Error ? error : new VaultMigrationFault('invalid'),
            )
          }
        },
        () => {
          // Cancelled requester (closed connection) or a Lock since the start:
          // nothing commits (lead decision; RVCM1091A2 P2).
          if (!isCurrent() || this.lockGeneration !== generation)
            throw new VaultMigrationFault('window')
        },
      )
    } catch (error: unknown) {
      throw importRefusal(error)
    }
    this.changed()
    return report
  }
  async keepImport(receipt: string): Promise<void> {
    try {
      await this.fileImporter().keep(receipt)
    } catch (error: unknown) {
      throw importRefusal(error)
    }
  }
  async deleteImport(receipt: string, isCurrent: () => boolean): Promise<void> {
    const generation = this.lockGeneration
    try {
      await this.fileImporter().deleteSource(receipt, () => {
        if (!isCurrent() || this.lockGeneration !== generation)
          throw new VaultMigrationFault('window')
      })
    } catch (error: unknown) {
      // A source that changed after a successful import is not an add/import
      // collision: Delete names what stayed behind (RVCM1091E P2). A source
      // already gone (a previous Delete removed it but could not forget its
      // receipt) names that truth instead of a retryable failure (RVCM1091F).
      if (error instanceof VaultMigrationFault && error.code === 'conflict')
        throw new VaultManagementError('deleteConflict')
      if (error instanceof VaultMigrationFault && error.code === 'orphaned')
        throw new VaultManagementError('sourceGone')
      throw importRefusal(error)
    }
  }
  /** Reset Vault step 1 (lead decision): refused unless the anchored vault is lost. */
  async resetBegin(): Promise<{ resetId: string; word: string }> {
    return await this.serialize(async (generation) => {
      if (this.current() !== null || this.confirming !== null)
        throw new VaultManagementError('invalid')
      const status = await this.deps.broker.status()
      this.assertSameLock(generation)
      if (status.state === 'unlocked') throw new VaultManagementError('invalid')
      const anchored = await this.anchoredId()
      if (anchored === null || !(await VaultStore.isLost(this.deps.files, anchored)))
        throw new VaultManagementError('invalid')
      this.assertSameLock(generation)
      const resetId = newId()
      this.pendingReset = {
        id: resetId,
        vaultId: anchored,
        expiresAt: this.deps.clock.now() + VAULT_APPROVAL_TTL_MS,
      }
      return { resetId, word: VAULT_RESET_WORD }
    })
  }
  /**
   * Step 2: the exact word for this challenge, the same lost vault, then the
   * audit line, the files (displaced document retained) and the anchor.
   * Rollback protection restarts with the next setup's new anchor.
   */
  async resetConfirm(resetId: string, word: string): Promise<void> {
    await this.serialize(async (generation) => {
      const pending = this.pendingReset
      this.pendingReset = null
      if (
        word !== VAULT_RESET_WORD ||
        pending?.id !== resetId ||
        this.deps.clock.now() >= pending.expiresAt
      )
        throw new VaultManagementError('invalid')
      const status = await this.deps.broker.status()
      this.assertSameLock(generation)
      if (status.state === 'unlocked') throw new VaultManagementError('invalid')
      const anchored = await this.anchoredId()
      this.assertSameLock(generation)
      if (anchored !== pending.vaultId) throw new VaultManagementError('invalid')
      const expected = await this.deps.anchor.minimum(anchored)
      this.assertSameLock(generation)
      if (expected === null) throw new VaultManagementError('invalid')
      const audit = JSON.stringify({
        v: 1,
        kind: 'vaultReset',
        at: this.deps.clock.now(),
        previousVaultId: anchored,
      })
      try {
        await VaultStore.resetLost(
          this.deps.files,
          anchored,
          audit,
          () => {
            this.assertSameLock(generation)
          },
          async () => {
            await this.deps.anchor.reset(anchored, expected, () => {
              this.assertSameLock(generation)
            })
          },
          this.deps.anchor,
          expected,
        )
      } catch (error: unknown) {
        if (error instanceof VaultManagementError) throw error
        if (error instanceof VaultStoreUnavailableError) throw storeRefusal(error)
        // Not lost any more (a vault reappeared) or the files refused: nothing reset.
        throw new VaultManagementError('invalid')
      }
      this.assertSameLock(generation)
    })
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
    return await this.serialize(async (generation) => {
      if (this.current() !== null) throw new VaultManagementError('exists')
      let anchored: string | null
      try {
        anchored = await this.deps.anchor.vaultId()
      } catch (error: unknown) {
        throw storeRefusal(error)
      }
      // A first intent left by a failed, expired setup can never be opened:
      // remove it so setup can start again (RVCM1091B 3).
      if (anchored === null) await VaultStore.discardAbandonedCreation(this.deps.files)
      if (anchored !== null || (await VaultStore.exists(this.deps.files)))
        throw new VaultManagementError('exists')
      this.assertSameLock(generation)
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
    const generation = this.lockGeneration
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
        } catch (error: unknown) {
          throw storeRefusal(error)
        }
        // Locked while wrapping: nothing is created and the key is erased below.
        this.assertSameLock(generation)
        let store: VaultStore
        try {
          store = await VaultStore.create(
            { files: this.deps.files, anchor: this.deps.anchor, key: pending.key },
            pending.vaultId,
            [osStore, pending.recovery],
            () => {
              this.assertSameLock(generation)
            },
          )
        } catch (error: unknown) {
          throw error instanceof VaultStoreUnavailableError ? storeRefusal(error) : error
        }
        store.lock()
        isCreated = true
      } finally {
        this.confirming = null
        // A failed confirmation stays pending inside its window (retry or
        // cancel); after the window, after a Lock, or once created, the key
        // is erased.
        if (isCreated || this.isConfirmationCancelled || this.deps.clock.now() >= pending.expiresAt)
          pending.key.fill(0)
        else this.pending = pending
        this.isConfirmationCancelled = false
      }
      // No broadcast yet: watchers reload on `changed`, and their snapshot
      // would race broker.unlock below for the writer (RVCM1091E: the
      // unlock lost with `busy` and the setup failed silently). The single
      // broadcast in the finally below carries the end state, like every
      // other operation.
    })
    // A Lock during the confirmation never ends unlocked: the vault exists,
    // locked, and the person unlocks it again (RVCM1091A2 P2).
    this.assertSameLock(generation)
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
    await this.serialize(async (generation) => {
      await this.recoverNow(code, generation)
    })
  }
  subscribe(listener: (event: VaultBrokerEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
