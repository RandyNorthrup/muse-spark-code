// SecretStorage records for bring-your-own providers (M95 lane K, PLAN.md
// D74). Every credential is bound to the exact origin it was obtained for:
// `museSpark.provider.<id>` holds `{v, auth, origin, …}` parsed with zod,
// and the transport refuses a request whose origin differs (lane T reads
// this record). A local server without auth stores nothing. Meta's key keeps
// its own secret and flow (`CredentialStore`).

import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import { PROVIDER_ADMIN_SECRET_PREFIX, PROVIDER_SECRET_PREFIX } from '../../shared/constants'
import { CredentialStore } from '../auth/credentialStore'

/**
The three-method subset of `vscode.SecretStorage` records use. Spelled
out here (rather than importing `SecretStore` from `../auth`) so the two
modules stay acyclic: the store wraps these functions, structurally.
*/
export interface RecordStore {
  get(key: string): PromiseLike<string | undefined>
  store(key: string, value: string): PromiseLike<void>
  delete(key: string): PromiseLike<void>
}

export const credentialRecordSchema = z.object({
  v: z.literal(1),
  auth: z.enum(['apiKey', 'oauth', 'subscription']),
  origin: z.url(),
  // The key itself (a subscription's tokens join it in M95b): the record
  // is the secret, bound to its origin. It is never logged, never shown,
  // and never crosses postMessage (D74).
  secret: z.string().check(z.minLength(1)),
})

export type CredentialRecord = z.infer<typeof credentialRecordSchema>

/** Provider operations live in the lazy Models bundle, not activation. */
export class ProviderCredentialStore extends CredentialStore {
  private readonly records: RecordStore
  public constructor(...args: ConstructorParameters<typeof CredentialStore>) {
    super(...args)
    this.records = args[0]
  }
  public async getProviderCredential(id: string): Promise<CredentialRecord | undefined> {
    return await readProviderCredential(this.records, id)
  }
  public async setProviderCredential(id: string, record: CredentialRecord): Promise<void> {
    await saveProviderCredential(this.records, id, record)
  }
  public async clearProviderCredential(id: string): Promise<void> {
    await deleteProviderCredential(this.records, id)
  }
}

/** The SecretStorage account name for a provider id. */
export function providerSecretKey(id: string): string {
  return `${PROVIDER_SECRET_PREFIX}${id}`
}

