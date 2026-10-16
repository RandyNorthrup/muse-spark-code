import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { shellOutcome } from '../../src/core/backends/modelapi/tools'
import { runCommand } from '../../src/host/backend/toolIo'

const notices: string[] = []

function tree() {
  return {
    platform: process.platform,
    systemRoot: undefined,
    log: (message: string) => {
      notices.push(message)
    },
  } as const
}

function scratch(): string {
  return mkdtempSync(path.join(tmpdir(), 'nolimits-shell-'))
}

describe('shell runs without invented ceilings (NOLIMITS2 A20)', () => {
  it('a named timeout still kills the tree past it', async () => {
    const result = await runCommand({
      file: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 10_000)'],
      cwd: scratch(),
      env: process.env,
      timeoutMs: 50,
      signal: undefined,
      tree: tree(),
    })
    expect(result.isTimedOut).toBe(true)
    expect(result.exitCode).toBeNull()
  })

  it('an unnamed run waits until the process ends instead of killing it', async () => {
    const result = await runCommand({
      file: process.execPath,
      args: ['-e', 'setTimeout(() => { console.log("done") }, 400)'],
      cwd: scratch(),
      env: process.env,
      timeoutMs: undefined,
      signal: undefined,
      tree: tree(),
    })
    expect(result.isTimedOut).toBe(false)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('done')
    // No minute passed: the wait said nothing, it just waited.
    expect(notices).toEqual([])
  })

  it('shellOutcome reads an unnamed run and a named timeout', () => {
    const ran = shellOutcome(
      { stdout: 'hi', stderr: '', exitCode: 0, isTimedOut: false, isCancelled: false },
      undefined,
    )
    expect(ran.output).toContain('exit code 0')
    const killed = shellOutcome(
      { stdout: '', stderr: '', exitCode: null, isTimedOut: true, isCancelled: false },
      50,
    )
    expect(killed.output).toContain('stopped after 50 ms')
  })
})
