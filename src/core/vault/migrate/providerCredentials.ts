// Migration codec for M95's provider credential records (PLAN.md D89.14,
// lane M). The installed store is SecretStorage `museSpark.provider.<id>`
// holding `{v, auth, origin, secret}` as written by saveProviderCredential
// and read by readProviderCredential (`src/host/providers/credentialRecords.ts`,
// whose schema is imported here, never mirrored). `oauth`/`subscription`
// records are opaque installed strings (no issuer, resource or expiry the
// vault's `oauth` material could honestly carry), so they migrate opaquely.
// Meta's own key keeps its codec in `./modelApi`; the `chatgpt` subscription
// record is a different installed shape (`chatGptRecordSchema`) with its own
// owner lane. The codec shell is shared (`migrationCodec` in `./material`).
import { createHash } from 'node:crypto'
import { PROVIDER_SECRET_PREFIX, VAULT_KEY_BYTES } from '../../../shared/constants'
import {
  credentialRecordSchema,
  type CredentialRecord,
} from '../../../host/providers/credentialRecords'
import { migrationCodec, type LegacyRecordShape } from './material'
import { type MigrationCredential, VaultMigrationFault } from './ports'

function parse(text: string): CredentialRecord {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new VaultMigrationFault('invalid')
  }
  const record = credentialRecordSchema.safeParse(parsed)
  if (!record.success) throw new VaultMigrationFault('invalid')
  return record.data
}

const shape: LegacyRecordShape<CredentialRecord> = {
  parse,
  originOf: (record) => record.origin,
  apiKeySecret: (record) => (record.auth === 'apiKey' ? record.secret : null),
  canonicalJson: (record) => JSON.stringify(canonicalRecord(record)),
  apiKeyJson: (origin, secret) => JSON.stringify({ v: 1, auth: 'apiKey', origin, secret }),
}

function canonicalRecord(record: CredentialRecord): CredentialRecord {
  return { v: 1, auth: record.auth, origin: record.origin, secret: record.secret }
}

/** Codec for one installed provider record; encode reproduces the installed bytes. */
export function providerCredentialMigrationCredential(
  provider: string,
  now: () => number,
): MigrationCredential {
  const key = `${PROVIDER_SECRET_PREFIX}${provider}`
  const itemId = createHash('sha256').update(key).digest('hex').slice(0, VAULT_KEY_BYTES)
  return migrationCodec(key, itemId, `provider-${provider}`, now, shape)
}
