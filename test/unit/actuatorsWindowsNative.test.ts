// M107 lane A, the Windows job rows, on a real Windows job. The production
// actuator (WindowsResourceActuator behind ResourceActuators) and the
// production tree reader drive a real owned job holding a real child, through
// the real shell-job assembly, Windows PowerShell and the Win32 job API, with
// no elevation. Every state is read back from the operating system, never
// from the actuator's own answer: the job's CPU rate control and priority
// class from QueryInformationJobObject (the helper's Read calls), and the
// child's priority class from .NET's Process, which asks the OS separately.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ResourceActuators } from '../../src/core/resources/actuators'
import { WindowsResourceActuator } from '../../src/core/resources/actuators/windows'
import { runTreeProgram } from '../../src/core/resources/trees/run'
import {
  callWindowsJobHelper,
  WindowsResourceTreeReader,
  type WindowsTreeDeps,
} from '../../src/core/resources/trees/windows'
import { windowsPowerShell } from '../../src/core/execGuard'
import { spawnGuarded } from '../../src/core/guardedChildProcess'
import { powerShellQuoted } from '../../src/core/shellQuote'
import { joinStatement, newShellJob, shellJobAssembly } from '../../src/host/backend/shellJob'
import { runProgram } from '../../src/host/processTree'
import {
  RESOURCE_JOB_CPU_RATE_PERCENT,
  SHELL_JOB_TYPE_NAME,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
} from '../../src/shared/constants'
import type { ResourceProcessIdentity, ResourceTicket } from '../../src/shared/resources'
import { readJobSource } from './helpers/jobSource'
import { removeFolder } from './helpers/temporaryFolders'

// Windows ABI value: JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | ..._HARD_CAP.
const ENABLE_HARD_CAP = 5
// The rate unit is one hundredth of a percent.
const RATE_UNITS_PER_PERCENT = 100
// The 50% hard cap as the OS reads it back.
const CAPPED_RATE = {
  flags: ENABLE_HARD_CAP,
  rate: RESOURCE_JOB_CPU_RATE_PERCENT * RATE_UNITS_PER_PERCENT,
}
// The owned child sleeps this long unless the test ends it first.
const CHILD_LIFETIME_MS = 600_000
const MEMBER_POLL_MS = 250
// Each control call is a cold Windows PowerShell start, and a throttle, a
// pause and a retirement make dozens of them: 9 s warm and 22 s cold on the
// owner's PC (2026-10-30), several times that on a hosted runner. PLAN.md §8.
const REAL_WINDOWS_JOB_TIMEOUT_MS = 120_000
const HELPER_BUILD_TIMEOUT_MS = 120_000

/** The ticket the governor would hold for a check running in the owned job. */
function ticketFor(job: { name: string }, root: ResourceProcessIdentity): ResourceTicket {
  return {
    id: 'cc-winruns',
    root,
    scope: { type: 'job', name: job.name },
    kind: 'check',
    class: 'background',
    sessionId: null,
  }
}

/** The helper's (job, pid, birth) arguments for one member. */
function target(job: { name: string }, root: ResourceProcessIdentity): string {
  return `${powerShellQuoted(job.name)}, ${String(root.pid)}, ${powerShellQuoted(root.startTime)}`
}

