// Units, their numbers, their ends and their recovery (M86, PLAN.md D63),
// over real git and files: the spec's integration rows D, E (the number's
// compare-and-swap and the merge across windows), F (crashes), P (records of
// 0.10.0) and Q (completeness), and the journal check of rule 3.2.

import { rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as constants from '../../src/shared/constants'
import { turnKey } from '../../src/core/checkpoints/turnKey'
import {
  finishCheckpointTurn,
  prepareCheckpointTurn,
} from '../../src/host/checkpoints/checkpointHost'
import { WriteJournal } from '../../src/host/checkpoints/writeJournal'
import { processGitProcess } from '../../src/host/git'
import {
  CHECKPOINT_FENCED_WINDOW,
  CHECKPOINT_LEGACY_FENCED_WINDOW,
  UI_TEXT,
} from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  checkpointPort,
  done,
  harness,
  isPresent,
  owner,
  read,
  recordingOf,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  restoreOutcome,
  restoreTurn,
  shadowGit,
  shadowRefs,
  storedUnit,
  toolWrite,
  turn,
  turnRecorder,
  twoConversations,
  write,
  writeLegacyRecord,
} from './helpers/checkpointHarness'

vi.mock('../../src/shared/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof constants>()),
  CHECKPOINT_UNIT_INTENTS_MAX: 2,
}))

afterEach(async () => {
  vi.restoreAllMocks()
  await removeCheckpointFolders()
})

const realGit = processGitProcess()
const GONE_PID = 424_242
const ABSENT = '0'.repeat(40)

/** A live window of 0.10.0 on this storage: its presence names only the v1 fence. */
async function legacyWindow(storage: string): Promise<void> {
  await write(
    storage,
    'windows/legacy-window.json',
    JSON.stringify({
      pid: process.pid,
      instance: 'legacy-window',
      running: [CHECKPOINT_LEGACY_FENCED_WINDOW],
    }),
  )
}

