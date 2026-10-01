import { createHash } from 'node:crypto'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  captured,
  done,
  type Harness,
  harness,
  read,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  restoreOutcome,
  shadowGit,
  turn,
  write,
} from './helpers/checkpointHarness'

afterEach(removeCheckpointFolders)

/**
 * Rewrites a turn's stored record as a 0.10.0 candidate wrote it: the same
 * record with no turn numbers.
 */
function asWrittenUnnumbered(storage: string, sessionId: string, turnId: string): void {
  const id = createHash('sha256')
    .update(JSON.stringify([sessionId, turnId]))
    .digest('hex')
  const ref = `refs/muse-spark/record/checkpoint-${id}`
  const json = shadowGit(storage, ['cat-file', '-p', `${ref}:record.json`])
  const unnumbered = JSON.stringify(JSON.parse(json), (key, value: unknown) =>
    key === 'sequence' || key === 'endSequence' ? undefined : value,
  )
  const blob = shadowGit(storage, ['hash-object', '-w', '--stdin'], unnumbered).trim()
  const entries = shadowGit(storage, ['ls-tree', ref])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => (line.endsWith('\trecord.json') ? `100644 blob ${blob}\trecord.json` : line))
  const tree = shadowGit(storage, ['mktree'], `${entries.join('\n')}\n`).trim()
  shadowGit(storage, ['update-ref', ref, tree])
}

/**
 * Two turns of one conversation with the user's edit between them, and
 * `between` run before the second starts: restoring the first puts both
 * turns' edits back and keeps the user's, named.
 */
async function expectUserEditKept(h: Harness, between: () => void): Promise<void> {
  for (const name of ['a', 'b', 'gap']) {
    await write(h.root, `${name}.txt`, `${name}0\n`)
  }
  await turn(h, 'first', () => write(h.root, 'a.txt', 'a1\n'))
  await write(h.root, 'gap.txt', 'gap-user\n')
  between()
  await turn(h, 'second', () => write(h.root, 'b.txt', 'b1\n'))
  const outcome = done(await restoreOutcome(h.store, 'first'))
  expect(outcome.refused).toEqual([{ path: 'gap.txt', reason: 'changedAfter' }])
  expect(await read(h.root, 'gap.txt')).toBe('gap-user\n')
  expect(await read(h.root, 'a.txt')).toBe('a0\n')
  expect(await read(h.root, 'b.txt')).toBe('b0\n')
}

