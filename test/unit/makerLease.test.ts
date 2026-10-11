import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  claimHardwareLease as claimLease,
  serialLeaseResource,
  didStopHardwareLease,
  stopAllHardwareLeases,
  stopHardwareLease,
  type HardwareLeaseRecord,
} from '../../src/core/maker/lease'
import {
  makerLeaseDeps,
  makerProcessDeps,
  makerNativeHelper,
  isTestProcessAlive,
} from './helpers/makerSerial'
import { startSerialProcess } from '../../src/core/maker/serial/process'
import { MAKER_LEASE_SOCKET_NAME_CHARS } from '../../src/shared/constants'
import {
  listenNativeOwnerPipe,
  withNativeLeaseMutex,
} from '../../src/core/maker/serial/nativeLease'

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof FsPromises>()
  return {
    ...fs,
    open: vi.fn(fs.open),
    link: vi.fn(fs.link),
    unlink: vi.fn(fs.unlink),
    lstat: vi.fn(fs.lstat),
  }
})

const directories: string[] = []
const releases: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.allSettled(releases.splice(0).map((release) => release()))
  const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
  vi.mocked(open).mockImplementation(fs.open)
  vi.mocked(link).mockImplementation(fs.link)
  vi.mocked(unlink).mockImplementation(fs.unlink)
  vi.mocked(lstat).mockImplementation(fs.lstat)
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

async function claimHardwareLease(...args: Parameters<typeof claimLease>) {
  const result = await claimLease(...args)
  if (result.status === 'acquired') releases.push(result.release)
  return result
}

async function fixture() {
  const directory = await mkdtemp(
    path.join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'm103-lease-'),
  )
  directories.push(directory)
  return await makerLeaseDeps(directory)
}

function generationFile(directory: string, record: HardwareLeaseRecord) {
  return path.join(
    directory,
    `claim-v1.${createHash('sha256').update(record.resource).digest('hex')}.${record.id}.${record.generation}.json`,
  )
}

async function claim(
  deps: Awaited<ReturnType<typeof fixture>>,
  resource = 'port:test',
  stop = () => Promise.resolve(),
) {
  const result = await claimHardwareLease(deps, resource, 'owner', stop)
  if (result.status !== 'acquired') throw new Error('test-claim')
  return result
}

function claimBarrier() {
  return {
    entered: Promise.withResolvers<undefined>(),
    resume: Promise.withResolvers<undefined>(),
  }
}

