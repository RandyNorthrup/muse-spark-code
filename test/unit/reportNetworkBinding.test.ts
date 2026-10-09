import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportingResponseCache } from '../../src/runtime/reporting/network'
import { REPORT_AS_OF } from './helpers/reporting/runtime'

// Report storage's own-process identity probe is a bounded OS command; on
// Windows and macOS it spawns (Linux reads /proc). Its governed admission is
// proved by spawnGovernance; here it runs directly.
vi.mock('../../src/core/resources/launcher', async (original) => {
  const { withFixtureCommand } = await import('./helpers/resources/fixtureLaunch')
  return withFixtureCommand(await original())
})

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})
describe('the owner-only report response cache binding', () => {
  it('shares one serialized cache and publishes validated entries outside the workspace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'report-cache-binding-'))
    folders.push(root)
    const cache = reportingResponseCache(root)
    expect(reportingResponseCache(root)).toBe(cache)
    const signal = new AbortController().signal
    const first = {
      key: 'a'.repeat(64),
      etag: 'fixture-etag',
      observedAt: REPORT_AS_OF,
      data: { rows: ['one'] },
    }
    const second = { ...first, key: 'b'.repeat(64), data: { rows: ['two'] } }
    await Promise.all([cache.set(first, signal), cache.set(second, signal)])
    expect(await cache.get(first.key, signal)).toEqual(first)
    expect(await cache.get(second.key, signal)).toEqual(second)
    const file = path.join(root, 'reports', 'v1', 'cache', 'index.json')
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([first, second])
    const info = await stat(file)
    if (process.platform !== 'win32') expect(info.mode & 0o777).toBe(0o600)
  })
  it('honors cancellation before storage creation and rejects malformed cached entries', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'report-cache-cancel-'))
    folders.push(root)
    const cache = reportingResponseCache(root)
    const stopped = AbortSignal.abort(new Error('Cancelled fixture'))
    await expect(cache.get('a'.repeat(64), stopped)).rejects.toThrow('Cancelled fixture')
    await expect(
      cache.set(
        { key: 'invalid', etag: null, observedAt: REPORT_AS_OF, data: [] },
        new AbortController().signal,
      ),
    ).rejects.toThrow()
  })
})
