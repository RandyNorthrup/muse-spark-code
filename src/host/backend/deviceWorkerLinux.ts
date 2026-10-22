// M100/H: a user service owns the tree; the transport only carries bounded pipes.
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import { UI_TEXT } from '../../shared/l10n/text'
import { deviceAttemptIdentitySchema } from '../../shared/devices'
import { noWorkspaceChildEnvironment } from '../../core/execGuard'
import { workerEnvironment } from '../../core/team/refFence'
import {
  DEVICE_LIMITS,
  MILLISECONDS_PER_SECOND,
  POSIX_TREE_EXIT_POLL_MS,
} from '../../shared/constants'
import {
  admittedProcessLimit,
  deviceWorkerRefused,
  deviceWorkerUncertain,
  DeviceWorkerHostError,
  parseDeviceWorkerQuery,
  type DeviceWorkerAttempt,
  type DeviceWorkerDriver,
  type DeviceWorkerJob,
  type DeviceWorkerLaunch,
} from '../devices/deviceWorkerHost'
import type { RunProgram } from '../processTree'

const countSchema = z.int().check(z.gte(0))
const pidSchema = z.int().check(z.gte(1))
type Power = 'ac' | 'battery' | 'unknown'
const unitSchema = z.strictObject({
  LoadState: z.enum(['loaded', 'not-found']),
  ActiveState: z.enum(['active', 'activating', 'deactivating', 'inactive', 'failed']),
  SubState: z.string(),
  ControlGroup: z.string(),
  TasksMax: z.string(),
  Result: z.string(),
})

type UnitState = z.infer<typeof unitSchema>
const listedUnitsSchema = z.array(z.looseObject({ unit: z.string() }))
// Linux proc(5): starttime is field 22, after the final ')' of the comm field.
function processIdentity(text: string) {
  const fields = text
    .slice(text.lastIndexOf(')') + 2)
    .trim()
    .split(/\s+/)
  return z
    .strictObject({
      state: z.string().check(z.regex(/^[A-Za-z]$/)),
      start: z.string().check(z.regex(/^[1-9]\d*$/)),
    })
    .parse({ state: fields[0], start: fields[19] })
}

export interface DeviceWorkerLinuxDeps {
  readonly environment: NodeJS.ProcessEnv
  readonly run?: RunProgram
  readonly start?: (
    file: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
  ) => ChildProcessWithoutNullStreams
  readonly read?: (file: string) => Promise<string>
  readonly entries?: (directory: string) => Promise<string[]>
}

const run: RunProgram = (file, args, env) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      file,
      [...args],
      {
        env,
        timeout: DEVICE_LIMITS.frameDeadlineMs,
        maxBuffer: DEVICE_LIMITS.frameBytes,
      },
      (error, stdout) => {
        if (error === null) resolve(stdout)
        else reject(new DeviceWorkerHostError('helper'))
      },
    )
    child.stdin?.end()
  })

/** Keep both pipes bounded. Never interpret stderr (including authorization prose). */
function pipe(child: ChildProcessWithoutNullStreams, overflow: () => void) {
  let stdout = ''
  const decoder = new StringDecoder('utf8')
  let stdoutBytes = 0
  let stderrBytes = 0
  let isOverflow = false
  let isClosed = false
  const excess = () => {
    if (isOverflow) return
    isOverflow = true
    overflow()
  }
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBytes += chunk.byteLength
    if (stdoutBytes > DEVICE_LIMITS.frameBytes) excess()
    else stdout += decoder.write(chunk)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.byteLength
    if (stderrBytes > DEVICE_LIMITS.frameBytes) excess()
  })
  const closed = new Promise<{ exitCode: number; stdout: string; failure: 'none' | 'capacity' }>(
    (resolve, reject) => {
      child.once('error', () => {
        isClosed = true
        reject(new DeviceWorkerHostError('helper'))
      })
      child.once('exit', (_code, signal) => {
        if (signal === null) {
          return
        }

        isClosed = true
        reject(new DeviceWorkerHostError('result'))
      })
      child.once('close', (code, signal) => {
        stdout += decoder.end()
        isClosed = true
        if (code === null || signal !== null) reject(new DeviceWorkerHostError('result'))
        else resolve({ exitCode: code, stdout, failure: isOverflow ? 'capacity' : 'none' })
      })
    },
  )
  // Consumers attach after readiness, which may itself refuse.
  void closed.catch(() => {
    /* Readiness may refuse before the consumer attaches. */
  })
  return { closed, text: () => stdout, isClosed: () => isClosed, isOverflow: () => isOverflow }
}

