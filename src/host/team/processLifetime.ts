import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
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
  MCP_JOB_NONCE_BYTES,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
} from '../../shared/constants'
import { createNativeOrphanDriver, createOrphanRecovery } from './orphanRecovery'
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
  for (const journal of foreign.journals) records.push(...(await lifetime.recoveryRecords(journal)))
  const recovery = createOrphanRecovery(createNativeOrphanDriver())
  const orphans = await recovery.find(records)
  return { lifetime, recovery, orphans, records, unreadable: foreign.unreadable }
}

const confirmationSchema = z.strictObject({
  pid: z.number().check(z.int(), z.positive()),
  group: z.string().check(z.minLength(1)),
  /** OS identity, not a timestamp inferred from when spawn returned. */
  startTime: z.string().check(z.minLength(1)),
  container: z.enum(['windowsJob', 'linuxScope', 'processGroup']),
})
const endSchema = z.strictObject({
  childExited: z.boolean(),
  descendants: z.enum(['proved', 'uncertain']),
})
const launchSchema = z.strictObject({
  id: z.uuid(),
  command: z.string().check(z.minLength(1)),
  cwd: z.string().check(z.minLength(1)),
  taskId: z.string().check(z.minLength(1)),
  confirmation: z.optional(confirmationSchema),
  end: z.optional(endSchema),
})

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
  retire(): Promise<Retirement>
}

/** Explicit OS seam. No uncontained spawn or taskkill fallback is accepted here. */
export interface TeamProcessDriver {
  launch(request: TeamLaunchRequest, launchId: string): ContainedTeamChild
}

export interface TeamProcessLifetime {
  launch(request: TeamLaunchRequest): Promise<ContainedTeamChild & { readonly launchId: string }>
  dispose(): Promise<readonly Retirement[]>
  recoveryRecords(journal: TeamJournal): Promise<readonly TeamLaunchRecord[]>
}

/** Constructed only by the lazy team host; construction itself launches nothing. */
export function createTeamProcessLifetime(options: {
  readonly journal: TeamJournal
  readonly driver: TeamProcessDriver
  readonly isHostBusy: () => boolean
}): TeamProcessLifetime {
  const active = new Set<Promise<ContainedTeamChild>>()
  const failedChildren = new Set<ContainedTeamChild>()
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
        )
        try {
          const confirmation = confirmationSchema.parse(await launched.confirmation)
          await save({ ...record, confirmation })
          let endTail = Promise.resolve<Retirement | undefined>(undefined)
          const recordEnd = (raw: Retirement): Promise<Retirement> => {
            const previousTail = endTail
            const saved = (async () => {
              const previous = await previousTail
              const end = endSchema.parse(raw)
              if (
                end.descendants === 'proved' &&
                (!end.childExited || confirmation.container === 'processGroup')
              )
                throw new Error('TEAM_RETIREMENT_PROOF_INVALID')
              if (previous?.descendants === 'proved') return previous
              await save({ ...record, confirmation, end })
              return end
            })()
            endTail = saved
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
            retire: async () => await recordEnd(await launched.retire()),
          }
        } catch (error: unknown) {
          // Confirmation/journal failure must not hide a child whose retirement is uncertain.
          failedChildren.add(launched)
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
        throw error
      }
    },
    async dispose() {
      state.isDisposed = true
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
    async recoveryRecords(journal) {
      const records: TeamLaunchRecord[] = []
      const names = await journal.names()
      for (const name of names) {
        if (!name.startsWith('launch-')) continue
        const result = await journal.read(name, launchSchema)
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
    launch(request, launchId) {
      const unit = `muse-spark-${launchId}.scope`
      let command = request.command
      let args = [...request.args]
      if (request.priority === 'belowNormal') {
        args = ['-n', '10', '--', command, ...args]
        command = 'nice'
      }
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
        env: { ...probeEnv, ...request.env },
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
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
        const deadline = Date.now() + NATIVE_CONFIRM_MS
        while (Date.now() < deadline) {
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
              container: hasScope ? 'linuxScope' : 'processGroup',
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
      const signal = async (name: 'SIGTERM' | 'SIGKILL') => {
        if (hasScope) {
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
                return
            }
            throw error
          }
        } else if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, name)
          } catch (error: unknown) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
          }
        }
      }
      let retiring: Promise<Retirement> | undefined
      const retire = async (): Promise<Retirement> => {
        await signal('SIGTERM')
        const deadline = Date.now() + options.killGraceMs
        while (Date.now() < deadline && !(await isEmpty())) await delay(NATIVE_POLL_MS)
        // A direct child's exit is never evidence that a group has no descendants.
        if (!(await isEmpty())) await signal('SIGKILL')
        await exited
        return { childExited: true, descendants: (await isEmpty()) ? 'proved' : 'uncertain' }
      }
      return { child, confirmation, ended, retire: () => (retiring ??= retire()) }
    },
  }
}

function windowsTeamDriver(assembly: string, systemRoot: string): TeamProcessDriver {
  return {
    launch(request, launchId) {
      const nonce = randomBytes(MCP_JOB_NONCE_BYTES).toString('hex')
      const ownerPipe = `muse-team-owner-${launchId}`
      const statusPipe = `muse-team-status-${launchId}`
      const group = String.raw`Local\MuseSparkTeam-${launchId}`
      let stop: (() => void) | undefined
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
          if (text === `READY ${nonce}\n`) socket.end(`GO ${nonce}\n`)
          else if (text.length > MCP_JOB_HANDSHAKE_MAX_CHARS) socket.destroy()
        })
      })
      const status = createServer((socket) => {
        socket.on('error', () => socket.destroy())
        stop = () => {
          socket.write(`STOP ${nonce}\n`)
        }
        let text = ''
        socket.on('data', (bytes: Buffer) => {
          text += bytes.toString('utf8')
          if (text.length > MCP_JOB_HANDSHAKE_MAX_CHARS) {
            socket.destroy()
            return
          }
          let newline = text.indexOf('\n')
          while (newline !== -1) {
            const line = text.slice(0, newline).trim()
            text = text.slice(newline + 1)
            const match = /^CONFIRMED (\d+) (\S+)$/.exec(line)
            if (match !== null) {
              const parsed = confirmationSchema.safeParse({
                pid: Number(match[1]),
                startTime: match[2],
                group,
                container: 'windowsJob',
              })
              if (parsed.success) confirm(parsed.data)
              else fail(new Error('TEAM_WINDOWS_CONFIRMATION_INVALID'))
            } else if (line === 'END proved') {
              proof({ childExited: true, descendants: 'proved' })
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
      const closed = () => {
        clearTimeout(timeout)
        fail(new Error('TEAM_CONFIRMATION_LOST'))
        proof({ childExited: true, descendants: 'uncertain' })
        for (const server of servers) server.close()
      }
      child.once('exit', closed)
      child.once('error', closed)
      return {
        child,
        confirmation,
        ended,
        async retire() {
          if (stop === undefined) child.kill()
          else stop()
          return await ended
        },
      }
    },
  }
}
