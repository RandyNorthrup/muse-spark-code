// M100 phase 2 lane R (G5, G6): pair-keyed reconnect and resume.
//
// Identity is the pair key, not the address: the session is scoped to one
// pairId and no function here takes an endpoint. Reconnect reconciles the
// original attempt identities, resends only unacknowledged envelopes, and
// re-dispatches from the last acknowledged checkpoint under a new epoch,
// retaining the lease's opening checkpoint if no result was accepted.
// A quarantined ack stops a resend but never advances the resume position.
import * as z from 'zod/mini'
import { DEVICE_LIMITS } from '../../shared/constants'
import {
  deviceAttemptIdentitySchema,
  deviceResultAckSchema,
  deviceResultEnvelopeSchema,
  isAckForEnvelope,
  isSameAttempt,
  type DeviceAttemptIdentity,
  type DeviceResultAck,
  type DeviceResultEnvelope,
} from '../../shared/devices'
import {
  deviceEpochSchema,
  expireLease,
  notePollFailed,
  openEpochLease,
  reopenLease,
  unknownSinceText,
  DeviceEpochError,
  type DeviceEpochState,
} from './epochs'

const pairIdSchema = z
  .string()
  .check(
    z.minLength(DEVICE_LIMITS.idChars),
    z.maxLength(DEVICE_LIMITS.idChars),
    z.regex(/^[a-f0-9]{32}$(?![\s\S])/),
  )

export class DeviceReconnectSession {
  private readonly leases = new Map<string, DeviceEpochState>()
  public constructor(public readonly pairId: string) {
    pairIdSchema.parse(pairId)
  }

  private scoped(identity: DeviceAttemptIdentity): DeviceAttemptIdentity {
    const parsed = deviceAttemptIdentitySchema.parse(identity)
    if (parsed.pairId !== this.pairId) throw new DeviceEpochError('uncertain')
    return parsed
  }

  private leaseOf(identity: DeviceAttemptIdentity): DeviceEpochState {
    const known = this.stateOf(identity)
    if (known === undefined) throw new DeviceEpochError('uncertain')
    return known
  }

  /** Fresh attempt under this pair: opens epoch 1. */
  public openAttempt(
    identity: DeviceAttemptIdentity,
    checkpoint: string,
    now: number,
    leaseMs: number,
  ): DeviceEpochState {
    const parsed = this.scoped(identity)
    if (this.leases.has(parsed.attemptId)) throw new DeviceEpochError('uncertain')
    const state = openEpochLease(parsed, checkpoint, now, leaseMs)
    this.leases.set(parsed.attemptId, state)
    return structuredClone(state)
  }

  /** Adopts a parsed epoch state, e.g. restored after a restart. The original owner is kept. */
  public track(state: DeviceEpochState): DeviceEpochState {
    const parsed = deviceEpochSchema.parse(state)
    if (parsed.identity.pairId !== this.pairId) throw new DeviceEpochError('uncertain')
    const known = this.leases.get(parsed.identity.attemptId)
    if (known !== undefined && JSON.stringify(known) !== JSON.stringify(parsed))
      throw new DeviceEpochError('payload-changed')
    this.leases.set(parsed.identity.attemptId, parsed)
    return structuredClone(parsed)
  }

  public stateOf(identity: DeviceAttemptIdentity): DeviceEpochState | undefined {
    const parsed = this.scoped(identity)
    const known = this.leases.get(parsed.attemptId)
    if (known !== undefined && !isSameAttempt(known.identity, parsed))
      throw new DeviceEpochError('payload-changed')
    return known === undefined ? undefined : structuredClone(known)
  }

  /** G5: a failed poll reads unknown since the failure, never running. */
  public notePollFailed(identity: DeviceAttemptIdentity, now: number): string {
    const next = notePollFailed(this.leaseOf(identity), now)
    this.leases.set(next.identity.attemptId, next)
    return unknownSinceText(next)
  }

  public expireAttempt(identity: DeviceAttemptIdentity, now: number): DeviceEpochState {
    const next = expireLease(this.leaseOf(identity), now)
    this.leases.set(next.identity.attemptId, next)
    return structuredClone(next)
  }

  /** G6: after expiry, resume accepted progress or the opening checkpoint under a new epoch. */
  public reopenAttempt(
    identity: DeviceAttemptIdentity,
    envelopes: readonly DeviceResultEnvelope[],
    acks: readonly DeviceResultAck[],
    now: number,
    leaseMs: number,
  ): DeviceEpochState {
    const current = this.leaseOf(identity)
    const checkpoint =
      lastAcknowledgedCheckpoint(current.identity, envelopes, acks, current.epoch) ??
      current.checkpoint
    const next = reopenLease(current, checkpoint, now, leaseMs)
    this.leases.set(next.identity.attemptId, next)
    return structuredClone(next)
  }
}

export interface ResumePlan {
  /** Envelopes with no acknowledgement yet: the only ones a reconnect resends. */
  readonly resend: readonly DeviceResultEnvelope[]
  readonly settled: readonly DeviceResultEnvelope[]
}

/** Splits published envelopes into settled and to-resend, checked per (epoch, digest) pair. */
export function partitionByAck(
  envelopes: readonly unknown[],
  acks: readonly unknown[],
): ResumePlan {
  const parsedEnvelopes = envelopes.map((envelope) => deviceResultEnvelopeSchema.parse(envelope))
  const parsedAcks = acks.map((ack) => deviceResultAckSchema.parse(ack))
  const resend: DeviceResultEnvelope[] = []
  const settled: DeviceResultEnvelope[] = []
  for (const envelope of parsedEnvelopes) {
    if (parsedAcks.some((ack) => isAckForEnvelope(ack, envelope))) settled.push(envelope)
    else resend.push(envelope)
  }
  return { resend, settled }
}

/**
The resume position for an attempt: the result digest of its acked
envelope at the highest acked epoch. Only accepted content advances the
position; a quarantined ack stops its resend without moving it. Undefined
when nothing was acknowledged: reopening then keeps the lease's opening
checkpoint.
*/
export function lastAcknowledgedCheckpoint(
  identity: DeviceAttemptIdentity,
  envelopes: readonly DeviceResultEnvelope[],
  acks: readonly DeviceResultAck[],
  epochCeiling = Number.MAX_SAFE_INTEGER,
): string | undefined {
  if (!Number.isSafeInteger(epochCeiling) || epochCeiling < 1)
    throw new DeviceEpochError('uncertain')
  const parsed = deviceAttemptIdentitySchema.parse(identity)
  const parsedEnvelopes = envelopes.map((envelope) => deviceResultEnvelopeSchema.parse(envelope))
  const parsedAcks = acks.map((ack) => deviceResultAckSchema.parse(ack))
  let checkpoint: string | undefined
  let epoch = 0
  for (const envelope of parsedEnvelopes) {
    if (
      !isSameAttempt(envelope.identity, parsed) ||
      envelope.epoch <= epoch ||
      envelope.epoch > epochCeiling
    )
      continue
    const isAccepted = parsedAcks.some(
      (ack) =>
        (ack.disposition === 'accepted' || ack.disposition === 'duplicate') &&
        isAckForEnvelope(ack, envelope),
    )
    if (!isAccepted) continue
    epoch = envelope.epoch
    checkpoint = envelope.resultDigest
  }
  return checkpoint
}
