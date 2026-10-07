// A provider's credential record (M95, PLAN.md D74): `{v, auth, origin,
// …}`, kept in SecretStorage (VS Code) or the OS store (the ACP agent).
// **Every credential is bound to the exact origin it was obtained for.**
// Before every request the transport compares the origin it is about to
// call with the record's; a mismatch (the file edited, by hand or by
// anything else) refuses the request and asks for the credential again,
// naming both origins. Pure; storage itself is lane K's (host) and lane X's
// (ACP agent).

import * as z from 'zod/mini'
import { CREDENTIAL_RECORD_VERSION } from '../../shared/constants'
import { originOf } from './endpointPolicy'

/** How the credential was obtained. `subscription` arrives in M95b. */
export const credentialAuthSchema = z.enum(['apiKey', 'none', 'subscription'])

export const credentialRecordSchema = z.object({
  v: z.literal(CREDENTIAL_RECORD_VERSION),
  auth: credentialAuthSchema,
  // The exact origin the credential was obtained for, as `originOf` writes
  // it (`scheme://host[:port]`, lowercased, default ports dropped).
  origin: z.string(),
  // When the credential was stored (ISO 8601); informational only.
  updatedAt: z.optional(z.string()),
})

export type CredentialAuth = z.infer<typeof credentialAuthSchema>
export type CredentialRecord = z.infer<typeof credentialRecordSchema>

/** Parse an untrusted stored value; undefined for anything but the record. */
export function parseCredentialRecord(value: unknown): CredentialRecord | undefined {
  const parsed = z.safeParse(credentialRecordSchema, value)
  return parsed.success ? parsed.data : undefined
}

/**
 * Whether the credential may be sent to `requestUrl`: the request's origin
 * equals the record's, exactly (scheme, name and port — comparing hosts
 * alone would let an edited file move a key from HTTPS to HTTP or to
 * another port). A `none` record holds no secret but still binds the
 * address it was saved for.
 */
export function isCredentialBound(record: CredentialRecord, requestUrl: string): boolean {
  const recordOrigin = originOf(record.origin)
  const requestOrigin = originOf(requestUrl)
  return recordOrigin !== undefined && recordOrigin === requestOrigin
}
