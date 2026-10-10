import * as z from 'zod/mini'
import { VAULT_LIMITS, VAULT_PROTOCOL_VERSION, VAULT_RECOVERY_BYTES } from './constants'
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
  // v2: `uncreated` until Set Up Vault; `setupPending` while the one-time
  // recovery code waits for "I Saved It" (nothing is written before that).
  state: z.enum([
    'uncreated',
    'setupPending',
    'locked',
    'unlocked',
    'unavailable',
    'firstPartyOnly',
  ]),
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

/** v2 `snapshot`: the value-free management view (every item, grants, pending cards). */
export const vaultBrokerSnapshotSchema = z.strictObject({
  status: vaultStatusSchema,
  // Pending setup only: the id the confirmation must echo; never the code.
  setupId: z.nullable(id),
  items: z.array(vaultItemMetadataSchema).check(z.maxLength(VAULT_LIMITS.items)),
  grants: z.array(vaultGrantSchema).check(z.maxLength(VAULT_LIMITS.grants)),
  pending: z.array(vaultApprovalRequestSchema).check(z.maxLength(VAULT_LIMITS.items)),
})
export type VaultBrokerSnapshot = z.infer<typeof vaultBrokerSnapshotSchema>

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
    // null: the broker picks the silent slot (the OS store) itself.
    z.strictObject({ kind: z.literal('unlock'), slotId: z.nullable(id) }),
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
    // v2 management kinds (manage-only connections: a host's own UI or the
    // CLI). None carries a value; `add`/`edit` with material and `recover`
    // travel only as private frames (vaultPrivateRequestSchema below).
    z.strictObject({ kind: z.literal('snapshot') }),
    z.strictObject({ kind: z.literal('editMetadata'), metadata: vaultItemMetadataSchema }),
    z.strictObject({ kind: z.literal('remove'), itemId: id }),
    // The broker reads exactly this user-picked file (M's import port).
    z.strictObject({ kind: z.literal('import'), path: text }),
    z.strictObject({ kind: z.literal('publicKey'), itemId: id }),
    // The connection then carries pushed vaultBrokerEventFrameSchema frames
    // until it closes; it accepts no further request.
    z.strictObject({ kind: z.literal('watch') }),
    z.strictObject({ kind: z.literal('setup'), protection: z.literal('auto') }),
    z.strictObject({ kind: z.literal('confirmSetup'), setupId: id }),
    z.strictObject({ kind: z.literal('cancelSetup'), setupId: id }),
  ]),
})
export type VaultBrokerRequest = z.infer<typeof vaultBrokerRequestSchema>
/** Request kinds only a manage connection (the host's UI or the CLI) may send. */
export const VAULT_MANAGE_ONLY_KINDS = [
  'lock',
  'unlock',
  'grant',
  'revoke',
  'audit',
  'snapshot',
  'editMetadata',
  'remove',
  'import',
  'publicKey',
  'watch',
  'setup',
  'confirmSetup',
  'cancelSetup',
] as const satisfies readonly VaultBrokerRequest['request']['kind'][]

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
    z.strictObject({ kind: z.literal('snapshot'), snapshot: vaultBrokerSnapshotSchema }),
    z.strictObject({ kind: z.literal('publicKey'), publicKey: text }),
    // A refused management call names why, without exception text.
    z.strictObject({
      kind: z.literal('refused'),
      reason: z.enum(['locked', 'uncreated', 'exists', 'busy', 'invalid', 'rollback', 'io']),
    }),
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
  // v2: an item, grant, slot or setup change committed by any window or the CLI.
  z.strictObject({ kind: z.literal('changed'), v: z.literal(VAULT_PROTOCOL_VERSION) }),
])
export type VaultBrokerEvent = z.infer<typeof vaultBrokerEventSchema>
/** v2 `watch`: pushed frames carry no sequence, so they never answer a request. */
export const vaultBrokerEventFrameSchema = z.strictObject({
  v: z.literal(VAULT_PROTOCOL_VERSION),
  event: vaultBrokerEventSchema,
})

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
/**
 * v2 item writes (manage-only). `material` is the base64 of crypto.ts's
 * encodeVaultMaterial; the broker decodes, validates kind against metadata and
 * erases its copy. `add` refuses an existing id or name; `edit` an absent id.
 */
const privateWrite = <K extends 'add' | 'edit'>(kind: K) =>
  z.strictObject({
    v: z.literal(VAULT_PROTOCOL_VERSION),
    kind: z.literal(kind),
    metadata: vaultItemMetadataSchema,
    encoding: z.literal('base64'),
    material: vaultEncodedSchema,
  })
export const vaultPrivateAddSchema = privateWrite('add')
export const vaultPrivateEditSchema = privateWrite('edit')
/** The one-time recovery code: VAULT_RECOVERY_BYTES as lowercase hex (keyslots.ts). */
const recoveryCode = z
  .string()
  .check(z.regex(new RegExp(`^[a-f0-9]{${String(VAULT_RECOVERY_BYTES * 2)}}$`, 'u')))
/** Unlock through the recovery slot when every other slot is lost (acceptance 1). */
export const vaultPrivateRecoverSchema = z.strictObject({
  v: z.literal(VAULT_PROTOCOL_VERSION),
  kind: z.literal('recover'),
  code: recoveryCode,
})
export const vaultPrivateRequestSchema = z.discriminatedUnion('kind', [
  vaultPrivateReadSchema,
  vaultPrivateAddSchema,
  vaultPrivateEditSchema,
  vaultPrivateRecoverSchema,
])
export type VaultPrivateRequest = z.infer<typeof vaultPrivateRequestSchema>
/** The answer to `setup`: shown once, then the vault waits for confirmSetup. */
export const vaultPrivateRecoveryCodeSchema = z.strictObject({
  v: z.literal(VAULT_PROTOCOL_VERSION),
  kind: z.literal('recoveryCode'),
  setupId: id,
  code: recoveryCode,
})
export const vaultPrivateResponseSchema = z.discriminatedUnion('kind', [
  vaultPrivateMaterialSchema,
  vaultPrivateRecoveryCodeSchema,
])

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
