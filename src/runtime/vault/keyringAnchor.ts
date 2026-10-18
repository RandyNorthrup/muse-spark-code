// The vault's rollback anchor (lead decision 3, 2026-10-10): one protected
// record in the OS store through @napi-rs/keyring, outside the replaceable
// vault files. It names the vault this user owns and its committed state, so
// an older or foreign vault file is refused. The same-user rewrite residual is
// D89.15's. Every advance runs under the vault's cross-process writer lock
// (VaultStore publishes only inside withWriter). A live writer cannot be
// taken over; every dispatched OS-store mutation settles before release.
// The OS store itself has no atomic compare-and-set or recipient fence.

import * as z from 'zod/mini'
import { KEYRING_SERVICE, VAULT_LIMITS } from '../../shared/constants'
import { VaultError } from '../../core/vault/crypto'
import {
  type VaultGenerationPort,
  type VaultGenerationState,
  type VaultWriterCheck,
} from '../../core/vault/store'
import { VaultStoreUnavailableError } from '../../core/vault/broker/ports'
import { storeOperation, type KeyringEntryFactory } from '../keyStore'

/** The OS-store account of the anchor record (service: KEYRING_SERVICE). */
export const VAULT_ANCHOR_ACCOUNT = 'vault-anchor-v1'

const counter = z.number().check(z.int(), z.nonnegative(), z.refine(Number.isSafeInteger))
const digest = z.string().check(z.regex(/^[a-f0-9]{64}$/u))
const recordSchema = z.strictObject({
  v: z.literal(1),
  vaultId: z.string().check(z.regex(/^[a-f0-9]{32}$/u)),
  generation: counter,
  auditGeneration: counter,
  auditHead: digest,
  stateDigest: digest,
})
type AnchorRecord = z.infer<typeof recordSchema>

function stateOf(record: AnchorRecord): VaultGenerationState {
  return {
    generation: record.generation,
    auditGeneration: record.auditGeneration,
    auditHead: record.auditHead,
    stateDigest: record.stateDigest,
  }
}
function isSame(left: VaultGenerationState | null, right: VaultGenerationState | null): boolean {
  return left === null || right === null
    ? left === right
    : left.generation === right.generation &&
        left.auditGeneration === right.auditGeneration &&
        left.auditHead === right.auditHead &&
        left.stateDigest === right.stateDigest
}

export class KeyringVaultAnchor implements VaultGenerationPort {
  constructor(private readonly openEntry: KeyringEntryFactory) {}

  private async read(): Promise<AnchorRecord | null> {
    let raw: string | null | undefined
    try {
      raw = await storeOperation(() =>
        this.openEntry(KEYRING_SERVICE, VAULT_ANCHOR_ACCOUNT).getPassword(),
      )
    } catch {
      // No native text: the fixed, localized repair reaches the person (RVCM1091B 4).
      throw new VaultStoreUnavailableError()
    }
    if (raw === null || raw === undefined) return null
    if (raw.length > VAULT_LIMITS.text) throw new VaultError('rollback')
    try {
      return recordSchema.parse(JSON.parse(raw))
    } catch {
      // A damaged anchor proves nothing; it never reads as "no history".
      throw new VaultError('rollback')
    }
  }

  private async resetState(
    vaultId: string,
    expected: VaultGenerationState | null,
    authorize: VaultWriterCheck,
  ): Promise<void> {
    const record = await this.read()
    authorize()
    if (record?.vaultId !== vaultId || !isSame(stateOf(record), expected))
      throw new VaultError('rollback')
    // No await between authority and dispatch to the OS store. storeOperation
    // scrubs native failures, so cancellation must be checked outside it.
    authorize()
    try {
      await storeOperation(() =>
        this.openEntry(KEYRING_SERVICE, VAULT_ANCHOR_ACCOUNT).deletePassword(),
      )
    } catch {
      throw new VaultStoreUnavailableError()
    }
  }
  private async advanceState(
    vaultId: string,
    state: VaultGenerationState,
    prior: VaultGenerationState | null,
    assertHeld?: VaultWriterCheck,
  ): Promise<void> {
    const record = await this.read()
    if (record !== null && record.vaultId !== vaultId) throw new VaultError('rollback')
    const current = record === null ? null : stateOf(record)
    if (
      !isSame(current, prior) ||
      (current !== null &&
        (state.generation <= current.generation || state.auditGeneration < current.auditGeneration))
    )
      throw new VaultError('rollback')
    const next = recordSchema.parse({ v: 1, vaultId, ...state })
    assertHeld?.()
    try {
      await storeOperation(() =>
        this.openEntry(KEYRING_SERVICE, VAULT_ANCHOR_ACCOUNT).setPassword(JSON.stringify(next)),
      )
    } catch {
      // No native text: the fixed, localized repair reaches the person (RVCM1091B 4).
      throw new VaultStoreUnavailableError()
    }
  }
  /** The vault this user owns, or null before setup. */
  async vaultId(): Promise<string | null> {
    const record = await this.read()
    return record?.vaultId ?? null
  }

  /** Reset Vault: removes exactly this vault's record; another vault's is refused. */
  reset(
    vaultId: string,
    expected: VaultGenerationState | null,
    authorize: VaultWriterCheck,
  ): Promise<void> {
    const work = () => this.resetState(vaultId, expected, authorize)
    return authorize.mutate?.(work) ?? work()
  }
  async minimum(vaultId: string): Promise<VaultGenerationState | null> {
    const record = await this.read()
    if (record === null) return null
    // Another vault's file in this place is a swap, never a fresh device.
    if (record.vaultId !== vaultId) throw new VaultError('rollback')
    return stateOf(record)
  }

  advance(
    vaultId: string,
    state: VaultGenerationState,
    prior: VaultGenerationState | null,
    assertHeld?: VaultWriterCheck,
  ): Promise<void> {
    const work = () => this.advanceState(vaultId, state, prior, assertHeld)
    return assertHeld?.mutate?.(work) ?? work()
  }
}
