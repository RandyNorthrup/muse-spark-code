// M100 phase 2 lane R (G5, G6): epochs and execution leases.
//
// Identity is the pair key, never the address: no field here names an
// endpoint, and reconnect matches the saved attempt identity. A failed poll
// marks the lease unknown, never running. Re-dispatch happens only after
// the lease expires, under a new epoch, from the last acknowledged
// checkpoint; a late result is quarantined by the result channel, never
// applied. Clocks are injected so tests advance every timeout exactly.
import * as z from 'zod/mini'
import { DEVICE_LIMITS, UI_TEXT } from '../../shared/constants'
import { fill, formatTime } from '../../shared/l10n/text'
import {
  deviceAttemptIdentitySchema,
  deviceResultEnvelopeSchema,
  isSameAttempt,
  type DeviceAttemptIdentity,
  type DeviceResultEnvelope,
} from '../../shared/devices'

export type DeviceEpochRefusal =
  'capacity' | 'lease-held' | 'payload-changed' | 'stale-epoch' | 'uncertain'

export class DeviceEpochError extends Error {
  public constructor(public readonly reason: DeviceEpochRefusal) {
    super(reason)
    this.name = 'DeviceEpochError'
  }
}

const digest = z
  .string()
  .check(
    z.minLength(DEVICE_LIMITS.digestChars),
    z.maxLength(DEVICE_LIMITS.digestChars),
    z.regex(/^[a-f0-9]{64}$(?![\s\S])/),
  )

export const deviceEpochSchema = z
  .strictObject({
    version: z.literal(DEVICE_LIMITS.protocolVersion),
    identity: deviceAttemptIdentitySchema,
    epoch: z.int().check(z.gte(1)),
    checkpoint: digest,
    leaseExpiresAt: z.int().check(z.gte(0), z.lte(DEVICE_LIMITS.observationMaxMs)),
    status: z.enum(['current', 'unknown', 'expired']),
    unknownSince: z.optional(z.int().check(z.gte(0), z.lte(DEVICE_LIMITS.observationMaxMs))),
  })
  .check(z.refine((value) => (value.status === 'unknown') === (value.unknownSince !== undefined)))
export type DeviceEpochState = z.infer<typeof deviceEpochSchema>

function assertClock(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0 || now > DEVICE_LIMITS.observationMaxMs)
    throw new DeviceEpochError('uncertain')
}

function assertLeaseMs(leaseMs: number, now: number): number {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) throw new DeviceEpochError('uncertain')
  const expiresAt = now + leaseMs
  if (!Number.isSafeInteger(expiresAt) || expiresAt > DEVICE_LIMITS.observationMaxMs)
    throw new DeviceEpochError('uncertain')
  return expiresAt
}

/** Opens the first epoch: a fresh dispatch starts at epoch 1, never 0. */
export function openEpochLease(
  identity: DeviceAttemptIdentity,
  checkpoint: string,
  now: number,
  leaseMs: number,
): DeviceEpochState {
  assertClock(now)
  return deviceEpochSchema.parse({
    version: DEVICE_LIMITS.protocolVersion,
    identity: deviceAttemptIdentitySchema.parse(identity),
    epoch: 1,
    checkpoint: digest.parse(checkpoint),
    leaseExpiresAt: assertLeaseMs(leaseMs, now),
    status: 'current',
  })
}

/**
G5: a failed poll marks the lease unknown since now, never running. The
earliest unknown moment is kept while the lease stays unreachable.
*/
export function notePollFailed(state: DeviceEpochState, now: number): DeviceEpochState {
  assertClock(now)
  const current = deviceEpochSchema.parse(state)
  if (current.status === 'expired') throw new DeviceEpochError('stale-epoch')
  const unknownSince =
    current.unknownSince === undefined ? now : Math.min(current.unknownSince, now)
  return deviceEpochSchema.parse({ ...current, status: 'unknown', unknownSince })
}

/** True once the lease's end is reached; expiry still needs `expireLease`. */
export function isLeaseExpired(state: DeviceEpochState, now: number): boolean {
  assertClock(now)
  return now >= deviceEpochSchema.parse(state).leaseExpiresAt
}

/**
Ends the lease after its expiry. Advancing the clock never releases,
duplicates or reassigns anything by itself: only this call moves a
current or unknown lease to expired, and it refuses early.
*/
export function expireLease(state: DeviceEpochState, now: number): DeviceEpochState {
  assertClock(now)
  const current = deviceEpochSchema.parse(state)
  if (current.status === 'expired') return current
  if (now < current.leaseExpiresAt) throw new DeviceEpochError('lease-held')
  const { unknownSince: _dropped, ...rest } = current
  return deviceEpochSchema.parse({ ...rest, status: 'expired' })
}

/**
G6: re-dispatch only after lease expiry, under a new epoch, from the
last acknowledged checkpoint. Anything else is refused, never applied.
*/
export function reopenLease(
  state: DeviceEpochState,
  checkpoint: string,
  now: number,
  leaseMs: number,
): DeviceEpochState {
  assertClock(now)
  const current = deviceEpochSchema.parse(state)
  if (current.status !== 'expired' || now < current.leaseExpiresAt)
    throw new DeviceEpochError('lease-held')
  const epoch = current.epoch + 1
  if (!Number.isSafeInteger(epoch)) throw new DeviceEpochError('uncertain')
  return deviceEpochSchema.parse({
    version: DEVICE_LIMITS.protocolVersion,
    identity: current.identity,
    epoch,
    checkpoint: digest.parse(checkpoint),
    leaseExpiresAt: assertLeaseMs(leaseMs, now),
    status: 'current',
  })
}

/** Whether the envelope belongs to this lease's epoch, never an older one. */
export function isCurrentEpoch(state: DeviceEpochState, envelope: DeviceResultEnvelope): boolean {
  const current = deviceEpochSchema.parse(state)
  const parsed = deviceResultEnvelopeSchema.parse(envelope)
  return isSameAttempt(current.identity, parsed.identity) && current.epoch === parsed.epoch
}

/**
G5: what a failed poll reads. Only an unknown lease renders; a current
lease is never shown as unknown and an expired one must re-dispatch first.
*/
export function unknownSinceText(state: DeviceEpochState): string {
  const current = deviceEpochSchema.parse(state)
  if (current.status !== 'unknown' || current.unknownSince === undefined)
    throw new DeviceEpochError('uncertain')
  return fill(UI_TEXT.devices.unknownSince, { time: formatTime(current.unknownSince) })
}
