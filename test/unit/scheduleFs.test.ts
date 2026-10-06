import { mkdtempSync } from 'node:fs'
import * as disk from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as z from 'zod/mini'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import { createScheduleStore, scheduleStorageHash } from '../../src/core/schedules/store'
import {
  SCHEDULE_FS_RETRY_ATTEMPTS,
  SCHEDULE_JOURNAL_MAX_OPS,
  SCHEDULE_LEASE_EXPIRES_MS,
} from '../../src/shared/constants'
import { scheduleStateFile } from './helpers/schedules/storage'
import { fakeSchedule } from './helpers/schedules/fixtures'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof disk>()
  return {
    ...actual,
    link: vi.fn(actual.link),
    unlink: vi.fn(actual.unlink),
    rename: vi.fn(actual.rename),
  }
})
const root = mkdtempSync(path.join(tmpdir(), 'muse-m115-locks-'))
const exec = promisify(execFile)
const actualDisk = await vi.importActual<typeof disk>('node:fs/promises')
afterAll(() => removeFolder(root))
afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(disk.link).mockReset().mockImplementation(actualDisk.link)
  vi.mocked(disk.unlink).mockReset().mockImplementation(actualDisk.unlink)
  vi.mocked(disk.rename).mockReset().mockImplementation(actualDisk.rename)
})
function locked() {
  return Object.assign(new Error('injected lock'), { code: 'EPERM' })
}
async function handle(file: string, name: string) {
  // FileShare.Read allows committed bytes to remain readable while denying
  // rename/delete, matching Windows open-handle semantics without an AV claim.
  if (process.platform !== 'win32') {
    const opened = await disk.open(file, 'r')
    return async () => {
      await opened.close()
    }
  }
  const script = path.join(root, `${name}.ps1`)
  const ready = path.join(root, `${name}.ready`)
  const release = path.join(root, `${name}.release`)
  await disk.writeFile(
    script,
    `param($Target, $Ready, $Release)
$held = [IO.File]::Open($Target, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
  [IO.File]::WriteAllText($Ready, '')
  while (!(Test-Path -LiteralPath $Release)) { Start-Sleep -Milliseconds 20 }
} finally { $held.Dispose() }
`,
  )
  const systemRoot = process.env['SystemRoot']
  if (systemRoot === undefined) throw new Error('Windows system root missing')
  const worker = exec(
    path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      file,
      ready,
      release,
    ],
    { windowsHide: true, env: { SystemRoot: systemRoot } },
  )
  await Promise.race([
    vi.waitFor(() => disk.readFile(ready), { timeout: 120_000 }),
    (async () => {
      await worker
      throw new Error('Handle helper exited before release')
    })(),
  ])
  return async () => {
    await disk.writeFile(release, '')
    await worker
  }
}

