import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import { Connection, checkServedFingerprint } from '@muse-code/sdk'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { TeamJournal } from './teamJournal'
import { shellJobAssembly, type ShellJobDeps } from '../backend/shellJob'
import { loadJobAssembly, runProgram, windowsPowerShell } from '../processTree'
import { powerShellQuoted } from '../../core/shellQuote'
import {
  MCP_JOB_HANDSHAKE_MAX_CHARS,
  TEAM_PROCESS_STATUS_MAX_CHARS,
  MCP_JOB_NONCE_BYTES,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
} from '../../shared/constants'
import { createNativeOrphanDriver, createOrphanRecovery } from './orphanRecovery'
import { createProcessOwnership } from './processOwnership'
import { MuseCodeHost } from '../../core/backends/musecode/MuseCodeHost'
import type { CoreLogger } from '../../core/logging'
import { withDeadline } from '../../core/timeouts'
import {
  MSP_CLIENT_NAME,
  MSP_HANDSHAKE_TIMEOUT_MS,
  MSP_REQUESTED_CAPABILITIES,
} from '../../shared/constants'

const NATIVE_POLL_MS = 10
const NATIVE_CONFIRM_MS = 5000
const LAUNCH_GATE_FD = 3
const TEAM_CONFIG_VARIABLE = 'MUSE_SPARK_TEAM_LAUNCH'

/** A separate team MSP host, never the conversation's host. W supplies the
 * resolved CLI command/flags and credential-free environment. The handshake
 * is the installed SDK's request/initialized/flush sequence; MuseCodeHost
 * validates the existing captured initialize shape before initialized. */
export async function startTeamMuseCodeHost(options: {
  readonly lifetime: TeamProcessLifetime
  readonly request: TeamLaunchRequest
  readonly log: CoreLogger
  readonly extensionVersion: string
}): Promise<MuseCodeHost> {
  const contained = await options.lifetime.launch(options.request)
  const child = contained.child
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let hasReportedStderr = false
  child.stderr.on('data', () => {
    if (hasReportedStderr) return
    hasReportedStderr = true
    options.log.warn('The team Muse Code host wrote to stderr')
  })
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null)
      resolve({ code: child.exitCode, signal: child.signalCode })
    else {
      child.once('exit', (code, signal) => {
        resolve({ code, signal })
      })
      child.once('error', reject)
    }
  })
  void exited.catch(() => {
    /* Host construction or its exit listener receives this failure. */
  })
  const incoming = async function* () {
    for await (const chunk of child.stdout) yield z.string().parse(chunk)
  }
  child.stdin.on('error', () => {
    // The write callback rejects the request; Node also emits the same pipe error.
  })
  const connection = new Connection({
    incoming: incoming(),
    write: (chunk) =>
      new Promise<void>((resolve, reject) => {
        child.stdin.write(chunk, 'utf8', (error) => {
          if (error == null) resolve()
          else reject(error)
        })
      }),
    async close(flushed) {
      try {
        await withDeadline(
          flushed ?? Promise.resolve(),
          NATIVE_CONFIRM_MS,
          'TEAM_HOST_FLUSH_TIMEOUT',
        )
      } finally {
        await contained.retire()
      }
    },
  })
  try {
    const initialized = await withDeadline(
      connection.request('initialize', {
        clientInfo: { name: MSP_CLIENT_NAME, version: options.extensionVersion },
        capabilities: {
          userInputDialogs: true,
          requestedCapabilities: [...MSP_REQUESTED_CAPABILITIES],
        },
      }),
      MSP_HANDSHAKE_TIMEOUT_MS,
      'TEAM_HOST_INITIALIZE_TIMEOUT',
    )
    const host = new MuseCodeHost(
      { connection, initializeResult: initialized, exited, close: () => connection.close() },
      options.log,
    )
    // Same field already captured and parsed by MuseCodeHost; no new wire shape.
    const fingerprint = z
      .object({ schema: z.object({ fingerprint: z.string() }) })
      .parse(initialized).schema.fingerprint
    if (checkServedFingerprint(fingerprint) !== undefined)
      options.log.warn('TEAM_HOST_SCHEMA_FINGERPRINT_MISMATCH')
    connection.notify('initialized')
    await connection.flush()
    return host
  } catch (error: unknown) {
    await connection.close()
    throw error
  }
}

