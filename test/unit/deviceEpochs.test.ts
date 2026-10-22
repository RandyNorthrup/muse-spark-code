import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { fill, formatTime } from '../../src/shared/l10n/text'
import {
  deviceEpochSchema,
  expireLease,
  isCurrentEpoch,
  isLeaseExpired,
  notePollFailed,
  openEpochLease,
  reopenLease,
  unknownSinceText,
  DeviceEpochError,
  type DeviceEpochRefusal,
} from '../../src/core/devices/epochs'
import type { DeviceAttemptIdentity, DeviceResultEnvelope } from '../../src/shared/devices'

const PAIR = 'a'.repeat(32)
const ID: DeviceAttemptIdentity = {
  pairId: PAIR,
  receiverIncarnationId: 'b'.repeat(32),
  boardId: 'c'.repeat(32),
  taskId: 'd'.repeat(32),
  attemptId: 'e'.repeat(32),
}
const CHECKPOINT = 'f'.repeat(64)
const NEXT_CHECKPOINT = '9'.repeat(64)
const NOW = 10_000
const LEASE_MS = 60_000

function refusesWith(work: () => unknown, reason: DeviceEpochRefusal): void {
  try {
    work()
  } catch (error) {
    if (!(error instanceof DeviceEpochError)) throw error
    expect(error.reason).toBe(reason)
    return
  }
  expect.unreachable('the guard must refuse')
}

function envelope(epoch: number): DeviceResultEnvelope {
  return {
    version: 1,
    identity: ID,
    epoch,
    checkpoint: CHECKPOINT,
    resultDigest: NEXT_CHECKPOINT,
    resultBytes: 1024,
    recordedAt: NOW,
  }
}

