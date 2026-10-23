// The extension's own key-store migration to the vault client (PLAN.md D89.14,
// lane M). Reads stay on SecretStorage while a legacy copy exists — a person
// who never enables the vault keeps working exactly as now, and activation
// never reads the vault or starts a broker. After the vault unlocks, every
// stored key is copied, decrypted back and compared by SHA-256 (the engine
// verifies), the old entry stays in place and mirrored, and a half-migrated
// store recovers on the next unlock through the engine's journal. Installed
// opaque provider/account records stay whole in hidden, first-party `secret`
// items, read only through the authenticated host's private channel. Past
// the retain window the legacy entry retires and its slot reads
// authoritatively from the vault; undo's engine call awaits its
// person-facing trigger.
import { createHash } from 'node:crypto'
import { VaultMigration } from '../../core/vault/migrate/migrate'
import { accountSecretMigrationCredential } from '../../core/vault/migrate/accountSecrets'
import {
  CHATGPT_SUBSCRIPTION_PROVIDER_ID,
  chatgptSubscriptionMigrationCredential,
} from '../../core/vault/migrate/chatgptSubscription'
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
import { validateMigrationItem } from '../../core/vault/migrate/material'
import { type VaultItem, type VaultItemMetadata } from '../../shared/vault'
import {
  ACCOUNT_DEFAULT_ID,
  VAULT_KEY_BYTES,
  VAULT_PROTOCOL_VERSION,
  SECRET_KEYS,
} from '../../shared/constants'
import { vaultPrivateReadSchema, type VaultBrokerSnapshot } from '../../shared/vaultProtocol'
import { accountSecretKey } from '../../core/providers/accountCredentialRecord'
import { providerSecretKey } from '../providers/credentialRecords'
import { secretStorageLegacyPort } from './migrateSecretStorage'
import type { SecretStore } from '../auth/credentialStore'
import type { Logger } from '../logger'
import { withMigrationLock, type MigrationMirror } from './migrationShell'

/**
The Grok subscription record owns its codec in its own lane
(RLGROKAUTH); never taken here. The ChatGPT slot migrates with its own
opaque codec (RLM109).
*/
const GROK_PROVIDER_ID = 'grok'
/**
Never dereferenced or fetched: the private channel compares it for
equality only, binding journal rows the way a provider origin binds a key.
*/
const JOURNAL_ORIGIN = 'https://vault.internal'
const JOURNAL_NAME_HASH_CHARS = 24
/** Stable legacy-source identity for the journal rows (one SecretStorage per user). */
const JOURNAL_SOURCE_ID = 'vscode-secret-storage'

/**
Every SecretStorage key this migration can take, in a fixed order: the
model API key, one slot per provider, then one segmented slot per pooled
(non-default) account. A default account rides its provider's own slot
(the codec reads the overlaid shape), so it is never listed twice.
*/
export function listMigrationKeys(
  providerIds: readonly string[],
  accounts: ReadonlyMap<string, readonly string[]> = new Map(),
): string[] {
  const keys: string[] = [SECRET_KEYS.modelApiKey]
  for (const id of providerIds) {
    if (id === GROK_PROVIDER_ID) continue
    const key = providerSecretKey(id)
    if (!keys.includes(key)) keys.push(key)
  }
  for (const id of providerIds) {
    const pool = accounts.get(id) ?? []
    for (const account of pool) {
      if (account === ACCOUNT_DEFAULT_ID) continue
      const key = accountSecretKey(id, account)
      if (!keys.includes(key)) keys.push(key)
    }
  }
  return keys
}