/** K's lazy startup entry: reconcile real foreign launches before callers can resume work. */
export async function startNativeTeamLifetime(options: {
  readonly journal: TeamJournal
  readonly isHostBusy: () => boolean
  readonly killGraceMs: number
  readonly windows?: ShellJobDeps
}) {
  const foreign = await options.journal.otherWindows()
  const driver = await createNativeTeamProcessDriver(options)
  const lifetime = createTeamProcessLifetime({ ...options, driver })
  const records: TeamLaunchRecord[] = []
  const unreadable = [...foreign.unreadable]
  for (const journal of foreign.journals)
    records.push(...(await lifetime.recoveryRecords(journal, unreadable)))
  const recovery = createOrphanRecovery(createNativeOrphanDriver())
  const orphans = await recovery.find(records)
  return { lifetime, recovery, orphans, records, unreadable: [...new Set(unreadable)] }
}

const confirmationSchema = z.strictObject({
  pid: z.number().check(z.int(), z.positive()),
  group: z.string().check(z.minLength(1)),
  /** OS identity, not a timestamp inferred from when spawn returned. */
  startTime: z.string().check(z.minLength(1)),
  container: z.enum(['windowsJob', 'linuxScope', 'processGroup']),
  executable: z.optional(z.string().check(z.minLength(1))),
  uid: z.optional(
    z.union([
      z.number().check(z.int(), z.nonnegative()),
      z.string().check(z.regex(/^S-1-[0-9-]+$/)),
    ]),
  ),
  /** Linux membership captured while the leader is held behind the launch gate. */
  cgroup: z.optional(z.string().check(z.minLength(1))),
})
const endSchema = z.strictObject({
  childExited: z.boolean(),
  descendants: z.enum(['proved', 'uncertain']),
  notOwned: z.optional(z.array(z.number().check(z.int(), z.positive()))),
})
const launchSchema = z
  .strictObject({
    id: z.uuid(),
    command: z.string().check(z.minLength(1)),
    cwd: z.string().check(z.minLength(1)),
    taskId: z.string().check(z.minLength(1)),
    confirmation: z.optional(confirmationSchema),
    end: z.optional(endSchema),
  })
  .check(
    z.refine(
      (record) =>
        record.end?.descendants !== 'proved' ||
        (record.end.childExited &&
          record.confirmation !== undefined &&
          record.confirmation.container !== 'processGroup' &&
          (record.end.notOwned?.length ?? 0) === 0),
      { message: 'TEAM_RETIREMENT_PROOF_INVALID' },
    ),
  )

export type TeamLaunchRecord = z.infer<typeof launchSchema>
export type LaunchConfirmation = z.infer<typeof confirmationSchema>
export type Retirement = z.infer<typeof endSchema>

export interface TeamLaunchRequest {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly taskId: string
  /** The worker/bridge supplies its credential-free environment. */
  readonly env: NodeJS.ProcessEnv
  readonly priority: 'belowNormal' | 'normal'
}

export interface ContainedTeamChild {
  readonly child: ChildProcessWithoutNullStreams
  readonly confirmation: Promise<LaunchConfirmation>
  /** Resolves separately from the direct child's exit. */
  readonly ended: Promise<Retirement>
  /** Release a POSIX command only after this confirmation has been persisted. */
  resume?(
    recorded: LaunchConfirmation,
    saveIdentity?: (value: LaunchConfirmation) => Promise<void>,
  ): Promise<void>
  retire(): Promise<Retirement>
}

/** Explicit OS seam. No uncontained spawn or taskkill fallback is accepted here. */
export interface TeamProcessDriver {
  launch(
    request: TeamLaunchRequest,
    launchId: string,
    lifecycle?: TeamLaunchLifecycle,
  ): ContainedTeamChild
}

/** One owner for launch transitions, including synchronous cancellation at dispose. */
class TeamLaunchLifecycle {
  private cancelHeld: (() => void) | undefined
  phase: 'spawning' | 'confirming' | 'released' | 'retiring' | 'ended' = 'spawning'

  hold(cancel: () => void) {
    this.cancelHeld = cancel
    if (this.phase === 'retiring' || this.phase === 'ended') cancel()
  }

  confirm() {
    if (this.phase !== 'spawning') throw new Error('TEAM_PROCESS_LIFETIME_DISPOSED')
    this.phase = 'confirming'
  }

