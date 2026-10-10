import { FakeQuestionStore } from './helpers/questions/store'
import { questionFixture } from './helpers/questions/fixtures'
import { mkdtempSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { headerOf, type StoredSession } from '../../src/core/backends/modelapi/sessionStore'
import {
  createFileSessionStore,
  type FileSessionStoreDeps,
} from '../../src/host/backend/fileSessionStore'
import { MILLISECONDS_PER_DAY, UI_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'
import {
  UploadLedger,
  type UploadLedgerState,
  type UploadLedgerStorage,
  type SessionUploadOwnership,
} from '../../src/core/media/uploadLedger'
import { FilesApi } from '../../src/core/backends/modelapi/files'
import { FifoLimiter } from '../../src/core/fifoLimiter'

const root = mkdtempSync(path.join(tmpdir(), 'muse-sessions-'))

afterAll(() => removeFolder(root))

const LAST_ACTIVITY = '2026-09-22T10:00:00.000Z'
// The tests' clock: a day after the sessions' last activity.
const NOW = Date.parse(LAST_ACTIVITY) + MILLISECONDS_PER_DAY

const uploadedFile = {
  fileId: 'file-one',
  provider: 'meta',
  expiresAt: 1_800_000_000,
  sha256: 'a'.repeat(64),
  bytes: 3,
  name: 'clip.mp4',
  mime: 'video/mp4',
}

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

function storeIn(
  directory: string,
  overrides: Partial<FileSessionStoreDeps> = {},
  factory = createFileSessionStore,
) {
  const log = new FakeLogOutputChannel()
  const sleep = vi.fn(() => Promise.resolve())
  const store = factory({
    directory,
    log,
    retentionDays: () => 30,
    now: () => NOW,
    sleep,
    ...overrides,
  })
  return { store, log, sleep }
}

async function ledgerFor(directoryName: string) {
  const directory = path.join(root, directoryName)
  const sessionId = 'saved'
  const accountId = 'b'.repeat(64)
  let state: UploadLedgerState = {
    version: 1,
    accountId,
    entries: [{ file: uploadedFile, sessions: [sessionId] }],
    cachedFiles: [],
  }
  const lock = new FifoLimiter(1)
  const storage: UploadLedgerStorage = {
    read: () => Promise.resolve(structuredClone(state)),
    write: vi.fn((next) => {
      state = structuredClone(next)
      return Promise.resolve()
    }),
    withLock: async (operation) =>
      await lock.run(
        operation,
        () => true,
        () => new Error('Dropped'),
      ),
  }
  const requestFile = vi.fn((route: string, method: string) => {
    if (method !== 'DELETE') throw new Error('Unexpected Files request')
    return Promise.resolve(
      Response.json({ id: route.split('/').at(-1), object: 'file', deleted: true }),
    )
  })
  const ledger = new UploadLedger({
    storage,
    accountId,
    provider: 'meta',
    poolBytes: 100,
    currentAccountId: () => Promise.resolve(accountId),
    now: () => NOW,
    files: new FilesApi({
      client: { requestFile },
      provider: 'meta',
      authorizeUpload: () => Promise.resolve(),
    }),
  })
  const uploads = () => Promise.resolve(ledger)
  const session = { ...stored(sessionId), accountId, fileRefs: [uploadedFile] }
  const store = storeIn(directory, { uploads }).store
  await store.save(session)
  return {
    ledger,
    storage,
    requestFile,
    state: () => state,
    accountId,
    directory,
    uploads,
    session,
    store,
  }
}

async function expectUploadRetained(t: Awaited<ReturnType<typeof ledgerFor>>): Promise<void> {
  expect(await t.store.load('saved')).toMatchObject({ fileRefs: [uploadedFile] })
  expect(t.state().entries).toEqual([{ file: uploadedFile, sessions: ['saved'] }])
  expect(t.requestFile).not.toHaveBeenCalled()
}

function fakeUploadLifecycle() {
  const ownership = {
    syncSession: vi.fn((_id: string, _refs: readonly unknown[], _isCurrent?: () => boolean) =>
      Promise.resolve(),
    ),
    releaseSession: vi.fn((_id: string) => Promise.resolve()),
  }
  return {
    ...ownership,
    withLock: async <T>(operation: (ownership: SessionUploadOwnership) => Promise<T>): Promise<T> =>
      await operation(ownership),
  }
}

describe('createFileSessionStore', () => {
  it('serializes saves and removals across independent writers with the account lock', async () => {
    const t = await ledgerFor('independent-session-writers')
    const { directory, uploads, session } = t
    // A fresh module has a distinct process-local writer map, like another window.
    vi.resetModules()
    const { createFileSessionStore: independentFactory } =
      await import('../../src/host/backend/fileSessionStore')
    const other = storeIn(directory, { uploads }, independentFactory).store
    let removing: Promise<void> | undefined
    const saving = storeIn(directory, {
      uploads,
      rename: async (from, to) => {
        if (to.endsWith('saved.json')) {
          removing = other.remove('saved')
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 100)
          })
        }
        await rename(from, to)
      },
    }).store
    await saving.save(session)
    await removing
    expect(await other.load('saved')).toBeUndefined()
    expect(t.state().entries).toEqual([])
    expect(t.requestFile).toHaveBeenCalledTimes(1)
  })

  it('keeps the latest session snapshot when an older rename is delayed', async () => {
    const directory = path.join(root, 'delayed-session-writer')
    const latest = storeIn(directory).store
    await latest.save(stored('saved', 'Original'))
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const older = storeIn(directory, {
      rename: async (from, to) => {
        entered.resolve(undefined)
        await release.promise
        await rename(from, to)
      },
    }).store
    const saving = older.save(stored('saved', 'Older'))
    await entered.promise
    const newer = latest.save(stored('saved', 'Latest'))
    const timer = setTimeout(() => {
      release.resolve(undefined)
    }, 100)
    try {
      await Promise.all([saving, newer])
    } finally {
      clearTimeout(timer)
      release.resolve(undefined)
    }
    expect(await latest.load('saved')).toMatchObject({ name: 'Latest' })
  })

  it('serializes saves across store instances and keeps uploads referenced by the latest generation', async () => {
    const t = await ledgerFor('overlapping-saves')
    const { directory, uploads, session, store } = t
    const second = store
    let restoring: Promise<void> | undefined
    const first = storeIn(directory, {
      uploads,
      rename: async (from, to) => {
        await rename(from, to)
        if (to.endsWith('saved.json')) restoring = second.save(session)
      },
    }).store
    await first.save({ ...session, fileRefs: [] })
    await restoring
    await expectUploadRetained(t)
  })

  it('keeps the session until ownership release is durable and recovers interrupted deletion on listing', async () => {
    const t = await ledgerFor('interrupted-delete')
    const { directory, uploads, store } = t
    vi.mocked(t.storage.write).mockRejectedValueOnce(new Error('Disk full'))
    await expect(store.remove('saved')).rejects.toThrow('Disk full')
    expect(await store.load('saved')).toMatchObject({ fileRefs: [uploadedFile] })
    expect(t.requestFile).not.toHaveBeenCalled()
    const restarted = storeIn(directory, { uploads }).store
    expect(await restarted.list()).toEqual([])
    expect(await restarted.load('saved')).toBeUndefined()
    expect(t.state().entries).toEqual([])
    expect(t.requestFile).toHaveBeenCalledTimes(1)
    await restarted.list()
    await restarted.remove('saved')
    expect(t.requestFile).toHaveBeenCalledTimes(1)
  })

  it('keeps an upload when a newer save supersedes a queued recovery sweep', async () => {
    const t = await ledgerFor('superseded-recovery')
    const { directory, uploads, session, store } = t
    let listing: Promise<unknown> | undefined
    let restoring: Promise<void> | undefined
    const saving = storeIn(directory, {
      uploads,
      rename: async (from, to) => {
        await rename(from, to)
        if (!to.endsWith('saved.json')) return
        listing = store.list()
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 100)
        })
        restoring = store.save(session)
      },
    }).store
    await saving.save({ ...session, fileRefs: [] })
    await restoring
    await listing
    await expectUploadRetained(t)
  })

  it('rescues an upload when a newer save arrives during the final ownership write', async () => {
    const t = await ledgerFor('superseded-ledger-write')
    const { session, store } = t
    const write = vi.mocked(t.storage.write).getMockImplementation()!
    let restoring: Promise<void> | undefined
    let cleaning: Promise<void> | undefined
    vi.mocked(t.storage.write).mockImplementation(async (next) => {
      await write(next)
      if (next.entries.every((entry) => entry.sessions.length > 0)) return
      cleaning = t.ledger.deleteAllOurs()
      restoring = store.save(session)
    })
    await store.save({ ...session, fileRefs: [] })
    await cleaning
    await restoring
    await expectUploadRetained(t)
  })

  it('recovers stale ownership after a save published before its final ledger sync', async () => {
    const t = await ledgerFor('interrupted-save')
    const { directory, uploads, session, store } = t
    const write = vi.mocked(t.storage.write).getMockImplementation()!
    let shouldFail = true
    vi.mocked(t.storage.write).mockImplementation(async (next) => {
      if (shouldFail && next.entries.some((entry) => entry.sessions.length === 0)) {
        shouldFail = false
        throw new Error('Interrupted sync')
      }
      await write(next)
    })
    await expect(store.save({ ...session, fileRefs: [] })).rejects.toThrow('Interrupted sync')
    expect(await store.load('saved')).toMatchObject({ fileRefs: [] })
    const restarted = storeIn(directory, { uploads }).store
    await restarted.list()
    expect(t.state().entries).toEqual([])
    expect(t.requestFile).toHaveBeenCalledTimes(1)
    await restarted.list()
    expect(t.requestFile).toHaveBeenCalledTimes(1)
  })

  it('recovers an interrupted cleanup intent even when its session record is already absent', async () => {
    const t = await ledgerFor('missing-cleanup-session')
    const { directory, uploads, store } = t
    vi.mocked(t.storage.write).mockRejectedValueOnce(new Error('Disk full'))
    await expect(store.remove('saved')).rejects.toThrow('Disk full')
    await rm(path.join(directory, 'saved.json'), { force: true })
    const restarted = storeIn(directory, { uploads }).store
    expect(await restarted.list()).toEqual([])
    expect(t.state().entries).toEqual([])
    expect(t.requestFile).toHaveBeenCalledTimes(1)
    expect(await readdir(directory)).not.toContain('saved.uploads')
    await restarted.list()
    expect(t.requestFile).toHaveBeenCalledTimes(1)
  })

  it('retains an expired session when ledger release fails and retries purge durably', async () => {
    const t = await ledgerFor('interrupted-purge')
    const { directory, uploads } = t
    const expiring = storeIn(directory, {
      uploads,
      now: () => NOW + 30 * MILLISECONDS_PER_DAY,
    }).store
    vi.mocked(t.storage.write).mockRejectedValueOnce(new Error('Disk full'))
    expect(await expiring.list()).toHaveLength(1)
    expect(await expiring.load('saved')).toMatchObject({ fileRefs: [uploadedFile] })
    expect(await expiring.list()).toEqual([])
    expect(t.state().entries).toEqual([])
    expect(t.requestFile).toHaveBeenCalledTimes(1)
  })

  it('retains uploads across a durable save, fork and rewind, then releases on delete and purge', async () => {
    const directory = path.join(root, 'upload-lifecycle')
    const file = uploadedFile
    const lifecycle = fakeUploadLifecycle()
    const uploads = vi.fn(() => Promise.resolve(lifecycle))
    const t = storeIn(directory, { uploads, retentionDays: () => 0 })
    const parent = { ...stored('parent'), accountId: 'b'.repeat(64), fileRefs: [file] }
    await t.store.save(parent)
    expect(uploads).toHaveBeenCalledWith(parent.accountId)
    expect(lifecycle.syncSession.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['parent', [file]],
      ['parent', [file]],
    ])
    expect(await t.store.load('parent')).toMatchObject({ fileRefs: [file] })
    await t.store.save({ ...parent, sessionId: 'fork', forkedFrom: 'parent' })
    await t.store.save(parent)
    await t.store.remove('parent')
    expect(lifecycle.releaseSession).toHaveBeenCalledWith('parent')
    const expiring = storeIn(directory, { uploads, now: () => NOW + 30 * MILLISECONDS_PER_DAY })
    expect(await expiring.store.list()).toEqual([])
    expect(lifecycle.releaseSession).toHaveBeenCalledWith('fork')
  })

  it('keeps old upload references when the atomic session save fails', async () => {
    const directory = path.join(root, 'upload-save-failure')
    const file = uploadedFile
    const lifecycle = fakeUploadLifecycle()
    const uploads = () => Promise.resolve(lifecycle)
    const session = { ...stored('saved'), accountId: 'b'.repeat(64), fileRefs: [file] }
    await storeIn(directory, { uploads }).store.save(session)
    lifecycle.syncSession.mockClear()
    const failing = storeIn(directory, {
      uploads,
      rename: async (from, to) => {
        if (to.endsWith('.json')) throw busy('ENOSPC')
        await rename(from, to)
      },
    })
    await expect(failing.store.save({ ...session, fileRefs: [] })).rejects.toThrow('ENOSPC')
    expect(lifecycle.syncSession.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['saved', [file]],
    ])
    expect(await failing.store.load('saved')).toMatchObject({ fileRefs: [file] })
    expect(lifecycle.releaseSession).not.toHaveBeenCalled()
  })

  it('retains uploaded sessions when a header-only listing has no ownership ledger', async () => {
    const t = await ledgerFor('listing-without-owner')
    const cold = storeIn(t.directory, { now: () => NOW + 31 * MILLISECONDS_PER_DAY }).store
    await expect(cold.list()).rejects.toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    expect(JSON.parse(await readFile(path.join(t.directory, 'saved.json'), 'utf8'))).toMatchObject({
      fileRefs: [uploadedFile],
    })
    expect(t.requestFile).not.toHaveBeenCalled()
  })

  it('requires the ledger for uploads, carries nested child refs and refuses a forged file identity', async () => {
    const directory = path.join(root, 'upload-boundaries')
    const file = uploadedFile
    const session = { ...stored('saved'), accountId: 'b'.repeat(64), fileRefs: [file] }
    await expect(storeIn(directory).store.save(session)).rejects.toThrow(
      UI_TEXT.sessionBudgetStoreUnavailable,
    )
    const lifecycle = fakeUploadLifecycle()
    const t = storeIn(directory, { uploads: () => Promise.resolve(lifecycle) })
    await t.store.save({
      ...stored('parent'),
      accountId: session.accountId,
      children: [
        {
          id: 'child',
          role: 'worker',
          objective: 'check',
          itemId: 'i1',
          parentTurnId: 't1',
          startedAt: NOW,
          state: 'closed',
          pendingMessages: [],
          session,
        },
      ],
    })
    expect(lifecycle.syncSession).toHaveBeenCalledWith('parent', [file], expect.any(Function))
    await writeFile(
      path.join(directory, 'forged.json'),
      JSON.stringify({ ...stored('../outside'), lastActivityAt: LAST_ACTIVITY }),
    )
    expect(await t.store.load('forged')).toBeUndefined()
    expect(t.log.warn).toHaveBeenCalledWith(
      'Session file skipped: identity does not match its filename',
    )
  })

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

  it('lists a header whose conversation no longer parses, and refuses to open it (M101 BYO 16)', async () => {
    const directory = path.join(root, 'headers')
    const { store, log } = storeIn(directory)
    await store.save({ ...stored('whole', 'Whole'), turnIds: ['t1'] })
    // A damaged replay: the header still reads, the session does not.
    const raw: Record<string, unknown> = structuredClone({
      ...stored('damaged', 'Damaged'),
      turnIds: ['t1'],
    })
    raw['replay'] = ['bogus']
    await writeFile(path.join(directory, 'damaged.json'), JSON.stringify(raw), 'utf8')
    await expect(store.list()).resolves.toEqual([
      headerOf({ ...stored('damaged', 'Damaged'), turnIds: ['t1'] }),
      headerOf({ ...stored('whole', 'Whole'), turnIds: ['t1'] }),
    ])
    expect(log.warn).not.toHaveBeenCalled()
    await expect(store.load('damaged')).resolves.toBeUndefined()
    expect(log.warn).toHaveBeenCalledTimes(1)
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

it('deletes the question registry on explicit deletion and retention cleanup, refusing partial cleanup', async () => {
  const questions = new FakeQuestionStore()
  const directory = path.join(root, 'questions-removal')
  const { store } = storeIn(directory, { questions, retentionDays: () => 0 })
  await store.save(stored('session-1'))
  await questions.save('session-1', [questionFixture()])
  await store.remove('session-1')
  expect(await questions.load('session-1')).toEqual([])
  await store.save(stored('session-1'))
  await questions.save('session-1', [questionFixture()])
  const expiring = storeIn(directory, {
    questions,
    retentionDays: () => 1,
    now: () => NOW + MILLISECONDS_PER_DAY,
  })
  expect(await expiring.store.list()).toEqual([])
  expect(await questions.load('session-1')).toEqual([])
  await store.save(stored('session-1'))
  questions.remove.mockRejectedValueOnce(new Error('cleanup refused'))
  await expect(store.remove('session-1')).rejects.toThrow('cleanup refused')
  expect(await store.load('session-1')).toBeDefined()
})

it('keeps an expired session visible when question cleanup fails', async () => {
  const questions = new FakeQuestionStore()
  const directory = path.join(root, 'questions-retention-failure')
  const { store } = storeIn(directory, { questions, retentionDays: () => 0 })
  await store.save(stored('session-1'))
  const expiring = storeIn(directory, {
    questions,
    retentionDays: () => 1,
    now: () => NOW + MILLISECONDS_PER_DAY,
  })
  questions.remove.mockRejectedValueOnce(new Error('cleanup refused'))
  expect(await expiring.store.list()).toHaveLength(1)
  expect(await store.load('session-1')).toBeDefined()
})
