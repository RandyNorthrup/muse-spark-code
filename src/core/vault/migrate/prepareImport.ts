// C-M109-1: turns one discovered credential file into vault items for the
// all-or-none batch import. Imported items are hidden from agents until the
// person reviews them: a parser's targets (hosts, origins) are private review
// hints and never reach an agent-visible field without that review (D89.14).

import { randomBytes } from 'node:crypto'
import { VAULT_IMPORT_NAME_BYTES, VAULT_LIMITS } from '../../../shared/constants'
import { type VaultItem, type VaultItemMetadata } from '../../../shared/vault'
import { importSshKey } from '../ssh/keys'
import { type AmbientFile } from './ambient'
import { parseAmbientCredentials } from './ambientCredentials'
import { VaultMigrationFault } from './ports'

export interface ImportNaming {
  /** Milliseconds since the epoch, for the items' dates. */
  readonly now: number
  /** The localized, value-free label for the n-th imported item of a kind. */
  readonly label: (kind: AmbientFile['kind'], number: number) => string
}

function metadata(
  kind: VaultItem['material']['kind'],
  source: AmbientFile['kind'],
  number: number,
  naming: ImportNaming,
  extra: Partial<Pick<VaultItemMetadata, 'bindings' | 'publicKey' | 'fingerprint'>>,
): VaultItemMetadata {
  // A random part keeps a second import of the same file from colliding.
  const name = `imported-${source}-${randomBytes(VAULT_IMPORT_NAME_BYTES).toString('hex')}-${String(number)}`
  return {
    id: randomBytes(VAULT_LIMITS.idBytes).toString('hex'),
    name,
    handle: `secret://${name}`,
    label: naming.label(source, number),
    kind,
    bindings: [...(extra.bindings ?? [])],
    requirePresence: false,
    hidden: true,
    firstParty: false,
    policy: { mode: 'askEveryTime', unattendedAllowed: false, allowDisclosure: false },
    dates: { createdAt: naming.now, rotatedAt: null, expiresAt: null, lastUsedAt: null },
    publicKey: extra.publicKey ?? null,
    fingerprint: extra.fingerprint ?? null,
  }
}

/** The caller owns `bytes` and erases them; returned items belong to the caller. */
export function prepareImportItems(
  kind: AmbientFile['kind'],
  bytes: Uint8Array,
  naming: ImportNaming,
): readonly VaultItem[] {
  if (kind === 'csv') throw new VaultMigrationFault('invalid')
  if (kind === 'ssh') {
    const copy = Buffer.from(bytes)
    try {
      const key = importSshKey(copy)
      return [
        {
          metadata: metadata('sshKey', kind, 1, naming, {
            publicKey: key.publicKey,
            fingerprint: key.fingerprint,
          }),
          material: {
            kind: 'sshKey',
            storage: 'software',
            privateKey: key.privateKey,
            algorithm: key.algorithm,
          },
        },
      ]
    } catch (error: unknown) {
      // A torn-down key parse reads invalid whatever broke it; the failure
      // rides along as the cause while the person keeps fixed words.
      if (error instanceof VaultMigrationFault) throw error
      throw new VaultMigrationFault('invalid', { cause: error })
    } finally {
      copy.fill(0)
    }
  }
  return parseAmbientCredentials(kind, bytes).map((entry, index) => ({
    metadata: metadata(entry.material.kind, kind, index + 1, naming, {
      bindings: [...entry.bindings],
    }),
    material: { ...entry.material, importTarget: entry.target },
  }))
}
