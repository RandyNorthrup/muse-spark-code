// M100 lane R: content-addressed results with durable receipts. The channel
// publishes against the real file store with the real reconnect session as
// its lease authority: first publish accepts and persists, a resend returns
// the recorded duplicate, a new epoch accepts under its own settlement, and
// late, tampered or capacity-breaking work refuses loudly.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import {
  DeviceResultError,
  deviceResultRecordSchema,
  ResultChannel,
  settlementFor,
  type DeviceResultStore,
} from '../../src/core/devices/resultChannel'
import { FileResultStore } from '../../src/core/devices/resultStore'
import { DeviceReconnectSession } from '../../src/core/devices/reconnect'
import type { DeviceResultEnvelope } from '../../src/shared/devices'
import {
  RESULT_PAIR_ID,
  resultCheckpointFor,
  resultDigestOf,
  resultEnvelope,
  resultIdentity,
  usePrivateResultsRoot,
} from './helpers/deviceResults'

const LEASE_MS = 60_000
const { fixture } = usePrivateResultsRoot('m100-results-')

async function opened(): Promise<{ store: FileResultStore; session: DeviceReconnectSession }> {
  const store = await FileResultStore.create(path.join(fixture.parent, 'results'), fixture.storage)
  const session = new DeviceReconnectSession(RESULT_PAIR_ID)
  return { store, session }
}

function channelFor(store: DeviceResultStore, session: DeviceReconnectSession): ResultChannel {
  return new ResultChannel(store, (id) => session.stateOf(id))
}

