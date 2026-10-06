import {
  type VaultStorePort,
  type VaultSlotRecord,
  type VaultGrant,
  type VaultRequester,
  type VaultUse,
  type VaultClockPort,
  type VaultApprovalRequest,
  type VaultAuditRecord,
} from '../../../shared/vault'
import { type VaultAuthenticatedPeer } from '../../../shared/vaultProtocol'
import { type VaultCeiling } from './policy'

/** C binds open and these transactions to its single-writer/generation mechanism. */
export interface VaultBrokerRepository {
  open(key: Uint8Array): Promise<VaultStorePort>
  grants(): Promise<readonly VaultGrant[]>
  saveGrant(grant: VaultGrant): Promise<void>
  removeGrant(id: string): Promise<void>
  /** Atomic across brokers; returns false without spending when exhausted/revoked. */
  consumeGrant(id: string, now: number): Promise<boolean>
}
export interface VaultUnlockPort {
  unlock(slotId: string | null): Promise<{ key: Uint8Array; slot: VaultSlotRecord }>
  /** P checks fresh OS presence over this challenge and exact use, with no caller cache. */
  presence(itemId: string, challenge: string, use: VaultUse): Promise<boolean>
  onScreenLock(listener: () => void): () => void
}
export interface VaultEpochPort {
  current(): Promise<number>
  bump(): Promise<number>
  subscribe(listener: (epoch: number) => void): () => void
}
export interface VaultAuditPort {
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
  onRevoked(requesterId: string, grantId: string | null): void
  /** T binds the real scrub service; every persisted target passes through it. */
  scrub(text: string): Promise<string>
}
