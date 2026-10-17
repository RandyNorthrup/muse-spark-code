import * as z from 'zod/mini'
import { UI_TEXT, VAULT_LIMITS } from '../../../shared/constants'
import { type VaultItem, type VaultStorePort } from '../../../shared/vault'
import { type vaultPrivateReadSchema } from '../../../shared/vaultProtocol'

const release = z.number().check(z.int(), z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER))
export const migrationRecordSchema = z
  .strictObject({
    key: z.string().check(z.minLength(1), z.maxLength(VAULT_LIMITS.text)),
    sourceId: z.string().check(z.minLength(1), z.maxLength(VAULT_LIMITS.text)),
    itemId: z.string().check(z.regex(/^[a-f0-9]{32}$/u)),
    // A trusted release-history ordinal; patches do not advance it.
    startedRelease: release,
    retainLegacy: z.boolean(),
    phase: z.enum(['copying', 'active', 'writing', 'deleting', 'deleted', 'undone', 'retired']),
    digest: z.nullable(z.string().check(z.regex(/^[a-f0-9]{64}$/u))),
    previous: z.optional(
      z.strictObject({
        phase: z.enum(['active', 'retired']),
        digest: z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
      }),
    ),
    retirementNoticePending: z.optional(z.boolean()),
  })
  .check(
    z.refine((row) => (row.phase === 'deleted') === (row.digest === null)),
    z.refine((row) => row.phase !== 'retired' || !row.retainLegacy),
    z.refine((row) => row.previous === undefined || row.phase === 'writing'),
  )
export type MigrationRecord = z.infer<typeof migrationRecordSchema>

/** Values returned by read/encode and items returned by decode belong to the caller. */
export interface LegacyCredentialPort {
  read(key: string): Promise<Uint8Array | null>
  write(key: string, value: Uint8Array, authorize: () => void): Promise<void>
  remove(key: string, authorize: () => void): Promise<void>
}
export interface MigrationCredential {
  readonly key: string
  readonly itemId: string
  decode(value: Uint8Array): VaultItem
  encode(item: VaultItem): Uint8Array
  /** Null for records whose owner's API consumes structured material rather than a key. */
  readonly request: ReturnType<typeof vaultPrivateReadSchema.parse> | null
}
export interface MigrationLease {
  /** C/B bind this to the writer generation and lock epoch, including at physical commits. */
  assertCurrent(): void
}
export interface MigrationOwnerPort {
  /** One serialized owner across windows/editors, held until work and its cleanup finish. */
  run<T>(work: (lease: MigrationLease) => Promise<T>): Promise<T>
}
export interface MigrationJournalPort {
  /** Stable legacy installation/profile or native service/account identity; C scopes this journal to it. */
  readonly sourceId: string
  /** C stores this in the encrypted index/internal records, never plaintext global state. */
  read(key: string): Promise<unknown>
  write(record: MigrationRecord, authorize: () => void): Promise<void>
}
export interface MigrationVaultPort extends Pick<VaultStorePort, 'list' | 'read'> {
  /** C calls authorize synchronously immediately before its atomic commit. */
  write(item: VaultItem, authorize: () => void): Promise<void>
  remove(id: string, authorize: () => void): Promise<void>
}
export interface MigrationDeps {
  vault: MigrationVaultPort
  legacy: LegacyCredentialPort
  journal: MigrationJournalPort
  owner: MigrationOwnerPort
  minorRelease(): number
  /** W routes this value-free notice to the existing translated migration surface. */
  onRetired(key: string): void
}

/** Never forward a store/codec exception that could contain credential bytes. */
export class VaultMigrationFault extends Error {
  constructor(readonly code: 'invalid' | 'conflict' | 'verification' | 'window' | 'storage') {
    super(UI_TEXT.vault.noAccess)
    this.name = 'VaultMigrationFault'
  }
}
