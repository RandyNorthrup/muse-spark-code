import { mkdtempSync } from 'node:fs'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { StoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { createFileSessionStore } from '../../src/host/backend/fileSessionStore'
import { FakeLogOutputChannel } from './helpers/fakes'

const root = mkdtempSync(path.join(tmpdir(), 'muse-sessions-'))

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const stored = (sessionId: string, name?: string): StoredSession => ({
  version: 1,
  sessionId,
  workspaceRoot: '/ws',
  modelId: 'muse-spark-1.3',
  approvalMode: 'allowAll',
  effort: 'high',
  ...(name !== undefined && { name }),
  createdAt: '2026-09-22T10:00:00.000Z',
  lastActivityAt: '2026-09-22T10:00:00.000Z',
  turnIds: [],
  todos: [],
  replay: [],
  transcript: [],
  outputs: {},
  usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
})

describe('createFileSessionStore', () => {
  it('lists nothing before the directory exists, then round-trips saved sessions', async () => {
    const log = new FakeLogOutputChannel()
    const store = createFileSessionStore({ directory: path.join(root, 'fresh'), log })
    await expect(store.list()).resolves.toEqual([])
    await store.save(stored('b-2', 'Second'))
    await store.save(stored('a-1'))
    await store.save({ ...stored('a-1'), name: 'Renamed' })
    await expect(store.list()).resolves.toEqual([
      { ...stored('a-1'), name: 'Renamed' },
      stored('b-2', 'Second'),
    ])
    expect(await readdir(path.join(root, 'fresh'))).toEqual(['a-1.json', 'b-2.json'])
    await store.remove('a-1')
    await store.remove('never-there')
    await expect(store.list()).resolves.toEqual([stored('b-2', 'Second')])
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('skips a corrupt or invalid file with a log line and keeps the rest', async () => {
    const log = new FakeLogOutputChannel()
    const directory = path.join(root, 'mixed')
    const store = createFileSessionStore({ directory, log })
    await store.save(stored('good'))
    await writeFile(path.join(directory, 'broken.json'), '{not json', 'utf8')
    await writeFile(path.join(directory, 'wrong.json'), JSON.stringify({ version: 9 }), 'utf8')
    await writeFile(path.join(directory, 'notes.txt'), 'ignored', 'utf8')
    await expect(store.list()).resolves.toEqual([stored('good')])
    expect(log.warn).toHaveBeenCalledTimes(2)
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('broken.json skipped'))
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('wrong.json skipped'))
    expect(JSON.parse(await readFile(path.join(directory, 'good.json'), 'utf8'))).toEqual(
      stored('good'),
    )
  })

  it('refuses a session id that could leave the directory', async () => {
    const store = createFileSessionStore({
      directory: path.join(root, 'ids'),
      log: new FakeLogOutputChannel(),
    })
    await expect(store.save(stored('../escape'))).rejects.toThrow('cannot name a file')
    await expect(store.remove('a/b')).rejects.toThrow('cannot name a file')
  })
})
