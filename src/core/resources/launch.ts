import type {
  ResourceClass,
  ResourceKind,
  ResourceProcessIdentity,
  ResourceTicket,
  ResourceTreeReader,
  ResourceTreeUsage,
} from '../../shared/resources'
import type { ResourceTreeActionReader } from './trees/actions'
import type { ChildProcess, SpawnOptionsWithoutStdio } from 'node:child_process'
import { UI_TEXT } from '../../shared/constants'

/**
 * Every governed launch names its lifetime (PLAN SPAWN017C):
 * contained owns its whole tree and a temp root; probe (read-only, bounded) owns
 * its whole tree but no temp root; handoff owns only a bounded OS adapter;
 * interactive inherits the terminal; bootstrap builds containment itself.
 */
export type ResourceLaunchProfile = 'contained' | 'probe' | 'handoff' | 'interactive' | 'bootstrap'
/** Callers cannot choose session, shell or terminal wiring; the profile does. */
export type ResourceProcessOptions = Omit<
  SpawnOptionsWithoutStdio,
  'detached' | 'stdio' | 'shell'
> & {
  /**
   * The whole tree's committed memory cap in bytes. Enforced only by the Windows
   * attested job (contained and probe), whose outcome then names `jobMemory`
   * when the kernel enforced it; other platforms and profiles set no cap.
   */
  readonly jobMemoryBytes?: number | undefined
  /** Hand-off only: when the adapter counts as launched (see ResourceHandoffUntil). */
  readonly handoffUntil?: ResourceHandoffUntil | undefined
}
/**
 * 'exit': the adapter's exit 0, or still running at the named deadline (then
 * detached, never killed). 'spawn': a foreground handler that may stay with
 * what it opened (xdg-open), launched once it has started, in its own session.
 */
export type ResourceHandoffUntil = 'exit' | 'spawn'
export interface ResourceInteractiveProcess {
  child: ChildProcess
  stop: () => Promise<void>
  pid: () => Promise<number | undefined>
}
/** Hand-off output goes to the null device: nothing is buffered, and nothing the OS starts holds our pipes. */
export interface ResourceHandoffProcess extends ResourceInteractiveProcess {
  /** stdin is a pipe for 'exit' hand-offs and absent for 'spawn' ones. */
  child: ChildProcess
  /** Resolves once the adapter counts as launched; rejects when it failed or was cancelled. */
  handedOff: Promise<void>
}
/** How a governed tree ended, as far as its platform can prove (SPAWN017C). */
export interface ResourceTreeOutcome {
  /** True only when the whole tree's exit was observed (Windows: an emptied record). */
  readonly isRetirementProved: boolean
  /** Children the job's process cap refused; reported even when the root exits 0. */
  readonly capRefusals: number
  /** The job limits the kernel enforced against this tree (process cap, memory). */
  readonly limits: readonly ResourceJobLimit[]
}
export type ResourceJobLimit = 'activeProcess' | 'jobMemory' | 'processMemory'

// The governor's typed refusals live with the launch contract: every bundle
// may check them, and none carries resource policy to do so.

/** The governor's own status words ("Resources: Paused"), as the status command prints them. */
export function resourcePausedText(): string {
  return `${UI_TEXT.resourceTitle}: ${UI_TEXT.resourcePause}`
}

/** A policy refusal, never a missing containment helper or cancelled admission. */
export class ResourcePausedError extends Error {
  readonly code = 'paused'

  constructor() {
    super(resourcePausedText())
    this.name = 'ResourcePausedError'
  }
}

/** Structural, not instanceof: the queue that refuses lives in another bundle than its callers. */
export function isResourcePaused(error: unknown): error is ResourcePausedError {
  return (
    error instanceof Error &&
    error.name === 'ResourcePausedError' &&
    'code' in error &&
    error.code === 'paused'
  )
}

/** The job's process cap refused at least one child of this tree. */
export class ResourceCapRefusedError extends Error {
  readonly code = 'capRefused'

  constructor(readonly refusals: number) {
    super('A governed command was refused a child process by its process cap')
    this.name = 'ResourceCapRefusedError'
  }
}

/** The kernel enforced the job's memory limit on this tree: a memory cap, not a generic failure. */
export class ResourceMemoryLimitError extends Error {
  readonly code = 'memoryLimit'

  constructor(readonly limit: Exclude<ResourceJobLimit, 'activeProcess'>) {
    super('A governed command reached its memory limit')
    this.name = 'ResourceMemoryLimitError'
  }
}

/** Structural, not instanceof: the launcher and its callers live in different bundles. */
export function isResourceCapRefused(error: unknown): error is ResourceCapRefusedError {
  return (
    error instanceof Error &&
    error.name === 'ResourceCapRefusedError' &&
    'code' in error &&
    error.code === 'capRefused'
  )
}

