// The managed-configuration report over real processes: an absent CLI
// reads as absent, a status that cannot run reads as unreadable, and a
// nonzero status reads as its exit code — never the CLI's own words.

import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { managedConfiguration } from '../../src/host/networkPosture'
import type { ProcessResult } from '../../src/host/backend/sandboxSetup'

function runExit(binary: string, args: readonly string[]): () => Promise<ProcessResult> {
  // The OS exit status is data, never an error shape: a nonzero exit
  // reports its code in `status` on every platform, and only a failure
  // to start (or a signal death, which the contract reads as negative)
  // leaves it.
  return () => {
    const result = spawnSync(binary, [...args], { encoding: 'utf8' })
    if (result.error !== undefined) return Promise.reject(result.error)
    return Promise.resolve({
      exitCode: result.status ?? -1,
      stdout: result.stdout,
      stderr: result.stderr,
    })
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
      managedConfiguration(runExit('/muse-spark-test-no-such-cli', ['config', 'status'])),
    ).resolves.toEqual({ ok: false, reason: 'could not read status' })
  })

  it('reads a nonzero status as its exit code', async () => {
    // The test runner's own Node exits 1 everywhere: /bin/false is absent
    // on hosted macOS runners (ENOENT reads as unreadable, not exit 1).
    const exitOne = process.execPath
    const exitArgs = ['-e', 'process.exit(1)'] as const
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