describe('units of a conversation (M86)', () => {
  it(
    'D: restores a parent turn through its child turns’ writes, in the window’s write order',
    async () => {
      const h = await harness()
      await write(h.root, 'f.txt', 'A\n')
      const parent = owner(h.store, 'p1')
      const child = owner(h.store, 'child:1')
      const later = owner(h.store, 'child:2')
      await h.store.startUnit(parent)
      await h.store.startUnit(child)
      await toolWrite(h.store, child, h.root, 'f.txt', 'B\n')
      await h.store.endUnit(child, { ranProcesses: false })
      await toolWrite(h.store, parent, h.root, 'f.txt', 'D\n')
      await h.store.startUnit(later)
      await toolWrite(h.store, later, h.root, 'f.txt', 'E\n')
      await h.store.endUnit(later, { ranProcesses: false })
      await h.store.endUnit(parent, { ranProcesses: false })
      const restored = done(await restoreOutcome(h.store, 'p1', 's1', ['p1', 'child:1', 'child:2']))
      expect(restored.changed).toEqual(['f.txt'])
      expect(await read(h.root, 'f.txt')).toBe('A\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'C: a command between two tool writes of one turn breaks the chain',
    async () => {
      const h = await harness()
      await write(h.root, 'a.txt', 'a0\n')
      await turn(h, 't1', async (tool) => {
        await tool('a.txt', 'a1\n')
        await write(h.root, 'a.txt', 'a command wrote this\n')
        await tool('a.txt', 'a2\n')
      })
      const restored = await restoreTurn(h.store, 't1')
      expect(restored.refused).toEqual([{ path: 'a.txt', reason: 'changedBetween' }])
      expect(await read(h.root, 'a.txt')).toBe('a2\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'E: takes the next number when another window took this one between the read and the create',
    async () => {
      let isRacing = true
      let storage = ''
      const h = await harness({
        gitProcess: async (args, options) => {
          const target = args.find((arg) => arg.includes('/m86/unit/') && arg.endsWith('/1'))
          if (isRacing && target !== undefined && args.includes(ABSENT)) {
            isRacing = false
            // Another window creates the same number first.
            const tree = shadowGit(storage, ['mktree'], '').trim()
            shadowGit(storage, ['update-ref', target, tree])
          }
          return await realGit(args, options)
        },
      })
      storage = h.storage
      expect(await h.store.startUnit(owner(h.store, 't1'))).toEqual({ sequence: 2 })
      expect(shadowRefs(h.storage).filter((ref) => ref.includes('/m86/unit/'))).toHaveLength(2)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'E: two windows starting units of one conversation at once take different numbers',
    async () => {
      const h = await harness()
      const other = h.reopen()
      const numbers = await Promise.all([
        h.store.startUnit(owner(h.store, 't1')),
        other.startUnit(owner(other, 't2')),
        h.store.startUnit(owner(h.store, 't3')),
      ])
      expect(
        numbers.map((entry) => entry.sequence).toSorted((left, right) => left - right),
      ).toEqual([1, 2, 3])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'E: merges two windows’ writes to one path when one order fits the bytes',
    async () => {
      const h = await twoWindowTurns()
      const restored = await restoreTurn(h.store, 't1')
      expect(restored.changed).toEqual(['a.txt'])
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'E: refuses orderUnknown when two windows’ writes could each come first',
    async () => {
      // The user put a0 back between them: each window's write could be first.
      const h = await twoWindowTurns(async (root) => {
        await write(root, 'a.txt', 'a0\n')
      })
      const restored = await restoreTurn(h.store, 't1')
      expect(restored.refused).toEqual([{ path: 'a.txt', reason: 'orderUnknown' }])
      expect(await read(h.root, 'a.txt')).toBe('a2\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'E: refuses changedBetween when no write of either window continues the chain',
    async () => {
      const h = await twoWindowTurns()
      await write(h.root, 'a.txt', 'a3\n')
      await turn(h, 't3', (tool) => tool('a.txt', 'a4\n'))
      const restored = await restoreTurn(h.store, 't1')
      expect(restored.refused).toEqual([{ path: 'a.txt', reason: 'changedBetween' }])
      expect(await read(h.root, 'a.txt')).toBe('a4\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

/** A window, of a process about to be gone, mid-turn: its unit started and one write made. */
async function windowMidTurn(settle: 'unpublished' | 'published' | 'done') {
  const h = await harness({ isProcessAlive: (pid) => pid !== GONE_PID })
  await write(h.root, 'a.txt', 'a0\n')
  const crashed = h.reopen(GONE_PID)
  const unit = owner(crashed, 't1')
  await crashed.startUnit(unit)
  await toolWrite(crashed, unit, h.root, 'a.txt', 'a1\n', settle)
  return { h, crashed, unit }
}

/** A window that wrote in a turn and went before the turn ended. */
async function crashedTurn(
  settle: 'unpublished' | 'published' | 'done',
): Promise<Awaited<ReturnType<typeof harness>>> {
  const { h, crashed } = await windowMidTurn(settle)
  crashed.dispose()
  return h
}

/**
 * Window one's turn `t1` writes `a.txt` a0 to a1, then (after `between`)
 * window two's turn `t2` of the same conversation writes it to a2.
 */
async function twoWindowTurns(between?: (root: string) => Promise<void>) {
  const h = await harness()
  const other = h.reopen()
  await write(h.root, 'a.txt', 'a0\n')
  await turn(h, 't1', (tool) => tool('a.txt', 'a1\n'))
  await between?.(h.root)
  await turn({ store: other, root: h.root }, 't2', (tool) => tool('a.txt', 'a2\n'))
  return h
}

describe('crashes and recovery (M86)', () => {
  it(
    'F: an intent whose file was never written is judged not done',
    async () => {
      const h = await crashedTurn('unpublished')
      await h.store.maintain()
      expect(storedUnit(h.storage, 't1')).toMatchObject({ status: 'complete', ranProcesses: true })
      expect(storedUnit(h.storage, 't1').writes.map((entry) => entry.outcome)).toEqual([
        'unsettled',
      ])
      const restored = await restoreTurn(h.store, 't1')
      expect(restored.unchanged).toEqual(['a.txt'])
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'F: an intent whose file was written, its `done` lost, is judged done and restored',
    async () => {
      const h = await crashedTurn('published')
      const restored = await restoreTurn(h.store, 't1')
      expect(restored.changed).toEqual(['a.txt'])
      expect(restored.ranProcesses).toBe(true)
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'F: refuses writesIncomplete when a later unit wrote over an unsettled write',
    async () => {
      const h = await crashedTurn('published')
      await turn(h, 't2', (tool) => tool('a.txt', 'a0\n'))
      expect(await restoreOutcome(h.store, 't1')).toEqual({
        ok: false,
        reason: 'writesIncomplete',
      })
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'F: a reload, then a restore by the new window',
    async () => {
      const h = await harness()
      await write(h.root, 'a.txt', 'a0\n')
      await turn(h, 't1', (tool) => tool('a.txt', 'a1\n'))
      h.store.dispose()
      const reloaded = h.reopen()
      await reloaded.maintain()
      await restoreTurn(reloaded, 't1')
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'F: a seal that failed after the fold leaves the record as it was folded; recovery changes nothing',
    async () => {
      const { h, crashed, unit } = await windowMidTurn('done')
      vi.spyOn(recordingOf(crashed).journal, 'appendSeal').mockRejectedValue(
        new Error('injected fsync failure'),
      )
      await expect(crashed.endUnit(unit, { ranProcesses: false })).rejects.toThrow(
        'injected fsync failure',
      )
      const folded = shadowRefs(h.storage)
      const record = storedUnit(h.storage, 't1')
      expect(record).toMatchObject({ status: 'complete', ranProcesses: false })
      crashed.dispose()
      await h.store.maintain()
      expect(shadowRefs(h.storage)).toEqual(folded)
      expect(storedUnit(h.storage, 't1')).toEqual(record)
      await restoreTurn(h.store, 't1')
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'F: a unit past its intent budget is folded incomplete, and any range holding it is refused',
    async () => {
      const h = await harness()
      await write(h.root, 'a.txt', 'a0\n')
      const unit = owner(h.store, 't1')
      const recorder = turnRecorder(h)
      await h.store.startUnit(unit)
      const writes = recorder.start(unit).io
      for (const file of ['a.txt', 'b.txt', 'c.txt']) {
        await writes.writeFile(path.join(h.root, file), 'a1\n')
      }
      await recorder.end(unit)
      await h.store.endUnit(unit, { ranProcesses: false })
      expect(storedUnit(h.storage, 't1')).toMatchObject({
        status: 'incomplete',
        isMarkedIncomplete: true,
      })
      expect(await restoreOutcome(h.store, 't1')).toEqual({
        ok: false,
        reason: 'writesIncomplete',
      })
      expect(await read(h.root, 'a.txt')).toBe('a1\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each([
    // The line that did not parse could have been any unsealed unit's.
    { tornTail: 'unparsed' as const, last: 'done' as const, status: 'incomplete' },
    // The torn line parsed as the intent it was: that write is only unsettled.
    { tornTail: 'intent' as const, last: 'published' as const, status: 'complete' },
  ])(
    'F: a torn last journal line ($tornTail) of a gone window folds its unsealed unit $status',
    async ({ tornTail, last, status }) => {
      const h = await crashedTurn(last)
      const readAll = WriteJournal.readAll.bind(WriteJournal)
      vi.spyOn(WriteJournal, 'readAll').mockImplementation(async (storageDir) => {
        const journals = await readAll(storageDir)
        return new Map(
          [...journals].map(([instance, journal]) => [
            instance,
            instance === h.store.instance ? journal : { ...journal, tornTail },
          ]),
        )
      })
      await h.store.maintain()
      expect(storedUnit(h.storage, 't1').status).toBe(status)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'F: a gone window’s unit with no journal line at all is folded complete, with nothing written',
    async () => {
      const h = await harness({ isProcessAlive: (pid) => pid !== GONE_PID })
      const crashed = h.reopen(GONE_PID)
      await crashed.startUnit(owner(crashed, 't1'))
      crashed.dispose()
      await h.store.maintain()
      expect(storedUnit(h.storage, 't1')).toMatchObject({ status: 'complete', writes: [] })
      expect(done(await restoreOutcome(h.store, 't1')).changed).toEqual([])
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('completeness (M86, spec 3.2)', () => {
  it(
    'Q: refuses writesIncomplete when a turn of the transcript in range has no record',
    async () => {
      const h = await harness()
      await turn(h, 't1', (tool) => tool('a.txt', 'a1\n'))
      // t2 ran with file checkpoints off: no unit.
      await write(h.root, 'b.txt', 'b by an unrecorded turn\n')
      expect(await restoreOutcome(h.store, 't1', 's1', ['t1', 't2'])).toEqual({
        ok: false,
        reason: 'writesIncomplete',
      })
      expect(done(await restoreOutcome(h.store, 't1', 's1', ['t1'])).changed).toEqual(['a.txt'])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'Q: a turn whose record failed runs unrecorded, and a range holding it is refused',
    async () => {
      let isFailing = false
      const h = await harness({
        gitProcess: async (args, options) => {
          if (
            isFailing &&
            args.includes('update-ref') &&
            args.some((arg) => arg.includes('/m86/unit/'))
          ) {
            throw new Error('injected record failure')
          }
          return await realGit(args, options)
        },
      })
      const port = checkpointPort(h, true, () => true)
      const recorder = turnRecorder(h)
      const log = new FakeLogOutputChannel()
      const first = await prepareCheckpointTurn(port, recorder, 's1', 't1', log)
      expect(first).toMatchObject({ kind: 'recording' })
      await finishCheckpointTurn(port, recorder, 's1', 't1', {
        checkpoint: first,
        ranProcesses: false,
      })
      isFailing = true
      expect(await prepareCheckpointTurn(port, recorder, 's1', 't2', log)).toEqual({
        kind: 'failed',
      })
      isFailing = false
      await port.markTurn(turnKey('s1', 't2'), false)
      expect(await restoreOutcome(h.store, 't1', 's1', ['t1', 't2'])).toEqual({
        ok: false,
        reason: 'writesIncomplete',
      })
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'Q: a child turn records with checkpoints off when its top turn records',
    async () => {
      const h = await harness()
      const port = checkpointPort(h, true, () => false)
      const recorder = turnRecorder(h)
      const log = new FakeLogOutputChannel()
      // An older child with no known inherited decision must not run.
      await expect(
        prepareCheckpointTurn(port, recorder, 's1', 'child:1', log, {
          checkpoint: undefined,
        }),
      ).rejects.toThrow(UI_TEXT.childCheckpointFailed)
      const top = {
        checkpoint: { kind: 'failed' } as const,
      }
      expect(await prepareCheckpointTurn(port, recorder, 's1', 'child:2', log, top)).toMatchObject({
        kind: 'recording',
        owner: { unitId: 'child:2' },
      })
      expect(storedUnit(h.storage, 'child:2').owner.unitKind).toBe('turn')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses writesIncomplete when a journal names a unit of the conversation that has no record',
    async () => {
      const h = await harness()
      await turn(h, 't1', (tool) => tool('a.txt', 'a1\n'))
      // A write recorded under an owner whose unit was never made.
      await toolWrite(h.store, owner(h.store, 'ghost'), h.root, 'b.txt', 'b\n')
      expect(await restoreOutcome(h.store, 't1')).toEqual({
        ok: false,
        reason: 'writesIncomplete',
      })
      // Another conversation's unrecorded owner is not this one's concern.
      const other = await harness()
      await turn(other, 't1', (tool) => tool('a.txt', 'a1\n'))
      await toolWrite(other.store, owner(other.store, 'ghost', 's2'), other.root, 'b.txt', 'b\n')
      expect(done(await restoreOutcome(other.store, 't1')).changed).toEqual(['a.txt'])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses writesIncomplete when a unit in range has a record that does not parse',
    async () => {
      const h = await harness()
      await turn(h, 't1', (tool) => tool('a.txt', 'a1\n'))
      // A unit that wrote nothing: no journal names it, so its record alone
      // says it is in range.
      await turn(h, 't2', async () => {
        // No tool ran.
      })
      const ref = shadowRefs(h.storage).find((entry) => entry.endsWith('/2'))
      if (ref === undefined) {
        throw new Error('expected the second unit’s ref')
      }
      const blob = shadowGit(h.storage, ['hash-object', '-w', '--stdin'], '{not json').trim()
      const tree = shadowGit(h.storage, ['mktree'], `100644 blob ${blob}\trecord.json\n`).trim()
      shadowGit(h.storage, ['update-ref', ref, tree])
      expect(await restoreOutcome(h.store, 't1')).toEqual({
        ok: false,
        reason: 'writesIncomplete',
      })
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('records of 0.10.0 and its windows (M86, spec 7)', () => {
  it(
    'P: lists an M72 turn as legacy, refuses a range holding it, and numbers new units after it',
    async () => {
      const h = await harness()
      await h.store.turns('s1')
      writeLegacyRecord(h.storage, h.top, {
        kind: 'checkpoint',
        id: 'old',
        sessionId: 's1',
        turnId: 'm72-turn',
        sequence: 4,
        endSequence: 5,
      })
      expect(await h.store.legacyTurns('s1')).toEqual(['m72-turn'])
      expect(await h.store.turns('s1')).toEqual([])
      expect(await restoreOutcome(h.store, 'm72-turn')).toEqual({
        ok: false,
        reason: 'legacyInRange',
      })
      await turn(h, 't1', (tool) => tool('a.txt', 'a1\n'))
      expect(storedUnit(h.storage, 't1').sequence).toBe(6)
      // A range from a later turn holds no legacy turn.
      expect(done(await restoreOutcome(h.store, 't1')).changed).toEqual(['a.txt'])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'P: refuses its own restores while a 0.10.0 window is live, and deletes no record',
    async () => {
      const h = await harness()
      await twoConversations(h)
      await legacyWindow(h.storage)
      expect(await restoreOutcome(h.store, 't1')).toEqual({
        ok: false,
        reason: 'legacyWindowOpen',
      })
      const refs = shadowRefs(h.storage)
      await h.store.forgetSession('s2')
      await h.store.maintain()
      expect(shadowRefs(h.storage)).toEqual(refs)
      expect(await isPresent(h.root, 'a.txt')).toBe(true)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'P: publishes the v2 fence only, which a 0.10.0 window reads as unfenced',
    async () => {
      const h = await harness()
      await h.store.markTurn('pending:message', true)
      const presence = await read(h.storage, `windows/${h.store.instance}.json`)
      const running = (JSON.parse(presence) as { readonly running: readonly string[] }).running
      expect(running).toContain(CHECKPOINT_FENCED_WINDOW)
      expect(running).not.toContain(CHECKPOINT_LEGACY_FENCED_WINDOW)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'P: deletes the M72 restore records it cannot redo once no 0.10.0 window is live',
    async () => {
      const h = await harness()
      await h.store.turns('s1')
      writeLegacyRecord(h.storage, h.top, { kind: 'restore', id: 'old-redo', sessionId: 's1' })
      await legacyWindow(h.storage)
      await h.store.maintain()
      expect(shadowRefs(h.storage)).toContain('refs/muse-spark/record/old-redo')
      await rm(path.join(h.storage, 'windows', 'legacy-window.json'))
      await h.reopen().maintain()
      expect(shadowRefs(h.storage)).not.toContain('refs/muse-spark/record/old-redo')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
