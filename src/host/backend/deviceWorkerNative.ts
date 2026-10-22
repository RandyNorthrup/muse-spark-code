// Compile-once native Devices helper. M27/M50 sources and fallbacks stay untouched.
import { execFile } from 'node:child_process'
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import { DEVICE_LIMITS, POSIX_TREE_EXIT_POLL_MS, SHELL_JOB_FOLDER } from '../../shared/constants'
import type { Logger } from '../logger'
import { failureForLog } from '../../core/backends/musecode/logText'
import { isErrno } from '../../core/fs/errno'
import { noWorkspaceChildEnvironment } from '../../core/execGuard'
import { workerEnvironment } from '../../core/team/refFence'
import { compileJob, jobFileName, type JobBuild } from './jobBuild'
import {
  admittedProcessLimit,
  deviceWorkerRefused,
  deviceWorkerUncertain,
  DeviceWorkerHostError,
  parseDeviceWorkerQuery,
  type DeviceWorkerDriver,
  type DeviceWorkerLaunch,
} from '../devices/deviceWorkerHost'
import type { RunProgram } from '../processTree'

const build: JobBuild = {
  stem: 'MuseSparkDeviceWorker-',
  extension: '.exe',
  outputType: 'exe',
  references: ['System.Web.Extensions.dll', 'Microsoft.CSharp.dll'],
  label: 'device worker',
  isPresent: async (file) => {
    try {
      await access(file)
      return true
    } catch (error) {
      if (isErrno(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return false
      throw error
    }
  },
}
// The in-process job probe only: Task Scheduler launch and the session/station refusal are
// exercised by each real launch, so the helper reports the scheduler as untested here.
const selfTestSchema = z.strictObject({
  jobProbe: z.literal(true),
  query: z.literal(true),
  power: z.enum(['ac', 'battery', 'unknown']),
  scheduler: z.literal('untested'),
})
const taskStateSchema = z.strictObject({
  state: z.enum(['running', 'unknown']),
  lastExitCode: z.int(),
})

const run: RunProgram = (file, args, env) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      file,
      [...args],
      {
        env,
        windowsHide: true,
        timeout: DEVICE_LIMITS.frameDeadlineMs,
        maxBuffer: DEVICE_LIMITS.frameBytes,
      },
      (error, stdout) => {
        if (error === null) resolve(stdout)
        else
          reject(
            new DeviceWorkerHostError(
              typeof error.code === 'number' && error.code >>> 0 === Number('0xc0000142')
                ? 'desktop-heap'
                : 'helper',
            ),
          )
      },
    )
    child.stdin?.end()
  })

function isHelperUnusable(error: unknown): boolean {
  return isErrno(error) || error instanceof DeviceWorkerHostError || error instanceof SyntaxError
}

export interface DeviceWorkerNativeDeps {
  readonly storageDir: string
  readonly systemRoot: string
  readonly sourceFile: string
  readonly environment: NodeJS.ProcessEnv
  readonly log: Logger
  /** Helper calls, bounded by the frame deadline. */
  readonly run?: RunProgram
  /** The compiler; omitted, compileJob's own runner and its longer compiler deadline. */
  readonly compile?: RunProgram
}

async function readBounded(file: string): Promise<unknown> {
  const { size } = await stat(file)
  if (size > DEVICE_LIMITS.frameBytes) throw new DeviceWorkerHostError('result')
  const data = await readFile(file)
  if (data.byteLength > DEVICE_LIMITS.frameBytes) throw new DeviceWorkerHostError('result')
  const parsed: unknown = JSON.parse(data.toString('utf8'))
  return parsed
}