/**
Refuses a malformed stored credential with its fixed sentence. A syntax
failure's message quotes the stored text, which holds the secret, so the
refusal carries no cause; the caller knows the provider id already.
*/
function refuseMalformedCredential(id: string): never {
  throw new Error(`The stored credential for provider ${id} is not valid JSON`)
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
The stored record, or undefined when none was entered. Throws when a
stored value is not a record: a damaged entry must ask for the credential
again, never read as absent and never used.
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
  } catch (error: unknown) {
    // Only malformed JSON reads invalid here: anything else keeps its kind.
    if (!(error instanceof SyntaxError)) throw error
    refuseMalformedCredential(id)
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
The SecretStorage account name for a provider's admin report key
(PROVSPEND): its own name, so an inference read never finds it.
*/
export function providerAdminSecretKey(id: string): string {
  return `${PROVIDER_ADMIN_SECRET_PREFIX}${id}`
}

/** Stores a provider's admin report key, bound to the provider's API origin. */
export async function saveProviderAdminCredential(
  secrets: RecordStore,
  id: string,
  record: CredentialRecord,
): Promise<void> {
  await secrets.store(providerAdminSecretKey(id), JSON.stringify(record))
}

/** The stored admin report key, or undefined when none was entered. */
export async function readProviderAdminCredential(
  secrets: RecordStore,
  id: string,
): Promise<CredentialRecord | undefined> {
  const stored = await secrets.get(providerAdminSecretKey(id))
  if (stored === undefined || stored === '') {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch (error: unknown) {
    throw new Error(`The stored admin credential for provider ${id} is not valid JSON`, {
      cause: error,
    })
  }
  const record = credentialRecordSchema.safeParse(parsed)
  if (!record.success) {
    throw new Error(`The stored admin credential for provider ${id} is not a credential record`)
  }
  return record.data
}

/** Deletes a provider's admin report key (removing the provider removes it). */
export async function deleteProviderAdminCredential(
  secrets: RecordStore,
  id: string,
): Promise<void> {
  await secrets.delete(providerAdminSecretKey(id))
}

/**
The stored credential's identity (SHA-256 of its secret), or undefined
when none is stored, the stored value is damaged, or the store cannot be
read. Usage surfaces show only the budgets of this identity, so a rotated
or removed key's numbers disappear; when the identity cannot be read no
budget is shown at all (RVCM952D: like the runtime adapter, unknown is
never a previous key to keep).
*/
export async function storedCredentialId(
  secrets: RecordStore,
  id: string,
): Promise<string | undefined> {
  let stored: string | undefined
  try {
    stored = await secrets.get(providerSecretKey(id))
  } catch {
    return undefined
  }
  if (stored === undefined || stored === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    return undefined
  }
  const record = credentialRecordSchema.safeParse(parsed)
  if (!record.success) return undefined
  const identity = createHash('sha256').update(record.data.secret).digest('hex')
  return identity
}

/**
Whether `requestOrigin` is the origin the record was entered for. Origins,
not hosts: `http` and `https` on one host, or two ports on one host, are
different origins, and either difference refuses the request (M95
acceptance 5).
Hash-only identity of a BYO apiKey record's secret (RVCM963JB P2-4): quota
rows are stamped with the credential a response actually used, and offers
compare against this. Undefined for anything but an apiKey record
(including a damaged one, which keeps legacy unattributed matching so a
broken credential cannot hide every offer). The secret itself never leaves
this call: only its digest is returned, never logged or shown.
*/
export async function providerKeyDigest(
  secrets: RecordStore,
  id: string,
): Promise<string | undefined> {
  let record
  try {
    record = await readProviderCredential(secrets, id)
  } catch {
    // An unreadable credential has no digest; undefined keeps the legacy
    // unattributed matching the doc comment above describes.
    return undefined
  }
  return record?.auth === 'apiKey'
    ? createHash('sha256').update(record.secret).digest('hex')
    : undefined
}

/**
The credential identity spending today, by provider (P2-4): Meta keeps
the generic account; a BYO apiKey record contributes its secret digest;
anything else keeps legacy unattributed matching (no entry here). The
secrets themselves never leave these calls.
*/
export async function providerIdentities(
  secrets: RecordStore,
  providers: Iterable<string>,
  metaAccount: string | undefined,
): Promise<Map<string, string>> {
  const identities = new Map<string, string>()
  if (metaAccount !== undefined) identities.set('meta', metaAccount)
  for (const provider of providers) {
    if (provider === 'meta') continue
    const digest = await providerKeyDigest(secrets, provider)
    if (digest !== undefined) identities.set(provider, digest)
  }
  return identities
}

/**
Hash-only identity of the account a model bills (P2-A): a
bring-your-own model's own provider credential, Meta's account otherwise.
The preview's quote, its per-attempt admission and its final transport
admission compare this one value, so replacing the provider key during
consent or startup voids the approval instead of spending the new key.
The secret itself never leaves this call.
*/
export async function payingKeyDigest(
  secrets: RecordStore,
  modelId: string,
  metaAccount: () => Promise<string | undefined>,
): Promise<string | undefined> {
  const slash = modelId.indexOf('/')
  const provider = slash === -1 ? 'meta' : modelId.slice(0, slash)
  return await (provider === '' || provider === 'meta'
    ? metaAccount()
    : providerKeyDigest(secrets, provider))
}

/**
Whether `requestOrigin` is the origin the record was entered for. Origins,
not hosts: `http` and `https` on one host, or two ports on one host, are
different origins, and either difference refuses the request (M95
acceptance 5).
*/
export function isOriginBound(record: CredentialRecord, requestOrigin: string): boolean {
  let stored: string
  let request: string
  try {
    stored = new URL(record.origin).origin
    request = new URL(requestOrigin).origin
  } catch (error: unknown) {
    // Only a malformed origin refuses the request; a stored record passed
    // the URL schema, so only the request origin can fail here. Anything
    // else keeps its kind.
    if (!(error instanceof TypeError)) throw error
    return false
  }
  return stored === request
}
