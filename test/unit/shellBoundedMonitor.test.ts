// M92b: a never-ending monitor through the shell tool's real execution path
// (`createToolIo().runShell`, the same call the Model API shell tool makes).
// The command runs with a small `timeout_ms`; the proof is the output
// captured so far with `isTimedOut`, and both the script's and its child's
// PIDs gone once the call returns, on every OS. On Windows the command joins
// the job object when the helper compiles, as in production (M27).

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { posixQuoted, powerShellQuoted } from '../../src/core/shellQuote'
import { createToolIo } from '../../src/host/backend/toolIo'
import { shellJobAssembly } from '../../src/host/backend/shellJob'
import { readJobSource } from './helpers/jobSource'
import { removeFolder } from './helpers/temporaryFolders'

const IS_WINDOWS = process.platform === 'win32'
// A cold Windows runner once took over 30 s for its first PowerShell start
// (see toolIo.test.ts), so one generous call warms the interpreter before
// the small timeout the proof itself uses: the warm-up proves the shell
// starts, the proof proves the timeout ends the tree.
const WARMUP_MS = 120_000
const MONITOR_MS = 5000
// Node cannot start a script through an extended-length (`\\?\`) path, which
// is what `resolve` yields when the runner's own working directory is one:
// strip the prefix so the fixture starts everywhere.
const MONITOR = path.resolve('test/fixtures/never-ending-monitor.mjs').replace(/^\\\\\?\\/, '')

const folders = {
  scratch: mkdtempSync(path.join(tmpdir(), 'muse-monitor-proof-')),
  jobs: IS_WINDOWS ? mkdtempSync(path.join(tmpdir(), 'muse-monitor-jobs-')) : '',
}

afterAll(async () => {
  await removeFolder(folders.scratch)
  if (folders.jobs !== '') {
    await removeFolder(folders.jobs)
  }
})

/** Whether pid still names a live process: signal 0 throws once it is gone. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

it('returns a never-ending monitor’s output on timeout with neither process left behind (M92b)', async () => {
  const io = createToolIo({
    env: () => process.env,
    listFiles: () => Promise.resolve([]),
    log: () => undefined,
    platform: process.platform,
    searchWorkerPath: 'unused-here',
    shellJobAssembly: IS_WINDOWS
      ? shellJobAssembly({
          log: () => undefined,
          readJobSource,
          storageDir: folders.jobs,
          systemRoot: String(process.env['SystemRoot']),
        })
      : undefined,
    systemRoot: process.env['SystemRoot'],
    unsavedFiles: () => [],
  })
  const started = await io.runShell(
    IS_WINDOWS ? 'Write-Output warm' : 'echo warm',
    folders.scratch,
    WARMUP_MS,
  )
  expect(started.exitCode).toBe(0)
  const launch = IS_WINDOWS
    ? `& ${powerShellQuoted(process.execPath)} ${powerShellQuoted(MONITOR)}`
    : `${posixQuoted(process.execPath)} ${posixQuoted(MONITOR)}`
  const result = await io.runShell(launch, folders.scratch, MONITOR_MS)
  // The output so far, and the timeout it stopped for.
  expect(result.isTimedOut).toBe(true)
  expect(result.stdout).toContain('tick')
  const announced = /READY (\d+) (\d+)/.exec(result.stdout)
  expect(announced?.length).toBe(3)
  for (const pid of [Number(announced?.[1]), Number(announced?.[2])]) {
    expect(Number.isSafeInteger(pid)).toBe(true)
    expect(isAlive(pid)).toBe(false)
  }
}, 300_000)
