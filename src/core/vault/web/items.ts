import { vaultItemMetadataSchema, type VaultItemMetadata } from '../../../shared/vault'

/** Names/labels never come from CSV credential columns. New agent items always ask. */
export function webItemMetadata(
  kind: 'webLogin' | 'session',
  id: string,
  origin: string,
  now: number,
  expiresAt: number | null,
): VaultItemMetadata {
  const name = `${kind === 'session' ? 'web-session' : 'web-login'}-${id}`
  return vaultItemMetadataSchema.parse({
    id,
    name,
    handle: `secret://${name}`,
    label: origin,
    kind,
    bindings: [{ kind: 'origin', origin }],
    requirePresence: false,
    hidden: false,
    firstParty: false,
    policy: { mode: 'askEveryTime', unattendedAllowed: false, allowDisclosure: false },
    dates: { createdAt: now, rotatedAt: null, expiresAt, lastUsedAt: null },
    publicKey: null,
    fingerprint: null,
  })
}
