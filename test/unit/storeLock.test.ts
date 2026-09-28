import { randomUUID } from 'node:crypto'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { StoreBusyError, StoreLock } from '../../src/host/checkpoints/storeLock'
import { CHECKPOINT_OWNER_STALE_MS } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

// The checkpoint store's lock between windows on the same folder (M72):
// taken, waited for, refused in time, and taken over only from a window
// that is gone. The clock is the wall clock (file times are compared with
// it); waiting advances it without sleeping.
const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-store-lock-')))
const OTHER_PID = 424_242
const WAIT_MS = 1000

afterAll(async () => {
  await removeFolder(base)
})

interface LockOptions {
  readonly isProcessAlive?: (pid: number) => boolean
  readonly signal?: AbortSignal
}

function lockIn(options: LockOptions = {}) {
  const storageDir = path.join(base, randomUUID())
  let offset = 0
  const log = new FakeLogOutputChannel()
  const lock = new StoreLock({
    storageDir,
    instance: 'self',
    pid: process.pid,
    isProcessAlive: options.isProcessAlive ?? (() => true),
    clock: () => Date.now() + offset,
    sleep: (ms) => {
      offset += ms
      return Promise.resolve()
    },
    waitMs: WAIT_MS,
    signal: options.signal ?? new AbortController().signal,
    log,
  })
  const lockPath = path.join(storageDir, 'store.lock')
  return { lock, storageDir, lockPath, log }
}

function byName(left: string, right: string): number {
  return left.localeCompare(right)
}

async function heldBy(lockPath: string, pid: number, instance: string): Promise<void> {
  await mkdir(path.dirname(lockPath), { recursive: true })
  await writeFile(lockPath, JSON.stringify({ pid, instance }))
}

async function age(filePath: string): Promise<void> {
  const past = new Date(Date.now() - CHECKPOINT_OWNER_STALE_MS - 1000)
  await utimes(filePath, past, past)
}

