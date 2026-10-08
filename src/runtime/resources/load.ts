import path from 'node:path'
import { lazyBundleLoader } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import { UI_TEXT } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import type { ResourceEntryOptions, createResources } from './entry'
import type { RuntimeResources } from './port'
import { configureResources } from '../../core/resources/admission'
import type { runtimeResourceJobs } from './entry'

interface ResourceModule {
  createResources: typeof createResources
  runtimeResourceJobs: typeof runtimeResourceJobs
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

/** Creating/subscribing the facade never loads the bundle or reads machine settings. */
export function lazyRuntimeResources(
  options: ResourceEntryOptions & {
    distDir: string
    log: Logger
    loadBundle?: (file: string) => unknown
  },
): RuntimeResources {
  const module = lazyBundleLoader({
    bundlePath: path.join(options.distDir, 'resourceGovernor.js'),
    log: options.log,
    label: 'resource governor',
    isBundle: isResourceModule,
    unavailable: () => UI_TEXT.resourceUnavailable,
    ...(options.loadBundle !== undefined && { loadBundle: options.loadBundle }),
  })
  let pending: Promise<RuntimeResources> | undefined
  let loaded: RuntimeResources | undefined
  const state = { isDisposed: false }
  const subscriptions = new Set<(host: RuntimeResources) => () => void>()
  const bound = new Map<(host: RuntimeResources) => () => void, () => void>()
  const load = async () => {
    if (state.isDisposed) throw new Error(UI_TEXT.resourceUnavailable)
    pending ??= (async () => {
      await Promise.resolve()
      let created: RuntimeResources | undefined
      try {
        const host = await module().createResources(options, UI_TEXT, uiLocale())
        created = host
        if (state.isDisposed) {
          throw new Error(UI_TEXT.resourceUnavailable)
        }
        loaded = host
        for (const subscribe of subscriptions) bound.set(subscribe, subscribe(host))
        return host
      } catch (error) {
        for (const unsubscribe of bound.values()) unsubscribe()
        bound.clear()
        loaded = undefined
        created?.dispose()
        pending = undefined
        throw error
      }
    })()
    return await pending
  }
  const subscribe = (bind: (host: RuntimeResources) => () => void) => {
    if (state.isDisposed) throw new Error(UI_TEXT.resourceUnavailable)
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
  let jobs: ReturnType<typeof runtimeResourceJobs> | undefined
  const windowsJob = async () => {
    jobs ??= module().runtimeResourceJobs(options.machineDir, path.dirname(options.distDir))
    const current = jobs
    try {
      const ready = await current
      if (ready === undefined && jobs === current) jobs = undefined
      return ready
    } catch (error: unknown) {
      if (jobs === current) jobs = undefined
      throw error
    }
  }
  const disposeAdmission = configureResources({
    registryFile: path.join(options.machineDir, 'resource-created.json'),
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
            return await host.admit(request, undefined, signal)
          })(),
        ])
      } finally {
        if (abort !== undefined) signal?.removeEventListener('abort', abort)
      }
    },
    windowsJob,
  })
  return {
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
      const host = await load()
      return await host.admit(request, context, signal)
    },
    subscribe: (sessionId, listener) => subscribe((host) => host.subscribe(sessionId, listener)),
    subscribeEvents: (listener) => subscribe((host) => host.subscribeEvents(listener)),
    workChanged() {
      loaded?.workChanged()
    },
    dispose() {
      disposeAdmission()
      state.isDisposed = true
      for (const unsubscribe of bound.values()) unsubscribe()
      bound.clear()
      subscriptions.clear()
      loaded?.dispose()
    },
  }
}