describe.runIf(process.platform === 'win32')(
  'Windows job CPU rate and priority on a real job',
  { timeout: REAL_WINDOWS_JOB_TIMEOUT_MS },
  () => {
    const systemRoot = process.env['SystemRoot'] ?? ''
    let storageDir = ''
    let deps: WindowsTreeDeps
    let reader: WindowsResourceTreeReader

    beforeAll(async () => {
      storageDir = await mkdtemp(path.join(tmpdir(), 'muse-actuator-win-'))
      const buildLog: string[] = []
      const assembly = await shellJobAssembly({
        storageDir,
        systemRoot,
        log: (message) => {
          buildLog.push(message)
        },
        readJobSource,
        // The real execFile runner: the default governed compiler needs a
        // configured resource host, which a bare test process has none of.
        run: runProgram,
      })()
      if (assembly === undefined)
        throw new Error(`the shell-job helper did not build here: ${buildLog.join('; ')}`)
      deps = { assemblyPath: assembly, systemRoot }
      reader = new WindowsResourceTreeReader(deps)
    }, HELPER_BUILD_TIMEOUT_MS)
    afterAll(async () => {
      await removeFolder(storageDir)
    })

    /** One owned finite child in its own named job; the job ends with the child. */
    async function withOwnedJob<T>(
      body: (job: { name: string; root: ResourceProcessIdentity; pid: number }) => Promise<T>,
    ): Promise<T> {
      const job = newShellJob(deps.assemblyPath)
      const powershell = windowsPowerShell(systemRoot, { SystemRoot: systemRoot })
      const child = spawnGuarded(
        powershell.file,
        [
          ...WINDOWS_POWERSHELL_COMMAND_ARGS,
          `${joinStatement(job, true)}[Threading.Thread]::Sleep(${String(CHILD_LIFETIME_MS)})`,
        ],
        { env: powershell.env, windowsHide: true, stdio: 'ignore' },
      )
      const pid = child.pid
      if (pid === undefined) throw new Error('the owned child did not start')
      try {
        // The job exists once the child has joined it; a refused join ends the child.
        let root: ResourceProcessIdentity | null = null
        while (root === null) {
          if (child.exitCode !== null) throw new Error('the owned child ended before it joined')
          root = await reader.rootOfJob(job.name)
          if (root === null) await delay(MEMBER_POLL_MS)
        }
        expect(root.pid).toBe(pid)
        return await body({ name: job.name, root, pid })
      } finally {
        // Our own child, by its pid: ended here and nowhere else.
        child.kill()
      }
    }

    /** The job's CPU rate control, as the OS answers QueryInformationJobObject. */
    async function jobRate(job: { name: string }, root: ResourceProcessIdentity): Promise<unknown> {
      return await callWindowsJobHelper(
        deps,
        runTreeProgram,
        `[${SHELL_JOB_TYPE_NAME}]::ReadResourceRate(${target(job, root)})`,
      )
    }

    /** The job's priority class and each member's, as the OS answers. */
    async function jobPriority(
      job: { name: string },
      root: ResourceProcessIdentity,
    ): Promise<unknown> {
      return await callWindowsJobHelper(
        deps,
        runTreeProgram,
        `[${SHELL_JOB_TYPE_NAME}]::ReadResourcePriority(${target(job, root)})`,
      )
    }

    /** The child's priority class from .NET's Process: a second, separate OS read. */
    async function priorityClass(pid: number): Promise<string> {
      const powershell = windowsPowerShell(systemRoot, { SystemRoot: systemRoot })
      const text = await runTreeProgram(
        powershell.file,
        [
          ...WINDOWS_POWERSHELL_COMMAND_ARGS,
          `[Diagnostics.Process]::GetProcessById(${String(pid)}).PriorityClass.ToString()`,
        ],
        powershell.env,
      )
      return text.trim()
    }

    /** All three OS readbacks of one owned job and its child, in one value. */
    async function snapshot(job: { name: string; root: ResourceProcessIdentity; pid: number }) {
      return {
        rate: await jobRate(job, job.root),
        priority: await jobPriority(job, job.root),
        priorityClass: await priorityClass(job.pid),
      }
    }

    it('throttles, pauses and retires a real job: rate 5000 and the classes read back, the originals restored exactly', async () => {
      await withOwnedJob(async (job) => {
        const ticket = ticketFor(job, job.root)
        const actuators = new ResourceActuators(reader, new WindowsResourceActuator(deps))
        const original = await snapshot(job)
        // A fresh job holds no CPU limit, which is what the restoration returns to.
        expect(original.rate).toEqual({ flags: 0, rate: 0 })

        expect(await actuators.setLevel(ticket, 'throttle')).toEqual([
          { control: 'jobPriority', status: 'applied' },
          { control: 'jobCpuRate', status: 'applied' },
        ])
        expect(await snapshot(job)).toMatchObject({
          rate: CAPPED_RATE,
          priority: {
            priority: 'belowNormal',
            processes: [{ ...job.root, priority: 'belowNormal' }],
          },
          priorityClass: 'BelowNormal',
        })

        expect(await actuators.setLevel(ticket, 'pause')).toContainEqual({
          control: 'jobPriority',
          status: 'applied',
        })
        expect(await snapshot(job)).toMatchObject({
          rate: CAPPED_RATE,
          priority: { priority: 'idle', processes: [{ ...job.root, priority: 'idle' }] },
          priorityClass: 'Idle',
        })

        const retired = await actuators.retire(ticket)
        expect(retired.retired).toBe(true)
        expect(await snapshot(job)).toEqual(original)
      })
    })

    it('refuses a reused birth: a wrong start time changes nothing in the job', async () => {
      await withOwnedJob(async (job) => {
        const ticket = ticketFor(job, { pid: job.root.pid, startTime: '1' })
        const actuators = new ResourceActuators(reader, new WindowsResourceActuator(deps))
        const original = await snapshot(job)

        expect(await actuators.setLevel(ticket, 'pause')).toEqual([
          { control: null, status: 'unknown' },
        ])
        expect(await snapshot(job)).toEqual(original)
      })
    })
  },
)
