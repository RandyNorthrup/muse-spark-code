// Migration codec for M108's account secrets (PLAN.md D89.14, lane M).
// The installed store is SecretStorage `museSpark.provider.<provider>` for
// the default account and `museSpark.provider.<provider>.account.<account>`
// otherwise, holding `{provider, account, origin, v, auth, secret}` as read
// and written by `secretStorageAccountVault`
// (`src/host/providers/accountSecrets.ts`) over `credentialRecordSchema` and
// `boundCredential` (`src/core/providers/accountCredentialRecord.ts`,
// imported here, never mirrored). Meta's default account keeps rule 8's
// original entry: the raw key under `museSpark.modelApiKey`, which is the
// `./modelApi` codec's entry, reused here so both paths name the same item.
// The codec shell is shared (`migrationCodec` in `./material`).
import * as z from 'zod/mini'
import { createHash } from 'node:crypto'
import { ACCOUNT_DEFAULT_ID, VAULT_KEY_BYTES } from '../../../shared/constants'
import {
  accountBindingSchema,
  accountSecretKey,
  boundCredential,
  credentialRecordSchema,
  type AccountCredential,
} from '../../providers/accountCredentialRecord'
import { modelApiMigrationCredential } from './modelApi'
import { migrationCodec, type LegacyRecordShape } from './material'
import { type MigrationCredential, VaultMigrationFault } from './ports'

const legacyDefaultShape = z.strictObject({
  v: credentialRecordSchema.shape.v,
  auth: credentialRecordSchema.shape.auth,
  secret: credentialRecordSchema.shape.secret,
  // Legacy records accept any URL here; binding validation below still pins the origin.
  origin: z.url(),
})

function parseStored(provider: string, account: string, text: string): AccountCredential {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new VaultMigrationFault('invalid')
  }
  // Only the legacy default name may omit account identity, exactly as the
  // installed reader accepts it: other names must carry it, so copying one
  // account's record cannot authenticate another.
  const legacy = legacyDefaultShape.safeParse(value)
  const parsed = credentialRecordSchema.safeParse(
    account === ACCOUNT_DEFAULT_ID && legacy.success
      ? { ...legacy.data, provider, account }
      : value,
  )
  if (!parsed.success) throw new VaultMigrationFault('invalid')
  try {
    accountBindingSchema.parse({ provider, account, origin: parsed.data.origin })
    return boundCredential(parsed.data, { provider, account, origin: parsed.data.origin })
  } catch {
    throw new VaultMigrationFault('invalid')
  }
}

function canonicalJson(record: AccountCredential): string {
  return JSON.stringify({
    provider: record.provider,
    account: record.account,
    origin: record.origin,
    v: 1,
    auth: record.auth,
    secret: record.secret,
  })
}

function shapeFor(provider: string, account: string): LegacyRecordShape<AccountCredential> {
  return {
    parse: (text) => parseStored(provider, account, text),
    originOf: (record) => record.origin,
    apiKeySecret: (record) => (record.auth === 'apiKey' ? record.secret : null),
    canonicalJson,
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
  const key = accountSecretKey(provider, account)
  if (provider === 'meta' && account === ACCOUNT_DEFAULT_ID) return modelApiMigrationCredential(now)
  const itemId = createHash('sha256').update(key).digest('hex').slice(0, VAULT_KEY_BYTES)
  return migrationCodec(
    key,
    itemId,
    `account-${provider}-${account}`,
    now,
    shapeFor(provider, account),
  )
}
