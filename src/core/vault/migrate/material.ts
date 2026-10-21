import { createHash } from 'node:crypto'
import { ACCOUNT_ID_PATTERN, UI_TEXT, VAULT_LIMITS } from '../../../shared/constants'
import { PROVIDER_ID_PATTERN } from '../../providers/modelRef'
import { vaultItemSchema, type VaultItem } from '../../../shared/vault'
import type { AccountCredential } from '../../providers/accountCredentialRecord'
import { VaultMigrationFault, type MigrationCredential } from './ports'

/** Erase every owned field of parsed import drafts. */
export function wipeImportMaterial(entries: readonly { material: VaultItem['material'] }[]): void {
  for (const entry of entries)
    for (const field of Object.values(entry.material))
      if (field instanceof Uint8Array) field.fill(0)
}

export function eraseItem(item: VaultItem | undefined): void {
  if (item) wipeImportMaterial([item])
}

/** All material and security metadata. Usage dates/display labels can change without rotating a value. */
function canonical(value: unknown): unknown {
  if (value instanceof Uint8Array) return { bytes: [...value] }
  if (Array.isArray(value)) return value.map((entry: unknown) => canonical(entry))
  return value !== null && typeof value === 'object'
    ? Object.fromEntries(
        Object.entries(value)
          .toSorted(([left], [right]) => {
            if (left < right) return -1
            return left > right ? 1 : 0
          })
          .map(([key, entry]) => [key, canonical(entry)]),
      )
    : value
}
export function itemDigest(item: VaultItem): string {
  const parsed = vaultItemSchema.parse(item)
  const { label: _label, dates: _dates, ...metadata } = parsed.metadata
  return createHash('sha256')
    .update(JSON.stringify(canonical({ metadata, material: parsed.material })))
    .digest('hex')
}
export function areSameBytes(left: Uint8Array, right: Uint8Array | null): boolean {
  return (
    right !== null &&
    createHash('sha256').update(left).digest('hex') ===
      createHash('sha256').update(right).digest('hex')
  )
}
/**
A migrated credential's item: first-party, hidden, never usable by an
agent, bound to the legacy record's origin. Owner codecs share this so a
migrated record cannot drift into an exposed or rebound shape.
*/
export function migrationItem(
  itemId: string,
  name: string,
  origin: string,
  now: () => number,
  material: { kind: 'apiKey'; secret: string; auth: 'apiKey' } | { kind: 'secret'; json: string },
): VaultItem {
  const metadata = {
    id: itemId,
    name,
    handle: `secret://${name}`,
    bindings: [{ kind: 'origin' as const, origin }],
    requirePresence: false,
    hidden: true,
    firstParty: true,
    policy: { mode: 'never' as const, unattendedAllowed: false, allowDisclosure: false },
    dates: { createdAt: now(), rotatedAt: null, expiresAt: null, lastUsedAt: null },
    publicKey: null,
    fingerprint: null,
  }
  if (material.kind === 'apiKey') {
    const value = Buffer.alloc(Buffer.byteLength(material.secret))
    value.write(material.secret)
    return {
      metadata: { ...metadata, label: UI_TEXT.vault.apiKey, kind: 'apiKey' as const },
      material: { kind: 'apiKey' as const, value, auth: material.auth, origin },
    }
  }
  return {
    metadata: { ...metadata, label: UI_TEXT.vault.secret, kind: 'secret' as const },
    material: { kind: 'secret' as const, value: Buffer.from(material.json, 'utf8') },
  }
}

/**
Canonical bytes of an installed full account record, in the installed
writer's key order (`secretStorageAccountVault.write`). Shared so the
provider codec's overlay branch cannot drift from the account codec.
*/
export function accountRecordCanonicalJson(record: AccountCredential): string {
  return JSON.stringify({
    provider: record.provider,
    account: record.account,
    origin: record.origin,
    v: 1,
    auth: record.auth,
    secret: record.secret,
  })
}

/**
The closed kinds of migrated vault item names. No kind is another kind
followed by `-`, so names of different kinds can never meet.
*/
export type MigrationItemKind = 'provider' | 'account'
const MIGRATION_ITEM_KINDS = new Set<MigrationItemKind>(['provider', 'account'])

