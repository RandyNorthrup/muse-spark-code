import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BYTES_PER_MIB,
  CHECKPOINT_IGNORED_SCAN_MAX_FILES,
  CHECKPOINT_STALE_LOCK_MS,
  CHECKPOINT_STORAGE_MODE,
} from '../../src/shared/constants'
import { GitMissingError, type GitProcess, processGitProcess } from '../../src/host/git'
import {
  captured,
  harness,
  isPresent,
  namesIn,
  read,
  REAL_GIT_TIMEOUT_MS,
  redoRestore,
  removeCheckpointFolders,
  restoreTurn,
  shadowRefs,
  turn,
  write,
} from './helpers/checkpointHarness'

// The guards the review of 4ce27cb8 asked for (M72), over real git: links
// and junctions, deletions before writes, a restore that stops part way, a
// redo that cannot do everything, overlapping conversations, pinned
// captures, the cleanup that runs when a window opens.
afterEach(async () => {
  await removeCheckpointFolders()
})

const realGit = processGitProcess()
const WRITE_BATCH = 500
const SHA256_HEX_LENGTH = 64

/** The real git, failing the commands `shouldFail` names. */
function failingGit(shouldFail: (args: readonly string[]) => boolean): GitProcess {
  return async (args, options) => {
    if (shouldFail(args)) {
      throw new Error('the test failed this git command')
    }
    return await realGit(args, options)
  }
}

