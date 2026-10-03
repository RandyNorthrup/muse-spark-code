import { mkdir, readFile, readdir, stat, utimes } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { processGitProcess } from '../../src/host/git'
import { CHECKPOINT_FILE_MAX_BYTES, CHECKPOINT_PRUNE_GRACE_MS } from '../../src/shared/constants'
import {
  restoreOutcome,
  done,
  entryCount,
  harness,
  isPresent,
  owner,
  read,
  REAL_GIT_TIMEOUT_MS,
  redoOutcome,
  redoRestore,
  removeCheckpointFolders,
  runGit,
  storedUnit,
  treeListing,
  turn,
  twoFileTurn,
  write,
} from './helpers/checkpointHarness'

// Real git over throwaway folders (M72, M86): each test makes its own
// workspace and storage folder, so nothing is shared and every restore is
// checked against the bytes on disk.
afterEach(async () => {
  await removeCheckpointFolders()
})

describe('CheckpointStore over a git repository (M72, M86)', () => {
  it(
    'restores modified, created, deleted, renamed and binary files the tools wrote, then redoes it',
    async () => {
      const h = await harness()
      await write(h.root, 'a.txt', 'one\r\n')
      await write(h.root, 'gone.txt', 'keep me\n')
      await write(h.root, 'old-name.txt', 'moving\n')
      await write(h.root, 'image.bin', new Uint8Array([0, 1, 2, 255, 13, 10]))
      runGit(h.root, ['add', '.'])
      runGit(h.root, ['commit', '-q', '-m', 'first'])
      await write(h.root, 'notes.txt', 'untracked before the turn\n')
      await turn(h, 't1', async (tool) => {
        await tool('a.txt', 'two\n')
        await tool('new/deep/file.ts', 'created\n')
        await tool('gone.txt', null)
        await tool('old-name.txt', null)
        await tool('new-name.txt', 'moving\n')
        await tool('image.bin', new Uint8Array([9, 9, 9]))
        await tool('notes.txt', 'the turn changed it\n')
      })
      const outcome = done(await restoreOutcome(h.store, 't1'))
      expect(outcome.refused).toEqual([])
      expect(await read(h.root, 'a.txt')).toBe('one\r\n')
      expect(await read(h.root, 'gone.txt')).toBe('keep me\n')
      expect(await read(h.root, 'old-name.txt')).toBe('moving\n')
      expect(await isPresent(h.root, 'new-name.txt')).toBe(false)
      expect(await isPresent(h.root, 'new/deep/file.ts')).toBe(false)
      expect(await isPresent(h.root, 'new')).toBe(false)
      expect([...(await readFile(path.join(h.root, 'image.bin')))]).toEqual([0, 1, 2, 255, 13, 10])
      expect(await read(h.root, 'notes.txt')).toBe('untracked before the turn\n')

      const redo = await redoRestore(h.store, outcome.restoreId)
      expect(redo.refused).toEqual([])
      expect(await read(h.root, 'a.txt')).toBe('two\n')
      expect(await read(h.root, 'new/deep/file.ts')).toBe('created\n')
      expect(await isPresent(h.root, 'gone.txt')).toBe(false)
      expect(await read(h.root, 'new-name.txt')).toBe('moving\n')
      expect([...(await readFile(path.join(h.root, 'image.bin')))]).toEqual([9, 9, 9])
      // The Redo is itself redoable: back to the restored state.
      const again = await redoRestore(h.store, redo.restoreId)
      expect(again.refused).toEqual([])
      expect(await read(h.root, 'a.txt')).toBe('one\r\n')
      // The first restore's Redo is spent: later units wrote every one of its paths.
      const spent = done(await redoOutcome(h.store, outcome.restoreId))
      expect(spent.changed).toEqual([])
      expect(new Set(spent.refused.map((refusal) => refusal.reason))).toEqual(
        new Set(['changedBetween']),
      )
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'writes nothing into the workspace repository: no object, ref, index or config change',
    async () => {
      // A host environment that names the workspace's own repository: none of
      // it may reach the shadow's git.
      const h = await harness({
        env: (top) => ({
          ...process.env,
          GIT_DIR: path.join(top, '.git'),
          GIT_WORK_TREE: top,
          GIT_INDEX_FILE: path.join(top, '.git', 'index'),
          GIT_OBJECT_DIRECTORY: path.join(top, '.git', 'objects'),
        }),
      })
      await write(h.root, '.gitignore', '.env\n')
      await write(h.root, 'a.txt', 'one\n')
      runGit(h.root, ['add', '.'])
      runGit(h.root, ['commit', '-q', '-m', 'first'])
      const dotGit = path.join(h.root, '.git')
      const listing = () => treeListing(dotGit)
      const before = {
        files: await listing(),
        refs: runGit(h.root, ['for-each-ref']),
        index: await readFile(path.join(dotGit, 'index')),
        objects: runGit(h.root, ['count-objects', '-v']),
      }
      await write(h.root, '.env', 'SECRET=1\n')
      await turn(h, 't1', async (tool) => {
        await tool('.env', 'SECRET=2\n')
        await tool('untracked.txt', 'new\n')
        await tool('a.txt', 'two\n')
      })
      done(await restoreOutcome(h.store, 't1'))
      expect(await listing()).toBe(before.files)
      expect(runGit(h.root, ['for-each-ref'])).toBe(before.refs)
      expect(await readFile(path.join(dotGit, 'index'))).toEqual(before.index)
      expect(runGit(h.root, ['count-objects', '-v'])).toBe(before.objects)
      expect(await read(h.root, '.env')).toBe('SECRET=1\n')
      // The copies live in the extension's storage only.
      expect(await isPresent(h.storage, 'shadow.git/HEAD')).toBe(true)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each([
    { failures: 1, isLogged: false },
    { failures: 2, isLogged: true },
  ])(
    'reports a completed restore when letting go of its lease fails $failures time(s), and restores again',
    async ({ failures, isLogged }) => {
      let remaining = failures
      const real = processGitProcess()
      const h = await harness({
        gitProcess: async (args, options) => {
          if (
            remaining > 0 &&
            args.includes('update-ref') &&
            args.includes('-d') &&
            args.some((arg) => arg.endsWith('restore-active'))
          ) {
            remaining -= 1
            throw new Error('Unable to create restore-active.lock')
          }
          return await real(args, options)
        },
      })
      await write(h.root, 'a.txt', 'one\n')
      await turn(h, 't1', (tool) => tool('a.txt', 'two\n'))
      done(await restoreOutcome(h.store, 't1'))
      expect(await read(h.root, 'a.txt')).toBe('one\n')
      expect(remaining).toBe(0)
      const wasWarned = h.log.warn.mock.calls.some(([line]) =>
        String(line).includes('restore lease could not be released'),
      )
      expect(wasWarned).toBe(isLogged)
      // A lease this window still holds is its own leftover: the next restore
      // (here the Redo) takes it over, and turns may start again after it.
      const restoreId = done(await restoreOutcome(h.store, 't1')).restoreId
      expect(restoreId).toBeUndefined()
      await turn(h, 't2', (tool) => tool('a.txt', 'three\n'))
      done(await restoreOutcome(h.store, 't2'))
      expect(await read(h.root, 'a.txt')).toBe('one\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'restores a file whose name begins with two dots',
    async () => {
      const h = await harness()
      await write(h.root, '..cache', 'one\n')
      await turn(h, 't1', (tool) => tool('..cache', 'two\n'))
      done(await restoreOutcome(h.store, 't1'))
      expect(await read(h.root, '..cache')).toBe('one\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    "keeps and restores bytes as they are, whatever the workspace's attributes, filters and config say",
    async () => {
      const h = await harness()
      await write(h.root, '.gitattributes', '* text=auto eol=lf\n*.txt filter=spy\n')
      // A filter that fails, and must run: were it ever used, no copy would be kept.
      runGit(h.root, ['config', 'filter.spy.clean', 'false'])
      runGit(h.root, ['config', 'filter.spy.smudge', 'false'])
      runGit(h.root, ['config', 'filter.spy.required', 'true'])
      runGit(h.root, ['config', 'core.autocrlf', 'true'])
      await write(h.root, 'crlf.txt', 'one\r\ntwo\r\n')
      await write(h.root, 'lf.txt', 'lf only\n')
      await turn(h, 't1', async (tool) => {
        await tool('crlf.txt', 'changed\n')
        await tool('lf.txt', 'changed\r\n')
      })
      done(await restoreOutcome(h.store, 't1'))
      expect(await read(h.root, 'crlf.txt')).toBe('one\r\ntwo\r\n')
      expect(await read(h.root, 'lf.txt')).toBe('lf only\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'works in a repository with no commits',
    async () => {
      const h = await harness()
      await write(h.root, 'draft.md', 'first draft\n')
      await turn(h, 't1', async (tool) => {
        await tool('draft.md', 'second draft\n')
        await tool('extra.md', 'extra\n')
      })
      done(await restoreOutcome(h.store, 't1'))
      expect(await read(h.root, 'draft.md')).toBe('first draft\n')
      expect(await isPresent(h.root, 'extra.md')).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses a file with unsaved editor changes and one changed after the turn, restoring the rest',
    async () => {
      const h = await harness()
      await write(h.root, 'open.ts', 'v1\n')
      await write(h.root, 'later.ts', 'v1\n')
      await write(h.root, 'plain.ts', 'v1\n')
      await turn(h, 't1', async (tool) => {
        await tool('open.ts', 'v2\n')
        await tool('later.ts', 'v2\n')
        await tool('plain.ts', 'v2\n')
      })
      await write(h.root, 'later.ts', 'the user edited it afterwards\n')
      const outcome = done(
        await h.store.restore({
          backend: () => 'modelApi',
          sessionId: 's1',
          turnId: 't1',
          transcriptTurnIds: ['t1'],
          unsavedPaths: () => [path.join(h.root, 'open.ts')],
        }),
      )
      expect(outcome.refused.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
        { path: 'later.ts', reason: 'changedAfter' },
        { path: 'open.ts', reason: 'unsaved' },
      ])
      expect(await read(h.root, 'open.ts')).toBe('v2\n')
      expect(await read(h.root, 'later.ts')).toBe('the user edited it afterwards\n')
      expect(await read(h.root, 'plain.ts')).toBe('v1\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'C: restores across several turns, but not through a change made between them',
    async () => {
      const h = await harness()
      await twoFileTurn(h)
      await write(h.root, 'b.txt', 'b-user\n')
      await turn(h, 't2', async (tool) => {
        await tool('a.txt', 'a2\n')
        await tool('b.txt', 'b2\n')
      })
      const outcome = done(await restoreOutcome(h.store, 't1'))
      expect(outcome.changed).toEqual(['a.txt'])
      expect(outcome.refused).toEqual([{ path: 'b.txt', reason: 'changedBetween' }])
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
      expect(await read(h.root, 'b.txt')).toBe('b2\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'restores a file the tools wrote whatever the ignore rules say, and never one only a command changed',
    async () => {
      const h = await harness()
      await write(h.root, '.gitignore', '.env\nbuild/\n')
      await write(h.root, '.env', 'original\n')
      await write(h.root, 'build/out.txt', 'old output\n')
      await turn(h, 't1', async (tool) => {
        await tool('.env', 'tool wrote\n')
        // What a shell command writes is never recorded.
        await write(h.root, 'build/out.txt', 'a command wrote\n')
        await write(h.root, 'build/new.txt', 'a command created\n')
      })
      const outcome = done(await restoreOutcome(h.store, 't1'))
      expect(outcome.changed).toEqual(['.env'])
      expect(await read(h.root, '.env')).toBe('original\n')
      expect(await read(h.root, 'build/out.txt')).toBe('a command wrote\n')
      expect(await read(h.root, 'build/new.txt')).toBe('a command created\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('CheckpointStore beyond a plain repository (M72, M86)', () => {
  it(
    'restores a folder that is not a repository',
    async () => {
      const h = await harness({ git: 'none' })
      await write(h.root, 'main.py', 'print(1)\n')
      await turn(h, 't1', async (tool) => {
        await tool('main.py', 'print(2)\n')
        await tool('helper.py', 'pass\n')
        await tool('out/result.txt', 'generated\n')
      })
      done(await restoreOutcome(h.store, 't1'))
      expect(await read(h.root, 'main.py')).toBe('print(1)\n')
      expect(await isPresent(h.root, 'helper.py')).toBe(false)
      expect(await isPresent(h.root, 'out')).toBe(false)
      expect(await isPresent(h.root, '.git')).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps to a workspace that is a folder of a larger repository',
    async () => {
      const h = await harness({ subfolder: 'packages/app' })
      await write(h.top, 'outside.txt', 'not the workspace\n')
      await write(h.root, 'index.ts', 'v1\n')
      await turn(h, 't1', async (tool) => {
        await tool('index.ts', 'v2\n')
        await write(h.top, 'outside.txt', 'changed outside\n')
      })
      done(await restoreOutcome(h.store, 't1'))
      expect(await read(h.root, 'index.ts')).toBe('v1\n')
      expect(await read(h.top, 'outside.txt')).toBe('changed outside\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'leaves a file now over the size limit as it is, too large to compare',
    async () => {
      const h = await harness()
      await write(h.root, 'small.txt', 'v1\n')
      await write(h.root, 'big.bin', 'v1\n')
      await turn(h, 't1', async (tool) => {
        await tool('small.txt', 'v2\n')
        await tool('big.bin', new Uint8Array(CHECKPOINT_FILE_MAX_BYTES + 1))
      })
      const outcome = done(await restoreOutcome(h.store, 't1'))
      expect(await read(h.root, 'small.txt')).toBe('v1\n')
      const big = await stat(path.join(h.root, 'big.bin'))
      expect(big.size).toBe(CHECKPOINT_FILE_MAX_BYTES + 1)
      expect(outcome.refused).toEqual([{ path: 'big.bin', reason: 'tooLarge' }])
      // Refused before the batch, unread: the batch journals no write of it.
      const batch = storedUnit(h.storage, outcome.restoreId ?? '')
      expect(batch.writes.map((entry) => entry.path)).toEqual(['small.txt'])
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('CheckpointStore lifecycle (M72, M86)', () => {
  it(
    'T: forgets a conversation: its units, its batches and their copies',
    async () => {
      const h = await harness()
      await write(h.root, 'a.txt', 'v1\n')
      await turn(h, 't1', (tool) => tool('a.txt', 'v2 with a unique line for this test\n'))
      await turn(h, 'other-turn', (tool) => tool('b.txt', 'another conversation\n'), 's2')
      done(await restoreOutcome(h.store, 't1'))
      expect(await h.store.turns('s1')).toEqual(['t1'])
      const objects = () => entryCount(path.join(h.storage, 'shadow.git', 'objects'))
      const before = await objects()
      // Prune may remove old unreachable objects, while recent objects
      // remain safe for another window still creating its refs.
      const objectRoot = path.join(h.storage, 'shadow.git', 'objects')
      const old = new Date(Date.now() - CHECKPOINT_PRUNE_GRACE_MS - 1000)
      const objectFiles = await readdir(objectRoot, { recursive: true })
      for (const name of objectFiles) {
        const file = path.join(objectRoot, name)
        const stats = await stat(file)
        if (stats.isFile()) {
          await utimes(file, old, old)
        }
      }
      await h.store.forgetSession('s1')
      expect(await h.store.turns('s1')).toEqual([])
      expect(await h.store.turns('s2')).toEqual(['other-turn'])
      expect(await objects()).toBeLessThan(before)
      expect(await restoreOutcome(h.store, 't1')).toEqual({
        ok: false,
        reason: 'noCheckpoint',
      })
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses to restore while a unit of the window is still running',
    async () => {
      const h = await harness()
      await mkdir(path.join(h.root, 'src'))
      await turn(h, 't1', (tool) => tool('src/a.txt', 'v1\n'))
      await h.store.startUnit(owner(h.store, 't2'))
      expect(await restoreOutcome(h.store, 't1')).toEqual({
        ok: false,
        reason: 'turnRunning',
      })
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
