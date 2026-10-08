import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEVICE_LIMITS, UI_TEXT } from '../../src/shared/constants'
import { fill, formatTime } from '../../src/shared/l10n/text'
import type { DeviceAttemptIdentity, DeviceResultAck } from '../../src/shared/devices'
import { ResultChannel } from '../../src/core/devices/resultChannel'
import { DeviceEpochError } from '../../src/core/devices/epochs'
import {
  DeviceReconnectSession,
  lastAcknowledgedCheckpoint,
  partitionByAck,
} from '../../src/core/devices/reconnect'
import { responseBody, useExecutionFixture } from './helpers/deviceExecutionFixtures'

import {
  PAIR,
  ID,
  CHECKPOINT,
  RESULT,
  NOW,
  LEASE_MS,
  refusesWith,
  envelope,
  memoryStore,
} from './helpers/deviceReconnectFixtures'

describe('pair-keyed reconnect session', () => {
  it('scopes leases to one pair key and takes no address', () => {
    expect(() => new DeviceReconnectSession('not-a-pair')).toThrow()
    const session = new DeviceReconnectSession(PAIR)
    refusesWith(
      () => session.openAttempt({ ...ID, pairId: '0'.repeat(32) }, CHECKPOINT, NOW, LEASE_MS),
      'uncertain',
    )
    const state = session.openAttempt(ID, CHECKPOINT, NOW, LEASE_MS)
    expect(state.identity.pairId).toBe(PAIR)
    expect('address' in state).toBe(false)
    refusesWith(() => session.openAttempt(ID, CHECKPOINT, NOW, LEASE_MS), 'uncertain')
    refusesWith(() => session.stateOf({ ...ID, pairId: '0'.repeat(32) }), 'uncertain')
  })

  it('reads a failed poll as unknown since the failure, never running', () => {
    const session = new DeviceReconnectSession(PAIR)
    session.openAttempt(ID, CHECKPOINT, NOW, LEASE_MS)
    const text = session.notePollFailed(ID, NOW + 2000)
    expect(text).toBe(fill(UI_TEXT.devices.unknownSince, { time: formatTime(NOW + 2000) }))
    expect(text).not.toMatch(/running/)
    expect(session.stateOf(ID)?.status).toBe('unknown')
  })

  it('reconciles the original attempt after a restart, keeping its owner', () => {
    const before = new DeviceReconnectSession(PAIR)
    const opened = before.openAttempt(ID, CHECKPOINT, NOW, LEASE_MS)
    before.notePollFailed(ID, NOW + 1000)
    // Restart: a fresh session adopts the saved epoch state unchanged.
    const after = new DeviceReconnectSession(PAIR)
    const adopted = after.track(before.stateOf(ID) ?? opened)
    expect(adopted.identity).toEqual(ID)
    expect(adopted.status).toBe('unknown')
    expect(adopted.epoch).toBe(1)
    // A conflicting epoch for the same attempt never replaces it.
    refusesWith(() => after.track({ ...adopted, epoch: adopted.epoch + 1 }), 'payload-changed')
    // A new incarnation opens new attempts; it never adopts the old identity.
    const restarted: DeviceAttemptIdentity = {
      ...ID,
      receiverIncarnationId: '1'.repeat(32),
      attemptId: '2'.repeat(32),
    }
    const fresh = after.openAttempt(restarted, CHECKPOINT, NOW, LEASE_MS)
    expect(fresh.identity.receiverIncarnationId).toBe('1'.repeat(32))
    expect(after.stateOf(ID)?.identity.receiverIncarnationId).toBe(ID.receiverIncarnationId)
  })

  it('refuses lease operations on untracked attempts', () => {
    const session = new DeviceReconnectSession(PAIR)
    expect(session.stateOf(ID)).toBeUndefined()
    expect(() => session.notePollFailed(ID, NOW)).toThrow(DeviceEpochError)
    expect(() => session.expireAttempt(ID, NOW)).toThrow(DeviceEpochError)
    expect(() => session.reopenAttempt(ID, [], [], NOW, LEASE_MS)).toThrow(DeviceEpochError)
  })

  it('refuses a reused attempt id with a different owner or payload', () => {
    const session = new DeviceReconnectSession(PAIR)
    const original = session.openAttempt(ID, CHECKPOINT, NOW, LEASE_MS)
    const impostor = { ...ID, taskId: '0'.repeat(32) }
    refusesWith(() => session.stateOf(impostor), 'payload-changed')
    refusesWith(() => session.track({ ...original, identity: impostor }), 'payload-changed')
    refusesWith(() => session.track({ ...original, checkpoint: RESULT }), 'payload-changed')
    expect(session.stateOf(ID)).toEqual(original)
  })

  it('keeps the saved lease isolated from returned objects', () => {
    const session = new DeviceReconnectSession(PAIR)
    const returned = session.openAttempt(ID, CHECKPOINT, NOW, LEASE_MS)
    returned.status = 'expired'
    returned.identity.taskId = '0'.repeat(32)
    expect(session.stateOf(ID)?.status).toBe('current')
    const read = session.stateOf(ID)
    if (read === undefined) throw new Error('the opened lease must be saved')
    read.epoch = 2
    expect(session.stateOf(ID)?.epoch).toBe(1)
  })

  it('refuses reopening without an acknowledged checkpoint in the expired epoch', () => {
    const session = new DeviceReconnectSession(PAIR)
    session.openAttempt(ID, CHECKPOINT, NOW, LEASE_MS)
    session.expireAttempt(ID, NOW + LEASE_MS)
    const ack: DeviceResultAck = {
      version: 1,
      identity: ID,
      epoch: 2,
      resultDigest: RESULT,
      settlementId: '1'.repeat(32),
      disposition: 'accepted',
      acknowledgedAt: NOW,
    }
    refusesWith(() => session.reopenAttempt(ID, [], [], NOW + LEASE_MS, LEASE_MS), 'uncertain')
    refusesWith(
      () => session.reopenAttempt(ID, [envelope(2)], [ack], NOW + LEASE_MS, LEASE_MS),
      'uncertain',
    )
    expect(session.stateOf(ID)?.epoch).toBe(1)
  })

  it('bounds restored and freshly opened lease identities', () => {
    const session = new DeviceReconnectSession(PAIR)
    for (let index = 0; index < DEVICE_LIMITS.unresolvedAttempts; index += 1) {
      session.openAttempt(
        { ...ID, attemptId: index.toString(16).padStart(DEVICE_LIMITS.idChars, '0') },
        CHECKPOINT,
        NOW,
        LEASE_MS,
      )
    }
    const afterRestart = new DeviceReconnectSession(PAIR)
    const state = afterRestart.openAttempt(ID, CHECKPOINT, NOW, LEASE_MS)
    refusesWith(() => session.openAttempt(ID, CHECKPOINT, NOW, LEASE_MS), 'capacity')
    refusesWith(() => session.track(state), 'capacity')
  })
})

