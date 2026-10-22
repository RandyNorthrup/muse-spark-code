// Migration codec for M95's provider credential records (PLAN.md D89.14,
// lane M). It owns the whole bare slot `museSpark.provider.<id>`: the
// installed 4-key record `{v, auth, origin, secret}` written by
// saveProviderCredential, and a full M108 account record overlaid at the
// same slot by `secretStorageAccountVault` for that provider's default
// account (M108 keeps the legacy default key). Both shapes migrate exactly
// or are refused without touching the source: 4-key `apiKey` records become
// vault `apiKey` items pinning `auth: 'apiKey'`; every 6-key record and every
// opaque 4-key record becomes a `secret` item holding the canonical record,
// so the mirror keeps the installed bytes and both previous readers still
// parse it. Documents with unknown fields are refused rather than migrated
// with fields dropped. `oauth`/`subscription` records are opaque installed
// strings (no issuer, resource or expiry the vault's `oauth` material could
// honestly carry), so they migrate opaquely. The `chatgpt` and `grok`
// subscription records are different installed shapes (`chatGptRecordSchema`,
// `grokRecordSchema`) with their own owner lanes: this factory refuses them
// eagerly so they can never collide with those codecs. Meta's own key keeps
// its codec in `./modelApi`. The codec shell is shared (`migrationCodec` in
// `./material`).
import { createHash } from 'node:crypto'
import { PROVIDER_SECRET_PREFIX, VAULT_KEY_BYTES } from '../../../shared/constants'
import {
  credentialRecordSchema,
  type CredentialRecord,
} from '../../../host/providers/credentialRecords'
import {
  credentialRecordSchema as accountCredentialRecordSchema,
  type AccountCredential,
} from '../../providers/accountCredentialRecord'
import {
  accountRecordCanonicalJson,
  migrationCodec,
  migrationItemName,
  type LegacyRecordShape,
} from './material'
import { type MigrationCredential, VaultMigrationFault } from './ports'

/** One slot, two installed shapes: the provider record or an overlaid default-account record. */
type ProviderSlotRecord = CredentialRecord | AccountCredential

const PROVIDER_RECORD_KEYS = new Set(['v', 'auth', 'origin', 'secret'])

function isAccountRecord(record: ProviderSlotRecord): record is AccountCredential {
  return 'provider' in record && 'account' in record
}

function parse(text: string): ProviderSlotRecord {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error: unknown) {
    // JSON.parse fails only as SyntaxError: a malformed record is invalid,
    // never adopted, with the parsing failure as its cause.
    if (!(error instanceof SyntaxError)) throw error
    throw new VaultMigrationFault('invalid', { cause: error })
  }
  // The strict 6-key overlay first: the 4-key schema below is non-strict, so
  // testing it first would swallow an account record and then refuse it for
  // carrying its own identity.
  const overlaid = accountCredentialRecordSchema.safeParse(parsed)
  if (overlaid.success) return overlaid.data
  const record = credentialRecordSchema.safeParse(parsed)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !record.success ||
    Object.keys(parsed).some((key) => !PROVIDER_RECORD_KEYS.has(key))
  )
    throw new VaultMigrationFault('invalid')
  return record.data
}

const shape: LegacyRecordShape<ProviderSlotRecord> = {
  parse,
  originOf: (record) => record.origin,
  // Only a bare 4-key `apiKey` record rebuilds byte-exact through the short
  // form, so only it becomes an `apiKey` item. A 6-key `apiKey` record keeps
  // its installed bytes verbatim in a `secret` item instead of dropping its
  // account identity into a rebuilt short document.
  apiKeySecret: (record) =>
    record.auth === 'apiKey' && !isAccountRecord(record) ? record.secret : null,
  canonicalJson: (record) =>
    isAccountRecord(record)
      ? accountRecordCanonicalJson(record)
      : JSON.stringify(canonicalRecord(record)),
  apiKeyJson: (origin, secret) => JSON.stringify({ v: 1, auth: 'apiKey', origin, secret }),
}

function canonicalRecord(record: CredentialRecord): CredentialRecord {
  return { v: 1, auth: record.auth, origin: record.origin, secret: record.secret }
}

/** Codec for one installed provider slot; encode reproduces the installed bytes. */
export function providerCredentialMigrationCredential(
  provider: string,
  now: () => number,
): MigrationCredential {
  if (provider === 'chatgpt' || provider === 'grok') throw new VaultMigrationFault('invalid')
  const key = `${PROVIDER_SECRET_PREFIX}${provider}`
  const itemId = createHash('sha256').update(key).digest('hex').slice(0, VAULT_KEY_BYTES)
  return migrationCodec(key, itemId, migrationItemName('provider', provider), now, shape)
}
