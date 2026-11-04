import type { ResourceLease } from '../../core/resources/launch'
import type { ResourcePermit } from '../../core/resources/queue'
import type { GovernedTeamSlot } from '../../core/team/scheduler/slots'
import { runProgram } from '../processTree'
import { windowsJobHost } from '../../core/execGuard'
import {
  guardedEnvironmentBlock,
  isWorkspacePath,
  noWorkspaceChildEnvironment,
  resolveExecutable,
  workspaceChildEnvironment,
} from '../../core/execGuard'
import { isExistingFile } from '../backend/mcpProcess'
import { resolveServerCommand, spawnLine } from '../../core/execGuard'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawnGuarded } from '../../core/guardedChildProcess'
import { existsSync, realpathSync } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { shellJobAssembly, type ShellJobDeps } from '../backend/shellJob'
import { DeadlineError, withDeadline } from '../../core/timeouts'

/** C1/T attach the reserved permit to their registry; no second admission or sampler. */
export interface TeamProcessRegistryPort {
  attach(permit: ResourcePermit, onRetired: () => void): ResourceLease
}

/** M96 K calls before durable launch intent/spawn, then registers through this lease. */
export function prepareTeamProcess(
  slot: GovernedTeamSlot,
  registry: TeamProcessRegistryPort,
): ResourceLease {
  try {
    return registry.attach(slot.permit, () => {
      slot.release()
    })
  } catch (error) {
    // Nothing has spawned, so a failed binding cannot leave an occupied slot.
    slot.release()
    throw error
  }
}

import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import os from 'node:os'
import * as z from 'zod/mini'
// Deep SDK imports, never the barrel (see MuseCodeHost.ts): the barrel's
// unused layers would ride into the team bundles.
import { Connection } from '@muse-code/sdk/dist/src/connection/connection.js'
import { checkServedFingerprint } from '@muse-code/sdk/dist/src/fingerprint.js'

import type { TeamJournal } from './teamJournal'
import {
  MCP_JOB_HANDSHAKE_MAX_CHARS,
  TEAM_PROCESS_STATUS_MAX_CHARS,
  MCP_JOB_NONCE_BYTES,
  MSP_CLIENT_NAME,
  MSP_HANDSHAKE_TIMEOUT_MS,
  MSP_REQUESTED_CAPABILITIES,
} from '../../shared/constants'
import { errnoCode, isMissingPath } from '../canonicalPath'
import { createNativeOrphanDriver, createOrphanRecovery } from './orphanRecovery'
import { createProcessOwnership } from './processOwnership'
import { MuseCodeHost, museCodeEffortPort } from '../../core/backends/musecode/MuseCodeHost'
import type { CoreLogger } from '../../core/logging'

const NATIVE_POLL_MS = 10
const NATIVE_CONFIRM_MS = 5000
const LAUNCH_GATE_FD = 3

/** A separate team MSP host, never the conversation's host. W supplies the
resolved CLI command/flags and credential-free environment. The handshake
is the installed SDK's request/initialized/flush sequence; MuseCodeHost
validates the existing captured initialize shape before initialized. */
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
    if (child.exitCode === null && child.signalCode === null) {
      child.once('exit', (code, signal) => {
        resolve({ code, signal })
      })
      child.once('error', reject)
    } else {
      resolve({ code: child.exitCode, signal: child.signalCode })
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
      undefined,
      museCodeEffortPort,
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
  /**
  No one is left in the launch's process group. What a group can say, and never `proved`: a process
  that left it with setsid is not in it.
  */
  groupGone: z.optional(z.literal(true)),
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
  /**
  Called with the child as soon as it exists, before the lifetime releases its
  command to run: a command that ends at once still has its output read, since
  Node drops what nobody reads by the time a child exits.
  */
  readonly attach?: ((child: ChildProcessWithoutNullStreams) => void) | undefined
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
  /** Whether this driver's container can prove a whole tree ended: a Windows job, a Linux scope. */
  readonly provesEnds: boolean
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
  /** Whether a retirement here can be `proved`, whatever one command's turns out to be. */
  readonly provesEnds: boolean
  launch(request: TeamLaunchRequest): Promise<ContainedTeamChild & { readonly launchId: string }>
  dispose(): Promise<readonly Retirement[]>
  recoveryRecords(journal: TeamJournal, unreadable?: string[]): Promise<readonly TeamLaunchRecord[]>
}

