import { afterEach, describe, expect, it, vi } from 'vitest'
import { droppedRecords, type RetainedRecord } from '../../src/host/checkpoints/checkpointRetention'
import type * as constants from '../../src/shared/constants'
import {
  CHECKPOINT_SESSIONS_MAX,
  CHECKPOINTS_PER_SESSION_MAX,
  MILLISECONDS_PER_DAY,
} from '../../src/shared/constants'
import {
  done,
  harness,
  isPresent,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  restoreOutcome,
  storedUnits,
  turn,
} from './helpers/checkpointHarness'

// How long unit records are kept (M72, M86): within a conversation by
// number, never by the clock; whole conversations by recency and the
// setting's days; a conversation with a unit running stays whole. The
// integration tests lower the per-conversation bound to reach it quickly.
vi.mock('../../src/shared/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof constants>()),
  CHECKPOINTS_PER_SESSION_MAX: 3,
}))

afterEach(async () => {
  await removeCheckpointFolders()
})

const NOW = 100 * MILLISECONDS_PER_DAY

interface Unit extends RetainedRecord {
  readonly id: string
}

function unit(id: string, sessionId: string, sequence: number, createdAt: number): Unit {
  return { id, sessionId, sequence, createdAt, isOpen: false }
}

const ids = (records: readonly Unit[]) =>
  records.map((record) => record.id).toSorted((left, right) => left.localeCompare(right))
const range = (count: number) => Array.from({ length: count }, (_, index) => index)

describe('droppedRecords (M72, M86)', () => {
  it('drops each conversation’s oldest units by number, whatever their clock says', () => {
    // The clock went back: the newest number has the oldest time.
    const units = range(CHECKPOINTS_PER_SESSION_MAX + 2).map((index) =>
      unit(`u${String(index)}`, 's1', index + 1, NOW - index),
    )
    expect(ids(droppedRecords(units, NOW, 30))).toEqual(['u0', 'u1'])
  })

  it('drops whole conversations beyond the most recently used, and those idle past the setting', () => {
    const sessions = range(CHECKPOINT_SESSIONS_MAX + 1)
    const units = [
      ...sessions.map((index) => unit(`u${String(index)}`, `s${String(index)}`, 1, NOW - index)),
      unit('idle-1', 'idle', 1, NOW - 31 * MILLISECONDS_PER_DAY),
      unit('idle-2', 'idle', 2, NOW - 31 * MILLISECONDS_PER_DAY),
    ]
    expect(ids(droppedRecords(units, NOW, 30))).toEqual([
      'idle-1',
      'idle-2',
      `u${String(CHECKPOINT_SESSIONS_MAX)}`,
    ])
  })

  it('keeps a conversation with a running unit whole, and everything with no day limit', () => {
    const units = range(CHECKPOINTS_PER_SESSION_MAX + 1).map((index) =>
      unit(`u${String(index)}`, 's1', index + 1, NOW - 90 * MILLISECONDS_PER_DAY),
    )

    const running = units.map((entry, index) => (index === 0 ? { ...entry, isOpen: true } : entry))
    expect(droppedRecords(running, NOW, 30)).toEqual([])
    expect(ids(droppedRecords(units, NOW, 0))).toEqual(['u0'])
    expect(droppedRecords(units, NOW, 30)).toHaveLength(units.length)
  })
})

describe('retention over real units (M86)', () => {
  it(
    'T: keeps every unit from a turn still offered on, and drops older ones once no journal names them',
    async () => {
      const h = await harness()
      for (const turnId of ['t1', 't2', 't3', 't4']) {
        await turn(h, turnId, (tool) => tool(`${turnId}.txt`, `${turnId}\n`))
      }
      // This live window's journal names every unit: none is dropped yet.
      expect(storedUnits(h.storage).map((entry) => entry.owner.unitId)).toEqual([
        't1',
        't2',
        't3',
        't4',
      ])
      h.store.dispose()
      const next = h.reopen()
      await next.maintain()
      // The window is gone, and its journal still names units the bound keeps.
      expect(storedUnits(h.storage)).toHaveLength(4)
      for (const turnId of ['t5', 't6', 't7']) {
        await turn({ store: next, root: h.root }, turnId, (tool) =>
          tool(`${turnId}.txt`, `${turnId}\n`),
        )
      }
      // Every unit the gone window's journal names may go now: they go together.
      expect(storedUnits(h.storage).map((entry) => entry.owner.unitId)).toEqual(['t5', 't6', 't7'])
      await next.maintain()
      expect(await isPresent(h.storage, `m86/${h.store.instance}`)).toBe(false)
      const restored = done(await restoreOutcome(next, 't5'))
      expect(restored.changed.toSorted((left, right) => left.localeCompare(right))).toEqual([
        't5.txt',
        't6.txt',
        't7.txt',
      ])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'T: deletes a gone window’s journal folder once no record names its units',
    async () => {
      const h = await harness()
      await turn(h, 't1', (tool) => tool('a.txt', 'a\n'))
      h.store.dispose()
      const next = h.reopen()
      await next.forgetSession('s1')
      expect(storedUnits(h.storage)).toEqual([])
      expect(await isPresent(h.storage, `m86/${h.store.instance}`)).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