function groupPath(group: string, file: string): string {
  const normalized = group.replaceAll('\\', '/')
  if (
    !normalized.startsWith('/') ||
    normalized.split('/').includes('..') ||
    normalized.includes('\0')
  )
    throw new DeviceWorkerHostError('helper')
  return path.posix.join('/sys/fs/cgroup', normalized, file)
}

async function ignoreFailure(promise: Promise<unknown> | undefined): Promise<void> {
  try {
    await promise
  } catch {
    /* The original refusal/uncertainty remains authoritative. */
  }
}

/** No user manager, unenforceable task limit or sleep authorization means no worker. */
export function deviceWorkerLinux(deps: DeviceWorkerLinuxDeps): DeviceWorkerDriver {
  const invoke = deps.run ?? run
  const start = deps.start ?? ((file, args, env) => spawn(file, [...args], { env, stdio: 'pipe' }))
  const read = deps.read ?? ((file) => readFile(file, 'utf8'))
  const entries = deps.entries ?? ((directory) => readdir(directory))
  const workerEnv = workerEnvironment(deps.environment, 'linux')
  const runtime = deps.environment['XDG_RUNTIME_DIR']
  // The manager socket is control-plane metadata, never part of the recorded worker environment.
  if (runtime !== undefined) workerEnv['XDG_RUNTIME_DIR'] = runtime
  const env = noWorkspaceChildEnvironment('linux', workerEnv, realpathSync)
  const jobs = new Map<string, { cgroup: string; inhibited(): boolean }>()
  const slots = new Set<string>()
  const boundedRead = async (file: string): Promise<string> => {
    const text = await read(file)
    if (Buffer.byteLength(text) > DEVICE_LIMITS.frameBytes)
      throw new DeviceWorkerHostError('capacity')
    return text
  }
  let hostStart: string | undefined
  const recoverOrphans = async () => {
    hostStart = processIdentity(await boundedRead('/proc/self/stat')).start
    const listed = listedUnitsSchema.parse(
      JSON.parse(
        await invoke(
          '/usr/bin/systemctl',
          ['--user', 'list-units', '--all', '--output=json', 'muse-spark-device-*.service'],
          env,
        ),
      ),
    )
    for (const { unit } of listed) {
      // Receiver incarnation/attempt are already durable in the receiver journal.
      // PID plus kernel starttime distinguishes live hosts even after PID reuse.
      const owner =
        /^muse-spark-device-([1-9]\d*)-([1-9]\d*)-[a-f0-9]{32}-[a-f0-9]{32}-[a-f0-9]{32}(?:-inhibit)?\.service$/.exec(
          unit,
        )
      if (owner === null) continue
      let isAlive = false
      try {
        const identity = processIdentity(await boundedRead(`/proc/${owner[1] ?? ''}/stat`))
        isAlive =
          identity.start === owner[2] &&
          identity.state !== 'Z' &&
          identity.state.toUpperCase() !== 'X'
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      }
      if (isAlive) continue
      // Another restarting host can collect it after listing. Only observed emptiness counts.
      await ignoreFailure(invoke('/usr/bin/systemctl', ['--user', 'stop', unit], env))
      const observed = await state(unit)
      if (observed.ActiveState !== 'inactive' || observed.ControlGroup !== '')
        throw new DeviceWorkerHostError('result')
    }
  }
  let recovering: Promise<void> | undefined
  const manager = async () => {
    if (runtime === undefined || !path.posix.isAbsolute(runtime) || runtime.includes('\0'))
      throw new DeviceWorkerHostError('helper')
    let version: string
    try {
      version = await invoke(
        '/usr/bin/systemctl',
        ['--user', 'show', '--property=Version', '--value'],
        env,
      )
    } catch {
      throw new DeviceWorkerHostError('helper')
    }
    if (version.trim() === '') throw new DeviceWorkerHostError('helper')
    await (recovering ??= recoverOrphans())
  }
  const state = async (unit: string): Promise<UnitState> => {
    const text = await invoke(
      '/usr/bin/systemctl',
      [
        '--user',
        'show',
        unit,
        '--property=LoadState,ActiveState,SubState,ControlGroup,TasksMax,Result',
      ],
      env,
    )
    const raw = Object.fromEntries(
      text
        .trim()
        .split('\n')
        .map((line) => {
          const index = line.indexOf('=')
          return [line.slice(0, index), line.slice(index + 1)]
        }),
    )
    return unitSchema.parse(raw)
  }
  const isEmpty = async (unit: string, group: string): Promise<boolean> => {
    try {
      const events = await boundedRead(groupPath(group, 'cgroup.events'))
      if (!/^populated [01]$/m.test(events)) throw new DeviceWorkerHostError('result')
      return /^populated 0$/m.test(events)
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      // A previously observed cgroup may be collected only when empty. Confirm with the
      // live manager as well; helper loss / a failed manager query is never retirement.
      const observed = await state(unit)
      return (
        observed.ControlGroup === '' &&
        observed.ActiveState === 'inactive' &&
        observed.SubState === 'dead'
      )
    }
  }
  const power = async (): Promise<Power> => {
    try {
      let isDischarging = false
      const supplies = await entries('/sys/class/power_supply')
      for (const supply of supplies) {
        if (supply === '..' || supply.includes('/') || supply.includes('\\')) return 'unknown'
        const root = path.posix.join('/sys/class/power_supply', supply)
        const rawType = await boundedRead(path.posix.join(root, 'type'))
        const type = rawType.trim()
        if (['Mains', 'USB', 'USB_C', 'Wireless'].includes(type)) {
          const online = await boundedRead(path.posix.join(root, 'online'))
          if (online.trim() === '1') return 'ac'
        } else if (type === 'Battery') {
          const rawStatus = await boundedRead(path.posix.join(root, 'status'))
          const status = rawStatus.trim()
          if (status === 'Charging') return 'ac'
          isDischarging ||= status === 'Discharging'
        }
      }
      return isDischarging ? 'battery' : 'unknown'
    } catch {
      return 'unknown'
    }
  }
  const query = async () => {
    await manager()
    const total = parseDeviceWorkerQuery({
      context: { session: 0, station: 'systemd-user', desktop: 'transport' },
      power: await power(),
      sleepInhibited: false,
      activeProcesses: 0,
      cpu100ns: 0,
      peakMemoryBytes: 0,
    })
    for (const [unit, job] of jobs) {
      if (await isEmpty(unit, job.cgroup)) continue
      total.sleepInhibited ||= job.inhibited()
      const processes = await boundedRead(groupPath(job.cgroup, 'cgroup.procs'))
      const pids = processes.trim() === '' ? [] : processes.trim().split('\n')
      // cgroup.procs can repeat a PID while it moves; pids.current counts threads too.
      total.activeProcesses += new Set(pids.map((pid) => pidSchema.parse(Number(pid)))).size
      const cpu = await boundedRead(groupPath(job.cgroup, 'cpu.stat'))
      const usec = countSchema.parse(Number(/^usage_usec (\d+)$/m.exec(cpu)?.[1] ?? NaN))
      // Linux reports microseconds; the port reports 100 ns, the same unit as Windows.
      total.cpu100ns += (usec * 100 * 100) / MILLISECONDS_PER_SECOND
      const memory = await boundedRead(groupPath(job.cgroup, 'memory.peak'))
      total.peakMemoryBytes += countSchema.parse(Number(memory.trim()))
    }
    return total
  }
  const inhibit = async (id: string) => {
    const child = start(
      '/usr/bin/systemd-run',
      [
        '--user',
        '--quiet',
        '--collect',
        '--wait',
        '--pipe',
        '--no-ask-password',
        `--unit=${id.replace(/\.service$/, '-inhibit.service')}`,
        '--service-type=exec',
        '--expand-environment=no',
        '--property=ExitType=cgroup',
        '--property=TasksMax=2',
        '--property=KillMode=control-group',
        '/usr/bin/env',
        '-i',
        ...Object.entries(workerEnvironment(deps.environment, 'linux'))
          .filter((entry): entry is [string, string] => entry[1] !== undefined)
          .map(([key, value]) => `${key}=${value}`),
        '/usr/bin/systemd-inhibit',
        '--no-ask-password',
        '--what=sleep:idle',
        '--mode=block',
        `--who=${id}`,
        `--why=${UI_TEXT.devices.title}`,
        '/bin/sh',
        '-c',
        'printf ready; read -r release',
      ],
      env,
    )
    const output = pipe(child, () => child.kill())
    child.stdin.on('error', () => {
      /* Failure is retained by the owning lifecycle. */
    })
    const release = async () => {
      child.stdin.end('release\n')
      await output.closed
    }
    const deadline = Date.now() + DEVICE_LIMITS.frameDeadlineMs
    try {
      while (output.text() !== 'ready') {
        if (output.isClosed() || output.isOverflow() || Date.now() >= deadline)
          throw new DeviceWorkerHostError('helper')
        await delay(POSIX_TREE_EXIT_POLL_MS)
      }
      return { release, isHeld: () => !output.isClosed(), closed: output.closed }
    } catch (error) {
      child.stdin.end()
      child.kill()
      await ignoreFailure(output.closed)
      throw error
    }
  }
  /** Only the live manager's view proves a unit gone: no cgroup, inactive and dead. */
  const isUnitGone = async (unit: string): Promise<boolean> => {
    try {
      const observed = await state(unit)
      return (
        observed.ControlGroup === '' &&
        observed.ActiveState === 'inactive' &&
        observed.SubState === 'dead'
      )
    } catch {
      return false
    }
  }
  const launch: DeviceWorkerDriver['launch'] = async (command, environment, attempt) => {
    let maxProcesses: number
    let identity: DeviceWorkerAttempt['identity']
    // Every refusal here precedes the slot and any unit: nothing is allocated.
    try {
      maxProcesses = admittedProcessLimit(attempt)
      await manager()
      if (slots.size >= DEVICE_LIMITS.unresolvedAttempts)
        throw new DeviceWorkerHostError('capacity')
      const canonical = workerEnvironment(environment, 'linux')
      if (JSON.stringify(canonical) !== JSON.stringify(environment))
        throw new DeviceWorkerHostError('preflight')
      identity = deviceAttemptIdentitySchema.parse(attempt.identity)
    } catch (error) {
      return deviceWorkerRefused(error)
    }
    const slotId = `${identity.attemptId}-${randomUUID().replaceAll('-', '')}`
    const unit = `muse-spark-device-${String(process.pid)}-${hostStart ?? ''}-${identity.receiverIncarnationId}-${slotId}.service`
    const inhibitor = unit.replace(/\.service$/, '-inhibit.service')
    // The attempt's lifecycle owns this slot: only observed retirement (remove) or a proved
    // refusal releases it, never a failed observer.
    slots.add(slotId)
    let hasSlot = true
    const releaseSlot = () => {
      if (!hasSlot) return
      hasSlot = false
      slots.delete(slotId)
    }
    // After any unit could have started, refuse only once no launcher can still submit a unit
    // and the manager then shows each unit gone; otherwise keep the slot, uncertain.
    const failed = async (
      error: unknown,
      units: readonly string[],
      isLauncherDone: () => Promise<boolean> = () => Promise.resolve(true),
    ): Promise<DeviceWorkerLaunch> => {
      if (!(await isLauncherDone())) return deviceWorkerUncertain(error)
      for (const name of units) if (!(await isUnitGone(name))) return deviceWorkerUncertain(error)
      jobs.delete(unit)
      releaseSlot()
      return deviceWorkerRefused(error)
    }
    let hold: Awaited<ReturnType<typeof inhibit>>
    try {
      hold = await inhibit(unit)
    } catch (error) {
      return await failed(error, [inhibitor])
    }
    let isActivated = false
    let isRetired = false
    let cgroup = ''
    const stop = async () => {
      if (isRetired) return
      try {
        await invoke('/usr/bin/systemctl', ['--user', 'stop', unit], env)
      } catch (error) {
        if (cgroup !== '' && (await isEmpty(unit, cgroup))) return
        throw error
      }
    }
    let stopping: Promise<void> | undefined
    const requestStop = () => {
      stopping ??= stop()
      void stopping.catch(() => {
        /* Failure is retained by the owning lifecycle. */
      })
    }
    let child: ChildProcessWithoutNullStreams
    try {
      child = start(
        '/usr/bin/systemd-run',
        [
          '--user',
          '--quiet',
          '--no-ask-password',
          '--collect',
          '--wait',
          '--pipe',
          `--unit=${unit}`,
          '--service-type=exec',
          '--expand-environment=no',
          '--property=ExitType=cgroup',
          '--property=KillMode=control-group',
          `--property=BindsTo=${inhibitor}`,
          `--property=After=${inhibitor}`,
          '--property=SendSIGKILL=yes',
          `--property=TimeoutStopSec=${String(DEVICE_LIMITS.frameDeadlineMs / MILLISECONDS_PER_SECOND)}s`,
          `--property=TasksMax=${String(maxProcesses)}`,
          `--working-directory=${command.cwd}`,
          '/usr/bin/env',
          '-i',
          ...Object.entries(environment).map(([key, value]) => `${key}=${value}`),
          '/bin/sh',
          '-c',
          'read -r activation && [ "$activation" = go ] || exit 1; exec 0</dev/null; exec "$@"',
          'device-worker',
          command.executable,
          ...command.args,
        ],
        env,
      )
    } catch {
      await ignoreFailure(hold.release())
      return await failed(new DeviceWorkerHostError('helper'), [unit, inhibitor])
    }
    const output = pipe(child, requestStop)
    child.stdin.on('error', () => {
      /* Failure is retained by the owning lifecycle. */
    })
    // Closed and exited (or never spawned): this systemd-run client cannot submit its unit.
    const isLauncherTerminal = () =>
      output.isClosed() &&
      (child.exitCode !== null || child.signalCode !== null || child.pid === undefined)
    // Stop the launcher without activation, then observe it end within the frame deadline.
    const hasLauncherEnded = async (): Promise<boolean> => {
      if (!isLauncherTerminal()) child.kill()
      const deadline = Date.now() + DEVICE_LIMITS.frameDeadlineMs
      while (!isLauncherTerminal() && Date.now() < deadline) await delay(POSIX_TREE_EXIT_POLL_MS)
      return isLauncherTerminal()
    }
    void hold.closed
      .then(() => {
        if (!isRetired) requestStop()
      })
      .catch(requestStop)
    try {
      const deadline = Date.now() + DEVICE_LIMITS.frameDeadlineMs
      for (;;) {
        const ready = await state(unit)
        if (ready.Result === 'resources') throw new DeviceWorkerHostError('capacity')
        if (ready.ActiveState === 'active' && ready.ControlGroup !== '') {
          if (Number(ready.TasksMax) !== maxProcesses) throw new DeviceWorkerHostError('preflight')
          cgroup = ready.ControlGroup
          const transport = await boundedRead('/proc/self/cgroup')
          const normalized = cgroup.replaceAll('\\', '/')
          if (transport.split('\n').includes(`0::${normalized}`))
            throw new DeviceWorkerHostError('context')
          const kernelLimit = await boundedRead(groupPath(cgroup, 'pids.max'))
          if (countSchema.parse(Number(kernelLimit.trim())) !== maxProcesses)
            throw new DeviceWorkerHostError('preflight')
          if (await isEmpty(unit, cgroup)) throw new DeviceWorkerHostError('context')
          break
        }
        if (output.isClosed() || Date.now() >= deadline) throw new DeviceWorkerHostError('helper')
        await delay(POSIX_TREE_EXIT_POLL_MS)
      }
      jobs.set(unit, { cgroup, inhibited: hold.isHeld })
      const retirement = (async () => {
        try {
          const exit = await Promise.race([
            output.closed,
            (async () => {
              await hold.closed
              throw new DeviceWorkerHostError('result')
            })(),
          ])
          // A direct parent / pipe exit is insufficient, even with ExitType=cgroup.
          while (!(await isEmpty(unit, cgroup))) {
            if (!hold.isHeld()) throw new DeviceWorkerHostError('result')
            await delay(POSIX_TREE_EXIT_POLL_MS)
          }
          if (!hold.isHeld()) throw new DeviceWorkerHostError('result')
          isRetired = true
          await hold.release()
          return exit
        } catch {
          // Unproved retirement keeps the slot: the observer never releases it.
          requestStop()
          await ignoreFailure(hold.release())
          throw new DeviceWorkerHostError('result')
        }
      })()
      void retirement.catch(() => {
        /* Failure is retained by the owning lifecycle. */
      })
      const job: DeviceWorkerJob = {
        query: parseDeviceWorkerQuery({
          ...(await query()),
          context: { session: 0, station: 'systemd-user', desktop: cgroup },
        }),
        retirement,
        activate: () => {
          if (isActivated || output.isClosed() || !hold.isHeld())
            return Promise.reject(new DeviceWorkerHostError('helper'))
          isActivated = true
          child.stdin.end('go\n')
          return Promise.resolve()
        },
        cancel: async () => {
          if (isRetired) return
          requestStop()
          await stopping
        },
        remove: () => {
          if (!isRetired) throw new DeviceWorkerHostError('result')
          jobs.delete(unit)
          releaseSlot()
          return Promise.resolve()
        },
      }
      return { kind: 'launched', job }
    } catch (error) {
      requestStop()
      await ignoreFailure(stopping)
      try {
        if (cgroup !== '' && (await isEmpty(unit, cgroup))) jobs.delete(unit)
      } catch {
        /* Emptiness stays unproven; the manager's view below decides. */
      }
      await ignoreFailure(hold.release())
      // An unactivated unit is refused only once its launcher has ended and the manager then
      // shows both units gone.
      return await failed(error, [unit, inhibitor], hasLauncherEnded)
    }
  }
  let preparing: Promise<boolean> | undefined
  const isPrepared = async (): Promise<boolean> => {
    const id = randomUUID().replaceAll('-', '')
    const attempt: DeviceWorkerAttempt = {
      identity: { pairId: id, receiverIncarnationId: id, boardId: id, taskId: id, attemptId: id },
      caps: { workers: 0, processes: 1, heavyChecks: 0, tokens: 0, spendUsd: 0, artifactBytes: 0 },
    }
    let job: DeviceWorkerJob | undefined
    try {
      const clean: Record<string, string> = {}
      const cleanEntries = Object.entries(workerEnvironment(deps.environment, 'linux'))
      for (const [key, value] of cleanEntries) if (value !== undefined) clean[key] = value
      const launched = await launch(
        { executable: '/bin/sh', args: ['-c', 'printf probe'], cwd: '/', requiredTools: [] },
        clean,
        attempt,
      )
      if (launched.kind !== 'launched') return false
      job = launched.job
      parseDeviceWorkerQuery(job.query)
      await job.activate()
      z.strictObject({
        exitCode: z.literal(0),
        stdout: z.literal('probe'),
        failure: z.literal('none'),
      }).parse(await job.retirement)
      await job.remove()
      return true
    } catch {
      await ignoreFailure(job?.cancel())
      // remove() refuses synchronously while retirement is unproved: the slot
      // stays held, and a failed probe still answers false, never a rejection.
      try {
        await job?.remove()
      } catch {
        /* The unproved probe job keeps its slot. */
      }
      return false
    }
  }
  return { platform: 'linux', query, launch, selfTest: () => (preparing ??= isPrepared()) }
}
