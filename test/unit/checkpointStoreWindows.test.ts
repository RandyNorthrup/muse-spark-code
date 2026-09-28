import { mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StoreBusyError } from '../../src/host/checkpoints/storeLock'
import {
  captured,
  harness,
  isPresent,
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

const GONE_PID = 424_242
const SHORT_WAIT_MS = 300

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
      const refs = shadowRefs(h.storage)
      expect(refs.some((ref) => ref.includes('/pin/'))).toBe(true)
      expect(refs.some((ref) => ref.includes('/journal/'))).toBe(true)
      // The pinned capture survived the prune: it can still be recorded.
      await other.record('s2', 'u2', waiting)
      // A capture no turn has taken yet, when the window closes.
      await captured(other)
      other.dispose()
      await h.store.maintain()
      expect(shadowRefs(h.storage).filter((ref) => /\/(?:pin|journal)\//.test(ref))).toEqual([])
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
      expect(
        await h.store.restore({ sessionId: 's1', turnId: 't1', unsavedPaths: () => [] }),
      ).toEqual({ ok: false, reason: 'turnElsewhere' })
      await other.endTurn('s2', 'u2')
      const outcome = await restoreTurn(h.store, 't1')
      expect(outcome.changed).toEqual(['a.txt'])
      expect(outcome.refused).toEqual([{ path: 'b.txt', reason: 'changedAfter' }])
      expect(await read(h.root, 'b.txt')).toBe('written in the other window\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses with the reason when another window holds the store too long',
    async () => {
      const h = await harness({ lockWaitMs: SHORT_WAIT_MS })
      await turn(h, 't1', async () => {
        await write(h.root, 'a.txt', 'a1\n')
      })
      await writeFile(
        path.join(h.storage, 'store.lock'),
        JSON.stringify({ pid: process.pid, instance: 'another window' }),
      )
      const capture = await h.store.capture()
      expect(capture.ok || capture.reason).toBe('busy')
      expect(
        await h.store.restore({ sessionId: 's1', turnId: 't1', unsavedPaths: () => [] }),
      ).toMatchObject({ ok: false, reason: 'busy' })
      await expect(h.store.turns('s1')).rejects.toBeInstanceOf(StoreBusyError)
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
