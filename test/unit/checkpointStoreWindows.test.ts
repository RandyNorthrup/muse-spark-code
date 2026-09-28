import { mkdir, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { turnKey } from '../../src/host/checkpoints/checkpointStore'
import { StoreBusyError } from '../../src/host/checkpoints/storeLock'
import { processGitProcess } from '../../src/host/git'
import { CHECKPOINT_OWNER_STALE_MS } from '../../src/shared/constants'
import {
  captured,
  harness,
  isPresent,
  leftovers,
  read,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  restoreTurn,
  shadowRefs,
  turn,
  write,
} from './helpers/checkpointHarness'

// Two VS Code windows on one folder share its checkpoint store (M72, the
// review of PR #55): each operation runs under the store's lock and reads
// the records afresh, a live window's pins, copies and running turns are its
// own, and a lock another window holds too long refuses the action with the
// reason. Also: a restore never removes a folder that was there before.
afterEach(async () => {
  await removeCheckpointFolders()
})

const realGit = processGitProcess()
const GONE_PID = 424_242
const SHORT_WAIT_MS = 300
const SHORT_RETRY_MS = 100
const SHORT_HEARTBEAT_MS = 50

/** Another live window takes the store's lock (and keeps it until `freeLock`). */
async function holdLock(storage: string): Promise<void> {
  await mkdir(storage, { recursive: true })
  await writeFile(
    path.join(storage, 'store.lock'),
    JSON.stringify({ pid: process.pid, instance: 'another window' }),
  )
}

async function freeLock(storage: string): Promise<void> {
  await rm(path.join(storage, 'store.lock'), { force: true })
}

interface StoredRecords {
  readonly checkpoints: readonly { readonly endedAt?: number; readonly end?: unknown }[]
  readonly forgotten?: readonly { readonly sessionId: string }[]
}

async function storedRecords(storage: string): Promise<StoredRecords> {
  return JSON.parse(await read(storage, 'records.json')) as StoredRecords
}

/** The first checkpoint record on disk. */
async function firstRecord(storage: string): Promise<StoredRecords['checkpoints'][number]> {
  const records = await storedRecords(storage)
  return records.checkpoints[0] ?? {}
}

/** The conversations the records remember as archived. */
async function forgottenIds(storage: string): Promise<readonly string[]> {
  const records = await storedRecords(storage)
  return (records.forgotten ?? []).map((entry) => entry.sessionId)
}

describe('CheckpointStore across windows (M72)', () => {
  it(
    'keeps both windows’ records when they record at once',
    async () => {
      const h = await harness()
      const first = h.store
      const second = h.reopen()
      const [one, two] = [await captured(first), await captured(second)]
      await Promise.all([first.record('s1', 't1', one), second.record('s2', 'u1', two)])
      await first.record('s1', 't2', await captured(first))
      expect(await first.turns('s2')).toEqual(['u1'])
      expect(await second.turns('s1')).toEqual(['t1', 't2'])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps a live window’s pinned capture and tool copies, and drops them once it is gone',
    async () => {
      const h = await harness()
      const other = h.reopen()
      await write(h.root, 'a.txt', 'unique to the other window’s capture\n')
      const waiting = await captured(other)
      await other.record('s2', 'u1', await captured(other))
      await other.beforeToolWrite(path.join(h.root, 'a.txt'))
      await write(h.root, 'a.txt', 'moved on\n')
      await h.store.maintain()
      expect(await leftovers(h.storage)).toEqual({ pins: 1, staging: 1 })
      // The pinned capture survived the prune: it can still be recorded.
      await other.record('s2', 'u2', waiting)
      // A capture no turn has taken yet, when the window closes.
      await captured(other)
      other.dispose()
      await h.store.maintain()
      expect(await leftovers(h.storage)).toEqual({ pins: 0, staging: 0 })
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses what another window’s overlapping turn changed, and any restore while one runs',
    async () => {
      const h = await harness()
      const other = h.reopen()
      await write(h.root, 'a.txt', 'a0\n')
      await write(h.root, 'b.txt', 'b0\n')
      await h.store.record('s1', 't1', await captured(h.store))
      await other.record('s2', 'u1', await captured(other))
      await write(h.root, 'b.txt', 'written in the other window\n')
      await other.endTurn('s2', 'u1')
      await write(h.root, 'a.txt', 'a1\n')
      await h.store.endTurn('s1', 't1')
      await other.record('s2', 'u2', await captured(other))
      await other.markTurn(turnKey('s2', 'u2'), true)
      expect(
        await h.store.restore({ sessionId: 's1', turnId: 't1', unsavedPaths: () => [] }),
      ).toEqual({ ok: false, reason: 'turnElsewhere' })
      await other.markTurn(turnKey('s2', 'u2'), false)
      await other.endTurn('s2', 'u2')
      const outcome = await restoreTurn(h.store, 't1')
      expect(outcome.changed).toEqual(['a.txt'])
      expect(outcome.refused).toEqual([{ path: 'b.txt', reason: 'changedAfter' }])
      expect(await read(h.root, 'b.txt')).toBe('written in the other window\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses with the reason when another window holds the store too long, and still lists',
    async () => {
      const h = await harness({ timing: { lockWaitMs: SHORT_WAIT_MS } })
      await turn(h, 't1', async () => {
        await write(h.root, 'a.txt', 'a1\n')
      })
      await holdLock(h.storage)
      const capture = await h.store.capture()
      expect(capture.ok || capture.reason).toBe('busy')
      expect(
        await h.store.restore({ sessionId: 's1', turnId: 't1', unsavedPaths: () => [] }),
      ).toMatchObject({ ok: false, reason: 'busy' })
      expect(await h.store.turns('s1')).toEqual(['t1'])
      expect(await read(h.root, 'a.txt')).toBe('a1\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'ends only its own window’s turns',
    async () => {
      const h = await harness()
      await h.store.record('s1', 't1', await captured(h.store))
      // Another window shows the same conversation and sees the turn end.
      await h.reopen().endTurn('s1', 't1')
      const records = JSON.parse(await read(h.storage, 'records.json')) as {
        readonly checkpoints: readonly { readonly endedAt?: number }[]
      }
      expect(records.checkpoints[0]?.endedAt).toBeUndefined()
      await h.store.endTurn('s1', 't1')
      await restoreTurn(h.store, 't1')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'takes over the lock of a window whose process is gone',
    async () => {
      const h = await harness({ isProcessAlive: (pid) => pid !== GONE_PID })
      await mkdir(h.storage, { recursive: true })
      await writeFile(
        path.join(h.storage, 'store.lock'),
        JSON.stringify({ pid: GONE_PID, instance: 'crashed window' }),
      )
      await captured(h.store)
      expect(await readdir(h.storage)).not.toContain('store.lock')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('CheckpointStore while another window holds the lock (M72)', () => {
  it(
    'publishes a running turn at once, with no lock, and another window waits for it',
    async () => {
      const h = await harness({ timing: { lockWaitMs: SHORT_WAIT_MS } })
      const other = h.reopen()
      await turn(
        { store: other },
        'u1',
        async () => {
          await write(h.root, 'a.txt', 'a1\n')
        },
        's2',
      )
      await holdLock(h.storage)
      await h.store.markTurn('pending:message', true)
      await freeLock(h.storage)
      expect(
        await other.restore({ sessionId: 's2', turnId: 'u1', unsavedPaths: () => [] }),
      ).toEqual({ ok: false, reason: 'turnElsewhere' })
      await h.store.markTurn('pending:message', false)
      await restoreTurn(other, 'u1', 's2')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'ends a turn here at once, and records its end, with no end capture, once the lock frees',
    async () => {
      const h = await harness({ timing: { lockWaitMs: SHORT_WAIT_MS } })
      await write(h.root, 'a.txt', 'a0\n')
      await h.store.record('s1', 't1', await captured(h.store))
      await write(h.root, 'a.txt', 'a1\n')
      await holdLock(h.storage)
      await h.store.endTurn('s1', 't1')
      await freeLock(h.storage)
      const outcome = await restoreTurn(h.store, 't1')
      expect(outcome.changed).toEqual(['a.txt'])
      expect(outcome.unsure).toEqual(['a.txt'])
      const record = await firstRecord(h.storage)
      expect(record.endedAt).toBeDefined()
      expect(record.end).toBeUndefined()
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'tries the put-off work again by itself',
    async () => {
      const h = await harness({
        timing: { lockWaitMs: SHORT_WAIT_MS, retryMs: SHORT_RETRY_MS },
      })
      await h.store.record('s1', 't1', await captured(h.store))
      await holdLock(h.storage)
      await h.store.endTurn('s1', 't1')
      await freeLock(h.storage)
      await vi.waitFor(
        async () => {
          const record = await firstRecord(h.storage)
          expect(record.endedAt).toBeDefined()
        },
        { timeout: 10_000 },
      )
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps nothing of a record refused, and lets its pinned capture go later',
    async () => {
      const h = await harness({ timing: { lockWaitMs: SHORT_WAIT_MS } })
      await turn(h, 't0', async () => {
        await write(h.root, 'a.txt', 'a1\n')
      })
      const refused = await captured(h.store)
      await holdLock(h.storage)
      await expect(h.store.record('s1', 't1', refused)).rejects.toBeInstanceOf(StoreBusyError)
      await freeLock(h.storage)
      await restoreTurn(h.store, 't0')
      expect(shadowRefs(h.storage).filter((ref) => ref.includes('/pin/'))).toEqual([])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps no open turn for a record whose lock another window took over part way',
    async () => {
      const takeover = { isArmed: false, storage: '' }
      const h = await harness({
        gitProcess: async (args, options) => {
          const output = await realGit(args, options)
          // Taken over just after the record's last git step, before it is saved.
          if (takeover.isArmed && args.includes('update-ref') && args.includes('--stdin')) {
            takeover.isArmed = false
            await holdLock(takeover.storage)
          }
          return output
        },
      })
      takeover.storage = h.storage
      await turn(h, 't0', async () => {
        await write(h.root, 'a.txt', 'a1\n')
      })
      const snapshot = await captured(h.store)
      takeover.isArmed = true
      await expect(h.store.record('s1', 't1', snapshot)).rejects.toBeInstanceOf(StoreBusyError)
      await freeLock(h.storage)
      await restoreTurn(h.store, 't0')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'archives here at once, and on disk for every window once the lock frees',
    async () => {
      const h = await harness({ timing: { lockWaitMs: SHORT_WAIT_MS } })
      await turn(h, 't0', async () => {
        await write(h.root, 'a.txt', 'a1\n')
      })
      const early = await captured(h.store)
      await holdLock(h.storage)
      await h.store.forgetSession('s1')
      expect(await h.store.turns('s1')).toEqual([])
      await freeLock(h.storage)
      await h.store.record('s1', 't9', early)
      expect(await h.reopen().turns('s1')).toEqual([])
      expect(await forgottenIds(h.storage)).toEqual(['s1'])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'writes an archive in Restricted Mode even before any checkpoint',
    async () => {
      const h = await harness()
      await h.store.queueForget('s1')
      expect(await forgottenIds(h.storage)).toEqual(['s1'])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'copies a file a tool is about to write with no lock, and fails the write when it cannot',
    async () => {
      const h = await harness({ timing: { lockWaitMs: SHORT_WAIT_MS } })
      await h.store.record('s1', 't1', await captured(h.store))
      await write(h.root, '.env', 'KEY=1\n')
      await holdLock(h.storage)
      await h.store.beforeToolWrite(path.join(h.root, '.env'))
      await freeLock(h.storage)
      expect(await readdir(path.join(h.storage, 'staging'))).toHaveLength(1)
      const blocked = await harness()
      await blocked.store.record('s1', 't1', await captured(blocked.store))
      await write(blocked.root, 'b.txt', 'b\n')
      // Nowhere to stage a copy: the staging folder's place is a file.
      await writeFile(path.join(blocked.storage, 'staging'), '')
      await expect(blocked.store.beforeToolWrite(path.join(blocked.root, 'b.txt'))).rejects.toThrow(
        /not written/,
      )
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps the window’s presence beating while it is open',
    async () => {
      const h = await harness({ timing: { heartbeatMs: SHORT_HEARTBEAT_MS } })
      await h.store.markTurn(turnKey('s1', 't1'), true)
      const [presence] = await readdir(path.join(h.storage, 'windows'))
      const presencePath = path.join(h.storage, 'windows', presence ?? '')
      const past = new Date(Date.now() - CHECKPOINT_OWNER_STALE_MS - 1000)
      await utimes(presencePath, past, past)
      await vi.waitFor(async () => {
        const beaten = await stat(presencePath)
        expect(Date.now() - beaten.mtimeMs).toBeLessThan(CHECKPOINT_OWNER_STALE_MS)
      })
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('CheckpointStore and folders (M72)', () => {
  it(
    'never removes a folder that was there before the turn, even an empty one',
    async () => {
      const h = await harness()
      await write(h.root, 'kept.txt', 'k\n')
      await mkdir(path.join(h.root, 'empty'))
      await mkdir(path.join(h.root, 'outer', 'inner'), { recursive: true })
      await turn(h, 't1', async () => {
        await write(h.root, 'empty/new.txt', 'new\n')
        await write(h.root, 'outer/inner/x.txt', 'new\n')
        await write(h.root, 'made/deep/n.txt', 'new\n')
      })
      const outcome = await restoreTurn(h.store, 't1')
      expect(outcome.changed.toSorted((a, b) => a.localeCompare(b))).toEqual([
        'empty/new.txt',
        'made/deep/n.txt',
        'outer/inner/x.txt',
      ])
      expect(await readdir(path.join(h.root, 'empty'))).toEqual([])
      expect(await readdir(path.join(h.root, 'outer', 'inner'))).toEqual([])
      expect(await isPresent(h.root, 'made')).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
