// M100 lane H: the local owner reserves; an OS job owns execution and retirement.
import path from 'node:path'
import { access, realpath } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import * as z from 'zod/mini'
import { workerEnvironment } from '../../core/team/refFence'
import { DevicePairingError } from '../../core/devices/pairing'
import { DEVICE_LIMITS, WINDOWS_POWERSHELL_COMMAND_ARGS } from '../../shared/constants'
import { deviceDispatchSchema, deviceJournalRecordSchema } from '../../shared/devices'
import type { DeviceDispatch, DeviceJournalRecord } from '../../shared/devices'
import { UI_TEXT } from '../../shared/l10n/text'
import type {
  DeviceExecutionBoundary,
  DeviceLocalAttempt,
  DeviceReceiverExecution,
} from './deviceReceiver'

type Retirement = Awaited<DeviceLocalAttempt['retirement']>
type Power = 'ac' | 'battery' | 'unknown'
const contextSchema = z.strictObject({
  session: z.int().check(z.gte(0)),
  station: z.string().check(z.minLength(1), z.maxLength(DEVICE_LIMITS.pathChars)),
  desktop: z.string().check(z.minLength(1), z.maxLength(DEVICE_LIMITS.pathChars)),
})
const querySchema = z.strictObject({
  context: contextSchema,
  power: z.enum(['ac', 'battery', 'unknown']),
  sleepInhibited: z.boolean(),
  activeProcesses: z.int().check(z.gte(0)),
  cpu100ns: z.number().check(z.gte(0)),
  peakMemoryBytes: z.number().check(z.gte(0)),
})
export type DeviceWorkerQuery = z.infer<typeof querySchema>
export function parseDeviceWorkerQuery(value: unknown): DeviceWorkerQuery {
  return querySchema.parse(value)
}
const exitSchema = z.strictObject({
  exitCode: z.int(),
  stdout: z.string(),
  failure: z.enum(['none', 'desktop-heap', 'unsupported-host', 'capacity']),
})

function reasonFor(detail: DeviceWorkerHostError['detail']): DeviceWorkerHostError['reason'] {
  if (detail === 'result') return 'uncertain'
  return detail === 'capacity' ? 'capacity' : 'unsupported-host'
}

export class DeviceWorkerHostError extends DevicePairingError {
  public constructor(
    public readonly detail:
      'context' | 'preflight' | 'helper' | 'desktop-heap' | 'result' | 'capacity',
    options?: { cause?: unknown },
  ) {
    super(reasonFor(detail), options)
    if (detail === 'desktop-heap') this.message = UI_TEXT.devices.desktopHeap
    else if (detail === 'capacity') this.message = UI_TEXT.devices.capacityHelp
    else this.message = UI_TEXT.devices.unsupportedHost
  }
}

/** Local configuration only. No peer-supplied command, environment or hook tool. */
export interface DeviceWorkerCommand {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly requiredTools: readonly { name: string; verify(file: string): Promise<boolean> }[]
}
export interface DeviceWorkerJob {
  /** Validated helper readiness, after containment and before the child resumes. */
  readonly query: unknown
  /** Only an observed empty OS job resolves this; helper death rejects as uncertain. */
  readonly retirement: Promise<unknown>
  activate(): Promise<void>
  cancel(): Promise<void>
  /** Remove only this attempt's task/unit/job after observed retirement. */
  remove(): Promise<void>
}
/**
What one launch left behind. The driver states the case; the host never infers it, and a
rejected launch is `uncertain`, never `refused`.
- `refused` proves nothing remains for this attempt: no job, unit, helper or attempt storage,
  and nothing can still start. Only this settles as not-run work and releases the slot.
- `uncertain` means the driver retains the attempt. `reclaimed`, when the driver can observe
  reclamation (its sweep), resolves only after that proof, never on a timer or failed query.
  Without it the attempt stays uncertain, with its occupancy, until local recovery.
*/
export type DeviceWorkerLaunch =
  | { readonly kind: 'launched'; readonly job: DeviceWorkerJob }
  | { readonly kind: 'refused'; readonly error: DeviceWorkerHostError }
  | {
      readonly kind: 'uncertain'
      readonly error: DeviceWorkerHostError
      readonly reclaimed?: Promise<void>
    }
