import { chmod, mkdir, readFile, stat, symlink, utimes, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as atomic from '../../src/host/fsAtomic'
import {
  BYTES_PER_MIB,
  CHECKPOINT_STALE_LOCK_MS,
  CHECKPOINT_STORAGE_MODE,
} from '../../src/shared/constants'
import { processGitProcess } from '../../src/host/git'
import { turnKey } from '../../src/host/checkpoints/checkpointStore'
import {
  restoreOutcome,
  harness,
  isPresent,
  namesIn,
  owner,
  read,
  REAL_GIT_TIMEOUT_MS,
  redoRestore,
  removeCheckpointFolders,
  restoreTurn,
  shadowGit,
  shadowRefs,
  storedUnits,
  toolWrite,
  turn,
  twoConversations,
  twoFileTurn,
  write,
} from './helpers/checkpointHarness'

// The guards over real git (M72, M86): links and junctions, deletions before
// writes, a restore that stops part way, a Redo that cannot do everything,
// overlapping conversations, the cleanup that runs when a window opens.
afterEach(async () => {
  await removeCheckpointFolders()
})
vi.mock('../../src/host/fsAtomic', async (importOriginal) => ({
  ...(await importOriginal<typeof atomic>()),
}))

const realGit = processGitProcess()
const GONE_PID = 424_242
const SHA256_HEX_LENGTH = 64
// How long the first `git init` waits for a second setup to reach its own:
// one gets there in milliseconds when the setup is not shared.
const SECOND_SETUP_WAIT_MS = 1000
const CASE_FOLDING = new Set<NodeJS.Platform>(['win32', 'darwin'])

describe('CheckpointStore and links (M72, M86)', () => {
  it(
    'leaves a file the tools wrote alone once a junction leads to it, and never writes through it',
    async () => {
      const h = await harness()
      await write(h.root, 'c/x.txt', 'the user’s file\n')
      await turn(h, 't1', (tool) => tool('a/x.txt', 'written by the tool\n'))
      // The user swaps the tool's folder for a junction to their own.
      await rename(path.join(h.root, 'a'), path.join(h.root, 'old-a'))
      await symlink(path.join(h.root, 'c'), path.join(h.root, 'a'), 'junction')
      const outcome = await restoreTurn(h.store, 't1')
      expect(await read(h.root, 'c/x.txt')).toBe('the user’s file\n')
      expect(outcome.changed).toEqual([])
      expect(outcome.refused).toEqual([{ path: 'a/x.txt', reason: 'linked' }])
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('CheckpointStore order of steps (M72, M86)', () => {
  it(
    'puts back a file the tools swapped for a folder, deleting before writing, and redoes it',
    async () => {
      const h = await harness()
      await write(h.root, 'x', 'a file\n')
      await turn(h, 't1', async (tool) => {
        await tool('x', null)
        await tool('x/y.txt', 'now a folder\n')
      })
      const outcome = await restoreTurn(h.store, 't1')
      expect(outcome.refused).toEqual([])
      expect(await read(h.root, 'x')).toBe('a file\n')
      await redoRestore(h.store, outcome.restoreId)
      expect(await read(h.root, 'x/y.txt')).toBe('now a folder\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'merges two spellings that now name one file, as the volume compares names',
    async () => {
      const h = await harness()
      await write(h.root, 'Readme.md', 'readme\n')
      await turn(h, 't1', async (tool) => {
        await tool('Readme.md', null)
        await tool('README.md', 'readme\n')
      })
      const outcome = await restoreTurn(h.store, 't1')
      expect(outcome.refused).toEqual([])
      if (CASE_FOLDING.has(process.platform)) {
        // One file, its bytes as they were: nothing to do, whatever its name's case.
        expect(outcome.unchanged).toEqual(['README.md'])
        expect(await read(h.root, 'README.md')).toBe('readme\n')
      } else {
        // Two files on a volume that tells case apart: each goes back.
        expect(new Set(outcome.changed)).toEqual(new Set(['README.md', 'Readme.md']))
        expect(await namesIn(h.root)).toContain('Readme.md')
        expect(await namesIn(h.root)).not.toContain('README.md')
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('CheckpointStore failures part way (M72, M86)', () => {
  it(
    'says what a restore changed when a file could not be written, and keeps its Redo',
    async () => {
      const h = await harness()
      await twoFileTurn(h)
      const original = atomic.writeFileIfUnchanged
      const spy = vi
        .spyOn(atomic, 'writeFileIfUnchanged')
        .mockImplementation(async (file, expected, content, options) => {
          if (file === path.join(h.root, 'b.txt')) {
            throw new Error('injected write failure')
          }
          return await original(file, expected, content, options)
        })
      let outcome: Awaited<ReturnType<typeof restoreTurn>>
      try {
        outcome = await restoreTurn(h.store, 't1')
      } finally {
        spy.mockRestore()
      }
      expect(outcome.changed).toEqual(['a.txt'])
      expect(outcome.refused).toEqual([{ path: 'b.txt', reason: 'failed' }])
      expect(outcome.restoreId).toBeDefined()
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
      expect(await read(h.root, 'b.txt')).toBe('b1\n')
      const redo = await redoRestore(h.store, outcome.restoreId)
      expect(redo.changed).toEqual(['a.txt'])
      expect(await read(h.root, 'a.txt')).toBe('a1\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps a Redo’s undone part: a file changed since the restore stays, and can be redone later',
    async () => {
      const h = await harness()
      await write(h.root, 'redone.txt', 'a0\n')
      await write(h.root, 'user.txt', 'b0\n')
      await turn(h, 't1', async (tool) => {
        await tool('redone.txt', 'a1\n')
        await tool('user.txt', 'b1\n')
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
      expect(again.unchanged).toEqual(['redone.txt'])
      expect(again.isRedoSpent).toBe(true)
      expect(await read(h.root, 'user.txt')).toBe('b1\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.skipIf(process.platform === 'win32')(
    'redoes a file whose execute bit the user changed since the restore, and keeps their mode',
    async () => {
      const h = await harness()
      await write(h.root, 'run.sh', 'echo one\n')
      await turn(h, 't1', (tool) => tool('run.sh', 'echo two\n'))
      const restored = await restoreTurn(h.store, 't1')
      await chmod(path.join(h.root, 'run.sh'), 0o755)
      const redo = await redoRestore(h.store, restored.restoreId)
      expect(redo.changed).toEqual(['run.sh'])
      expect(await read(h.root, 'run.sh')).toBe('echo two\n')
      const script = await stat(path.join(h.root, 'run.sh'))
      expect(script.mode & 0o777).toBe(0o755)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'records the batch and journals each write before its file changes',
    async () => {
      const h = await harness()
      await write(h.root, 'kept.txt', 'k0\n')
      await turn(h, 't1', async (tool) => {
        await tool('kept.txt', 'k1\n')
      })
      const seen: { batches: number; isJournaled: boolean }[] = []
      const original = atomic.writeFileIfUnchanged
      const spy = vi
        .spyOn(atomic, 'writeFileIfUnchanged')
        .mockImplementation(async (file, expected, content, options) => {
          const journal = await readFile(
            path.join(h.storage, 'm86', h.store.instance, 'journal.jsonl'),
            'utf8',
          )
          const intents = journal
            .split('\n')
            .filter((line) => line.includes('"batch"') && line.includes('"intent"'))
          seen.push({
            batches: storedUnits(h.storage).filter((unit) => unit.owner.unitKind === 'batch')
              .length,
            isJournaled: intents.some((line) => line.includes('kept.txt')),
          })
          return await original(file, expected, content, options)
        })
      try {
        await restoreTurn(h.store, 't1')
      } finally {
        spy.mockRestore()
      }
      expect(seen).toEqual([{ batches: 1, isJournaled: true }])
      expect(await read(h.root, 'kept.txt')).toBe('k0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses a checkpoint repository that does not name objects as a restore checks them',
    async () => {
      let wasProbed = false
      const h = await harness({
        gitProcess: async (args, options) => {
          if (args.includes('hash-object') && options.input === '') {
            wasProbed = true
            return Buffer.from(`${'0'.repeat(SHA256_HEX_LENGTH)}\n`)
          }
          return await realGit(args, options)
        },
      })
      await expect(h.store.turns('s1')).rejects.toThrow('SHA-1')
      expect(wasProbed).toBe(true)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('CheckpointStore across conversations and windows (M72, M86)', () => {
  it(
    'C: refuses a path another conversation wrote between two of this one’s writes',
    async () => {
      const h = await harness()
      await twoFileTurn(h)
      await turn(h, 'u1', (tool) => tool('a.txt', 'the other conversation\n'), 's2')
      await turn(h, 't2', (tool) => tool('a.txt', 'a2\n'))
      const outcome = await restoreTurn(h.store, 't1')
      expect(outcome.changed).toEqual(['b.txt'])
      expect(outcome.refused).toEqual([{ path: 'a.txt', reason: 'changedBetween' }])
      expect(await read(h.root, 'a.txt')).toBe('a2\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses to restore while any turn of the window runs, recorded or not',
    async () => {
      const h = await harness()
      await turn(h, 't1', (tool) => tool('a.txt', 'a1\n'))
      await h.store.markTurn(turnKey('s2', 'other'), true)
      expect(await restoreOutcome(h.store, 't1')).toEqual({ ok: false, reason: 'turnRunning' })
      await h.store.markTurn(turnKey('s2', 'other'), false)
      await restoreTurn(h.store, 't1')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps the new units of a conversation unarchived after the clock went back',
    async () => {
      let clock = 5000
      const h = await harness({ now: () => clock })
      await h.store.forgetSession('s1')
      // The clock goes back: everything from now on is "before" the archive.
      clock = 1000
      await h.store.unforgetSession('s1')
      await turn(h, 't1', (tool) => tool('a.txt', 'a1\n'))
      expect(await h.store.turns('s1')).toEqual(['t1'])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'when a window opens, forgets the conversations archived while it was untrusted',
    async () => {
      const h = await harness()
      await twoConversations(h)
      // Restricted Mode: no git runs, the archive is queued.
      await h.store.queueForget('s2')
      const reopened = h.reopen()
      await reopened.maintain()
      expect(await reopened.turns('s2')).toEqual([])
      expect(await reopened.turns('s1')).toEqual(['t1'])
      expect(storedUnits(h.storage).map((unit) => unit.owner.unitId)).toEqual(['t1'])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'when a window opens, drops what a gone 0.10.0 window kept, and recovers a gone window’s unit',
    async () => {
      const h = await harness({ isProcessAlive: (pid) => pid !== GONE_PID })
      const crashed = h.reopen(GONE_PID)
      // Its turn wrote a file and the window went before the turn ended.
      const unit = owner(crashed, 't1')
      await crashed.startUnit(unit)
      await toolWrite(crashed, unit, h.root, 'a.txt', 'a1\n')
      // What an M72 window of that instance kept: a capture's pin, its index's
      // ref and file, and its staged copies.
      const tree = shadowGit(h.storage, ['mktree'], '').trim()
      shadowGit(h.storage, ['update-ref', `refs/muse-spark/pin/${crashed.instance}/x`, tree])
      shadowGit(h.storage, ['update-ref', `refs/muse-spark/work/${crashed.instance}`, tree])
      await writeFile(path.join(h.storage, `work-${crashed.instance}.index`), 'index\n')
      await mkdir(path.join(h.storage, 'staging', crashed.instance), { recursive: true })
      await writeFile(path.join(h.storage, 'staging', crashed.instance, 'copy'), 'copy\n')
      crashed.dispose()
      await h.store.maintain()
      expect(shadowRefs(h.storage).filter((ref) => ref.includes(crashed.instance))).toEqual([])
      expect(await isPresent(h.storage, `work-${crashed.instance}.index`)).toBe(false)
      expect(await isPresent(h.storage, `staging/${crashed.instance}`)).toBe(false)
      expect(storedUnits(h.storage).map((unit) => [unit.owner.unitId, unit.status])).toEqual([
        ['t1', 'complete'],
      ])
      await restoreTurn(h.store, 't1')
      expect(await isPresent(h.root, 'a.txt')).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'clears a lock a git ended mid-command left, once it is older than any git may run',
    async () => {
      const h = await harness({ now: () => Date.now() })
      await h.store.turns('s1')
      const refs = path.join(h.storage, 'shadow.git', 'refs', 'muse-spark')
      await mkdir(refs, { recursive: true })
      await writeFile(path.join(refs, 'index.lock'), '')
      await mkdir(path.join(refs, 'keep'), { recursive: true })
      await writeFile(path.join(refs, 'keep', 'fresh.lock'), '')
      const past = new Date(Date.now() - CHECKPOINT_STALE_LOCK_MS - 1000)
      await utimes(path.join(refs, 'index.lock'), past, past)
      await h.reopen().turns('s1')
      expect(await isPresent(refs, 'index.lock')).toBe(false)
      expect(await isPresent(refs, 'keep/fresh.lock')).toBe(true)
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
      await turn(h, 't1', async (tool) => {
        for (const name of names) {
          await tool(name, 'small\n')
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
    'deletes a created file whose name reads as pathspec magic',
    async () => {
      const h = await harness()
      await turn(h, 't1', (tool) => tool(':!x.txt', 'new\n'))
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
      await h.store.turns('s1')
      const folder = await stat(h.storage)
      expect(folder.mode & 0o777).toBe(CHECKPOINT_STORAGE_MODE)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('CheckpointStore first setup (M72)', () => {
  // A window's first message reads its conversation's records (in the
  // queue) and publishes its running mark (outside it) together: the Theia
  // host check's "the message was not sent" (PR #55).
  it(
    'sets the repository up once when a running mark meets the first read',
    async () => {
      let inits = 0
      const second = Promise.withResolvers<undefined>()
      const h = await harness({
        git: 'none',
        gitProcess: async (args, options) => {
          if (args.includes('init')) {
            inits += 1
            if (inits === 1) {
              await Promise.race([second.promise, sleep(SECOND_SETUP_WAIT_MS)])
            } else {
              second.resolve(undefined)
            }
          }
          return await realGit(args, options)
        },
      })
      await expect(
        Promise.all([h.store.turns('s1'), h.store.markTurn('pending:message', true)]),
      ).resolves.toEqual([[], undefined])
      expect(inits).toBe(1)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
