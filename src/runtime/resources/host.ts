import { ResourceEvents } from '../../core/resources/events'
import { ResourceGovernor } from '../../core/resources/governor'
import {
  ResourceQueue,
  type ResourcePermit,
  type ResourceRunningWork,
} from '../../core/resources/queue'
import { RESOURCE_OVERRIDE_MS, UI_TEXT } from '../../shared/constants'
import {
  resourceRecordSchema,
  resourceSettingsSchema,
  type ResourceClock,
  type ResourceEvent,
  type ResourceSampler,
  type ResourceSettings,
} from '../../shared/resources'
import type {
  ResourceHistoryPort,
  ResourceMachineStore,
  ResourceWorkContext,
  RuntimeResourceNotice,
  RuntimeResources,
} from './port'
import { resourceHistoryText, resourceNoticeText, resourceStatusText } from './text'

export interface RuntimeResourceHostOptions {
  clock: ResourceClock
  sampler: ResourceSampler
  machine: ResourceMachineStore
  running: ResourceRunningWork
  history?: ResourceHistoryPort
  overrides?: Partial<ResourceSettings>
  /** R provides approved availability. Headless does not supply it. */
  hasRelocationTarget?: () => boolean
  onError: (error: unknown) => void
}

/** One process owns this host; C1/T retain permits until observed retirement. */
export async function createRuntimeResourceHost(
  options: RuntimeResourceHostOptions,
): Promise<RuntimeResources> {
  let settings = resourceSettingsSchema.parse({
    ...(await options.machine.readSettings()),
    ...options.overrides,
  })
  const events = new ResourceEvents(options.onError)
  const listeners = new Map<string, Set<(notice: RuntimeResourceNotice) => void>>()
  const work = new Map<symbol, ResourceWorkContext>()
  const permits = new WeakMap<ResourcePermit, ResourcePermit>()
  let currentWork: ResourceWorkContext | undefined
  let isDisposed = false
  let appliedUntil: number | null = null
  let resumeAt: number | undefined
  const clock: ResourceClock = {
    now: () => resumeAt ?? options.clock.now(),
    setTimeout: (callback, delayMs) =>
      options.clock.setTimeout(
        callback,
        resumeAt === undefined ? delayMs : Math.max(0, resumeAt + delayMs - options.clock.now()),
      ),
  }
  const sync = async () => {
    const next = resourceSettingsSchema.parse({
      ...(await options.machine.readSettings()),
      ...options.overrides,
    })
    const until = await options.machine.readResumeUntil()
    if (isDisposed) throw new Error(UI_TEXT.resourceUnavailable)
    if (JSON.stringify(next) !== JSON.stringify(settings)) {
      settings = next
      governor.updateSettings(settings)
    }
    const now = options.clock.now()
    if (until !== null && until > now + RESOURCE_OVERRIDE_MS)
      throw new Error(UI_TEXT.resourceUnavailable)
    if (until === null || until === appliedUntil || !settings.enabled || until <= now) return

    appliedUntil = until
    // Replaying a terminal marker retains its deadline, rather than extending it.
    resumeAt = until - RESOURCE_OVERRIDE_MS
    try {
      governor.resumeNow()
    } finally {
      resumeAt = undefined
    }
  }
  const governor = new ResourceGovernor({
    clock,
    sampler: {
      async sample() {
        await sync()
        return await options.sampler.sample()
      },
    },
    settings,
    events,
    hasRelocationTarget: options.hasRelocationTarget ?? (() => false),
    onError: options.onError,
  })
  const queue = new ResourceQueue({
    clock,
    events,
    capacity: (kind) => governor.capacity(kind),
    running: options.running,
  })
  const snapshot = () => governor.status(queue.counts())
  const unsubscribe = events.subscribe((event) => {
    const allWork = Array.from(work.values(), (context) => ({ ...context }))
    const onlyCurrent = currentWork === undefined ? [] : [currentWork]
    const contexts = event.type === 'deferred' || event.type === 'paused' ? onlyCurrent : allWork
    const notified = new Set<string>()
    for (const context of contexts) {
      if (notified.has(context.sessionId)) continue
      notified.add(context.sessionId)
      const sessionListeners = listeners.get(context.sessionId) ?? []
      for (const listener of sessionListeners) {
        try {
          listener({
            event: structuredClone(event),
            status: snapshot(),
            text: resourceNoticeText(event, snapshot()),
            ...(context.toolCallId !== undefined && { toolCallId: context.toolCallId }),
          })
        } catch (error) {
          options.onError(error)
        }
      }
    }
  })
  const ensureOpen = () => {
    if (isDisposed) throw new Error(UI_TEXT.resourceUnavailable)
  }
  const host: RuntimeResources = {
    async command(action, json) {
      if (action === 'history') {
        const records = await host.history()
        return json ? JSON.stringify(records) : resourceHistoryText(records)
      }
      const status = await (action === 'resume' ? host.resume() : host.status())
      return json ? JSON.stringify(status) : resourceStatusText(status)
    },
    async status() {
      ensureOpen()
      await sync()
      await governor.refresh()
      ensureOpen()
      return snapshot()
    },
    async history() {
      ensureOpen()
      if (options.history === undefined) throw new Error(UI_TEXT.resourceUnavailable)
      const records = await options.history.read()
      ensureOpen()
      return records.map((record) => resourceRecordSchema.parse(record))
    },
    async resume() {
      ensureOpen()
      await options.machine.writeResumeUntil(options.clock.now() + RESOURCE_OVERRIDE_MS)
      await sync()
      return snapshot()
    },
    async admit(request, context, signal) {
      ensureOpen()
      signal?.throwIfAborted()
      await sync()
      ensureOpen()
      signal?.throwIfAborted()
      governor.start()
      const id = Symbol()
      if (context !== undefined) work.set(id, { ...context })
      currentWork = context
      try {
        const admission = queue.request(
          {
            ...request,
            ...(request.parent !== undefined && {
              parent: permits.get(request.parent) ?? request.parent,
            }),
          },
          signal,
        )
        return {
          ...admission,
          ready: (async () => {
            try {
              const permit = await admission.ready
              const handle = {
                ...permit,
                release() {
                  work.delete(id)
                  permit.release()
                },
              }
              permits.set(handle, permit)
              return handle
            } catch (error) {
              work.delete(id)
              throw error
            }
          })(),
        }
      } catch (error) {
        work.delete(id)
        throw error
      } finally {
        currentWork = undefined
      }
    },
    subscribe(sessionId, listener) {
      ensureOpen()
      const session = listeners.get(sessionId) ?? new Set()
      session.add(listener)
      listeners.set(sessionId, session)
      return () => {
        session.delete(listener)
        if (session.size === 0) listeners.delete(sessionId)
      }
    },
    workChanged() {
      queue.wake()
    },
    subscribeEvents(listener) {
      ensureOpen()
      return events.subscribe((event: ResourceEvent) => {
        const status = snapshot()
        listener(event, status, resourceNoticeText(event, status))
      })
    },
    dispose() {
      isDisposed = true
      unsubscribe()
      listeners.clear()
      work.clear()
      queue.dispose()
      governor.dispose()
    },
  }
  return host
}
