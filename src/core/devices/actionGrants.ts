// Receiver-owned authority. Peer requests carry ceilings, never local approvals.
import path from 'node:path'
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import { DEVICE_LIMITS } from '../../shared/constants'
import {
  DEVICE_GRANT_MODE_ORDER,
  DEVICE_STEP_UP_METHODS,
  deviceGrantRequestSchema,
  deviceGrantSchema,
  deviceGrantRefusalSchema,
  deviceStepUpSchema,
  grantCeilingRefusal,
  type DeviceActionGrantPort,
  type DeviceCaps,
  type DeviceGrant,
  type DeviceGrantCeiling,
  type DeviceGrantRequest,
  type DeviceGrantRefusal,
  type DeviceStepUpApproval,
  type DeviceDispatch,
} from '../../shared/devices'
import { UI_TEXT, fill } from '../../shared/l10n/text'
import { isProtectedPath } from '../protectedPaths'

export interface DeviceLocalAction {
  /** Selected by the receiver's tool registry, never a peer/model safety hint. */
  readonly operation:
    | 'read'
    | 'write'
    | 'check'
    | 'offline'
    | 'observe'
    | 'connect'
    | 'program'
    | 'actuate'
    | 'refused'
  readonly tool: string
  readonly paths: readonly string[]
  readonly payload: Uint8Array
}
export interface DeviceReceiverActionState {
  readonly grant: DeviceGrant
  readonly revoked: boolean
  readonly repository: DeviceGrantRequest
  readonly role: DeviceGrantCeiling & { readonly roleId: string; readonly tools: readonly string[] }
  readonly trusted: boolean
  readonly protectedPaths: readonly string[]
  readonly approval: DeviceGrantCeiling & { readonly allowed: boolean }
  /** Only receiver-recorded occupancy/liability; no peer settlement input. */
  readonly used: DeviceCaps
  readonly action: DeviceLocalAction
}
export interface DevicePresencePort {
  /** Show exact bytes and answer on this device. Closing/cancelling rejects. */
  confirm(input: {
    readonly actionDigest: string
    readonly action: DeviceLocalAction
    readonly method: (typeof DEVICE_STEP_UP_METHODS)[number]
    readonly signal: AbortSignal
  }): Promise<boolean>
}
interface ActionGrantDeps {
  readonly senderCeiling: (request: DeviceGrantRequest) => DeviceGrantCeiling
  /** Fresh, synchronous local snapshot, so no yield separates intersection and decision. */
  readonly current: (request: DeviceGrantRequest) => DeviceReceiverActionState
  readonly presence: DevicePresencePort
  readonly now: () => number
}
const quotaFields = [
  'workers',
  'processes',
  'heavyChecks',
  'tokens',
  'spendUsd',
  'artifactBytes',
] as const
function normalizedPath(value: string): string {
  return path.posix.normalize(value.replaceAll('\\', '/')).toLowerCase()
}
function isProtectedWrite(action: DeviceLocalAction, protectedPaths: readonly string[]): boolean {
  return (
    action.operation !== 'read' &&
    action.operation !== 'observe' &&
    action.paths.some((path) => {
      const target = normalizedPath(path)
      if (
        target === '..' ||
        target.startsWith('../') ||
        target.startsWith('/') ||
        /^[a-z]:/.test(target) ||
        isProtectedPath(target)
      )
        return true
      const segments = target.split('/')
      return protectedPaths.some((protectedPath) => {
        const protectedSegments = normalizedPath(protectedPath).replace(/\/$/, '').split('/')
        return segments.some((_segment, index) =>
          protectedSegments.every((part, offset) => segments[index + offset] === part),
        )
      })
    })
  )
}
export function deviceActionDigest(request: DeviceGrantRequest, action: DeviceLocalAction): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        request,
        operation: action.operation,
        tool: action.tool,
        paths: action.paths,
      }),
    )
    .update(action.payload)
    .digest('hex')
}
function requiresStepUp(state: DeviceReceiverActionState): boolean {
  return (
    state.grant.requiresStepUp || ['connect', 'program', 'actuate'].includes(state.action.operation)
  )
}
function approvalKey(approval: DeviceStepUpApproval): string {
  return JSON.stringify(approval)
}
type ActionAttempt = Pick<DeviceDispatch, 'identity' | 'payloadDigest'>
function attemptKey(attempt: ActionAttempt): string {
  // Receiver-owned dispatch context, after its strict boundary parse.
  return JSON.stringify({ identity: attempt.identity, payloadDigest: attempt.payloadDigest })
}
export class DeviceActionGrants implements DeviceActionGrantPort {
  private readonly attestations = new Map<
    string,
    {
      approval: DeviceStepUpApproval
      revision: number
      state: 'pending' | 'attested' | 'bound' | 'used'
      attempt?: string
    }
  >()
  private readonly pending = new Set<string>()
  public constructor(private readonly deps: ActionGrantDeps) {}
  private refusal(
    request: DeviceGrantRequest,
    reason: DeviceGrantRefusal['reason'],
  ): DeviceGrantRefusal {
    return deviceGrantRefusalSchema.parse({
      version: DEVICE_LIMITS.protocolVersion,
      pairId: request.pairId,
      ownerId: request.ownerId,
      reason,
      retryable: reason === 'step-up-required',
    })
  }
  private intersection(
    request: DeviceGrantRequest,
  ): DeviceGrantRefusal | { grant: DeviceGrant; state: DeviceReceiverActionState } {
    // This is the first admission guard, including before any receiver snapshot or prompt.
    const senderRefusal = grantCeilingRefusal(request, this.deps.senderCeiling(request))
    if (senderRefusal !== null) return deviceGrantRefusalSchema.parse(senderRefusal)
    const state = this.deps.current(request)
    const grant = deviceGrantSchema.parse(state.grant)
    if (state.revoked) return this.refusal(request, 'grant-revoked')
    const now = this.deps.now()
    if (now < grant.issuedAt || now >= grant.expiresAt)
      return this.refusal(request, 'grant-expired')
    const limits = [grant, state.repository, state.role, state.approval]
    const isScopeMatching = [grant, state.repository].every(
      (limit) =>
        limit.pairId === request.pairId &&
        limit.ownerId === request.ownerId &&
        limit.repositoryId === request.repositoryId &&
        limit.roleId === request.roleId &&
        (!request.lanes || limit.lanes) &&
        (!request.checks || limit.checks),
    )
    if (
      !isScopeMatching ||
      state.role.roleId !== request.roleId ||
      !state.trusted ||
      !state.approval.allowed ||
      !state.role.tools.includes(state.action.tool) ||
      state.action.operation === 'refused' ||
      state.action.payload.byteLength > DEVICE_LIMITS.frameBytes ||
      isProtectedWrite(state.action, state.protectedPaths) ||
      limits.some(
        (limit) =>
          DEVICE_GRANT_MODE_ORDER.indexOf(request.mode) >
          DEVICE_GRANT_MODE_ORDER.indexOf(limit.mode),
      ) ||
      (state.action.operation !== 'read' &&
        state.action.operation !== 'check' &&
        state.action.operation !== 'observe' &&
        request.mode === 'plan')
    )
      return this.refusal(request, 'scope-denied')
    return quotaFields.some(
      (field) =>
        !Number.isFinite(state.used[field]) ||
        state.used[field] < 0 ||
        request.quota[field] + state.used[field] >
          Math.min(...limits.map((limit) => limit.quota[field])),
    )
      ? this.refusal(request, 'quota-exceeded')
      : {
          grant: deviceGrantSchema.parse({
            ...grant,
            mode: request.mode,
            lanes: request.lanes,
            checks: request.checks,
            quota: request.quota,
          }),
          state,
        }
  }
  private admission(
    input: DeviceGrantRequest,
    attempt?: string,
  ): Promise<DeviceGrant | DeviceGrantRefusal> {
    const request = deviceGrantRequestSchema.parse(input)
    const result = this.intersection(request)
    if ('reason' in result) return Promise.resolve(result)
    const { state, grant } = result
    if (requiresStepUp(state)) {
      const digest = deviceActionDigest(request, state.action)
      const now = this.deps.now()
      for (const record of this.attestations.values()) {
        const approval = record.approval
        if (
          (record.state === 'attested' ||
            (attempt !== undefined && record.state === 'bound' && record.attempt === attempt)) &&
          approval.grantId === grant.grantId &&
          record.revision === grant.grantRevision &&
          approval.actionDigest === digest &&
          approval.approvedAt <= now &&
          now < approval.expiresAt &&
          now - approval.approvedAt <= DEVICE_LIMITS.stepUpValidityMs
        ) {
          record.state = attempt === undefined ? 'used' : 'bound'
          if (attempt !== undefined) record.attempt = attempt
          return Promise.resolve(grant)
        }
      }
      return Promise.resolve(this.refusal(request, 'step-up-required'))
    }
    return Promise.resolve(grant)
  }
  public admit(input: DeviceGrantRequest): Promise<DeviceGrant | DeviceGrantRefusal> {
    return this.admission(input)
  }
  public admitAttempt(
    input: DeviceGrantRequest,
    attempt: ActionAttempt,
  ): Promise<DeviceGrant | DeviceGrantRefusal> {
    return this.admission(input, attemptKey(attempt))
  }
  /** Spend after the start contract succeeds, or when a dispatch ends without starting. */
  public finishAttempt(attempt: ActionAttempt): void {
    const key = attemptKey(attempt)
    for (const record of this.attestations.values()) {
      if (record.state === 'bound' && record.attempt === key) record.state = 'used'
    }
  }
  public attestStepUp(input: DeviceStepUpApproval): Promise<void> {
    const approval = deviceStepUpSchema.parse(input)
    const record = this.attestations.get(approvalKey(approval))
    const now = this.deps.now()
    if (record?.state !== 'pending' || approval.approvedAt > now || now >= approval.expiresAt)
      return Promise.reject(new Error('presence-unverified'))
    record.state = 'attested'
    return Promise.resolve()
  }
  public async requestStepUp(
    input: DeviceGrantRequest,
    method: (typeof DEVICE_STEP_UP_METHODS)[number],
  ): Promise<DeviceStepUpApproval | DeviceGrantRefusal> {
    const request = deviceGrantRequestSchema.parse(input)
    deviceStepUpSchema.shape.presence.parse(method)
    const result = this.intersection(request)
    if ('reason' in result) return result
    const { state, grant } = result
    const actionDigest = deviceActionDigest(request, state.action)
    for (const [key, entry] of this.attestations) {
      if (entry.approval.expiresAt <= this.deps.now()) this.attestations.delete(key)
    }
    if (
      this.pending.has(actionDigest) ||
      this.pending.size + this.attestations.size >= DEVICE_LIMITS.grantsPerOwner
    )
      return this.refusal(request, 'presence-unverified')
    this.pending.add(actionDigest)
    const control = new AbortController()
    const timer = setTimeout(() => {
      control.abort()
    }, DEVICE_LIMITS.stepUpValidityMs)
    try {
      const isConfirmed = await Promise.race([
        this.deps.presence.confirm({
          actionDigest,
          action: state.action,
          method,
          signal: control.signal,
        }),
        new Promise<boolean>((resolve) => {
          control.signal.addEventListener(
            'abort',
            () => {
              resolve(false)
            },
            { once: true },
          )
        }),
      ])
      if (!isConfirmed || control.signal.aborted)
        return this.refusal(request, 'presence-unverified')
      // Prompting yields. Recheck the complete receiver intersection and exact action.
      const current = this.intersection(request)
      if ('reason' in current) return current
      if (
        current.grant.grantId !== grant.grantId ||
        current.grant.grantRevision !== grant.grantRevision ||
        deviceActionDigest(request, current.state.action) !== actionDigest
      )
        return this.refusal(request, 'presence-unverified')
      const approvedAt = this.deps.now()
      const approval = deviceStepUpSchema.parse({
        version: DEVICE_LIMITS.protocolVersion,
        grantId: current.grant.grantId,
        actionDigest,
        presence: method,
        approvedAt,
        expiresAt: approvedAt + DEVICE_LIMITS.stepUpValidityMs,
      })
      const key = approvalKey(approval)
      if (this.attestations.has(key)) return this.refusal(request, 'presence-unverified')
      this.attestations.set(key, {
        approval: Object.freeze(approval),
        revision: current.grant.grantRevision,
        state: 'pending',
      })
      await this.attestStepUp(approval)
      return deviceStepUpSchema.parse(approval)
    } catch {
      return this.refusal(request, 'presence-unverified')
    } finally {
      clearTimeout(timer)
      control.abort()
      this.pending.delete(actionDigest)
    }
  }
}

