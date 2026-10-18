import {
  type VaultStorePort,
  type VaultSlotRecord,
  type VaultGrant,
  type VaultRequester,
  type VaultUse,
  type VaultClockPort,
  type VaultApprovalRequest,
  type VaultAuditRecord,
  type VaultItem,
  type VaultItemMetadata,
} from '../../../shared/vault'
import {
  type vaultPrivateReadSchema,
  type VaultAuthenticatedPeer,
  type VaultBrokerResponse,
  type VaultBrokerSnapshot,
  type VaultBrokerEvent,
  type VaultResetChallenge,
} from '../../../shared/vaultProtocol'
import { type VaultCeiling } from './policy'
import { type Duplex } from 'node:stream'

export interface VaultSecuredListenerPort {
  /** P creates an owner-only, remote-refusing pipe before handing over any accepted socket. */
  listen(path: string, accepted: (socket: Duplex) => void): Promise<() => Promise<void>>
}

/** C binds open and these transactions to its single-writer/generation mechanism. */
export interface VaultBrokerRepository {
  open(key: Uint8Array): Promise<VaultStorePort>
  grants(): Promise<readonly VaultGrant[]>
  /** The single writer calls authorize after its awaits, immediately before its commit. */
  saveGrant(grant: VaultGrant, authorize: () => void): Promise<void>
  removeGrant(id: string): Promise<void>
  /** Atomic across brokers; returns false without spending when exhausted/revoked. */
  consumeGrant(id: string, now: number): Promise<boolean>
  /** C broadcasts committed revocation/policy changes to every broker version. */
  subscribe(listener: (change: { kind: 'item' | 'grant'; id: string }) => void): () => void
}
export interface VaultUnlockPort {
  unlock(slotId: string | null): Promise<{ key: Uint8Array; slot: VaultSlotRecord }>
  /** P checks fresh OS presence over this challenge and exact use, with no caller cache. */
  presence(
    itemId: string,
    challenge: string,
    use: VaultUse | ReturnType<typeof vaultPrivateReadSchema.parse>,
  ): Promise<boolean>
  onScreenLock(listener: () => void): () => void
}
export interface VaultEpochPort {
  current(): Promise<number>
  /** Commit only while the caller still owns this lock generation. */
  bump(authorize?: () => void): Promise<number>
  subscribe(listener: (epoch: number) => void): () => void
}
export interface VaultAuditWriter {
  /** Checked synchronously at the physical commit, after all scrubbing and queue waits. */
  append(
    record: Omit<VaultAuditRecord, 'v' | 'id' | 'generation' | 'previousHash' | 'hash' | 'mac'>,
    canCommit?: () => boolean,
  ): Promise<void>
  read(): Promise<readonly VaultAuditRecord[]>
  close(): void
}
export interface VaultAuditPort {
  /** Each acquisition returns an isolated writer; closing it cannot close a newer writer. */
  openWriter(key: Uint8Array): Promise<VaultAuditWriter>
  open(key: Uint8Array): Promise<void>
  append(
    record: Omit<VaultAuditRecord, 'v' | 'id' | 'generation' | 'previousHash' | 'hash' | 'mac'>,
  ): Promise<void>
  read(): Promise<readonly VaultAuditRecord[]>
  close(): void
}
export interface VaultRequesterRegistration {
  requester: VaultRequester
  ceiling: VaultCeiling
}
/** Only the trusted launcher supplies peer/start identity and registration facts. */
export interface VaultIdentityPort {
  verifyHost(peer: VaultAuthenticatedPeer): Promise<boolean>
  verifyLaunched(
    peer: VaultAuthenticatedPeer,
    registration: VaultRequesterRegistration,
  ): Promise<boolean>
}
export interface VaultUseLifetime {
  close(): void
  /** S terminates a process pinned to its observed pid/start identity; false means unrecallable. */
  terminate(): Promise<boolean>
}
export interface VaultBrokerDeps {
  clock: VaultClockPort
  repository: VaultBrokerRepository
  unlock: VaultUnlockPort
  epoch: VaultEpochPort
  audit: VaultAuditPort
  identity: VaultIdentityPort
  idleMs: number
  lockOnScreenLock: boolean
  firstPartyOnly: boolean
  onApproval(request: VaultApprovalRequest): void
  onLocked(epoch: number): void
  /** Trusted host surfaces audit settlement failure without forwarding exception text. */
  onAuditFailure(): void
  onRevoked(requesterId: string, grantId: string | null): void
  /** T binds the real scrub service; every persisted target passes through it. */
  scrub(text: string): Promise<string>
}

/**
 * The OS credential store (Secret Service, Keychain, Credential Manager or
 * DPAPI) cannot be used here. Slots and the anchor throw it with no native
 * text; every surface shows its fixed, localized repair (RVCM1091B 4).
 */
export class VaultStoreUnavailableError extends Error {
  constructor() {
    super('storeUnavailable')
    this.name = 'VaultStoreUnavailableError'
  }
}
/** Value-free: the receipt for Keep/Delete and the imported items' metadata. */
export interface VaultImportReport {
  receipt: string
  items: readonly VaultItemMetadata[]
}
/** Why a v2 management call was refused; the channel answers `refused` with it. */
export type VaultManagementRefusal = Extract<
  VaultBrokerResponse['response'],
  { kind: 'refused' }
>['reason']
export class VaultManagementError extends Error {
  constructor(readonly reason: VaultManagementRefusal) {
    super(reason)
    this.name = 'VaultManagementError'
  }
}
/**
 * Protocol v2's management side (lead decision 2026-10-10), served only on
 * manage connections. The broker process binds it to the store, the slots and
 * the setup flow; values arrive and leave only through private frames.
 */
export interface VaultManagementPort {
  snapshot(): Promise<VaultBrokerSnapshot>
  /** Takes ownership of the item's material and erases it, committed or not. */
  add(item: VaultItem): Promise<void>
  edit(item: VaultItem): Promise<void>
  editMetadata(metadata: VaultItemMetadata): Promise<void>
  remove(itemId: string): Promise<void>
  /**
   * Imports one discovered credential file as a single all-or-none batch.
   * `isCurrent` is false once the requester cancelled (its connection
   * closed); it is checked at the commit, so a cancelled import writes nothing.
   */
  importFile(path: string, isCurrent: () => boolean): Promise<VaultImportReport>
  keepImport(receipt: string): Promise<void>
  deleteImport(receipt: string, isCurrent: () => boolean): Promise<void>
  /** Reset Vault step 1: only when the anchored vault is lost. */
  resetBegin(): Promise<VaultResetChallenge>
  /** Step 2: the typed word; writes the audit line, removes the files, clears the anchor. */
  resetConfirm(resetId: string, word: string): Promise<void>
  publicKey(itemId: string): Promise<string>
  /** Generates the vault key and recovery code; nothing is written until confirmSetup. */
  setup(): Promise<{ setupId: string; code: Buffer }>
  confirmSetup(setupId: string): Promise<void>
  cancelSetup(setupId: string): Promise<void>
  /** Unlocks through the recovery slot; the caller erases `code` afterwards. */
  recover(code: Uint8Array): Promise<void>
  /** Lock, revoke, approval and committed-change events for `watch` connections. */
  subscribe(listener: (event: VaultBrokerEvent) => void): () => void
}

export interface VaultConnectionIdentity {
  peer: VaultAuthenticatedPeer
  requester: VaultRequester | null
  firstParty: boolean
  manage: boolean
}
