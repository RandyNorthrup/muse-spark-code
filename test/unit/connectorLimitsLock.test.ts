// M124 (RVM124B finding 3): the per-grant limits file and its lock, through
// the real ConnectorStore on a real folder. `node:fs/promises` is wrapped so
// a test can hold one call and stage two servers' interleaving exactly where
// it matters: a takeover delayed past someone else's fresh lock, a holder
// paused inside its update, a wall clock that steps. Two stores on one
// folder stand for two server processes of one grant.
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONNECTOR_LIMITS } from '../../src/shared/constants'
import { SharedLimits } from '../../src/core/connector/policy'
import { ConnectorStore } from '../../src/runtime/connector/store'

const fsHooks = vi.hoisted(() => ({
  hold: undefined as
    ((op: string, args: readonly unknown[]) => Promise<void> | undefined) | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof FsPromises>()
  return {
    ...real,
    rm: async (...args: Parameters<typeof real.rm>) => {
      await fsHooks.hold?.('rm', args)
      await real.rm(...args)
    },
    rename: async (...args: Parameters<typeof real.rename>) => {
      await fsHooks.hold?.('rename', args)
      await real.rename(...args)
    },
    link: async (...args: Parameters<typeof real.link>) => {
      await fsHooks.hold?.('link', args)
      await real.link(...args)
    },
    readdir: async (...args: Parameters<typeof real.readdir>) => {
      await fsHooks.hold?.('readdir', args)
      return await real.readdir(...args)
    },
  }
})

const HOUR_MS = 3_600_000
/** No refill between takes: every token spent stays spent. */
const FIXED_NOW = Date.parse('2026-10-09T12:00:00.000Z')

const folders: string[] = []
afterEach(async () => {
  fsHooks.hold = undefined
  vi.restoreAllMocks()
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

async function setup() {
  const data = await mkdtemp(path.join(os.tmpdir(), 'm124-lock-'))
  folders.push(data)
  const limitsFolder = path.join(data, 'connector', 'limits')
  const lock = path.join(limitsFolder, 'default.json.lock')
  /** One server process of the grant: its own store, nothing shared in memory. */
  const server = () => new SharedLimits(new ConnectorStore(data).limits('default'), () => FIXED_NOW)
  /** A lock left by someone else, its file dated `ageMs` ago. */
  const plant = async (note: unknown, ageMs: number) => {
    await mkdir(limitsFolder, { recursive: true })
    await writeFile(lock, typeof note === 'string' ? note : JSON.stringify(note))
    const at = new Date(Date.now() - ageMs)
    await utimes(lock, at, at)
  }
  /** Tokens spent so far, read by spending what is left. */
  const spent = async () => {
    fsHooks.hold = undefined
    const reader = server()
    let left = 0
    for (let index = 0; index < CONNECTOR_LIMITS.burst; index += 1)
      if (await reader.take()) left += 1
    return CONNECTOR_LIMITS.burst - left
  }
  return { lock, server, plant, spent }
}

/** A process id that is gone: a child that has already exited. */
function exitedPid(): number {
  return spawnSync(process.execPath, ['-e', '']).pid
}

/** Holds the first call `isMatching` names; `gate.release` lets it go. */
function holdFirst(isMatching: (op: string, args: readonly unknown[]) => boolean) {
  const gate: { release?: () => void; seen: number } = { seen: 0 }
  const hold = (op: string, args: readonly unknown[]) => {
    if (!isMatching(op, args)) return undefined
    gate.seen += 1
    if (gate.seen !== 1) return undefined
    const held = Promise.withResolvers<undefined>()
    gate.release = () => {
      held.resolve(undefined)
    }
    return held.promise
  }
  return { gate, hold }
}

/** The lock's instance leaving its name: a takeover or a release (or the old store's removal). */
const removalOf = (lock: string) => (op: string, args: readonly unknown[]) =>
  (op === 'rename' || op === 'rm') && args[0] === lock
/** A limits state being published from its temporary file. */
const isPublish = (op: string, args: readonly unknown[]) =>
  (op === 'rename' || op === 'link') && String(args[0]).endsWith('.tmp')

/**
 * A holder paused at its publish while `waiters` servers take their turns
 * (the first takes over once the holder's lease has passed); then it
 * resumes. Answers each take (the holder's last) and the tokens spent.
 */
async function lostHolder(waiters: number) {
  const { server, spent } = await setup()
  const publish = holdFirst(isPublish)
  fsHooks.hold = publish.hold
  const paused = server().take()
  await vi.waitFor(() => {
    expect(publish.gate.release).toBeDefined()
  })
  const admitted: boolean[] = []
  for (let index = 0; index < waiters; index += 1) admitted.push(await server().take())
  publish.gate.release?.()
  admitted.push(await paused)
  return { admitted, spent: await spent() }
}

describe('M124 limits lock (RVM124B P2-3)', () => {
  it('never removes a live owner’s lock for its age', async () => {
    const { lock, server, plant } = await setup()
    // Another host's holder: it can never be proved gone from here, however old its file is.
    await plant({ host: 'another-host', pid: 1, start: 1, id: 'live', leaseMs: 60_000 }, HOUR_MS)
    const taking = server().take()
    await sleep(300)
    expect(JSON.parse(await readFile(lock, 'utf8'))).toMatchObject({ id: 'live' })
    // Its owner lets go: the waiter goes on.
    await rm(lock)
    expect(await taking).toBe(true)
  })

  it('keeps both debits when two servers recover one crashed owner’s lock', async () => {
    const { lock, server, plant, spent } = await setup()
    await plant(
      { host: os.hostname(), pid: exitedPid(), start: 1, id: 'crashed', leaseMs: 2000 },
      HOUR_MS,
    )
    const removal = holdFirst(removalOf(lock))
    const publish = holdFirst(isPublish)
    fsHooks.hold = (op, args) => removal.hold(op, args) ?? publish.hold(op, args)
    // C judges the crashed lock expired, then stalls before removing it.
    const late = server().take()
    await vi.waitFor(() => {
      expect(removal.gate.release).toBeDefined()
    })
    // A recovers it, takes the lock and stalls inside its update.
    const first = server().take()
    await vi.waitFor(() => {
      expect(publish.gate.release).toBeDefined()
    })
    // C's delayed removal now meets A's fresh lock.
    removal.gate.release?.()
    await sleep(200)
    publish.gate.release?.()
    expect(await Promise.all([first, late])).toEqual([true, true])
    expect(await spent()).toBe(2)
  })

  it('keeps both debits when the wall clock steps while a holder works', async () => {
    const { server, spent } = await setup()
    const publish = holdFirst(isPublish)
    fsHooks.hold = publish.hold
    const first = server().take()
    await vi.waitFor(() => {
      expect(publish.gate.release).toBeDefined()
    })
    const stepped = Date.now() + 6000
    vi.spyOn(Date, 'now').mockReturnValue(stepped)
    const second = server().take()
    await sleep(200)
    publish.gate.release?.()
    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(await spent()).toBe(2)
  })

  it('lands nothing from a holder that lost its lock while paused (the generation fence)', async () => {
    // Past the holder's lease, a waiter takes over and spends a token.
    const { admitted, spent } = await lostHolder(1)
    expect(admitted.slice(0, 1)).toEqual([true])
    // Every admitted call spent exactly one token: no debit was lost.
    expect(spent).toBe(admitted.filter(Boolean).length)
  })

  it('lands nothing from a lost holder whose generation was already pruned (newest check)', async () => {
    // Two waiters in turn: the second publishes the next generation and prunes the first,
    // so the paused holder's generation name is free again when it resumes.
    const { admitted, spent } = await lostHolder(2)
    expect(admitted.slice(0, 2)).toEqual([true, true])
    expect(spent).toBe(admitted.filter(Boolean).length)
  })

  it('refuses to publish once its own lease has ended, even uncontended', async () => {
    const { server } = await setup()
    // Held at its first look at the folder, inside the lock, past its own lease.
    const look = holdFirst((op) => op === 'readdir')
    fsHooks.hold = look.hold
    const late = server().take()
    await vi.waitFor(() => {
      expect(look.gate.release).toBeDefined()
    })
    await sleep(CONNECTOR_LIMITS.lockLeaseMs + 100)
    look.gate.release?.()
    expect(await late).toBe(false)
  })

  it('takes over at once a lock whose owner is provably gone', async () => {
    const { server, plant } = await setup()
    await plant(
      { host: os.hostname(), pid: exitedPid(), start: 1, id: 'crashed', leaseMs: 60_000 },
      0,
    )
    const started = performance.now()
    expect(await server().take()).toBe(true)
    expect(performance.now() - started).toBeLessThan(CONNECTOR_LIMITS.lockLeaseMs)
  })

  it('takes over a torn lock (no readable note) after a short watch', async () => {
    const { server, plant } = await setup()
    await plant('', 0)
    expect(await server().take()).toBe(true)
  })
})
