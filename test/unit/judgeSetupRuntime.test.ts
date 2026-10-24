// M125 lane H: runtime paths, ports and locks. Real sockets (bound to
// prove free) and real lock files (held, refused, stolen from the dead,
// never from the living). Spawning itself waits for the pinned binary —
// except its loud refusal through the governed launch, which needs none.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isErrno } from '../../src/core/fs/errno'
import {
  acquireRuntimeLock,
  findFreePort,
  runtimePaths,
  startRuntime,
} from '../../src/core/judge/setup/runtime'
import { FIXTURE_HOOK_TIMEOUT_MS } from './helpers/fixtureBudget'

describe('setup runtime', () => {
  let scratch = ''

  beforeAll(async () => {
    scratch = await mkdtemp(path.join(tmpdir(), 'judge-runtime-'))
  }, FIXTURE_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true })
  })

  it('lays paths under the storage root only', () => {
    const paths = runtimePaths('/storage', '0.35.1')
    expect(paths.root).toBe(path.join('/storage', 'judge', 'runtime', '0.35.1'))
    expect(paths.models).toBe(path.join('/storage', 'judge', 'models'))
    expect(paths.lock).toBe(path.join('/storage', 'judge', 'runtime.lock'))
    expect(paths.record).toBe(path.join('/storage', 'judge', 'registration.json'))
    expect(paths.bin.startsWith(paths.root)).toBe(true)
  })

  it('finds a port by binding it', async () => {
    const port = await findFreePort()
    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThan(65_536)
    // Still free: binding it again succeeds.
    await new Promise<void>((resolve, reject) => {
      const server = createServer()
      server.on('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.close(() => {
          resolve()
        })
      })
    })
  })

  it('holds one lock, refuses a second, steals from the dead only', async () => {
    const lock = path.join(scratch, 'runtime.lock')
    const held = await acquireRuntimeLock(lock)
    expect(held).toBeDefined()
    expect(await acquireRuntimeLock(lock)).toBeUndefined()
    await held?.release()
    let lockContent: string | undefined
    try {
      lockContent = await readFile(lock, 'utf8')
    } catch (error: unknown) {
      if (!isErrno(error) || error.code !== 'ENOENT') throw error
      lockContent = undefined
    }
    expect(lockContent).toBeUndefined()
    const again = await acquireRuntimeLock(lock)
    expect(again).toBeDefined()
    await again?.release()
    // A lock from a dead pid is stolen.
    await writeFile(lock, JSON.stringify({ pid: 2_147_483_647, at: '2026-10-22' }))
    const stolen = await acquireRuntimeLock(lock)
    expect(stolen).toBeDefined()
    await stolen?.release()
    // A lock from a live pid is never stolen.
    await writeFile(lock, JSON.stringify({ pid: process.pid, at: '2026-10-22' }))
    expect(await acquireRuntimeLock(lock)).toBeUndefined()
    await rm(lock)
  })

  it('refuses a missing binary loudly at the governed launch', async () => {
    await expect(
      startRuntime(path.join(scratch, 'no-such-ollama'), 11_434, scratch),
    ).rejects.toThrow('Governed command unavailable')
  })
})