/**
Deterministic, one-to-one vault item name that always fits the vault
handle (`secret://` plus at most 48 lowercase alphanumerics and dashes).
One id stays `provider-<id>`. Two or more ids write every id except the
last as `<decimal length>-<id>` with the last id bare, so the reading is
unambiguous even though ids may hold `-`: a one-id name starts with a
letter after the kind and a multi-id name starts with a digit, so the two
shapes cannot meet. A readable name past the limit becomes
`<kind>-<hex>`, the SHA-256 over the canonical JSON array
`[kind, id1, id2, ...]` (never over a joined string) cut to the room that
is left: a readable multi-id name carries a `-` within three characters
after the kind and a hash carries none, so the two forms cannot meet.
Every id is validated against its own pattern first; an invalid id is
refused, never normalised. Deterministic across platforms and versions.
*/
export function migrationItemName(kind: MigrationItemKind, ...ids: string[]): string {
  if (!MIGRATION_ITEM_KINDS.has(kind)) throw new VaultMigrationFault('invalid')
  if (ids.length === 0) throw new VaultMigrationFault('invalid')
  for (const [index, id] of ids.entries()) {
    const pattern = index === 0 ? PROVIDER_ID_PATTERN : ACCOUNT_ID_PATTERN
    if (!pattern.test(id)) throw new VaultMigrationFault('invalid')
  }
  const readable =
    ids.length === 1
      ? `${kind}-${ids.join('-')}`
      : `${kind}-${ids.map((id, index) => (index === ids.length - 1 ? id : `${String(id.length)}-${id}`)).join('-')}`
  if (readable.length <= VAULT_LIMITS.name) return readable
  return `${kind}-${createHash('sha256')
    .update(JSON.stringify([kind, ...ids]))
    .digest('hex')
    .slice(0, VAULT_LIMITS.name - kind.length - 1)}`
}

/**
An installed store's legacy shape, supplied by its owner codec. `parse`
accepts exactly what the installed reader accepts; `apiKeyJson` rebuilds
an `apiKey` record so encode reproduces the installed bytes.
*/
export interface LegacyRecordShape<T> {
  parse(text: string): T
  originOf(record: T): string
  /** The key string for `apiKey` records; null for opaque `oauth`/`subscription` ones. */
  apiKeySecret(record: T): string | null
  canonicalJson(record: T): string
  apiKeyJson(origin: string, secret: string): string
}

/**
One migration codec shell shared by every credential store, so a store
cannot drift into an exposed or rebound shape. `apiKey` records become
vault `apiKey` items; opaque records become `secret` items holding the
canonical record; both bind the record's origin. The owner's API consumes
the structured record, not a key, so `request` is null.
*/
function utf8(value: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value)
  } catch (error: unknown) {
    // A fatal decode fails only as TypeError: undecodable bytes are invalid,
    // never adopted, with the decoding failure as its cause.
    if (!(error instanceof TypeError)) throw error
    throw new VaultMigrationFault('invalid', { cause: error })
  }
}

export function migrationCodec<T>(
  key: string,
  itemId: string,
  name: string,
  now: () => number,
  shape: LegacyRecordShape<T>,
): MigrationCredential {
  return {
    key,
    itemId,
    name,
    request: null,
    decode(value): VaultItem {
      const record = shape.parse(utf8(value))
      const secret = shape.apiKeySecret(record)
      if (secret !== null)
        return migrationItem(itemId, name, shape.originOf(record), now, {
          kind: 'apiKey',
          secret,
          auth: 'apiKey',
        })
      return migrationItem(itemId, name, shape.originOf(record), now, {
        kind: 'secret',
        json: shape.canonicalJson(record),
      })
    },
    encode(item): Uint8Array {
      if (item.metadata.id !== itemId) throw new VaultMigrationFault('invalid')
      const [binding] = item.metadata.bindings
      if (item.metadata.bindings.length !== 1 || binding?.kind !== 'origin')
        throw new VaultMigrationFault('invalid')
      if (item.material.kind === 'apiKey') {
        if (item.material.auth !== 'apiKey' || item.material.origin !== binding.origin)
          throw new VaultMigrationFault('invalid')
        const record = shape.parse(shape.apiKeyJson(binding.origin, utf8(item.material.value)))
        if (shape.apiKeySecret(record) === null || shape.originOf(record) !== binding.origin)
          throw new VaultMigrationFault('invalid')
        return Buffer.from(shape.canonicalJson(record), 'utf8')
      }
      if (item.material.kind === 'secret') {
        const record = shape.parse(utf8(item.material.value))
        if (shape.apiKeySecret(record) !== null || shape.originOf(record) !== binding.origin)
          throw new VaultMigrationFault('invalid')
        const bytes = Buffer.alloc(item.material.value.byteLength)
        bytes.set(item.material.value)
        return bytes
      }
      throw new VaultMigrationFault('invalid')
    },
  }
}

export function validateMigrationItem(item: VaultItem, itemId: string): void {
  if (
    !vaultItemSchema.safeParse(item).success ||
    item.metadata.id !== itemId ||
    !item.metadata.firstParty ||
    !item.metadata.hidden ||
    item.metadata.policy.mode !== 'never'
  )
    throw new VaultMigrationFault('invalid')
}
