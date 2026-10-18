// The extension's own key-store migration to the vault client (PLAN.md D89.14,
// lane M). Reads always stay on SecretStorage — a person who never enables
// the vault keeps working exactly as now, and activation never reads the
// vault or starts a broker. After the vault unlocks, every stored key is
// copied, decrypted back and compared by SHA-256 (the engine verifies), the
// old entry stays in place and mirrored, and a half-migrated store recovers
// on the next unlock through the engine's journal. Only apiKey-shaped
// records migrate here: opaque records (oauth, subscription) become `secret`
// items whose material the channel's private path never serves, so their
// copy/verify/retain binding waits on the in-broker lane; they stay in
// SecretStorage, working, with the reason logged. Retire and undo ride the
// engine once their surface lands and are not triggered here.
import { createHash } from 'node:crypto'
import { VaultMigration } from '../../core/vault/migrate/migrate'
import { modelApiMigrationCredential } from '../../core/vault/migrate/modelApi'
import { providerCredentialMigrationCredential } from '../../core/vault/migrate/providerCredentials'
import {
  type MigrationCredential,
  type MigrationDeps,
  type MigrationLease,
  type MigrationOwnerPort,
  type MigrationRecord,
  type MigrationVaultPort,
  VaultMigrationFault,
  migrationRecordSchema,
} from '../../core/vault/migrate/ports'
import { eraseItem, validateMigrationItem } from '../../core/vault/migrate/material'
import { type VaultItem, type VaultItemMetadata } from '../../shared/vault'
import { VAULT_KEY_BYTES, VAULT_PROTOCOL_VERSION, SECRET_KEYS } from '../../shared/constants'
import { vaultPrivateReadSchema } from '../../shared/vaultProtocol'
import { providerSecretKey } from '../providers/credentialRecords'
import { secretStorageLegacyPort } from './migrateSecretStorage'
import type { SecretStore } from '../auth/credentialStore'
import type { Logger } from '../logger'
import type { MigrationMirror } from './migrationShell'

/** The ChatGPT subscription record owns its codec in its own lane; never taken here. */
const CHATGPT_PROVIDER_ID = 'chatgpt'
/**
 * Never dereferenced or fetched: the private channel compares it for
 * equality only, binding journal rows the way a provider origin binds a key.
 */
const JOURNAL_ORIGIN = 'https://vault.internal'
const JOURNAL_NAME_HASH_CHARS = 24
/** Stable legacy-source identity for the journal rows (one SecretStorage per user). */
const JOURNAL_SOURCE_ID = 'vscode-secret-storage'

/** Every SecretStorage key this migration can take, in a fixed order. */
export function listMigrationKeys(providerIds: readonly string[]): string[] {
  const keys: string[] = [SECRET_KEYS.modelApiKey]
  for (const id of providerIds) {
    if (id === CHATGPT_PROVIDER_ID) continue
    const key = providerSecretKey(id)
    if (!keys.includes(key)) keys.push(key)
  }
  return keys
}

/** The codecs for exactly those keys; the model API key's shape is already merged. */
export function buildMigrationCredentials(
  providerIds: readonly string[],
  now: () => number,
): MigrationCredential[] {
  const credentials = [modelApiMigrationCredential(now)]
  for (const id of providerIds) {
    if (id === CHATGPT_PROVIDER_ID) continue
    credentials.push(providerCredentialMigrationCredential(id, now))
  }
  return credentials
}

function journalItemId(key: string): string {
  return createHash('sha256')
    .update(`vault-migration-journal:${key}`)
    .digest('hex')
    .slice(0, VAULT_KEY_BYTES)
}

function journalName(key: string): string {
  // The handle allows lowercase alphanumerics and dashes only; the hash
  // carries the identity, so the name stays valid for every legacy key.
  return `migration-${createHash('sha256').update(key).digest('hex').slice(0, JOURNAL_NAME_HASH_CHARS)}`
}

