// Restore and Redo by the tools' own writes (M86, PLAN.md D63), over real
// git and files: the spec's integration rows A, B, M, R, X and the mode rule,
// with the store, its journal and the engine as they run in a window.

import { chmod, stat } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  done,
  harness,
  isPresent,
  read,
  redoOutcome,
  redoRestore,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  restoreOutcome,
  restoreTurn,
  storedUnit,
  storedUnits,
  turn,
  write,
} from './helpers/checkpointHarness'

afterEach(async () => {
  await removeCheckpointFolders()
})

const OWNER_EXECUTE_BIT = 0o100

describe('restore by the tools’ own writes (M86)', () => {
  it(
    'A: restores a created and a changed file, redoes it, and finds nothing to do the second time',
    async () => {
      const h = await harness()
      await write(h.root, 'b.txt', 'b0\n')
      await turn(h, 't1', async (tool) => {
        await tool('a.txt', 'a1\n')
        await tool('b.txt', 'b1\n')
      })

      const restored = await restoreTurn(h.store, 't1')
      expect(restored.changed.toSorted((left, right) => left.localeCompare(right))).toEqual([
        'a.txt',
        'b.txt',
      ])
      expect(restored.refused).toEqual([])
      expect(await isPresent(h.root, 'a.txt')).toBe(false)
      expect(await read(h.root, 'b.txt')).toBe('b0\n')
      expect(restored.restoreId).toBeDefined()

      const redone = await redoRestore(h.store, restored.restoreId)
      expect(redone.changed.toSorted((left, right) => left.localeCompare(right))).toEqual([
        'a.txt',
        'b.txt',
      ])
      expect(redone.isRedoSpent).toBe(true)
      expect(await read(h.root, 'a.txt')).toBe('a1\n')
      expect(await read(h.root, 'b.txt')).toBe('b1\n')

      const again = await redoRestore(h.store, restored.restoreId)
      expect(again.changed).toEqual([])
      expect(again.refused).toEqual([])
      expect(again.unchanged.toSorted((left, right) => left.localeCompare(right))).toEqual([
        'a.txt',
        'b.txt',
      ])
      expect(again.restoreId).toBeUndefined()
      expect(again.isRedoSpent).toBe(true)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'records the restore as a batch numbered after the turn, sealed complete with its writes done',
    async () => {
      const h = await harness()
      await turn(h, 't1', (tool) => tool('a.txt', 'a1\n'))
      const restored = await restoreTurn(h.store, 't1')
      const units = storedUnits(h.storage)
      expect(units.map((unit) => [unit.owner.unitKind, unit.sequence, unit.status])).toEqual([
        ['turn', 1, 'complete'],
        ['batch', 2, 'complete'],
      ])
      const batch = storedUnit(h.storage, restored.restoreId ?? '')
      expect(batch.writes.map((entry) => [entry.path, entry.outcome, entry.after.present])).toEqual(
        [['a.txt', 'done', false]],
      )
      expect(batch.endedAt).toBeDefined()
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'B: refuses a file the user saved after the tool wrote it, and restores the rest',
    async () => {
      const h = await harness()
      await turn(h, 't1', async (tool) => {
        await tool('a.txt', 'a1\n')
        await tool('b.txt', 'b1\n')
      })
      await write(h.root, 'b.txt', 'mine\n')
      const restored = await restoreTurn(h.store, 't1')
      expect(restored.changed).toEqual(['a.txt'])
      expect(restored.refused).toEqual([{ path: 'b.txt', reason: 'changedAfter' }])
      expect(await read(h.root, 'b.txt')).toBe('mine\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'B: refuses a file a peer window’s user saved after the tool wrote it, the peer idle',
    async () => {
      const h = await harness()
      const peer = h.reopen()
      await turn(h, 't1', (tool) => tool('a.txt', 'a1\n'))
      // The peer runs no turn: its user's save is a plain write of the file.
      await peer.turns('s1')
      await write(h.root, 'a.txt', 'peer\n')
      const restored = await restoreTurn(peer, 't1')
      expect(restored.changed).toEqual([])
      expect(restored.refused).toEqual([{ path: 'a.txt', reason: 'changedAfter' }])
      expect(await read(h.root, 'a.txt')).toBe('peer\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'B: refuses a file changed in the gap between the publication and its `done`',
    async () => {
      const h = await harness()
      await turn(h, 't1', async (tool) => {
        // Published, then the user's save lands before the write is settled.
        await tool('a.txt', 'a1\n', 'published')
        await write(h.root, 'a.txt', 'mine\n')
      })
      const outcome = await restoreOutcome(h.store, 't1')
      // An unsettled last write is judged by the bytes: neither its after nor its before.
      expect(done(outcome).refused).toEqual([{ path: 'a.txt', reason: 'changedAfter' }])
      expect(await read(h.root, 'a.txt')).toBe('mine\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'M: a file already put back (an Edit Review Revert) is unchanged, not refused',
    async () => {
      const h = await harness()
      await write(h.root, 'a.txt', 'a0\n')
      await turn(h, 't1', (tool) => tool('a.txt', 'a1\n'))
      await write(h.root, 'a.txt', 'a0\n')
      const restored = await restoreTurn(h.store, 't1')
      expect(restored.unchanged).toEqual(['a.txt'])
      expect(restored.changed).toEqual([])
      expect(restored.refused).toEqual([])
      expect(restored.restoreId).toBeUndefined()
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'R: says when a unit in range ran commands, and still restores',
    async () => {
      const h = await harness()
      await turn(h, 't1', (tool) => tool('a.txt', 'a1\n'))
      await turn(h, 't2', (tool) => tool('b.txt', 'b1\n'), 's1', { ranProcesses: true })
      const fromFirst = await restoreTurn(h.store, 't1')
      expect(fromFirst.ranProcesses).toBe(true)
      expect(fromFirst.changed.toSorted((left, right) => left.localeCompare(right))).toEqual([
        'a.txt',
        'b.txt',
      ])
      const h2 = await harness()
      await turn(h2, 't1', (tool) => tool('a.txt', 'a1\n'))
      const quiet = await restoreTurn(h2.store, 't1')
      expect(quiet.ranProcesses).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'X: a restore further back after a restore takes the batch into its range',
    async () => {
      const h = await harness()
      await write(h.root, 'a.txt', 'a0\n')
      await turn(h, 't1', (tool) => tool('a.txt', 'a1\n'))
      await turn(h, 't2', (tool) => tool('a.txt', 'a2\n'))
      const first = await restoreTurn(h.store, 't2')
      expect(first.changed).toEqual(['a.txt'])
      expect(await read(h.root, 'a.txt')).toBe('a1\n')
      await turn(h, 't3', (tool) => tool('a.txt', 'a3\n'))
      const back = await restoreTurn(h.store, 't1')
      expect(back.changed).toEqual(['a.txt'])
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'U: a Redo after a later unit wrote the path is refused changedBetween; another conversation cannot redo it',
    async () => {
      const h = await harness()
      await write(h.root, 'a.txt', 'a0\n')
      await turn(h, 't1', (tool) => tool('a.txt', 'a1\n'))
      const restored = await restoreTurn(h.store, 't1')
      const foreign = await redoOutcome(h.store, restored.restoreId, 'other')
      expect(foreign).toEqual({ ok: false, reason: 'redoGone' })
      expect(h.log.warn).toHaveBeenCalledWith(
        'A Redo was asked for from another conversation than its own',
      )
      await turn(h, 't2', (tool) => tool('a.txt', 'a2\n'))
      const redone = await redoRestore(h.store, restored.restoreId)
      expect(redone.refused).toEqual([{ path: 'a.txt', reason: 'changedBetween' }])
      expect(redone.isRedoSpent).toBe(false)
      expect(await read(h.root, 'a.txt')).toBe('a2\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.skipIf(process.platform === 'win32')(
    'L: keeps the user’s mode on a restored file, and gives a recreated file the mode it had',
    async () => {
      const h = await harness()
      await write(h.root, 'run.sh', 'echo 0\n')
      await chmod(path.join(h.root, 'run.sh'), 0o755)
      await write(h.root, 'keep.sh', 'echo 0\n')
      await turn(h, 't1', async (tool) => {
        await tool('keep.sh', 'echo 1\n')
        await tool('run.sh', null)
      })
      await chmod(path.join(h.root, 'keep.sh'), 0o700)
      const restored = await restoreTurn(h.store, 't1')
      expect(restored.changed.toSorted((left, right) => left.localeCompare(right))).toEqual([
        'keep.sh',
        'run.sh',
      ])
      expect(await read(h.root, 'keep.sh')).toBe('echo 0\n')
      const kept = await stat(path.join(h.root, 'keep.sh'))
      expect(kept.mode & 0o777).toBe(0o700)
      expect(await read(h.root, 'run.sh')).toBe('echo 0\n')
      const recreated = await stat(path.join(h.root, 'run.sh'))
      expect(recreated.mode & OWNER_EXECUTE_BIT).not.toBe(0)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
