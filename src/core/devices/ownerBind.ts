// M100 lane K: pairs bound to their owners. A device serves two
// orchestrators only with separate grants and quotas per owner.
// Security-relevant actions authorize per message by role under
// least-privilege time-bounded revocable grants, and every one is audited.
// Brokered uses go through the vault; secrets never cross in the clear.
import { randomBytes } from 'node:crypto'
import * as z from 'zod/mini'
import { DEVICE_LIMITS, VAULT_KEY_BYTES } from '../../shared/constants'
import {
  DEVICE_GRANT_MODE_ORDER,
  deviceGrantRefusalSchema,
  deviceGrantSchema,
  type DeviceCaps,
  type DeviceGrant,
  type DeviceGrantMode,
  type DeviceGrantRefusal,
} from '../../shared/devices'
import {
  vaultRemoteRequestSchema,
  vaultRemoteResponseSchema,
  type VaultAuthenticatedPeer,
} from '../../shared/vaultProtocol'
import {
  vaultRequesterSchema,
  vaultSlotRecordSchema,
  type VaultRequester,
  type VaultSlotPort,
  type VaultSlotRecord,
} from '../../shared/vault'
import {
  openVaultBlock,
  randomVaultBytes,
  sealVaultBlock,
  vaultBlockSchema,
  type VaultBlockContext,
} from '../vault/crypto'
import type { MultiplexedDeviceMessage } from './channel'
import { DevicePairingError, validateDevicePair, type DevicePair } from './pairing'
import {
  hasConsumedVaultRemoteUse,
  type VaultRemoteChannelPort,
  type VaultRemoteConsumerPorts,
  type VaultRemoteOwner,
} from '../vault/remote'

const id = z.string().check(z.regex(/^[a-f0-9]{32}$(?![\s\S])/))
const fingerprint = z.string().check(z.regex(/^[a-f0-9]{64}$(?![\s\S])/))
const timestamp = z.int().check(z.gte(0))

export const deviceOwnerBindingSchema = z.strictObject({
  pairId: id,
  ownerId: id,
  localDeviceId: id,
  peerDeviceId: id,
  localFingerprint: fingerprint,
  peerFingerprint: fingerprint,
  boundAt: timestamp,
})
export type DeviceOwnerBinding = z.infer<typeof deviceOwnerBindingSchema>

/**
One pair may carry several owners — two orchestrators on one channel —
and one device may serve and request over the same pair, so a binding is
keyed by pair, owner and the binding side's own device. Every binding is
made only at pairing completion by the local host, never from a wire
message. The pair id already covers both invitations, so a repeated bind
of the same key is the same binding.
*/
export class DeviceOwnerBindings {
  private static key(pairId: string, ownerId: string, localDeviceId: string): string {
    return `${pairId}:${ownerId}:${localDeviceId}`
  }
  private readonly bindings = new Map<string, DeviceOwnerBinding>()
  public bind(pair: DevicePair, ownerId: string, now: number): DeviceOwnerBinding {
    const validated = id.parse(ownerId)
    const pairId = validateDevicePair(pair, now, true)
    const key = DeviceOwnerBindings.key(pairId, validated, pair.local.deviceId)
    const existing = this.bindings.get(key)
    if (existing !== undefined) return existing
    const binding = deviceOwnerBindingSchema.parse({
      pairId,
      ownerId: validated,
      localDeviceId: pair.local.deviceId,
      peerDeviceId: pair.peer.deviceId,
      localFingerprint: pair.local.fingerprint,
      peerFingerprint: pair.peer.fingerprint,
      boundAt: now,
    })
    this.bindings.set(key, binding)
    return binding
  }
  public resolve(
    pairId: string,
    ownerId: string,
    localDeviceId?: string,
  ): DeviceOwnerBinding | undefined {
    if (localDeviceId !== undefined)
      return this.bindings.get(DeviceOwnerBindings.key(pairId, ownerId, localDeviceId))
    for (const binding of this.bindings.values())
      if (binding.pairId === pairId && binding.ownerId === ownerId) return binding
    return undefined
  }
  public hasPair(pairId: string): boolean {
    for (const binding of this.bindings.values()) if (binding.pairId === pairId) return true
    return false
  }
  /**
  The lane-K validity check: a valid pair key for the wrong owner fails
  here, after TLS authenticated the key. Unknown pair reads unpaired;
  a known pair with no binding for this owner reads grant. The grant
  path omits the side: grants are owner-scoped, never device-scoped.
  */
  public assertOwner(
    pairId: string,
    ownerId: string,
    localDeviceId?: string,
    peerFingerprint?: string,
  ): DeviceOwnerBinding {
    const binding = this.resolve(pairId, ownerId, localDeviceId)
    if (binding === undefined)
      throw new DevicePairingError(this.hasPair(pairId) ? 'grant' : 'unpaired')
    if (peerFingerprint !== undefined && peerFingerprint !== binding.peerFingerprint)
      throw new DevicePairingError('grant')
    return binding
  }
}