  release() {
    if (this.phase !== 'confirming') throw new Error('TEAM_PROCESS_LIFETIME_DISPOSED')
    this.phase = 'released'
    this.cancelHeld = undefined
  }

  releaseIfHeld() {
    if (this.phase === 'confirming') this.release()
    if (this.phase !== 'released') throw new Error('TEAM_PROCESS_LIFETIME_DISPOSED')
  }

  retire() {
    if (this.phase !== 'ended') this.phase = 'retiring'
    this.cancelHeld?.()
  }

  end() {
    this.phase = 'ended'
    this.cancelHeld = undefined
  }
}

export interface TeamProcessLifetime {
  launch(request: TeamLaunchRequest): Promise<ContainedTeamChild & { readonly launchId: string }>
  dispose(): Promise<readonly Retirement[]>
  recoveryRecords(journal: TeamJournal, unreadable?: string[]): Promise<readonly TeamLaunchRecord[]>
}

/** Constructed only by the lazy team host; construction itself launches nothing. */
export function createTeamProcessLifetime(options: {
  readonly journal: TeamJournal
  readonly driver: TeamProcessDriver
  readonly isHostBusy: () => boolean
}): TeamProcessLifetime {
  const active = new Set<Promise<ContainedTeamChild>>()
  const failedChildren = new Set<ContainedTeamChild>()
  const launches = new Set<TeamLaunchLifecycle>()
  const state = { isDisposed: false }
  const save = (record: TeamLaunchRecord) =>
    options.journal.write(`launch-${record.id}`, record, launchSchema)
  return {
    async launch(request) {
      if (state.isDisposed) throw new Error('TEAM_PROCESS_LIFETIME_DISPOSED')
      if (options.isHostBusy()) throw new Error('TEAM_HOST_BUSY')
      const record = launchSchema.parse({
        id: randomUUID(),
        command: request.command,
        cwd: request.cwd,
        taskId: request.taskId,
      })
      const lifecycle = new TeamLaunchLifecycle()
      launches.add(lifecycle)
      // Register pending work synchronously, so dispose cannot miss a launch awaiting its intent.
      const pending = (async () => {
        await save(record)
        if (state.isDisposed) throw new Error('TEAM_PROCESS_LIFETIME_DISPOSED')
        if (options.isHostBusy()) throw new Error('TEAM_HOST_BUSY')
        const launched = options.driver.launch(
          {
            ...request,
            env: { ...request.env, MUSE_SPARK_LAUNCH_ID: record.id },
          },
          record.id,
          lifecycle,
        )
        try {
          let confirmation = confirmationSchema.parse(await launched.confirmation)
          lifecycle.confirm()
          await save({ ...record, confirmation })
          if (lifecycle.phase !== 'confirming') throw new Error('TEAM_PROCESS_LIFETIME_DISPOSED')
          if (launched.resume === undefined) lifecycle.release()
          else
            await launched.resume(confirmation, async (value) => {
              const updated = confirmationSchema.parse(value)
              await save({ ...record, confirmation: updated })
              confirmation = updated
            })
          lifecycle.releaseIfHeld()
          let endTail = Promise.resolve<Retirement | undefined>(undefined)
          const recordEnd = (raw: Retirement): Promise<Retirement> => {
            const previousTail = endTail
            const saved = (async () => {
              const previous = await previousTail
              const end = launchSchema.parse({ ...record, confirmation, end: raw }).end
              if (end === undefined) throw new Error('TEAM_RETIREMENT_MISSING')
              if (previous?.descendants === 'proved') return previous
              await save({ ...record, confirmation, end })
              if (end.descendants === 'proved') {
                lifecycle.end()
                launches.delete(lifecycle)
              }
              return end
            })()
            // Preserve a successful outcome, but let persistence retry after a rejected write.
            endTail = (async () => {
              const [outcome] = await Promise.allSettled([saved])
              return outcome.status === 'fulfilled' ? outcome.value : await previousTail
            })()
            return saved
          }
          const ended = (async () => {
            return await recordEnd(await launched.ended)
          })()
          // Prevent an unhandled rejection if the caller is still working with the pipes.
          void ended.catch(() => {
            // The returned ended promise retains this rejection for its caller.
          })
          return {
            ...launched,
            ended,
            retire: async () => {
              lifecycle.retire()
              return await recordEnd(await launched.retire())
            },
          }
        } catch (error: unknown) {
          // Confirmation/journal failure must not hide a child whose retirement is uncertain.
          failedChildren.add(launched)
          lifecycle.retire()
          await launched.retire()
          throw error
        }
      })()
      active.add(pending)
      try {
        const launched = await pending
        void (async () => {
          const end = await launched.ended
          if (end.descendants === 'proved') active.delete(pending)
        })().catch(() => {
          // A failed end remains open in the journal and counted in active.
        })
        return { ...launched, launchId: record.id }
      } catch (error: unknown) {
        active.delete(pending)
        if (lifecycle.phase === 'spawning') launches.delete(lifecycle)
        throw error
      }
    },
    async dispose() {
      state.isDisposed = true
      for (const lifecycle of launches) lifecycle.retire()
      const outcomes = await Promise.allSettled([
        ...[...active].map(async (pending) => {
          const launched = await pending
          return await launched.retire()
        }),
        ...[...failedChildren].map(async (launched) => {
          await launched.retire()
          // No validated confirmation: do not turn an adapter's assertion into proof.
          return { childExited: false, descendants: 'uncertain' as const }
        }),
      ])
      return outcomes.map((outcome) =>
        outcome.status === 'fulfilled'
          ? outcome.value
          : { childExited: false, descendants: 'uncertain' },
      )
    },
    async recoveryRecords(journal, unreadable) {
      const records: TeamLaunchRecord[] = []
      const names = await journal.names()
      for (const name of names) {
        if (!name.startsWith('launch-')) continue
        const result = await journal.read(name, launchSchema)
        if (result.kind === 'broken') unreadable?.push(result.file)
        if (result.kind === 'record' && result.value.end?.descendants !== 'proved') {
          records.push(result.value)
        }
      }
      return records
    },
  }
}

