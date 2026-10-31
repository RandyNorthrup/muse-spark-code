// Real child processes in tests: whether one still runs, the id a test
// process recorded, waiting for one to end, and reading one's output.

import type { ChildProcess } from 'node:child_process'
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

/** Kills any launched child still running and waits for its close, then empties the list. */
export async function killLaunched(
  launched: {
    child: {
      exitCode: number | null
      signalCode: NodeJS.Signals | null
      kill(): boolean
      once(event: 'close', listener: () => void): unknown
    }
  }[],
): Promise<void> {
  for (const launch of launched.splice(0)) {
    if (launch.child.exitCode !== null || launch.child.signalCode !== null) continue
    const closed = new Promise<void>((resolve) => {
      launch.child.once('close', () => {
        resolve()
      })
    })
    launch.child.kill()
    await closed
  }
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

/** A real child's exit code and standard output text, once it exits. */
export async function childExitText(child: ChildProcess): Promise<{
  exit: number | null
  text: string
}> {
  const chunks: Buffer[] = []
  child.stdout?.on('data', (chunk: Buffer) => {
    chunks.push(chunk)
  })
  const exit = await new Promise<number | null>((resolve) => {
    child.once('exit', resolve)
  })
  return { exit, text: Buffer.concat(chunks).toString('utf8') }
}
