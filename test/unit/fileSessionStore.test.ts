import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { headerOf, type StoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { createFileSessionStore } from '../../src/host/backend/fileSessionStore'
import { MILLISECONDS_PER_DAY, UI_TEXT } from '../../src/shared/constants'

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

function stored(sessionId: string, name?: string): StoredSession {
  return {
    version: 1,
    sessionId,
    workspaceRoot: '/ws',
    modelId: 'muse-spark-1.3',
    approvalMode: 'allowAll',
    effort: 'high',
    ...(name !== undefined && { name }),
    createdAt: '2026-09-22T09:00:00.000Z',
    lastActivityAt: '2026-09-22T10:00:00.000Z',
    turnIds: [],
    todos: [],
    replay: [],
    transcript: [],
    outputs: {},
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
  }
}

async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'rvtestcut2-sessions-'))
  folders.push(directory)
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const atMs = Date.parse('2026-09-23T10:00:00.000Z')
  const open = (retentionDays = 0, now = atMs) =>
    createFileSessionStore({
      directory,
      log,
      retentionDays: () => retentionDays,
      now: () => now,
      sleep: delay,
    })
  return { directory, log, atMs, open, store: open() }
}

describe('real session files', () => {
  it('round-trips, renames and removes a saved conversation across store instances', async () => {
    const { store, open, directory } = await setup()
    expect(await store.list()).toEqual([])
    await store.save(stored('session-1', 'Original'))
    const renamed = stored('session-1', 'Renamed')
    await open().save(renamed)
    expect(await store.list()).toEqual([headerOf(renamed)])
    expect(await open().load('session-1')).toEqual(renamed)
    expect(JSON.parse(await readFile(path.join(directory, 'session-1.json'), 'utf8'))).toEqual(
      renamed,
    )
    await open().remove('session-1')
    expect(await store.load('session-1')).toBeUndefined()
    expect(await readdir(directory)).toEqual([])
  })

  it('lists intact headers of damaged conversations but refuses to open corrupt replay', async () => {
    const { store, directory, log } = await setup()
    await store.save(stored('good'))
    const damaged = stored('damaged')
    await writeFile(
      path.join(directory, 'damaged.json'),
      JSON.stringify({ ...damaged, replay: ['bogus'] }),
    )
    await writeFile(path.join(directory, 'broken.json'), '{not json')
    expect(await store.list()).toEqual([headerOf(damaged), headerOf(stored('good'))])
    expect(await store.load('damaged')).toBeUndefined()
    expect(await store.load('good')).toEqual(stored('good'))
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('broken.json skipped'))
  })

  it('keeps sessions at the retention boundary and with retention off, deleting only older sessions', async () => {
    const { store, open, atMs } = await setup()
    const recent = { ...stored('recent'), lastActivityAt: new Date(atMs).toISOString() }
    await store.save(stored('old'))
    await store.save(recent)
    expect(await open(0, atMs + 30 * MILLISECONDS_PER_DAY).list()).toHaveLength(2)
    expect(await open(30, atMs + 30 * MILLISECONDS_PER_DAY).list()).toEqual([headerOf(recent)])
    expect(await store.load('old')).toBeUndefined()
    expect(await store.load('recent')).toEqual(recent)
  })

  it('refuses traversal IDs before a save, load or removal can leave its directory', async () => {
    const { store, directory } = await setup()
    await expect(store.save(stored('../escape'))).rejects.toThrow('cannot name a file')
    await expect(store.load('a/b')).rejects.toThrow('cannot name a file')
    await expect(store.remove('a/b')).rejects.toThrow('cannot name a file')
    expect(await readdir(directory)).toEqual([])
  })
})

describe('session budget store failures', () => {
  it('refuses a damaged upload intent with the store sentence and keeps the cause', async () => {
    const { store, directory } = await setup()
    await store.save(stored('s1'))
    await writeFile(path.join(directory, 's1.uploads'), 'not json', 'utf8')
    let failure: unknown
    try {
      await store.list()
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(failure instanceof Error && failure.message).toBe(UI_TEXT.sessionBudgetStoreUnavailable)
    expect(failure instanceof Error && failure.cause instanceof Error).toBe(true)
  })

  it('reads an unreadable session file as absent instead of throwing', async () => {
    const { store, directory } = await setup()
    await store.save(stored('s1'))
    await rm(path.join(directory, 's1.json'))
    await mkdir(path.join(directory, 's1.json'))
    await expect(store.load('s1')).resolves.toBeUndefined()
  })
})
