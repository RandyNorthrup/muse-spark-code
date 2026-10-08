import { describe, expect, it } from 'vitest'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { canQueueResultAck, isAckForEnvelope, type DeviceResultAck } from '../../src/shared/devices'
import {
  deviceResultRecordSchema,
  settlementFor,
  ResultChannel,
  DeviceResultError,
  type DeviceResultStore,
} from '../../src/core/devices/resultChannel'

import {
  ID,
  RESULT,
  NOW,
  LEASE_MS,
  envelope,
  memoryStore,
  resultChannel,
  resultSession,
} from './helpers/deviceReconnectFixtures'

function fillWaits(channel: ResultChannel): void {
  for (let index = 0; index < DEVICE_LIMITS.pendingResultAcks; index += 1) {
    channel.queueResultWait({
      ...envelope(1),
      identity: { ...ID, attemptId: index.toString(16).padStart(DEVICE_LIMITS.idChars, '0') },
    })
  }
}

describe('result channel', () => {
  it('accepts once: a resend returns the recorded duplicate', async () => {
    const channel = resultChannel()
    const first = await channel.publish(envelope(1))
    expect(first.disposition).toBe('accepted')
    expect(first.epoch).toBe(1)
    expect(isAckForEnvelope(first, envelope(1))).toBe(true)
    const second = await channel.publish(envelope(1))
    expect(second.disposition).toBe('duplicate')
    expect(second).toEqual({ ...first, disposition: 'duplicate' })
    expect(isAckForEnvelope(second, envelope(1))).toBe(true)
  })

  it('derives a stable settlement per epoch and digest', () => {
    expect(settlementFor(1, RESULT)).toBe(settlementFor(1, RESULT))
    expect(settlementFor(1, RESULT)).not.toBe(settlementFor(2, RESULT))
    expect(settlementFor(1, RESULT)).toHaveLength(DEVICE_LIMITS.idChars)
  })

  it('parses every envelope before use and stays within the result byte cap', async () => {
    const channel = resultChannel()
    await expect(channel.publish({ ...envelope(1), epoch: 0 })).rejects.toThrow()
    const wrongVersion = { ...envelope(1), version: 2 }
    await expect(channel.publish(wrongVersion)).rejects.toThrow()
    const bytes = new TextEncoder().encode(JSON.stringify(envelope(1))).byteLength
    expect(bytes).toBeLessThanOrEqual(DEVICE_LIMITS.resultEnvelopeBytes)
  })

  it('quarantines a late result instead of applying it, identically on resend', async () => {
    const channel = resultChannel(memoryStore(), 2)
    const accepted = await channel.publish(envelope(2))
    expect(accepted.disposition).toBe('accepted')
    const late = await channel.publish(envelope(1))
    expect(late.disposition).toBe('quarantined')
    expect(isAckForEnvelope(late, envelope(1))).toBe(true)
    expect(isAckForEnvelope(late, envelope(2))).toBe(false)
    const again = await channel.publish(envelope(1))
    expect(again).toEqual(late)
    // The stored epoch-2 result still settles its own resend as a duplicate.
    const duplicate = await channel.publish(envelope(2))
    expect(duplicate.disposition).toBe('duplicate')
    expect(duplicate).toEqual({ ...accepted, disposition: 'duplicate' })
  })

  it('refuses content that changed under the same epoch', async () => {
    const channel = resultChannel()
    await channel.publish(envelope(1))
    await expect(channel.publish(envelope(1, 'd'.repeat(64)))).rejects.toMatchObject({
      reason: 'payload-changed',
    })
    await expect(channel.publish(envelope(1, RESULT, 'd'.repeat(64)))).rejects.toMatchObject({
      reason: 'payload-changed',
    })
    await expect(channel.publish({ ...envelope(1), resultBytes: 2 })).rejects.toMatchObject({
      reason: 'payload-changed',
    })
  })

  it('accepts a new-epoch result after the old one settled', async () => {
    const { channel, reopen } = resultSession()
    const first = await channel.publish(envelope(1))
    reopen(first)
    const next = await channel.publish({ ...envelope(2), checkpoint: RESULT })
    expect(next.disposition).toBe('accepted')
    expect(next.epoch).toBe(2)
    expect(isAckForEnvelope(next, envelope(1))).toBe(false)
  })

  it('refuses the publish when durable state is corrupt, never an empty success', async () => {
    const corrupt: DeviceResultStore = {
      load: () => Promise.resolve({ version: 1, epoch: 0, checkpoint: 'short' }),
      save: () => Promise.resolve(),
    }
    await expect(resultChannel(corrupt).publish(envelope(1))).rejects.toMatchObject({
      reason: 'storage',
    })
    const failingLoad: DeviceResultStore = {
      load: () => Promise.reject(new Error('disk gone')),
      save: () => Promise.resolve(),
    }
    await expect(resultChannel(failingLoad).publish(envelope(1))).rejects.toMatchObject({
      reason: 'storage',
    })
    const failingSave: DeviceResultStore = {
      load: () => Promise.resolve(undefined),
      save: () => Promise.reject(new Error('disk gone')),
    }
    await expect(resultChannel(failingSave).publish(envelope(1))).rejects.toMatchObject({
      reason: 'storage',
    })
    const other = { ...envelope(1), identity: { ...ID, taskId: '0'.repeat(32) } }
    const otherAck = await resultChannel().publish(other)
    const stored = deviceResultRecordSchema.parse({
      version: 1,
      identity: other.identity,
      receipts: [{ envelope: other, ack: otherAck }],
    })
    const records = new Map([[ID.attemptId, stored]])
    const mismatched = memoryStore(records)
    await expect(resultChannel(mismatched).publish(envelope(1))).rejects.toMatchObject({
      reason: 'payload-changed',
    })
  })

  it('rejects an untrusted clock instead of recording', async () => {
    const channel = resultChannel(memoryStore(), 1, () => NaN)
    await expect(channel.publish(envelope(1))).rejects.toMatchObject({ reason: 'uncertain' })
  })

  it('bounds queued ack waits and settles only the matching epoch and digest', () => {
    const channel = resultChannel()
    const first = envelope(1)
    const second = { ...envelope(2), checkpoint: RESULT }
    const key = channel.queueResultWait(first)
    expect(channel.queueResultWait(first)).toBe(key)
    expect(channel.pendingWaits).toBe(1)
    channel.queueResultWait(second)
    expect(channel.pendingWaits).toBe(2)
    const ack: DeviceResultAck = {
      version: 1,
      identity: ID,
      epoch: 1,
      resultDigest: RESULT,
      settlementId: '1'.repeat(32),
      disposition: 'accepted',
      acknowledgedAt: NOW,
    }
    expect(channel.ingestAck(ack)).toEqual(first)
    expect(channel.pendingWaits).toBe(1)
    // An old-epoch ack beside the new-epoch wait does not match.
    expect(channel.ingestAck(ack)).toBeUndefined()
    expect(channel.pendingWaits).toBe(1)
    expect(channel.ingestAck({ ...ack, epoch: 2, resultDigest: second.resultDigest })).toEqual(
      second,
    )
    expect(channel.pendingWaits).toBe(0)
  })

  it('refuses another queued wait past pendingResultAcks', () => {
    const channel = resultChannel()
    fillWaits(channel)
    expect(channel.pendingWaits).toBe(DEVICE_LIMITS.pendingResultAcks)
    expect(canQueueResultAck(channel.pendingWaits)).toBe(false)
    expect(() => channel.queueResultWait(envelope(1))).toThrow(DeviceResultError)
  })

  it('rejects a malformed ack instead of settling', () => {
    const channel = resultChannel()
    channel.queueResultWait(envelope(1))
    const hostile = { ...envelope(1), kind: 'nope' }
    expect(() => channel.ingestAck(hostile)).toThrow()
    expect(channel.pendingWaits).toBe(1)
  })

  it('serializes simultaneous resends into one durable acceptance', async () => {
    const store = memoryStore()
    const channel = resultChannel(store)
    const acks = await Promise.all([channel.publish(envelope(1)), channel.publish(envelope(1))])
    expect(acks.map((ack) => ack.disposition)).toEqual(['accepted', 'duplicate'])
  })

  it('keeps quarantine acknowledgements byte-identical across time and restart', async () => {
    const store = memoryStore()
    let now = NOW
    const channel = resultChannel(store, 2, () => now)
    await channel.publish(envelope(2))
    const late = await channel.publish(envelope(1))
    now += 1000
    const restarted = resultChannel(store, 2, () => now)
    expect(await restarted.publish(envelope(1))).toEqual(late)
  })

  it('allows a duplicate wait at capacity and refuses changed content', () => {
    const channel = resultChannel()
    fillWaits(channel)
    const first = { ...envelope(1), identity: { ...ID, attemptId: '0'.repeat(32) } }
    expect(channel.queueResultWait(first)).toBe(channel.queueResultWait(first))
    expect(() => channel.queueResultWait({ ...first, checkpoint: 'd'.repeat(64) })).toThrow(
      DeviceResultError,
    )
  })

  it('quarantines an old epoch before any result from the new lease arrives', async () => {
    const store = memoryStore()
    const channel = resultChannel(store, 2)
    const ack = await channel.publish(envelope(1))
    expect(ack.disposition).toBe('quarantined')
    expect(store.records.get(ID.attemptId)?.receipts[0]?.ack).toEqual(ack)
    expect(await channel.publish(envelope(2))).toMatchObject({ disposition: 'accepted' })
  })

  it('quarantines results at lease expiry and refuses future or untracked epochs', async () => {
    const expired = resultChannel(memoryStore(), 1, () => NOW + LEASE_MS)
    expect(await expired.publish(envelope(1))).toMatchObject({ disposition: 'quarantined' })
    await expect(resultChannel().publish(envelope(2))).rejects.toMatchObject({
      reason: 'uncertain',
    })
    const missing = new ResultChannel(
      memoryStore(),
      () => undefined,
      () => NOW,
    )
    await expect(missing.publish(envelope(1))).rejects.toMatchObject({ reason: 'uncertain' })
  })

  it('refuses a checkpoint outside the current lease and a corrupt receipt binding', async () => {
    await expect(resultChannel().publish(envelope(1, RESULT, RESULT))).rejects.toMatchObject({
      reason: 'payload-changed',
    })
    const store = memoryStore()
    const ack = await resultChannel(store).publish(envelope(1))
    const corrupt: DeviceResultStore = {
      load: () =>
        Promise.resolve({
          version: 1,
          identity: ID,
          receipts: [{ envelope: envelope(1), ack: { ...ack, epoch: 2 } }],
        }),
      save: () => Promise.resolve(),
    }
    await expect(resultChannel(corrupt).publish(envelope(1))).rejects.toMatchObject({
      reason: 'storage',
    })
  })

  it('never retries an uncertain save as a new acceptance', async () => {
    let saves = 0
    const store: DeviceResultStore = {
      load: () => Promise.resolve(undefined),
      save: () => {
        saves += 1
        return Promise.reject(new Error('durability uncertain'))
      },
    }
    const channel = resultChannel(store)
    await expect(channel.publish(envelope(1))).rejects.toMatchObject({ reason: 'storage' })
    await expect(channel.publish(envelope(1))).rejects.toMatchObject({ reason: 'storage' })
    expect(saves).toBe(1)
  })

  it('keeps older accepted receipts after a later epoch and refuses conflicting concurrent resends', async () => {
    const { channel, reopen } = resultSession()
    const first = await channel.publish(envelope(1))
    reopen(first)
    await channel.publish(envelope(2, 'd'.repeat(64), RESULT))
    expect(await channel.publish(envelope(1))).toEqual({ ...first, disposition: 'duplicate' })
    const fresh = resultChannel()
    const acks = await Promise.allSettled([
      fresh.publish(envelope(1)),
      fresh.publish(envelope(1, 'd'.repeat(64))),
    ])
    expect(acks[0].status).toBe('fulfilled')
    expect(acks[1]).toMatchObject({ status: 'rejected', reason: { reason: 'payload-changed' } })
  })

  it('bounds simultaneous publishes while durable storage is blocked', async () => {
    const load = Promise.withResolvers<unknown>()
    let saves = 0
    let record: unknown
    const store: DeviceResultStore = {
      load: async () => {
        await load.promise
        return record
      },
      save: (next) => {
        record = next
        saves += 1
        return Promise.resolve()
      },
    }
    const channel = resultChannel(store)
    const pending = Array.from({ length: DEVICE_LIMITS.pendingResultAcks }, () =>
      channel.publish(envelope(1)),
    )
    await expect(channel.publish(envelope(1))).rejects.toMatchObject({ reason: 'capacity' })
    load.resolve(undefined)
    const acks = await Promise.all(pending)
    expect(acks.filter((ack) => ack.disposition === 'accepted')).toHaveLength(1)
    expect(saves).toBe(1)
    expect(await channel.publish(envelope(1))).toMatchObject({ disposition: 'duplicate' })
  })
})