/** Prepare only when the lazy team starts. A chosen container never falls back after launch. */
export async function createNativeTeamProcessDriver(options: {
  readonly killGraceMs: number
  readonly windows?: ShellJobDeps
}): Promise<TeamProcessDriver> {
  if (process.platform === 'win32') {
    if (options.windows === undefined) throw new Error('TEAM_WINDOWS_JOB_UNAVAILABLE')
    const assembly = await shellJobAssembly(options.windows)()
    if (assembly === undefined) throw new Error('TEAM_WINDOWS_JOB_UNAVAILABLE')
    return windowsTeamDriver(assembly, options.windows.systemRoot)
  }
  if (process.platform !== 'linux' && process.platform !== 'darwin')
    throw new Error('TEAM_PLATFORM_UNSUPPORTED')
  const probeEnv = { PATH: process.env['PATH'], XDG_RUNTIME_DIR: process.env['XDG_RUNTIME_DIR'] }
  const canRun = async (file: string, args: readonly string[]) => {
    try {
      await runProgram(file, [...args], probeEnv)
      return true
    } catch {
      return false
    }
  }
  let hasScope = false
  let hasSetpriv = false
  if (process.platform === 'linux') {
    hasSetpriv = await canRun('setpriv', ['--pdeathsig', 'KILL', '--', 'true'])
    try {
      await readFile('/sys/fs/cgroup/cgroup.controllers', 'utf8')
      hasScope = await canRun('systemd-run', [
        '--user',
        '--scope',
        '--collect',
        '--quiet',
        '--',
        'true',
      ])
    } catch {
      /* No delegated cgroup v2 user scope: use the specified process-group path. */
    }
  }
  const observer = createNativeOrphanDriver()
  return {
    launch(request, launchId, lifecycle = new TeamLaunchLifecycle()) {
      const unit = `muse-spark-${launchId}.scope`
      // The shell remains the group leader until exec, preserving PID and start identity.
      // Its private fd is closed before the command runs; stdin remains the command's pipe.
      let command = '/bin/sh'
      let args = [
        '-c',
        'IFS= read -r launch <&3 && [ "$launch" = "$MUSE_SPARK_LAUNCH_ID" ] && exec 3<&- && exec "$@"',
        'team-launch',
        request.command,
        ...request.args,
      ]
      if (hasSetpriv) {
        args = ['--pdeathsig', 'KILL', '--', command, ...args]
        command = 'setpriv'
      }
      if (hasScope) {
        args = [
          '--user',
          '--scope',
          '--collect',
          '--quiet',
          `--unit=${unit}`,
          '--property=KillMode=control-group',
          '--',
          command,
          ...args,
        ]
        command = 'systemd-run'
        if (hasSetpriv) {
          args = ['--pdeathsig', 'KILL', '--', command, ...args]
          command = 'setpriv'
        }
      }
      const child = spawn(command, args, {
        cwd: request.cwd,
        env: { ...probeEnv, ...request.env, MUSE_SPARK_LAUNCH_ID: launchId },
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      })
      const gate = child.stdio[LAUNCH_GATE_FD]
      if (gate === null || gate === undefined || !('write' in gate))
        throw new Error('TEAM_LAUNCH_GATE_UNAVAILABLE')
      gate.on('error', () => {
        // resume's write callback reports pipe failure; retirement can also close the gate.
      })
      lifecycle.hold(() => gate.end())
      const exited = new Promise<boolean>((resolve, reject) => {
        child.once('exit', () => {
          resolve(true)
        })
        child.once('error', reject)
      })
      void exited.catch(() => {
        /* The confirmation and ended promises carry spawn failure. */
      })
      const state = { cgroup: '', isExited: false, hasEmptyProof: false }
      void exited
        .then(() => {
          state.isExited = true
        })
        .catch(() => {
          state.isExited = true
        })
      const confirmation = (async (): Promise<LaunchConfirmation> => {
        const deadline = performance.now() + NATIVE_CONFIRM_MS
        while (performance.now() < deadline) {
          if (child.pid === undefined) {
            await exited
            throw new Error('TEAM_PROCESS_NOT_STARTED')
          }
          const observed = await observer.observe(child.pid)
          if (observed !== undefined) {
            if (hasScope) {
              const rawGroup = await runProgram(
                'systemctl',
                ['--user', 'show', unit, '--property=ControlGroup', '--value'],
                probeEnv,
              )
              const group = rawGroup.trim()
              if (group === '' && !state.isExited) {
                await delay(NATIVE_POLL_MS)
                continue
              }
              if (!group.startsWith('/') || group.includes('..'))
                throw new Error('TEAM_SCOPE_NOT_READY')
              state.cgroup = `/sys/fs/cgroup${group}/cgroup.events`
            }
            return confirmationSchema.parse({
              pid: child.pid,
              group: hasScope ? unit : observed.group,
              startTime: observed.startTime,
              executable: observed.executable,
              uid: observed.uid,
              container: hasScope ? 'linuxScope' : 'processGroup',
              cgroup:
                process.platform === 'linux'
                  ? await readFile(`/proc/${String(child.pid)}/cgroup`, 'utf8')
                  : undefined,
            })
          }
          if (state.isExited) throw new Error('TEAM_CONFIRMATION_LOST')
          await delay(NATIVE_POLL_MS)
        }
        throw new Error('TEAM_CONFIRMATION_TIMEOUT')
      })()
      const isEmpty = async () => {
        if (state.hasEmptyProof) return true
        if (!hasScope || state.cgroup === '') return false
        try {
          state.hasEmptyProof = /^populated 0$/m.test(await readFile(state.cgroup, 'utf8'))
          return state.hasEmptyProof
        } catch {
          return false
        }
      }
      const ended = (async (): Promise<Retirement> => {
        await exited
        await confirmation
        return { childExited: true, descendants: (await isEmpty()) ? 'proved' : 'uncertain' }
      })()
      void ended.catch(() => {
        /* The caller receives this failure; no retirement proof is invented. */
      })
      let recorded: LaunchConfirmation | undefined
      const ownership = createProcessOwnership(observer)
      const notOwned = new Set<number>()
      const uncertain = (): Retirement => ({
        childExited: state.isExited,
        descendants: 'uncertain',
        ...(notOwned.size > 0 && { notOwned: [...notOwned] }),
      })
      const didSignal = async (name: 'SIGTERM' | 'SIGKILL'): Promise<boolean> => {
        if (recorded === undefined) return false
        let canSignalScope = hasScope
        try {
          if (hasScope && process.platform === 'linux') {
            if (
              recorded.cgroup === undefined ||
              (await readFile(`/proc/${String(recorded.pid)}/cgroup`, 'utf8')) !== recorded.cgroup
            )
              canSignalScope = false
            const rawGroup = await runProgram(
              'systemctl',
              ['--user', 'show', unit, '--property=ControlGroup', '--value'],
              probeEnv,
            )
            const group = rawGroup.trim()
            if (
              `/sys/fs/cgroup${group}/cgroup.events` !== state.cgroup ||
              !recorded.cgroup?.split('\n').includes(`0::${group}`)
            )
              canSignalScope = false
          }
        } catch {
          // Missing membership never authorizes the scope; members still need their own proof.
          canSignalScope = false
        }
        if (
          canSignalScope &&
          (await ownership.isOwned({ ...recorded, group: String(recorded.pid), launchId }))
        ) {
          try {
            await runProgram(
              'systemctl',
              ['--user', 'kill', '--kill-whom=all', `--signal=${name}`, unit],
              probeEnv,
            )
          } catch (error: unknown) {
            // --collect can remove the scope before a second signal. An
            // absent cgroup is NOT populated-zero proof: keep it uncertain.
            try {
              await readFile(state.cgroup, 'utf8')
            } catch (readError: unknown) {
              if (readError instanceof Error && 'code' in readError && readError.code === 'ENOENT')
                return false
            }
            throw error
          }
        } else {
          const result = await ownership.signalLaunch(
            {
              ...recorded,
              group: hasScope ? String(recorded.pid) : recorded.group,
              launchId,
            },
            name,
          )
          for (const pid of result.notOwned) notOwned.add(pid)
          return result.signalled.length > 0
        }
        return true
      }
      const retire = async (): Promise<Retirement> => {
        lifecycle.retire()
        notOwned.clear()
        if (recorded === undefined) {
          // EOF cancels the held launcher without sending any PID/group signal.
          gate.end()
          await exited
          return { childExited: true, descendants: 'uncertain' }
        }
        if (!(await isEmpty()) && !(await didSignal('SIGTERM'))) return uncertain()
        const deadline = performance.now() + options.killGraceMs
        while (performance.now() < deadline && !(await isEmpty())) await delay(NATIVE_POLL_MS)
        // A direct child's exit is never evidence that a group has no descendants.
        if (!(await isEmpty()) && !(await didSignal('SIGKILL'))) return uncertain()
        if (
          !state.isExited &&
          (notOwned.has(recorded.pid) ||
            !(await ownership.isOwned({
              ...recorded,
              group: hasScope ? String(recorded.pid) : recorded.group,
              launchId,
            })))
        ) {
          notOwned.add(recorded.pid)
          return uncertain()
        }
        await withDeadline(exited, NATIVE_CONFIRM_MS, 'TEAM_RETIREMENT_TIMEOUT')
        const descendants = (await isEmpty()) ? 'proved' : 'uncertain'
        return {
          childExited: true,
          descendants,
          ...(notOwned.size > 0 && descendants === 'uncertain' && { notOwned: [...notOwned] }),
        }
      }
      return {
        child,
        confirmation,
        ended,
        async resume(value, saveIdentity) {
          const observed = await confirmation
          const parsed = confirmationSchema.parse(value)
          if (JSON.stringify(parsed) !== JSON.stringify(observed))
            throw new Error('TEAM_LAUNCH_CONFIRMATION_CHANGED')
          // Set the held process's absolute priority before releasing its
          // command. nice's relative adjustment can leave a privileged
          // runner's child at normal priority; retain an already lower one.
          if (request.priority === 'belowNormal') {
            os.setPriority(
              parsed.pid,
              Math.max(os.getPriority(parsed.pid), os.constants.priority.PRIORITY_BELOW_NORMAL),
            )
          }
          if (lifecycle.phase === 'spawning') lifecycle.confirm()
          lifecycle.release()
          recorded = parsed
          await new Promise<void>((resolve, reject) => {
            gate.write(`${launchId}\n`, 'utf8', (error) => {
              gate.end()
              if (error == null) resolve()
              else reject(error)
            })
          })
          // The held shell execs the command. Capture and durably record that
          // live executable before granting later signal authority to it.
          await delay(NATIVE_POLL_MS)
          const current = await observer.observe(parsed.pid)
          if (current?.startTime !== parsed.startTime || current.uid !== parsed.uid) return
          const updated = confirmationSchema.parse({
            ...parsed,
            executable: current.executable,
            uid: current.uid,
          })
          await saveIdentity?.(updated)
          recorded = updated
        },
        retire,
      }
    },
  }
}

