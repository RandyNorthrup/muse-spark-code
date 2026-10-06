// Real child processes in tests: whether one still runs, the id a test
// process recorded, and waiting for one to end.

import { readFileSync } from 'node:fs'
import { expect, vi } from 'vitest'

/** Whether `pid` runs; on Linux an exited process not yet reaped counts as ended. */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8')
      return !stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z')
    } catch {
      // The process may have been reaped between the signal and the read.
      return false
    }
  }
  return true
}

/** The process id a test process wrote to `marker`, once it is there. */
export async function markedPid(marker: string, timeout = 15_000): Promise<number> {
  await vi.waitFor(
    () => {
      expect(readFileSync(marker, 'utf8')).not.toBe('')
    },
    { timeout },
  )
  return Number(readFileSync(marker, 'utf8'))
}

/** Waits until `pid` has ended. */
export async function expectEnded(pid: number, timeout = 5000): Promise<void> {
  await vi.waitFor(
    () => {
      expect(isRunning(pid)).toBe(false)
    },
    { timeout },
  )
}
