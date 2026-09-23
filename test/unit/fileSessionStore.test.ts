import { mkdtempSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { headerOf, type StoredSession } from '../../src/core/backends/modelapi/sessionStore'
import {
  createFileSessionStore,
  type FileSessionStoreDeps,
} from '../../src/host/backend/fileSessionStore'
import { MILLISECONDS_PER_DAY } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

const root = mkdtempSync(path.join(tmpdir(), 'muse-sessions-'))

afterAll(() => removeFolder(root))

const LAST_ACTIVITY = '2026-09-22T10:00:00.000Z'
// The tests' clock: a day after the sessions' last activity.
const NOW = Date.parse(LAST_ACTIVITY) + MILLISECONDS_PER_DAY

const stored = (sessionId: string, name?: string): StoredSession => ({
  version: 1,
  sessionId,
  workspaceRoot: '/ws',
  modelId: 'muse-spark-1.3',
  approvalMode: 'allowAll',
  effort: 'high',
  ...(name !== undefined && { name }),
  createdAt: '2026-09-22T09:00:00.000Z',
  lastActivityAt: LAST_ACTIVITY,
  turnIds: [],
  todos: [],
  replay: [],
  transcript: [],
  outputs: {},
  usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
})

/** A file-system error with its code, as Node raises one. */
function busy(code: string): Error {
  return Object.assign(new Error(code), { code })
}

function storeIn(directory: string, overrides: Partial<FileSessionStoreDeps> = {}) {
  const log = new FakeLogOutputChannel()
  const sleep = vi.fn(() => Promise.resolve())
  const store = createFileSessionStore({
    directory,
    log,
    retentionDays: () => 30,
    now: () => NOW,
    sleep,
    ...overrides,
  })
  return { store, log, sleep }
}

describe('createFileSessionStore', () => {
  it('lists nothing before the directory exists, then round-trips saved sessions', async () => {
    const { store, log } = storeIn(path.join(root, 'fresh'))
    await expect(store.list()).resolves.toEqual([])
    await store.save(stored('b-2', 'Second'))
    await store.save(stored('a-1'))
    await store.save({ ...stored('a-1'), name: 'Renamed' })
    // The list holds headers only (D26); a session is read whole on demand.
    await expect(store.list()).resolves.toEqual([
      headerOf({ ...stored('a-1'), name: 'Renamed' }),
      headerOf(stored('b-2', 'Second')),
    ])
    await expect(store.load('a-1')).resolves.toEqual({ ...stored('a-1'), name: 'Renamed' })
    await expect(store.load('never-there')).resolves.toBeUndefined()
    expect(await readdir(path.join(root, 'fresh'))).toEqual(['a-1.json', 'b-2.json'])
    await store.remove('a-1')
    await store.remove('never-there')
    await expect(store.list()).resolves.toEqual([headerOf(stored('b-2', 'Second'))])
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('skips a corrupt or invalid file with a log line and keeps the rest', async () => {
    const directory = path.join(root, 'mixed')
    const { store, log } = storeIn(directory)
    await store.save(stored('good'))
    await writeFile(path.join(directory, 'broken.json'), '{not json', 'utf8')
    await writeFile(path.join(directory, 'wrong.json'), JSON.stringify({ version: 9 }), 'utf8')
    await writeFile(path.join(directory, 'notes.txt'), 'ignored', 'utf8')
    await expect(store.list()).resolves.toEqual([headerOf(stored('good'))])
    expect(log.warn).toHaveBeenCalledTimes(2)
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('broken.json skipped'))
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('wrong.json skipped'))
    expect(JSON.parse(await readFile(path.join(directory, 'good.json'), 'utf8'))).toEqual(
      stored('good'),
    )
  })

  it('refuses a session id that could leave the directory', async () => {
    const { store } = storeIn(path.join(root, 'ids'))
    await expect(store.save(stored('../escape'))).rejects.toThrow('cannot name a file')
    await expect(store.remove('a/b')).rejects.toThrow('cannot name a file')
    await expect(store.load('a/b')).rejects.toThrow('cannot name a file')
  })

  it('deletes sessions idle past the retention period, and keeps them with 0 (D26)', async () => {
    const directory = path.join(root, 'retention')
    const recent = { ...stored('recent'), lastActivityAt: new Date(NOW).toISOString() }
    const undated = { ...stored('undated'), lastActivityAt: 'not a date' }
    const keeping = storeIn(directory, { retentionDays: () => 0 })
    await keeping.store.save(stored('old'))
    await keeping.store.save(recent)
    await keeping.store.save(undated)
    await expect(keeping.store.list()).resolves.toHaveLength(3)
    // Thirty days on, "old" has been idle 31 days and goes; "recent" has been
    // idle exactly 30 and stays; an unreadable date is never a reason to delete.
    const expiring = storeIn(directory, { now: () => NOW + 30 * MILLISECONDS_PER_DAY })
    await expect(expiring.store.list()).resolves.toEqual([headerOf(recent), headerOf(undated)])
    expect(await readdir(directory)).toEqual(['recent.json', 'undated.json'])
    expect(expiring.log.info).toHaveBeenCalledWith(
      expect.stringContaining('Session old idle for more than 30 days deleted'),
    )
  })

  it('removes a temporary file a crash left, not one a save may be writing (D26)', async () => {
    const directory = path.join(root, 'leftovers')
    await mkdir(directory, { recursive: true })
    const stale = path.join(directory, 'crashed.json.tmp')
    const fresh = path.join(directory, 'writing.json.tmp')
    await writeFile(stale, '{', 'utf8')
    await writeFile(fresh, '{', 'utf8')
    const staleTime = new Date(NOW - 2 * 60 * 1000)
    await utimes(stale, staleTime, staleTime)
    const freshTime = new Date(NOW)
    await utimes(fresh, freshTime, freshTime)
    const { store } = storeIn(directory)
    await expect(store.list()).resolves.toEqual([])
    expect(await readdir(directory)).toEqual(['writing.json.tmp'])
  })

  it('tries a rename again while Windows reports the file busy, then gives up (D26)', async () => {
    const directory = path.join(root, 'busy')
    let refusals = 2
    const flaky = vi.fn(async (from: string, to: string) => {
      if (refusals > 0) {
        refusals -= 1
        throw busy('EPERM')
      }
      await rename(from, to)
    })
    const { store, sleep } = storeIn(directory, { rename: flaky })
    await store.save(stored('s1'))
    expect(flaky).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[25], [50]])
    await expect(store.load('s1')).resolves.toEqual(stored('s1'))
    const stuck = storeIn(directory, { rename: () => Promise.reject(busy('EBUSY')) })
    await expect(stuck.store.save(stored('s2'))).rejects.toThrow('EBUSY')
    expect(stuck.sleep).toHaveBeenCalledTimes(4)
    const denied = storeIn(directory, { rename: () => Promise.reject(busy('ENOSPC')) })
    await expect(denied.store.save(stored('s3'))).rejects.toThrow('ENOSPC')
    expect(denied.sleep).not.toHaveBeenCalled()
  })
})
