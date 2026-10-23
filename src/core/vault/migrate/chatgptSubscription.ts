// Migration codec for the installed ChatGPT subscription record (PLAN.md
// D89.14, lane M; this lane owns it, not the provider codec). It owns the
// whole bare slot `museSpark.provider.chatgpt`: the installed record
// `{v, auth, origin, issuer, clientId, hostId, accountIdHash?, accessToken,
// refreshToken, expiresAt, scope, nonce, pendingRefresh?}` written by the
// ChatGPT sign-in. The record always migrates opaquely into a `secret`
// item holding the canonical record, so the mirror keeps the installed
// bytes and both previous readers still parse it. Documents with unknown
// fields are refused rather than migrated with fields dropped. The
// registration slot (`...chatgpt.registration`) holds no token and the
// runtime host-id slot (`...chatgpt.host-id`) is a machine identity, so
// neither migrates. The codec shell is shared (`migrationCodec` in
// `./material`).
import { createHash } from 'node:crypto'
import { PROVIDER_SECRET_PREFIX, VAULT_KEY_BYTES } from '../../../shared/constants'
import {
  chatGptRecordSchema,
  type ChatGptRecord,
} from '../../providers/subscriptions/chatgptRecord'
import { migrationCodec, migrationItemName, type LegacyRecordShape } from './material'
import { type MigrationCredential, VaultMigrationFault } from './ports'

export const CHATGPT_SUBSCRIPTION_PROVIDER_ID = 'chatgpt'

const CHATGPT_RECORD_KEYS = new Set([
  'v',
  'auth',
  'origin',
  'issuer',
  'clientId',
  'hostId',
  'accountIdHash',
  'accessToken',
  'refreshToken',
  'expiresAt',
  'scope',
  'nonce',
  'pendingRefresh',
])
const PENDING_REFRESH_KEYS = new Set(['idToken'])

function parse(text: string): ChatGptRecord {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error: unknown) {
    // JSON.parse fails only as SyntaxError: a malformed record is invalid,
    // never adopted, with the parsing failure as its cause.
    if (!(error instanceof SyntaxError)) throw error
    throw new VaultMigrationFault('invalid', { cause: error })
  }
  const record = chatGptRecordSchema.safeParse(parsed)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !record.success ||
    Object.keys(parsed).some((key) => !CHATGPT_RECORD_KEYS.has(key)) ||
    (typeof (parsed as { pendingRefresh?: unknown }).pendingRefresh === 'object' &&
      (parsed as { pendingRefresh?: unknown }).pendingRefresh !== null &&
      Object.keys((parsed as { pendingRefresh: Record<string, unknown> }).pendingRefresh).some(
        (key) => !PENDING_REFRESH_KEYS.has(key),
      ))
  )
    throw new VaultMigrationFault('invalid')
  return record.data
}

const shape: LegacyRecordShape<ChatGptRecord> = {
  parse,
  originOf: (record) => record.origin,
  // A subscription record is never an apiKey: its tokens migrate opaquely.
  apiKeySecret: () => null,
  // The installed writer's key order (sign-in completion, then refresh
  // spreads), with each optional only when present, so the canonical bytes
  // are the installed bytes.
  canonicalJson: (record) =>
    JSON.stringify({
      v: record.v,
      auth: record.auth,
      origin: record.origin,
      issuer: record.issuer,
      clientId: record.clientId,
      hostId: record.hostId,
      ...(record.accountIdHash !== undefined && { accountIdHash: record.accountIdHash }),
      accessToken: record.accessToken,
      refreshToken: record.refreshToken,
      expiresAt: record.expiresAt,
      scope: record.scope,
      nonce: record.nonce,
      ...(record.pendingRefresh !== undefined && { pendingRefresh: record.pendingRefresh }),
    }),
  // Unreachable through decode (no ChatGPT record is an apiKey), so an
  // apiKey item offered for this slot is refused, never rebuilt.
  apiKeyJson: () => {
    throw new VaultMigrationFault('invalid')
  },
}

/** Codec for the installed ChatGPT subscription slot; encode reproduces the installed bytes. */
export function chatgptSubscriptionMigrationCredential(now: () => number): MigrationCredential {
  const key = `${PROVIDER_SECRET_PREFIX}${CHATGPT_SUBSCRIPTION_PROVIDER_ID}`
  const itemId = createHash('sha256').update(key).digest('hex').slice(0, VAULT_KEY_BYTES)
  return migrationCodec(
    key,
    itemId,
    migrationItemName('provider', CHATGPT_SUBSCRIPTION_PROVIDER_ID),
    now,
    shape,
  )
}
