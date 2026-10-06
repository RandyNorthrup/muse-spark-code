import * as z from 'zod/mini'
import type {
  ResourceProcessIdentity,
  ResourceTicket,
  ResourceTreeReader,
} from '../../../shared/resources'

export const resourceSignalSchema = z.enum(['SIGTERM', 'SIGKILL'])
export type ResourceSignal = z.infer<typeof resourceSignalSchema>
export const resourceActionResultSchema = z.enum(['done', 'gone', 'identity-changed', 'refused'])
export type ResourceActionResult = z.infer<typeof resourceActionResultSchema>

/** Internal mutation port. The reader holds the OS identity proof through the action. */
export interface ResourceTreeActionReader extends ResourceTreeReader {
  /** Kernel-contained trees return completion only after their empty-scope receipt. */
  killCgroup?(
    ticket: ResourceTicket,
    signal: ResourceSignal,
    isRegistered: () => boolean,
  ): Promise<ResourceTreeKillResult>
  actionMembers(ticket: ResourceTicket): Promise<readonly ResourceProcessIdentity[] | null>
  signal(
    ticket: ResourceTicket,
    member: ResourceProcessIdentity,
    signal: ResourceSignal,
    isRegistered: () => boolean,
  ): Promise<ResourceActionResult>
}

export interface ResourceTreeKillResult {
  readonly status: ResourceActionResult | 'cgroup_changed'
  readonly members: readonly {
    readonly identity: ResourceProcessIdentity
    readonly result: ResourceActionResult
  }[]
}

/** Invoke synchronously after the platform's final birth read, with no intervening await. */
export function signalVerifiedPosix(
  expected: ResourceProcessIdentity,
  current: (ResourceProcessIdentity & { readonly exited?: boolean | undefined }) | null,
  signal: ResourceSignal,
  isRegistered: () => boolean,
  send: (pid: number, signal: ResourceSignal) => void = (pid, requested) => {
    process.kill(pid, requested)
  },
): ResourceActionResult {
  if (
    !isRegistered() ||
    expected.pid === process.pid ||
    !Number.isSafeInteger(expected.pid) ||
    expected.pid <= 0
  )
    return 'refused'
  if (current === null) return 'gone'
  if (current.pid !== expected.pid || current.startTime !== expected.startTime)
    return 'identity-changed'
  if (current.exited === true) return 'gone'
  try {
    send(expected.pid, signal)
    return 'done'
  } catch (error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH'
      ? 'gone'
      : 'refused'
  }
}
