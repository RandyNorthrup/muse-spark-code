import { createHash } from 'node:crypto'
import {
  MODEL_API_BASE_URL,
  MODEL_API_KEY_PATTERN,
  SECRET_KEYS,
  UI_TEXT,
  VAULT_KEY_BYTES,
  VAULT_PROTOCOL_VERSION,
} from '../../../shared/constants'
import { type VaultItem } from '../../../shared/vault'
import { type MigrationCredential, VaultMigrationFault } from './ports'

/** The only already-merged credential format; future store owners supply their own codecs. */
export function modelApiMigrationCredential(now: () => number): MigrationCredential {
  const name = 'meta-model-api'
  const itemId = createHash('sha256')
    .update(SECRET_KEYS.modelApiKey)
    .digest('hex')
    .slice(0, VAULT_KEY_BYTES)
  const origin = new URL(MODEL_API_BASE_URL).origin
  return {
    key: SECRET_KEYS.modelApiKey,
    itemId,
    request: { v: VAULT_PROTOCOL_VERSION, kind: 'firstPartyRead', itemId, origin, client: 'model' },
    decode(value): VaultItem {
      if (!MODEL_API_KEY_PATTERN.test(new TextDecoder('utf-8', { fatal: true }).decode(value)))
        throw new VaultMigrationFault('invalid')
      const bytes = Buffer.alloc(value.byteLength)
      bytes.set(value)
      return {
        metadata: {
          id: itemId,
          name,
          handle: `secret://${name}`,
          label: UI_TEXT.vault.apiKey,
          kind: 'apiKey',
          bindings: [{ kind: 'origin', origin }],
          requirePresence: false,
          hidden: true,
          firstParty: true,
          policy: { mode: 'never', unattendedAllowed: false, allowDisclosure: false },
          dates: { createdAt: now(), rotatedAt: null, expiresAt: null, lastUsedAt: null },
          publicKey: null,
          fingerprint: null,
        },
        material: { kind: 'apiKey', value: bytes, auth: 'bearer', origin },
      }
    },
    encode(item): Uint8Array {
      if (
        item.metadata.id !== itemId ||
        item.material.kind !== 'apiKey' ||
        item.material.origin !== origin ||
        item.material.auth !== 'bearer'
      )
        throw new VaultMigrationFault('invalid')
      const bytes = Buffer.alloc(item.material.value.byteLength)
      bytes.set(item.material.value)
      return bytes
    },
  }
}