/**
Whether a scope read or run failed answering: reads and runs reject with
Errors, so anything else is foreign to the operation and keeps its kind.
*/
function isScopeOperationFailure(error: unknown): boolean {
  return error instanceof Error
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
    provesEnds: options.driver.provesEnds,
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
        request.attach?.(launched.child)
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
              if (end.descendants === 'proved' || end.groupGone === true) {
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
              const end = await recordEnd(await launched.retire())
              // Nothing is left in its group: dispose has nothing to retire, and its number may be reused.
              if (end.groupGone === true) active.delete(pending)
              return end
            },
          }
        } catch (error: unknown) {
          // Confirmation/journal failure must not hide a child whose retirement is uncertain.
          failedChildren.add(launched)
          lifecycle.retire()
          try {
            await launched.retire()
          } catch (error_: unknown) {
            // Still held in failedChildren for dispose; what stopped the launch is what is said.
            if (!isDeadlinePassed(error_)) throw error_
          }
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

const CGROUP_ROOT = '/sys/fs/cgroup'
const isUnreadable = (error: unknown): boolean =>
  errnoCode(error) === 'EACCES' || errnoCode(error) === 'EPERM'
const isNoHierarchy = (error: unknown): boolean => isUnreadable(error) || isMissingPath(error)
/** Missing, or (ENODEV) a file of a cgroup being removed while it is read. */
const isGoingFile = (error: unknown): boolean =>
  isMissingPath(error) || errnoCode(error) === 'ENODEV'

const isDeadlinePassed = (error: unknown): boolean => error instanceof DeadlineError

/** Where a process's membership cannot be read because it has gone: nothing to say about it yet. */
const isProcessGone = (error: unknown): boolean =>
  isMissingPath(error) || errnoCode(error) === 'ESRCH'

async function membershipOf(pid: number): Promise<string> {
  try {
    return await readFile(`/proc/${String(pid)}/cgroup`, 'utf8')
  } catch (error: unknown) {
    if (!isProcessGone(error)) throw error
    return ''
  }
}

/** The path of the cgroup `unit` made, once the kernel has this process in it. */
export function scopeGroupOf(unit: string, membership: string): string | undefined {
  for (const line of membership.split('\n')) {
    const group = line.slice(line.indexOf(':', line.indexOf(':') + 1) + 1)
    if (group.startsWith('/') && group.endsWith(`/${unit}`) && !group.includes('..')) return group
  }
  return undefined
}

/** The scope's `cgroup.events`, if the held child is really in it. A scope never seen proves nothing. */
export function seenScopeEvents(
  group: string,
  membership: string,
  root = CGROUP_ROOT,
): string | undefined {
  return membership.split('\n').includes(`0::${group}`)
    ? `${root}${group}/cgroup.events`
    : undefined
}

/**
Whether a scope this launch saw is gone. `--collect` removes a scope once its last process ends, and
the kernel refuses to remove a cgroup with a process in it, so gone means empty. Only the folder
being gone says so: a missing `cgroup.events` in a folder still there says nothing, and neither does
a hierarchy that is not mounted or a folder that cannot be read.
*/
export async function isSeenScopeGone(eventsFile: string, root = CGROUP_ROOT): Promise<boolean> {
  try {
    await lstat(path.join(root, 'cgroup.controllers'))
  } catch (error: unknown) {
    if (isNoHierarchy(error)) return false
    throw error
  }
  try {
    await lstat(path.dirname(eventsFile))
    return false
  } catch (error: unknown) {
    if (isUnreadable(error)) return false
    if (isMissingPath(error)) return true
    throw error
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
  /**
  The pre-launch probe never searches PATH: it runs only the fixed system
  paths with an absolute `true`, so a program planted on a workspace PATH
  entry never runs before any launch directory is known. The launch itself
  re-resolves each tool outside its own working directory (links followed)
  and fails closed when that directory shadows the probe. The probe child
  gets the explicit no-workspace guarded environment (absolute entries
  only, links followed).
  */
  const fixedTool = (file: string): string | undefined => (existsSync(file) ? file : undefined)
  const absoluteTrue = fixedTool('/bin/true') ?? fixedTool('/usr/bin/true')
  const probeChildEnv = ((): ReturnType<typeof noWorkspaceChildEnvironment> =>
    noWorkspaceChildEnvironment(process.platform, probeEnv, realpathSync))()
  const canRun = async (file: string, args: readonly string[]) => {
    try {
      await runProgram(file, [...args], probeChildEnv)
      return true
    } catch {
      return false
    }
  }
  let hasScope = false
  let hasSetpriv = false
  if (absoluteTrue !== undefined && process.platform === 'linux') {
    const setpriv = fixedTool('/usr/bin/setpriv')
    hasSetpriv =
      setpriv !== undefined && (await canRun(setpriv, ['--pdeathsig', 'KILL', '--', absoluteTrue]))
    try {
      await readFile('/sys/fs/cgroup/cgroup.controllers', 'utf8')
      const systemdRun = fixedTool('/usr/bin/systemd-run')
      hasScope =
        systemdRun !== undefined &&
        (await canRun(systemdRun, [
          '--user',
          '--scope',
          '--collect',
          '--quiet',
          '--',
          absoluteTrue,
        ]))
    } catch {
      /* No delegated cgroup v2 user scope: use the specified process-group path. */
    }
  }
  const observer = createNativeOrphanDriver()
  return {
    provesEnds: hasScope,
    launch(request, launchId, lifecycle = new TeamLaunchLifecycle()) {
      const unit = `muse-spark-${launchId}.scope`
      // The probes proved each tool runs; the launch resolves it outside
      // this launch's own working directory (links followed), so a planted
      // name in the worker's directory never runs. A tool the probe saw but
      // this directory shadows fails the launch closed instead of running
      // the planting or silently losing its containment.
      const launchTool = (name: string): string | undefined =>
        resolveExecutable(name, {
          platform: process.platform,
          pathVariable: probeEnv.PATH,
          fileExists: existsSync,
          scope: { workspaceRoot: request.cwd, realpath: realpathSync },
        })
      const requireLaunchTool = (name: string): string => {
        const resolved = launchTool(name)
        if (resolved === undefined) throw new Error('TEAM_TOOL_UNAVAILABLE')
        return resolved
      }
      const setpriv = hasSetpriv ? requireLaunchTool('setpriv') : undefined
      const scope = hasScope
        ? {
            systemdRun: requireLaunchTool('systemd-run'),
            systemctl: requireLaunchTool('systemctl'),
          }
        : undefined
      // The scope queries below run with the guarded child PATH for the
      // launch directory, never the raw process PATH.
      const scopeEnv = workspaceChildEnvironment(process.platform, probeEnv, {
        workspaceRoot: request.cwd,
        realpath: realpathSync,
      })
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
      if (setpriv !== undefined) {
        args = ['--pdeathsig', 'KILL', '--', command, ...args]
        command = setpriv
      }
      if (scope !== undefined) {
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
        command = scope.systemdRun
        if (setpriv !== undefined) {
          args = ['--pdeathsig', 'KILL', '--', command, ...args]
          command = setpriv
        }
      }
      // The person's configured command runs with the guarded child PATH
      // for its working directory: a bare name still resolves, but never to
      // a program planted in the workspace.
      const childEnv = workspaceChildEnvironment(
        process.platform,
        { ...probeEnv, ...request.env },
        { workspaceRoot: request.cwd, realpath: realpathSync },
      )
      childEnv['MUSE_SPARK_LAUNCH_ID'] = launchId
      const child = spawnGuarded(command, args, {
        cwd: request.cwd,
        env: childEnv,
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
      const state: {
        cgroup: string
        isExited: boolean
        hasEmptyProof: boolean
        /** Set only once this launch has seen its child inside the scope. */
        scopeEvents?: string
      } = { cgroup: '', isExited: false, hasEmptyProof: false }
      void exited
        .then(() => {
          state.isExited = true
        })
        .catch(() => {
          // Settled either way: a failed spawn counts as exited too.
          state.isExited = true
        })
      const canRead = async (file: string): Promise<boolean> => {
        try {
          await readFile(file, 'utf8')
          return true
        } catch (error: unknown) {
          if (isGoingFile(error)) return false
          throw error
        }
      }
      const confirmation = (async (): Promise<LaunchConfirmation> => {
        const deadline = performance.now() + NATIVE_CONFIRM_MS
        while (performance.now() < deadline) {
          if (child.pid === undefined) {
            await exited
            throw new Error('TEAM_PROCESS_NOT_STARTED')
          }
          const observed = await observer.observe(child.pid)
          if (observed !== undefined) {
            if (scope !== undefined) {
              // Asked of the kernel, not of systemd: `systemd-run` moves the held child into the
              // scope and only then runs it. Polling `systemctl show` here, every launch at once,
              // kept the user manager from starting the scopes it was being asked about.
              const membership = await membershipOf(child.pid)
              const group = scopeGroupOf(unit, membership)
              if (group === undefined) {
                if (state.isExited) throw new Error('TEAM_SCOPE_NOT_READY')
                await delay(NATIVE_POLL_MS)
                continue
              }
              state.cgroup = `${CGROUP_ROOT}${group}/cgroup.events`
              const seen = seenScopeEvents(group, membership)
              if (seen !== undefined && (await canRead(seen))) state.scopeEvents = seen
            }
            return confirmationSchema.parse({
              pid: child.pid,
              group: scope === undefined ? observed.group : unit,
              startTime: observed.startTime,
              executable: observed.executable,
              uid: observed.uid,
              container: scope === undefined ? 'processGroup' : 'linuxScope',
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
        if (state.scopeEvents === undefined) return false
        try {
          state.hasEmptyProof = /^populated 0$/m.test(await readFile(state.scopeEvents, 'utf8'))
        } catch (error: unknown) {
          // An unreadable file proves nothing; only a scope that is gone is empty.
          if (isUnreadable(error)) return false
          if (!isGoingFile(error)) throw error
          state.hasEmptyProof = await isSeenScopeGone(state.scopeEvents)
        }
        return state.hasEmptyProof
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
      /**
      The program a live child runs now. The identity is recorded just after the gate opens, and a
      command can exec after that: the shell had not yet, under load (3 launches in 200 at eight at
      once, each then out of reach of every signal), or `sh -c 'a; exec b'` does so later. The same
      pid, start, group, owner and marker are the same process, whatever it has become.
      */
      const asItRunsNow = async (known: LaunchConfirmation): Promise<LaunchConfirmation> => {
        const current = await observer.observe(known.pid)
        return current?.startTime === known.startTime &&
          current.uid === known.uid &&
          current.launchId === launchId &&
          current.group === (scope === undefined ? known.group : String(known.pid))
          ? { ...known, executable: current.executable }
          : known
      }
      const didSignal = async (name: 'SIGTERM' | 'SIGKILL'): Promise<boolean> => {
        if (recorded === undefined) return false
        recorded = await asItRunsNow(recorded)
        let canSignalScope = scope !== undefined
        try {
          if (scope !== undefined && process.platform === 'linux') {
            // A leader that has exited has no membership to read. The unit is this launch's by
            // name, and the kernel's path below says it is the scope this launch saw.
            if (
              !state.isExited &&
              (recorded.cgroup === undefined ||
                (await readFile(`/proc/${String(recorded.pid)}/cgroup`, 'utf8')) !==
                  recorded.cgroup)
            )
              canSignalScope = false
            const rawGroup = await runProgram(
              scope.systemctl,
              ['--user', 'show', unit, '--property=ControlGroup', '--value'],
              scopeEnv,
            )
            const group = rawGroup.trim()
            if (
              `${CGROUP_ROOT}${group}/cgroup.events` !== state.cgroup ||
              !recorded.cgroup?.split('\n').includes(`0::${group}`)
            )
              canSignalScope = false
          }
        } catch (error: unknown) {
          // Missing membership never authorizes the scope; members still need their own proof.
          if (isScopeOperationFailure(error)) {
            canSignalScope = false
          } else {
            throw error
          }
        }
        if (
          canSignalScope &&
          scope !== undefined &&
          (state.isExited ||
            (await ownership.isOwned({ ...recorded, group: String(recorded.pid), launchId })))
        ) {
          try {
            await runProgram(
              scope.systemctl,
              ['--user', 'kill', '--kill-whom=all', `--signal=${name}`, unit],
              scopeEnv,
            )
          } catch (error: unknown) {
            // --collect can remove the scope before a second signal. A
            // failed kill plus a missing cgroup file is NOT populated-zero
            // proof: keep it uncertain (presence, not readability: an
            // unreadable cgroup proves nothing either). Anything else keeps
            // its kind.
            if (isScopeOperationFailure(error) && !existsSync(state.cgroup)) return false
            throw error
          }
        } else {
          const result = await ownership.signalLaunch(
            {
              ...recorded,
              group: scope === undefined ? recorded.group : String(recorded.pid),
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
        const leader = recorded
        // A scope is over when it is empty. A group has no such answer: its leader is what can be
        // signalled by identity, and what is left of the group is asked after it.
        const isOver = async () => (scope === undefined ? state.isExited : await isEmpty())
        const settled = async (): Promise<Retirement> => {
          if (scope === undefined) {
            const isGone =
              state.isExited &&
              (await ownership.emptyGroup(leader.pid, launchId, options.killGraceMs))
            return isGone
              ? { childExited: true, descendants: 'uncertain', groupGone: true }
              : uncertain()
          }
          return state.isExited && (await isEmpty())
            ? { childExited: true, descendants: 'proved' }
            : uncertain()
        }
        if (!(await isOver()) && !(await didSignal('SIGTERM'))) return await settled()
        const deadline = performance.now() + options.killGraceMs
        while (performance.now() < deadline && !(await isOver())) await delay(NATIVE_POLL_MS)
        // A direct child's exit is never evidence that a group has no descendants.
        if (!(await isOver()) && !(await didSignal('SIGKILL'))) return await settled()
        if (
          !state.isExited &&
          (notOwned.has(recorded.pid) ||
            !(await ownership.isOwned({
              ...recorded,
              group: scope === undefined ? recorded.group : String(recorded.pid),
              launchId,
            })))
        ) {
          notOwned.add(recorded.pid)
          return uncertain()
        }
        await withDeadline(exited, NATIVE_CONFIRM_MS, 'TEAM_RETIREMENT_TIMEOUT')
        // What was signalled takes a moment to leave the scope.
        const emptied = performance.now() + options.killGraceMs
        while (scope !== undefined && performance.now() < emptied && !(await isEmpty()))
          await delay(NATIVE_POLL_MS)
        return await settled()
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

/**
The Windows team payload's whole environment, as the `string[]` block the
native helper hands `CreateProcessW`: the same guarded child environment
the POSIX launch uses for the same payload, so a helper the payload
starts by bare name (`ssh`, `git-remote-https`) never resolves to a
program planted in the workspace. (The executable itself never comes from
this block: `RunTeam` receives it as `lpApplicationName`, resolved
outside the workspace by `resolveWindowsTeamCommand` below.) Only a
guarded environment serializes (`guardedEnvironmentBlock`), so a raw
`request.env` does not type-check here.
*/
export function windowsTeamPayloadEnvironment(env: NodeJS.ProcessEnv, cwd: string): string[] {
  return guardedEnvironmentBlock(
    workspaceChildEnvironment('win32', env, {
      workspaceRoot: cwd,
      realpath: realpathSync,
    }),
  )
}

export interface WindowsTeamCommandTarget {
  /**
  The absolute file `RunTeam` starts: outside the workspace, so
  `CreateProcessW` (which completes a partial `lpApplicationName` from
  the helper's own working directory without a PATH search) can never
  complete it to a workspace planting. A `.cmd`/`.bat` hit is the
  absolute `cmd.exe` instead, which alone can start one.
  */
  readonly executable: string
  /** The arguments for it (the pre-quoted `cmd.exe` line for a batch file). */
  readonly args: readonly string[]
  /** Whether the arguments reach `CreateProcessW` exactly as built. */
  readonly isVerbatim: boolean
}

/**
The `RunTeam` executable and arguments for a team launch, resolved before
the helper runs. A bare `command` resolves on the absolute PATH entries
outside the launch's own working directory (PATHEXT order included), the
way the MCP servers resolve theirs; a missing name fails the launch
closed instead of falling back to the workspace. A path the person named
is the file it names, but one inside the workspace (links followed)
fails the launch closed too: with the workspace as the helper's working
directory, `CreateProcessW` would otherwise complete it there.
*/
export function resolveWindowsTeamCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  deps: {
    readonly systemRoot: string | undefined
    readonly isExistingFile: (filePath: string) => boolean
    readonly realpath: (filePath: string) => string
  },
): WindowsTeamCommandTarget {
  const scope = { workspaceRoot: cwd, realpath: deps.realpath }
  const file = resolveServerCommand(
    command,
    cwd,
    env,
    { platform: 'win32', isExistingFile: deps.isExistingFile },
    scope,
  )
  if (isWorkspacePath('win32', scope, file)) throw new Error('TEAM_COMMAND_IN_WORKSPACE')
  const line = spawnLine(file, args, { platform: 'win32', systemRoot: deps.systemRoot })
  return { executable: line.file, args: [...line.args], isVerbatim: line.isVerbatim }
}

/**
The job helper's arguments for one team launch (MuseSparkJobHost's
`run-team` in native/windows/MuseSparkJob.cs, which runs
`MuseSparkJob.RunTeam`): the fixed values in its order, the payload's
argument count, its arguments, then its whole environment block.
*/
function runTeamArgs(
  target: WindowsTeamCommandTarget,
  request: TeamLaunchRequest,
  environment: readonly string[],
  launch: {
    readonly ownerPipe: string
    readonly nonce: string
    readonly statusPipe: string
    readonly group: string
  },
): readonly string[] {
  return [
    'run-team',
    target.executable,
    request.cwd,
    String(process.pid),
    launch.ownerPipe,
    launch.nonce,
    launch.statusPipe,
    launch.group,
    String(request.priority === 'belowNormal'),
    String(target.isVerbatim),
    String(target.args.length),
    ...target.args,
    ...environment,
  ]
}

function windowsTeamDriver(assembly: string, systemRoot: string): TeamProcessDriver {
  return {
    provesEnds: true,
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
      const endSeen = (): Retirement | undefined => result.end
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
      // The payload's whole environment: the same guarded child environment
      // the POSIX launch uses, so nothing the payload starts by bare name
      // resolves to a program planted in the workspace. The executable
      // itself is resolved outside the workspace first: `RunTeam` passes it
      // as `lpApplicationName`, and refuses one that is not fully qualified.
      const environment = windowsTeamPayloadEnvironment(request.env, request.cwd)
      const target = resolveWindowsTeamCommand(
        request.command,
        request.args,
        request.cwd,
        request.env,
        {
          systemRoot,
          isExistingFile,
          realpath: realpathSync,
        },
      )
      // The job helper run as a program of its own (`run-team`, no
      // PowerShell start), whose exit code is the payload's: each value is
      // one argument (Node quotes each for the C runtime), so no shell or
      // script reads a name, an argument or an environment entry. The helper
      // works in its own folder; the payload's folder is an argument, which
      // `CreateProcessW` gives the payload alone.
      const host = windowsJobHost(assembly, systemRoot)
      const args = runTeamArgs(target, request, environment, {
        ownerPipe,
        nonce,
        statusPipe,
        group,
      })
      const child = spawnGuarded(host.file, args, {
        cwd: host.cwd,
        env: host.env,
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
      // its own folder (its working folder, its loaded file) and stdio.
      // Disposal must also wait for those handles to close.
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
            // END proved the job empty. What is left is the helper closing, which a busy machine
            // can make slow, and a command's answer is not lost to that.
            try {
              await withDeadline(closed, NATIVE_CONFIRM_MS, 'TEAM_WINDOWS_RETIREMENT_TIMEOUT')
            } catch (error: unknown) {
              if (!isDeadlinePassed(error)) throw error
            }
            return result.end
          }
          if (send === undefined) {
            // This is our own spawned helper, still awaiting the control gate.
            // Kill-on-close ends its job, but without END no proof is invented.
            // Await close before its caller removes the payload's folder or
            // the helper's.
            child.kill()
            await withDeadline(closed, NATIVE_CONFIRM_MS, 'TEAM_WINDOWS_RETIREMENT_TIMEOUT')
            return await ended
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
                // A helper already gone has nothing to stop: its close is what is waited for.
                const stopping =
                  heldCancellation ?? (child.exitCode === null ? send?.('STOP') : undefined)
                void stopping?.catch((error: unknown) => {
                  if (child.exitCode === null)
                    reject(error instanceof Error ? error : new Error(String(error)))
                })
              }),
              NATIVE_CONFIRM_MS,
              'TEAM_WINDOWS_RETIREMENT_TIMEOUT',
            )
          } catch (error: unknown) {
            // END arrived while this waited: the proof stands however slowly the helper closes.
            if (endSeen() === undefined || !isDeadlinePassed(error)) throw error
          } finally {
            failure.abort()
          }
          return endSeen() ?? (await ended)
        },
      }
    },
  }
}