describe('M100 result channel', () => {
  it('accepts once: a resend returns the recorded duplicate, durably', async () => {
    const { store, session } = await opened()
    const channel = channelFor(store, session)
    const attemptId = '0'.repeat(32)
    session.openAttempt(
      resultIdentity(attemptId),
      resultCheckpointFor(attemptId),
      Date.now(),
      LEASE_MS,
    )
    const first = resultEnvelope(attemptId, 1, resultDigestOf('result-one'))
    const accepted = await channel.publish(first)
    expect(accepted.disposition).toBe('accepted')
    expect(accepted.epoch).toBe(1)
    expect(accepted.settlementId).toBe(settlementFor(1, first.resultDigest))
    const second = await channel.publish(first)
    expect(second.disposition).toBe('duplicate')
    expect(second.settlementId).toBe(accepted.settlementId)
    const reopened = await FileResultStore.open(
      path.join(fixture.parent, 'results'),
      fixture.storage,
    )
    const saved = deviceResultRecordSchema.parse(await reopened.load(attemptId))
    expect(saved.receipts).toHaveLength(1)
    expect(saved.receipts[0]?.ack.disposition).toBe('accepted')
  })

  it('accepts a new epoch under its own settlement after resume', async () => {
    const { store, session } = await opened()
    const channel = channelFor(store, session)
    const attemptId = '1'.repeat(32)
    const id = resultIdentity(attemptId)
    const openedAt = Date.now()
    session.openAttempt(id, resultCheckpointFor(attemptId), openedAt, LEASE_MS)
    const first = resultEnvelope(attemptId, 1, resultDigestOf('result-one'))
    const ack = await channel.publish(first)
    session.expireAttempt(id, openedAt + LEASE_MS)
    const resumed = session.reopenAttempt(id, [first], [ack], openedAt + LEASE_MS, LEASE_MS)
    expect(resumed.epoch).toBe(2)
    const next = resultEnvelope(attemptId, 2, resultDigestOf('result-two'))
    const accepted = await channel.publish({ ...next, checkpoint: resumed.checkpoint })
    expect(accepted.disposition).toBe('accepted')
    expect(accepted.settlementId).toBe(settlementFor(2, next.resultDigest))
    expect(accepted.settlementId).not.toBe(ack.settlementId)
    const saved = deviceResultRecordSchema.parse(await store.load(attemptId))
    expect(saved.receipts).toHaveLength(2)
  })

  it('quarantines a first publish on an expired lease', async () => {
    const { store, session } = await opened()
    const channel = channelFor(store, session)
    const attemptId = '2'.repeat(32)
    const id = resultIdentity(attemptId)
    const openedAt = Date.now()
    session.openAttempt(id, resultCheckpointFor(attemptId), openedAt, LEASE_MS)
    session.expireAttempt(id, openedAt + LEASE_MS)
    const ack = await channel.publish(resultEnvelope(attemptId, 1, resultDigestOf('result-one')))
    expect(ack.disposition).toBe('quarantined')
  })

  it('refuses a wrong checkpoint and a tampered resend as payload-changed', async () => {
    const { store, session } = await opened()
    const channel = channelFor(store, session)
    const attemptId = '3'.repeat(32)
    session.openAttempt(
      resultIdentity(attemptId),
      resultCheckpointFor(attemptId),
      Date.now(),
      LEASE_MS,
    )
    const first = resultEnvelope(attemptId, 1, resultDigestOf('result-one'))
    await expect(
      channel.publish({ ...first, checkpoint: resultDigestOf('another-checkpoint') }),
    ).rejects.toThrow(DeviceResultError)
    await channel.publish(first)
    await expect(channel.publish({ ...first, resultBytes: 13 })).rejects.toThrow(DeviceResultError)
  })

  it('refuses work with no lease or past the lease epoch as uncertain', async () => {
    const { store, session } = await opened()
    const channel = channelFor(store, session)
    await expect(
      channel.publish(resultEnvelope('4'.repeat(32), 1, resultDigestOf('result-one'))),
    ).rejects.toThrow(DeviceResultError)
    const attemptId = '5'.repeat(32)
    session.openAttempt(
      resultIdentity(attemptId),
      resultCheckpointFor(attemptId),
      Date.now(),
      LEASE_MS,
    )
    await expect(
      channel.publish(resultEnvelope(attemptId, 2, resultDigestOf('result-one'))),
    ).rejects.toThrow(DeviceResultError)
  })

  it('settles waits by acknowledgement, never across epochs', async () => {
    const { store, session } = await opened()
    const channel = channelFor(store, session)
    const attemptId = '6'.repeat(32)
    session.openAttempt(
      resultIdentity(attemptId),
      resultCheckpointFor(attemptId),
      Date.now(),
      LEASE_MS,
    )
    const first = resultEnvelope(attemptId, 1, resultDigestOf('result-one'))
    channel.queueResultWait(first)
    expect(channel.pendingWaits).toBe(1)
    const ack = await channel.publish(first)
    expect(channel.ingestAck(ack)).toEqual(first)
    expect(channel.pendingWaits).toBe(0)
    const next = resultEnvelope(attemptId, 2, resultDigestOf('result-one'))
    channel.queueResultWait(next)
    expect(channel.ingestAck(ack)).toBeUndefined()
    expect(channel.pendingWaits).toBe(1)
  })

  it('refuses waits past capacity while duplicate waits stay idempotent', async () => {
    const { store, session } = await opened()
    const channel = channelFor(store, session)
    const waits: DeviceResultEnvelope[] = []
    for (let index = 0; index < DEVICE_LIMITS.pendingResultAcks; index += 1) {
      const attemptId = index.toString(16).padStart(DEVICE_LIMITS.idChars, '0')
      waits.push(resultEnvelope(attemptId, 1, resultDigestOf(`result-${attemptId}`)))
    }
    for (const queued of waits) channel.queueResultWait(queued)
    expect(channel.pendingWaits).toBe(DEVICE_LIMITS.pendingResultAcks)
    const first = waits[0]
    if (first === undefined) throw new Error('missing queued wait')
    expect(channel.queueResultWait(first)).toBe(channel.queueResultWait(first))
    const over = resultEnvelope('f'.repeat(32), 1, resultDigestOf('result-over'))
    expect(() => channel.queueResultWait(over)).toThrow(DeviceResultError)
  })

  it('refuses damaged receipts as storage and stays failed', async () => {
    const { store, session } = await opened()
    const channel = channelFor(store, session)
    const attemptId = '8'.repeat(32)
    session.openAttempt(
      resultIdentity(attemptId),
      resultCheckpointFor(attemptId),
      Date.now(),
      LEASE_MS,
    )
    await channel.publish(resultEnvelope(attemptId, 1, resultDigestOf('result-one')))
    await writeFile(path.join(fixture.parent, 'results', `${attemptId}.json`), '{damaged')
    const reread = channelFor(store, session)
    const retry = resultEnvelope(attemptId, 1, resultDigestOf('result-one'))
    await expect(reread.publish(retry)).rejects.toThrow(DeviceResultError)
    await expect(reread.publish(retry)).rejects.toThrow(DeviceResultError)
  })

  it('settles deterministically per epoch and digest', () => {
    const digest = resultDigestOf('result-one')
    expect(settlementFor(1, digest)).toBe(settlementFor(1, digest))
    expect(settlementFor(1, digest)).not.toBe(settlementFor(2, digest))
    expect(settlementFor(1, digest)).toHaveLength(DEVICE_LIMITS.idChars)
  })
})
