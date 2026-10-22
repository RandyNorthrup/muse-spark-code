// Authored node contracts (D90.11/.23), not Muse Code or Model API wire.
// Proofs must additionally pass A1's WebAuthn verifier; schemas are not auth.
import * as z from 'zod/mini'
import {
  NODE_CHALLENGE_TTL_MS,
  NODE_CHALLENGE_MAX_CHARS,
  NODE_DIGEST_PATTERN,
  NODE_DNS_LABEL_CHARS,
  NODE_ID_PATTERN,
  NODE_MAX_AUTH_BYTES,
  NODE_MAX_ID_CHARS,
  NODE_MAX_NAME_CHARS,
  NODE_MAX_ORIGIN_CHARS,
  NODE_MAX_RANDOM_TOKEN_CHARS,
  NODE_MIN_RANDOM_TOKEN_CHARS,
  NODE_NAME_PATTERN,
  NODE_PROTOCOL_VERSION,
  NODE_SESSION_IDLE_MS,
  NODE_SESSION_MAX_MS,
  NODE_SIGNIN_MAX_FAILURES,
  NODE_STEP_UP_TTL_MS,
  NODE_TOKEN_PATTERN,
} from './constants'

export const nodeIdentifierSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(NODE_MAX_ID_CHARS), z.regex(new RegExp(NODE_ID_PATTERN, 'u')))
export const nodeDigestSchema = z.string().check(z.regex(new RegExp(NODE_DIGEST_PATTERN, 'u')))
export const nodeDomainSchema = z.string().check(
  z.maxLength(NODE_MAX_NAME_CHARS),
  z.regex(new RegExp(NODE_NAME_PATTERN, 'u')),
  z.refine(
    (name) =>
      name.split('.').every((part) => part.length <= NODE_DNS_LABEL_CHARS) && isNodeDomain(name),
  ),
)
function isNodeDomain(name: string): boolean {
  try {
    // WHATWG normalizes numeric/hex IPv4 aliases: none is a domain RP id.
    return new URL(`https://${name}`).hostname === name
  } catch (error: unknown) {
    // WHATWG URLs only throw TypeError; anything else surfaces.
    if (!(error instanceof TypeError)) throw error
    return false
  }
}
export const nodeTimeSchema = z.int().check(z.nonnegative())
export const nodeTokenSchema = z
  .string()
  .check(
    z.minLength(NODE_MIN_RANDOM_TOKEN_CHARS),
    z.maxLength(NODE_MAX_RANDOM_TOKEN_CHARS),
    z.regex(new RegExp(NODE_TOKEN_PATTERN, 'u')),
  )
/** Opaque authenticated challenge; ordinary ids and bearers keep their bounds. */
export const nodeChallengeTokenSchema = z
  .string()
  .check(
    z.minLength(1),
    z.maxLength(NODE_CHALLENGE_MAX_CHARS),
    z.regex(new RegExp(NODE_TOKEN_PATTERN, 'u')),
  )
const publicBytesSchema = z
  .string()
  .check(
    z.minLength(1),
    z.maxLength(NODE_MAX_AUTH_BYTES),
    z.regex(new RegExp(NODE_TOKEN_PATTERN, 'u')),
  )

export const nodeStepUpActionSchema = z.enum([
  'terminal.open',
  'key.set',
  'key.unlock',
  'key.use',
  'key.disclose',
  'git.network',
  'node.wipe',
  'maker.action',
])
const challengeFields = {
  v: z.literal(NODE_PROTOCOL_VERSION),
  id: nodeChallengeTokenSchema,
  challenge: nodeChallengeTokenSchema,
  rpId: nodeDomainSchema,
  origin: z.url().check(z.maxLength(NODE_MAX_ORIGIN_CHARS)),
  issuedAt: nodeTimeSchema,
  expiresAt: nodeTimeSchema,
}
export const nodeAuthChallengeSchema = z
  .discriminatedUnion('purpose', [
    z.strictObject({ ...challengeFields, purpose: z.literal('enroll') }),
    z.strictObject({ ...challengeFields, purpose: z.literal('signin') }),
    z.strictObject({
      ...challengeFields,
      purpose: z.literal('stepUp'),
      sessionId: nodeIdentifierSchema,
      action: nodeStepUpActionSchema,
      actionDigest: nodeDigestSchema,
    }),
  ])
  .check(
    z.refine(
      (value) =>
        value.expiresAt > value.issuedAt &&
        value.expiresAt - value.issuedAt <= NODE_CHALLENGE_TTL_MS &&
        isNodeOrigin(value.origin, value.rpId),
    ),
  )
export type NodeAuthChallenge = z.infer<typeof nodeAuthChallengeSchema>

