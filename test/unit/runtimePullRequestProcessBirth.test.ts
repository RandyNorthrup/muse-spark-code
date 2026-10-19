// Linux process births for the worktree records' lock and pending
// checkouts (M123 lane P, RVM123P5 finding 3): the real `/proc` on a Linux
// host. A spawned child process supplies a live birth the test parses
// independently from the kernel's field 22, so the birth is pinned to start
// ticks, never to the wall clock. The stepped-clock and foreign-boot
// matrices the old file ran against a `readFile` stand-in for `/proc` are
// withdrawn in MSM113FIX (see docs/certification/msm113.md): no unit
// harness can step btime or reboot its host. Non-Linux hosts run only the
// platform-refusal case; `/proc` exists only on Linux.

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  currentProcessOwner,
  exactProcessBirth,
  isProcessOwnerGone,
  processStartTime,
  systemBootId,
  type ProcessOwner,
  type ProcessOwnerProbe,
} from '../../src/core/locks/processOwner'
import { nodeLeasePort } from '../../src/core/locks/nodeLeasePort'
import { acquireFileLease, LeaseBusyError } from '../../src/core/locks/fileLease'

const isLinuxHost = process.platform === 'linux'

/** A live child that outlives the case; the caller kills it. */
async function spawnedChild(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], {
    stdio: 'ignore',
  })
  await new Promise<void>((resolve) => {
    child.once('spawn', () => {
      resolve()
    })
  })
  return child
}

/** Field 22 of `/proc/<pid>/stat`, parsed independently of the source. */
async function statStartTicks(pid: number): Promise<number> {
  const stat = await readFile(`/proc/${String(pid)}/stat`, 'utf8')
  const fields = stat
    .slice(stat.lastIndexOf(')') + 1)
    .trim()
    .split(' ')
  return Number(fields[19])
}

function probe(self: ProcessOwner): ProcessOwnerProbe {
  return {
    self,
    isAlive: () => true,
    startTimeOf: (pid: number) => processStartTime(pid, 'linux'),
    exactBirthOf: (pid: number) => exactProcessBirth(pid),
    exactOnly: false,
  }
}

/** The owner as recorded when it took the lock or reserved its checkout. */
async function recordedOwner(pid: number): Promise<ProcessOwner> {
  const processStart = await processStartTime(pid, 'linux')
  const bootId = await systemBootId('linux')
  if (processStart === undefined || bootId === undefined) {
    throw new Error(`No readable birth for pid ${String(pid)}`)
  }
  // The real host: a mismatched host is never provably gone, which would
  // pass the cases below without comparing anything.
  return { host: hostname(), pid, processStart, bootId }
}

describe('Linux process births (M123 lane P)', () => {
  it('names no birth for an invalid pid or a foreign platform', async () => {
    expect(await processStartTime(0, 'linux')).toBeUndefined()
    expect(await processStartTime(-5, 'linux')).toBeUndefined()
    expect(await systemBootId('win32')).toBeUndefined()
  })

  it.runIf(isLinuxHost)('reads the kernel start ticks and the boot id', async () => {
    const child = await spawnedChild()
    try {
      const pid = child.pid ?? 0
      expect(pid).toBeGreaterThan(0)
      // The birth is the kernel's raw start ticks: exactly field 22, so no
      // wall-clock component can move it. The boot id is the file's content.
      expect(await processStartTime(pid, 'linux')).toBe(await statStartTicks(pid))
      const bootIdText = await readFile('/proc/sys/kernel/random/boot_id', 'utf8')
      expect(await systemBootId('linux')).toBe(bootIdText.trim())
    } finally {
      child.kill()
    }
  })

  it.runIf(isLinuxHost)('keeps a live owner alive', async () => {
    const child = await spawnedChild()
    try {
      const owner = await recordedOwner(child.pid ?? 0)
      expect(owner.processStart).toBeGreaterThan(0)
      expect(await isProcessOwnerGone(owner, probe(await currentProcessOwner()))).toBe(false)
    } finally {
      child.kill()
    }
  })

  it.runIf(isLinuxHost)('never takes a live owner’s lock early', async () => {
    const child = await spawnedChild()
    try {
      const owner = await recordedOwner(child.pid ?? 0)
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
      const contender = await currentProcessOwner()
      await expect(
        acquireFileLease(lockPath, {
          port: nodeLeasePort,
          now: Date.now,
          monotonic: () => performance.now(),
          sleep: (ms) =>
            new Promise((resolve) => {
              setTimeout(resolve, ms)
            }),
          owner: contender,
          isOwnerGone: (seen) => isProcessOwnerGone(seen, probe(contender)),
          leaseMs: 30_000,
          honoredLeaseMs: 30_000,
          unreadableMs: 2000,
          timeoutMs: 200,
          pollMs: 10,
          watches: new Map(),
        }),
      ).rejects.toBeInstanceOf(LeaseBusyError)
    } finally {
      child.kill()
    }
  })
})