describe('hardware lease', () => {
  it('cancels a preparing contender before it can publish an empty claim slot', async () => {
    const deps = await fixture()
    const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
    const { entered, resume } = claimBarrier()
    vi.mocked(lstat).mockImplementation(async (file) => {
      if (String(file).endsWith('.head.claim')) {
        entered.resolve(undefined)
        await resume.promise
      }
      return await fs.lstat(file)
    })
    const stop = vi.fn(() => Promise.resolve())
    const preparing = claimHardwareLease(deps, 'port:test', 'contender', stop)
    try {
      await entered.promise
      expect(await stopHardwareLease(deps, 'port:test')).toMatchObject({
        stopped: false,
        sessions: [{ party: 'contender', status: 'cancelled' }],
      })
      expect(stop).toHaveBeenCalledTimes(1)
      resume.resolve(undefined)
      expect(await preparing).toEqual({ status: 'cancelled' })
      const entries = await readdir(deps.directory)
      expect(entries.some((entry) => entry.endsWith('.claim'))).toBe(false)
      const retry = await claim(deps)
      await retry.release()
    } finally {
      resume.resolve(undefined)
      await preparing
    }
  })

  it('retires an unpublished generation before failed Stop-index cleanup with its process still alive', async () => {
    const deps = await fixture()
    const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
    vi.mocked(link).mockImplementation(async (source, target) => {
      if (String(target).endsWith('.head.claim')) throw new Error('test-publication-failed')
      await fs.link(source, target)
    })
    vi.mocked(unlink).mockImplementation(async (file) => {
      const name = path.basename(String(file).replaceAll('\\', '/'))
      if (name.startsWith('stop-v1.') && name.endsWith('.json'))
        throw new Error('test-stop-cleanup-failed')
      await fs.unlink(file)
    })
    await expect(claim(deps)).rejects.toThrow('test-stop-cleanup-failed')
    vi.mocked(link).mockImplementation(fs.link)
    vi.mocked(unlink).mockImplementation(fs.unlink)
    const active = await claim(deps)
    const result = await stopHardwareLease(deps, 'port:test')
    expect(result.stopped).toBe(true)
    expect(result.sessions).toEqual([{ record: active.record, party: 'holder', status: 'stopped' }])
    await active.release()
  })

  it('waits for in-flight publication before classifying Stop as holder or contender', async () => {
    const deps = await fixture()
    const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
    const { entered, resume } = claimBarrier()
    vi.mocked(link).mockImplementation(async (source, target) => {
      await fs.link(source, target)
      if (!String(target).endsWith('.head.claim')) return
      entered.resolve(undefined)
      await resume.promise
    })
    const stop = vi.fn(() => Promise.resolve())
    const publishing = claimHardwareLease(deps, 'port:test', 'holder', stop)
    let stopping: ReturnType<typeof stopHardwareLease> | undefined
    try {
      await entered.promise
      let hasSettled = false
      stopping = stopHardwareLease(deps, 'port:test')
      void stopping.then(() => {
        hasSettled = true
      })
      await delay(100)
      expect(hasSettled).toBe(false)
      resume.resolve(undefined)
      const acquired = await publishing
      expect(acquired.status).toBe('acquired')
      expect(await stopping).toMatchObject({
        stopped: true,
        sessions: [{ party: 'holder', status: 'stopped' }],
      })
      expect(stop).toHaveBeenCalledTimes(1)
    } finally {
      resume.resolve(undefined)
      await publishing
      await stopping
    }
  })

  it('publishes one complete fsynced record and never calls a failing advisory mutex', async () => {
    const deps = await fixture()
    const exclusive = vi.fn(() => Promise.reject(new Error('test-cleanup-mutex-unavailable')))
    const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
    const synced = new Set<string>()
    vi.mocked(open).mockImplementation(async (file, flags, mode) => {
      const handle = await fs.open(file, flags, mode)
      const sync = handle.sync.bind(handle)
      vi.spyOn(handle, 'sync').mockImplementation(async () => {
        await sync()
        synced.add(String(file))
      })
      return handle
    })
    vi.mocked(link).mockImplementation(async (source, target) => {
      expect(synced.has(String(source))).toBe(true)
      expect(JSON.parse(await readFile(source, 'utf8'))).toMatchObject({
        pid: process.pid,
        startedAt: expect.any(String),
      })
      await fs.link(source, target)
    })
    const result = await claim({ ...deps, exclusive })
    await result.release()
    await result.release()
    expect(exclusive).not.toHaveBeenCalled()
  })

  it.each([
    'create',
    'write',
    'sync',
    'close',
    'endpoint',
    'stop-create',
    'stop-write',
    'stop-sync',
    'stop-close',
    'stop-publish',
    'stop-temp-cleanup',
    'claim-publish',
  ])('cleans failed %s preparation without stranding a live parent', async (fault) => {
    const deps = await fixture()
    const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
    const exclusive = vi.fn(() => Promise.reject(new Error('test-cleanup-mutex-unavailable')))
    const failure = new Error(`test-${fault}`)
    let count = 0
    vi.mocked(open).mockImplementation(async (file, flags, mode) => {
      const isStop = String(file).endsWith('.preparing')
      if ((fault === 'create' && !isStop) || (fault === 'stop-create' && isStop)) throw failure
      const handle = await fs.open(file, flags, mode)
      const prefix = isStop ? 'stop-' : ''
      switch (fault) {
        case `${prefix}write`: {
          const write = handle.writeFile.bind(handle)
          vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
            await write('{')
            throw failure
          })

          break
        }
        case `${prefix}sync`: {
          vi.spyOn(handle, 'sync').mockRejectedValueOnce(failure)
          break
        }
        case `${prefix}close`: {
          const close = handle.close.bind(handle)
          vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
            await close()
            throw failure
          })

          break
        }
        // No default
      }
      return handle
    })
    vi.mocked(link).mockImplementation(async (source, target) => {
      count += 1
      if ((fault === 'stop-publish' && count === 1) || (fault === 'claim-publish' && count === 2))
        throw failure
      await fs.link(source, target)
    })
    if (fault === 'stop-temp-cleanup') vi.mocked(unlink).mockRejectedValueOnce(failure)
    const failingDeps =
      fault === 'endpoint'
        ? {
            ...deps,
            platform: 'win32' as const,
            isOwnerDirectory: () => Promise.resolve(true),
            listenOwnerPipe: () => Promise.reject(failure),
          }
        : deps
    await expect(claim({ ...failingDeps, exclusive })).rejects.toThrow(failure.message)
    vi.restoreAllMocks()
    vi.mocked(open).mockImplementation(fs.open)
    vi.mocked(link).mockImplementation(fs.link)
    expect(exclusive).not.toHaveBeenCalled()
    const entries = await readdir(deps.directory)
    expect(
      entries.filter((name) => name.endsWith('.json') && !name.startsWith('retired-v1.')),
    ).toEqual([])
    const retry = await claim(deps)
    await retry.release()
  })

  it('preserves a pre-existing generation when exclusive create fails', async () => {
    const deps = await fixture()
    const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
    let existing: string | undefined
    vi.mocked(open).mockImplementationOnce(async (file, flags, mode) => {
      expect(flags).toBe('wx')
      existing = String(file)
      await writeFile(file, 'existing generation', { mode })
      throw Object.assign(new Error('test-existing-generation'), { code: 'EEXIST' })
    })
    await expect(claim(deps)).rejects.toThrow('test-existing-generation')
    if (existing === undefined) throw new Error('test-existing-path')
    expect(await readFile(existing, 'utf8')).toBe('existing generation')
    vi.mocked(open).mockImplementation(fs.open)
    const retry = await claim(deps)
    await retry.release()
  })

  it.each([true, false])(
    'treats Windows delete-pending EPERM as done only after absence is proved (%s)',
    async (isAbsent) => {
      const deps = await fixture()
      const active = await claim(deps)
      const file = generationFile(deps.directory, active.record)
      const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
      if (isAbsent) await fs.unlink(file)
      vi.mocked(unlink).mockRejectedValueOnce(
        Object.assign(new Error('test-delete-pending'), { code: 'EPERM' }),
      )
      if (isAbsent) await active.release()
      else await expect(active.release()).rejects.toMatchObject({ code: 'EPERM' })
      await active.release()
      const retry = await claim(deps)
      await retry.release()
    },
  )

  it('keeps partial preparation invisible to concurrent claims and Stop', async () => {
    const deps = await fixture()
    const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
    const entered = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    vi.mocked(open).mockImplementationOnce(async (file, flags, mode) => {
      const handle = await fs.open(file, flags, mode)
      const write = handle.writeFile.bind(handle)
      vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
        await write('{')
        entered.resolve(undefined)
        await resume.promise
        throw new Error('test-partial-write')
      })
      return handle
    })
    const failed = claim(deps)
    const rejected = expect(failed).rejects.toThrow('test-partial-write')
    let winner: Awaited<ReturnType<typeof claim>> | undefined
    try {
      await entered.promise
      winner = await claim(deps)
      expect(await didStopHardwareLease(deps, 'port:test')).toBe(true)
      resume.resolve(undefined)
      await rejected
      const third = await claimHardwareLease(deps, 'port:test', 'third', () => Promise.resolve())
      expect(third.status).toBe('busy')
    } finally {
      resume.resolve(undefined)
      await rejected
      await winner?.release()
    }
  })

  it('drains pending preparation before rejecting and cleans it even if its endpoint close fails', async () => {
    const deps = await fixture()
    const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
    const entered = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    const close = vi.fn(() => Promise.reject(new Error('test-close-failed')))
    vi.mocked(link).mockImplementationOnce(async () => {
      entered.resolve(undefined)
      await resume.promise
      throw new Error('test-publish-failed')
    })
    let isSettled = false
    const failed = (async () => {
      try {
        return await claim({
          ...deps,
          platform: 'win32',
          isOwnerDirectory: () => Promise.resolve(true),
          listenOwnerPipe: () => Promise.resolve(close),
        })
      } finally {
        isSettled = true
      }
    })()
    const rejected = expect(failed).rejects.toThrow('test-close-failed')
    await entered.promise
    await delay(100)
    expect(isSettled).toBe(false)
    expect(close).not.toHaveBeenCalled()
    resume.resolve(undefined)
    await rejected
    vi.mocked(link).mockImplementation(fs.link)
    const retry = await claim(deps)
    await retry.release()
  })

  it('preserves the winner when a previously submitted stale unlink resumes after another cleaner claims', async () => {
    const deps = await fixture()
    const first = await claim(deps)
    const oldFile = generationFile(deps.directory, first.record)
    const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
    const entered = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    let isDelayed = false
    vi.mocked(unlink).mockImplementation(async (file) => {
      if (file === oldFile && !isDelayed) {
        isDelayed = true
        entered.resolve(undefined)
        await resume.promise
      }
      await fs.unlink(file)
    })
    const start = deps.processStartTime
    const staleDeps = {
      ...deps,
      processStartTime: async (pid: number) =>
        pid === first.record.pid ? `${String(await start(pid))}-reused` : await start(pid),
    }
    const losing = claimHardwareLease(staleDeps, 'port:test', 'slow cleaner', () =>
      Promise.resolve(),
    )
    let winner: Awaited<ReturnType<typeof claim>> | undefined
    try {
      await entered.promise
      winner = await claim(staleDeps)
      resume.resolve(undefined)
      const result = await losing
      expect(result).toEqual({ status: 'busy', holder: winner.record })
      expect(await readFile(generationFile(deps.directory, winner.record), 'utf8')).toBe(
        JSON.stringify(winner.record),
      )
      // The former release handle also addresses only its immutable generation.
      await first.release()
      const third = await claimHardwareLease(staleDeps, 'port:test', 'third', () =>
        Promise.resolve(),
      )
      expect(third).toEqual({ status: 'busy', holder: winner.record })
    } finally {
      resume.resolve(undefined)
      await first.release()
      await winner?.release()
    }
  })

  it.each(Array.from({ length: 5 }, (_, index) => index))(
    'admits exactly one claimant in concurrent real-file race %s',
    async (round) => {
      const deps = await fixture()
      const resource = `port:race-${String(round)}`
      const head = path.join(
        deps.directory,
        `claim-v1.${createHash('sha256').update(resource).digest('hex')}.head.claim`,
      )
      const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
      const sampled = Promise.withResolvers<undefined>()
      let readers = 0
      vi.mocked(lstat).mockImplementation(async (file) => {
        try {
          return await fs.lstat(file)
        } catch (error: unknown) {
          if (file === head && readers < 12) {
            readers += 1
            if (readers === 12) sampled.resolve(undefined)
            await sampled.promise
          }
          throw error
        }
      })
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          claimHardwareLease(deps, resource, `holder-${String(index)}`, () => Promise.resolve()),
        ),
      )
      const winners = results.filter((result) => result.status === 'acquired')
      try {
        expect(winners).toHaveLength(1)
        for (const result of results)
          if (result.status === 'busy') expect(result.holder).toEqual(winners[0]?.record)
      } finally {
        await Promise.all(winners.map((winner) => winner.release()))
      }
    },
  )

  it('handles concurrent stale cleaners and repeated release without reusing a claim slot', async () => {
    const deps = await fixture()
    const previous = await claim(deps)
    const staleDeps = { ...deps, processStartTime: () => Promise.resolve('different-start') }
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        claimHardwareLease(staleDeps, 'port:test', 'cleaner', () => Promise.resolve()),
      ),
    )
    const winners = results.filter((result) => result.status === 'acquired')
    expect(winners).toHaveLength(1)
    await previous.release()
    await previous.release()
    await Promise.all(winners.map((winner) => winner.release()))
    const retry = await claim(deps)
    const entries = await readdir(deps.directory)
    const slots = entries.filter((name) => name.endsWith('.claim'))
    expect(slots).toHaveLength(3)
    await retry.release()
  })

  it('distinguishes PID reuse and holds a lease when its start identity cannot be queried', async () => {
    const deps = await fixture()
    const previous = await claim(deps)
    const replacement = await claim({
      ...deps,
      processStartTime: () => Promise.resolve('replacement'),
    })
    await previous.release()
    let queries = 0
    const unknown = {
      ...deps,
      processStartTime: () => {
        queries += 1
        return queries === 1
          ? Promise.resolve('replacement')
          : Promise.reject(new Error('test-query-denied'))
      },
    }
    try {
      expect(
        await claimHardwareLease(unknown, 'port:test', 'third', () => Promise.resolve()),
      ).toEqual({ status: 'busy', holder: replacement.record })
    } finally {
      await replacement.release()
    }
  })

  it('treats corrupt claim records as held by unknown and still stops the active session', async () => {
    const deps = await fixture()
    const stop = vi.fn(() => Promise.resolve())
    const active = await claimHardwareLease(deps, 'port:test', 'active', stop)
    if (active.status !== 'acquired') throw new Error('test-claim')
    const slot = path.join(
      deps.directory,
      `claim-v1.${createHash('sha256').update('port:test').digest('hex')}.head.claim`,
    )
    const bytes = await readFile(slot)
    try {
      await writeFile(slot, '{')
      expect(await claimHardwareLease(deps, 'port:test', 'third', () => Promise.resolve())).toEqual(
        { status: 'busy' },
      )
      expect(await didStopHardwareLease(deps, 'port:test')).toBe(true)
      expect(stop).toHaveBeenCalledTimes(1)
    } finally {
      await writeFile(slot, bytes)
      await active.release()
    }
  })

  it('refuses release of another generation and accepts an already removed record', async () => {
    const deps = await fixture()
    const active = await claim(deps)
    const file = generationFile(deps.directory, active.record)
    await writeFile(file, JSON.stringify({ ...active.record, generation: randomUUID() }))
    await expect(active.release()).rejects.toThrow('lease-holder-changed')
    await unlink(file)
    await active.release()
    await active.release()
  })

  it('holds an unknown generation mismatch without treating its missing marker as release', async () => {
    const deps = await fixture()
    const active = await claim(deps)
    const file = generationFile(deps.directory, active.record)
    const saved = await readFile(file)
    try {
      await writeFile(file, JSON.stringify({ ...active.record, generation: randomUUID() }))
      expect(await claimHardwareLease(deps, 'port:test', 'third', () => Promise.resolve())).toEqual(
        {
          status: 'busy',
        },
      )
      expect(await didStopHardwareLease(deps, 'port:test')).toBe(true)
    } finally {
      await writeFile(file, saved)
      await active.release()
    }
  })

  it('reclaims a retired generation after release unlink fails with its parent still alive', async () => {
    const deps = await fixture()
    const active = await claim(deps)
    const file = generationFile(deps.directory, active.record)
    const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
    vi.mocked(unlink).mockImplementationOnce(() => Promise.reject(new Error('test-release-unlink')))
    await expect(active.release()).rejects.toThrow('test-release-unlink')
    expect(await readFile(file, 'utf8')).toBe(JSON.stringify(active.record))
    vi.mocked(unlink).mockImplementation(fs.unlink)
    const replacement = await claim(deps)
    await active.release()
    expect(await readFile(generationFile(deps.directory, replacement.record), 'utf8')).toBe(
      JSON.stringify(replacement.record),
    )
    await replacement.release()
  })

  it.each(['claim', 'stop'])(
    'cleans a matching retirement receipt after %s-index unlink fails without retrying the old handle',
    async (kind) => {
      const deps = await fixture()
      const active = await claim(deps)
      const marker = generationFile(deps.directory, active.record)
      const stopFile = marker.replace('claim-v1.', 'stop-v1.')
      const failedFile = kind === 'claim' ? marker : stopFile
      const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
      vi.mocked(unlink).mockImplementation(async (file) => {
        if (String(file).replaceAll('\\', '/') === failedFile.replaceAll('\\', '/'))
          throw new Error('test-retired-cleanup')
        await fs.unlink(file)
      })
      await expect(active.release()).rejects.toThrow('test-retired-cleanup')
      expect(await readFile(marker.replace('claim-v1.', 'retired-v1.'), 'utf8')).toBe(
        JSON.stringify(active.record),
      )
      if (kind === 'claim') await expect(lstat(stopFile)).rejects.toHaveProperty('code', 'ENOENT')
      vi.mocked(unlink).mockImplementation(fs.unlink)
      const stop = vi.fn(() => Promise.resolve())
      const replacement = await claimHardwareLease(deps, 'port:test', 'replacement', stop)
      if (replacement.status !== 'acquired') throw new Error('test-replacement-claim')
      await expect(lstat(marker)).rejects.toHaveProperty('code', 'ENOENT')
      await expect(lstat(stopFile)).rejects.toHaveProperty('code', 'ENOENT')
      expect(await stopHardwareLease(deps, 'port:test')).toMatchObject({
        stopped: true,
        sessions: [{ record: replacement.record, party: 'holder', status: 'stopped' }],
      })
      expect(stop).toHaveBeenCalledTimes(1)
      await replacement.release()
    },
  )

  it('serializes concurrent release through one retirement and cleanup transition', async () => {
    const deps = await fixture()
    const active = await claim(deps)
    const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
    const entered = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    vi.mocked(link).mockClear()
    vi.mocked(unlink).mockClear()
    vi.mocked(link).mockImplementationOnce(async (source, target) => {
      entered.resolve(undefined)
      await resume.promise
      await fs.link(source, target)
    })
    const first = active.release()
    try {
      await Promise.race([
        entered.promise,
        (async () => {
          await first
          throw new Error('test-retirement-published-without-barrier')
        })(),
      ])
      const second = active.release()
      expect(vi.mocked(link)).toHaveBeenCalledTimes(1)
      resume.resolve(undefined)
      await Promise.all([first, second])
      expect(vi.mocked(link)).toHaveBeenCalledTimes(1)
      const removed = vi.mocked(unlink).mock.calls.map(([file]) => String(file))
      const marker = generationFile(deps.directory, active.record)
      expect(removed.filter((file) => file === marker)).toHaveLength(1)
      expect(
        removed.filter((file) => file === marker.replace('claim-v1.', 'stop-v1.')),
      ).toHaveLength(1)
      const retry = await claim(deps)
      await retry.release()
    } finally {
      resume.resolve(undefined)
      await Promise.allSettled([first, active.release()])
    }
  })

  it('holds an unknown retirement receipt instead of skipping its active holder', async () => {
    const deps = await fixture()
    const active = await claim(deps)
    const receipt = generationFile(deps.directory, active.record).replace(
      'claim-v1.',
      'retired-v1.',
    )
    await writeFile(receipt, JSON.stringify({ ...active.record, id: randomUUID() }))
    try {
      expect(await claimHardwareLease(deps, 'port:test', 'third', () => Promise.resolve())).toEqual(
        {
          status: 'busy',
        },
      )
      await expect(active.release()).rejects.toThrow('lease-retirement-changed')
      await expect(lstat(generationFile(deps.directory, active.record))).rejects.toHaveProperty(
        'code',
        'ENOENT',
      )
      await expect(
        lstat(generationFile(deps.directory, active.record).replace('claim-v1.', 'stop-v1.')),
      ).rejects.toHaveProperty('code', 'ENOENT')
    } finally {
      await unlink(receipt)
      await active.release()
    }
  })

  it('retries retirement publication failure from its immutable slot after cleaning the generation', async () => {
    const deps = await fixture()
    const active = await claim(deps)
    const file = generationFile(deps.directory, active.record)
    vi.mocked(link).mockRejectedValueOnce(new Error('test-retirement-link'))
    await expect(active.release()).rejects.toThrow('test-retirement-link')
    await expect(lstat(file)).rejects.toHaveProperty('code', 'ENOENT')
    await expect(lstat(file.replace('claim-v1.', 'stop-v1.'))).rejects.toHaveProperty(
      'code',
      'ENOENT',
    )
    const slot = path.join(
      deps.directory,
      `claim-v1.${createHash('sha256').update(active.record.resource).digest('hex')}.head.claim`,
    )
    expect(await readFile(slot, 'utf8')).toBe(JSON.stringify(active.record))
    const busy = await claimHardwareLease(deps, 'port:test', 'third', () => Promise.resolve())
    expect(busy.status).toBe('busy')
    await active.release()
    const retry = await claim(deps)
    await retry.release()
  })

  it.each(['absent', 'reused', 'retired', 'cleanup-failure', 'unknown', 'live'])(
    'dispatches current Stop directly while classifying a %s orphan index',
    async (kind) => {
      const deps = await fixture()
      const dispatched = Promise.withResolvers<undefined>()
      const stop = vi.fn(() => {
        dispatched.resolve(undefined)
        return Promise.resolve()
      })
      const active = await claimHardwareLease(deps, 'port:test', 'active', stop)
      if (active.status !== 'acquired') throw new Error('test-active-claim')
      const id = randomUUID()
      const orphan = {
        ...active.record,
        id,
        generation: randomUUID(),
        startedAt: 'orphan-start',
        endpoint:
          deps.platform === 'win32'
            ? String.raw`\\.\pipe\MuseSparkSerial-${id}`
            : path.join(deps.directory, `${id.slice(0, MAKER_LEASE_SOCKET_NAME_CHARS)}.sock`),
      }
      const orphanFile = generationFile(deps.directory, orphan).replace('claim-v1.', 'stop-v1.')
      await writeFile(orphanFile, JSON.stringify(orphan))
      if (kind === 'retired')
        await writeFile(orphanFile.replace('stop-v1.', 'retired-v1.'), JSON.stringify(orphan))
      // Broken admission history cannot hide the directly indexed current endpoint.
      const slot = path.join(
        deps.directory,
        `claim-v1.${createHash('sha256').update('port:test').digest('hex')}.head.claim`,
      )
      const saved = await readFile(slot)
      await writeFile(slot, '{')
      const identity = vi.fn(async () => {
        await dispatched.promise
        expect(stop).toHaveBeenCalled()
        if (kind === 'unknown') throw new Error('test-query-denied')
        if (kind === 'live') return orphan.startedAt
        if (kind === 'reused') return 'new-start'
        return
      })
      const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
      if (kind === 'cleanup-failure')
        vi.mocked(unlink).mockImplementation(async (file) => {
          if (String(file).replaceAll('\\', '/') === orphanFile.replaceAll('\\', '/'))
            throw new Error('test-orphan-unlink')
          await fs.unlink(file)
        })
      try {
        const result = await stopHardwareLease({ ...deps, processStartTime: identity }, 'port:test')
        expect(stop).toHaveBeenCalledTimes(1)
        const isUnknown = kind === 'unknown' || kind === 'live'
        expect(result.stopped).toBe(!isUnknown)
        expect(result.sessions).toHaveLength(isUnknown ? 2 : 1)
        expect(result.sessions).toContainEqual({
          record: active.record,
          party: 'holder',
          status: 'stopped',
        })
        if (isUnknown)
          expect(result.sessions).toContainEqual({
            record: orphan,
            party: 'unknown',
            status: 'failed',
            reason: 'lease-stop-unavailable',
          })
        if (kind === 'retired') expect(identity).not.toHaveBeenCalled()
        else expect(identity).toHaveBeenCalledTimes(1)
        if (!isUnknown && kind !== 'cleanup-failure')
          await expect(lstat(orphanFile)).rejects.toHaveProperty('code', 'ENOENT')
        if (kind === 'cleanup-failure') {
          const retry = await stopHardwareLease(
            { ...deps, processStartTime: identity },
            'port:test',
          )
          expect(retry.stopped).toBe(true)
        }
      } finally {
        vi.mocked(unlink).mockImplementation(fs.unlink)
        await writeFile(slot, saved)
        await active.release()
      }
    },
  )

  it('never follows malformed, oversized, foreign or generation-mismatched Stop index entries', async () => {
    const deps = await fixture()
    const active = await claim(deps)
    const folder = deps.directory
    const prefix = `stop-v1.${createHash('sha256').update('port:test').digest('hex')}.`
    await writeFile(
      path.join(folder, `${prefix}foreign.json`),
      JSON.stringify({ ...active.record, endpoint: 'foreign' }),
    )
    await writeFile(path.join(folder, `${prefix}mismatched.json`), JSON.stringify(active.record))
    try {
      // Copies of the owner Stop reached are not other owners.
      expect(await didStopHardwareLease(deps, 'port:test')).toBe(true)
      // FIXM103W11: an unreadable entry may be an owner Stop cannot reach, so Stop is unconfirmed.
      await writeFile(path.join(folder, `${prefix}corrupt.json`), '{')
      await writeFile(path.join(folder, `${prefix}large.json`), 'x'.repeat(8192))
      const unreadable = {
        party: 'unknown',
        status: 'failed',
        reason: 'lease-stop-unrecognized',
        record: null,
      }
      expect(await stopHardwareLease(deps, 'port:test')).toEqual({
        stopped: false,
        sessions: [
          { record: active.record, party: 'holder', status: 'stopped' },
          unreadable,
          unreadable,
        ],
      })
      await expect(stopAllHardwareLeases(deps)).rejects.toThrow('lease-stop-failed')
    } finally {
      await active.release()
    }
  })

  it('RVM103W5 P1 an unreadable Stop index entry alone leaves stop-all unconfirmed', async () => {
    const deps = await fixture()
    const key = createHash('sha256').update('port:unreadable').digest('hex')
    // No other record names this resource, so only the entry itself can report it.
    await writeFile(path.join(deps.directory, `stop-v1.${key}.corrupt.json`), '{')
    await expect(stopAllHardwareLeases(deps)).rejects.toThrow('lease-stop-failed')
  })

  it.each(['native', 'posix'])(
    'RVM103W6 P1: a renamed live Stop index is unconfirmed with %s scan semantics',
    async (semantics) => {
      const deps = await fixture()
      const stop = vi.fn(() => Promise.resolve())
      const active = await claimHardwareLease(deps, 'port:actual', 'owner', stop)
      if (active.status !== 'acquired') throw new Error('test-claim')
      const claimFile = generationFile(deps.directory, active.record)
      const renamed = generationFile(deps.directory, {
        ...active.record,
        resource: 'port:other',
      }).replace('claim-v1.', 'stop-v1.')
      await rename(claimFile.replace('claim-v1.', 'stop-v1.'), renamed)
      // Keep the production claim, live endpoint and PID/start identity intact.
      expect(await readFile(claimFile, 'utf8')).toBe(JSON.stringify(active.record))
      expect(await deps.processStartTime(active.record.pid)).toBe(active.record.startedAt)
      if (semantics === 'posix') {
        // Windows has no POSIX uid/mode; adapt only directory metadata at this seam.
        const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
        const getUserId = process.getuid
        vi.mocked(lstat).mockImplementation(async (file) => {
          const stat = await fs.lstat(file)
          if (String(file).replaceAll('\\', '/') === deps.directory.replaceAll('\\', '/'))
            Object.defineProperties(stat, {
              uid: { value: getUserId?.() },
              mode: { value: 0o4_0700 },
            })
          return stat
        })
      }
      const scan = semantics === 'posix' ? { ...deps, platform: 'linux' as const } : deps
      await expect(stopAllHardwareLeases(scan)).rejects.toThrow('lease-stop-failed')
      expect(await stopHardwareLease(scan, 'port:actual')).toEqual({
        stopped: false,
        sessions: [
          {
            record: active.record,
            party: 'unknown',
            status: 'failed',
            reason: 'lease-stop-unrecognized',
          },
        ],
      })
      expect(stop).not.toHaveBeenCalled()
      expect(await readFile(renamed, 'utf8')).toBe(JSON.stringify(active.record))
    },
  )

  it.each(['live', 'unknown'])(
    'RVM103W6 P1: still contacts recognised owners alongside a renamed %s owner',
    async (identity) => {
      const deps = await fixture()
      const missed = vi.fn(() => Promise.resolve())
      const reached = vi.fn(() => Promise.resolve())
      const active = await claimHardwareLease(deps, 'port:actual', 'owner', missed)
      if (active.status !== 'acquired') throw new Error('test-claim')
      await claimHardwareLease(deps, 'port:recognised', 'other owner', reached)
      await rename(
        generationFile(deps.directory, active.record).replace('claim-v1.', 'stop-v1.'),
        generationFile(deps.directory, { ...active.record, resource: 'port:other' }).replace(
          'claim-v1.',
          'stop-v1.',
        ),
      )
      const scan =
        identity === 'unknown'
          ? {
              ...deps,
              processStartTime: () => Promise.reject(new Error('test-identity-unavailable')),
            }
          : deps
      await expect(stopAllHardwareLeases(scan)).rejects.toThrow('lease-stop-failed')
      expect(missed).not.toHaveBeenCalled()
      expect(reached).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['duplicate', 'gone'])(
    'RVM103W6 P1: a renamed %s index does not raise a false Stop alarm',
    async (kind) => {
      const deps = await fixture()
      const stop = vi.fn(() => Promise.resolve())
      const active = await claim(deps, 'port:actual', stop)
      const file = generationFile(deps.directory, active.record).replace('claim-v1.', 'stop-v1.')
      const renamed = generationFile(deps.directory, {
        ...active.record,
        resource: 'port:other',
      }).replace('claim-v1.', 'stop-v1.')
      if (kind === 'duplicate') await link(file, renamed)
      else await rename(file, renamed)
      const scan =
        kind === 'gone' ? { ...deps, processStartTime: () => Promise.resolve(undefined) } : deps
      await expect(stopAllHardwareLeases(scan)).resolves.toBeUndefined()
      expect(stop).toHaveBeenCalledTimes(kind === 'duplicate' ? 1 : 0)
      expect(await readFile(renamed, 'utf8')).toBe(JSON.stringify(active.record))
    },
  )

  it('refuses unsafe directory ownership, modes and symlink ancestors', async () => {
    const deps = await fixture()
    await expect(
      claim({ ...deps, platform: 'win32', isOwnerDirectory: () => Promise.resolve(false) }),
    ).rejects.toThrow('lease-directory-not-private')
    const { isOwnerDirectory: _ownerDirectory, ...withoutOwnerCheck } = deps
    await expect(claim({ ...withoutOwnerCheck, platform: 'win32' })).rejects.toThrow(
      'lease-directory-not-private',
    )
    // Exercise POSIX permission/owner checks against real stats through the existing platform seam.
    const posix = { ...deps, platform: 'linux' as const }
    const getUserId = process.getuid
    vi.mocked(lstat).mockImplementation(async (file) => {
      const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
      const stat = await actual.lstat(file)
      Object.defineProperties(stat, {
        uid: { value: getUserId?.() },
        mode: { value: 0o4_0755 },
      })
      return stat
    })
    await expect(claim(posix)).rejects.toThrow('lease-directory-not-private')
    vi.mocked(lstat).mockImplementation(async (file) => {
      const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
      const stat = await actual.lstat(file)
      Object.defineProperties(stat, {
        uid: { value: (getUserId?.() ?? 0) + 1 },
        mode: { value: 0o4_0700 },
      })
      return stat
    })
    await expect(claim(posix)).rejects.toThrow('lease-directory-not-private')
    const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
    vi.mocked(lstat).mockImplementation(fs.lstat)
    const target = path.join(deps.directory, 'target')
    const alias = path.join(deps.directory, 'alias')
    await mkdir(target)
    await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(claim({ ...deps, directory: path.join(alias, 'leases') })).rejects.toThrow(
      'lease-directory-invalid',
    )
    await expect(lstat(path.join(target, 'leases'))).rejects.toMatchObject({ code: 'ENOENT' })
    if (process.platform === 'win32') {
      return
    }

    await chmod(deps.directory, 0o755)
    await expect(claim(deps)).rejects.toThrow('lease-directory-not-private')
    await chmod(deps.directory, 0o700)
  })

  it.each([
    'corrupt',
    'oversized',
    'foreign-resource',
    'foreign-endpoint',
    'symlink',
    'unreadable',
  ])('holds an unknown %s claim without gating Stop', async (kind) => {
    const deps = await fixture()
    const active = await claim(deps)
    const slot = path.join(
      deps.directory,
      `claim-v1.${createHash('sha256').update('port:test').digest('hex')}.head.claim`,
    )
    const saved = await readFile(slot)
    const fs = await vi.importActual<typeof FsPromises>('node:fs/promises')
    switch (kind) {
      case 'corrupt': {
        await writeFile(slot, '{')
        break
      }
      case 'oversized': {
        await writeFile(
          slot,
          JSON.stringify({ ...active.record, padding: 'x'.repeat(deps.maxRecordBytes + 1) }),
        )
        break
      }
      case 'foreign-resource': {
        const foreign = await claim(deps, 'port:foreign')
        await writeFile(slot, JSON.stringify(foreign.record))
        break
      }
      case 'foreign-endpoint': {
        await writeFile(slot, JSON.stringify({ ...active.record, endpoint: 'foreign' }))
        break
      }
      case 'symlink': {
        vi.mocked(lstat).mockImplementation(async (file) => {
          const stat = await fs.lstat(file)
          if (file === slot) Object.defineProperty(stat, 'isSymbolicLink', { value: () => true })
          return stat
        })
        break
      }
      case 'unreadable': {
        {
          vi.mocked(open).mockImplementation(async (file, flags, mode) => {
            if (file === slot) throw Object.assign(new Error('test-unreadable'), { code: 'EACCES' })
            return await fs.open(file, flags, mode)
          })
          // No default
        }
        break
      }
    }
    try {
      expect(await claimHardwareLease(deps, 'port:test', 'third', () => Promise.resolve())).toEqual(
        { status: 'busy' },
      )
      expect(await didStopHardwareLease(deps, 'port:test')).toBe(true)
    } finally {
      vi.mocked(lstat).mockImplementation(fs.lstat)
      vi.mocked(open).mockImplementation(fs.open)
      await writeFile(slot, saved)
      await active.release()
    }
  })

  it('Stop reports no session for an absent lease folder without creating it', async () => {
    const deps = await fixture()
    const missing = { ...deps, directory: path.join(deps.directory, 'maker', 'leases') }
    const preparedFiles = await readdir(deps.directory)
    await expect(stopAllHardwareLeases(missing)).resolves.toBeUndefined()
    expect(await stopHardwareLease(missing, 'port:test')).toEqual({ stopped: false, sessions: [] })
    expect(await readdir(deps.directory)).toEqual(preparedFiles)
  })
  it('refuses oversized preparation and a missing holder identity before starting an endpoint', async () => {
    const deps = await fixture()
    const listen = vi.fn(deps.listenOwnerPipe)
    await expect(claim({ ...deps, maxRecordBytes: 1, listenOwnerPipe: listen })).rejects.toThrow(
      'lease-record-oversize',
    )
    await expect(
      claim({
        ...deps,
        processStartTime: () => Promise.resolve(undefined),
        listenOwnerPipe: listen,
      }),
    ).rejects.toThrow('lease-holder-identity-unavailable')
    expect(listen).not.toHaveBeenCalled()
  })

  it('holds an unknown process-start query and rejects claim-chain cycles', async () => {
    const deps = await fixture()
    const active = await claim(deps)
    let queries = 0
    const unknown = {
      ...deps,
      processStartTime: () => {
        queries += 1
        return Promise.resolve(queries === 1 ? active.record.startedAt : '')
      },
    }
    expect(
      await claimHardwareLease(unknown, 'port:test', 'third', () => Promise.resolve()),
    ).toEqual({ status: 'busy', holder: active.record })
    await active.release()
    const prefix = `claim-v1.${createHash('sha256').update('port:test').digest('hex')}.`
    await link(
      path.join(deps.directory, `${prefix}head.claim`),
      path.join(deps.directory, `${prefix}${active.record.generation}.claim`),
    )
    expect(await claimHardwareLease(deps, 'port:test', 'third', () => Promise.resolve())).toEqual({
      status: 'busy',
    })
  })

  it('cleans a released generation after endpoint failure and accepts the next release as a no-op', async () => {
    const closed = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('test-release-close'))
      .mockResolvedValue(undefined)
    let deps = await fixture()
    deps = {
      ...deps,
      platform: 'win32',
      isOwnerDirectory: () => Promise.resolve(true),
      listenOwnerPipe: () => Promise.resolve(closed),
    }
    const active = await claim(deps)
    await expect(active.release()).rejects.toThrow('test-release-close')
    await active.release()
    expect(closed).toHaveBeenCalledTimes(1)
    const retry = await claim(deps)
    await retry.release()
  })

  it('finishes an in-flight Stop acknowledgement before concurrent owner teardown', async () => {
    let deps = await fixture()
    if (process.platform === 'win32') {
      // Pause the real pipe writer so owner EOF deterministically races its flush.
      const helper = await makerNativeHelper(deps.directory, (source) =>
        source.replace(
          'using (var writer = new StreamWriter(pipe))',
          'Thread.Sleep(MutexPollMs); using (var writer = new StreamWriter(pipe))',
        ),
      )
      deps = {
        ...deps,
        exclusive: (file, operation) => withNativeLeaseMutex(helper, file, operation),
        listenOwnerPipe: (endpoint, id, stop) => listenNativeOwnerPipe(helper, endpoint, id, stop),
      }
    }
    const entered = new AbortController()
    const cleanup = Promise.withResolvers<undefined>()
    const claimed = await claimHardwareLease(deps, 'port:closing-stop', 'owner', () => {
      entered.abort()
      return cleanup.promise
    })
    if (claimed.status !== 'acquired') throw new Error('test-claim')
    let releasing: Promise<void> | undefined
    const stopping = didStopHardwareLease(deps, 'port:closing-stop')
    try {
      await vi.waitFor(() => {
        expect(entered.signal.aborted).toBe(true)
      })
      let hasReleased = false
      releasing = (async () => {
        await claimed.release()
        hasReleased = true
      })()
      await delay(100)
      expect(hasReleased).toBe(false)
      cleanup.resolve(undefined)
      expect(await stopping).toBe(true)
      await releasing
    } finally {
      cleanup.resolve(undefined)
      await stopping
      await (releasing ?? claimed.release())
    }
  })

  it('accepts Stop from a separate process through the real native owner endpoint', async () => {
    const deps = await fixture()
    const stop = vi.fn(() => Promise.resolve())
    const claimed = await claimHardwareLease(deps, 'port:cross-process', 'owner', stop)
    if (claimed.status !== 'acquired') throw new Error('test-claim')
    try {
      const client = await startSerialProcess(
        {
          file: process.execPath,
          args: [
            '-e',
            String.raw`
const socket = require('node:net').connect(process.argv[1]);
socket.setTimeout(2000, () => process.exit(1));
socket.on('error', () => process.exit(1));
socket.once('connect', () => socket.write(JSON.stringify({ command: 'stop', id: process.argv[2] }) + '\n'));
socket.on('data', bytes => process.stdout.write(bytes));
socket.once('end', () => process.exit(0));`,
            claimed.record.endpoint,
            claimed.record.id,
          ],
          writable: false,
        },
        makerProcessDeps({ durationMs: 5000 }),
      )
      const capture = await client.result
      expect(capture.reason).toBe('ended')
      expect(capture.bytes.toString('utf8').trim()).toBe('{"stopped":true}')
      expect(stop).toHaveBeenCalledTimes(1)
    } finally {
      await claimed.release()
    }
  })

  it('reports Stop failure and holds separate resources independently', async () => {
    const deps = await fixture()
    const first = await claimHardwareLease(deps, 'port:first', 'one', () =>
      Promise.reject(new Error('test-stop')),
    )
    const second = await claimHardwareLease(deps, 'machine:second', 'two', () => Promise.resolve())
    expect(first.status).toBe('acquired')
    expect(second.status).toBe('acquired')
    try {
      expect(await stopHardwareLease(deps, 'port:first')).toMatchObject({
        stopped: false,
        sessions: [{ party: 'holder', status: 'failed', reason: 'lease-stop-failed' }],
      })
    } finally {
      if (first.status === 'acquired') await first.release()
      if (second.status === 'acquired') await second.release()
    }
  })

  it('rejects a replayed Stop id and oversized input without invoking Stop', async () => {
    const deps = await fixture()
    const stop = vi.fn().mockResolvedValue(undefined)
    const claimed = await claimHardwareLease(deps, 'port:test', 'one', stop)
    if (claimed.status !== 'acquired') throw new Error('test-claim')
    try {
      const request = (text: string) =>
        new Promise<void>((resolve, reject) => {
          const socket = net.connect(claimed.record.endpoint)
          socket.resume()
          socket.on('error', () => socket.destroy())
          socket.once('close', () => {
            resolve()
          })
          socket.once('connect', () => socket.write(text))
          socket.setTimeout(3000, () => {
            socket.destroy()
            reject(new Error('test-stop-timeout'))
          })
        })
      await request(`${JSON.stringify({ command: 'stop', id: randomUUID() })}\n`)
      await request('x'.repeat(8192))
      expect(stop).not.toHaveBeenCalled()
    } finally {
      await claimed.release()
    }
  })

  it('canonicalizes aliases and Windows COM casing', async () => {
    const deps = await fixture()
    const target = path.join(deps.directory, 'tty')
    await writeFile(target, '')
    const alias = path.join(deps.directory, 'by-id')
    if (process.platform !== 'win32') {
      await symlink(target, alias)
      expect(await serialLeaseResource({ port: target }, process.platform)).toBe(
        await serialLeaseResource({ port: alias }, process.platform),
      )
    }
    for (const port of ['COM3', 'com3', String.raw`\\.\COM3`, String.raw`\\?\com3`])
      expect(await serialLeaseResource({ port }, 'win32')).toBe('port:COM3')
  })

  it('rejects oversized native readiness before entering the critical section', async () => {
    const operation = vi.fn(() => Promise.resolve())
    const helper = {
      file: process.execPath,
      prefix: [
        '-e',
        String.raw`process.stderr.write('lease-ready\n'.repeat(1000)); setInterval(() => {}, 100);`,
      ],
      process: makerProcessDeps({ maxStatusBytes: 128 }),
    }
    await expect(withNativeLeaseMutex(helper, 'unused', operation)).rejects.toThrow(
      'lease-helper-status-oversize',
    )
    expect(operation).not.toHaveBeenCalled()
  })

  it('refuses a native pipe on the wrong platform or outside its private namespace', async () => {
    const helper = { file: '/must-not-run', prefix: [], process: makerProcessDeps() }
    const stop = vi.fn(() => Promise.resolve())
    await expect(
      listenNativeOwnerPipe(
        { ...helper, process: { ...helper.process, platform: 'linux' } },
        String.raw`\\.\pipe\MuseSparkSerial-test`,
        randomUUID(),
        stop,
      ),
    ).rejects.toThrow('lease-pipe-invalid')
    await expect(
      listenNativeOwnerPipe(
        { ...helper, process: { ...helper.process, platform: 'win32' } },
        '/foreign/pipe',
        randomUUID(),
        stop,
      ),
    ).rejects.toThrow('lease-pipe-invalid')
    expect(stop).not.toHaveBeenCalled()
  })

  it('ends a native mutex waiter when its parent dies, while the other holder stays alive', async () => {
    const deps = await fixture()
    const helper = await makerNativeHelper(deps.directory)
    const entered = new AbortController()
    const release = new AbortController()
    const waiting = new Promise<void>((resolve) => {
      entered.signal.addEventListener(
        'abort',
        () => {
          resolve()
        },
        { once: true },
      )
    })
    const file = path.join(deps.directory, 'waiter.mutex')
    const holder = withNativeLeaseMutex(
      helper,
      file,
      () =>
        new Promise<void>((resolve) => {
          release.signal.addEventListener(
            'abort',
            () => {
              resolve()
            },
            { once: true },
          )
          entered.abort()
        }),
    )
    await waiting
    try {
      const script = `
const child = require('node:child_process').spawn(process.argv[1], JSON.parse(process.argv[2]), { detached: true, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
process.stdout.write(String(child.pid));
setTimeout(() => process.exit(0), 100);`
      const parent = await startSerialProcess(
        {
          file: process.execPath,
          args: ['-e', script, helper.file, JSON.stringify([...helper.prefix, 'mutex', file])],
          writable: false,
        },
        makerProcessDeps(),
      )
      const capture = await parent.result
      const pid = Number(capture.bytes.toString('utf8'))
      expect(pid).toBeGreaterThan(0)
      await vi.waitFor(
        async () => {
          expect(await isTestProcessAlive(pid)).toBe(false)
        },
        {
          timeout: 5000,
        },
      )
    } finally {
      release.abort()
      await holder
    }
  })

  it('echoes the native Stop call id so one reply cannot settle another', async () => {
    const script = String.raw`
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
process.stderr.write('pipe-ready\n');
setTimeout(() => process.stdout.write('stop:' + ids[0] + '\r\n'), 20);
let count = 0;
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  if (line !== 'stopped:' + ids[count]) process.exit(1);
  count += 1;
  if (count < ids.length) process.stdout.write('stop:' + ids[count] + '\n');
});
process.stdin.on('end', () => process.exit(0));
setInterval(() => {}, 100);`
    const stop = vi.fn(() => Promise.resolve())
    const close = await listenNativeOwnerPipe(
      {
        file: process.execPath,
        prefix: ['-e', script],
        process: { ...makerProcessDeps(), platform: 'win32' },
      },
      String.raw`\\.\pipe\MuseSparkSerial-test`,
      randomUUID(),
      stop,
    )
    try {
      await vi.waitFor(() => {
        expect(stop).toHaveBeenCalledTimes(2)
      })
    } finally {
      await close()
    }
  })
})

// Start identity on every platform: makerLeaseIdentity.test.ts (FIXM103W10).
describe('hardware lease stop-all', () => {
  it('stops nothing and throws nothing over an empty lease directory', async () => {
    const deps = await fixture()
    await expect(stopAllHardwareLeases(deps)).resolves.toBeUndefined()
  })
})