/**
The codecs for exactly those keys; the model API key's shape is already
merged. Pooled accounts take the account codec over their segmented slot.
*/
export function buildMigrationCredentials(
  providerIds: readonly string[],
  now: () => number,
  accounts: ReadonlyMap<string, readonly string[]> = new Map(),
): MigrationCredential[] {
  const credentials = [modelApiMigrationCredential(now)]
  for (const id of providerIds) {
    if (id === GROK_PROVIDER_ID) continue
    if (id === CHATGPT_SUBSCRIPTION_PROVIDER_ID) {
      credentials.push(chatgptSubscriptionMigrationCredential(now))
      continue
    }
    credentials.push(providerCredentialMigrationCredential(id, now))
  }
  for (const id of providerIds) {
    const pool = accounts.get(id) ?? []
    for (const account of pool) {
      if (account === ACCOUNT_DEFAULT_ID) continue
      credentials.push(accountSecretMigrationCredential(id, account, now))
    }
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
  snapshot(): Promise<{
    items: readonly VaultItemMetadata[]
    status: VaultBrokerSnapshot['status']
  }>
  write(item: VaultItem, isEdit: boolean, authorize?: () => void): Promise<void>
  remove(itemId: string, authorize?: () => void): Promise<void>
  firstPartyRead(request: ReturnType<typeof vaultPrivateReadSchema.parse>): Promise<Buffer>
}

export interface CredentialMigrationDeps {
  /** The raw SecretStorage; the mirroring shell wraps it separately. */
  readonly secrets: SecretStore
  /** Configured provider ids (the seam's store list). */
  readonly listProviderIds: () => Promise<readonly string[]>
  /**
  Pooled account ids per provider, from the host's account metadata.
  Absent where the host binds no account pool yet: only default slots
  migrate there. A test hands in the runtime's file-backed metadata.
  */
  readonly listAccounts?: (provider: string) => Promise<readonly string[]>
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
The owner every controller shares. Engine ops run one at a time under the
shell's lock — a newer op never overlaps an older one, so an older op can
never commit over it — and each op still carries its lease: an op a newer
op overtook aborts at its next checkpoint instead of committing. That
stays safe because every engine op is self-verifying: a persist writes the
journal, commits the vault item, then decrypts the committed bytes back
and compares digests before it records anything, and a store whose legacy
copy moved underneath it refuses instead of writing the older bytes back.
The generation only ever advances, so a finished op can never look
current to a later check the way a counter that counts back down could.
*/
class SharedMigrationOwner implements MigrationOwnerPort {
  private generation = 0
  async run<T>(work: (lease: MigrationLease) => Promise<T>): Promise<T> {
    return await withMigrationLock(async () => {
      this.generation += 1
      const held = this.generation
      try {
        return await work({
          assertCurrent: () => {
            if (held !== this.generation) throw new VaultMigrationFault('window')
          },
        })
      } catch (error: unknown) {
        if (error instanceof VaultMigrationFault) throw error
        throw new VaultMigrationFault('storage', { cause: error })
      }
    })
  }
}

const sharedMigrationOwner = new SharedMigrationOwner()

export class CredentialMigrationController implements MigrationMirror {
  private readonly owner = sharedMigrationOwner
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
        // The authenticated private route serves only the credential's
        // hidden first-party apiKey or opaque record, bound to its origin.
        if (
          (meta?.kind !== 'apiKey' && meta?.kind !== 'secret') ||
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
            material:
              meta.kind === 'secret'
                ? { kind: 'secret', value }
                : {
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
        const current = snapshot.items.find((entry) => entry.id === item.metadata.id)
        if (current !== undefined && current.kind !== item.metadata.kind) {
          // Ordinary edits cannot change kind. The engine already committed
          // its writing intent and retained the legacy record, so replacing
          // this migration-owned row is recoverable even if Lock lands
          // between removal and publication. Never replace an ordinary item.
          validateMigrationItem(item, item.metadata.id)
          if (!current.firstParty || !current.hidden || current.policy.mode !== 'never')
            throw new VaultMigrationFault('conflict')
          await ports.remove(item.metadata.id, authorize)
          await ports.write(item, false, authorize)
          return
        }
        await ports.write(item, current !== undefined, authorize)
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
    accounts: ReadonlyMap<string, readonly string[]>
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
    // The ChatGPT subscription is a sign-in, not a providers-file row, so
    // the seam never lists it: probe its slot and take it when stored. The
    // probe reads the sealed store for presence only, the way `hasMetaKey`
    // probes do; the value is never kept.
    if (!providerIds.includes(CHATGPT_SUBSCRIPTION_PROVIDER_ID)) {
      const stored = await this.deps.secrets.get(
        providerSecretKey(CHATGPT_SUBSCRIPTION_PROVIDER_ID),
      )
      if (stored !== undefined && stored !== '') {
        providerIds = [...providerIds, CHATGPT_SUBSCRIPTION_PROVIDER_ID]
      }
    }
    // Pooled accounts ride their provider's metadata pool; a pool that
    // cannot be read narrows that provider to its default slot, said once.
    const accounts = new Map<string, readonly string[]>()
    if (this.deps.listAccounts !== undefined) {
      for (const id of providerIds) {
        try {
          accounts.set(id, await this.deps.listAccounts(id))
        } catch {
          this.deps.log.warn(
            `Credential migration could not list accounts for ${id}; migrating its default slot only`,
          )
        }
      }
    }
    const credentials = buildMigrationCredentials(providerIds, this.deps.now, accounts)
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
      // Fires when a slot retires (or an interrupted retire finishes):
      // name the key, never a value.
      onRetired: (key) => {
        this.deps.log.info(`Credential migration retired the legacy entry for ${key}`)
      },
    }
    return {
      migration: new VaultMigration(deps, credentials),
      credentials,
      providerIds,
      accounts,
    }
  }

  /**
  Copy every stored key (idempotent; safe to run on every unlock). Never
  throws: a key that cannot migrate stays in SecretStorage, working, with
  the reason logged.
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
      accounts: ReadonlyMap<string, readonly string[]>
    }
    try {
      engine = await this.engine()
    } catch (error: unknown) {
      const code = error instanceof VaultMigrationFault ? error.code : 'unavailable'
      this.deps.log.warn(`Credential migration unavailable: ${code}`)
      return
    }
    const { migration, providerIds, accounts } = engine
    const keys = listMigrationKeys(providerIds, accounts)
    for (const key of keys) {
      try {
        const phase = await migration.journalPhase(key)
        // A signed-out slot whose journal still says `deleted`: a live
        // SecretStorage value is the sign-in's new key, and the vault copy
        // is gone, so copy it again instead of asking `migrate`, which
        // refuses a `deleted` row and would leave the new key unmigrated
        // forever. An absent value is the signed-out state itself: nothing
        // to do, and nothing worth warning about.
        if (phase === 'deleted') {
          const value = await this.deps.secrets.get(key)
          if (value === undefined) continue
          const bytes = Buffer.from(value, 'utf8')
          try {
            await migration.store(key, bytes)
          } finally {
            bytes.fill(0)
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
        // Retire when due: the engine retires only past the retain
        // window with a verified live copy, and the retired slot keeps
        // reading through the shell's authoritative path above.
        await migration.retire(key)
      } catch (error: unknown) {
        const code = error instanceof VaultMigrationFault ? error.code : 'unavailable'
        this.deps.log.warn(`Credential migration paused for ${key}: ${code}`)
      }
    }
  }

  /**
  Authoritative read for a retired slot: the shell calls this only when
  the legacy copy is absent. Anything but an unlocked vault reads
  absent — locked, uncreated and unavailable vaults prove no value —
  without touching the journal; past that gate the engine decides, and
  damage refuses by throwing, never by silence. A lock landing between
  the gate and the read surfaces as the broker's failure, the same
  transient class as a failing credential store.
  */
  async readRetired(key: string): Promise<string | undefined> {
    const snapshot = await this.deps.ports.snapshot()
    if (snapshot.status.state !== 'unlocked') return undefined
    const { migration, credentials } = await this.engine()
    if (credentials.every((entry) => entry.key !== key)) return undefined
    const bytes = await migration.readRetired(key)
    if (bytes === null) return undefined
    try {
      return new TextDecoder().decode(bytes)
    } finally {
      bytes.fill(0)
    }
  }

  async mirrorWrite(key: string, value: string): Promise<void> {
    const { migration, providerIds, accounts } = await this.engine()
    if (!listMigrationKeys(providerIds, accounts).includes(key)) return
    const bytes = Buffer.from(value, 'utf8')
    try {
      // The journal phase decides, not `resolve`: provider codecs carry no
      // first-party request, so `resolve` is null for them even on an
      // `active` row, and asking `migrate` there would report `diverged`
      // without ever writing the rotated key. A signed-out (`deleted`) row
      // with a live value is re-seeded with `store`, which accepts it.
      const phase = await migration.journalPhase(key)
      if (phase === 'active' || phase === 'retired') {
        await migration.store(key, bytes)
        return
      }
      if (phase === 'deleted') {
        if ((await this.deps.secrets.get(key)) === undefined) return
        await migration.store(key, bytes)
        return
      }
      if ((await migration.resolve(key)) === null) {
        await migration.migrate(key)
        return
      }
      await migration.store(key, bytes)
    } finally {
      bytes.fill(0)
    }
  }

  /**
  Drop a removed key's migrated slot. Resolves true when the engine owned
  the delete: it journals `deleting` before it removes either copy, so a
  failure before that journal write leaves SecretStorage untouched and
  the shell surfaces it instead of resolving a half-finished sign-out. A
  key the migration never took — or whose sign-out already finished —
  resolves false, and the shell clears SecretStorage the plain way. The
  person's own removal takes both copies. The engine still refuses a
  mid-state delete with a conflict instead of destroying half a slot.
  */
  async mirrorDelete(key: string): Promise<boolean> {
    const { migration, providerIds, accounts } = await this.engine()
    if (!listMigrationKeys(providerIds, accounts).includes(key)) return false
    const phase = await migration.journalPhase(key)
    // Never copied, or a finished sign-out: no vault copy to remove, so the
    // shell clears SecretStorage the plain way.
    if (phase === null || phase === 'deleted') return false
    await migration.delete(key, { destroyLastCopyConfirmed: true, legacyDeletionConfirmed: true })
    return true
  }
}