export const DEVICE_OWNER_AUDIT_ACTIONS = [
  'bind',
  'issue',
  'revoke',
  'authorize',
  'spend',
  'serve',
  'request',
] as const
// Value-free: digests bind a record to its message, never its bytes.
export const deviceOwnerAuditSchema = z.strictObject({
  at: timestamp,
  pairId: id,
  ownerId: id,
  action: z.enum(DEVICE_OWNER_AUDIT_ACTIONS),
  decision: z.enum(['allow', 'deny']),
  reason: z.optional(z.string().check(z.minLength(1))),
  grantId: z.optional(id),
  messageDigest: z.optional(z.string().check(z.regex(/^[a-f0-9]{64}$(?![\s\S])/))),
})
export type DeviceOwnerAuditRecord = z.infer<typeof deviceOwnerAuditSchema>
export interface DeviceOwnerAuditPort {
  append(record: DeviceOwnerAuditRecord): Promise<void>
}
export class DeviceOwnerAudit {
  public constructor(private readonly port: DeviceOwnerAuditPort) {}
  public async record(
    input: Omit<DeviceOwnerAuditRecord, 'at'> & { at?: number },
    now: () => number = Date.now,
  ): Promise<DeviceOwnerAuditRecord> {
    const record = deviceOwnerAuditSchema.parse({ ...input, at: input.at ?? now() })
    try {
      await this.port.append(record)
    } catch (error) {
      // Fail closed: an action the audit did not record did not happen.
      throw new DevicePairingError('storage', { cause: error })
    }
    return record
  }
}

export interface DeviceOwnerAuthMessage {
  readonly pairId: string
  readonly ownerId: string
  readonly roleId: string
  readonly grantId: string
  readonly grantRevision: number
  readonly mode?: DeviceGrantMode
  readonly quota?: DeviceCaps
}
const deviceOwnerQuotaFields = [
  'workers',
  'processes',
  'heavyChecks',
  'tokens',
  'spendUsd',
  'artifactBytes',
] as const
function zeroCaps(): DeviceCaps {
  return { workers: 0, processes: 0, heavyChecks: 0, tokens: 0, spendUsd: 0, artifactBytes: 0 }
}
function isUsage(value: DeviceCaps): boolean {
  return deviceOwnerQuotaFields.every((field) => Number.isFinite(value[field]) && value[field] >= 0)
}
const deviceOwnerUsageField = z.number().check(
  z.gte(0),
  z.refine((value) => Number.isFinite(value)),
)

