// The managed-configuration report over real processes: an absent CLI
// reads as absent, a status that cannot run reads as unreadable, and a
// nonzero status reads as its exit code — never the CLI's own words.

import { execFile } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { managedConfiguration } from '../../src/host/networkPosture'
import type { ProcessResult } from '../../src/host/backend/sandboxSetup'

function runReal(binary: string, args: readonly string[]): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve, reject) => {
    execFile(binary, [...args], (error, stdout, stderr) => {
      if (error) {
        const failure: Error = error
        reject(failure)
      } else {
        resolve({ exitCode: 0, stdout, stderr })
      }
    })
  })
}

function runExit(binary: string, args: readonly string[]): () => Promise<ProcessResult> {
  return async () => {
    try {
      return await runReal(binary, args)
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = error.code
        if (typeof code === 'number') {
          return { exitCode: code, stdout: '', stderr: '' }
        }
      }
      throw error
    }
  }
}

describe('managedConfiguration', () => {
  it('reads an absent CLI as absent', async () => {
    await expect(managedConfiguration(undefined)).resolves.toEqual({
      ok: false,
      reason: 'not run: the Muse Code CLI was not found',
    })
  })

  it('reads a status that cannot run as unreadable, never its words', async () => {
    await expect(
      managedConfiguration(() => runReal('/muse-spark-test-no-such-cli', ['config', 'status'])),
    ).resolves.toEqual({ ok: false, reason: 'could not read status' })
  })

  it('reads a nonzero status as its exit code', async () => {
    const exitOne = process.platform === 'win32' ? process.execPath : '/bin/false'
    const exitArgs = process.platform === 'win32' ? ['-e', 'process.exit(1)'] : []
    await expect(managedConfiguration(runExit(exitOne, exitArgs))).resolves.toEqual({
      ok: false,
      reason: 'exit code 1',
    })
  })

  it('reads a zero status as its text', async () => {
    const echo = process.platform === 'win32' ? process.execPath : '/bin/echo'
    const echoArgs = process.platform === 'win32' ? ['-e', 'console.log("Sources:")'] : ['Sources:']
    const result = await managedConfiguration(runExit(echo, echoArgs))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.text).toContain('Sources:')
    }
  })
})