function launchError(error: unknown): DeviceWorkerHostError {
  if (error instanceof DeviceWorkerHostError) return error
  const failure = new DeviceWorkerHostError('helper')
  failure.cause = error
  return failure
}
/** Only for a failure with proof that nothing remains allocated for this attempt. */
export function deviceWorkerRefused(error: unknown): DeviceWorkerLaunch {
  return { kind: 'refused', error: launchError(error) }
}
/** A failure whose cleanup is unproven; `reclaimed` resolves only on observed reclamation. */
export function deviceWorkerUncertain(
  error: unknown,
  reclaimed?: Promise<void>,
): DeviceWorkerLaunch {
  return {
    kind: 'uncertain',
    error: launchError(error),
    ...(reclaimed !== undefined && { reclaimed }),
  }
}
/** Only the host's validated request: never a peer-supplied unit, task or job property. */
export type DeviceWorkerAttempt = Readonly<Pick<DeviceDispatch, 'identity' | 'caps'>>
/** Admitted process ceiling: kernel admission or supervised termination; invalid limits refuse. */
export function admittedProcessLimit(attempt: DeviceWorkerAttempt): number {
  const limit = attempt.caps.processes
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > DEVICE_LIMITS.processes)
    throw new DeviceWorkerHostError('preflight')
  return limit
}
export interface DeviceWorkerDriver {
  readonly platform: NodeJS.Platform
  /** The helper's containment probe passed; this is not a scheduler/service qualification. */
  selfTest(): Promise<boolean>
  query(): Promise<unknown>
  /**
  Enforces `attempt.caps.processes`: kernel admission on Windows/Linux, supervised whole-
  coalition termination on macOS (20 ms samples; transient overflow can run between samples).
  An unavailable enforcement mechanism refuses before activation.
  Other caps travel for drivers that can enforce them; a driver given a cap it cannot enforce
  refuses with typed `unsupported-host`, never ignoring it. CPU and memory are not caps: the
  receiver's M107 resource governor owns them.
  Every failure resolves as `refused` (proved empty) or `uncertain` (retained); see
  `DeviceWorkerLaunch`. A rejection is read as `uncertain` with no reclamation proof.
  */
  launch(
    command: DeviceWorkerCommand,
    env: Readonly<Record<string, string>>,
    attempt: DeviceWorkerAttempt,
  ): Promise<DeviceWorkerLaunch>
}
/**
One lazy platform selection point; the caller still owns local
command/reservation wiring. Every factory is lazy so selecting a platform
never loads another platform's driver (and never spawns); selecting an
unsupported OS refuses with typed `unsupported-host` before any spawn.
A factory whose driver names another platform refuses the same way: one
OS's containment never stands in for another's.
*/
export async function selectDeviceWorkerDriver(
  platform: NodeJS.Platform,
  factories: {
    darwin(): DeviceWorkerDriver | Promise<DeviceWorkerDriver>
    win32(): DeviceWorkerDriver | Promise<DeviceWorkerDriver>
    linux(): DeviceWorkerDriver | Promise<DeviceWorkerDriver>
  },
): Promise<DeviceWorkerDriver> {
  let driver: DeviceWorkerDriver
  switch (platform) {
    case 'darwin': {
      driver = await factories.darwin()
      break
    }
    case 'win32': {
      driver = await factories.win32()
      break
    }
    case 'linux': {
      driver = await factories.linux()
      break
    }
    default: {
      throw new DeviceWorkerHostError('helper')
    }
  }
  if (driver.platform !== platform) throw new DeviceWorkerHostError('helper')
  return driver
}
export interface DeviceWorkerReservation {
  readonly usage: DeviceLocalAttempt['usage']
  /** Local M96 safe-point pause; the worker's controlled boundaries use this owner. */
  pause(): Promise<void>
  release(): Promise<void>
}
export interface DeviceWorkerHostDeps {
  readonly driver: DeviceWorkerDriver
  readonly environment: NodeJS.ProcessEnv
  /** Restore unresolved occupancy, never adopt or relaunch a previous job. */
  retain(records: readonly DeviceJournalRecord[]): Promise<void>
  reserve(request: DeviceDispatch): Promise<DeviceWorkerReservation>
  /** Bind M96's local engine and every action/paid boundary before returning its command. */
  command(request: DeviceDispatch, boundary: DeviceExecutionBoundary): Promise<DeviceWorkerCommand>
  recordEnvironment(request: DeviceDispatch, env: Readonly<Record<string, string>>): Promise<void>
  pressure(signal: 'desktop-heap'): void
  readonly resolveTool?: (
    name: string,
    env: Readonly<Record<string, string>>,
    platform: NodeJS.Platform,
  ) => Promise<string>
}

