import { createHash } from 'node:crypto'
import { readdir, readFile, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { processGitProcess } from '../../src/host/git'
import { CHECKPOINT_PEER_SAVE_KEEP_MS } from '../../src/shared/constants'
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

const realGit = processGitProcess()

/** A window whose extension host is gone: its presence no longer counts. */
const GONE_PID = 424_242
/** How long a test waits for a window's saves file, which the save does not wait for. */
const SHARED_SAVE_WAIT_MS = 10_000

/** The saves files of every window on the folder, as text. */
async function savesFiles(storage: string): Promise<readonly string[]> {
  const folder = path.join(storage, 'windows')
  const names = await readdir(folder)
  return await Promise.all(
    names
      .filter((name) => name.endsWith('.saves'))
      .map((name) => readFile(path.join(folder, name), 'utf8')),
  )
}

/**
 * A turn edits model.txt while the user saves mine.txt, which `save` notes:
 * restoring the turn puts the model's edit back and leaves the user's, named.
 */
async function expectSaveKept(h: Harness, save: (file: string) => Promise<void>): Promise<void> {
  await write(h.root, 'model.txt', 'm0\n')
  await write(h.root, 'mine.txt', 'u0\n')
  await turn(h, 't1', async () => {
    await write(h.root, 'model.txt', 'm1\n')
    await write(h.root, 'mine.txt', 'u1\n')
    await save(path.join(h.root, 'mine.txt'))
  })
  const outcome = done(await restoreOutcome(h.store, 't1'))
  expect(outcome.refused).toEqual([{ path: 'mine.txt', reason: 'changedAfter' }])
  expect(await read(h.root, 'model.txt')).toBe('m0\n')
  expect(await read(h.root, 'mine.txt')).toBe('u1\n')
}

/** Waits until a window's saves file names the file. */
async function sharedSave(storage: string, relative: string): Promise<void> {
  await vi.waitFor(
    async () => {
      const files = await savesFiles(storage)
      expect(files.join('')).toContain(JSON.stringify(relative))
    },
    { timeout: SHARED_SAVE_WAIT_MS },
  )
}

/** Rewrites a turn's stored record, each field through `replace` (a JSON replacer). */
function rewriteRecord(
  storage: string,
  sessionId: string,
  turnId: string,
  replace: (key: string, value: unknown) => unknown,
): void {
  const id = createHash('sha256')
    .update(JSON.stringify([sessionId, turnId]))
    .digest('hex')
  const ref = `refs/muse-spark/record/checkpoint-${id}`
  const json = shadowGit(storage, ['cat-file', '-p', `${ref}:record.json`])
  const rewritten = JSON.stringify(JSON.parse(json), replace)
  const blob = shadowGit(storage, ['hash-object', '-w', '--stdin'], rewritten).trim()
  const entries = shadowGit(storage, ['ls-tree', ref])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => (line.endsWith('\trecord.json') ? `100644 blob ${blob}\trecord.json` : line))
  const tree = shadowGit(storage, ['mktree'], `${entries.join('\n')}\n`).trim()
  shadowGit(storage, ['update-ref', ref, tree])
}

/**
 * Rewrites a turn's stored record as a 0.10.0 candidate wrote it: the same
 * record with no turn numbers.
 */
