// M92b: a never-ending monitor through the shell tool's real execution path
// (`createToolIo().runShell`, the same call the Model API shell tool makes).
// The command runs with a small `timeout_ms`; the proof is the output
// captured so far with `isTimedOut`, and neither the script nor its child
// running once the call returns, on every OS. On Windows the command joins
// the job object when the helper compiles, as in production (M27).

import * as childProcess from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { posixQuoted, powerShellQuoted } from '../../src/core/shellQuote'
import { createToolIo } from '../../src/host/backend/toolIo'
import { shellJobAssembly } from '../../src/host/backend/shellJob'
import { readJobSource } from './helpers/jobSource'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('node:child_process', { spy: true })
afterEach(() => {
  vi.restoreAllMocks()
})

const IS_WINDOWS = process.platform === 'win32'
// A cold Windows runner once took over 30 s for its first PowerShell start
// (see toolIo.test.ts), so one generous call warms the interpreter before
// the small timeout the proof itself uses: the warm-up proves the shell
// starts, the proof proves the timeout ends the tree.
const WARMUP_MS = 120_000
const MONITOR_MS = 5000
const GROUP_SIGNAL_DELAY_MS = 500
const MONITOR_TEST_MS = 300_000
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

/** An exited zombie is dead even before the OS reaps its PID. */
function isAlive(pid: number, platform: NodeJS.Platform = process.platform): boolean {
  try {
    process.kill(pid, 0)
    if (platform === 'darwin') {
      const state = childProcess
        .execFileSync('/bin/ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8', env: {} })
        .trim()
      return state !== '' && !state.startsWith('Z')
    }
    return (
      platform !== 'linux' ||
      !/^State:\s+Z\b/m.test(readFileSync(`/proc/${String(pid)}/status`, 'utf8'))
    )
  } catch {
    // The process may be reaped between the signal and the state read.
    return false
  }
}

it.each([
  ['R', true],
  ['S+', true],
  ['Z', false],
  ['Z+', false],
  ['', false],
] as const)(
  'recognizes macOS process state "%s" without calling a zombie alive',
  (state, expected) => {
    vi.mocked(childProcess.execFileSync).mockReturnValueOnce(state)
    expect(isAlive(process.pid, 'darwin')).toBe(expected)
  },
)

function monitorIo() {
  return createToolIo({
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
}

it(
  'returns a never-ending monitor’s output on timeout with neither process left behind (M92b)',
  async () => {
    expect(isAlive(process.pid)).toBe(true)
    const io = monitorIo()
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
  },
  MONITOR_TEST_MS,
)

it.runIf(!IS_WINDOWS)(
  'waits for a live descendant when SIGKILL reaches the leader first (CIFIX14T)',
  async () => {
    const nativeKill = process.kill.bind(process)
    let group: number | undefined
    let delayed: NodeJS.Timeout | undefined
    let isDelivered = false
    // Signal delivery and exit are asynchronous. Control the ordering while
    // retaining real processes, their real group and the production runner.
    const signal = vi.spyOn(process, 'kill').mockImplementation((pid, name) => {
      if (name === 'SIGKILL' && group === undefined && pid < 0) {
        group = pid
        delayed = setTimeout(() => {
          isDelivered = true
          try {
            nativeKill(pid, name)
          } catch {
            // A failure still surfaces in the live-descendant assertion.
          }
        }, GROUP_SIGNAL_DELAY_MS)
        return nativeKill(-pid, name)
      }
      return nativeKill(pid, name)
    })
    try {
      const result = await monitorIo().runShell(
        `${posixQuoted(process.execPath)} ${posixQuoted(MONITOR)}`,
        folders.scratch,
        MONITOR_MS,
      )
      expect(result.isTimedOut).toBe(true)
      expect(result.stdout).toContain('tick')
      const announced = /READY (\d+) (\d+)/.exec(result.stdout)
      expect(announced?.length).toBe(3)
      expect(isAlive(Number(announced?.[2]))).toBe(false)
      expect(isDelivered).toBe(true)
    } finally {
      signal.mockRestore()
      clearTimeout(delayed)
      if (group !== undefined) {
        try {
          nativeKill(group, 'SIGKILL')
        } catch {
          // The successful production wait already observed the group gone.
        }
      }
    }
  },
  MONITOR_TEST_MS,
)
