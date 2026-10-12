import * as z from 'zod/mini'
import { VAULT_LIMITS, VAULT_PROTOCOL_VERSION, VAULT_RECOVERY_BYTES } from './constants'
import {
  vaultBrokerEventSchema,
  vaultStatusSchema,
  vaultWireCounter,
  vaultWireId,
  vaultWireText,
  type VaultStatus,
} from './vaultStatus'
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

const id = vaultWireId
const digest = z.string().check(z.regex(/^[a-f0-9]{64}$/u))
const text = vaultWireText
const counter = vaultWireCounter
const handle = z.string().check(z.regex(/^secret:\/\/[a-z][a-z0-9-]{0,47}$/u))
const importReceipt = z.string().check(z.regex(/^[a-f0-9-]{36}$/u))
const publicItem = vaultItemMetadataSchema.check(
  z.refine((v) => !v.hidden && !v.firstParty && !['devicePair', 'internal'].includes(v.kind)),
)

export {
  vaultStatusSchema,
  vaultBrokerEventSchema,
  type VaultStatus,
  type VaultBrokerEvent,
} from './vaultStatus'

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
    // After an import: keep the source file, or delete it once verified.
    z.strictObject({ kind: z.literal('importKeep'), receipt: importReceipt }),
    z.strictObject({ kind: z.literal('importDelete'), receipt: importReceipt }),
    // Reset Vault, two steps: a challenge, then the typed confirmation word.
    z.strictObject({ kind: z.literal('resetBegin') }),
    z.strictObject({ kind: z.literal('resetConfirm'), resetId: id, word: text }),
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
  'importKeep',
  'importDelete',
  'resetBegin',
  'resetConfirm',
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
    // The per-item import report: metadata only, never a value.
    z.strictObject({
      kind: z.literal('imported'),
      receipt: importReceipt,
      items: z
        .array(vaultItemMetadataSchema)
        .check(z.minLength(1), z.maxLength(VAULT_LIMITS.items)),
    }),
    z.strictObject({ kind: z.literal('resetChallenge'), resetId: id, word: text }),
    // A refused management call names why, without exception text.
    z.strictObject({
      kind: z.literal('refused'),
      reason: z.enum([
        'locked',
        'uncreated',
        'exists',
        // RVCM1091D P2: an item or path collision is not "a vault already
        // exists"; it has its own reason and sentence.
        'conflict',
        // RVCM1091E P2: a Delete refused because the source changed after a
        // successful import is not an add/import collision.
        'deleteConflict',
        // RVCM1091F P3: a Delete that removed the source and then could not
        // forget its receipt. The file is gone; nothing to retry.
        'sourceGone',
        // RVCM1091G P2: a Delete whose source cannot be read (permissions).
        // The receipt stays; the sentence names the true reason.
        'sourceUnreadable',
        // RVAPP-CM1091D5 P3-1: the source's location is not available (a
        // drive down or away). Never "gone": the receipt stays.
        'sourceUnavailable',
        'busy',
        'invalid',
        'rollback',
        'io',
        'storeUnavailable',
      ]),
    }),
  ]),
})
export type VaultBrokerResponse = z.infer<typeof vaultBrokerResponseSchema>

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