async function resolveTool(
  name: string,
  env: Readonly<Record<string, string>>,
  platform: NodeJS.Platform,
): Promise<string> {
  const paths = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1]
  const extensions = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  const candidates = path.isAbsolute(name)
    ? [name]
    : (paths ?? '')
        .split(platform === 'win32' ? ';' : ':')
        .filter(Boolean)
        .flatMap((folder) =>
          extensions.map((extension) => path.join(folder, `${name}${extension}`)),
        )
  for (const candidate of candidates) {
    try {
      await access(candidate, platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK)
      return await realpath(candidate)
    } catch {
      continue
    }
  }
  throw new DeviceWorkerHostError('preflight')
}

function environment(input: NodeJS.ProcessEnv, platform: NodeJS.Platform): Record<string, string> {
  const out: Record<string, string> = {}
  const entries = Object.entries(workerEnvironment(input, platform))
  for (const [name, value] of entries) {
    if (value === undefined || name.includes('\0') || value.includes('\0'))
      throw new DeviceWorkerHostError('preflight')
    out[name] = value
  }
  if (Buffer.byteLength(JSON.stringify(out)) > DEVICE_LIMITS.frameBytes)
    throw new DeviceWorkerHostError('preflight')
  return Object.freeze(out)
}

// Node 20 hosts do not have Promise.withResolvers (the supported editor floor).
function retirementWait() {
  let settle: { resolve(value: Retirement): void; reject(error: unknown): void } | undefined
  const promise = new Promise<Retirement>((resolve, reject) => {
    settle = { resolve, reject }
  })
  if (settle === undefined) throw new DeviceWorkerHostError('helper')
  return { promise, ...settle }
}

