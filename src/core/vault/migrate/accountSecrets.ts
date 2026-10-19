// Migration codec for M108's account secrets (PLAN.md D89.14, lane M).
// The installed store for a non-default account is SecretStorage
// `museSpark.provider.<provider>.account.<account>` holding
// `{provider, account, origin, v, auth, secret}` as read and written by
// `secretStorageAccountVault` (`src/host/providers/accountSecrets.ts`) over
// `credentialRecordSchema` and `boundCredential`
// (`src/core/providers/accountCredentialRecord.ts`, imported here, never
// mirrored). A segmented slot never holds the legacy short shape the
// installed reader rejects there, so short documents are refused. A
// non-meta default account shares the provider slot
// `museSpark.provider.<provider>` with the M95 record: one key, one item,
// one owner. This factory returns the provider codec's credential for that
// slot, so both paths name the same item and every shape the slot can hold
// migrates exactly instead of conflicting at construction. Meta's default
// account keeps rule 8's original entry: the raw key under
// `museSpark.modelApiKey`, which is the `./modelApi` codec's entry, reused
// here so both paths name the same item. The codec shell is shared
// (`migrationCodec` in `./material`).
import { createHash } from 'node:crypto'
import { ACCOUNT_DEFAULT_ID, VAULT_KEY_BYTES } from '../../../shared/constants'
import {
  AccountStoreError,
  accountSecretKey,
  boundCredential,
  credentialRecordSchema,
  type AccountCredential,
} from '../../providers/accountCredentialRecord'
import { modelApiMigrationCredential } from './modelApi'
import {
  accountRecordCanonicalJson,
  migrationCodec,
  migrationItemName,
  type LegacyRecordShape,
} from './material'
import { type MigrationCredential, VaultMigrationFault } from './ports'
import { providerCredentialMigrationCredential } from './providerCredentials'

function parseStored(provider: string, account: string, text: string): AccountCredential {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error: unknown) {
    // JSON.parse fails only as SyntaxError: a malformed record is invalid,
    // never adopted, with the parsing failure as its cause.
    if (!(error instanceof SyntaxError)) throw error
    throw new VaultMigrationFault('invalid', { cause: error })
  }
  const parsed = credentialRecordSchema.safeParse(value)
  if (!parsed.success) throw new VaultMigrationFault('invalid')
  // The record must name this slot: copying one account's record cannot
  // authenticate another, and a short document without identity is refused.
  try {
    return boundCredential(parsed.data, { provider, account, origin: parsed.data.origin })
  } catch (error: unknown) {
    // Only the binding check lands here: a mismatched record is invalid with
    // the store failure as its cause.
    if (!(error instanceof AccountStoreError)) throw error
    throw new VaultMigrationFault('invalid', { cause: error })
  }
}

function shapeFor(provider: string, account: string): LegacyRecordShape<AccountCredential> {
  return {
    parse: (text) => parseStored(provider, account, text),
    originOf: (record) => record.origin,
    apiKeySecret: (record) => (record.auth === 'apiKey' ? record.secret : null),
    canonicalJson: accountRecordCanonicalJson,
    apiKeyJson: (origin, secret) =>
      JSON.stringify({ provider, account, origin, v: 1, auth: 'apiKey', secret }),
  }
}

/** Codec for one installed account record; encode reproduces the installed bytes. */
export function accountSecretMigrationCredential(
  provider: string,
  account: string,
  now: () => number,
): MigrationCredential {
  if (provider === 'meta' && account === ACCOUNT_DEFAULT_ID) return modelApiMigrationCredential(now)
  if (account === ACCOUNT_DEFAULT_ID) return providerCredentialMigrationCredential(provider, now)
  // `accountSecretKey` parses both ids with zod: translate its throw into
  // the same typed vault fault the provider factory throws, so callers that
  // map fault codes see one refusal shape from every factory.
  let key: string
  try {
    key = accountSecretKey(provider, account)
  } catch (error: unknown) {
    // An unparsable id is invalid with the parse failure as its cause.
    throw new VaultMigrationFault('invalid', { cause: error })
  }
  const itemId = createHash('sha256').update(key).digest('hex').slice(0, VAULT_KEY_BYTES)
  return migrationCodec(
    key,
    itemId,
    migrationItemName('account', provider, account),
    now,
    shapeFor(provider, account),
  )
}
