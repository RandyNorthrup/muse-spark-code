import type * as Fs from 'node:fs/promises'
import { mkdtemp, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeFolder } from '../helpers/temporaryFolders'

const probe = vi.hoisted((): { failed: boolean; launches: string[]; reads: number } => ({
  failed: false,
  launches: [],
  reads: 0,
}))
vi.mock('node:child_process', () => ({
  execFile: (
    file: string,
    _args: readonly string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string) => void,
  ) => {
    probe.launches.push(file)
    let output = '134045712000000001:11111111-2222-3333-4444-555555555555'
    if (file.endsWith('sysctl')) output = '11111111-2222-3333-4444-555555555555'
    else if (file.endsWith('ps')) output = 'Sun Oct 11 12:00:00 2026'
    callback(probe.failed ? new Error('OS query unavailable') : null, output)
  },
}))
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof Fs>()
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      if (typeof args[0] === 'string' && args[0].startsWith('/proc/')) {
        probe.reads += 1
        if (probe.failed) throw new Error('proc unreadable')
      }
      return await actual.readFile(...args)
    },
  }
})
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await removeFolder(root)
})
async function fixture() {
  vi.resetModules()
  probe.failed = false
  probe.launches.length = 0
  probe.reads = 0
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'm109-evidence-'))
  roots.push(root)
  return { root, owners: await import('../../../src/core/locks/processOwner') }
}
describe('base-system owner evidence', () => {
  it('never makes exact birth depend on the macOS developer-tools shim', async () => {
    const source = await readFile(path.resolve('src/core/locks/processOwner.ts'), 'utf8')
    expect(source).not.toContain('/usr/bin/python3')
  })
  it('reads this process once without Python or a second Windows launch', async () => {
    const { root, owners } = await fixture()
    const [first, concurrent] = await Promise.all([
      owners.exactCurrentProcessOwner(root),
      owners.exactCurrentProcessOwner(root),
    ])
    expect(concurrent).toEqual(first)
    expect(first?.machineId).toMatch(/^[a-f0-9]{64}$/u)
    expect(first?.bootId).toBeTruthy()
    expect(first?.pidNamespace).toBeTruthy()
    const launches = probe.launches.length,
      reads = probe.reads
    expect(await owners.exactCurrentProcessOwner(root)).toEqual(first)
    expect(probe.launches.length).toBe(launches)
    expect(probe.reads).toBe(reads)
    expect(probe.launches.some((file) => file.includes('python'))).toBe(false)
    if (process.platform === 'win32') expect(launches).toBe(1)
    else if (process.platform === 'darwin')
      expect(probe.launches).toEqual(['/usr/sbin/sysctl', '/bin/ps'])
  })
  it('remembers failed evidence briefly and retries after its bounded cache expires', async () => {
    const { root, owners } = await fixture()
    probe.failed = true
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    expect(await owners.exactCurrentProcessOwner(root)).toBeUndefined()
    const attempts = probe.launches.length + probe.reads
    expect(attempts).toBeGreaterThan(0)
    expect(await owners.exactCurrentProcessOwner(root)).toBeUndefined()
    expect(probe.launches.length + probe.reads).toBe(attempts)
    now = 2001
    probe.failed = false
    expect(await owners.exactCurrentProcessOwner(root)).toMatchObject({ pid: process.pid })
    expect(probe.launches.length + probe.reads).toBeGreaterThan(attempts)
  })
})