// One control-stream carriage member; only the executing device can answer a prompt.
const relayIdentity = {
  version: z.literal(DEVICE_LIMITS.protocolVersion),
  requestId: deviceGrantSchema.shape.grantId,
  pairId: deviceGrantSchema.shape.pairId,
  ownerId: deviceGrantSchema.shape.ownerId,
}
export const devicePresenceRelaySchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      ...relayIdentity,
      kind: z.literal('request'),
      request: deviceGrantRequestSchema,
      actionDigest: deviceStepUpSchema.shape.actionDigest,
      method: z.enum(DEVICE_STEP_UP_METHODS),
    }),
    z.strictObject({
      ...relayIdentity,
      kind: z.literal('waiting'),
      actionDigest: deviceStepUpSchema.shape.actionDigest,
    }),
    z.strictObject({ ...relayIdentity, kind: z.literal('attested'), approval: deviceStepUpSchema }),
    z.strictObject({
      ...relayIdentity,
      kind: z.literal('refused'),
      refusal: deviceGrantRefusalSchema,
    }),
  ])
  .check(
    z.refine((value) => {
      if (Buffer.byteLength(JSON.stringify(value), 'utf8') > DEVICE_LIMITS.grantBytes) return false
      return value.kind === 'request'
        ? value.request.pairId === value.pairId && value.request.ownerId === value.ownerId
        : value.kind !== 'refused' ||
            (value.refusal.pairId === value.pairId && value.refusal.ownerId === value.ownerId)
    }),
  )