describe('StoreLock (M72)', () => {
  it('runs a task holding the lock, marks the window present, and lets go after', async () => {
    const { lock, storageDir, lockPath } = lockIn()
    const during = await lock.run(async (): Promise<unknown> =>
      JSON.parse(await readFile(lockPath, 'utf8')),
    )
    expect(during).toEqual({ pid: process.pid, instance: 'self' })
    await expect(readFile(lockPath)).rejects.toThrow()
    expect(await readdir(path.join(storageDir, 'windows'))).toEqual(['self.json'])
    lock.leave()
    expect(await readdir(path.join(storageDir, 'windows'))).toEqual([])
  })

  it('waits for a live window’s lock, then refuses with the reason and leaves it be', async () => {
    const { lock, lockPath } = lockIn()
    await heldBy(lockPath, OTHER_PID, 'other')
    let isRun = false
    await expect(
      lock.run(() => {
        isRun = true
        return Promise.resolve()
      }),
    ).rejects.toThrow(new StoreBusyError(`process ${String(OTHER_PID)} held it`))
    expect(isRun).toBe(false)
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toEqual({
      pid: OTHER_PID,
      instance: 'other',
    })
  })

  it('takes over the lock of a window whose process is gone', async () => {
    const { lock, lockPath, log } = lockIn({ isProcessAlive: (pid) => pid !== OTHER_PID })
    await heldBy(lockPath, OTHER_PID, 'other')
    expect(await lock.run(() => Promise.resolve('ran'))).toBe('ran')
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining(String(OTHER_PID)))
  })

  it('takes over a lock silent past the stale time, even under a live process id', async () => {
    const { lock, lockPath } = lockIn()
    await heldBy(lockPath, OTHER_PID, 'other')
    await age(lockPath)
    expect(await lock.run(() => Promise.resolve('ran'))).toBe('ran')
  })

  it('waits for a lock still being written, and takes over one left unwritten', async () => {
    const { lock, lockPath } = lockIn()
    await heldBy(lockPath, OTHER_PID, 'other')
    await writeFile(lockPath, '')
    await expect(lock.run(() => Promise.resolve())).rejects.toBeInstanceOf(StoreBusyError)
    await age(lockPath)
    expect(await lock.run(() => Promise.resolve('ran'))).toBe('ran')
  })

  it('puts back a lock another window took while this one was taking over a gone one', async () => {
    const gonePid = OTHER_PID
    const newPid = OTHER_PID + 1
    const setup = { lockPath: '' }
    let isSwapped = false
    const { lock, lockPath } = lockIn({
      isProcessAlive: (pid) => {
        if (pid === gonePid && !isSwapped) {
          // The other window takes the lock between the look and the takeover.
          isSwapped = true
          writeFileSync(setup.lockPath, JSON.stringify({ pid: newPid, instance: 'new' }))
        }
        return pid !== gonePid
      },
    })
    setup.lockPath = lockPath
    await heldBy(lockPath, gonePid, 'gone')
    await expect(lock.run(() => Promise.resolve())).rejects.toBeInstanceOf(StoreBusyError)
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toEqual({ pid: newPid, instance: 'new' })
  })

  it('refuses a write once another window has taken the lock over', async () => {
    const { lock, lockPath } = lockIn()
    await expect(
      lock.run(async () => {
        await lock.assertHeld()
        await heldBy(lockPath, OTHER_PID, 'other')
        await lock.assertHeld()
      }),
    ).rejects.toBeInstanceOf(StoreBusyError)
    // The other window's lock is not removed on the way out.
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toMatchObject({ instance: 'other' })
  })

  it('counts the live windows, and removes the presence of those gone', async () => {
    const { lock, storageDir } = lockIn({ isProcessAlive: (pid) => pid !== OTHER_PID })
    await lock.run(() => Promise.resolve())
    const windows = path.join(storageDir, 'windows')
    await writeFile(
      path.join(windows, 'live.json'),
      JSON.stringify({ pid: process.pid, instance: 'live' }),
    )
    await writeFile(
      path.join(windows, 'exited.json'),
      JSON.stringify({ pid: OTHER_PID, instance: 'exited' }),
    )
    await writeFile(
      path.join(windows, 'silent.json'),
      JSON.stringify({ pid: process.pid, instance: 'silent' }),
    )
    await age(path.join(windows, 'silent.json'))
    const live = await lock.run(() => lock.liveWindows())
    expect([...live].map(([instance]) => instance).toSorted(byName)).toEqual(['live', 'self'])
    const left = await readdir(windows)
    expect(left.toSorted(byName)).toEqual(['live.json', 'self.json'])
  })

  it('keeps its presence and the lock it holds fresh while it works', async () => {
    const { lock, storageDir, lockPath } = lockIn()
    const presence = path.join(storageDir, 'windows', 'self.json')
    const ages = await lock.run(async () => {
      await age(lockPath)
      await age(presence)
      await lock.beat()
      const [lockStats, presenceStats] = await Promise.all([stat(lockPath), stat(presence)])
      return [lockStats.mtimeMs, presenceStats.mtimeMs].map((time) => Date.now() - time)
    })
    for (const since of ages) {
      expect(since).toBeLessThan(CHECKPOINT_OWNER_STALE_MS)
    }
  })

  it('writes its presence again from memory when the file has gone', async () => {
    const { lock, storageDir } = lockIn()
    await lock.publish(['turn'])
    const presence = path.join(storageDir, 'windows', 'self.json')
    await rm(presence)
    await lock.beat()
    expect(JSON.parse(await readFile(presence, 'utf8'))).toEqual({
      pid: process.pid,
      instance: 'self',
      running: ['turn'],
    })
  })

  it('takes back its own lock left behind, with a fresh time', async () => {
    const { lock, lockPath } = lockIn()
    await heldBy(lockPath, process.pid, 'self')
    await age(lockPath)
    const since = await lock.run(async () => {
      const held = await stat(lockPath)
      return Date.now() - held.mtimeMs
    })
    expect(since).toBeLessThan(CHECKPOINT_OWNER_STALE_MS)
  })

  it('takes over a gone window’s lock whatever an earlier move left behind', async () => {
    const { lock, lockPath } = lockIn({ isProcessAlive: (pid) => pid !== OTHER_PID })
    await heldBy(lockPath, OTHER_PID, 'other')
    // A folder where a fixed name for the moved lock would go.
    await mkdir(`${lockPath}.self.aside`)
    expect(await lock.run(() => Promise.resolve('ran'))).toBe('ran')
  })

  it('starts nothing once the window is closing', async () => {
    const stopping = new AbortController()
    stopping.abort()
    const { lock } = lockIn({ signal: stopping.signal })
    await expect(lock.run(() => Promise.resolve())).rejects.toThrow(/closing/)
  })
})
