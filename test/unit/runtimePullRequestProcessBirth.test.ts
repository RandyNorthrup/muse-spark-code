// Linux process births for the worktree records' lock and pending
// checkouts (M123 lane P, RVM123P5 finding 3): a fake `/proc` served
// through `readFile`, so a wall-clock step (which moves `/proc/stat`'s
// btime) can be stood on any host. A birth is the kernel's start time in
// clock ticks since boot plus the boot id; neither moves with the clock.

import type * as NodeFsPromises from 'node:fs/promises'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  isProcessOwnerGone,
  processStartTime,
  systemBootId,
  type ProcessOwner,
} from '../../src/core/locks/processOwner'
import { nodeLeasePort } from '../../src/core/locks/nodeLeasePort'
import { acquireFileLease, LeaseBusyError } from '../../src/core/locks/fileLease'

const proc = vi.hoisted(() => new Map<string, string>())

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof NodeFsPromises>()
  return {
    ...fs,
    readFile: async (...args: Parameters<typeof fs.readFile>) => {
      const file = typeof args[0] === 'string' ? args[0] : ''
      const text = proc.get(file)
      if (text !== undefined) {
        return text
      }
      if (file.startsWith('/proc/')) {
        throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' })
      }
      return await fs.readFile(...args)
    },
  }
})

const PID = 4242
const BOOT = 'a3f1c0de-1111-4222-8333-944455556666'
const BOOT_TIME = 1_790_000_000
const HOUR_SECONDS = 3600

/** `/proc/<pid>/stat` with field 22 (start ticks) set; the name holds `)` and spaces. */
function statLine(startTicks: number): string {
  const after = ['S', 1, 1, 1, 0, -1, 4_194_560, 100, 0, 0, 0, 1, 1, 0, 0, 20, 0, 7, 0]
  return `${String(PID)} (node (worker) x) ${[...after, startTicks, 1_000_000, 500].join(' ')}\n`
}

function linuxSystem(startTicks: number, bootSeconds: number, bootId = BOOT): void {
  proc.set(`/proc/${String(PID)}/stat`, statLine(startTicks))
  proc.set('/proc/stat', `cpu 1 2 3 4\nbtime ${String(bootSeconds)}\nprocesses 99\n`)
  proc.set('/proc/sys/kernel/random/boot_id', `${bootId}\n`)
}

/** This window, on that Linux host and boot. */
function selfIn(bootId = BOOT): ProcessOwner {
  return { host: hostname(), pid: process.pid, processStart: 1, bootId }
}

function probe(self = selfIn()) {
  return {
    self,
    isAlive: () => true,
    startTimeOf: (pid: number) => processStartTime(pid, 'linux'),
  }
}

/** The owner as recorded when it took the lock or reserved its checkout. */
async function recordedOwner(): Promise<ProcessOwner> {
  return {
    host: hostname(),
    pid: PID,
    processStart: (await processStartTime(PID, 'linux')) ?? -1,
    bootId: BOOT,
  }
}

describe('Linux process births (M123 lane P)', () => {
  it('reads the kernel start ticks and the boot id', async () => {
    linuxSystem(50_000, BOOT_TIME)
    expect(await processStartTime(PID, 'linux')).toBe(50_000)
    expect(await systemBootId('linux')).toBe(BOOT)
    expect(await systemBootId('win32')).toBeUndefined()
  })

  it('keeps a live owner alive when the wall clock steps either way', async () => {
    // RVM123P5 finding 3: a clock step moves btime; an epoch birth computed
    // from it moved with it and declared the live owner gone.
    linuxSystem(50_000, BOOT_TIME)
    const owner = await recordedOwner()
    expect(await isProcessOwnerGone(owner, probe())).toBe(false)
    for (const step of [HOUR_SECONDS, -HOUR_SECONDS]) {
      linuxSystem(50_000, BOOT_TIME + step)
      expect(await isProcessOwnerGone(owner, probe())).toBe(false)
    }
  })

  it('names the owner gone when its id is another process’s, or it ran in another boot', async () => {
    linuxSystem(50_000, BOOT_TIME)
    const owner = await recordedOwner()
    // The same id, born at another tick of the same boot: another process.
    linuxSystem(50_001, BOOT_TIME)
    expect(await isProcessOwnerGone(owner, probe())).toBe(true)
    // The same ticks after a reboot: the recorded process ended with its boot.
    linuxSystem(50_000, BOOT_TIME, 'b0000000-1111-4222-8333-944455556666')
    expect(
      await isProcessOwnerGone(owner, probe(selfIn('b0000000-1111-4222-8333-944455556666'))),
    ).toBe(true)
  })

  it('never takes a live owner’s lock early when the wall clock steps', async () => {
    linuxSystem(50_000, BOOT_TIME)
    const owner = await recordedOwner()
    const folder = await mkdtemp(path.join(tmpdir(), 'm123p-birth-'))
    const lockPath = path.join(folder, 'lock')
    await writeFile(
      lockPath,
      JSON.stringify({
        owner,
        id: 'live-holder',
        renewal: 0,
        acquiredAt: Date.now(),
        leaseMs: 30_000,
      }),
    )
    linuxSystem(50_000, BOOT_TIME + HOUR_SECONDS)
    await expect(
      acquireFileLease(lockPath, {
        port: nodeLeasePort,
        now: Date.now,
        monotonic: () => performance.now(),
        sleep: (ms) =>
          new Promise((resolve) => {
            setTimeout(resolve, ms)
          }),
        owner: selfIn(),
        isOwnerGone: (seen) => isProcessOwnerGone(seen, probe()),
        leaseMs: 30_000,
        honoredLeaseMs: 30_000,
        unreadableMs: 2000,
        timeoutMs: 200,
        pollMs: 10,
        watches: new Map(),
      }),
    ).rejects.toBeInstanceOf(LeaseBusyError)
  })
})
