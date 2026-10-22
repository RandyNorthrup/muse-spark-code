// The vault's rollback anchor (lead decision 3, 2026-10-10): one protected
// record in the OS store through @napi-rs/keyring, outside the replaceable
// vault files. It names the vault this user owns and its committed state, so
// an older or foreign vault file is refused. The same-user rewrite residual is
// D89.15's. Every advance runs under the vault's cross-process writer lock
// (VaultStore publishes only inside withWriter). A live writer cannot be
// taken over; every dispatched OS-store mutation settles before release.
// The OS store itself has no atomic compare-and-set or recipient fence.
//
// The account is scoped to the vault root (RLVAULTANCHOR, 2026-10-21): the
// fixed account per OS user let a vault at any other root read and write the
// person's real anchor. The person's own root keeps its pre-scoping record:
// the startup peek of its files' vault id adopts that record, and writes
// stay on whichever account was read, so existing vaults keep working
// unchanged while a vault anywhere else can never name the shared account.

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
import { VAULT_ANCHOR_ACCOUNT } from './vaultStoreScope'

export { VAULT_ANCHOR_ACCOUNT } from './vaultStoreScope'

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

/** Which store record backs this root: its scoped account, or the adopted pre-scoping one. */
export interface KeyringAnchorScope {
  readonly account: string
  readonly legacyAccount?: string | undefined
}

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
  private readonly account: string
  private readonly legacyAccount: string | undefined
  private filesVaultId: string | null | undefined
  private adoptionResolved = false
  private adopted = false
  constructor(
    private readonly openEntry: KeyringEntryFactory,
    scope?: KeyringAnchorScope,
  ) {
    this.account = scope?.account ?? VAULT_ANCHOR_ACCOUNT
    this.legacyAccount = scope?.legacyAccount
  }

  private async ensureAdopted(scoped: AnchorRecord | null): Promise<void> {
    if (scoped !== null) {
      this.adoptionResolved = true
      return
    }
    if (this.adoptionResolved || this.legacyAccount === undefined) return
    if (this.filesVaultId == null) {
      // A root with no files owns nothing: the shared account is never
      // read for it, damaged or not.
      this.adopted = false
      this.adoptionResolved = true
      return
    }
    const legacy = await this.readAccount(this.legacyAccount)
    this.adopted = legacy?.vaultId === this.filesVaultId
    this.adoptionResolved = true
  }

  private async locate(
    vaultId: string | null,
  ): Promise<{ account: string; record: AnchorRecord | null }> {
    const scoped = await this.readAccount(this.account)
    if (scoped !== null) return { account: this.account, record: scoped }
    await this.ensureAdopted(scoped)
    if (!this.adopted || this.legacyAccount === undefined)
      return { account: this.account, record: null }
    const legacy = await this.readAccount(this.legacyAccount)
    if (legacy === null) return { account: this.account, record: null }
    // Adopted means this root owns the legacy record: anything else naming
    // it is a swap, never a fresh vault.
    if (vaultId !== null && legacy.vaultId !== vaultId) throw new VaultError('rollback')
    return { account: this.legacyAccount, record: legacy }
  }

  private async readAccount(account: string): Promise<AnchorRecord | null> {
    const raw = await this.readRaw(account)
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
    const { account, record } = await this.locate(vaultId)
    authorize()
    if (record?.vaultId !== vaultId || !isSame(stateOf(record), expected))
      throw new VaultError('rollback')
    // No await between authority and dispatch to the store. storeOperation
    // scrubs native failures, so cancellation must be checked outside it.
    authorize()
    await this.deleteRaw(account)
  }
  private async advanceState(
    vaultId: string,
    state: VaultGenerationState,
    prior: VaultGenerationState | null,
    assertHeld?: VaultWriterCheck,
  ): Promise<void> {
    const { account, record } = await this.locate(vaultId)
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
    await this.writeRaw(account, JSON.stringify(next))
  }
  /**
  Binds this root's files' vault id for the pre-scoping record's adoption
  (no store IO): the legacy account is read only for a root with files,
  adopted only when it names this vault, and only while this root has no
  scoped record of its own. A root with no files never touches the shared
  account; a damaged legacy record fails its owning root closed.
  */
  adoptLegacyScope(filesVaultId: string | null): void {
    this.filesVaultId = filesVaultId
    this.adoptionResolved = false
    this.adopted = false
  }

  /** The vault this user owns, or null before setup. */
  async vaultId(): Promise<string | null> {
    const { record } = await this.locate(null)
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
    const { record } = await this.locate(vaultId)
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

  /**
  The one protected record, as text. Overridden by the file anchor, which
  keeps the same record and the same rollback rules without the OS store.
  */
  protected async readRaw(account: string): Promise<string | null | undefined> {
    try {
      return await storeOperation(() => this.openEntry(KEYRING_SERVICE, account).getPassword())
    } catch {
      // No native text: the fixed, localized repair reaches the person (RVCM1091B 4).
      throw new VaultStoreUnavailableError()
    }
  }

  /** The one protected record, replaced whole. See readRaw. */
  protected async writeRaw(account: string, raw: string): Promise<void> {
    try {
      await storeOperation(() => this.openEntry(KEYRING_SERVICE, account).setPassword(raw))
    } catch {
      throw new VaultStoreUnavailableError()
    }
  }

  /** The one protected record, removed. See readRaw. */
  protected async deleteRaw(account: string): Promise<void> {
    try {
      await storeOperation(() => this.openEntry(KEYRING_SERVICE, account).deletePassword())
    } catch {
      throw new VaultStoreUnavailableError()
    }
  }
}