/**
Per-owner grants and quotas. One owner's spend never changes another
owner's ledger; a grant superseded, expired or revoked refuses its
replay. Grant currency is lane K's; scope ceilings stay lane A's.
*/
export class DeviceOwnerGrants {
  private static key(ownerId: string, grantId: string): string {
    return `${ownerId}:${grantId}`
  }
  private readonly grants = new Map<string, DeviceGrant>()
  private readonly revoked = new Set<string>()
  private readonly used = new Map<string, DeviceCaps>()
  public constructor(
    private readonly bindings: DeviceOwnerBindings,
    private readonly audit: DeviceOwnerAudit,
  ) {}
  private refusal(
    message: DeviceOwnerAuthMessage,
    reason: DeviceGrantRefusal['reason'],
  ): DeviceGrantRefusal {
    return deviceGrantRefusalSchema.parse({
      version: DEVICE_LIMITS.protocolVersion,
      pairId: message.pairId,
      ownerId: message.ownerId,
      reason,
      retryable: false,
    })
  }
  public async issue(grant: DeviceGrant): Promise<DeviceGrant> {
    const parsed = deviceGrantSchema.parse(grant)
    this.bindings.assertOwner(parsed.pairId, parsed.ownerId)
    const key = DeviceOwnerGrants.key(parsed.ownerId, parsed.grantId)
    const current = this.grants.get(key)
    if (
      current !== undefined &&
      (parsed.grantRevision <= current.grantRevision || this.revoked.has(key))
    )
      throw new DevicePairingError('grant')
    this.grants.set(key, parsed)
    await this.audit.record({
      pairId: parsed.pairId,
      ownerId: parsed.ownerId,
      action: 'issue',
      decision: 'allow',
      grantId: parsed.grantId,
    })
    return parsed
  }
  public async revoke(ownerId: string, grantId: string, pairId: string): Promise<void> {
    if (!id.safeParse(grantId).success) throw new DevicePairingError('invalid-frame')
    const binding = this.bindings.assertOwner(pairId, ownerId)
    this.revoked.add(DeviceOwnerGrants.key(ownerId, grantId))
    await this.audit.record({
      pairId: binding.pairId,
      ownerId,
      action: 'revoke',
      decision: 'allow',
      grantId,
    })
  }
  /**
  The current grant for a (pair, owner, role) claim, in whatever state it
  is in: authorize() below reads the precise outcome — expired, revoked
  or superseded — rather than a lookup miss.
  */
  public find(pairId: string, ownerId: string, roleId: string): DeviceGrant | undefined {
    for (const grant of this.grants.values())
      if (grant.pairId === pairId && grant.ownerId === ownerId && grant.roleId === roleId)
        return grant
    return undefined
  }
  public usedBy(ownerId: string): DeviceCaps {
    return { ...(this.used.get(ownerId) ?? zeroCaps()) }
  }
  public async spend(ownerId: string, pairId: string, usage: DeviceCaps): Promise<DeviceCaps> {
    if (!isUsage(usage)) throw new DevicePairingError('grant')
    const binding = this.bindings.assertOwner(pairId, ownerId)
    const total = this.usedBy(ownerId)
    for (const field of deviceOwnerQuotaFields) total[field] += usage[field]
    this.used.set(ownerId, total)
    await this.audit.record({ pairId: binding.pairId, ownerId, action: 'spend', decision: 'allow' })
    return this.usedBy(ownerId)
  }
  /**
  Per-message authorization: binding, then grant currency (owner, time,
  revision, role, mode ceiling, per-owner quota). Denials audit with
  their reason; nothing here consults a wire claim beyond the message.
  */
  public async authorize(
    message: DeviceOwnerAuthMessage,
    now: number,
  ): Promise<DeviceGrant | DeviceGrantRefusal> {
    // Malformed wire input refuses typed before any refusal is built, so
    // deny() below always holds valid ids and a refusal always parses.
    const shaped = z
      .strictObject({
        pairId: id,
        ownerId: id,
        roleId: id,
        grantId: id,
        grantRevision: z.int().check(z.gte(1)),
        mode: z.optional(z.enum(DEVICE_GRANT_MODE_ORDER)),
        quota: z.optional(
          z.strictObject({
            workers: deviceOwnerUsageField,
            processes: deviceOwnerUsageField,
            heavyChecks: deviceOwnerUsageField,
            tokens: deviceOwnerUsageField,
            spendUsd: deviceOwnerUsageField,
            artifactBytes: deviceOwnerUsageField,
          }),
        ),
      })
      .safeParse(message)
    if (!shaped.success) throw new DevicePairingError('invalid-frame')
    const deny = async (reason: DeviceGrantRefusal['reason']): Promise<DeviceGrantRefusal> => {
      const refusal = this.refusal(message, reason)
      await this.audit.record({
        pairId: message.pairId,
        ownerId: message.ownerId,
        action: 'authorize',
        decision: 'deny',
        reason,
        grantId: message.grantId,
      })
      return refusal
    }
    let binding: DeviceOwnerBinding
    try {
      binding = this.bindings.assertOwner(message.pairId, message.ownerId)
    } catch (error) {
      // The binding check reads unpaired/grant only; anything else stays loud.
      if (error instanceof DevicePairingError && error.reason === 'unpaired')
        return await deny('unknown-owner')
      if (error instanceof DevicePairingError && error.reason === 'grant')
        return await deny('owner-mismatch')
      throw error
    }
    const key = DeviceOwnerGrants.key(message.ownerId, message.grantId)
    const grant = this.grants.get(key)
    if (grant === undefined || this.revoked.has(key)) return await deny('grant-revoked')
    if (
      grant.pairId !== binding.pairId ||
      grant.ownerId !== binding.ownerId ||
      grant.roleId !== message.roleId
    )
      return await deny('owner-mismatch')
    if (
      !Number.isSafeInteger(now) ||
      now < grant.issuedAt ||
      now >= grant.expiresAt ||
      message.grantRevision !== grant.grantRevision
    )
      return await deny('grant-expired')
    if (
      message.mode !== undefined &&
      DEVICE_GRANT_MODE_ORDER.indexOf(message.mode) > DEVICE_GRANT_MODE_ORDER.indexOf(grant.mode)
    )
      return await deny('scope-denied')
    if (message.quota !== undefined) {
      const used = this.usedBy(message.ownerId)
      const quota = message.quota
      const isOverQuota = deviceOwnerQuotaFields.some(
        (field) => quota[field] + used[field] > grant.quota[field],
      )
      if (isOverQuota) return await deny('quota-exceeded')
    }
    await this.audit.record({
      pairId: binding.pairId,
      ownerId: binding.ownerId,
      action: 'authorize',
      decision: 'allow',
      grantId: grant.grantId,
    })
    return grant
  }
}

