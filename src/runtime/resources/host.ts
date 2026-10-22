import { ResourceEvents } from '../../core/resources/events'
import { ResourceGovernor } from '../../core/resources/governor'
import type { ResourceLaunchHost, ResourceTreeUsageRow } from '../../core/resources/launchHost'
import {
  ResourceQueue,
  type ResourcePermit,
  type ResourceRunningWork,
} from '../../core/resources/queue'
import { RESOURCE_OVERRIDE_MS, RESOURCE_SAMPLE_MS, UI_TEXT } from '../../shared/constants'
import { resourceHistorySchema } from '../../shared/resourceHistory'
import {
  resourceSettingsSchema,
  type ResourceClock,
  type ResourceEvent,
  type ResourceSampler,
  type ResourceSettings,
  type ResourceStatus,
} from '../../shared/resources'
import { resourceHistoryText } from '../../core/usage/resourceText'
import type {
  ResourceHistoryPort,
  ResourceMachineStore,
  ResourceWorkContext,
  RuntimeResourceNotice,
  RuntimeResources,
} from './port'
import { readResource, ResourceReadingError, resourceNoticeText, resourceStatusText } from './text'

export interface RuntimeResourceHostOptions {
  clock: ResourceClock
  sampler: ResourceSampler
  machine: ResourceMachineStore
  running: ResourceRunningWork
  history?: ResourceHistoryPort
  /** J's recorder observes each governor sample; it never delays admission. */
  onSample?: (status: ResourceStatus) => void
  overrides?: Partial<ResourceSettings>
  /** R provides approved availability; headless never does. Absent: no relocation route. */
  hasRelocationTarget?: () => boolean
  onError: (error: unknown) => void
  /**
  H–C1: builds this process's governed launch host around this host's one
  governor, once, at the first governed launch. Its registered work is then
  this queue's occupancy and its trees are history's harness-work rows.
  */
  launches?: ((share: RuntimeGovernorShare) => ResourceLaunchHost) | undefined
}

/** H–C1: what the process's launch host borrows; nothing here is a second governor. */
export interface RuntimeGovernorShare {
  readonly governor: ResourceGovernor
  readonly events: ResourceEvents
  /** The settings this host last synced: machine values and the run's flags. */
  readonly settings: () => ResourceSettings
  /** Registered work changed: this host's queue reads occupancy again. */
  readonly workChanged: () => void
}

/** The runtime host as its process uses it (H–C1); surfaces see only RuntimeResources. */
export interface RuntimeResourceProcess extends RuntimeResources {
  /** The process's governed launches, built on first use; absent without a builder. */
  readonly launches?: () => ResourceLaunchHost
  /** Their harness-work rows for history; none before the first governed launch. */
  readonly launchRows: () => readonly ResourceTreeUsageRow[]
}

/** One process owns this host; C1/T retain permits until observed retirement. */
export async function createRuntimeResourceHost(
  options: RuntimeResourceHostOptions,
): Promise<RuntimeResourceProcess> {
  let settings = resourceSettingsSchema.parse({
    ...(await readResource('resources.settings', () => options.machine.readSettings())),
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
    const next = await readResource('resources.settings', async () =>
      resourceSettingsSchema.parse({
        ...(await options.machine.readSettings()),
        ...options.overrides,
      }),
    )
    const until = await readResource('resources.resume', () => options.machine.readResumeUntil())
    if (isDisposed) throw new Error(UI_TEXT.resourceUnavailable)
    if (JSON.stringify(next) !== JSON.stringify(settings)) {
      settings = next
      governor.updateSettings(settings)
    }
    const now = options.clock.now()
    if (until !== null && until > now + RESOURCE_OVERRIDE_MS)
      throw new ResourceReadingError('resources.resume')
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
        return await readResource('resources.sample', () => options.sampler.sample())
      },
      dispose() {
        options.sampler.dispose?.()
      },
    },
    settings,
    events,
    hasRelocationTarget: options.hasRelocationTarget ?? null,
    onError: options.onError,
  })
  // H–C1: once the process's launches exist, every admitted spawn is theirs, so
  // their registered work is the occupancy (unknown trees still count as busy).
  let launch: ResourceLaunchHost | undefined
  const queue = new ResourceQueue({
    clock,
    events,
    capacity: (kind) => governor.capacity(kind),
    running: { backgroundCount: (kind) => (launch ?? options.running).backgroundCount(kind) },
  })
  const snapshot = () => governor.status(queue.counts())
  const onSample = options.onSample
  if (onSample !== undefined)
    governor.onSample(() => {
      try {
        onSample(snapshot())
      } catch (error) {
        options.onError(error)
      }
    })
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
  // One sample interval on a referenced timer: the second CPU reading's
  // baseline. Referenced, unlike the host clock's timers, so a one-shot
  // command waits out the interval instead of exiting with the loop drained.
  const settleForCpu = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, RESOURCE_SAMPLE_MS)
    })
  }
  const build = options.launches
  const host: RuntimeResourceProcess = {
    ...(build !== undefined && {
      launches() {
        ensureOpen()
        launch ??= build({
          governor,
          events,
          settings: () => settings,
          workChanged: () => {
            queue.wake()
          },
        })
        return launch
      },
    }),
    launchRows: () => launch?.workRows() ?? [],
    async command(action, json) {
      if (action === 'history') {
        const history = await host.history()
        return json ? JSON.stringify(history) : resourceHistoryText(history)
      }
      const status = await (action === 'resume' ? host.resume() : host.status())
      // A fresh sampler's first CPU read has no baseline: take the second
      // reading one sample interval later, so the answer shows CPU use
      // instead of Unknown. A warm sampler never waits (RLWINFIX). Only the
      // asked-for status waits: admission stays on the unwaited status, so
      // work is never held for a reading.
      if (action === 'status' && status.sample?.cpuPercent === null) {
        await settleForCpu()
        const settled = await host.status()
        return json ? JSON.stringify(settled) : resourceStatusText(settled)
      }
      return json ? JSON.stringify(status) : resourceStatusText(status)
    },
    async status(signal) {
      ensureOpen()
      await sync()
      signal?.throwIfAborted()
      await governor.refresh(signal)
      ensureOpen()
      return snapshot()
    },
    async history() {
      ensureOpen()
      const historyPort = options.history
      if (historyPort === undefined) throw new Error(UI_TEXT.resourceUnavailable)
      // A rejected read reaches `respond` as the named branded reading (R3),
      // never a plain error: every /resources command reports it typed.
      const history = await readResource('resources.history', () => historyPort.read())
      ensureOpen()
      // A strict copy: private fields or out-of-range dates never reach a surface.
      return resourceHistorySchema.parse(history)
    },
    async resume() {
      ensureOpen()
      // A rejected persistence write reports as the named branded reading too.
      await readResource('resources.resume', () =>
        options.machine.writeResumeUntil(options.clock.now() + RESOURCE_OVERRIDE_MS),
      )
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
      // Its owned trees are stopped first; the shared governor goes last.
      launch?.dispose()
      unsubscribe()
      listeners.clear()
      work.clear()
      queue.dispose()
      governor.dispose()
    },
  }
  return host
}
