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
    readFile: vi.fn(actual.readFile),
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
  vi.mocked(disk.readFile).mockReset().mockImplementation(actualDisk.readFile)
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
  it('retries transient lease reads and bounds persistent read failures', async () => {
    const fs = createNodeScheduleFs(path.join(root, 'read-retry'))
    await fs.publish('leases/read.json', 'committed lease')
    vi.mocked(disk.readFile).mockRejectedValueOnce(locked())
    expect(await fs.read('leases/read.json')).toBe('committed lease')
    expect(disk.readFile).toHaveBeenCalledTimes(2)
    vi.mocked(disk.readFile).mockReset().mockRejectedValue(locked())
    await expect(fs.read('leases/read.json')).rejects.toThrow('injected lock')
    expect(disk.readFile).toHaveBeenCalledTimes(SCHEDULE_FS_RETRY_ATTEMPTS)
  })
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
    vi.mocked(disk.link).mockImplementationOnce(async (...args) => {
      await original(...args)
      throw Object.assign(new Error('committed exclusive link'), { code: 'EEXIST' })
    })
    expect(await fs.publish('data/third.json', 'third')).toBe(true)
    vi.mocked(disk.rename).mockImplementationOnce(async (...args) => {
      await actualDisk.rename(...args)
      throw locked()
    })
    await fs.replace('data/second.json', 'replacement already committed')
    expect(await fs.read('data/second.json')).toBe('replacement already committed')
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
  it('retries acquisition when a competing release removes the destination during EEXIST identity checking', async () => {
    const directory = path.join(root, 'release-race')
    const fs = createNodeScheduleFs(directory)
    const file = `leases/${scheduleStorageHash('release-race')}.json`
    await fs.publish(
      file,
      JSON.stringify({
        pid: process.pid,
        start: 1,
        token: '11111111-1111-4111-8111-111111111111',
        heartbeat: Date.now(),
      }),
    )
    vi.mocked(disk.link).mockImplementationOnce(async (_source, destination) => {
      await actualDisk.unlink(destination)
      throw Object.assign(new Error('competing lease released'), { code: 'EEXIST' })
    })
    expect(await fs.lock('release-race', () => Promise.resolve('acquired'))).toBe('acquired')
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
      .object({ heartbeat: z.number(), token: z.string() })
      .parse(JSON.parse((await fs.read(file)) ?? 'null'))
    const pulseFile = `${file}.${initial.token}.heartbeat`
    await vi.waitFor(
      async () => {
        const current = z
          .object({ heartbeat: z.number() })
          .parse(JSON.parse((await fs.read(pulseFile)) ?? 'null'))
        expect(current.heartbeat).toBeGreaterThan(initial.heartbeat)
      },
      { timeout: 120_000 },
    )
    const bytes = await fs.read(pulseFile)
    await fs.replace(
      pulseFile,
      JSON.stringify({
        ...JSON.parse(bytes ?? 'null'),
        heartbeat: Date.now() - SCHEDULE_LEASE_EXPIRES_MS - 1,
      }),
    )
    await createNodeScheduleFs(directory).lock(key, async () => {
      await fs.replace('data/current.json', 'new owner')
      resumed.resolve(undefined)
      await expect(first).rejects.toThrow('OwnershipLost')
    })
    expect(await fs.read('data/current.json')).toBe('new owner')
  })
  it('refuses a stale takeover observation when the owner renews before removal', async () => {
    const directory = path.join(root, 'renewal')
    const fs = createNodeScheduleFs(directory)
    const file = `leases/${scheduleStorageHash('renewal')}.json`
    const owner = {
      pid: process.pid,
      start: 1,
      token: '11111111-1111-4111-8111-111111111111',
      heartbeat: Date.now() - SCHEDULE_LEASE_EXPIRES_MS - 1,
    }
    await fs.publish(file, JSON.stringify(owner))
    const pulse = `${file}.${owner.token}.heartbeat`
    const checked = Promise.withResolvers<undefined>()
    const main = path.join(directory, file)
    let removals = 0
    let isRenewed = false
    vi.mocked(disk.link).mockImplementation(async (...args) => {
      if (!isRenewed && String(args[1]).endsWith('.takeover')) {
        isRenewed = true
        await fs.replace(pulse, JSON.stringify({ ...owner, heartbeat: Date.now() }))
      }
      await actualDisk.link(...args)
    })
    vi.mocked(disk.unlink).mockImplementation(async (input) => {
      if (String(input) === main) {
        removals += 1
        throw new Error('renewed owner must not be removed')
      }
      await actualDisk.unlink(input)
      if (String(input).endsWith('.takeover')) checked.resolve(undefined)
    })
    const result = Promise.allSettled([
      fs.lock('renewal', () => Promise.resolve('acquired after release')),
    ])
    try {
      await checked.promise
      expect(removals).toBe(0)
      expect(await fs.read(file)).toBe(JSON.stringify(owner))
    } finally {
      await actualDisk.unlink(main)
      vi.mocked(disk.unlink).mockImplementation(actualDisk.unlink)
    }
    expect(await result).toEqual([{ status: 'fulfilled', value: 'acquired after release' }])
  })
  it('expires an unchanged live-owner heartbeat despite wall-clock rollback', async () => {
    const directory = path.join(root, 'rollback')
    const fs = createNodeScheduleFs(directory)
    const file = 'leases/' + scheduleStorageHash('rollback') + '.json'
    await fs.publish(
      file,
      JSON.stringify({
        pid: process.pid,
        start: 1,
        token: '11111111-1111-4111-8111-111111111111',
        heartbeat: Date.now() + SCHEDULE_LEASE_EXPIRES_MS,
      }),
    )
    const monotonic = vi
      .spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValue(SCHEDULE_LEASE_EXPIRES_MS + 1)
    expect(await fs.lock('rollback', () => Promise.resolve('recovered'))).toBe('recovered')
    expect(monotonic).toHaveBeenCalledTimes(2)
  })
  it('keeps a replacement lease authoritative when an old heartbeat rename was already in flight', async () => {
    const directory = path.join(root, 'heartbeat-race')
    const fs = createNodeScheduleFs(directory)
    const file = `leases/${scheduleStorageHash('heartbeat-race')}.json`
    const entered = Promise.withResolvers<undefined>()
    const resumeRename = Promise.withResolvers<undefined>()
    const resumeWork = Promise.withResolvers<undefined>()
    const original = actualDisk.rename
    vi.mocked(disk.rename).mockImplementationOnce(async (...args) => {
      entered.resolve(undefined)
      await resumeRename.promise
      await original(...args)
    })
    const old = fs.lock('heartbeat-race', async () => {
      await resumeWork.promise
    })
    const outcome = Promise.allSettled([old])
    await entered.promise
    const owner = z.object({ token: z.string() }).parse(JSON.parse((await fs.read(file)) ?? 'null'))
    const pulse = `${file}.${owner.token}.heartbeat`
    const bytes = await fs.read(file)
    await fs.publish(
      pulse,
      JSON.stringify({
        ...JSON.parse(bytes ?? 'null'),
        heartbeat: Date.now() - SCHEDULE_LEASE_EXPIRES_MS - 1,
      }),
    )
    try {
      await createNodeScheduleFs(directory).lock('heartbeat-race', async () => {
        const replacement = await fs.read(file)
        resumeRename.resolve(undefined)
        await vi.waitFor(async () => {
          const current = z
            .object({ heartbeat: z.number() })
            .parse(JSON.parse((await fs.read(pulse)) ?? 'null'))
          expect(current.heartbeat).toBeGreaterThan(Date.now() - SCHEDULE_LEASE_EXPIRES_MS)
        })
        expect(await fs.read(file)).toBe(replacement)
      })
    } finally {
      resumeRename.resolve(undefined)
      resumeWork.resolve(undefined)
    }
    const [result] = await outcome
    expect(result).toMatchObject({
      status: 'rejected',
      reason: { message: 'scheduleQueueOwnershipLost' },
    })
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
