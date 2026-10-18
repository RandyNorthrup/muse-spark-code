// M124 (RVM124B finding 3): the per-grant limits file and its lock, through
// the real ConnectorStore on a real folder. Two stores on one folder stand
// for two server processes of one grant, and a planted lock file is a
// crashed or foreign holder's leftover, given as data. (RVMSM124: the cases
// that staged interleavings by holding real fs calls behind test doubles,
// or by replacing Date.now, are deleted under the owner's testing rules;
// the takeover protocol they probed is exercised here only as far as real
// files and real processes can stage it.)
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { CONNECTOR_LIMITS } from '../../src/shared/constants'
import { SharedLimits } from '../../src/core/connector/policy'
import { ConnectorStore } from '../../src/runtime/connector/store'

const HOUR_MS = 3_600_000
/** No refill between takes: every token spent stays spent. */
const FIXED_NOW = Date.parse('2026-10-09T12:00:00.000Z')

const folders: string[] = []
afterEach(async () => {
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