// ---- Brokered uses over the M100 channel (with M109 lane R). ----

/**
The lane-K side of one multiplexed channel. The host adapts its paced
channel; drills adapt a capture harness. One channel serves one binding:
a request for another owning device is denied, never routed.
*/
export interface DeviceOwnerChannel {
  send(message: MultiplexedDeviceMessage): void
  subscribe(listener: (message: MultiplexedDeviceMessage) => void): () => void
  subscribeClose(listener: () => void): () => void
  readonly closed: boolean
}
export type DeviceOwnerVaultRequest = ReturnType<typeof vaultRemoteRequestSchema.parse>

function vaultRequesterFor(peer: VaultAuthenticatedPeer, deviceId: string): VaultRequester {
  // The broker-authenticated local peer binds host and process; the
  // binding binds the device. A malformed local peer refuses typed.
  if (
    !id.safeParse(peer.hostId).success ||
    !Number.isSafeInteger(peer.processId) ||
    peer.processId <= 0
  )
    throw new DevicePairingError('storage')
  return vaultRequesterSchema.parse({
    id: randomBytes(DEVICE_LIMITS.idChars / 2).toString('hex'),
    hostId: peer.hostId,
    conversationId: null,
    taskId: null,
    // The remote side acts as an orchestrator; the pair's role grants
    // scope what it may ask, and every use still needs its own approval.
    role: { kind: 'orchestrator' },
    workspaceId: null,
    deviceId,
    // The serving process: the remote pid is unknowable across the pair.
    peerProcessId: peer.processId,
    sessionId: null,
    // D89.13: a remote use is never unattended.
    unattended: false,
    source: 'device',
  })
}

