// Fake-only resource owner; the launch profile and detached/stdio behavior remain production code.
import type { ResourceLease, ResourceProcessLaunch } from '../../../../src/core/resources/launch'
const active = new Set<ResourceLease>()
export function admitResource(): Promise<ResourceLease> {
  let launched: ResourceProcessLaunch | undefined
  const lease: ResourceLease = {
    register: (value) => {
      launched = value
    },
    complete: () => {
      active.delete(lease)
    },
    background: () => undefined,
    kill: () => {
      if (launched?.pid !== undefined) {
        try {
          process.kill(launched.group ? -launched.pid : launched.pid, 'SIGKILL')
        } catch {
          /* Already exited. */
        }
      }
      return Promise.resolve(true)
    },
  }
  active.add(lease)
  return Promise.resolve(lease)
}
export async function admitBootstrap(): Promise<ResourceLease> {
  return await admitResource()
}
export const resourceWindowsJob = () => Promise.resolve(undefined)
export async function stopResourceTree(lease: ResourceLease): Promise<void> {
  await lease.kill?.()
}
export async function disposeSession(): Promise<void> {
  for (const lease of active) await lease.kill?.()
}
export function configureResources(): never {
  throw new Error('the generated fixture never runs the installed main')
}
