// The installed ChatGPT subscription record's shape, shared by the
// sign-in that writes it and the vault migration codec that copies it.
// It lives in this leaf (never in the sign-in core beside it) so the
// migration chunk carries only the schema, not the sign-in's fetch, PKCE
// and JWKS machinery. The origin and issuer are owned here: the codec's
// origin binding and the sign-in's checks read one spelling.
import * as z from 'zod/mini'
import { CREDENTIAL_RECORD_VERSION } from '../../../shared/constants'

export const CHATGPT_ORIGIN = 'https://api.openai.com'
export const CHATGPT_ISSUER = 'https://auth.openai.com'

const nonempty = z.string().check(z.minLength(1))
const positive = z.number().check(z.gt(0))
const accountHashSchema = z.string().check(z.regex(/^[a-f0-9]{64}$/u))

/** Secret-store payload only. Never send this record across a UI bridge. */
export const chatGptRecordSchema = z.object({
  v: z.literal(CREDENTIAL_RECORD_VERSION),
  auth: z.literal('subscription'),
  origin: z.literal(CHATGPT_ORIGIN),
  issuer: z.literal(CHATGPT_ISSUER),
  clientId: nonempty,
  hostId: nonempty,
  /** Hash of the captured verified OIDC subject; never the raw account id. */
  accountIdHash: z.optional(accountHashSchema),
  accessToken: nonempty,
  refreshToken: nonempty,
  expiresAt: positive,
  scope: nonempty,
  nonce: nonempty,
  /** A replacement kept for recovery/revocation, never usable before verification. */
  pendingRefresh: z.optional(z.object({ idToken: z.optional(nonempty) })),
})
export type ChatGptRecord = z.infer<typeof chatGptRecordSchema>
