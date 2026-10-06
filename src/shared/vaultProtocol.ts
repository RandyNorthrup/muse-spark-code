import * as z from 'zod/mini'
import { VAULT_LIMITS, VAULT_PROTOCOL_VERSION } from './constants'
import {
  vaultApprovalAnswerSchema,
  vaultApprovalRequestSchema,
  vaultAuditRecordSchema,
  vaultEncodedSchema,
  vaultGrantSchema,
  vaultItemMetadataSchema,
  vaultRequesterSchema,
  vaultTaintSchema,
  vaultTicketSchema,
  vaultUseSchema,
  vaultOriginSchema,
  type VaultApprovalAnswer,
  type VaultClockPort,
  type VaultItemMetadata,
  type VaultRequester,
  type VaultTaint,
  type VaultUse,
} from './vault'

const id = z.string().check(z.regex(/^[a-f0-9]{32}$/u))
const digest = z.string().check(z.regex(/^[a-f0-9]{64}$/u))
const text = z
  .string()
  .check(z.minLength(1), z.maxLength(VAULT_LIMITS.text), z.regex(/^[^\0\r\n]*$/u))
const counter = z.number().check(z.int(), z.nonnegative())
const handle = z.string().check(z.regex(/^secret:\/\/[a-z][a-z0-9-]{0,47}$/u))
const publicItem = vaultItemMetadataSchema.check(
  z.refine((v) => !v.hidden && !v.firstParty && !['devicePair', 'internal'].includes(v.kind)),
)

export const vaultStatusSchema = z.strictObject({
  state: z.enum(['locked', 'unlocked', 'unavailable', 'firstPartyOnly']),
  lockEpoch: counter,
  tier: z.nullable(
    z.enum(['hardware', 'presence', 'osStore', 'secretStorage', 'passphrase', 'recovery']),
  ),
  provider: z.nullable(text),
  silentUnlock: z.boolean(),
  itemCount: counter,
  reason: z.nullable(
    z.enum(['brokerBlocked', 'slotUnavailable', 'basicText', 'rollback', 'auditInvalid', 'locked']),
  ),
})
export type VaultStatus = z.infer<typeof vaultStatusSchema>

/** Proposal identity comes from the authenticated connection, not its payload. */
export const vaultUseProposalSchema = z.strictObject({
  handle,
  use: vaultUseSchema,
  taint: vaultTaintSchema,
})

export const vaultBrokerRequestSchema = z.strictObject({
  v: z.literal(VAULT_PROTOCOL_VERSION),
  sequence: counter,
  request: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('hello'), bootToken: id, hostId: id, hostSession: id }),
    z.strictObject({ kind: z.literal('status') }),
    z.strictObject({ kind: z.literal('unlock'), slotId: id }),
    z.strictObject({ kind: z.literal('lock') }),
    z.strictObject({ kind: z.literal('registerRequester'), requester: vaultRequesterSchema }),
    z.strictObject({ kind: z.literal('endRequester'), requesterId: id }),
    z.strictObject({ kind: z.literal('list') }),
    z.strictObject({ kind: z.literal('requestUse'), proposal: vaultUseProposalSchema }),
    z.strictObject({ kind: z.literal('answer'), answer: vaultApprovalAnswerSchema }),
    z.strictObject({ kind: z.literal('redeem'), ticket: vaultTicketSchema, use: vaultUseSchema }),
    z.strictObject({ kind: z.literal('revoke'), grantId: id }),
    z.strictObject({ kind: z.literal('grant'), grant: vaultGrantSchema }),
    z.strictObject({
      kind: z.literal('audit'),
      item: z.nullable(handle),
      requesterId: z.nullable(id),
      afterGeneration: counter,
    }),
    z.strictObject({
      kind: z.literal('scrub'),
      text: z.string().check(z.maxLength(VAULT_LIMITS.frameBytes)),
    }),
  ]),
})
export type VaultBrokerRequest = z.infer<typeof vaultBrokerRequestSchema>

/** A ticket states which authority authorized it; a grant always names its audit id. */
export const vaultApprovalResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ticket'),
    ticket: vaultTicketSchema,
    authority: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('mode') }),
      z.strictObject({ kind: z.literal('grant'), grantId: id }),
      z.strictObject({ kind: z.literal('user') }),
    ]),
  }),
  z.strictObject({
    kind: z.literal('denied'),
    reason: z.enum([
      'locked',
      'policy',
      'unattended',
      'presence',
      'tainted',
      'ceiling',
      'scope',
      'expired',
      'replay',
      'digest',
      'peer',
      'firstPartyOnly',
      'disclosure',
      'remoteUse',
    ]),
  }),
])
export type VaultApprovalResult = z.infer<typeof vaultApprovalResultSchema>

