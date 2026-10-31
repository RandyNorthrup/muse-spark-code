// The legacy shell stop on Windows (PLAN.md D25, M27; `killTree` in
// src/host/processTree.ts): a command that joined its own job, the way the
// shell tool's PowerShell joins one, is ended with the whole job by the job
// helper run as a program of its own (its `terminate` command), with no
// Windows PowerShell start. A command whose job is not there falls back to
// taskkill. Everything here is real: the product's helper built by the
// product's own builder, a real PowerShell command with a real detached
// grandchild, the production runner. The runner passed in only records each
// program before it runs it through the production `runProgram`.
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { windowsPowerShell } from '../../src/core/execGuard'
import { spawnGuarded } from '../../src/core/guardedChildProcess'
import { powerShellQuoted } from '../../src/core/shellQuote'
import { joinStatement, newShellJob } from '../../src/host/backend/shellJob'
import { killTree, runProgram, type RunProgram } from '../../src/host/processTree'
import {
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
} from '../../src/shared/constants'
import { buildShellJobHelper } from './helpers/shellJobBuild'
import { removeFolder } from './helpers/temporaryFolders'

const HELPER_BUILD_TIMEOUT_MS = 120_000
// A command that joins its job, starts a grandchild and is killed: two cold
// PowerShell starts of the test's own (the command, and the fallback's sweep).
const CASE_TIMEOUT_MS = 120_000
const GRANDCHILD_LIFETIME_MS = 600_000
const POLL_MS = 100

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The production runner, recording each program it is asked to run. */
function recordingRun(calls: { file: string; args: readonly string[] }[]): RunProgram {
  return (file, args, env, timeoutMs) => {
    calls.push({ file, args })
    return runProgram(file, args, env, timeoutMs)
  }
}

describe.runIf(process.platform === 'win32')(
  'the legacy shell stop on a real Windows job',
  { timeout: CASE_TIMEOUT_MS },
  () => {
    const systemRoot = process.env['SystemRoot'] ?? ''
    const powershellFile = path.win32.join(systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH)
    let storageDir = ''
    let assembly = ''

    beforeAll(async () => {
      const built = await buildShellJobHelper('muse-tree-stop-', systemRoot)
      storageDir = built.storageDir
      assembly = built.assembly
    }, HELPER_BUILD_TIMEOUT_MS)
    afterAll(async () => {
      await removeFolder(storageDir)
    })

    /**
    A shell command as the shell tool starts one: PowerShell, its job joined
    first when it has one, then a detached grandchild whose id it writes down.
    */
    async function command(join: string): Promise<{
      readonly root: ReturnType<typeof spawnGuarded>
      readonly grandchild: number
      readonly startedAt: number
    }> {
      const pidFile = path.join(storageDir, `grandchild-${String(Date.now())}.txt`)
      const powershell = windowsPowerShell(systemRoot, { SystemRoot: systemRoot })
      const grandchild = `setTimeout(() => {}, ${String(GRANDCHILD_LIFETIME_MS)})`
      const startedAt = Date.now()
      const root = spawnGuarded(
        powershell.file,
        [
          ...WINDOWS_POWERSHELL_COMMAND_ARGS,
          `${join}$p = [Diagnostics.Process]::Start(${powerShellQuoted(process.execPath)}, ${powerShellQuoted(`-e "${grandchild}"`)}); [IO.File]::WriteAllText(${powerShellQuoted(pidFile)}, [string]$p.Id); [Threading.Thread]::Sleep(${String(GRANDCHILD_LIFETIME_MS)})`,
        ],
        { env: powershell.env, windowsHide: true, stdio: 'ignore' },
      )
      for (;;) {
        if (root.exitCode !== null) throw new Error('the command ended before it started its child')
        try {
          const text = await readFile(pidFile, 'utf8')
          if (text !== '') return { root, grandchild: Number(text), startedAt }
        } catch (error: unknown) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        }
        await delay(POLL_MS)
      }
    }

    /**
    A command started and then stopped by the product's tree kill, with the
    programs the stop ran and what it logged. Whether the command and its
    grandchild still run is read before this suite's own cleanup.
    */
    async function stopCommand(isJoined: boolean): Promise<{
      readonly job: ReturnType<typeof newShellJob>
      readonly pid: number | undefined
      readonly calls: readonly { file: string; args: readonly string[] }[]
      readonly logs: readonly string[]
      readonly isRootEnded: boolean
      readonly isGrandchildRunning: boolean
    }> {
      const job = newShellJob(assembly)
      const { root, grandchild, startedAt } = await command(isJoined ? joinStatement(job) : '')
      const calls: { file: string; args: readonly string[] }[] = []
      const logs: string[] = []
      try {
        await killTree(
          root,
          {
            platform: 'win32',
            systemRoot,
            log: (message) => {
              logs.push(message)
            },
            run: recordingRun(calls),
          },
          startedAt,
          job,
        )
        return {
          job,
          pid: root.pid,
          calls,
          logs,
          isRootEnded: root.exitCode !== null || root.signalCode !== null,
          isGrandchildRunning: isRunning(grandchild),
        }
      } finally {
        if (root.exitCode === null) root.kill()
        if (isRunning(grandchild)) process.kill(grandchild)
      }
    }

    it('ends a joined command and its grandchild with the job, through the job helper alone', async () => {
      const stopped = await stopCommand(true)
      expect(stopped.isRootEnded).toBe(true)
      expect(stopped.isGrandchildRunning).toBe(false)
      // One program ran for the stop: the job helper's terminate, no PowerShell.
      expect(stopped.calls).toEqual([
        { file: assembly, args: ['terminate', stopped.job.name, '1'] },
      ])
      expect(stopped.calls.map((call) => call.file)).not.toContain(powershellFile)
      expect(stopped.logs).toEqual([])
    })

    it('falls back to taskkill when the command’s job is not there', async () => {
      // A job the command never joined: the helper answers that it is not there.
      const stopped = await stopCommand(false)
      expect(stopped.isRootEnded).toBe(true)
      expect(stopped.calls[0]).toEqual({
        file: assembly,
        args: ['terminate', stopped.job.name, '1'],
      })
      expect(stopped.calls[1]?.args).toEqual(['/PID', String(stopped.pid), '/T', '/F'])
      expect(stopped.logs[0]).toContain('was not there (the helper answered false)')
      expect(stopped.isGrandchildRunning).toBe(false)
    })
  },
)
