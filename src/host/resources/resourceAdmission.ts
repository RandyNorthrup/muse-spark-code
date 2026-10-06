import type { ChildProcess } from 'node:child_process'
import type { ResourceJob, ResourceLease } from '../../core/resources/launch'

/** Root exit is a request to prove retirement, never proof that its descendants ended. */
export function observeResourceProcess(
  lease: ResourceLease | undefined,
  child: ChildProcess,
  job?: ResourceJob,
): void {
  if (lease === undefined) return
  lease.register({ pid: child.pid, job, group: process.platform !== 'win32' })
  child.once('exit', () => {
    lease.complete(false)
  })
  child.once('error', () => {
    lease.complete(child.pid === undefined)
  })
}