/** request returns a pending UI approval, an authorized use, or a fail-closed denial. */
export const vaultAuthorizationResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('approval'), request: vaultApprovalRequestSchema }),
  ...vaultApprovalResultSchema.def.options,
])
export type VaultAuthorizationResult = z.infer<typeof vaultAuthorizationResultSchema>

export const vaultBrokerResponseSchema = z.strictObject({
  v: z.literal(VAULT_PROTOCOL_VERSION),
  sequence: counter,
  response: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('hello'), brokerId: id, lockEpoch: counter }),
    z.strictObject({ kind: z.literal('status'), status: vaultStatusSchema }),
    z.strictObject({
      kind: z.literal('items'),
      items: z.array(publicItem).check(z.maxLength(VAULT_LIMITS.items)),
    }),
    ...vaultAuthorizationResultSchema.def.options,
    z.strictObject({
      kind: z.literal('audit'),
      records: z.array(vaultAuditRecordSchema).check(z.maxLength(VAULT_LIMITS.items)),
    }),
    z.strictObject({
      kind: z.literal('scrubbed'),
      text: z.string().check(z.maxLength(VAULT_LIMITS.frameBytes)),
    }),
    z.strictObject({ kind: z.literal('ok') }),
  ]),
})
export type VaultBrokerResponse = z.infer<typeof vaultBrokerResponseSchema>

export const vaultBrokerEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('locked'),
    v: z.literal(VAULT_PROTOCOL_VERSION),
    lockEpoch: counter,
  }),
  z.strictObject({
    kind: z.literal('revoked'),
    v: z.literal(VAULT_PROTOCOL_VERSION),
    requesterId: id,
    grantId: z.nullable(id),
  }),
  z.strictObject({
    kind: z.literal('approval'),
    v: z.literal(VAULT_PROTOCOL_VERSION),
    request: vaultApprovalRequestSchema,
  }),
])

export const vaultBrokerLockSchema = z.strictObject({
  v: z.literal(VAULT_PROTOCOL_VERSION),
  processId: counter.check(z.positive()),
  startedAt: counter,
  brokerId: id,
  userSession: text,
  socket: text,
})

/** Values are admitted only on this private channel, never on MHP or a webview. */
export const vaultPrivateReadSchema = z.strictObject({
  v: z.literal(VAULT_PROTOCOL_VERSION),
  kind: z.literal('firstPartyRead'),
  itemId: id,
  origin: vaultOriginSchema,
  client: z.enum(['model', 'voice', 'tab', 'judge', 'provider', 'maker']),
})
export const vaultPrivateMaterialSchema = z.strictObject({
  v: z.literal(VAULT_PROTOCOL_VERSION),
  kind: z.literal('material'),
  requestId: id,
  encoding: z.literal('base64'),
  bytes: vaultEncodedSchema,
})

/** Remote transport cannot express environment, password, items, grants or approvals. */
export const vaultRemoteRequestSchema = z.strictObject({
  v: z.literal(VAULT_PROTOCOL_VERSION),
  id,
  owningDeviceId: id,
  use: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('ssh'),
      host: text,
      hostKeyFingerprint: text.check(z.regex(/^SHA256:[A-Za-z0-9+/]{43}$/u)),
      remoteUser: text,
      sessionDigest: digest,
      forwarding: z.literal(false),
    }),
    z.strictObject({
      kind: z.literal('totp'),
      origin: vaultOriginSchema.check(z.startsWith('https://')),
    }),
  ]),
})

/** B authenticates this out-of-band result; it cannot be supplied by a tool frame. */
export interface VaultAuthenticatedPeer {
  readonly hostId: string
  readonly processId: number
  readonly userId: string
  readonly ui: boolean
}
export interface VaultChannelPort {
  authenticate(): Promise<VaultAuthenticatedPeer>
  close(): void
}
export interface VaultBrokerPort {
  readonly clock: VaultClockPort
  status(): Promise<VaultStatus>
  list(requester: VaultRequester): Promise<readonly VaultItemMetadata[]>
  request(
    requester: VaultRequester,
    handle: string,
    use: VaultUse,
    taint: VaultTaint,
  ): Promise<VaultAuthorizationResult>
  answer(peer: VaultAuthenticatedPeer, answer: VaultApprovalAnswer): Promise<VaultApprovalResult>
  lock(): Promise<void>
}
