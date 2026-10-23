// M100 lane R: pair-keyed reconnect and resume over the real leasetelling.
// Sessions reconcile attempt identities, resend only unacknowledged
// envelopes, and re-dispatch from the last acknowledged checkpoint under a
// new epoch.
import { describe, expect, it } from 'vitest'
import {
  DeviceReconnectSession,
  lastAcknowledgedCheckpoint,
  partitionByAck,
} from '../../src/core/devices/reconnect'
import { DeviceEpochError } from '../../src/core/devices/epochs'
import {
  RESULT_PAIR_ID,
  resultAckFor,
  resultDigestOf,
  resultEnvelope,
  resultIdentity,
} from './helpers/deviceResults'

const OTHER_PAIR = 'b'.repeat(32)
const LEASE_MS = 60_000

describe('M100 reconnect session', () => {
  it('runs G5/G6: failed poll, expiry, resume of the acked digest under a new epoch', () => {
    const session = new DeviceReconnectSession(RESULT_PAIR_ID)
    const id = resultIdentity('f'.repeat(32))
    const opening = resultDigestOf('opening-checkpoint')
    const now = Date.now()
    const opened = session.openAttempt(id, opening, now, LEASE_MS)
    expect(opened.epoch).toBe(1)
    expect(opened.status).toBe('current')
    const since = session.notePollFailed(id, now + 1)
    expect(typeof since).toBe('string')
    expect(session.stateOf(id)?.status).toBe('unknown')
    const expired = session.expireAttempt(id, now + LEASE_MS)
    expect(expired.status).toBe('expired')
    const first = resultEnvelope(id.attemptId, 1, resultDigestOf('result-one'))
    const resumed = session.reopenAttempt(
      id,
      [first],
      [resultAckFor(first, 'accepted')],
      now + LEASE_MS,
      LEASE_MS,
    )
    expect(resumed.epoch).toBe(2)
    expect(resumed.status).toBe('current')
    expect(resumed.checkpoint).toBe(first.resultDigest)
  })

  it('reopening with no acknowledgement keeps the opening checkpoint', () => {
    const session = new DeviceReconnectSession(RESULT_PAIR_ID)
    const id = resultIdentity('0'.repeat(32))
    const opening = resultDigestOf('opening-checkpoint')
    const now = Date.now()
    session.openAttempt(id, opening, now, LEASE_MS)
    session.expireAttempt(id, now + LEASE_MS)
    const first = resultEnvelope(id.attemptId, 1, resultDigestOf('result-one'))
    const resumed = session.reopenAttempt(id, [first], [], now + LEASE_MS, LEASE_MS)
    expect(resumed.epoch).toBe(2)
    expect(resumed.checkpoint).toBe(opening)
  })

  it('adopts a restored lease and refuses a changed one for the same attempt', () => {
    const session = new DeviceReconnectSession(RESULT_PAIR_ID)
    const id = resultIdentity('1'.repeat(32))
    const now = Date.now()
    const opened = session.openAttempt(id, resultDigestOf('opening'), now, LEASE_MS)
    const restored = new DeviceReconnectSession(RESULT_PAIR_ID)
    expect(restored.track(opened)).toEqual(opened)
    expect(restored.stateOf(id)).toEqual(opened)
    const changed = { ...opened, checkpoint: resultDigestOf('other') }
    expect(() => restored.track(changed)).toThrow(DeviceEpochError)
  })

  it('scopes every attempt to its pair and opens each attempt once', () => {
    const session = new DeviceReconnectSession(RESULT_PAIR_ID)
    const now = Date.now()
    expect(() =>
      session.openAttempt(
        resultIdentity('2'.repeat(32), OTHER_PAIR),
        resultDigestOf('opening'),
        now,
        LEASE_MS,
      ),
    ).toThrow(DeviceEpochError)
    const id = resultIdentity('2'.repeat(32))
    session.openAttempt(id, resultDigestOf('opening'), now, LEASE_MS)
    expect(() => session.openAttempt(id, resultDigestOf('opening'), now, LEASE_MS)).toThrow(
      DeviceEpochError,
    )
    expect(() => session.stateOf(resultIdentity('2'.repeat(32), OTHER_PAIR))).toThrow(
      DeviceEpochError,
    )
  })
})

describe('M100 resume plan', () => {
  it('resends only envelopes with no acknowledgement, per epoch and digest', () => {
    const attemptId = '3'.repeat(32)
    const first = resultEnvelope(attemptId, 1, resultDigestOf('result-one'))
    const second = resultEnvelope(attemptId, 2, resultDigestOf('result-two'))
    const plan = partitionByAck([first, second], [resultAckFor(first, 'accepted')])
    expect(plan.settled).toEqual([first])
    expect(plan.resend).toEqual([second])
  })

  it('a quarantined ack stops its resend but never advances the resume position', () => {
    const id = resultIdentity('4'.repeat(32))
    const first = resultEnvelope(id.attemptId, 1, resultDigestOf('result-one'))
    const quarantined = resultAckFor(first, 'quarantined')
    const plan = partitionByAck([first], [quarantined])
    expect(plan.settled).toEqual([first])
    expect(plan.resend).toEqual([])
    expect(lastAcknowledgedCheckpoint(id, [first], [quarantined])).toBeUndefined()
  })

  it('the resume position is the acked digest at the highest acked epoch', () => {
    const id = resultIdentity('5'.repeat(32))
    const first = resultEnvelope(id.attemptId, 1, resultDigestOf('result-one'))
    const second = resultEnvelope(id.attemptId, 2, resultDigestOf('result-two'))
    const acks = [resultAckFor(first, 'accepted'), resultAckFor(second, 'duplicate')]
    expect(lastAcknowledgedCheckpoint(id, [first, second], acks)).toBe(second.resultDigest)
    expect(lastAcknowledgedCheckpoint(id, [first, second], acks, 1)).toBe(first.resultDigest)
    expect(lastAcknowledgedCheckpoint(id, [first, second], [])).toBeUndefined()
    expect(() => lastAcknowledgedCheckpoint(id, [first], acks, 0)).toThrow(DeviceEpochError)
  })
})