function isNodeOrigin(origin: string, rpId: string): boolean {
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' && url.origin === origin && url.hostname === rpId
  } catch (error: unknown) {
    // WHATWG URLs only throw TypeError; anything else surfaces.
    if (!(error instanceof TypeError)) throw error
    return false
  }
}

const credentialFields = {
  id: publicBytesSchema,
  rawId: publicBytesSchema,
  type: z.literal('public-key'),
  authenticatorAttachment: z.optional(z.enum(['platform', 'cross-platform'])),
  clientExtensionResults: z.strictObject({
    credProps: z.optional(z.strictObject({ rk: z.optional(z.boolean()) })),
  }),
}
export const nodeRegistrationSchema = z.strictObject({
  ...credentialFields,
  response: z.strictObject({
    clientDataJSON: publicBytesSchema,
    attestationObject: publicBytesSchema,
    transports: z.optional(z.array(z.enum(['usb', 'nfc', 'ble', 'internal', 'hybrid']))),
  }),
})
export const nodeAssertionSchema = z.strictObject({
  ...credentialFields,
  response: z.strictObject({
    clientDataJSON: publicBytesSchema,
    authenticatorData: publicBytesSchema,
    signature: publicBytesSchema,
    userHandle: z.optional(z.nullable(publicBytesSchema)),
  }),
})

/** Public metadata only. Bearer and monotonic deadlines live in A1's memory. */
export const nodeSessionSchema = z
  .strictObject({
    v: z.literal(NODE_PROTOCOL_VERSION),
    id: nodeIdentifierSchema,
    ownerId: nodeIdentifierSchema,
    surface: z.enum(['web', 'tui', 'editor']),
    createdAt: nodeTimeSchema,
    lastSeenAt: nodeTimeSchema,
    idleExpiresAt: nodeTimeSchema,
    absoluteExpiresAt: nodeTimeSchema,
  })
  .check(
    z.refine(
      (s) =>
        s.lastSeenAt >= s.createdAt &&
        s.idleExpiresAt > s.lastSeenAt &&
        s.idleExpiresAt - s.lastSeenAt <= NODE_SESSION_IDLE_MS &&
        s.absoluteExpiresAt > s.lastSeenAt &&
        s.absoluteExpiresAt - s.createdAt <= NODE_SESSION_MAX_MS &&
        s.idleExpiresAt <= s.absoluteExpiresAt,
    ),
  )
export type NodeSession = z.infer<typeof nodeSessionSchema>

/** Sign-in-only response; never persist or broadcast this record. */
export const nodeAuthenticationSchema = z.strictObject({
  session: nodeSessionSchema,
  bearer: nodeTokenSchema,
})
export type NodeAuthentication = z.infer<typeof nodeAuthenticationSchema>

export const nodeStepUpSchema = z
  .strictObject({
    id: nodeIdentifierSchema,
    sessionId: nodeIdentifierSchema,
    action: nodeStepUpActionSchema,
    actionDigest: nodeDigestSchema,
    verifiedAt: nodeTimeSchema,
    expiresAt: nodeTimeSchema,
  })
  .check(
    z.refine(
      (proof) =>
        proof.expiresAt > proof.verifiedAt &&
        proof.expiresAt - proof.verifiedAt <= NODE_STEP_UP_TTL_MS,
    ),
  )
export type NodeStepUp = z.infer<typeof nodeStepUpSchema>

/** Public key only; never a private authenticator key or credential token. */
export const nodePasskeySchema = z
  .strictObject({
    id: publicBytesSchema,
    ownerId: nodeIdentifierSchema,
    publicKey: publicBytesSchema,
    counter: z.int().check(z.nonnegative()),
    failures: z.int().check(z.nonnegative(), z.maximum(NODE_SIGNIN_MAX_FAILURES)),
    disabled: z.boolean(),
  })
  .check(z.refine((key) => key.failures < NODE_SIGNIN_MAX_FAILURES || key.disabled))

/** The real verifier checks the authenticated challenge, UV, RP, origin and signature. */
export interface NodeAuthPort {
  begin(purpose: 'enroll' | 'signin', setupCode?: string): Promise<NodeAuthChallenge>
  beginStepUp(
    sessionId: string,
    action: NodeStepUp['action'],
    actionDigest: string,
  ): Promise<NodeAuthChallenge>
  enroll(
    challengeId: string,
    credential: z.infer<typeof nodeRegistrationSchema>,
  ): Promise<NodeAuthentication>
  signIn(
    challengeId: string,
    credential: z.infer<typeof nodeAssertionSchema>,
  ): Promise<NodeAuthentication>
  stepUp(challengeId: string, credential: z.infer<typeof nodeAssertionSchema>): Promise<NodeStepUp>
  end(sessionId: string): Promise<void>
}
