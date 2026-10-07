import { type VaultItemMetadata, type VaultUse, type VaultTicket } from '../../../shared/vault'
import { type VaultUseLifetime } from '../broker/ports'
import { type SshKnownHostsPort } from './knownHosts'

export interface SshIdentity {
  item: VaultItemMetadata
  blob: Buffer
  source: 'vault' | 'external'
}
/** P owns hardware key creation/storage and fresh presence. Raw private material never crosses it. */
export interface SshHardwarePort {
  destroy(keyReference: string): Promise<void>
  generate(signal: AbortSignal): Promise<{ keyReference: string; publicBlob: Buffer }>
  /** Returns an RFC 5656 SSH signature, checked against the public key by S. */
  sign(keyReference: string, data: Buffer, signal: AbortSignal): Promise<Buffer>
}
export interface SshExternalAgentPort {
  /** M/B supply persistent, user-reviewed metadata/grants for these public identities. */
  identities(signal: AbortSignal): Promise<readonly SshIdentity[]>
  sign(
    blob: Buffer,
    data: Buffer,
    flags: number,
    signal: AbortSignal,
    bindings: readonly Buffer[],
  ): Promise<Buffer>
}
export interface SshAccessPort {
  identities(signal: AbortSignal): Promise<readonly SshIdentity[]>
  /** B binds requester incarnation, taint, exact use, presence, policy and single-use ticket. */
  authorize(identity: SshIdentity, use: VaultUse, signal: AbortSignal): Promise<VaultTicket>
  /** Release is synchronous, after rechecking this connection's generation. */
  sign(
    identity: SshIdentity,
    ticket: VaultTicket,
    use: VaultUse,
    data: Buffer,
    flags: number,
    lifetime: VaultUseLifetime,
    signal: AbortSignal,
    release: (signature: Buffer) => void,
    bindings: readonly Buffer[],
  ): Promise<void>
  subscribeInvalidation(close: () => void): () => void
}
export interface SshSessionDeps {
  access: SshAccessPort
  knownHosts: SshKnownHostsPort
  /** Only a trusted launcher may provide this; needed for hashed entries and ambiguous aliases. */
  destination?: string
  send(bytes: Buffer): void
  close(): void
  terminate(): Promise<boolean>
}