function journalRequest(itemId: string): ReturnType<typeof vaultPrivateReadSchema.parse> {
  return vaultPrivateReadSchema.parse({
    v: VAULT_PROTOCOL_VERSION,
    kind: 'firstPartyRead',
    itemId,
    origin: JOURNAL_ORIGIN,
    client: 'model',
  })
}

/** The model API item's material auth, recovered exactly for digest equality. */
function modelApiItemId(): string {
  return createHash('sha256')
    .update(SECRET_KEYS.modelApiKey)
    .digest('hex')
    .slice(0, VAULT_KEY_BYTES)
}

/** The broker session the lazy binding owns, and its first-party reader. */
export interface CredentialMigrationPorts {
  snapshot(): Promise<{ items: readonly VaultItemMetadata[] }>
  write(item: VaultItem, isEdit: boolean, authorize?: () => void): Promise<void>
  remove(itemId: string, authorize?: () => void): Promise<void>
  firstPartyRead(request: ReturnType<typeof vaultPrivateReadSchema.parse>): Promise<Buffer>
}

export interface CredentialMigrationDeps {
  /** The raw SecretStorage; the mirroring shell wraps it separately. */
  readonly secrets: SecretStore
  /** Configured provider ids (the seam's store list); chatgpt is excluded. */
  readonly listProviderIds: () => Promise<readonly string[]>
  readonly ports: CredentialMigrationPorts
  /** The installed release's minor ordinal; patches do not advance it. */
  readonly minorRelease: () => number
  readonly now: () => number
  readonly log: Logger
  /** The journal rows' label, read from the installed table by the caller. */
  readonly label: string
}

function journalItem(key: string, record: MigrationRecord, now: number, label: string): VaultItem {
  const value = Buffer.from(JSON.stringify(record), 'utf8')
  const name = journalName(key)
  return {
    metadata: {
      id: journalItemId(key),
      name,
      handle: `secret://${name}`,
      // Hidden first-party rows never reach the panel (the view filters
      // them) and the `never` policy refuses every agent use; the private
      // channel is their only reader.
      label,
      kind: 'apiKey',
      bindings: [{ kind: 'origin', origin: JOURNAL_ORIGIN }],
      requirePresence: false,
      hidden: true,
      firstParty: true,
      policy: { mode: 'never', unattendedAllowed: false, allowDisclosure: false },
      dates: { createdAt: now, rotatedAt: null, expiresAt: null, lastUsedAt: null },
      publicKey: null,
      fingerprint: null,
    },
    material: { kind: 'apiKey', value, auth: 'bearer', origin: JOURNAL_ORIGIN },
  }
}

/**
 * The owner the host binds. Work runs directly — no cross-window lock —
 * and an op a newer op overtook aborts at its next checkpoint instead of
 * committing over it. That stays safe because every engine op is
 * self-verifying: a persist writes the journal, commits the vault item,
 * then decrypts the committed bytes back and compares digests before it
 * records anything, so overlapping runs converge on the last verified
 * value and the aborted one retries at the next unlock. The broker's
 * serialized writer below still commits one write at a time.
 */
function hostMigrationOwner(): MigrationOwnerPort {
  let inFlight = 0
  return {
    async run<T>(work: (lease: MigrationLease) => Promise<T>): Promise<T> {
      inFlight += 1
      const held = inFlight
      try {
        return await work({
          assertCurrent: () => {
            if (held !== inFlight) throw new VaultMigrationFault('window')
          },
        })
      } catch (error: unknown) {
        if (error instanceof VaultMigrationFault) throw error
        throw new VaultMigrationFault('storage')
      } finally {
        inFlight -= 1
      }
    },
  }
}

export class CredentialMigrationController implements MigrationMirror {
  private readonly owner = hostMigrationOwner()
  private readonly skippedOpaque = new Set<string>()
  constructor(private readonly deps: CredentialMigrationDeps) {}