/** A small facts port for V/W; unknown readings are never promoted to AC. */
export class DeviceWorkerHost implements DeviceReceiverExecution {
  private running = 0
  public constructor(private readonly deps: DeviceWorkerHostDeps) {}
  public async facts(): Promise<{ power: Power; sleepInhibited: boolean }> {
    try {
      const query = querySchema.parse(await this.deps.driver.query())
      return { power: query.power, sleepInhibited: this.running > 0 && query.sleepInhibited }
    } catch {
      return { power: 'unknown', sleepInhibited: false }
    }
  }
  public async retain(records: readonly DeviceJournalRecord[]): Promise<void> {
    const validated = records.map((record) => deviceJournalRecordSchema.parse(record))
    // Linux's first manager query stops dead-host units before journal occupancy is restored.
    // The receiver still records uncertainty: cleanup supplies no result or paid settlement.
    if (this.deps.driver.platform === 'linux')
      parseDeviceWorkerQuery(await this.deps.driver.query())
    await this.deps.retain(validated)
  }
  public async admit(input: DeviceDispatch): Promise<DeviceLocalAttempt> {
    const request = deviceDispatchSchema.parse(input)
    const reservation = await this.deps.reserve(request)
    const retired = retirementWait()
    // Admission need not attach a consumer until start; prevent unhandled rejection.
    void retired.promise.catch(() => {
      /* The receiver attaches its retirement consumer after admission. */
    })
    let job: DeviceWorkerJob | undefined
    let isStarted = false
    const state = { isCancelled: false }
    let isObserved = false
    let releasing: Promise<void> | undefined
    let isRunning = false
    const isCancelled = () => state.isCancelled
    let observation: Promise<void> | undefined
    const finish = async (raw: unknown): Promise<void> => {
      // Driver's promise means the entire OS job is empty, even on a nonzero exit.
      isObserved = true
      if (isRunning) {
        this.running -= 1
        isRunning = false
      }
      try {
        const exit = exitSchema.parse(raw)
        if (Buffer.byteLength(exit.stdout) > DEVICE_LIMITS.frameBytes)
          throw new DeviceWorkerHostError('result')
        // STATUS_DLL_INIT_FAILED is a Win32 ABI value, not a configurable cap.
        if (exit.failure === 'desktop-heap' || exit.exitCode >>> 0 === Number('0xc0000142')) {
          this.deps.pressure('desktop-heap')
          throw new DeviceWorkerHostError('desktop-heap')
        }
        if (exit.failure === 'capacity') {
          await job?.remove()
          retired.resolve({
            failure: 'capacity',
            wholeMembershipExited: true,
            usage: reservation.usage,
            message: UI_TEXT.devices.capacityHelp,
          })
          return
        }
        if (exit.failure === 'unsupported-host') throw new DeviceWorkerHostError('helper')
        if (exit.exitCode !== 0) throw new DeviceWorkerHostError('result')
        const parsed: unknown = JSON.parse(exit.stdout)
        const payload = z
          .strictObject({ usage: z.unknown(), artifact: z.optional(z.unknown()) })
          .parse(parsed)
        const record = deviceJournalRecordSchema.parse({
          kind: 'receiver-record',
          recordedAt: Date.now(),
          outcome: {
            identity: request.identity,
            payloadDigest: request.payloadDigest,
            revision: 1,
            state: 'retired',
            occupied: { ...request.caps, workers: 0, processes: 0, heavyChecks: 0 },
            ...payload,
          },
        })
        if (record.kind !== 'receiver-record') throw new DeviceWorkerHostError('result')
        await job?.remove()
        retired.resolve({
          usage: record.outcome.usage,
          ...(record.outcome.artifact !== undefined && { artifact: record.outcome.artifact }),
        })
      } catch (error) {
        try {
          await job?.remove()
        } catch {
          /* Keep the original failure; cleanup is still reported as uncertain. */
        }
        retired.reject(
          error instanceof DeviceWorkerHostError ? error : new DeviceWorkerHostError('result'),
        )
      }
    }
    const observe = async (launched: DeviceWorkerJob): Promise<void> => {
      try {
        await finish(await launched.retirement)
      } catch (error) {
        if (isRunning) {
          this.running -= 1
          isRunning = false
        }
        // Helper loss releases its inhibitor but never proves retirement.
        retired.reject(error)
      }
    }
    // Only the driver's explicit refusal, or its later reclamation proof, settles a failed launch.
    const settleFailedLaunch = (failed: DeviceWorkerLaunch | undefined, error: unknown) => {
      const refuse = () => {
        isObserved = true
        retired.resolve({ refused: true, usage: reservation.usage })
      }
      if (failed?.kind === 'refused') {
        refuse()
        return
      }
      const uncertain = new DeviceWorkerHostError('result')
      uncertain.cause = error
      const reclaimed = failed?.kind === 'uncertain' ? failed.reclaimed : undefined
      // A rejected launch or an unobservable retained attempt keeps its occupancy.
      if (reclaimed === undefined) retired.reject(uncertain)
      else
        void reclaimed.then(refuse).catch(() => {
          retired.reject(uncertain)
        })
    }
    return {
      usage: reservation.usage,
      retirement: retired.promise,
      start: async (boundary) => {
        if (isStarted || state.isCancelled) throw new DeviceWorkerHostError('helper')
        isStarted = true
        let isLaunchCalled = false
        let failed: DeviceWorkerLaunch | undefined
        try {
          if (!(await this.deps.driver.selfTest())) throw new DeviceWorkerHostError('helper')
          const transport = querySchema.parse(await this.deps.driver.query())
          const env = environment(this.deps.environment, this.deps.driver.platform)
          const command = await this.deps.command(request, boundary)
          const resolver = this.deps.resolveTool ?? resolveTool
          const executable = await resolver(command.executable, env, this.deps.driver.platform)
          const executableName = path.posix.basename(executable.replaceAll('\\', '/')).toLowerCase()
          const isPowerShell =
            this.deps.driver.platform === 'win32' &&
            ['powershell.exe', 'pwsh.exe'].includes(executableName)
          if (
            isPowerShell &&
            command.args.some((arg) => arg.toLowerCase().startsWith('-executionpolicy'))
          )
            throw new DeviceWorkerHostError('preflight')
          const args = isPowerShell
            ? [
                ...WINDOWS_POWERSHELL_COMMAND_ARGS.slice(0, -1),
                '-InputFormat',
                'None',
                ...command.args,
              ]
            : command.args
          for (const tool of command.requiredTools) {
            if (!(await tool.verify(await resolver(tool.name, env, this.deps.driver.platform))))
              throw new DeviceWorkerHostError('preflight')
          }
          await this.deps.recordEnvironment(request, env)
          await boundary.beforeAction()
          if (isCancelled()) throw new DeviceWorkerHostError('helper')
          // Each attempt's own validated identity and admitted caps; copies, so no driver edits them.
          const attempt = Object.freeze({
            identity: Object.freeze({ ...request.identity }),
            caps: Object.freeze({ ...request.caps }),
          })
          isLaunchCalled = true
          const launched = await this.deps.driver.launch(
            { ...command, executable, args },
            env,
            attempt,
          )
          if (launched.kind !== 'launched') {
            failed = launched
            throw launched.error
          }
          job = launched.job
          if (isCancelled()) throw new DeviceWorkerHostError('helper')
          const query = querySchema.parse(job.query)
          if (
            this.deps.driver.platform === 'win32' &&
            (query.context.session === 0 ||
              query.context.station.toLowerCase() !== 'winsta0' ||
              (query.context.session === transport.context.session &&
                query.context.station === transport.context.station &&
                query.context.desktop === transport.context.desktop))
          ) {
            await job.cancel()
            throw new DeviceWorkerHostError('context')
          }
          this.running += 1
          isRunning = true
          await job.activate()
          observation ??= observe(job)
          if (isCancelled()) await job.cancel()
        } catch (error) {
          if (error instanceof DeviceWorkerHostError && error.detail === 'desktop-heap')
            this.deps.pressure('desktop-heap')
          if (job !== undefined) {
            observation ??= observe(job)
            await job.cancel()
          } else if (isLaunchCalled) settleFailedLaunch(failed, error)
          else {
            // The driver was never asked to launch, so nothing ran: settle as not-run work.
            isObserved = true
            retired.resolve({ refused: true, usage: reservation.usage })
          }
          throw error
        }
      },
      pause: () => reservation.pause(),
      cancel: async () => {
        state.isCancelled = true
        if (isObserved) return
        if (job !== undefined) await job.cancel()
        else if (!isStarted) {
          isObserved = true
          retired.resolve({ refused: true, usage: reservation.usage })
        }
      },
      release: async () => {
        if (!isObserved) throw new DeviceWorkerHostError('result')
        await (releasing ??= reservation.release())
      },
    }
  }
}
