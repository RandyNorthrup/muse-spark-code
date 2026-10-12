import type { ResourceClass, ResourceKind } from '../../shared/resources'
import type { ResourceLease, ResourceWindowsJob } from './launch'
import type { ResourceLaunchHost } from './launchHost'
import type * as Governor from './resourceGovernorEntry'
import { unlessAborted } from '../timeouts'

type ResourceHostSettings = Governor.ResourceHostSettings

/**
U–C1: what a window reads from its loaded governor host, plus the status
adapter delivered in the same lazy bundle (never at activation).
*/
export interface ResourceWindowHost {
  readonly port: Pick<
    ResourceLaunchHost,
    | 'status'
    | 'subscribe'
    | 'resume'
    | 'refreshStatus'
    | 'settingsChanged'
    | 'createRelocator'
    | 'routesChanged'
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

const runnerRoutes = new Set<() => boolean>()
/** Host-load generation: a rebind discards an in-flight host built before it. */
const hostEpoch = { value: 0 }

/**
The agent-teams availability switch. Null declares no relocation route at
all, so pressure goes throttle to pause and the UI explains that
relocation is unavailable. The live function reads the registered set, so
the runner-route sentence appears only once the wiring binds a route.
*/
function boundRelocationTarget(configured: ResourceHostSettings): (() => boolean) | null {
  return configured.hasRelocationTarget === undefined && !hasResourceRunnerRoutes()
    ? null
    : () =>
        configured.hasRelocationTarget?.() === true ||
        [...runnerRoutes].some((hasTarget) => hasTarget())
}

/** Rebind the loaded host when the first route arrives or the last one leaves. */
function rebindRoutes(): void {
  const options = state.options
  if (options === undefined) return
  if (state.pending === undefined && state.window === undefined) return
  const previous = state.pending
  delete state.pending
  state.window = undefined
  hostEpoch.value += 1
  void (async () => {
    try {
      const host = await previous
      host?.dispose()
      await state.flush?.()
    } catch {
      options.onError()
    }
  })()
}

/**
The join switch for runner-route relocation (RVCM1073 P3). The teams
wiring flips `isComplete` when the scheduler/surface ports land; until
then registration is refused, so no runner route is active in an
installed editor and the setting keeps its not-available-yet text.
*/
export const resourceRunnerRoutesJoin: { isComplete: boolean } = { isComplete: false }

/** Whether any runner route is currently registered. */
export function hasResourceRunnerRoutes(): boolean {
  return runnerRoutes.size > 0
}

/** M96c registers cached approved routes for its lifetime; no probes at activation. */
export function registerResourceRunnerRoutes(hasTarget: () => boolean): () => void {
  if (!resourceRunnerRoutesJoin.isComplete)
    return () => {
      // Refused: the join has not landed, so no route was registered.
    }
  const wasEmpty = runnerRoutes.size === 0
  runnerRoutes.add(hasTarget)
  if (wasEmpty) rebindRoutes()
  else state.window?.port.routesChanged()
  return () => {
    runnerRoutes.delete(hasTarget)
    if (runnerRoutes.size === 0) rebindRoutes()
    else state.window?.port.routesChanged()
  }
}

/** Shared, tiny Node bundle: installing settings performs no probe or governor import. */
export function configureResources(settings: ResourceHostSettings): () => void {
  delete state.pending
  runnerRoutes.clear()
  // A new configuration loads a new host; the old window's port is not reused.
  state.window = undefined
  state.options = settings
  state.isDisposed = false
  return () => {
    if (state.options !== settings) return
    state.isDisposed = true
    runnerRoutes.clear()
    state.window = undefined
    state.attachers.clear()
    void disposeHost(settings.onError)
  }
}

/** Compiling containment itself cannot allocate a helper-backed temporary root. */
export async function admitBootstrap(signal?: AbortSignal): Promise<ResourceLease> {
  const host = await load(signal)
  if (host === undefined) throw new Error('Resource admission unavailable')
  return await host.admit('other', signal, 'background', true, undefined, true)
}

async function disposeHost(onError: (error?: unknown) => void): Promise<void> {
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
  // H–C1: the runtime's one governor host builds its process's launches.
  const shared = await configured.runtime?.()
  if (shared !== undefined) return shared
  const epoch = hostEpoch.value
  const bundle = await import('./resourceGovernorEntry.js')
  state.flush = bundle.flushResourceHistory
  const host = bundle.resourceGovernorHost({
    ...configured,
    hasRelocationTarget: boundRelocationTarget(configured),
  })
  if (epoch === hostEpoch.value && !state.isDisposed && state.options === configured) {
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

async function load(signal?: AbortSignal): Promise<ResourceLaunchHost | undefined> {
  signal?.throwIfAborted()
  if (state.isDisposed) throw new Error('Resource admission disposed')
  if (state.options === undefined) return undefined
  const pending = (state.pending ??= createHost(state.options))
  const ready = (async () => {
    try {
      return await pending
    } catch (error: unknown) {
      // A failed load refuses this launch; the next one tries again.
      if (state.pending === pending) delete state.pending
      throw error
    }
  })()
  // Each caller can stop waiting without cancelling or evicting shared initialization.
  const host = signal === undefined ? await ready : await unlessAborted(ready, signal)
  signal?.throwIfAborted()
  return host
}

/**
U–C1: `attach` runs once the window's governor host loads, at the first
governed spawn or an explicit Show/Resume, or at once if it already has.
Registering imports nothing.
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
  const host = await load(signal)
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
  const host = await load(signal)
  await host?.safePoint(kind, signal)
}

/** Paired/SSH probes feed only success/failure into the already configured local governor. */
export async function reportResourceTransport(wasSuccessful: boolean): Promise<void> {
  const host = await load()
  host?.recordTransportResult(wasSuccessful)
}
