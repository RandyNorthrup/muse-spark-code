import type { ResourceClass, ResourceKind } from '../../shared/resources'
import type { ResourceLease } from './launch'
import type { ResourceLaunchHost } from './launchHost'
import type { ResourceHostSettings } from './resourceGovernorEntry'

const state: {
  options?: ResourceHostSettings
  pending?: Promise<ResourceLaunchHost>
  isDisposed: boolean
} = { isDisposed: false }

/** Shared, tiny Node bundle: installing settings performs no probe or governor import. */
export function configureResources(settings: ResourceHostSettings): () => void {
  state.options = settings
  state.isDisposed = false
  return () => {
    state.isDisposed = true
    void disposeHost(settings.onError)
  }
}

async function disposeHost(onError: () => void): Promise<void> {
  try {
    const host = await state.pending
    host?.dispose()
  } catch {
    onError()
  }
}

async function createHost(configured: ResourceHostSettings): Promise<ResourceLaunchHost> {
  const bundle = await import('./resourceGovernorEntry.js')
  return bundle.resourceGovernorHost(configured)
}

async function load(): Promise<ResourceLaunchHost | undefined> {
  if (state.isDisposed) throw new Error('Resource admission disposed')
  if (state.options === undefined) return undefined
  state.pending ??= createHost(state.options)
  return await state.pending
}

/** H installs this same port in the runtime; an unconfigured embedding keeps its existing policy. */
export async function admitResource(
  kind: ResourceKind,
  signal?: AbortSignal,
  workClass?: ResourceClass,
  isDiskHeavy?: boolean,
): Promise<ResourceLease | undefined> {
  const host = await load()
  return await host?.admit(kind, signal, workClass, isDiskHeavy)
}

export async function inResourceClass<T>(
  workClass: ResourceClass,
  action: () => Promise<T>,
): Promise<T> {
  const host = await load()
  return host === undefined ? await action() : await host.inClass(workClass, action)
}

export async function resourceWindowsJob(): Promise<
  { readonly assemblyPath: string; readonly executablePath: string } | undefined
> {
  return await state.options?.windowsJob?.()
}

/** Agent write adapters call this after permission/identity validation and before mutation. */
export async function assertResourceWrite(file: string): Promise<void> {
  const host = await load()
  if (host === undefined) throw new Error('Resource write guard unavailable')
  await host.assertWrite(file)
}

/** Runtime/team lanes bind this between operations; cancel never queues. */
export async function resourceSafePoint(kind: ResourceKind, signal?: AbortSignal): Promise<void> {
  const host = await load()
  await host?.safePoint(kind, signal)
}
