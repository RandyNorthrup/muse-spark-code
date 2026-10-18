// Two windows, one session (PLAN.md D121): each window saves the running
// spend total it saw, and both increments survive instead of the larger
// snapshot dropping the other's. Each store instance is one window: its own
// base, one directory, real files, the real clock.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createFileSessionStore } from '../../src/host/backend/fileSessionStore'
import type { StoredSession } from '../../src/core/backends/modelapi/sessionStore'
import type { Logger } from '../../src/host/logger'
import { Usd } from '../../src/shared/usd'
import { removeFolder } from './helpers/temporaryFolders'

const root = mkdtempSync(path.join(tmpdir(), 'session-spend-'))
afterAll(async () => {
  await removeFolder(root)
})
const logged: string[] = []
const atLevel =
  (level: string) =>
  (message: string): void => {
    logged.push(`${level}:${message}`)
  }
const log: Logger = {
  trace: atLevel('trace'),
  info: atLevel('info'),
  warn: atLevel('warn'),
  error: atLevel('error'),
}
const sleep = () => Promise.resolve()
const storeIn = (directory: string) =>
  createFileSessionStore({
    directory,
    log,
    retentionDays: () => 0,
    now: Date.now,
    sleep,
  })

const session = (spend: string): StoredSession => ({
  version: 1,
  sessionId: 's1',
  workspaceRoot: '/ws',
  modelId: 'muse-spark-1.3',
  approvalMode: 'promptUnmatched',
  effort: 'high',
  createdAt: '2026-10-17T10:00:00.000Z',
  lastActivityAt: '2026-10-17T10:05:00.000Z',
  turnIds: [],
  todos: [],
  replay: [],
  transcript: [],
  outputs: {},
  usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
  budgetSpentUsd: Usd.from(spend).toAmount(),
})

describe('one session open in two windows', () => {
  it('keeps both spend increments instead of the larger snapshot', async () => {
    const directory = path.join(root, 'two-windows')
    const first = storeIn(directory)
    const second = storeIn(directory)
    await first.save(session('1'))
    // Each window opens the session at the same total, then spends apart.
    const beforeFirst = await first.load('s1')
    const beforeSecond = await second.load('s1')
    if (beforeFirst === undefined || beforeSecond === undefined)
      throw new Error('the session was not saved')
    // 1 + 2 in the first window, 1 + 4 in the second: the file holds 7.
    await first.save({ ...beforeFirst, budgetSpentUsd: Usd.from('3').toAmount() })
    await second.save({ ...beforeSecond, budgetSpentUsd: Usd.from('5').toAmount() })
    const merged = await first.load('s1')
    expect(merged?.budgetSpentUsd).toBe(Usd.from('7').toAmount())
  })

  it('keeps a window second increment after the merge instead of dropping it', async () => {
    const directory = path.join(root, 'two-windows-second')
    const first = storeIn(directory)
    const second = storeIn(directory)
    await first.save(session('1'))
    // Each window opens the session at the same total, then spends apart.
    const beforeFirst = await first.load('s1')
    const beforeSecond = await second.load('s1')
    if (beforeFirst === undefined || beforeSecond === undefined)
      throw new Error('the session was not saved')
    // 1 + 2 in the first window, 1 + 4 in the second: the file holds 7.
    await first.save({ ...beforeFirst, budgetSpentUsd: Usd.from('3').toAmount() })
    await second.save({ ...beforeSecond, budgetSpentUsd: Usd.from('5').toAmount() })
    // The second window spends $1 more from its own unmerged total of 5:
    // the file holds 8, not 7.
    await second.save({ ...beforeSecond, budgetSpentUsd: Usd.from('6').toAmount() })
    const kept = await first.load('s1')
    expect(kept?.budgetSpentUsd).toBe(Usd.from('8').toAmount())
  })

  it('a snapshot older than the file never lowers it', async () => {
    const directory = path.join(root, 'stale')
    const window = storeIn(directory)
    await window.save(session('7'))
    // A window that never opened the session saves an older figure.
    await storeIn(directory).save(session('2'))
    const kept = await window.load('s1')
    expect(kept?.budgetSpentUsd).toBe(Usd.from('7').toAmount())
  })
})