describe('CheckpointStore and links (M72)', () => {
  it(
    'leaves out a folder a turn linked in, and never restores through it',
    async () => {
      const h = await harness()
      await write(h.root, 'c/x.txt', 'the user’s file\n')
      await turn(h, 't1', async () => {
        await symlink(path.join(h.root, 'c'), path.join(h.root, 'a'), 'junction')
      })
      const outcome = await restoreTurn(h.store, 't1')
      expect(await read(h.root, 'c/x.txt')).toBe('the user’s file\n')
      expect(outcome.changed).toEqual([])
      expect(outcome.refused).toEqual([{ path: 'a', reason: 'notInCheckpoint' }])
      const after = await captured(h.store)
      expect(after.coverage.skipped).toEqual(['a'])
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('CheckpointStore order of steps (M72)', () => {
  it(
    'restores a case-only rename and a file swapped for a folder',
    async () => {
      const h = await harness()
      await write(h.root, 'Readme.md', 'readme\n')
      await write(h.root, 'x', 'a file\n')
      await turn(h, 't1', async () => {
        await rename(path.join(h.root, 'Readme.md'), path.join(h.root, 'README.md'))
        await rm(path.join(h.root, 'x'))
        await write(h.root, 'x/y.txt', 'now a folder\n')
      })
      const outcome = await restoreTurn(h.store, 't1')
      expect(outcome.refused).toEqual([])
      expect(await namesIn(h.root)).toContain('Readme.md')
      expect(await namesIn(h.root)).not.toContain('README.md')
      expect(await read(h.root, 'Readme.md')).toBe('readme\n')
      expect(await read(h.root, 'x')).toBe('a file\n')
      await redoRestore(h.store, outcome.restoreId)
      expect(await namesIn(h.root)).toContain('README.md')
      expect(await read(h.root, 'x/y.txt')).toBe('now a folder\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('CheckpointStore failures part way (M72)', () => {
  it(
    'says what a restore changed before it stopped, and keeps its Redo',
    async () => {
      let isFailing = false
      const h = await harness({
        gitProcess: failingGit((args) => isFailing && args.includes('check-ignore')),
      })
      await write(h.root, '.gitignore', 'old-rule\n')
      await write(h.root, 'a.txt', 'a0\n')
      await turn(h, 't1', async () => {
        await write(h.root, '.gitignore', 'new-rule\n')
        await write(h.root, 'a.txt', 'a1\n')
        await write(h.root, 'added.txt', 'new\n')
      })
      isFailing = true
      const outcome = await restoreTurn(h.store, 't1')
      isFailing = false
      expect(outcome.changed).toEqual(['.gitignore'])
      expect(outcome.refused.toSorted((x, y) => x.path.localeCompare(y.path))).toEqual([
        { path: 'a.txt', reason: 'failed' },
        { path: 'added.txt', reason: 'failed' },
      ])
      expect(outcome.restoreId).toBeDefined()
      expect(await read(h.root, '.gitignore')).toBe('old-rule\n')
      await redoRestore(h.store, outcome.restoreId)
      expect(await read(h.root, '.gitignore')).toBe('new-rule\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'names each added path to the ignore check as a path, never as pathspec magic',
    async () => {
      const inputs: string[] = []
      const h = await harness({
        gitProcess: async (args, options) => {
          if (args.includes('check-ignore') && typeof options.input === 'string') {
            inputs.push(...options.input.split('\0').filter((entry) => entry !== ''))
          }
          return await realGit(args, options)
        },
      })
      await turn(h, 't1', async () => {
        await write(h.root, 'added.txt', 'new\n')
      })
      await restoreTurn(h.store, 't1')
      expect(inputs).toEqual(['./added.txt'])
      expect(await isPresent(h.root, 'added.txt')).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps a redo’s undone part: a file changed since the restore stays, and can be redone later',
    async () => {
      const h = await harness()
      await write(h.root, 'redone.txt', 'a0\n')
      await write(h.root, 'user.txt', 'b0\n')
      await turn(h, 't1', async () => {
        await write(h.root, 'redone.txt', 'a1\n')
        await write(h.root, 'user.txt', 'b1\n')
      })
      const restored = await restoreTurn(h.store, 't1')
      await write(h.root, 'user.txt', 'the user again\n')
      const redo = await redoRestore(h.store, restored.restoreId)
      expect(redo.changed).toEqual(['redone.txt'])
      expect(redo.refused).toEqual([{ path: 'user.txt', reason: 'changedAfter' }])
      expect(redo.isRedoSpent).toBe(false)
      expect(await read(h.root, 'user.txt')).toBe('the user again\n')
      await write(h.root, 'user.txt', 'b0\n')
      const again = await redoRestore(h.store, restored.restoreId)
      expect(again.changed).toEqual(['user.txt'])
      expect(again.isRedoSpent).toBe(true)
      expect(await read(h.root, 'user.txt')).toBe('b1\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps the redo record on disk before the first file changes',
    async () => {
      let storage = ''
      const restoresOnDisk: number[] = []
      const h = await harness({
        gitProcess: async (args, options) => {
          if (args.includes('check-ignore')) {
            const text = await readFile(path.join(storage, 'records.json'), 'utf8')
            const records = JSON.parse(text) as { readonly restores: readonly unknown[] }
            restoresOnDisk.push(records.restores.length)
          }
          return await realGit(args, options)
        },
      })
      storage = h.storage
      await write(h.root, 'kept.txt', 'k0\n')
      await turn(h, 't1', async () => {
        await write(h.root, 'kept.txt', 'k1\n')
        await write(h.root, 'added.txt', 'new\n')
      })
      await restoreTurn(h.store, 't1')
      // The ignore check runs before any file but a .gitignore changes.
      expect(restoresOnDisk.at(-1)).toBe(1)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'says a restore is incomplete when the ignored-file scan reached its limit',
    async () => {
      const h = await harness()
      await write(h.root, '.gitignore', '*.log\n')
      const names = Array.from(
        { length: CHECKPOINT_IGNORED_SCAN_MAX_FILES + 1 },
        (_, index) => `f${String(index)}.log`,
      )
      for (let start = 0; start < names.length; start += WRITE_BATCH) {
        await Promise.all(
          names
            .slice(start, start + WRITE_BATCH)
            .map((name) => writeFile(path.join(h.root, name), '')),
        )
      }
      await turn(h, 't1', async () => {
        await write(h.root, 'a.txt', 'a1\n')
      })
      const outcome = await restoreTurn(h.store, 't1')
      expect(outcome.isIgnoredIncomplete).toBe(true)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses a checkpoint repository that does not name objects as a restore checks them',
    async () => {
      const h = await harness({
        gitProcess: async (args, options) =>
          args.includes('hash-object') && options.input === ''
            ? Buffer.from(`${'0'.repeat(SHA256_HEX_LENGTH)}\n`)
            : await realGit(args, options),
      })
      const capture = await h.store.capture()
      expect(capture.ok ? '' : capture.detail).toContain('SHA-1')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'says git is missing rather than that a checkpoint failed',
    async () => {
      const h = await harness({
        gitProcess: () => Promise.reject(new GitMissingError()),
      })
      const capture = await h.store.capture()
      expect(capture.ok || capture.reason).toBe('noGit')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('CheckpointStore across conversations and windows (M72)', () => {
  it(
    'refuses what another conversation’s turn changed while this one ran',
    async () => {
      const h = await harness()
      await write(h.root, 'a.txt', 'a0\n')
      await write(h.root, 'b.txt', 'b0\n')
      await h.store.record('s1', 't1', await captured(h.store))
      await h.store.record('s2', 'u1', await captured(h.store))
      await write(h.root, 'b.txt', 'written by the other conversation\n')
      await h.store.endTurn('s2', 'u1')
      await write(h.root, 'a.txt', 'a1\n')
      await h.store.endTurn('s1', 't1')
      const outcome = await restoreTurn(h.store, 't1')
      expect(outcome.changed).toEqual(['a.txt'])
      expect(outcome.refused).toEqual([{ path: 'b.txt', reason: 'changedAfter' }])
      expect(await read(h.root, 'b.txt')).toBe('written by the other conversation\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses to restore while any turn of the window runs, recorded or not',
    async () => {
      const h = await harness()
      await turn(h, 't1', async () => {
        await write(h.root, 'a.txt', 'a1\n')
      })
      h.store.markTurn('s2', 'other', true)
      expect(
        await h.store.restore({ sessionId: 's1', turnId: 't1', unsavedPaths: () => [] }),
      ).toEqual({ ok: false, reason: 'turnRunning' })
      h.store.markTurn('s2', 'other', false)
      await restoreTurn(h.store, 't1')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps a capture waiting for its turn through a prune',
    async () => {
      const h = await harness()
      await write(h.root, 'a.txt', 'unique to the first capture\n')
      const waiting = await captured(h.store)
      await write(h.root, 'a.txt', 'moved on\n')
      await turn(
        h,
        'other',
        async () => {
          await write(h.root, 'b.txt', 'x\n')
        },
        's2',
      )
      await captured(h.store)
      await h.store.forgetSession('s2')
      await h.store.record('s1', 't1', waiting)
      await h.store.endTurn('s1', 't1')
      await restoreTurn(h.store, 't1')
      expect(await read(h.root, 'a.txt')).toBe('unique to the first capture\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'records no capture taken before its conversation was archived',
    async () => {
      const h = await harness()
      const early = await captured(h.store)
      await h.store.forgetSession('s1')
      await h.store.record('s1', 't1', early)
      expect(await h.store.turns('s1')).toEqual([])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'when a window opens, forgets the conversations archived while it was untrusted',
    async () => {
      const h = await harness()
      await turn(h, 't1', async () => {
        await write(h.root, 'a.txt', 'a1\n')
      })
      await turn(
        h,
        'u1',
        async () => {
          await write(h.root, 'b.txt', 'b1\n')
        },
        's2',
      )
      // Restricted Mode: no git runs, the archive is queued.
      await h.store.queueForget('s2')
      const reopened = h.reopen()
      await reopened.maintain()
      expect(await reopened.turns('s2')).toEqual([])
      expect(await reopened.turns('s1')).toEqual(['t1'])
      expect(shadowRefs(h.storage).filter((ref) => ref.includes('/keep/'))).toHaveLength(1)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'when a window opens, drops the refs no record names, and every tool copy and pin',
    async () => {
      const h = await harness()
      await turn(h, 't1', async () => {
        await write(h.root, 'a.txt', 'a1\n')
      })
      await captured(h.store)
      await h.store.record('s1', 't2', await captured(h.store))
      await h.store.beforeToolWrite(path.join(h.root, 'a.txt'))
      expect(shadowRefs(h.storage).some((ref) => ref.includes('/pin/'))).toBe(true)
      expect(shadowRefs(h.storage).some((ref) => ref.includes('/journal/'))).toBe(true)
      // The records are lost (a window closed between a ref and its record, say).
      await unlink(path.join(h.storage, 'records.json'))
      await h.reopen().maintain()
      expect(shadowRefs(h.storage).filter((ref) => !ref.endsWith('/index'))).toEqual([])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'clears a lock a git ended mid-command left, once it is older than any git may run',
    async () => {
      const h = await harness({ now: () => Date.now() })
      await captured(h.store)
      const refs = path.join(h.storage, 'shadow.git', 'refs', 'muse-spark')
      await writeFile(path.join(refs, 'index.lock'), '')
      await mkdir(path.join(refs, 'keep'), { recursive: true })
      await writeFile(path.join(refs, 'keep', 'fresh.lock'), '')
      const past = new Date(Date.now() - CHECKPOINT_STALE_LOCK_MS - 1000)
      await utimes(path.join(refs, 'index.lock'), past, past)
      // The stale lock on the ref every capture moves would fail them all.
      await captured(h.reopen())
      expect(await isPresent(refs, 'index.lock')).toBe(false)
      expect(await isPresent(refs, 'keep/fresh.lock')).toBe(true)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'names the restored files a turn with no recorded end may not have changed itself',
    async () => {
      const h = await harness()
      await write(h.root, 'a.txt', 'a0\n')
      await h.store.record('s1', 't1', await captured(h.store))
      await write(h.root, 'a.txt', 'a1\n')
      // The window closed before the turn's end was recorded.
      const outcome = await restoreTurn(h.reopen(), 't1')
      expect(outcome.changed).toEqual(['a.txt'])
      expect(outcome.unsure).toEqual(['a.txt'])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'restores more than one git read may carry, in batches',
    async () => {
      const h = await harness()
      const size = 14 * BYTES_PER_MIB
      const names = ['big1.bin', 'big2.bin', 'big3.bin', 'big4.bin', 'big5.bin']
      for (const [index, name] of names.entries()) {
        await write(h.root, name, Buffer.alloc(size, index + 1))
      }
      await turn(h, 't1', async () => {
        for (const name of names) {
          await write(h.root, name, 'small\n')
        }
      })
      const outcome = await restoreTurn(h.store, 't1')
      expect(outcome.changed.toSorted((a, b) => a.localeCompare(b))).toEqual(names)
      for (const [index, name] of names.entries()) {
        const bytes = await readFile(path.join(h.root, name))
        expect(bytes.equals(Buffer.alloc(size, index + 1))).toBe(true)
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.skipIf(process.platform === 'win32')(
    'deletes an added file whose name reads as pathspec magic',
    async () => {
      const h = await harness()
      await turn(h, 't1', async () => {
        await write(h.root, ':!x.txt', 'new\n')
      })
      const outcome = await restoreTurn(h.store, 't1')
      expect(outcome.changed).toEqual([':!x.txt'])
      expect(await isPresent(h.root, ':!x.txt')).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.skipIf(process.platform === 'win32')(
    'keeps the checkpoint folder the user’s alone',
    async () => {
      const h = await harness()
      await mkdir(h.storage, { mode: 0o755 })
      await chmod(h.storage, 0o755)
      await captured(h.store)
      const folder = await stat(h.storage)
      expect(folder.mode & 0o777).toBe(CHECKPOINT_STORAGE_MODE)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
