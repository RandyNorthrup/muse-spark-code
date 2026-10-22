import { AsyncLocalStorage } from 'node:async_hooks'
import path from 'node:path'
import { lazyBundleLoader } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import { UI_TEXT } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import type { ResourceSettings } from '../../shared/resources'
import type {
  ResourceHostSettings,
  createResources,
} from '../../core/resources/resourceGovernorEntry'
import type { ResourceEntryOptions } from './entry'
import type { ResourceWorkContext, RuntimeResources } from './port'
import { configureResources } from '../../core/resources/admission'
import { runtimeWindowsJob } from './jobs'
import { unlessAborted } from '../../core/timeouts'

interface ResourceModule {
  createResources: typeof createResources
}
function isResourceModule(value: unknown): value is ResourceModule {
  // Same-build entry/loader contract, validated like the existing lazy bundle ports.
  return (
    typeof value === 'object' &&
    value !== null &&
    'createResources' in value &&
    typeof value.createResources === 'function'
  )
}

/** H–C1: what one command contributes to its process's one governor. */
export interface RuntimeResourceRun {
  /** Headless's run flags over the machine values. */
  readonly overrides?: Partial<ResourceSettings> | undefined
  /** The ACP agent's usage-history consent; every other command only reads history. */
  readonly isRecordingHistory?: (() => boolean) | undefined
}

/**
The process's one governor (H–C1): every command, the ACP agent and headless
runs share it, and so do the spawns admitted through the process's port.
*/
export interface ProcessResources extends RuntimeResources {
  /**
  The ACP agent's recording consent or headless's run flags. Before the first
  governed use or after it: they apply at the next settings sync or sample.
  */
  configure(run: RuntimeResourceRun): ProcessResources
}

/** The runtime's resource reading is unavailable: shut down or never loaded. */
export class ResourceUnavailableError extends Error {
  public constructor() {
    super(UI_TEXT.resourceUnavailable)
  }
}