export function isResourceMemoryLimit(error: unknown): error is ResourceMemoryLimitError {
  return (
    error instanceof Error &&
    error.name === 'ResourceMemoryLimitError' &&
    'code' in error &&
    error.code === 'memoryLimit'
  )
}
export interface ResourcePipedProcess extends ResourceInteractiveProcess {
  /** Settles after exit; undefined where the platform attests nothing (POSIX, bootstrap). */
  outcome: () => Promise<ResourceTreeOutcome | undefined>
  child: ChildProcess & {
    stdin: NonNullable<ChildProcess['stdin']>
    stdout: NonNullable<ChildProcess['stdout']>
    stderr: NonNullable<ChildProcess['stderr']>
  }
}

export interface ResourceJob {
  /** A shell job's holder must finish normally after the complete job became empty. */
  readonly isRetired?: (() => boolean) | undefined
  readonly name: string
  readonly assemblyPath: string
}
export interface ResourceProcessLaunch {
  /** Other specialized launchers own contained trees; portable profiles name their lifetime. */
  readonly profile?: ResourceLaunchProfile
  readonly stop?: () => Promise<void>
  readonly pid?: number | undefined
  readonly job?: ResourceJob | undefined
  /** True only when the launcher created a dedicated POSIX process group. */
  readonly group?: boolean | undefined
  /** An SDK wrapper's PID must also be proved a direct child of the harness. */
  readonly parentPid?: number | undefined
  /**
   * SPAWN017C (Windows): the launcher's job attests its own tree. Its observed
   * exit proves the tree gone, its job enforces the caps, and its final record
   * settles the usage; no registry reader binds it.
   */
  readonly attested?: boolean | undefined
}
/** The prepared Windows helpers; `verify` runs before every launch (SPAWN017C). */
export interface ResourceWindowsJob {
  readonly assemblyPath: string
  readonly executablePath: string
  /** Throws ResourceHelperChangedError when the sealed launcher bytes changed. */
  readonly verify: () => Promise<void>
}
/** One attested tree's final usage; usage null when the record never arrived. */
export interface ResourceSettlement {
  readonly root: ResourceProcessIdentity
  readonly scope: string
  readonly usage: ResourceTreeUsage | null
}
export interface ResourceTempRoot {
  readonly root: string
  readonly profile: string
  readonly cache: string
  readonly environment: Readonly<Record<string, string>>
  finish(isFailed: boolean): Promise<void>
}
export interface ResourceTempRoots {
  create(owner: string): Promise<ResourceTempRoot>
}

export interface ResourceLease {
  readonly temp?: ResourceTempRoot | undefined
  /** Retirement and failure are separate: a failed tree still needs whole-tree proof. */
  readonly failed?: (() => void) | undefined
  /** Explicit owner shutdown only; true proves dispatch, never whole-tree retirement. */
  kill?: (() => Promise<boolean>) | undefined
  isTreeGone?: (() => Promise<boolean>) | undefined
  register(process: ResourceProcessLaunch): void
  /** true requires failed spawn, logical completion, or proved whole-tree retirement. */
  complete(isTreeGone: boolean): void
  /** An attested launch's final usage, before complete; history reads it. */
  settle?: ((settlement: ResourceSettlement) => void) | undefined
  /**
   * The tree's exit was not observed (no emptied record): admission is
   * released, the temp root is kept for recovery, and the failure is reported.
   * A lease without this path holds admission instead (complete(false)).
   */
  uncertain?: (() => void) | undefined
  background(): void
}
export interface ResourceAdmissionPort {
  admit(
    kind: ResourceKind,
    signal?: AbortSignal,
    workClass?: ResourceClass | 'checkpoint',
    isDiskHeavy?: boolean,
    checkpointDestination?: string,
  ): Promise<ResourceLease>
  run<T>(kind: ResourceKind, action: () => Promise<T>, signal?: AbortSignal): Promise<T>
}
export interface ResourceTreeBinding {
  readonly reader: ResourceTreeReader &
    Partial<ResourceTreeActionReader> & { forget?: (ticket: ResourceTicket) => void }
  readonly root: ResourceProcessIdentity | null
  readonly scope: ResourceTicket['scope']
  /** Failure is unknown, never retirement. */
  gone(): Promise<boolean>
}

/** Case-insensitive replacement also covers Windows' environment aliases. */
export function resourceEnvironment(
  env: Readonly<NodeJS.ProcessEnv>,
  lease: ResourceLease | undefined,
): NodeJS.ProcessEnv {
  if (lease?.temp === undefined) return { ...env }
  const projected = Object.fromEntries(
    Object.entries(env).filter(([name]) => !['TMPDIR', 'TEMP', 'TMP'].includes(name.toUpperCase())),
  )
  return { ...projected, ...lease.temp.environment }
}
