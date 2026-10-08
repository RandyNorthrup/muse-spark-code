import type {
  ResourceClass,
  ResourceKind,
  ResourceProcessIdentity,
  ResourceTicket,
  ResourceTreeReader,
} from '../../shared/resources'
import type { ResourceTreeActionReader } from './trees/actions'
import type { ChildProcess, SpawnOptionsWithoutStdio } from 'node:child_process'

/**
 * Every governed launch names its lifetime (PLAN SPAWN017C):
 * contained owns its whole tree; handoff owns only a bounded OS adapter;
 * interactive inherits the terminal; bootstrap builds containment itself.
 */
export type ResourceLaunchProfile = 'contained' | 'handoff' | 'interactive' | 'bootstrap'
/** Callers cannot choose session, shell or terminal wiring; the profile does. */
export type ResourceProcessOptions = Omit<SpawnOptionsWithoutStdio, 'detached' | 'stdio' | 'shell'>
export interface ResourceInteractiveProcess {
  child: ChildProcess
  stop: () => Promise<void>
  pid: () => Promise<number | undefined>
}
/** Hand-off output goes to the null device: nothing is buffered, and nothing the OS starts holds our pipes. */
export interface ResourceHandoffProcess extends ResourceInteractiveProcess {
  child: ChildProcess & { stdin: NonNullable<ChildProcess['stdin']> }
}
export interface ResourcePipedProcess extends ResourceInteractiveProcess {
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
