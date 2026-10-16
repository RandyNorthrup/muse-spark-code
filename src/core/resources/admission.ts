import type { ResourceClass, ResourceKind } from '../../shared/resources'
import type { ResourceLease, ResourceWindowsJob } from './launch'
import type { ResourceLaunchHost } from './launchHost'
import type * as Governor from './resourceGovernorEntry'

type ResourceHostSettings = Governor.ResourceHostSettings

/**
 * U–C1: what a window reads from its loaded governor host, plus the status
 * adapter delivered in the same lazy bundle (never at activation).
 */
export interface ResourceWindowHost {
  readonly port: Pick<
    ResourceLaunchHost,
    'status' | 'subscribe' | 'resume' | 'refreshStatus' | 'settingsChanged'
  >
  readonly createStatus: typeof Governor.createResourceStatus
  readonly createVsCodeItem: typeof Governor.createVsCodeResourceStatusItem
}

const state: {
  options?: ResourceHostSettings
  pending?: Promise<ResourceLaunchHost>
  window?: ResourceWindowHost | undefined
  readonly attachers: Set<(window: ResourceWindowHost) => void>
  flush?: () => Promise<void>
  isDisposed: boolean
} = { isDisposed: false, attachers: new Set() }

/** Shared, tiny Node bundle: installing settings performs no probe or governor import. */
export function configureResources(settings: ResourceHostSettings): () => void {
  delete state.pending
  // A new configuration loads a new host; the old window's port is not reused.
  state.window = undefined
  state.options = settings
  state.isDisposed = false
  return () => {
    if (state.options !== settings) return
    state.isDisposed = true
    state.window = undefined
    state.attachers.clear()
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
    // The window's open resource minute is written, bounded, after sampling stops.
    await state.flush?.()
  } catch {
    onError()
  }
}

async function createHost(configured: ResourceHostSettings): Promise<ResourceLaunchHost> {
  const bundle = await import('./resourceGovernorEntry.js')
  state.flush = bundle.flushResourceHistory
  const host = bundle.resourceGovernorHost(configured)
  if (!state.isDisposed && state.options === configured) {
    const window: ResourceWindowHost = {
      port: host,
      createStatus: bundle.createResourceStatus,
      createVsCodeItem: bundle.createVsCodeResourceStatusItem,
    }
    state.window = window
    for (const attach of state.attachers) {
      try {
        attach(window)
      } catch {
        configured.onError()
      }
    }
  }
  return host
}

async function load(): Promise<ResourceLaunchHost | undefined> {
  if (state.isDisposed) throw new Error('Resource admission disposed')
  if (state.options === undefined) return undefined
  state.pending ??= createHost(state.options)
  return await state.pending
}

/**
 * U–C1: `attach` runs once the window's governor host loads, at the first
 * governed spawn or an explicit Show/Resume, or at once if it already has.
 * Registering imports nothing.
 */
export function onResourceWindow(attach: (window: ResourceWindowHost) => void): () => void {
  if (state.window === undefined) state.attachers.add(attach)
  else attach(state.window)
  return () => {
    state.attachers.delete(attach)
  }
}

/** An explicit Show resources or Resume now loads the host on first use. */
export async function loadResourceWindow(): Promise<ResourceWindowHost | undefined> {
  await load()
  return state.window
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

export async function resourceWindowsJob(): Promise<ResourceWindowsJob | undefined> {
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
