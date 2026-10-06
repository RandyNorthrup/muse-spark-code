import type {
  ResourceClass,
  ResourceKind,
  ResourceProcessIdentity,
  ResourceTicket,
  ResourceTreeReader,
} from '../../shared/resources'
import type { ResourceTreeActionReader } from './trees/actions'

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
export interface ResourceLease {
  /** Explicit owner shutdown only; true proves dispatch, never whole-tree retirement. */
  kill?: (() => Promise<boolean>) | undefined
  isTreeGone?: (() => Promise<boolean>) | undefined
  register(process: ResourceProcessLaunch): void
  /** true requires failed spawn, logical completion, or proved whole-tree retirement. */
  complete(isTreeGone: boolean): void
  background(): void
}
export interface ResourceAdmissionPort {
  admit(kind: ResourceKind, signal?: AbortSignal, workClass?: ResourceClass): Promise<ResourceLease>
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