  private journal(now: number) {
    const ports = this.deps.ports
    const label = this.deps.label
    return {
      sourceId: JOURNAL_SOURCE_ID,
      async read(key: string): Promise<unknown> {
        const snapshot = await ports.snapshot()
        const meta = snapshot.items.find((entry) => entry.id === journalItemId(key))
        if (meta === undefined) return null
        const bytes = await ports.firstPartyRead(journalRequest(meta.id))
        try {
          return JSON.parse(bytes.toString('utf8')) as unknown
        } finally {
          bytes.fill(0)
        }
      },
      async write(record: MigrationRecord, authorize: () => void): Promise<void> {
        const parsed = migrationRecordSchema.parse(record)
        const snapshot = await ports.snapshot()
        const isEdit = snapshot.items.some((entry) => entry.id === journalItemId(parsed.key))
        await ports.write(journalItem(parsed.key, parsed, now, label), isEdit, authorize)
      },
    }
  }

  private vaultPorts(credentials: readonly MigrationCredential[]): MigrationVaultPort {
    const ports = this.deps.ports
    const byId = new Map(credentials.map((entry) => [entry.itemId, entry]))
    const apiKeyId = modelApiItemId()
    return {
      async list(): Promise<readonly VaultItemMetadata[]> {
        const snapshot = await ports.snapshot()
        return snapshot.items
      },
      async read(id: string): Promise<VaultItem> {
        const snapshot = await ports.snapshot()
        const meta = snapshot.items.find((entry) => entry.id === id)
        const [binding] = meta?.bindings ?? []
        // Only first-party apiKey rows are servable here; anything else is
        // refused before the channel can misreport it.
        if (
          meta?.kind !== 'apiKey' ||
          meta.bindings.length !== 1 ||
          binding?.kind !== 'origin' ||
          !byId.has(id)
        )
          throw new VaultMigrationFault('invalid')
        const request = vaultPrivateReadSchema.parse({
          v: VAULT_PROTOCOL_VERSION,
          kind: 'firstPartyRead',
          itemId: id,
          origin: binding.origin,
          client: 'model',
        })
        const received = await ports.firstPartyRead(request)
        // The material owns ArrayBuffer bytes; the channel buffer is erased.
        const value = Buffer.alloc(received.byteLength)
        value.set(received)
        received.fill(0)
        try {
          const item: VaultItem = {
            metadata: meta,
            // The digest covers the auth: the model API key's is `bearer`,
            // every provider codec's is `apiKey`, exactly as decoded.
            material: {
              kind: 'apiKey',
              value,
              auth: id === apiKeyId ? 'bearer' : 'apiKey',
              origin: binding.origin,
            },
          }
          validateMigrationItem(item, id)
          // Valid: the engine erases the material when it is done with it.
          return item
        } catch (error: unknown) {
          value.fill(0)
          throw error
        }
      },
      async write(item: VaultItem, authorize: () => void): Promise<void> {
        const snapshot = await ports.snapshot()
        const isEdit = snapshot.items.some((entry) => entry.id === item.metadata.id)
        await ports.write(item, isEdit, authorize)
      },
      async remove(id: string, authorize: () => void): Promise<void> {
        await ports.remove(id, authorize)
      },
    }
  }

  private async engine(): Promise<{
    migration: VaultMigration
    credentials: MigrationCredential[]
    providerIds: readonly string[]
  }> {
    // The model API key needs no provider list; a seam that cannot be read
    // narrows the run to it instead of stopping it, and says so once.
    let providerIds: readonly string[]
    try {
      providerIds = await this.deps.listProviderIds()
    } catch {
      this.deps.log.warn(
        'Credential migration could not list providers; migrating the model API key only',
      )
      providerIds = []
    }
    const credentials = buildMigrationCredentials(providerIds, this.deps.now)
    const now = this.deps.now()
    const deps: MigrationDeps = {
      vault: this.vaultPorts(credentials),
      legacy: secretStorageLegacyPort(
        this.deps.secrets,
        credentials.map((entry) => entry.key),
      ),
      journal: this.journal(now),
      owner: this.owner,
      minorRelease: this.deps.minorRelease,
      // Retire never runs in this slice, so this fires only for an
      // interrupted retire the engine finishes on its own: name the key,
      // never a value.
      onRetired: (key) => {
        this.deps.log.info(`Credential migration retired the legacy entry for ${key}`)
      },
    }
    return { migration: new VaultMigration(deps, credentials), credentials, providerIds }
  }

