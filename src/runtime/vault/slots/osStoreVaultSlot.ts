import * as z from 'zod/mini'
import {
  KEYRING_SERVICE,
  VAULT_FORMAT_VERSION,
  VAULT_KEY_BYTES,
  VAULT_BYTE_MAX,
} from '../../../shared/constants'
import {
  vaultSlotRecordSchema,
  type VaultSlotPort,
  type VaultSlotRecord,
} from '../../../shared/vault'
import { areVaultBytesEqual, ownedBytes, VaultError } from '../../../core/vault/crypto'
import { VaultStoreUnavailableError } from '../../../core/vault/broker/ports'
import { legacyVaultSlotReference, vaultSlotReference } from '../vaultStoreScope'

type SlotContext = Pick<
  VaultSlotRecord,
  'id' | 'vaultId' | 'lastGeneration' | 'auditGeneration' | 'auditHead' | 'createdAt'
>
interface SecretEntry {
  getSecret(): Promise<unknown>
  setSecret(secret: Uint8Array): Promise<void>
  deleteCredential(): Promise<boolean>
}
// Native capture on Kubuntu (2026-10-10): AsyncEntry returns number[], despite its typings.
const secretSchema = z.union([
  z.instanceof(Uint8Array),
  z
    .array(z.number().check(z.int(), z.minimum(0), z.maximum(VAULT_BYTE_MAX)))
    .check(z.maxLength(VAULT_KEY_BYTES)),
])
async function secretBytes(entry: SecretEntry): Promise<Uint8Array | null> {
  const raw = await entry.getSecret()
  if (raw == null) return null
  try {
    const parsed = secretSchema.safeParse(raw)
    if (!parsed.success) throw new VaultError('invalid')
    try {
      if (parsed.data.length !== VAULT_KEY_BYTES) throw new VaultError('invalid')
      const bytes = Buffer.alloc(parsed.data.length)
      bytes.set(parsed.data)
      return bytes
    } finally {
      // zod clones numeric arrays; erase that owned copy as well as the native return below.
      parsed.data.fill(0)
    }
  } finally {
    if (raw instanceof Uint8Array || Array.isArray(raw)) raw.fill(0)
  }
}
type OpenEntry = (service: string, account: string) => SecretEntry

/** Secret Service on Linux and login Keychain on macOS; never a kernel/plain-text fallback. */
export class OsStoreVaultSlot implements VaultSlotPort {
  private readonly record: VaultSlotRecord
  private isWriting = false
  readonly tier = 'osStore'
  constructor(
    context: SlotContext,
    platform: NodeJS.Platform = process.platform,
    private readonly open?: OpenEntry,
    scope?: string,
  ) {
    if (platform !== 'linux' && platform !== 'darwin') throw new VaultError('invalid')
    if (scope === undefined || scope === '') throw new VaultError('invalid')
    const provider = platform === 'linux' ? 'secretService' : 'loginKeychain'
    // Scoped to this root: a vault anywhere else can never name this slot's
    // key. Pre-scoping records keep their own reference and keep opening.
    const reference = vaultSlotReference(scope, context.vaultId, context.id)
    this.record = vaultSlotRecordSchema.parse({
      ...context,
      v: VAULT_FORMAT_VERSION,
      tier: this.tier,
      provider,
      keyReference: reference,
      // This is a reference, never key material. The OS store protects the actual key.
      wrappedKey: Buffer.from(reference, 'ascii').toString('base64'),
      nonce: null,
      tag: null,
      kdf: null,
      backend: null,
    })
  }
  private async operation<T>(
    account: string,
    work: (entry: SecretEntry) => Promise<T>,
  ): Promise<T> {
    try {
      let entry: SecretEntry
      if (this.open) entry = this.open(KEYRING_SERVICE, account)
      else {
        const { AsyncEntry } = await import('@napi-rs/keyring')
        entry = new AsyncEntry(KEYRING_SERVICE, account, { linux: { store: 'secret-service' } })
      }
      return await work(entry)
    } catch (error: unknown) {
      if (error instanceof VaultError) throw error
      // No native text: management, slot unlock and the channel map this to
      // the fixed, localized `storeUnavailable` repair (RVCM1091B 4).
      throw new VaultStoreUnavailableError()
    }
  }
  async wrap(key: Uint8Array): Promise<VaultSlotRecord> {
    if (key.byteLength !== VAULT_KEY_BYTES) throw new VaultError('invalid')
    if (this.isWriting) throw new VaultError('busy')
    const owned = ownedBytes(key)
    this.isWriting = true
    try {
      await this.operation(this.record.keyReference ?? '', async (entry) => {
        const previous = await secretBytes(entry)
        if (previous != null) {
          previous.fill(0)
          throw new VaultError('busy')
        }
        // This fresh reference is owned by this setup. Remove even an uncertain failed write.
        try {
          await entry.setSecret(owned)
          const verified = await secretBytes(entry)
          try {
            if (verified == null || !areVaultBytesEqual(owned, verified)) throw new VaultError('io')
          } finally {
            verified?.fill(0)
          }
        } catch (error: unknown) {
          await entry.deleteCredential()
          throw error
        }
      })
      return structuredClone(this.record)
    } finally {
      this.isWriting = false
      owned.fill(0)
    }
  }
  async unwrap(input: VaultSlotRecord, _use: string): Promise<Uint8Array> {
    const parsed = vaultSlotRecordSchema.safeParse(input)
    if (!parsed.success) throw new VaultError('invalid')
    const slot = parsed.data
    // High-water marks advance without changing the OS entry; all immutable identity stays bound.
    for (const field of [
      'id',
      'vaultId',
      'tier',
      'provider',
      'createdAt',
      'nonce',
      'tag',
      'kdf',
      'backend',
    ] as const)
      if (slot[field] !== this.record[field]) throw new VaultError('invalid')
    // The stored reference names the entry: this root's scoped reference,
    // or the pre-scoping one for records written before scoping. Anything
    // else is refused, and the wrapped pair must describe the entry opened.
    const reference = slot.keyReference
    if (reference === null) throw new VaultError('invalid')
    const legacy = legacyVaultSlotReference(this.record.vaultId, this.record.id)
    const isScoped = reference === this.record.keyReference
    const isLegacy = reference === legacy
    if (!isScoped && !isLegacy) throw new VaultError('invalid')
    if (slot.wrappedKey !== Buffer.from(reference, 'ascii').toString('base64'))
      throw new VaultError('invalid')
    return await this.operation(reference, async (entry) => {
      const key = await secretBytes(entry)
      if (key == null) throw new VaultError('locked')
      return key
    })
  }
  /** Setup cancellation/removal only; the binding serializes it with vault commits. */
  async remove(): Promise<void> {
    if (this.isWriting) throw new VaultError('busy')
    this.isWriting = true
    try {
      const remove = async (entry: SecretEntry): Promise<void> => {
        await entry.deleteCredential()
      }
      await this.operation(this.record.keyReference ?? '', remove)
      await this.operation(legacyVaultSlotReference(this.record.vaultId, this.record.id), remove)
    } finally {
      this.isWriting = false
    }
  }
}
