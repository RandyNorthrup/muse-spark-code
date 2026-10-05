// SecretStorage records for bring-your-own providers (M95 lane K, PLAN.md
// D74). Every credential is bound to the exact origin it was obtained for:
// `museSpark.provider.<id>` holds `{v, auth, origin, …}` parsed with zod,
// and the transport refuses a request whose origin differs (lane T reads
// this record). A local server without auth stores nothing. Meta's key keeps
// its own secret and flow (`CredentialStore`).

import * as z from 'zod/mini'
import { PROVIDER_SECRET_PREFIX } from '../../shared/constants'

/**
 * The three-method subset of `vscode.SecretStorage` records use. Spelled
 * out here (rather than importing `SecretStore` from `../auth`) so the two
 * modules stay acyclic: the store wraps these functions, structurally.
 */
export interface RecordStore {
  get(key: string): PromiseLike<string | undefined>
  store(key: string, value: string): PromiseLike<void>
  delete(key: string): PromiseLike<void>
}

const credentialRecordSchema = z.object({
  v: z.literal(1),
  auth: z.enum(['apiKey', 'oauth', 'subscription']),
  origin: z.url(),
  // The key itself (a subscription's tokens join it in M95b): the record
  // is the secret, bound to its origin. It is never logged, never shown,
  // and never crosses postMessage (D74).
  secret: z.string().check(z.minLength(1)),
})

export type CredentialRecord = z.infer<typeof credentialRecordSchema>

/** The SecretStorage account name for a provider id. */
export function providerSecretKey(id: string): string {
  return `${PROVIDER_SECRET_PREFIX}${id}`
}

/** Stores a provider's credential record, bound to its origin. */
export async function saveProviderCredential(
  secrets: RecordStore,
  id: string,
  record: CredentialRecord,
): Promise<void> {
  await secrets.store(providerSecretKey(id), JSON.stringify(record))
}

/**
 * The stored record, or undefined when none was entered. Throws when a
 * stored value is not a record: a damaged entry must ask for the credential
 * again, never read as absent and never used.
 */
export async function readProviderCredential(
  secrets: RecordStore,
  id: string,
): Promise<CredentialRecord | undefined> {
  const stored = await secrets.get(providerSecretKey(id))
  if (stored === undefined || stored === '') {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    throw new Error(`The stored credential for provider ${id} is not valid JSON`)
  }
  const record = credentialRecordSchema.safeParse(parsed)
  if (!record.success) {
    throw new Error(`The stored credential for provider ${id} is not a credential record`)
  }
  return record.data
}

/** Deletes a provider's credential record (removal after its Undo). */
export async function deleteProviderCredential(secrets: RecordStore, id: string): Promise<void> {
  await secrets.delete(providerSecretKey(id))
}

/**
 * Whether `requestOrigin` is the origin the record was entered for. Origins,
 * not hosts: `http` and `https` on one host, or two ports on one host, are
 * different origins, and either difference refuses the request (M95
 * acceptance 5).
 */
export function isOriginBound(record: CredentialRecord, requestOrigin: string): boolean {
  let stored: string
  let request: string
  try {
    stored = new URL(record.origin).origin
    request = new URL(requestOrigin).origin
  } catch {
    return false
  }
  return stored === request
}
