import { expect } from 'vitest'
import {
  DeviceEpochError,
  openEpochLease,
  type DeviceEpochRefusal,
} from '../../../src/core/devices/epochs'
import {
  ResultChannel,
  type DeviceResultRecord,
  type DeviceResultStore,
} from '../../../src/core/devices/resultChannel'
import type {
  DeviceAttemptIdentity,
  DeviceResultEnvelope,
  DeviceResultAck,
} from '../../../src/shared/devices'
import { DeviceReconnectSession } from '../../../src/core/devices/reconnect'

export const PAIR = 'a'.repeat(32)
export const ID: DeviceAttemptIdentity = {
  pairId: PAIR,
  receiverIncarnationId: 'b'.repeat(32),
  boardId: 'c'.repeat(32),
  taskId: 'd'.repeat(32),
  attemptId: 'e'.repeat(32),
}
export const CHECKPOINT = 'f'.repeat(64)
export const RESULT = '9'.repeat(64)
export const NOW = 10_000
export const LEASE_MS = 60_000

export function refusesWith(work: () => unknown, reason: DeviceEpochRefusal): void {
  try {
    work()
  } catch (error) {
    if (!(error instanceof DeviceEpochError)) throw error
    expect(error.reason).toBe(reason)
    return
  }
  expect.unreachable('the guard must refuse')
}

export function envelope(
  epoch: number,
  resultDigest = RESULT,
  checkpoint = CHECKPOINT,
): DeviceResultEnvelope {
  return {
    version: 1,
    identity: ID,
    epoch,
    checkpoint,
    resultDigest,
    resultBytes: 1024,
    recordedAt: NOW,
  }
}

export function memoryStore(records = new Map<string, DeviceResultRecord>()): DeviceResultStore & {
  records: Map<string, DeviceResultRecord>
} {
  return {
    records,
    load: (attemptId) => Promise.resolve(records.get(attemptId)),
    save: (record) => {
      records.set(record.identity.attemptId, structuredClone(record))
      return Promise.resolve()
    },
  }
}

export function resultChannel(
  store: DeviceResultStore = memoryStore(),
  epoch = 1,
  clock = () => NOW,
) {
  return new ResultChannel(
    store,
    (identity) => ({
      ...openEpochLease(identity, CHECKPOINT, NOW, LEASE_MS),
      epoch,
    }),
    clock,
  )
}

export function resultSession() {
  const session = new DeviceReconnectSession(PAIR)
  session.openAttempt(ID, CHECKPOINT, NOW, LEASE_MS)
  const store = memoryStore()
  const channel = new ResultChannel(
    store,
    (identity) => session.stateOf(identity),
    () => NOW,
  )
  const reopen = (ack: DeviceResultAck) => {
    session.expireAttempt(ID, NOW + LEASE_MS)
    return session.reopenAttempt(ID, [envelope(1)], [ack], NOW + LEASE_MS, LEASE_MS)
  }
  return { channel, reopen }
}