/** Creating/subscribing the facade never loads the bundle or reads machine settings. */
export function lazyRuntimeResources(
  options: ResourceEntryOptions & {
    distDir: string
    log: Logger
    loadBundle?: (file: string) => unknown
  },
): ProcessResources {
  const module = lazyBundleLoader({
    bundlePath: path.join(options.distDir, 'resourceGovernor.js'),
    log: options.log,
    label: 'resource governor',
    isBundle: isResourceModule,
    unavailable: () => UI_TEXT.resourceUnavailable,
    ...(options.loadBundle !== undefined && { loadBundle: options.loadBundle }),
  })
  type Loaded = Awaited<ReturnType<typeof createResources>>
  let pending: Promise<Loaded> | undefined
  let loaded: Loaded | undefined
  const state = { isDisposed: false }
  const subscriptions = new Set<(host: RuntimeResources) => () => void>()
  const bound = new Map<(host: RuntimeResources) => () => void, () => void>()
  // H–C1: the run is read live, so a command's flags or consent never need a second governor.
  let overrides = options.overrides
  let isRecordingHistory = options.isRecordingHistory
  // H–C1: the session whose turn admits a spawn hears about it; never in a payload.
  const sessions = new AsyncLocalStorage<ResourceWorkContext>()
  const load = async (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    if (state.isDisposed) throw new ResourceUnavailableError()
    pending ??= (async () => {
      await Promise.resolve()
      let created: Loaded | undefined
      try {
        const host = await module().createResources(
          {
            ...options,
            overrides: () => (typeof overrides === 'function' ? overrides() : overrides),
            // Always bound, off unless the ACP agent consents: it may say so after loading.
            isRecordingHistory: () => isRecordingHistory?.() ?? false,
            spawns,
          },
          UI_TEXT,
          uiLocale(),
        )
        created = host
        if (state.isDisposed) {
          throw new ResourceUnavailableError()
        }
        loaded = host
        for (const subscribe of subscriptions) bound.set(subscribe, subscribe(host))
        return host
      } catch (error) {
        // Release half-bound subscriptions in insertion order before the
        // failure keeps its kind past the load.
        bound.forEach((unsubscribe) => {
          unsubscribe()
        })
        bound.clear()
        loaded = undefined
        created?.dispose()
        pending = undefined
        throw error
      }
    })()
    // Initialization belongs to the process; cancellation belongs to this caller.
    const host = signal === undefined ? await pending : await unlessAborted(pending, signal)
    signal?.throwIfAborted()
    if (host === undefined) throw new ResourceUnavailableError()
    return host
  }
  const subscribe = (bind: (host: RuntimeResources) => () => void) => {
    if (state.isDisposed) throw new ResourceUnavailableError()
    subscriptions.add(bind)
    if (loaded !== undefined) bound.set(bind, bind(loaded))
    return () => {
      subscriptions.delete(bind)
      bound.get(bind)?.()
      bound.delete(bind)
    }
  }
  // As the extension builds its helpers once per activation, the runtime prepares
  // (compiles and self-tests) both Windows job helpers once; a failure is retried.
  const windowsJob = runtimeWindowsJob(options.machineDir, path.dirname(options.distDir))
  const spawns: ResourceHostSettings = {
    // The registry refuses a group- or world-writable parent, and the data folder
    // takes the user's umask (002 on Ubuntu desktops), so it keeps a folder of
    // its own that it creates private.
    registryFile: path.join(options.machineDir, 'resource-created', 'registry.json'),
    inspect: () => ({}),
    onError: () => {
      options.log.warn(UI_TEXT.resourceUnavailable)
    },
    // The caller's deadline is armed before loading and sampling, so a slow
    // bundle, settings read or sampler cannot outlast it (SPAWN017C item 3).
    admission: async (request, signal) => {
      let abort: (() => void) | undefined
      try {
        return await Promise.race([
          new Promise<never>((_resolve, reject) => {
            abort = () => {
              reject(
                signal?.reason instanceof Error
                  ? signal.reason
                  : new DOMException('Resource admission cancelled', 'AbortError'),
              )
            }
            signal?.addEventListener('abort', abort, { once: true })
            if (signal?.aborted === true) abort()
          }),
          (async () => {
            signal?.throwIfAborted()
            const host = await load()
            await host.status(signal)
            signal?.throwIfAborted()
            return await host.admit(request, sessions.getStore(), signal)
          })(),
        ])
      } finally {
        if (abort !== undefined) signal?.removeEventListener('abort', abort)
      }
    },
    windowsJob,
  }
  const disposeAdmission = configureResources({
    ...spawns,
    // H–C1: the process's spawns are the runtime host's launches, sharing its one governor.
    runtime: async () => {
      const host = await load()
      return host.launches?.()
    },
  })
  const facade: ProcessResources = {
    configure(run) {
      if (state.isDisposed) throw new ResourceUnavailableError()
      if (run.overrides !== undefined) overrides = run.overrides
      if (run.isRecordingHistory !== undefined) isRecordingHistory = run.isRecordingHistory
      return facade
    },
    async command(action, isJson) {
      const host = await load()
      return await host.command(action, isJson)
    },
    async status() {
      const host = await load()
      return await host.status()
    },
    async history() {
      const host = await load()
      return await host.history()
    },
    async resume() {
      const host = await load()
      return await host.resume()
    },
    async admit(request, context, signal) {
      signal?.throwIfAborted()
      const host = await load(signal)
      return await host.admit(request, context, signal)
    },
    subscribe: (sessionId, listener) => subscribe((host) => host.subscribe(sessionId, listener)),
    subscribeEvents: (listener) => subscribe((host) => host.subscribeEvents(listener)),
    workChanged() {
      loaded?.workChanged()
    },
    inSession: (sessionId, action) => sessions.run({ sessionId }, action),
    dispose() {
      // The ACP agent or a headless run and the process itself may both close it.
      if (state.isDisposed) return
      disposeAdmission()
      state.isDisposed = true
      for (const unsubscribe of bound.values()) unsubscribe()
      bound.clear()
      subscriptions.clear()
      loaded?.dispose()
    },
  }
  return facade
}
