import { mkdir, readFile, readdir, rm, stat, utimes } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CHECKPOINT_FILE_MAX_BYTES, CHECKPOINT_PRUNE_GRACE_MS } from '../../src/shared/constants'
import {
  captured,
  restoreOutcome,
  done,
  entryCount,
  harness,
  isPresent,
  read,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  runGit,
  treeListing,
  turn,
  write,
} from './helpers/checkpointHarness'

// Real git over throwaway folders (M72): each test makes its own workspace
// and storage folder, so nothing is shared and every restore is checked
// against the bytes on disk.
afterEach(async () => {
  await removeCheckpointFolders()
})

describe('CheckpointStore over a git repository (M72)', () => {
  it(
    'restores modified, untracked, deleted, renamed and binary files, then redoes it',
    async () => {
      const h = await harness()
      await write(h.root, 'a.txt', 'one\r\n')
      await write(h.root, 'gone.txt', 'keep me\n')
      await write(h.root, 'old-name.txt', 'moving\n')
      await write(h.root, 'image.bin', new Uint8Array([0, 1, 2, 255, 13, 10]))
      runGit(h.root, ['add', '.'])
      runGit(h.root, ['commit', '-q', '-m', 'first'])
      await write(h.root, 'notes.txt', 'untracked before the turn\n')
      await turn(h, 't1', async () => {
        await write(h.root, 'a.txt', 'two\n')
        await write(h.root, 'new/deep/file.ts', 'created\n')
        await rm(path.join(h.root, 'gone.txt'))
        await rm(path.join(h.root, 'old-name.txt'))
        await write(h.root, 'new-name.txt', 'moving\n')
        await write(h.root, 'image.bin', new Uint8Array([9, 9, 9]))
        await write(h.root, 'notes.txt', 'the turn changed it\n')
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

      const redo = done(
        await h.store.redo({
          backend: () => 'modelApi',
          restoreId: outcome.restoreId ?? '',
          unsavedPaths: () => [],
        }),
      )
      expect(redo.refused).toEqual([])
      expect(await read(h.root, 'a.txt')).toBe('two\n')
      expect(await read(h.root, 'new/deep/file.ts')).toBe('created\n')
      expect(await isPresent(h.root, 'gone.txt')).toBe(false)
      expect(await read(h.root, 'new-name.txt')).toBe('moving\n')
      expect([...(await readFile(path.join(h.root, 'image.bin')))]).toEqual([9, 9, 9])
      // The redo is itself redoable: back to the restored state.
      const again = done(
        await h.store.redo({
          backend: () => 'modelApi',
          restoreId: redo.restoreId ?? '',
          unsavedPaths: () => [],
        }),
      )
      expect(again.refused).toEqual([])
      expect(await read(h.root, 'a.txt')).toBe('one\r\n')
      // A spent redo is gone.
      const spent = await h.store.redo({
        backend: () => 'modelApi',
        restoreId: outcome.restoreId ?? '',
        unsavedPaths: () => [],
      })
      expect(spent).toEqual({ ok: false, reason: 'redoGone' })
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
      await turn(h, 't1', async () => {
        await h.store.beforeToolWrite(path.join(h.root, '.env'))
        await write(h.root, '.env', 'SECRET=2\n')
        await write(h.root, 'untracked.txt', 'new\n')
        await write(h.root, 'a.txt', 'two\n')
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

  it(
    "copies bytes as they are, whatever the workspace's attributes, filters and config say",
    async () => {
      const h = await harness()
      await write(h.root, '.gitattributes', '* text=auto eol=lf\n*.txt filter=spy\n')
      // A filter that fails, and must run: were it ever used, no capture would work.
      runGit(h.root, ['config', 'filter.spy.clean', 'false'])
      runGit(h.root, ['config', 'filter.spy.smudge', 'false'])
      runGit(h.root, ['config', 'filter.spy.required', 'true'])
      runGit(h.root, ['config', 'core.autocrlf', 'true'])
      await write(h.root, 'crlf.txt', 'one\r\ntwo\r\n')
      await write(h.root, 'lf.txt', 'lf only\n')
      await turn(h, 't1', async () => {
        await write(h.root, 'crlf.txt', 'changed\n')
        await write(h.root, 'lf.txt', 'changed\r\n')
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
      await turn(h, 't1', async () => {
        await write(h.root, 'draft.md', 'second draft\n')
        await write(h.root, 'extra.md', 'extra\n')
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
      await turn(h, 't1', async () => {
        await write(h.root, 'open.ts', 'v2\n')
        await write(h.root, 'later.ts', 'v2\n')
        await write(h.root, 'plain.ts', 'v2\n')
      })
      await write(h.root, 'later.ts', 'the user edited it afterwards\n')
      const outcome = done(
        await h.store.restore({
          backend: () => 'modelApi',
          sessionId: 's1',
          turnId: 't1',
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
    'restores across several turns, but not a change made between them',
    async () => {
      const h = await harness()
      await write(h.root, 'a.txt', 'a0\n')
      await write(h.root, 'b.txt', 'b0\n')
      await turn(h, 't1', async () => {
        await write(h.root, 'a.txt', 'a1\n')
      })
      await write(h.root, 'b.txt', 'b-user\n')
      await turn(h, 't2', async () => {
        await write(h.root, 'a.txt', 'a2\n')
      })
      const outcome = done(await restoreOutcome(h.store, 't1'))
      expect(outcome.refused).toEqual([{ path: 'b.txt', reason: 'changedAfter' }])
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
      expect(await read(h.root, 'b.txt')).toBe('b-user\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('CheckpointStore and ignored files (M72)', () => {
  it(
    'puts back an ignored file a tool wrote, deletes one a command created, lists one a command changed',
    async () => {
      const h = await harness()
      await write(h.root, '.gitignore', '.env\n*.log\nbuild/\n')
      await write(h.root, '.env', 'KEY=before\n')
      await write(h.root, 'server.log', 'old log\n')
      await write(h.root, 'build/out.js', 'old build\n')
      await turn(h, 't1', async () => {
        // The Model API's write_file: copied first.
        await h.store.beforeToolWrite(path.join(h.root, '.env'))
        await write(h.root, '.env', 'KEY=after\n')
        // A shell command: seen only afterwards.
        await write(h.root, 'build/new-chunk.js', 'made by the build\n')
        await write(h.root, 'server.log', 'old log\nappended by the command\n')
      })
      const outcome = done(await restoreOutcome(h.store, 't1'))
      expect(await read(h.root, '.env')).toBe('KEY=before\n')
      expect(await isPresent(h.root, 'build/new-chunk.js')).toBe(false)
      expect(await read(h.root, 'build/out.js')).toBe('old build\n')
      expect(await read(h.root, 'server.log')).toBe('old log\nappended by the command\n')
      expect(outcome.refused).toEqual([{ path: 'server.log', reason: 'noEarlierCopy' }])
      // Redo brings the turn's ignored changes back too.
      done(
        await h.store.redo({
          backend: () => 'modelApi',
          restoreId: outcome.restoreId ?? '',
          unsavedPaths: () => [],
        }),
      )
      expect(await read(h.root, '.env')).toBe('KEY=after\n')
      expect(await read(h.root, 'build/new-chunk.js')).toBe('made by the build\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'leaves unrelated ignored content alone, and a big ignored folder out of the scan',
    async () => {
      const h = await harness()
      await write(h.root, '.gitignore', 'node_modules/\ncache/\n')
      for (let index = 0; index < 1100; index += 1) {
        await write(h.root, `node_modules/pkg/f${String(index)}.js`, 'x')
      }
      await write(h.root, 'cache/user.txt', 'the user owns this\n')
      await turn(h, 't1', async () => {
        await write(h.root, 'node_modules/pkg/added-by-install.js', 'x')
        await write(h.root, 'src.ts', 'code\n')
      })
      await write(h.root, 'cache/user.txt', 'changed by the user after the turn\n')
      done(await restoreOutcome(h.store, 't1'))
      expect(await isPresent(h.root, 'src.ts')).toBe(false)
      expect(await isPresent(h.root, 'node_modules/pkg/added-by-install.js')).toBe(true)
      expect(await read(h.root, 'cache/user.txt')).toBe('changed by the user after the turn\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('CheckpointStore beyond a plain repository (M72)', () => {
  it(
    'checkpoints a folder that is not a repository',
    async () => {
      const h = await harness({ git: 'none' })
      await write(h.root, '.gitignore', 'out/\n')
      await write(h.root, 'main.py', 'print(1)\n')
      await turn(h, 't1', async () => {
        await write(h.root, 'main.py', 'print(2)\n')
        await write(h.root, 'helper.py', 'pass\n')
        await write(h.root, 'out/result.txt', 'generated\n')
      })
      done(await restoreOutcome(h.store, 't1'))
      expect(await read(h.root, 'main.py')).toBe('print(1)\n')
      expect(await isPresent(h.root, 'helper.py')).toBe(false)
      expect(await isPresent(h.root, 'out/result.txt')).toBe(false)
      expect(await isPresent(h.root, '.git')).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps to a workspace that is a folder of a larger repository, under its ignore rules',
    async () => {
      const h = await harness({ subfolder: 'packages/app' })
      await write(h.top, '.gitignore', 'node_modules/\n')
      await write(h.top, 'outside.txt', 'not the workspace\n')
      await write(h.root, 'index.ts', 'v1\n')
      await turn(h, 't1', async () => {
        await write(h.root, 'index.ts', 'v2\n')
        await write(h.root, 'node_modules/dep/x.js', 'ignored by the top .gitignore\n')
        await write(h.top, 'outside.txt', 'changed outside\n')
      })
      done(await restoreOutcome(h.store, 't1'))
      expect(await read(h.root, 'index.ts')).toBe('v1\n')
      expect(await read(h.top, 'outside.txt')).toBe('changed outside\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'names and leaves alone a file over the size limit and a nested repository',
    async () => {
      const h = await harness()
      await write(h.root, 'small.txt', 'v1\n')
      await mkdir(path.join(h.root, 'vendor'))
      runGit(path.join(h.root, 'vendor'), ['init', '-q'])
      await write(h.root, 'vendor/lib.c', 'int x;\n')
      await h.store.record('s1', 't1', await captured(h.store))
      await write(h.root, 'small.txt', 'v2\n')
      await write(h.root, 'huge.bin', new Uint8Array(CHECKPOINT_FILE_MAX_BYTES + 1))
      await write(h.root, 'vendor/lib.c', 'int y;\n')
      await h.store.endTurn('s1', 't1')
      const after = await h.store.capture()
      expect(after.ok && after.snapshot.coverage).toEqual({
        skipped: ['huge.bin'],
        repositories: ['vendor'],
      })
      const outcome = done(await restoreOutcome(h.store, 't1'))
      expect(await read(h.root, 'small.txt')).toBe('v1\n')
      expect(await isPresent(h.root, 'huge.bin')).toBe(true)
      expect(await read(h.root, 'vendor/lib.c')).toBe('int y;\n')
      expect(outcome.refused).toEqual([{ path: 'huge.bin', reason: 'notInCheckpoint' }])
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('CheckpointStore lifecycle (M72)', () => {
  it(
    'forgets a conversation: its turns, its redo records and its copies',
    async () => {
      const h = await harness()
      await write(h.root, 'a.txt', 'v1\n')
      await turn(h, 't1', async () => {
        await write(h.root, 'a.txt', 'v2 with a unique line for this test\n')
      })
      await turn(
        h,
        'other-turn',
        async () => {
          await write(h.root, 'b.txt', 'another conversation\n')
        },
        's2',
      )
      expect(await h.store.turns('s1')).toEqual(['t1'])
      const objects = () => entryCount(path.join(h.storage, 'shadow.git', 'objects'))
      await write(h.root, 'a.txt', 'v3\n')
      await write(h.root, 'b.txt', 'gone\n')
      await rm(path.join(h.root, 'b.txt'))
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
    'refuses to restore while a turn from the checkpoint on is still running',
    async () => {
      const h = await harness()
      await write(h.root, 'a.txt', 'v1\n')
      await h.store.record('s1', 't1', await captured(h.store))
      expect(await restoreOutcome(h.store, 't1')).toEqual({
        ok: false,
        reason: 'turnRunning',
      })
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