/** Windows Task Scheduler under the signed-in user; never a transport child. */
export function deviceWorkerNative(deps: DeviceWorkerNativeDeps): DeviceWorkerDriver {
  const invoke = deps.run ?? run
  const env = noWorkspaceChildEnvironment(
    'win32',
    workerEnvironment(deps.environment, 'win32'),
    realpathSync,
  )
  let executable: string | undefined
  const jobs = new Set<string>()
  let creating: Promise<void> = Promise.resolve()
  const allocate = async (root: string, directory: string): Promise<void> => {
    let unlock: { resolve(): void } | undefined
    const next = new Promise<void>((resolve) => {
      unlock = { resolve }
    })
    if (unlock === undefined) throw new DeviceWorkerHostError('helper')
    const previous = creating
    creating = next
    try {
      await previous
      await mkdir(root, { recursive: true })
      await mkdir(directory)
    } finally {
      unlock.resolve()
    }
  }
  let preparing: Promise<boolean> | undefined
  const isPrepared = async (): Promise<boolean> => {
    try {
      const source = await readFile(deps.sourceFile, 'utf8')
      const target = path.join(deps.storageDir, SHELL_JOB_FOLDER, jobFileName(build, source))
      if (!(await build.isPresent(target)))
        await compileJob(build, target, source, deps.systemRoot, deps.compile)
      const answer: unknown = JSON.parse(await invoke(target, ['--self-test'], env))
      if (!selfTestSchema.safeParse(answer).success) return false
      executable = target
      return true
    } catch (error) {
      if (isHelperUnusable(error)) return false
      throw error
    }
  }
  const call = async (args: string[]): Promise<string> => {
    const isReady = await (preparing ??= isPrepared())
    if (executable === undefined || !isReady) throw new DeviceWorkerHostError('helper')
    return await invoke(executable, args, env)
  }
  return {
    platform: 'win32',
    selfTest: () => (preparing ??= isPrepared()),
    query: async () => {
      const answer: unknown = JSON.parse(await call(['--query']))
      const total = parseDeviceWorkerQuery(answer)
      for (const id of jobs) {
        const sample: unknown = JSON.parse(await call(['--query', id]))
        const parsed = parseDeviceWorkerQuery(sample)
        total.sleepInhibited ||= parsed.sleepInhibited
        total.activeProcesses += parsed.activeProcesses
        total.cpu100ns += parsed.cpu100ns
        total.peakMemoryBytes += parsed.peakMemoryBytes
      }
      return total
    },
    launch: async (command, environment, attempt): Promise<DeviceWorkerLaunch> => {
      // Before any helper call or directory: the job's ActiveProcessLimit is this attempt's ceiling.
      let maxProcesses: number
      try {
        maxProcesses = admittedProcessLimit(attempt)
      } catch (error) {
        return deviceWorkerRefused(error)
      }
      const id = randomUUID().replaceAll('-', '')
      const root = path.join(deps.storageDir, 'device-workers')
      const directory = path.join(root, id)
      const file = (name: string) => path.join(directory, name)
      const config = {
        id,
        directory,
        executable: command.executable,
        args: command.args,
        cwd: command.cwd,
        environment,
        outputBytes: DEVICE_LIMITS.frameBytes,
        maxProcesses,
        readyTimeoutMs: DEVICE_LIMITS.frameDeadlineMs,
        pollMs: POSIX_TREE_EXIT_POLL_MS,
      }
      const encoded = JSON.stringify(config)
      // Refusals before the attempt directory exists allocate nothing.
      if (Buffer.byteLength(encoded) > DEVICE_LIMITS.frameBytes)
        return deviceWorkerRefused(new DeviceWorkerHostError('preflight'))
      try {
        await allocate(root, directory)
      } catch (error) {
        return deviceWorkerRefused(error)
      }
      const didRemoveAttemptDirectory = async (): Promise<boolean> => {
        try {
          await rm(directory, { recursive: true, force: true })
          return true
        } catch (error) {
          if (isErrno(error)) return false
          throw error
        }
      }
      const writeStopFile = async (): Promise<void> => {
        try {
          await writeFile(file('stop'), '')
        } catch (error) {
          deps.log.error(`Devices native stop file failed: ${failureForLog(error)}`)
        }
      }
      const stopTask = async (): Promise<void> => {
        try {
          await call(['--stop', id])
        } catch (error) {
          deps.log.error(`Devices native stop failed: ${failureForLog(error)}`)
        }
      }
      const didRemoveTask = async (): Promise<boolean> => {
        try {
          await call(['--remove', id])
          return true
        } catch (error) {
          if (error instanceof DeviceWorkerHostError) {
            deps.log.error(`Devices native remove failed: ${failureForLog(error)}`)
            return false
          }
          throw error
        }
      }
      const didRemoveHeapDirectory = async (): Promise<boolean> => {
        try {
          await rm(directory, { recursive: true, force: true })
          return true
        } catch (error) {
          if (isErrno(error)) return false
          throw error
        }
      }
      try {
        // A refused helper is known before any helper call, so nothing can have started.
        if (!(await (preparing ??= isPrepared()))) throw new DeviceWorkerHostError('helper')
        await writeFile(file('request.json'), encoded, { flag: 'wx', mode: Number('0o600') })
      } catch (error) {
        // No helper was called: removing the directory proves nothing remains.
        return (await didRemoveAttemptDirectory())
          ? deviceWorkerRefused(error)
          : deviceWorkerUncertain(error)
      }
      // Set only by the task's own last result: it ran once and failed in DLL initialization.
      const startup = { isHeap: false }
      const waitFor = async (name: string): Promise<unknown> => {
        const deadline = Date.now() + DEVICE_LIMITS.frameDeadlineMs
        while (Date.now() < deadline) {
          if (await build.isPresent(file(name))) return await readBounded(file(name))
          if (await build.isPresent(file('result.json'))) throw new DeviceWorkerHostError('helper')
          await delay(POSIX_TREE_EXIT_POLL_MS)
        }
        const status: unknown = JSON.parse(await call(['--task-state', id]))
        const state = taskStateSchema.parse(status)
        if (state.lastExitCode >>> 0 === Number('0xc0000142')) {
          startup.isHeap = state.state !== 'running'
          throw new DeviceWorkerHostError('desktop-heap')
        }
        throw new DeviceWorkerHostError('helper')
      }
      try {
        await call(['--launch', file('request.json')])
        const query = await waitFor('ready.json')
        jobs.add(id)
        const retirement = (async (): Promise<unknown> => {
          let nextCheck = Date.now() + DEVICE_LIMITS.frameDeadlineMs
          for (;;) {
            if (await build.isPresent(file('result.json')))
              return await readBounded(file('result.json'))
            if (await build.isPresent(file('diagnostic.json'))) {
              const error = new DeviceWorkerHostError('result')
              error.cause = await readBounded(file('diagnostic.json'))
              throw error
            }
            // Task state is an uncertainty check only; it NEVER resolves retirement.
            if (Date.now() >= nextCheck) {
              const status: unknown = JSON.parse(await call(['--task-state', id]))
              if (taskStateSchema.parse(status).state !== 'running')
                throw new DeviceWorkerHostError('result')
              nextCheck = Date.now() + DEVICE_LIMITS.frameDeadlineMs
            }
            await delay(POSIX_TREE_EXIT_POLL_MS)
          }
        })()
        // The host attaches its consumer after readiness validation.
        void retirement.catch((error: unknown) => {
          if (error instanceof DeviceWorkerHostError) return
          deps.log.error(`Devices native retirement failed: ${failureForLog(error)}`)
        })
        return {
          kind: 'launched',
          job: {
            query,
            retirement,
            activate: () => writeFile(file('go'), '', { flag: 'wx' }),
            cancel: async () => {
              await writeFile(file('stop'), '')
              await call(['--stop', id])
            },
            remove: async () => {
              jobs.delete(id)
              await call(['--remove', id])
              await rm(directory, { recursive: true, force: true })
            },
          },
        }
      } catch (error) {
        // A late helper start is still refused by the removed task below, or retained.
        await writeStopFile()
        // Uncertainty is retained; no fallback spawn or PID kill.
        await stopTask()
        // A failed task removal is retained for local recovery.
        const isRemoved = await didRemoveTask()
        // The single on-demand run ended in DLL initialization, before any job or child, and its
        // task cannot start again: removing the directory then proves nothing remains.
        if (isRemoved && startup.isHeap && (await didRemoveHeapDirectory()))
          return deviceWorkerRefused(error)
        // Preserve evidence; no timer or failed query proves an empty job.
        return deviceWorkerUncertain(error)
      }
    },
  }
}