describe('epoch leases', () => {
  it('opens the first epoch at epoch 1, never 0', () => {
    const state = openEpochLease(ID, CHECKPOINT, NOW, LEASE_MS)
    expect(state.epoch).toBe(1)
    expect(state.status).toBe('current')
    expect(state.leaseExpiresAt).toBe(NOW + LEASE_MS)
    expect(state.unknownSince).toBeUndefined()
    expect(deviceEpochSchema.safeParse({ ...state, epoch: 0 }).success).toBe(false)
  })

  it('refuses a planted address: the lease carries the pair key, never an endpoint', () => {
    const state = openEpochLease(ID, CHECKPOINT, NOW, LEASE_MS)
    expect('address' in state).toBe(false)
    expect(
      deviceEpochSchema.safeParse({ ...state, address: '192.168.1.9', port: 4123 }).success,
    ).toBe(false)
  })

  it('marks a failed poll unknown since now, never running', () => {
    const failed = notePollFailed(openEpochLease(ID, CHECKPOINT, NOW, LEASE_MS), NOW + 5000)
    expect(failed.status).toBe('unknown')
    expect(failed.status).not.toBe('running')
    expect(failed.unknownSince).toBe(NOW + 5000)
    expect(unknownSinceText(failed)).toBe(
      fill(UI_TEXT.devices.unknownSince, { time: formatTime(NOW + 5000) }),
    )
  })

  it('keeps the earliest unknown moment while unreachable', () => {
    const once = notePollFailed(openEpochLease(ID, CHECKPOINT, NOW, LEASE_MS), NOW + 5000)
    const twice = notePollFailed(once, NOW + 9000)
    expect(twice.unknownSince).toBe(NOW + 5000)
  })

  it('renders unknown text only for unknown leases', () => {
    const current = openEpochLease(ID, CHECKPOINT, NOW, LEASE_MS)
    expect(() => unknownSinceText(current)).toThrow(DeviceEpochError)
    const expired = expireLease(current, NOW + LEASE_MS)
    expect(() => unknownSinceText(expired)).toThrow(DeviceEpochError)
  })

  it('refuses expiry before the lease end and ends it at expiry', () => {
    const state = openEpochLease(ID, CHECKPOINT, NOW, LEASE_MS)
    expect(isLeaseExpired(state, NOW + LEASE_MS - 1)).toBe(false)
    refusesWith(() => expireLease(state, NOW + LEASE_MS - 1), 'lease-held')
    expect(isLeaseExpired(state, NOW + LEASE_MS)).toBe(true)
    const expired = expireLease(state, NOW + LEASE_MS)
    expect(expired.status).toBe('expired')
    expect(expired.unknownSince).toBeUndefined()
    expect(expireLease(expired, NOW + LEASE_MS + 1000)).toEqual(expired)
  })

  it('re-dispatches after expiry under a new epoch from the acked checkpoint', () => {
    const state = openEpochLease(ID, CHECKPOINT, NOW, LEASE_MS)
    refusesWith(() => reopenLease(state, NEXT_CHECKPOINT, NOW + LEASE_MS, LEASE_MS), 'lease-held')
    const unknown = notePollFailed(state, NOW + 1000)
    const reopenUnknown = () => reopenLease(unknown, NEXT_CHECKPOINT, NOW + LEASE_MS, LEASE_MS)
    refusesWith(reopenUnknown, 'lease-held')
    const expired = expireLease(unknown, NOW + LEASE_MS)
    const next = reopenLease(expired, NEXT_CHECKPOINT, NOW + LEASE_MS, LEASE_MS)
    expect(next.epoch).toBe(2)
    expect(next.status).toBe('current')
    expect(next.checkpoint).toBe(NEXT_CHECKPOINT)
    expect(next.identity).toEqual(ID)
    expect(next.unknownSince).toBeUndefined()
  })

  it('refuses a poll failure once expired: the lease must re-dispatch first', () => {
    const expired = expireLease(openEpochLease(ID, CHECKPOINT, NOW, LEASE_MS), NOW + LEASE_MS)
    refusesWith(() => notePollFailed(expired, NOW + LEASE_MS + 1000), 'stale-epoch')
  })

  it('matches envelopes by attempt and epoch', () => {
    const second = reopenLease(
      expireLease(openEpochLease(ID, CHECKPOINT, NOW, LEASE_MS), NOW + LEASE_MS),
      NEXT_CHECKPOINT,
      NOW + LEASE_MS,
      LEASE_MS,
    )
    expect(isCurrentEpoch(second, envelope(2))).toBe(true)
    expect(isCurrentEpoch(second, envelope(1))).toBe(false)
    const other = { ...envelope(2), identity: { ...ID, attemptId: '0'.repeat(32) } }
    expect(isCurrentEpoch(second, other)).toBe(false)
    expect(() => isCurrentEpoch(second, { ...envelope(2), resultDigest: 'short' })).toThrow()
  })

  it('refuses corrupt durable state instead of an empty success', () => {
    const state = openEpochLease(ID, CHECKPOINT, NOW, LEASE_MS)
    const corrupt = { ...state, epoch: 0, checkpoint: 'short' }
    expect(() => expireLease(corrupt, NOW + LEASE_MS)).toThrow()
    expect(() => reopenLease(corrupt, NEXT_CHECKPOINT, NOW + LEASE_MS, LEASE_MS)).toThrow()
    expect(() => notePollFailed(corrupt, NOW + 1000)).toThrow()
  })

  it('advancing every timeout releases, duplicates and reassigns nothing by itself', () => {
    const unknown = notePollFailed(openEpochLease(ID, CHECKPOINT, NOW, LEASE_MS), NOW + 1000)
    const farFuture = NOW + LEASE_MS * 1000
    expect(isLeaseExpired(unknown, farFuture)).toBe(true)
    // The clock alone changes nothing: still unknown, same epoch, same owner.
    expect(unknown.status).toBe('unknown')
    expect(unknown.epoch).toBe(1)
    expect(unknown.identity).toEqual(ID)
    // Resume still needs the explicit expiry and a new epoch from a checkpoint.
    refusesWith(() => reopenLease(unknown, NEXT_CHECKPOINT, farFuture, LEASE_MS), 'lease-held')
    const expired = expireLease(unknown, farFuture)
    expect(expired.status).toBe('expired')
    const next = reopenLease(expired, NEXT_CHECKPOINT, farFuture, LEASE_MS)
    expect(next.epoch).toBe(2)
    expect(next.identity).toEqual(ID)
    expect(isCurrentEpoch(next, envelope(2))).toBe(true)
    expect(isCurrentEpoch(next, envelope(1))).toBe(false)
  })

  it('rejects an untrusted clock', () => {
    expect(() => openEpochLease(ID, CHECKPOINT, NaN, LEASE_MS)).toThrow(DeviceEpochError)
    expect(() => openEpochLease(ID, CHECKPOINT, NOW, 0)).toThrow(DeviceEpochError)
    const state = openEpochLease(ID, CHECKPOINT, NOW, LEASE_MS)
    expect(() => notePollFailed(state, -1)).toThrow(DeviceEpochError)
  })

  it('refuses an expired marker when the lease end is still in the future', () => {
    const expired = expireLease(openEpochLease(ID, CHECKPOINT, NOW, LEASE_MS), NOW + LEASE_MS)
    refusesWith(() => reopenLease(expired, NEXT_CHECKPOINT, NOW, LEASE_MS), 'lease-held')
  })
})