function windowsTeamDriver(assembly: string, systemRoot: string): TeamProcessDriver {
  return {
    launch(request, launchId, lifecycle = new TeamLaunchLifecycle()) {
      const nonce = randomBytes(MCP_JOB_NONCE_BYTES).toString('hex')
      const ownerPipe = `muse-team-owner-${launchId}`
      const statusPipe = `muse-team-status-${launchId}`
      const group = String.raw`Local\MuseSparkTeam-${launchId}`
      let send: ((command: 'GO' | 'STOP') => Promise<void>) | undefined
      let heldCancellation: Promise<void> | undefined
      // Node 20 (the VS Code floor) has no Promise.withResolvers. Subscribe
      // in the executor instead of extracting resolvers into mutable variables.
      const events = new EventTarget()
      const result: { confirmation?: LaunchConfirmation; error?: Error; end?: Retirement } = {}
      const confirmation = new Promise<LaunchConfirmation>((resolve, reject) => {
        events.addEventListener(
          'confirmed',
          () => {
            if (result.confirmation !== undefined) resolve(result.confirmation)
          },
          { once: true },
        )
        events.addEventListener(
          'failed',
          () => {
            reject(result.error ?? new Error('TEAM_WINDOWS_STATUS_INVALID'))
          },
          { once: true },
        )
      })
      const ended = new Promise<Retirement>((resolve) => {
        events.addEventListener(
          'ended',
          () => {
            if (result.end !== undefined) resolve(result.end)
          },
          { once: true },
        )
      })
      const confirm = (value: LaunchConfirmation) => {
        result.confirmation = value
        events.dispatchEvent(new Event('confirmed'))
      }
      const fail = (error: Error) => {
        result.error = error
        events.dispatchEvent(new Event('failed'))
      }
      const proof = (value: Retirement) => {
        result.end = value
        events.dispatchEvent(new Event('ended'))
      }
      const owner = createServer((socket) => {
        socket.on('error', () => socket.destroy())
        let text = ''
        socket.on('data', (bytes: Buffer) => {
          text += bytes.toString('utf8')
          if (text === `READY ${nonce}\n`) {
            if (lifecycle.phase === 'retiring') socket.end()
            else socket.end(`GO ${nonce}\n`)
          } else if (text.length > MCP_JOB_HANDSHAKE_MAX_CHARS) socket.destroy()
        })
      })
      const status = createServer((socket) => {
        socket.on('error', () => socket.destroy())
        const writeCommand = (command: 'GO' | 'STOP') =>
          new Promise<void>((resolve, reject) => {
            socket.write(`${command} ${nonce}\n`, 'utf8', (error) => {
              if (error == null) resolve()
              else reject(error)
            })
          })
        send = writeCommand
        lifecycle.hold(() => {
          if (result.end === undefined) void (heldCancellation ??= writeCommand('STOP')).catch(fail)
        })
        let text = ''
        socket.on('data', (bytes: Buffer) => {
          text += bytes.toString('utf8')
          if (text.length > TEAM_PROCESS_STATUS_MAX_CHARS) {
            socket.destroy()
            return
          }
          let newline = text.indexOf('\n')
          while (newline !== -1) {
            const line = text.slice(0, newline).trim()
            text = text.slice(newline + 1)
            const match = /^CONFIRMED (\d+) (\S+) (\S+) (\S+)$/.exec(line)
            if (match !== null) {
              const parsed = confirmationSchema.safeParse({
                pid: Number(match[1]),
                startTime: match[2],
                executable: Buffer.from(match[3] ?? '', 'base64').toString('utf8'),
                uid: match[4],
                group,
                container: 'windowsJob',
              })
              if (parsed.success) confirm(parsed.data)
              else fail(new Error('TEAM_WINDOWS_CONFIRMATION_INVALID'))
            } else if (line === 'STOP_FAILED') {
              events.dispatchEvent(new Event('retirementFailed'))
            } else if (line === 'END proved') {
              result.end = { childExited: true, descendants: 'proved' }
              // Release the native control reader on natural command exit.
              // Waiting for helper exit to close this pipe would deadlock it.
              socket.end()
            } else fail(new Error('TEAM_WINDOWS_STATUS_INVALID'))
            newline = text.indexOf('\n')
          }
        })
      })
      const servers = [owner, status]
      for (const [index, server] of servers.entries()) {
        server.maxConnections = 1
        server.listen(`\\\\.\\pipe\\${index === 0 ? ownerPipe : statusPipe}`)
        server.unref()
        server.on('error', (error) => {
          fail(error)
        })
      }
      const payload = Buffer.from(
        JSON.stringify({
          file: request.command,
          args: request.args,
          cwd: request.cwd,
          env: Object.entries(request.env).flatMap(([key, value]) =>
            value === undefined ? [] : [`${key}=${value}`],
          ),
        }),
      ).toString('base64')
      const powershell = windowsPowerShell(systemRoot, request.env)
      const script = `${loadJobAssembly(assembly)}; $p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:${TEAM_CONFIG_VARIABLE})) | ConvertFrom-Json; exit [MuseSparkJob]::RunTeam($p.file, [string[]]$p.args, $p.cwd, ${String(process.pid)}, [string[]]$p.env, ${powerShellQuoted(ownerPipe)}, ${powerShellQuoted(nonce)}, ${powerShellQuoted(statusPipe)}, ${powerShellQuoted(group)}, $${request.priority === 'belowNormal' ? 'true' : 'false'})`
      const child = spawn(powershell.file, [...WINDOWS_POWERSHELL_COMMAND_ARGS, script], {
        cwd: request.cwd,
        env: { ...request.env, ...powershell.env, [TEAM_CONFIG_VARIABLE]: payload },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const timeout = setTimeout(() => {
        fail(new Error('TEAM_CONFIRMATION_TIMEOUT'))
      }, NATIVE_CONFIRM_MS)
      void confirmation
        .finally(() => {
          clearTimeout(timeout)
        })
        .catch(() => {
          /* Caller receives confirmation failure. */
        })
      // END proves the job's descendants ended; the helper can still hold
      // its cwd and stdio. Disposal must also wait for those handles to close.
      const closed = new Promise<void>((resolve) => {
        child.once('close', () => {
          clearTimeout(timeout)
          fail(new Error('TEAM_CONFIRMATION_LOST'))
          proof(result.end ?? { childExited: true, descendants: 'uncertain' })
          for (const server of servers) server.close()
          resolve()
        })
      })
      child.once('error', fail)
      return {
        child,
        confirmation,
        ended,
        async resume(value) {
          const observed = await confirmation
          if (JSON.stringify(confirmationSchema.parse(value)) !== JSON.stringify(observed))
            throw new Error('TEAM_LAUNCH_CONFIRMATION_CHANGED')
          if (lifecycle.phase === 'spawning') lifecycle.confirm()
          if (send === undefined) throw new Error('TEAM_WINDOWS_CONTROL_UNAVAILABLE')
          lifecycle.release()
          await send('GO')
        },
        async retire() {
          lifecycle.retire()
          if (result.end !== undefined) {
            await withDeadline(closed, NATIVE_CONFIRM_MS, 'TEAM_WINDOWS_RETIREMENT_TIMEOUT')
            return await ended
          }
          if (send === undefined)
            // No native control channel: keep uncertainty rather than signal an unverified PID.
            return {
              childExited: child.exitCode !== null || child.signalCode !== null,
              descendants: 'uncertain',
            }
          const failure = new AbortController()
          try {
            await withDeadline(
              new Promise<void>((resolve, reject) => {
                events.addEventListener(
                  'retirementFailed',
                  () => {
                    reject(new Error('TEAM_WINDOWS_RETIREMENT_FAILED'))
                  },
                  { once: true, signal: failure.signal },
                )
                void closed.then(resolve)
                if (result.end !== undefined) return
                // A held launch already received STOP through lifecycle.retire.
                // Await that write; a second STOP can hit its now-closed pipe.
                const stopping = heldCancellation ?? send?.('STOP')
                void stopping?.catch(reject)
              }),
              NATIVE_CONFIRM_MS,
              'TEAM_WINDOWS_RETIREMENT_TIMEOUT',
            )
          } finally {
            failure.abort()
          }
          return await ended
        },
      }
    },
  }
}