describe('resume from acknowledgements', () => {
  it('resends only unacknowledged envelopes', () => {
    const first = envelope(1)
    const second = envelope(2, 'd'.repeat(64), RESULT)
    const ack: DeviceResultAck = {
      version: 1,
      identity: ID,
      epoch: 1,
      resultDigest: RESULT,
      settlementId: '1'.repeat(32),
      disposition: 'accepted',
      acknowledgedAt: NOW,
    }
    const plan = partitionByAck([first, second], [ack])
    expect(plan.settled).toEqual([first])
    expect(plan.resend).toEqual([second])
    // An old-epoch ack never settles a new-epoch envelope with the same digest.
    const stale = partitionByAck([{ ...second, resultDigest: RESULT }], [ack])
    expect(stale.resend).toHaveLength(1)
    expect(stale.settled).toHaveLength(0)
  })

  it('refuses corrupt envelopes and acks instead of an empty plan', () => {
    expect(() => partitionByAck([{ ...envelope(1), epoch: 0 }], [])).toThrow()
    const malformed = { ...envelope(1), kind: 'nope' }
    expect(() => partitionByAck([envelope(1)], [malformed])).toThrow()
  })

  it('resumes from the last acknowledged checkpoint, ignoring quarantined acks', () => {
    const first = envelope(1)
    const second = envelope(2, 'd'.repeat(64), RESULT)
    const acceptedFirst: DeviceResultAck = {
      version: 1,
      identity: ID,
      epoch: 1,
      resultDigest: RESULT,
      settlementId: '1'.repeat(32),
      disposition: 'accepted',
      acknowledgedAt: NOW,
    }
    expect(lastAcknowledgedCheckpoint(ID, [first, second], [])).toBeUndefined()
    expect(lastAcknowledgedCheckpoint(ID, [first, second], [acceptedFirst])).toBe(RESULT)
    const quarantinedSecond: DeviceResultAck = {
      ...acceptedFirst,
      epoch: 2,
      resultDigest: second.resultDigest,
      disposition: 'quarantined',
    }
    // A quarantined ack stops its resend but never moves the resume position.
    expect(partitionByAck([second], [quarantinedSecond]).resend).toHaveLength(0)
    const mixed = [acceptedFirst, quarantinedSecond]
    expect(lastAcknowledgedCheckpoint(ID, [first, second], mixed)).toBe(RESULT)
  })

  it('reconnects end to end: unknown, then resume with no resend once settled', async () => {
    const session = new DeviceReconnectSession(PAIR)
    const channel = new ResultChannel(
      memoryStore(),
      (identity) => session.stateOf(identity),
      () => NOW,
    )
    session.openAttempt(ID, CHECKPOINT, NOW, LEASE_MS)
    // The transport drops: the poll failure reads unknown since the failure.
    const text = session.notePollFailed(ID, NOW + 2000)
    expect(text).toBe(fill(UI_TEXT.devices.unknownSince, { time: formatTime(NOW + 2000) }))
    // Meanwhile the result arrived and was acknowledged once.
    const published = envelope(1)
    const ack = await channel.publish(published)
    expect(ack.disposition).toBe('accepted')
    const plan = partitionByAck([published], [ack])
    expect(plan.resend).toHaveLength(0)
    expect(plan.settled).toEqual([published])
    // The lease expires; re-dispatch starts a new epoch from the acked result.
    session.expireAttempt(ID, NOW + LEASE_MS)
    const checkpoint = lastAcknowledgedCheckpoint(ID, [published], [ack])
    expect(checkpoint).toBe(RESULT)
    if (checkpoint === undefined) throw new Error('the acked result must give a checkpoint')
    const next = session.reopenAttempt(ID, [published], [ack], NOW + LEASE_MS, LEASE_MS)
    expect(next.epoch).toBe(2)
    expect(next.checkpoint).toBe(RESULT)
    const second = { ...envelope(2, 'd'.repeat(64), RESULT) }
    const secondAck = await channel.publish(second)
    expect(secondAck.disposition).toBe('accepted')
    expect(partitionByAck([published, second], [ack, secondAck]).resend).toHaveLength(0)
    expect(lastAcknowledgedCheckpoint(ID, [published, second], [ack, secondAck])).toBe(
      second.resultDigest,
    )
  })
})

const lane = useExecutionFixture('check')

describe('reconnect never launches twice', () => {
  it('drops the admission reply and resends: the launch counter shows one start', async () => {
    const { receiver, request, execution, fixture: launches } = lane()
    const first = await responseBody(receiver.dispatch(request))
    expect(first.kind).toBe('outcome')
    // The reply above is dropped on the wire; the same attempt is resent.
    const second = await responseBody(receiver.dispatch(request))
    expect(execution.admit).toHaveBeenCalledTimes(1)
    expect(launches.launches).toBe(1)
    expect(second.kind).toBe('reconciled')
  })

  it('refuses dispatch from a corrupt durable journal before admission or launch', async () => {
    const { receiver, request, execution, lease, directory } = lane()
    await writeFile(path.join(directory, 'attempts.json'), '{}')
    expect(await responseBody(receiver.dispatch(request))).toMatchObject({
      kind: 'failure',
      reason: 'storage',
    })
    expect(execution.admit).not.toHaveBeenCalled()
    expect(lease.start).not.toHaveBeenCalled()
  })
})
