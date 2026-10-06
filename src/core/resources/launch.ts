import type {
  ResourceClass,
  ResourceKind,
  ResourceProcessIdentity,
  ResourceTicket,
  ResourceTreeReader,
} from '../../shared/resources'

export interface ResourceJob {
  /** A shell job's holder must finish normally after the complete job became empty. */
  readonly isRetired?: (() => boolean) | undefined
  readonly name: string
  readonly assemblyPath: string
}
export interface ResourceProcessLaunch {
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
  readonly reader: ResourceTreeReader & {
    forget?: (ticket: ResourceTicket) => void
    kill?: (ticket: ResourceTicket, member: ResourceProcessIdentity) => Promise<boolean>
  }
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
