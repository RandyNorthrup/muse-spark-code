import { createHash } from 'node:crypto'
import { vaultItemSchema, type VaultItem } from '../../../shared/vault'
import { VaultMigrationFault } from './ports'

export function eraseItem(item: VaultItem | undefined): void {
  if (item)
    for (const field of Object.values(item.material)) if (field instanceof Uint8Array) field.fill(0)
}

/** All material and security metadata. Usage dates/display labels can change without rotating a value. */
function canonical(value: unknown): unknown {
  if (value instanceof Uint8Array) return { bytes: [...value] }
  if (Array.isArray(value)) return value.map((entry: unknown) => canonical(entry))
  return value !== null && typeof value === 'object'
    ? Object.fromEntries(
        Object.entries(value)
          .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
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