describe('turns in two windows that touch at one clock tick (M72)', () => {
  it(
    'protects the other window’s edit when its turn ends at the tick this turn starts',
    async () => {
      let clock = 1000
      const h = await harness({ now: () => clock })
      const other = h.reopen()
      await write(h.root, 'x.txt', 'x0\n')
      await write(h.root, 'y.txt', 'y0\n')
      // Window A's turn starts at tick 1000.
      await h.store.record('sA', 'tA', await captured(h.store))
      // Window B's turn starts at tick 2000, before A edits x.
      clock = 2000
      await other.record('sB', 'tB', await captured(other))
      // A's edit lands inside B's turn, and A's turn ends at the same tick 2000.
      await write(h.root, 'x.txt', 'x1\n')
      await h.store.endTurn('sA', 'tA')
      clock = 3000
      await write(h.root, 'y.txt', 'y1\n')
      await other.endTurn('sB', 'tB')
      const outcome = await restoreOutcome(other, 'tB', 'sB')
      expect(outcome.ok).toBe(true)
      // B's own edit goes back; A's edit, which B's end capture holds, stays.
      expect(await read(h.root, 'y.txt')).toBe('y0\n')
      expect(await read(h.root, 'x.txt')).toBe('x1\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('turns of one conversation that overlap (M72)', () => {
  it(
    'restores a parent turn’s own edits made after its subagent’s turn started, and still guards the gap after both',
    async () => {
      let clock = 1000
      const h = await harness({ now: () => clock })
      for (const name of ['a', 'b', 'c', 'gap', 'n']) {
        await write(h.root, `${name}.txt`, `${name}0\n`)
      }
      // The parent's turn starts and edits a.
      await h.store.record('s1', 'parent', await captured(h.store))
      await write(h.root, 'a.txt', 'a1\n')
      // Its subagent's turn starts in the same conversation while the parent runs.
      clock = 2000
      await h.store.record('s1', 'child', await captured(h.store))
      // The parent edits b after the subagent started, then ends.
      await write(h.root, 'b.txt', 'b1\n')
      clock = 3000
      await h.store.endTurn('s1', 'parent')
      // The subagent outlives its parent: it edits c, then ends.
      await write(h.root, 'c.txt', 'c1\n')
      clock = 4000
      await h.store.endTurn('s1', 'child')
      // The user edits a file between the turns; then the next turn runs.
      await write(h.root, 'gap.txt', 'gap-user\n')
      clock = 5000
      await turn(h, 'next', () => write(h.root, 'n.txt', 'n1\n'))
      const outcome = done(await restoreOutcome(h.store, 'parent'))
      // Only the user's edit between the turns is outside them: it stays, named.
      expect(outcome.refused).toEqual([{ path: 'gap.txt', reason: 'changedAfter' }])
      expect(await read(h.root, 'gap.txt')).toBe('gap-user\n')
      for (const name of ['a', 'b', 'c', 'n']) {
        expect(await read(h.root, `${name}.txt`)).toBe(`${name}0\n`)
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('turns of one conversation the clock cannot order (M72)', () => {
  it.each([
    { when: 'in the same millisecond', first: 1000, second: 1000 },
    { when: 'after the clock went back', first: 5000, second: 1000 },
  ])(
    'restores only the later turn’s ignored-file change when the turns start $when',
    async ({ first, second }) => {
      let clock = first
      const h = await harness({ now: () => clock })
      await write(h.root, '.gitignore', '*.log\n')
      await write(h.root, 'out.log', 'one\n')
      await turn(h, 'first', async () => {
        await h.store.beforeToolWrite(path.join(h.root, 'out.log'))
        await write(h.root, 'out.log', 'two two\n')
      })
      clock = second
      await turn(h, 'second', async () => {
        await h.store.beforeToolWrite(path.join(h.root, 'out.log'))
        await write(h.root, 'out.log', 'three three three\n')
      })
      const outcome = done(await restoreOutcome(h.store, 'second'))
      // The file goes back to what the second turn found, not to what the first did.
      expect(outcome.refused).toEqual([])
      expect(await read(h.root, 'out.log')).toBe('two two\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'still guards a user’s edit between two turns when the clock went back between them',
    async () => {
      let clock = 5000
      const h = await harness({ now: () => clock })
      await expectUserEditKept(h, () => {
        clock = 1000
      })
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'orders a turn a 0.10.0 candidate recorded (no number) by its clock, before the numbered turns after it',
    async () => {
      const h = await harness()
      await expectUserEditKept(h, () => {
        asWrittenUnnumbered(h.storage, 's1', 'first')
      })
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('what the user saves while a turn runs (M72)', () => {
  it(
    "leaves a file the user saved during the turn as they saved it, and restores the turn's own",
    async () => {
      const h = await harness()
      await write(h.root, 'model.txt', 'm0\n')
      await write(h.root, 'mine.txt', 'u0\n')
      await turn(h, 't1', async () => {
        await write(h.root, 'model.txt', 'm1\n')
        // The user saves in the editor while the turn runs.
        await write(h.root, 'mine.txt', 'u1\n')
        h.store.noteUserSave(path.join(h.root, 'mine.txt'))
      })
      const outcome = done(await restoreOutcome(h.store, 't1'))
      expect(outcome.refused).toEqual([{ path: 'mine.txt', reason: 'changedAfter' }])
      expect(await read(h.root, 'model.txt')).toBe('m0\n')
      expect(await read(h.root, 'mine.txt')).toBe('u1\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'counts a save between the start capture and the turn’s record, and none while nothing runs',
    async () => {
      const h = await harness()
      await write(h.root, 'early.txt', 'e0\n')
      await write(h.root, 'idle.txt', 'i0\n')
      // Nothing runs: this save is before any turn, and no turn's to keep.
      await write(h.root, 'idle.txt', 'i1\n')
      h.store.noteUserSave(path.join(h.root, 'idle.txt'))
      await h.store.markTurn('pending:first', true, true)
      const start = await captured(h.store)
      await write(h.root, 'early.txt', 'e1\n')
      h.store.noteUserSave(path.join(h.root, 'early.txt'))
      await h.store.record('s1', 't1', start)
      await write(h.root, 'idle.txt', 'i2\n')
      await h.store.endTurn('s1', 't1')
      await h.store.markTurn('pending:first', false, true)
      const outcome = done(await restoreOutcome(h.store, 't1'))
      expect(outcome.refused).toEqual([{ path: 'early.txt', reason: 'changedAfter' }])
      expect(await read(h.root, 'early.txt')).toBe('e1\n')
      expect(await read(h.root, 'idle.txt')).toBe('i1\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