/**
The owner side's channel facts for M109 lane R: verified binding facts,
never facts copied from a request payload. The peer device is the
requester; this device owns the vault that approves the use.
*/
export function ownerVaultChannel(
  binding: DeviceOwnerBinding,
  peer: VaultAuthenticatedPeer,
  channel: DeviceOwnerChannel,
): VaultRemoteChannelPort {
  return {
    authenticate: () =>
      Promise.resolve({
        pinnedMutualTls: true as const,
        deviceId: binding.peerDeviceId,
        owningDeviceId: binding.localDeviceId,
        requester: vaultRequesterFor(peer, binding.peerDeviceId),
      }),
    subscribeClose: (listener: () => void) => channel.subscribeClose(listener),
    send: (response) => {
      // Lane R's answer crosses only as its own strict shape.
      channel.send({ kind: 'vaultResponse', response: vaultRemoteResponseSchema.parse(response) })
    },
  }
}

/**
Serves one brokered-use request received over the channel. Returns
whether the owner approved a use; the vault answer itself travels only
as lane R's capability-only response. Every serve is audited.
*/
export async function serveOwnerBrokeredUse(
  owner: VaultRemoteOwner,
  channel: DeviceOwnerChannel,
  binding: DeviceOwnerBinding,
  peer: VaultAuthenticatedPeer,
  message: MultiplexedDeviceMessage,
  audit: DeviceOwnerAudit,
): Promise<'allowed' | 'denied'> {
  const request = vaultRemoteRequestSchema.safeParse(
    message.kind === 'vaultRequest' ? message.request : undefined,
  )
  if (!request.success) throw new DevicePairingError('invalid-frame')
  const outcome: { decision: 'allowed' | 'denied' } = { decision: 'denied' }
  const observing: DeviceOwnerChannel = {
    ...channel,
    send: (outgoing) => {
      if (
        outgoing.kind === 'vaultResponse' &&
        outgoing.response.id === request.data.id &&
        outgoing.response.result.kind !== 'denied'
      )
        outcome.decision = 'allowed'
      channel.send(outgoing)
    },
  }
  try {
    await owner.serve(ownerVaultChannel(binding, peer, observing), request.data)
  } catch (error) {
    await audit.record({
      pairId: binding.pairId,
      ownerId: binding.ownerId,
      action: 'serve',
      decision: 'deny',
      reason: 'serve-failed',
    })
    throw error
  }
  await audit.record({
    pairId: binding.pairId,
    ownerId: binding.ownerId,
    action: 'serve',
    decision: outcome.decision === 'allowed' ? 'allow' : 'deny',
    ...(outcome.decision !== 'allowed' && { reason: 'denied' }),
  })
  return outcome.decision
}

function exchangeVaultMessage(
  channel: DeviceOwnerChannel,
  request: DeviceOwnerVaultRequest,
  signal: AbortSignal,
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const cleanup = () => {
      unsubscribe()
      unsubscribeClose()
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(new DevicePairingError('blocked-or-unreachable'))
    }
    const unsubscribe = channel.subscribe((message) => {
      if (message.kind !== 'vaultResponse' || message.response.id !== request.id) return
      cleanup()
      resolve(message.response)
    })
    const unsubscribeClose = channel.subscribeClose(onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted || channel.closed) {
      onAbort()
      return
    }
    channel.send({ kind: 'vaultRequest', request })
  })
}