type PresenceRelay = z.infer<typeof devicePresenceRelaySchema>
export class DevicePresenceRelay {
  public static waitingText(device: string): string {
    return fill(UI_TEXT.devices.stepUpWaiting, { device })
  }

  public constructor(
    private readonly grants: DeviceActionGrants,
    private readonly currentDigest: (request: DeviceGrantRequest) => string,
  ) {}
  public async receive(
    input: unknown,
    localPairId: string,
    send: (message: PresenceRelay) => void,
  ): Promise<void> {
    const message = devicePresenceRelaySchema.parse(input)
    if (message.kind !== 'request' || message.pairId !== localPairId)
      throw new Error('presence-unverified')
    const { requestId, pairId, ownerId, actionDigest } = message
    if (this.currentDigest(message.request) !== actionDigest) throw new Error('presence-unverified')
    const identity = { version: DEVICE_LIMITS.protocolVersion, requestId, pairId, ownerId }
    send(devicePresenceRelaySchema.parse({ ...identity, kind: 'waiting', actionDigest }))
    const result = await this.grants.requestStepUp(message.request, message.method)
    send(
      devicePresenceRelaySchema.parse(
        'reason' in result
          ? { ...identity, kind: 'refused', refusal: result }
          : { ...identity, kind: 'attested', approval: result },
      ),
    )
  }
}
