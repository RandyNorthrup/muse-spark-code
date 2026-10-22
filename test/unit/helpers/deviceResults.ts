// Shared builders for the lane-R suites: identities, envelopes, acks and
// records through the lane-0 schemas with real SHA-256 digests, plus the
// private scratch root the durable suites create their stores under.
import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { afterAll, afterEach, beforeEach } from 'vitest'
import { DEVICE_LIMITS } from '../../../src/shared/constants'
import type { DeviceStorageProtection } from '../../../src/core/devices/storageProtection'
import {
  deviceResultAckSchema,
  deviceResultEnvelopeSchema,
  type DeviceAttemptIdentity,
  type DeviceResultAck,
  type DeviceResultEnvelope,
} from '../../../src/shared/devices'
import {
  deviceResultRecordSchema,
  settlementFor,
  type DeviceResultRecord,
} from '../../../src/core/devices/resultChannel'
import { deviceStorage, endDeviceStorage, privateDeviceRoot } from './deviceFixtures'

export const RESULT_PAIR_ID = 'a'.repeat(32)

/** Per test: a fresh private root with this OS's storage binding. */
export function usePrivateResultsRoot(prefix: string) {
  const fixture: { parent: string; storage: DeviceStorageProtection | undefined } = {
    parent: '',
    storage: undefined,
  }
  beforeEach(async () => {
    fixture.storage = await deviceStorage()
    fixture.parent = await privateDeviceRoot(prefix)
  })
  afterEach(async () => {
    await rm(fixture.parent, { recursive: true, force: true })
  })
  afterAll(endDeviceStorage)
  return { fixture }
}

export function resultDigestOf(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function resultCheckpointFor(attemptId: string): string {
  return resultDigestOf(`checkpoint-${attemptId}`)
}

export function resultIdentity(attemptId: string, pairId = RESULT_PAIR_ID): DeviceAttemptIdentity {
  return {
    pairId,
    receiverIncarnationId: 'c'.repeat(32),
    boardId: 'd'.repeat(32),
    taskId: 'e'.repeat(32),
    attemptId,
  }
}

export function resultEnvelope(
  attemptId: string,
  epoch: number,
  resultDigest: string,
  pairId = RESULT_PAIR_ID,
): DeviceResultEnvelope {
  return deviceResultEnvelopeSchema.parse({
    version: DEVICE_LIMITS.protocolVersion,
    identity: resultIdentity(attemptId, pairId),
    epoch,
    checkpoint: resultCheckpointFor(attemptId),
    resultDigest,
    resultBytes: 12,
    recordedAt: Date.now(),
  })
}

export function resultAckFor(
  target: DeviceResultEnvelope,
  disposition: DeviceResultAck['disposition'],
): DeviceResultAck {
  return deviceResultAckSchema.parse({
    version: DEVICE_LIMITS.protocolVersion,
    identity: target.identity,
    epoch: target.epoch,
    resultDigest: target.resultDigest,
    settlementId: settlementFor(target.epoch, target.resultDigest),
    disposition,
    acknowledgedAt: Date.now(),
  })
}

export function resultRecord(attemptId: string, epochs: readonly number[]): DeviceResultRecord {
  const identity = resultIdentity(attemptId)
  return deviceResultRecordSchema.parse({
    version: DEVICE_LIMITS.protocolVersion,
    identity,
    receipts: epochs.map((epoch) => {
      const target = resultEnvelope(
        attemptId,
        epoch,
        resultDigestOf(`result-${attemptId}-${String(epoch)}`),
      )
      return { envelope: target, ack: resultAckFor(target, 'accepted') }
    }),
  })
}