/**
The receiver side's call site: sends one brokered-use request over the
channel and consumes the bound reply through lane R, which delivers the
capability bytes only to the caller's private sink. Returns whether a
use was consumed. Every request is audited.
*/
export async function hasConsumedOwnerBrokeredUse(
  channel: DeviceOwnerChannel,
  binding: DeviceOwnerBinding,
  peer: VaultAuthenticatedPeer,
  request: DeviceOwnerVaultRequest,
  deliver: VaultRemoteConsumerPorts['deliver'],
  signal: AbortSignal,
  audit: DeviceOwnerAudit,
): Promise<boolean> {
  const parsed = vaultRemoteRequestSchema.safeParse(request)
  if (!parsed.success) throw new DevicePairingError('invalid-frame')
  const ports: VaultRemoteConsumerPorts = {
    requester: vaultRequesterFor(peer, binding.localDeviceId),
    authenticate: () =>
      Promise.resolve({ pinnedMutualTls: true as const, owningDeviceId: binding.peerDeviceId }),
    subscribeClose: (listener: () => void) => channel.subscribeClose(listener),
    exchange: (input: unknown, exchangeSignal: AbortSignal) =>
      exchangeVaultMessage(channel, vaultRemoteRequestSchema.parse(input), exchangeSignal),
    deliver,
  }
  const isConsumed = await hasConsumedVaultRemoteUse(parsed.data, ports, signal)
  await audit.record({
    pairId: binding.pairId,
    ownerId: binding.ownerId,
    action: 'request',
    decision: isConsumed ? 'allow' : 'deny',
    ...(!isConsumed && { reason: 'denied' }),
  })
  return isConsumed
}

// ---- Pair keys under OS store protection. ----

/** Fixed technical word for the slot, beside the broker's own 'unlock'. */
const PAIR_KEY_USE = 'device-pair-key'
const PEM_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----'

/**
A pair private key at rest: the PEM sealed under a fresh data key, the
data key wrapped by the caller's OS-store slot — on Windows M109 P's
DPAPI tier. No PEM bytes anywhere in the envelope; the seal binds the
pair, so an envelope swapped onto another pair fails authentication.
*/
export const devicePairKeyEnvelopeSchema = z.strictObject({
  pairId: id,
  slot: vaultSlotRecordSchema,
  block: vaultBlockSchema,
})
export type DevicePairKeyEnvelope = z.infer<typeof devicePairKeyEnvelopeSchema>

function pairKeyContext(pairId: string, slot: VaultSlotRecord): VaultBlockContext {
  return {
    vaultId: slot.vaultId,
    id: slot.id,
    kind: JSON.stringify({ kind: 'device-pair-key', pairId }),
    generation: 0,
  }
}

export async function protectPairKey(
  slot: VaultSlotPort,
  pairId: string,
  pem: string,
): Promise<DevicePairKeyEnvelope> {
  if (!id.safeParse(pairId).success) throw new DevicePairingError('invalid-frame')
  if (
    !pem.startsWith(PEM_PRIVATE_KEY) ||
    Buffer.byteLength(pem, 'utf8') > DEVICE_LIMITS.certificateBase64Chars
  )
    throw new DevicePairingError('storage')
  const dataKey = randomVaultBytes(VAULT_KEY_BYTES)
  try {
    const record = await slot.wrap(dataKey)
    const pemBytes = Buffer.from(pem, 'utf8')
    try {
      const block = sealVaultBlock(dataKey, pairKeyContext(pairId, record), pemBytes)
      return devicePairKeyEnvelopeSchema.parse({ pairId, slot: record, block })
    } finally {
      pemBytes.fill(0)
    }
  } finally {
    dataKey.fill(0)
  }
}

/** Opens a pair private key protected by protectPairKey. */
export async function unprotectPairKey(slot: VaultSlotPort, envelope: unknown): Promise<string> {
  const parsed = devicePairKeyEnvelopeSchema.safeParse(envelope)
  if (!parsed.success) throw new DevicePairingError('storage')
  const dataKey = await slot.unwrap(parsed.data.slot, PAIR_KEY_USE)
  try {
    const pemBytes = openVaultBlock(
      dataKey,
      pairKeyContext(parsed.data.pairId, parsed.data.slot),
      parsed.data.block,
    )
    try {
      const pem = pemBytes.toString('utf8')
      if (
        !pem.startsWith(PEM_PRIVATE_KEY) ||
        Buffer.byteLength(pem, 'utf8') > DEVICE_LIMITS.certificateBase64Chars
      )
        throw new DevicePairingError('storage')
      return pem
    } finally {
      pemBytes.fill(0)
    }
  } finally {
    dataKey.fill(0)
  }
}
