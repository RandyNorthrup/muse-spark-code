import { mkdir, readFile, readdir, rm, stat, utimes } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { processGitProcess } from '../../src/host/git'
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
  shadowGit,
  storedRecords,
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

/** The files a captured tree holds, as the shadow repository lists them. */
function filesIn(storage: string, tree: string): readonly string[] {
  return shadowGit(storage, ['ls-tree', '-r', '--name-only', '-z', tree])
    .split('\0')
    .filter((name) => name !== '')
}

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
      await turn(h, 't1', async () => {
        await write(h.root, 'a.txt', 'two\n')
      })
      done(await restoreOutcome(h.store, 't1'))
      expect(await read(h.root, 'a.txt')).toBe('one\n')
      expect(remaining).toBe(0)
      const wasWarned = h.log.warn.mock.calls.some(([line]) =>
        String(line).includes('restore lease could not be released'),
      )
      expect(wasWarned).toBe(isLogged)
      // A lease this window still holds is its own leftover: the next restore takes it over.
      await turn(h, 't2', async () => {
        await write(h.root, 'a.txt', 'three\n')
      })
      done(await restoreOutcome(h.store, 't2'))
      expect(await read(h.root, 'a.txt')).toBe('one\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'copies an ignored file whose name begins with two dots, and restores it',
    async () => {
      const h = await harness()
      await write(h.root, '.gitignore', '..cache\n')
      await write(h.root, '..cache', 'one\n')
      await turn(h, 't1', async () => {
        await h.store.beforeToolWrite(path.join(h.root, '..cache'))
        await write(h.root, '..cache', 'two\n')
      })
      done(await restoreOutcome(h.store, 't1'))
      expect(await read(h.root, '..cache')).toBe('one\n')
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

  it(
    "applies the repository's info/exclude as it is at each capture, not as it was at the first",
    async () => {
      const h = await harness()
      await write(h.root, 'a.txt', 'one\n')
      await write(h.root, 'secret.log', 'ordinary until excluded\n')
      const start = await captured(h.store)
      expect(filesIn(h.storage, start.tree)).toEqual(['a.txt', 'secret.log'])
      await h.store.record('s1', 't1', start)
      // Excluded mid-turn: the turn's end capture already treats it as ignored.
      await write(h.top, '.git/info/exclude', 'secret.log\n')
      await h.store.endTurn('s1', 't1')
      const ends = storedRecords(h.storage).flatMap((record) =>
        record.kind === 'checkpoint' && record.end !== undefined ? [record.end.tree] : [],
      )
      expect(ends.map((tree) => filesIn(h.storage, tree))).toEqual([['a.txt']])
      const excluded = await captured(h.store)
      expect(filesIn(h.storage, excluded.tree)).toEqual(['a.txt'])
      expect(excluded.inventory.files.size).toBe(1)
      expect(excluded.inventory.files.has('secret.log')).toBe(true)
      // The exclude file gone: the file is ordinary again.
      await rm(path.join(h.top, '.git', 'info', 'exclude'))
      const ordinary = await captured(h.store)
      expect(filesIn(h.storage, ordinary.tree)).toEqual(['a.txt', 'secret.log'])
      expect(ordinary.inventory.files.size).toBe(0)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'applies the global excludes file the user configuration names at each capture',
    async () => {
      // A home of the test's own: `git config --global` reads its .gitconfig, never the user's.
      const homeOf = (top: string) => path.join(path.dirname(top), 'home')
      const h = await harness({
        env: (top) => ({
          ...process.env,
          HOME: homeOf(top),
          USERPROFILE: homeOf(top),
          XDG_CONFIG_HOME: path.join(homeOf(top), '.config'),
        }),
      })
      const home = homeOf(h.top)
      const userConfig = path.join(home, '.gitconfig')
      const capturedFiles = async () => {
        const snapshot = await captured(h.store)
        return filesIn(h.storage, snapshot.tree)
      }
      await write(h.root, 'a.txt', 'one\n')
      await write(h.root, 'notes.tmp', 'scratch\n')
      await write(home, 'global-ignore', '*.tmp\n')
      expect(await capturedFiles()).toEqual(['a.txt', 'notes.tmp'])
      // Named after the first capture.
      runGit(h.top, [
        'config',
        '--file',
        userConfig,
        'core.excludesFile',
        path.join(home, 'global-ignore'),
      ])
      expect(await capturedFiles()).toEqual(['a.txt'])
      // Its content as it is now.
      await write(home, 'global-ignore', 'a.txt\n')
      expect(await capturedFiles()).toEqual(['notes.tmp'])
      // The setting dropped: no global rule applies any more.
      runGit(h.top, ['config', '--file', userConfig, '--unset', 'core.excludesFile'])
      expect(await capturedFiles()).toEqual(['a.txt', 'notes.tmp'])
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

  it.each([
    { gitEntry: 'folder', isGitDirElsewhere: false },
    { gitEntry: 'file', isGitDirElsewhere: true },
  ])(
    'leaves out whole a repository an ignore rule hides, its .git a $gitEntry, and restores no tool write in any repository',
    async ({ isGitDirElsewhere }) => {
      const h = await harness()
      const repositoryAt = async (relative: string) => {
        const folder = path.join(h.root, relative)
        await mkdir(folder, { recursive: true })
        if (!isGitDirElsewhere) {
          runGit(folder, ['init', '-q'])
          return
        }
        // A `.git` file names a repository kept elsewhere, as a worktree's or a submodule's does.
        const gitDir = path.join(path.dirname(h.root), 'git-dirs', relative)
        await mkdir(gitDir, { recursive: true })
        runGit(folder, ['init', '-q', '--separate-git-dir', gitDir])
      }
      await write(h.root, '.gitignore', 'vendor/\ndeps/\n')
      // An ignored folder that is a repository, one inside an ignored folder, and an untracked one.
      const repositories = ['vendor', 'deps/pkg', 'tools']
      for (const relative of repositories) {
        await repositoryAt(relative)
        await write(h.root, `${relative}/lib.c`, 'int x;\n')
      }
      await write(h.root, 'deps/plain.js', 'plain v1\n')
      await turn(h, 't1', async () => {
        for (const relative of [
          ...repositories.map((folder) => `${folder}/lib.c`),
          'deps/plain.js',
        ]) {
          await h.store.beforeToolWrite(path.join(h.root, relative))
          await write(h.root, relative, 'written by a tool\n')
        }
        await write(h.root, 'deps/pkg/by-command.c', 'a shell command\n')
      })
      const after = await captured(h.store)
      expect(after.coverage).toEqual({ skipped: [], repositories: ['deps/pkg', 'tools', 'vendor'] })
      expect([...after.inventory.files].map(([relative]) => relative)).toEqual(['deps/plain.js'])
      const outcome = done(await restoreOutcome(h.store, 't1'))
      expect(await read(h.root, 'deps/plain.js')).toBe('plain v1\n')
      for (const relative of repositories) {
        expect(await read(h.root, `${relative}/lib.c`)).toBe('written by a tool\n')
      }
      expect(await read(h.root, 'deps/pkg/by-command.c')).toBe('a shell command\n')
      expect(outcome.refused).toEqual([
        { path: 'deps/pkg/lib.c', reason: 'notInCheckpoint' },
        { path: 'tools/lib.c', reason: 'notInCheckpoint' },
        { path: 'vendor/lib.c', reason: 'notInCheckpoint' },
      ])
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
