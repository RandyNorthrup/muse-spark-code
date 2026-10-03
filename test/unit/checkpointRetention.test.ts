import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseUnit } from '../../src/host/checkpoints/checkpointRecords'
import { droppedRecords, type RetainedRecord } from '../../src/host/checkpoints/checkpointRetention'
import { unitRef } from '../../src/host/checkpoints/recordRefs'
import { WriteJournal } from '../../src/host/checkpoints/writeJournal'
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
  owner,
  read,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  restoreOutcome,
  shadowGit,
  storedUnits,
  storedUnit,
  turn,
  turnRecorder,
  write,
} from './helpers/checkpointHarness'

// How long unit records are kept (M72, M86): within a conversation by
// number, never by the clock; whole conversations by recency and the
// setting's days; a conversation with a unit running stays whole. The
// integration tests lower the per-conversation bound to reach it quickly.
vi.mock('../../src/shared/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof constants>()),
  CHECKPOINTS_PER_SESSION_MAX: 3,
  CHECKPOINT_SESSIONS_MAX: 2,
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
    'retains identity metadata without file content or paths beyond canonical keys',
    async () => {
      const h = await harness()
      const canonicalKey = 'private-note.txt'
      const absolutePath = path.join(h.root, canonicalKey)
      const before = 'private before canary Ω'
      const after = 'private after canary Ω'
      await write(h.root, canonicalKey, before)
      const unitOwner = owner(h.store, 't1')
      const recorder = turnRecorder(h)
      await h.store.startUnit(unitOwner)
      await recorder.start(unitOwner).io.writeFile(absolutePath, after)
      await recorder.end(unitOwner)
      await h.store.endUnit(unitOwner, { ranProcesses: false })
      const recorded = storedUnit(h.storage, 't1').writes[0]
      expect(recorded?.path).toBe(canonicalKey)
      for (const turnId of ['t2', 't3', 't4']) {
        await turn(h, turnId)
      }

      // Read durable bytes independently: schema parsing could hide extra fields.
      const ref = unitRef('s1', 1)
      const identity = shadowGit(h.storage, ['cat-file', '-p', `${ref}:record.json`])
      expect(parseUnit(identity)).toMatchObject({
        owner: unitOwner,
        sequence: 1,
        isRetired: true,
        writes: [],
      })
      expect(shadowGit(h.storage, ['ls-tree', '-r', '--name-only', ref]).trim()).toBe('record.json')
      expect(identity).not.toContain(canonicalKey)
      const journal = await read(h.storage, `m86/${h.store.instance}/journal.jsonl`)
      const journals = await WriteJournal.readAll(h.storage)
      const retained = journals.get(h.store.instance)
      expect(
        retained?.entries
          .filter((entry) => entry.kind === 'intent')
          .map((entry) => entry.write.path),
      ).toEqual([canonicalKey])
      for (const text of [identity, journal]) {
        for (const forbidden of [before, after, absolutePath, h.root]) {
          expect(text).not.toContain(JSON.stringify(forbidden).slice(1, -1))
        }
      }
      for (const oid of [recorded?.before.oid, recorded?.after.oid]) {
        expect(oid).toBeDefined()
        expect(await isPresent(h.storage, `m86/${h.store.instance}/blobs/${oid ?? ''}`)).toBe(false)
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'bounds live shared-journal conversations by recency and age without poisoning new turns',
    async () => {
      let clock = NOW
      const h = await harness({ now: () => ++clock, retentionDays: () => 1 })
      await turn(h, 't1', (tool) => tool('a.txt', 'a\n'))
      const oid = storedUnit(h.storage, 't1').writes[0]?.after.oid
      expect(oid).toBeDefined()
      await turn(h, 'u1', (tool) => tool('b.txt', 'b\n'), 's2')
      await turn(h, 'v1', (tool) => tool('c.txt', 'c\n'), 's3')
      expect(
        storedUnits(h.storage)
          .map((unit) => unit.owner.sessionId)
          .toSorted((a, b) => a.localeCompare(b)),
      ).toEqual(['s2', 's3'])
      expect(await isPresent(h.storage, `m86/${h.store.instance}/blobs/${oid ?? ''}`)).toBe(false)
      clock += 2 * MILLISECONDS_PER_DAY
      await h.store.maintain()
      expect(storedUnits(h.storage)).toEqual([])
      await turn(h, 'new', (tool) => tool('a.txt', 'new\n'))
      expect(storedUnit(h.storage, 'new').sequence).toBe(2)
      expect(done(await restoreOutcome(h.store, 'new')).changed).toEqual(['a.txt'])
    },
    REAL_GIT_TIMEOUT_MS,
  )
  it(
    'T: bounds live and reloaded units by sequence while their shared journal remains',
    async () => {
      const h = await harness()
      for (const turnId of ['t1', 't2', 't3', 't4']) {
        await turn(h, turnId, (tool) => tool(`${turnId}.txt`, `${turnId}\n`))
      }
      // Retire only the oldest unit even while the instance remains live.
      expect(storedUnits(h.storage).map((entry) => entry.owner.unitId)).toEqual(['t2', 't3', 't4'])
      h.store.dispose()
      const next = h.reopen()
      await next.maintain()
      expect(storedUnits(h.storage)).toHaveLength(3)
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
