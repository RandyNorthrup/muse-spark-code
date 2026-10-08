import type { ResourceClass, ResourceKind } from '../../shared/resources'
import type { ResourceLease } from './launch'
import type { ResourceLaunchHost } from './launchHost'
import type { ResourceHostSettings } from './resourceGovernorEntry'
import type { spawnResourceProcess as ResourceProcessLauncher } from './process'
import type { execResourceFile as ResourceCommandRunner } from './commands'

const state: {
  options?: ResourceHostSettings
  pending?: Promise<ResourceLaunchHost>
  isDisposed: boolean
} = { isDisposed: false }

/** Portable process launch lives in the existing first-use governor bundle. */
export async function spawnResourceProcess(
  ...args: Parameters<typeof ResourceProcessLauncher>
): Promise<Awaited<ReturnType<typeof ResourceProcessLauncher>>> {
  const bundle = await import('./resourceGovernorEntry.js')
  return await bundle.spawnResourceProcess(...args)
}

/** Bounded helper commands share the same lazy process boundary. */
export async function execResourceFile(
  ...args: Parameters<typeof ResourceCommandRunner>
): Promise<Awaited<ReturnType<typeof ResourceCommandRunner>>> {
  const bundle = await import('./resourceGovernorEntry.js')
  return await bundle.execResourceFile(...args)
}

/** Shared, tiny Node bundle: installing settings performs no probe or governor import. */
export function configureResources(settings: ResourceHostSettings): () => void {
  delete state.pending
  state.options = settings
  state.isDisposed = false
  return () => {
    if (state.options !== settings) return
    state.isDisposed = true
    void disposeHost(settings.onError)
  }
}

/** Compiling containment itself cannot allocate a helper-backed temporary root. */
export async function admitBootstrap(signal?: AbortSignal): Promise<ResourceLease> {
  const host = await load()
  if (host === undefined) throw new Error('Resource admission unavailable')
  return await host.admit('other', signal, 'background', true, undefined, true)
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
  workClass?: ResourceClass | 'checkpoint',
  isDiskHeavy?: boolean,
  checkpointDestination?: string,
  isTempFree?: boolean,
): Promise<ResourceLease | undefined> {
  const host = await load()
  return await host?.admit(kind, signal, workClass, isDiskHeavy, checkpointDestination, isTempFree)
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

/** Paired/SSH probes feed only success/failure into the already configured local governor. */
export async function reportResourceTransport(wasSuccessful: boolean): Promise<void> {
  const host = await load()
  host?.recordTransportResult(wasSuccessful)
}