  /** Whether the stored record already decodes to an apiKey row. */
  private async isApiKeyRecord(
    key: string,
    credentials: readonly MigrationCredential[],
  ): Promise<boolean> {
    const entry = credentials.find((candidate) => candidate.key === key)
    if (entry === undefined) return false
    let bytes: Uint8Array | null = null
    let decoded: VaultItem | undefined
    try {
      const value = await this.deps.secrets.get(key)
      if (value === undefined) return true
      bytes = Buffer.from(value, 'utf8')
      decoded = entry.decode(bytes)
      return decoded.material.kind === 'apiKey'
    } catch {
      // A damaged record stays the engine's to report; never skip it here.
      return true
    } finally {
      eraseItem(decoded)
      bytes?.fill(0)
    }
  }

  /**
   * Copy every stored key (idempotent; safe to run on every unlock). Never
   * throws: a key that cannot migrate stays in SecretStorage, working, with
   * the reason logged.
   */
  /** SecretStorage is the read source of truth: the vault adopts its value. */
  private async healDiverged(migration: VaultMigration, key: string): Promise<void> {
    const value = await this.deps.secrets.get(key)
    if (value === undefined) {
      this.deps.log.warn(
        `Credential migration found ${key} deleted behind the vault; its vault copy waits for an answer`,
      )
      return
    }
    const bytes = Buffer.from(value, 'utf8')
    try {
      await migration.store(key, bytes)
    } finally {
      bytes.fill(0)
    }
  }

  async ensureMigrated(): Promise<void> {
    let engine: {
      migration: VaultMigration
      credentials: MigrationCredential[]
      providerIds: readonly string[]
    }
    try {
      engine = await this.engine()
    } catch (error: unknown) {
      this.deps.log.warn(`Credential migration unavailable: ${describeFault(error)}`)
      return
    }
    const { migration, credentials, providerIds } = engine
    const keys = listMigrationKeys(providerIds)
    for (const key of keys) {
      try {
        if (!(await this.isApiKeyRecord(key, credentials))) {
          if (!this.skippedOpaque.has(key)) {
            this.skippedOpaque.add(key)
            this.deps.log.info(
              `Credential migration leaves ${key} in SecretStorage: opaque records migrate with the in-broker binding`,
            )
          }
          continue
        }
        await migration.resume(key)
        const outcome = await migration.migrate(key)
        if (outcome === 'diverged') await this.healDiverged(migration, key)
        else if (outcome === 'legacyDeleted')
          this.deps.log.warn(
            `Credential migration found ${key} deleted behind the vault; its vault copy waits for an answer`,
          )
      } catch (error: unknown) {
        this.deps.log.warn(`Credential migration paused for ${key}: ${describeFault(error)}`)
      }
    }
  }

  async mirrorWrite(key: string, value: string): Promise<void> {
    const { migration, providerIds } = await this.engine()
    if (!listMigrationKeys(providerIds).includes(key)) return
    const bytes = Buffer.from(value, 'utf8')
    try {
      if ((await migration.resolve(key)) === null) {
        await migration.migrate(key)
        return
      }
      await migration.store(key, bytes)
    } finally {
      bytes.fill(0)
    }
  }

  async mirrorDelete(key: string): Promise<void> {
    const { migration, providerIds } = await this.engine()
    if (!listMigrationKeys(providerIds).includes(key)) return
    // The person's own removal: both copies go. The engine still refuses a
    // mid-state delete with a conflict instead of destroying half a slot.
    await migration.delete(key, { destroyLastCopyConfirmed: true, legacyDeletionConfirmed: true })
  }
}

function describeFault(error: unknown): string {
  if (error instanceof VaultMigrationFault) return error.code
  return error instanceof Error ? error.message : 'unavailable'
}