function asWrittenUnnumbered(storage: string, sessionId: string, turnId: string): void {
  rewriteRecord(storage, sessionId, turnId, (key, value) =>
    key === 'sequence' || key === 'endSequence' ? undefined : value,
  )
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

describe('one conversation open in two windows (M72)', () => {
  it.each([
    { numbered: 'after the restored turn’s start', endSequence: undefined },
    // The later turn's start is the conversation's second number.
    { numbered: 'at once with the restored turn’s start', endSequence: 2 },
  ])(
    'refuses an earlier turn’s edit made after the restored turn started, its end numbered $numbered, and restores the restored turn’s own',
    async ({ endSequence }) => {
      const h = await harness()
      const second = h.reopen()
      await write(h.root, 'x.txt', 'x0\n')
      await write(h.root, 'y.txt', 'y0\n')
      // The first window's turn starts; the conversation's next one starts
      // in the second window while it runs.
      await h.store.record('s1', 'early', await captured(h.store))
      await second.record('s1', 'later', await captured(second))
      // The earlier turn edits x after that start, then ends.
      await write(h.root, 'x.txt', 'x1\n')
      await h.store.endTurn('s1', 'early')
      await write(h.root, 'y.txt', 'y1\n')
      await second.endTurn('s1', 'later')
      if (endSequence !== undefined) {
        // Both windows read the conversation's records before either wrote.
        rewriteRecord(h.storage, 's1', 'early', (key, value) =>
          key === 'endSequence' ? endSequence : value,
        )
      }
      const outcome = done(await restoreOutcome(second, 'later'))
      // The earlier turn is not undone, so its edit stays, named.
      expect(outcome.refused).toEqual([{ path: 'x.txt', reason: 'changedAfter' }])
      expect(await read(h.root, 'x.txt')).toBe('x1\n')
      expect(await read(h.root, 'y.txt')).toBe('y0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'bounds an earlier turn whose window went before its end was seen at the next turn (a reload)',
    async () => {
      const h = await harness({ isProcessAlive: (pid) => pid !== GONE_PID })
      const gone = h.reopen(GONE_PID)
      await write(h.root, 'x.txt', 'x0\n')
      await write(h.root, 'y.txt', 'y0\n')
      await gone.record('s1', 'early', await captured(gone))
      // The earlier turn edits x; then its window goes (a reload) and the
      // conversation goes on in the next one.
      await write(h.root, 'x.txt', 'x1\n')
      await turn(h, 'later', () => write(h.root, 'y.txt', 'y1\n'))
      const outcome = done(await restoreOutcome(h.store, 'later'))
      expect(outcome.refused).toEqual([])
      expect(await read(h.root, 'x.txt')).toBe('x1\n')
      expect(await read(h.root, 'y.txt')).toBe('y0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'lets an earlier turn that ended before the restored turn started add nothing',
    async () => {
      const h = await harness()
      await write(h.root, 'x.txt', 'x0\n')
      await turn(h, 'early', () => write(h.root, 'x.txt', 'x1\n'))
      await turn(h, 'later', () => write(h.root, 'x.txt', 'x2\n'))
      const outcome = done(await restoreOutcome(h.store, 'later'))
      expect(outcome.refused).toEqual([])
      expect(await read(h.root, 'x.txt')).toBe('x1\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

/**
 * Another conversation's turn starts, then this one's; the other edits f
 * while this one runs, and its window goes before its end is seen.
 * `meanwhile` runs next; then this turn edits y, ends, and is restored.
 */
async function restoreAfterPeerWent(
  meanwhile: (h: Harness) => Promise<void>,
): Promise<{ readonly h: Harness; readonly outcome: ReturnType<typeof done> }> {
  let clock = 1000
  let isPeerAlive = true
  const h = await harness({
    now: () => clock,
    isProcessAlive: (pid) => pid !== GONE_PID || isPeerAlive,
  })
  const peer = h.reopen(GONE_PID)
  await write(h.root, 'f.txt', 'f0\n')
  await write(h.root, 'y.txt', 'y0\n')
  await peer.record('s2', 'peer', await captured(peer))
  clock = 2000
  await h.store.record('s1', 't1', await captured(h.store))
  await write(h.root, 'f.txt', 'f1\n')
  isPeerAlive = false
  clock = 3000
  await meanwhile(h)
  await write(h.root, 'y.txt', 'y1\n')
  clock = 4000
  await h.store.endTurn('s1', 't1')
  return { h, outcome: done(await restoreOutcome(h.store, 't1')) }
}

describe('another conversation’s turn whose window went before its end was seen (M72)', () => {
  it(
    'refuses what changed while the restored turn ran when that conversation never went on',
    async () => {
      const { h, outcome } = await restoreAfterPeerWent(() => Promise.resolve())
      // Its end may have come at any time up to now: this turn's own edit of
      // y cannot be told from it either.
      expect(outcome.refused).toEqual([
        { path: 'f.txt', reason: 'changedAfter' },
        { path: 'y.txt', reason: 'changedAfter' },
      ])
      expect(await read(h.root, 'f.txt')).toBe('f1\n')
      expect(await read(h.root, 'y.txt')).toBe('y1\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'blames on it only what changed before its conversation’s next turn started',
    async () => {
      const { h, outcome } = await restoreAfterPeerWent(async ({ reopen }) => {
        // The other conversation goes on in another window: its next turn
        // starts, so the turn before it had ended; it changes nothing.
        const reopened = reopen()
        await reopened.record('s2', 'next', await captured(reopened))
        await reopened.endTurn('s2', 'next')
      })
      expect(outcome.refused).toEqual([{ path: 'f.txt', reason: 'changedAfter' }])
      expect(await read(h.root, 'f.txt')).toBe('f1\n')
      expect(await read(h.root, 'y.txt')).toBe('y0\n')
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
    'keeps a tool’s copy of an ignored file taken after the clock went back during the turn, and restores the file',
    async () => {
      let clock = 5000
      const h = await harness({ now: () => clock })
      await write(h.root, '.gitignore', '*.log\n')
      await write(h.root, 'out.log', 'one\n')
      await turn(h, 't1', async () => {
        // The wall clock is set back after the turn's start capture, before the tool's copy.
        clock = 1000
        await h.store.beforeToolWrite(path.join(h.root, 'out.log'))
        await write(h.root, 'out.log', 'two two\n')
      })
      const outcome = done(await restoreOutcome(h.store, 't1'))
      expect(outcome.refused).toEqual([])
      expect(await read(h.root, 'out.log')).toBe('one\n')
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
      // The user saves in the editor while the turn runs.
      await expectSaveKept(h, (file) => {
        h.store.noteUserSave(file)
        return Promise.resolve()
      })
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

  it.each(['this window', 'another window on the folder'] as const)(
    'counts a save in %s that lands while the start capture runs, after it read the file',
    async (where) => {
      let duringCapture: (() => Promise<void>) | undefined
      const h = await harness({
        gitProcess: async (args, options) => {
          // A capture before a turn lists its folders last, after the index
          // holds the files' bytes: the user saves just then.
          const step = duringCapture
          if (step !== undefined && args.includes('--directory')) {
            duringCapture = undefined
            await step()
          }
          return await realGit(args, options)
        },
      })
      await write(h.root, 'model.txt', 'm0\n')
      await write(h.root, 'mine.txt', 'u0\n')
      // The other window runs no turn: its saves reach this one through its saves file.
      const saver = where === 'this window' ? h.store : h.reopen()
      await h.store.markTurn('pending:first', true, true)
      duringCapture = async () => {
        await write(h.root, 'mine.txt', 'saved by the user\n')
        saver.noteUserSave(path.join(h.root, 'mine.txt'))
        if (saver !== h.store) {
          await sharedSave(h.storage, 'mine.txt')
        }
      }
      const start = await captured(h.store)
      // The start capture holds the bytes from before the save.
      expect(shadowGit(h.storage, ['cat-file', '-p', `${start.tree}:mine.txt`])).toBe('u0\n')
      await h.store.record('s1', 't1', start)
      await write(h.root, 'model.txt', 'm1\n')
      await h.store.endTurn('s1', 't1')
      await h.store.markTurn('pending:first', false, true)
      const outcome = done(await restoreOutcome(h.store, 't1'))
      expect(outcome.refused).toEqual([{ path: 'mine.txt', reason: 'changedAfter' }])
      expect(await read(h.root, 'mine.txt')).toBe('saved by the user\n')
      expect(await read(h.root, 'model.txt')).toBe('m0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('what a restore cannot know about another window’s turn (M72)', () => {
  it(
    'never undoes a turn numbered at once with the restored one, whichever the refs list first',
    async () => {
      const h = await harness()
      const second = h.reopen()
      await write(h.root, 'x.txt', 'x0\n')
      await write(h.root, 'y.txt', 'y0\n')
      // Ref names are hashes: "after" lists before "before", the order a tie is left to.
      await h.store.record('s1', 'before', await captured(h.store))
      await second.record('s1', 'after', await captured(second))
      await write(h.root, 'x.txt', 'x1\n')
      await h.store.endTurn('s1', 'before')
      await write(h.root, 'y.txt', 'y1\n')
      await second.endTurn('s1', 'after')
      // Both windows read the conversation's records before either wrote: one number.
      rewriteRecord(h.storage, 's1', 'after', (key, value) => (key === 'sequence' ? 1 : value))
      const outcome = done(await restoreOutcome(second, 'after'))
      expect(outcome.refused).toEqual([{ path: 'x.txt', reason: 'changedAfter' }])
      expect(await read(h.root, 'x.txt')).toBe('x1\n')
      expect(await read(h.root, 'y.txt')).toBe('y0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses an ignored file it would put back when a blamed turn left no list of its ignored changes',
    async () => {
      let isPeerAlive = true
      const h = await harness({ isProcessAlive: (pid) => pid !== GONE_PID || isPeerAlive })
      const peer = h.reopen(GONE_PID)
      await write(h.root, '.gitignore', '.env\n')
      await write(h.root, '.env', 'KEY=0\n')
      await peer.record('s2', 'peer', await captured(peer))
      await h.store.record('s1', 't1', await captured(h.store))
      // This turn's tool copies .env and writes it; the other window's turn
      // writes it after, and that window goes before its end is recorded.
      await h.store.beforeToolWrite(path.join(h.root, '.env'))
      await write(h.root, '.env', 'KEY=mine\n')
      await write(h.root, '.env', 'KEY=peer\n')
      isPeerAlive = false
      await h.store.endTurn('s1', 't1')
      const outcome = done(await restoreOutcome(h.store, 't1'))
      expect(outcome.refused).toContainEqual({ path: '.env', reason: 'changedAfter' })
      expect(await read(h.root, '.env')).toBe('KEY=peer\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('what the user saves in another window on the folder while a turn runs (M72)', () => {
  it(
    'leaves a file saved in a window that runs no turn as the user saved it',
    async () => {
      const h = await harness()
      const idle = h.reopen()
      // The user saves in the other window while this one's turn runs.
      await expectSaveKept(h, async (file) => {
        idle.noteUserSave(file)
        await sharedSave(h.storage, 'mine.txt')
      })
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'restores a file the user saved in another window before the turn started',
    async () => {
      const h = await harness()
      const idle = h.reopen()
      await write(h.root, 'model.txt', 'm0\n')
      await turn(h, 't0', () => Promise.resolve())
      await write(h.root, 'model.txt', 'u1\n')
      idle.noteUserSave(path.join(h.root, 'model.txt'))
      await sharedSave(h.storage, 'model.txt')
      await turn(h, 't1', () => write(h.root, 'model.txt', 'm1\n'))
      const outcome = done(await restoreOutcome(h.store, 't1'))
      expect(outcome.refused).toEqual([])
      expect(await read(h.root, 'model.txt')).toBe('u1\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'writes no saves file before the folder has a shadow repository',
    async () => {
      const h = await harness()
      await write(h.root, 'a.txt', 'a0\n')
      h.store.noteUserSave(path.join(h.root, 'a.txt'))
      // The capture sets the shadow repository up after the save.
      await captured(h.store)
      expect(await savesFiles(h.storage)).toEqual([])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each([
    { written: 'while the turn ran', isDuring: true },
    { written: 'before the turn started', isDuring: false },
  ])(
    'ends the turn past a saves file that cannot be read, written $written, leaving every file the turn changed alone only then',
    async ({ isDuring }) => {
      // The real clock: whether the file was written since the turn started is
      // read from its modification time.
      const h = await harness({ now: () => Date.now() })
      await write(h.root, 'model.txt', 'm0\n')
      await turn(h, 't0', () => Promise.resolve())
      const unreadable = path.join(h.storage, 'windows', 'unreadable.saves')
      if (!isDuring) {
        await writeFile(unreadable, '{not json')
        const before = new Date(Date.now() - CHECKPOINT_PEER_SAVE_KEEP_MS)
        await utimes(unreadable, before, before)
      }
      await turn(h, 't1', async () => {
        await write(h.root, 'model.txt', 'm1\n')
        if (isDuring) {
          await writeFile(unreadable, '{not json')
        }
      })
      const outcome = done(await restoreOutcome(h.store, 't1'))
      if (isDuring) {
        expect(h.log.warn).toHaveBeenCalledWith(expect.stringContaining('unreadable.saves'))
        expect(outcome.refused).toEqual([{ path: 'model.txt', reason: 'changedAfter' }])
        expect(await read(h.root, 'model.txt')).toBe('m1\n')
      } else {
        expect(h.log.warn).not.toHaveBeenCalledWith(expect.stringContaining('unreadable.saves'))
        expect(outcome.refused).toEqual([])
        expect(await read(h.root, 'model.txt')).toBe('m0\n')
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'leaves every file a turn past the keep time changed alone',
    async () => {
      let clock = 1000
      const h = await harness({ now: () => clock })
      await write(h.root, 'model.txt', 'm0\n')
      await turn(h, 't1', async () => {
        await write(h.root, 'model.txt', 'm1\n')
        clock += CHECKPOINT_PEER_SAVE_KEEP_MS + 1
      })
      const outcome = done(await restoreOutcome(h.store, 't1'))
      expect(outcome.refused).toEqual([{ path: 'model.txt', reason: 'changedAfter' }])
      expect(await read(h.root, 'model.txt')).toBe('m1\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
