import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AttemptJournal,
  deviceDispatchDigest,
  type AttemptJournalOwner,
  type DeviceOutcome,
} from '../../src/core/devices/attemptJournal'
import { assertJournalOwner } from '../../src/host/devices/deviceProduction'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { deviceJournalRecordSchema, type DeviceDispatch } from '../../src/shared/devices'
import { canonicalUsd } from '../../src/shared/usdSchema'
import {
  deviceCheck,
  deviceGrant,
  deviceLane,
  useDeviceStorageRoot,
} from './helpers/deviceFixtures'

const NOW = Date.now()
function usageFor(index: number): DeviceOutcome['usage'] {
  return {
    settlementId: hexId(1000 + index),
    payer: 'local',
    certainty: 'known',
    inputTokens: 0,
    outputTokens: 0,
    returnedUsd: canonicalUsd(0),
    retainedLiabilityUsd: canonicalUsd(0),
  }
}

function hexId(value: number): string {
  return value.toString(16).padStart(32, '0')
}

function dispatchFor(index: number): DeviceDispatch {
  const grant = deviceGrant(hexId(1))
  const bare = deviceCheck({
    ...grant,
    offer: { ...grant.offer, grantId: hexId(100 + index), repositoryId: hexId(200 + index) },
  })
  const attemptId = hexId(300 + index)
  const shaped = {
    ...bare,
    identity: { ...bare.identity, attemptId },
  }
  return { ...shaped, payloadDigest: deviceDispatchDigest(shaped) }
}

describe('M100 attempt journal', () => {
  const { fixture } = useDeviceStorageRoot('m100-journal-')
  const owner = (): AttemptJournalOwner => ({
    assertOwner: () =>
      assertJournalOwner(fixture.parent, process.platform, () =>
        typeof process.getuid === 'function' ? process.getuid() : undefined,
      ),
  })

  it('admits intents and reads them back across reopen', async () => {
    const directory = path.join(fixture.parent, 'attempts')
    const journal = await AttemptJournal.create(directory, owner(), fixture.storage)
    const first = dispatchFor(0)
    const second = dispatchFor(1)
    await journal.sourceIntent(first, NOW)
    await journal.sourceIntent(second, NOW)
    expect(await journal.records()).toHaveLength(2)
    expect(await journal.lookup(first.identity)).toBeDefined()
    expect(await journal.lookup({ ...first.identity, attemptId: hexId(999) })).toBeUndefined()
    const reopened = await AttemptJournal.open(directory, owner(), fixture.storage)
    expect(await reopened.records()).toHaveLength(2)
  })

  it('admits live attempts past the removed bound', async () => {
    const directory = path.join(fixture.parent, 'attempts')
    const journal = await AttemptJournal.create(directory, owner(), fixture.storage)
    for (let index = 0; index < 5; index += 1)
      await journal.admit(dispatchFor(index), usageFor(index), NOW)
    expect(await journal.records()).toHaveLength(5)
    const records = Array.from({ length: 130 }, (_, index) => {
      const dispatch = dispatchFor(1000 + index)
      return {
        kind: 'receiver-record',
        recordedAt: NOW,
        outcome: {
          identity: dispatch.identity,
          payloadDigest: dispatch.payloadDigest,
          revision: 1,
          state: 'admitted',
          occupied: dispatch.caps,
          usage: usageFor(1000 + index),
        },
      }
    })
    const canonical = records.map((record) => deviceJournalRecordSchema.parse(record))
    await writeFile(
      path.join(directory, 'attempts.json'),
      JSON.stringify({
        version: DEVICE_LIMITS.protocolVersion,
        records: canonical,
        acknowledgements: [],
      }),
    )
    const reopened = await AttemptJournal.open(directory, owner(), fixture.storage)
    expect(await reopened.records()).toHaveLength(130)
  })

  it('records cancellations without bound', async () => {
    const directory = path.join(fixture.parent, 'attempts')
    const journal = await AttemptJournal.create(directory, owner(), fixture.storage)
    for (let index = 0; index < 5; index += 1)
      await journal.recordCancellation(dispatchFor(index).identity)
    expect(await journal.cancellations()).toHaveLength(5)
    const cancellations = Array.from({ length: 70_000 }, (_, index) => ({
      pairId: hexId(1),
      receiverIncarnationId: '1'.repeat(32),
      boardId: 'c'.repeat(32),
      taskId: 'd'.repeat(32),
      attemptId: hexId(90_000 + index),
    }))
    await writeFile(
      path.join(directory, 'attempts.json'),
      JSON.stringify({
        version: DEVICE_LIMITS.protocolVersion,
        records: [],
        cancellations,
        acknowledgements: [],
      }),
    )
    const reopened = await AttemptJournal.open(directory, owner(), fixture.storage)
    expect(await reopened.cancellations()).toHaveLength(70_000)
  })

  it('loads a journal file past the removed size bound', async () => {
    const directory = path.join(fixture.parent, 'attempts')
    const journal = await AttemptJournal.create(directory, owner(), fixture.storage)
    const lane = deviceLane(deviceGrant(hexId(1)))
    if (lane.kind !== 'lane') throw new Error('missing lane fixture')
    const big = { ...lane, brief: 'x'.repeat(17 * 1024 * 1024) }
    const dispatch = { ...big, payloadDigest: deviceDispatchDigest(big) }
    await journal.sourceIntent(dispatch, NOW)
    const reopened = await AttemptJournal.open(directory, owner(), fixture.storage)
    const records = await reopened.records()
    expect(records).toHaveLength(1)
    const record = records[0]
    if (record?.kind !== 'source-intent' || record.dispatch.kind !== 'lane')
      throw new Error('missing lane record')
    expect(record.dispatch.brief).toHaveLength(17 * 1024 * 1024)
  })

  it('refuses damaged state with storage', async () => {
    const directory = path.join(fixture.parent, 'attempts')
    await AttemptJournal.create(directory, owner(), fixture.storage)
    await writeFile(path.join(directory, 'attempts.json'), '{damaged')
    await expect(AttemptJournal.open(directory, owner(), fixture.storage)).rejects.toThrow(
      'storage',
    )
    await writeFile(
      path.join(directory, 'attempts.json'),
      JSON.stringify({ version: 1, records: [], acknowledgements: [] }),
    )
    await writeFile(path.join(directory, 'attempts.json.stage'), '{}')
    await expect(AttemptJournal.open(directory, owner(), fixture.storage)).rejects.toThrow(
      'storage',
    )
  })
})
