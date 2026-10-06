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
): Promise<ResourceLease | undefined> {
  const host = await load()
  return await host?.admit(kind, signal, workClass)
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

/** Owner Stop bypasses admission; refusal never authorizes a legacy PID/job fallback. */
export async function stopResourceTree(resource: ResourceLease): Promise<void> {
  if ((await resource.kill?.()) || (await resource.isTreeGone?.())) return
  throw new Error('Registered resource tree could not be stopped')
}