describe('native schedule publication and leases', () => {
  it('retries transient publication errors and recognizes a committed destination after an error', async () => {
    const fs = createNodeScheduleFs(path.join(root, 'publication'))
    const original = actualDisk.link
    vi.mocked(disk.link).mockRejectedValueOnce(locked())
    expect(await fs.publish('data/first.json', 'first')).toBe(true)
    expect(disk.link).toHaveBeenCalledTimes(2)
    vi.mocked(disk.link).mockImplementationOnce(async (...args) => {
      await original(...args)
      throw locked()
    })
    expect(await fs.publish('data/second.json', 'second')).toBe(true)
    expect(await fs.read('data/second.json')).toBe('second')
    expect(await fs.publish('data/second.json', 'second')).toBe(false)
  })
  it('never reports a false publication failure after temporary cleanup is persistently locked', async () => {
    const directory = path.join(root, 'cleanup')
    const fs = createNodeScheduleFs(directory)
    const original = actualDisk.unlink
    vi.mocked(disk.unlink).mockImplementation(async (file) => {
      if (String(file).endsWith('.tmp')) throw locked()
      await original(file)
    })
    expect(await fs.publish('data/file.json', 'committed')).toBe(true)
    expect(await fs.read('data/file.json')).toBe('committed')
    const remaining = await disk.readdir(path.join(directory, 'data'))
    expect(remaining.some((name) => name.endsWith('.tmp'))).toBe(true)
    vi.mocked(disk.unlink).mockImplementation(original)
    await fs.publish('data/next.json', 'next')
    const cleaned = await disk.readdir(path.join(directory, 'data'))
    expect(cleaned.some((name) => name.endsWith('.tmp'))).toBe(false)
  })
  it('bounds persistent publication and activation errors while preserving the prior committed bytes', async () => {
    const fs = createNodeScheduleFs(path.join(root, 'persistent'))
    await fs.publish('data/current.json', 'old')
    vi.mocked(disk.link).mockClear().mockRejectedValue(locked())
    await expect(fs.publish('data/refused.json', 'new')).rejects.toThrow('injected lock')
    expect(disk.link).toHaveBeenCalledTimes(SCHEDULE_FS_RETRY_ATTEMPTS)
    vi.mocked(disk.rename).mockClear().mockRejectedValue(locked())
    await expect(fs.replace('data/current.json', 'new')).rejects.toThrow('injected lock')
    expect(disk.rename).toHaveBeenCalledTimes(SCHEDULE_FS_RETRY_ATTEMPTS)
    expect(await fs.read('data/current.json')).toBe('old')
  })
  it('retries transient release and takes over expired release debt from a living owner', async () => {
    const directory = path.join(root, 'release')
    const fs = createNodeScheduleFs(directory)
    const original = actualDisk.unlink
    const key = 'target:release'
    const file = path.join(directory, 'leases', `${scheduleStorageHash(key)}.json`)
    let failures = 1
    vi.mocked(disk.unlink).mockImplementation(async (input) => {
      if (String(input) === file && failures > 0) {
        failures -= 1
        throw locked()
      }
      await original(input)
    })
    expect(await fs.lock(key, () => Promise.resolve('done'))).toBe('done')
    expect(await fs.read(`leases/${scheduleStorageHash(key)}.json`)).toBeUndefined()
    failures = SCHEDULE_FS_RETRY_ATTEMPTS
    expect(await fs.lock(key, () => Promise.resolve('retained result'))).toBe('retained result')
    const bytes = await fs.read(`leases/${scheduleStorageHash(key)}.json`)
    const old = z
      .object({ pid: z.number(), heartbeat: z.number() })
      .parse(JSON.parse(bytes ?? 'null'))
    expect(old.pid).toBe(process.pid)
    vi.spyOn(Date, 'now').mockReturnValue(old.heartbeat + SCHEDULE_LEASE_EXPIRES_MS + 1)
    expect(await createNodeScheduleFs(directory).lock(key, () => Promise.resolve('repaired'))).toBe(
      'repaired',
    )
  })
  it('heartbeats a held lease and fences a paused owner after takeover', async () => {
    const directory = path.join(root, 'takeover')
    const fs = createNodeScheduleFs(directory)
    const key = 'writer'
    const file = `leases/${scheduleStorageHash(key)}.json`
    const entered = Promise.withResolvers<undefined>()
    const resumed = Promise.withResolvers<undefined>()
    const first = fs.lock(key, async (guard) => {
      entered.resolve(undefined)
      await resumed.promise
      await fs.replace('data/current.json', 'stale', guard)
    })
    await entered.promise
    const initial = z
      .object({ heartbeat: z.number() })
      .parse(JSON.parse((await fs.read(file)) ?? 'null'))
    await vi.waitFor(
      async () => {
        const current = z
          .object({ heartbeat: z.number() })
          .parse(JSON.parse((await fs.read(file)) ?? 'null'))
        expect(current.heartbeat).toBeGreaterThan(initial.heartbeat)
      },
      { timeout: 120_000 },
    )
    const bytes = await fs.read(file)
    await fs.replace(
      file,
      JSON.stringify({
        ...JSON.parse(bytes ?? 'null'),
        heartbeat: Date.now() - SCHEDULE_LEASE_EXPIRES_MS - 1,
      }),
    )
    await createNodeScheduleFs(directory).lock(key, async () => {
      await fs.replace('data/current.json', 'new owner')
    })
    resumed.resolve(undefined)
    await expect(first).rejects.toThrow('OwnershipLost')
    expect(await fs.read('data/current.json')).toBe('new owner')
  })
  it('keeps the old generation readable when a native Windows handle prevents pointer activation', async () => {
    const directory = path.join(root, 'native-pointer')
    const fs = createNodeScheduleFs(directory)
    const store = createScheduleStore(fs)
    const job = fakeSchedule()
    await store.create(job)
    for (let index = 0; index < SCHEDULE_JOURNAL_MAX_OPS - 1; index += 1) {
      const [current] = await store.list(job.workspaceKey)
      await store.update({ ...current!, name: `revision ${String(index)}` })
    }
    const [before] = await store.list(job.workspaceKey)
    const release = await handle(
      path.join(directory, job.workspaceKey, 'index/current.json'),
      'pointer',
    )
    try {
      if (process.platform === 'win32') {
        await expect(store.update({ ...before!, name: 'blocked' })).rejects.toMatchObject({
          code: 'EPERM',
        })
        expect(
          await createScheduleStore(createNodeScheduleFs(directory)).list(job.workspaceKey),
        ).toEqual([before])
      } else expect(await store.update({ ...before!, name: 'blocked' })).toBe(true)
    } finally {
      await release()
    }
    const [current] = await store.list(job.workspaceKey)
    expect(await store.update({ ...current!, name: 'activated after release' })).toBe(true)
  })
  it('activates a new generation while an old state handle blocks retirement and retires it on the next mutation', async () => {
    const directory = path.join(root, 'native-retirement')
    const fs = createNodeScheduleFs(directory)
    const store = createScheduleStore(fs)
    const job = fakeSchedule()
    await store.create(job)
    const old = await scheduleStateFile(fs)
    const release = await handle(path.join(directory, old), 'retirement')
    try {
      for (let index = 0; index <= SCHEDULE_JOURNAL_MAX_OPS; index += 1) {
        const [current] = await store.list(job.workspaceKey)
        expect(await store.update({ ...current!, name: `changed ${String(index)}` })).toBe(true)
      }
      expect(await scheduleStateFile(fs)).not.toBe(old)
      if (process.platform === 'win32') expect(await fs.read(old)).toBeDefined()
    } finally {
      await release()
    }
    const [current] = await store.list(job.workspaceKey)
    await store.update({ ...current!, name: 'retirement retried' })
    expect(await fs.read(old)).toBeUndefined()
  })
})
