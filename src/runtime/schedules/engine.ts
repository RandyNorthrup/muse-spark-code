import { homedir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import * as z from 'zod/mini'
import { createScheduleStore, type ScheduleRunIntent } from '../../core/schedules/store'
import { createScheduler } from '../../core/schedules/scheduler'
import { ScheduleDelivery, type ScheduleDeliveryDeps } from '../../core/schedules/delivery'
import type { ScheduleAuthorityStore } from '../../core/schedules/grantAudit'
import { RuntimeScheduleHost } from './host'
import { ScheduleRuntime } from './runtime'
import { ScheduleSurface } from './surface'
import { ScheduleBackgroundCoordinator } from './background'
import { NativeScheduleBackground } from './nativeBackground'
import { nodeBackgroundFiles, backgroundProcessRunner } from './nodeBackgroundIo'
import type { ScheduleFsPort } from '../../core/schedules/journal'
import type { ScheduleQueuePort } from '../../core/schedules/store'
import {
  SCHEDULE_ENGINE_ERROR_MAX,
  SCHEDULE_POLL_INTERVAL_MS,
  UI_TEXT,
} from '../../shared/constants'
import {
  scheduleEventRunId,
  scheduleEventSchema,
  type ScheduleEvent,
} from '../../shared/scheduleEvents'
import {
  scheduleFireRecordSchema,
  scheduleRequestSchema,
  noScheduleCost,
  type ScheduleBackgroundPort,
  type ScheduleDeliveryResult,
  type ScheduleRunContext,
  type ScheduleV2,
} from '../../shared/scheduleV2'
import type { ScheduleWakeAuthorization } from './registration'
import { nextScheduleTime } from '../../core/schedules/time/scheduleTime'
import { agentDataFolder, workspaceKey } from '../dataFolder'
import { createAuthorityStore } from './authorityStore'
import { createBackgroundConsentStore } from './consent'
import { createScheduleControl, type ScheduleControlDeps } from './control'
import { createWorkspaceRegistry } from './registry'
import { scheduleTimePlan } from './timePlan'
import type { ScheduleControlPort } from './command'
import type { ScheduleCallerContext } from './args'
import type { createRuntimeScheduleDelivery, RuntimeScheduleDeliveryPorts } from './delivery'

export interface ScheduleEngineOptions {
  readonly signal?: AbortSignal
  readonly caller?: () => ScheduleCallerContext
  readonly consent?: (schedule: ScheduleV2) => Promise<ScheduleV2['paidConsent']>
  readonly runtimeDelivery?: RuntimeScheduleDeliveryPorts
  readonly runtimeDeliveryFactory?: typeof createRuntimeScheduleDelivery
  /** A host installs complete unattended delivery; absent hosts stay refused. */
  readonly delivery?: (
    authority: ScheduleAuthorityStore,
  ) => Pick<ScheduleDeliveryDeps, 'targets' | 'runs' | 'prompt'>
  readonly fs: ScheduleFsPort
  readonly queue: ScheduleQueuePort
  readonly now?: () => number
  readonly verifyWake?: (registrationId?: string) => Promise<ScheduleWakeAuthorization>
  readonly onError?: (error: unknown) => void
  readonly platform?: NodeJS.Platform
  readonly homeDir?: string
  readonly dataDir?: string
  readonly executable?: string
  readonly agentFile?: string
  readonly uid?: number
  /** Tests substitute the native OS entry; production always uses the real one. */
  readonly backgroundEntry?: ScheduleBackgroundPort
}

const deferredEventSchema = z.strictObject({
  workspaceKey: z.string(),
  scheduleId: z.string(),
  event: scheduleEventSchema,
  dueMs: z.int(),
})
const deferredFileSchema = z.array(deferredEventSchema)

function unavailableTarget(): Promise<never> {
  throw new Error(UI_TEXT.scheduleV2.messages.targetUnavailable)
}

/** Production composition of S admission/claims/polling with D/U delivery ledgers. */
export function createScheduleEngine(options: ScheduleEngineOptions) {
  const closeSignal = new AbortController()
  const now = options.now ?? Date.now
  const store = createScheduleStore(options.fs)
  const authority = createAuthorityStore(store, options.fs, 'runtime/grant-audits.json')
  const registry = createWorkspaceRegistry(options.fs, 'runtime/workspaces.json')
  const runtimeDelivery =
    options.runtimeDelivery !== undefined && options.runtimeDeliveryFactory !== undefined
      ? options.runtimeDeliveryFactory(options.runtimeDelivery, authority, registry)
      : undefined
  if (runtimeDelivery === undefined && options.runtimeDelivery !== undefined)
    throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
  const late: { delivery?: ScheduleDelivery } = {}
  const host: RuntimeScheduleHost = new RuntimeScheduleHost({
    isAvailable: () => options.delivery !== undefined || runtimeDelivery !== undefined,
    now,
    signal: AbortSignal.any([closeSignal.signal, options.signal ?? closeSignal.signal]),
    lookupRun: (workspace, runId) => store.lookupRun(workspace, runId),
    monotonicNow: () => performance.now(),
    deliver: (
      schedule: ScheduleV2,
      context: ScheduleRunContext,
      occurrenceMs: number,
      event?: ScheduleEvent,
    ): Promise<ScheduleDeliveryResult> => {
      if (
        options.runtimeDelivery !== undefined &&
        options.runtimeDelivery.paid === undefined &&
        options.runtimeDelivery.billing === undefined &&
        schedule.action.kind === 'prompt' &&
        'backend' in schedule.target &&
        schedule.target.backend === 'modelApi'
      )
        return Promise.resolve(
          scheduleFireRecordSchema.parse({
            runId: context.runId,
            scheduleId: schedule.id,
            workspaceKey: schedule.workspaceKey,
            occurrenceMs,
            observedAtMs: now(),
            target: schedule.target,
            delivery: schedule.delivery,
            outcome: 'refused',
            reason: UI_TEXT.schedulePaidOff,
            refusedActions: [],
            cost: noScheduleCost(),
            ...(event !== undefined && { event }),
          }),
        )
      const delivery = late.delivery
      if (delivery === undefined) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
      return delivery.deliver(schedule, context, occurrenceMs, event)
    },
  })
  const delivery = new ScheduleDelivery({
    now,
    monotonicNow: () => performance.now(),
    holds: (workspace: string) => host.holds(workspace),
    ...(options.delivery?.(authority) ??
      runtimeDelivery?.delivery ?? {
        targets: {
          find: () => Promise.resolve(undefined),
          open: unavailableTarget,
          fresh: unavailableTarget,
        },
        runs: { run: unavailableTarget },
        prompt: (schedule: ScheduleV2) => {
          if (schedule.action.kind !== 'prompt')
            throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
          return schedule.action.prompt
        },
      }),
  })
  late.delivery = delivery
  const errors: unknown[] = []
  const onError =
    options.onError ??
    ((error: unknown) => {
      if (errors.length < SCHEDULE_ENGINE_ERROR_MAX) errors.push(error)
    })
  // Runtime retirement always carries a reason, including S's unsent exits.
  const terminalReason = (fire: ScheduleDeliveryResult): ScheduleDeliveryResult =>
    fire.reason === undefined && (fire.outcome === 'skipped' || fire.outcome === 'missed')
      ? {
          ...fire,
          reason:
            fire.outcome === 'missed'
              ? UI_TEXT.scheduleV2.messages.catchUpSkipped
              : UI_TEXT.scheduleV2.messages.targetClosed,
        }
      : fire
  const coreScheduler = createScheduler({
    store: { ...store, record: (fire) => store.record(terminalReason(fire)) },
    runs: {
      ...store,
      advance: (intent) => store.advance(intent),
      startDispatch: (intent, liabilityUsd) => store.startDispatch(intent, liabilityUsd),
      lookupRun: (workspace, runId) => store.lookupRun(workspace, runId),
      acknowledge: (fire) => store.acknowledge(terminalReason(fire)),
    },
    queue: options.queue,
    host,
    time: { plan: (schedule, clock) => scheduleTimePlan(schedule, clock) },
    failureSettlement: (intent: ScheduleRunIntent) =>
      Promise.resolve({
        runId: intent.runId,
        scheduleId: intent.schedule.id,
        workspaceKey: intent.schedule.workspaceKey,
        occurrenceMs: intent.occurrenceMs,
        observedAtMs: now(),
        target: intent.schedule.target,
        delivery: intent.schedule.delivery,
        outcome: 'failed',
        reason: UI_TEXT.scheduleCommandFailed,
        refusedActions: [],
        cost: {
          ...noScheduleCost(),
          certainty: 'unknown',
          retainedLiabilityUsd: intent.schedule.grant.paidCapUsd,
        },
        ...(intent.event !== undefined && { event: intent.event }),
      }),
    deferEvent: async (schedule: ScheduleV2, event: ScheduleEvent) => {
      const dueMs = nextScheduleTime(
        {
          trigger: schedule.trigger,
          zone: schedule.zone,
          ...(schedule.end !== undefined && { end: schedule.end }),
          fireCount: schedule.fireCount,
        },
        event.observedAt,
        event.observedAt,
      )
      if (dueMs === undefined) throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
      if (dueMs <= now()) {
        await scheduler.fireEvent(schedule.workspaceKey, schedule.id, event, dueMs)
        return
      }
      const pending = await readDeferred()
      await options.fs.replace(
        'runtime/deferred-events.json',
        JSON.stringify([
          ...pending,
          { workspaceKey: schedule.workspaceKey, scheduleId: schedule.id, event, dueMs },
        ]),
      )
    },
  })
  const activeDispatches = new Set<Promise<unknown>>()
  const trackDispatch = async <T>(work: Promise<T>): Promise<T> => {
    activeDispatches.add(work)
    try {
      return await work
    } finally {
      activeDispatches.delete(work)
    }
  }
  const scheduler = {
    ...coreScheduler,
    request: (...args: Parameters<typeof coreScheduler.request>) =>
      trackDispatch(
        (async () => {
          const response = await coreScheduler.request(...args)
          const request = scheduleRequestSchema.parse(args[0])
          if (response.kind !== 'accepted' || request.method !== 'schedules/runNow') return response
          const runId = scheduleEventRunId(request.id, {
            source: 'manual',
            eventKey: args[1],
          })
          const fires = await store.fires(request.workspaceKey)
          const fire = fires.find((fire) => fire.runId === runId)
          return fire?.outcome === 'ran'
            ? response
            : {
                kind: 'refused' as const,
                reason: fire?.reason ?? UI_TEXT.scheduleV2.messages.targetClosed,
              }
        })(),
      ),
    poll: (...args: Parameters<typeof coreScheduler.poll>) =>
      trackDispatch(coreScheduler.poll(...args)),
    fireEvent: (...args: Parameters<typeof coreScheduler.fireEvent>) =>
      trackDispatch(coreScheduler.fireEvent(...args)),
    recover: (workspace: string) => trackDispatch(coreScheduler.recover(workspace)),
  }
  const consent = createBackgroundConsentStore(options.fs, 'runtime/background-consent.json')
  const platform = options.platform ?? process.platform
  const homeDir = options.homeDir ?? homedir()
  const dataDir = options.dataDir ?? agentDataFolder({ platform, env: process.env, homeDir })
  const backgroundEntry =
    options.backgroundEntry ??
    new NativeScheduleBackground({
      platform,
      homeDir,
      dataDir,
      executable: options.executable ?? process.execPath,
      agentFile: options.agentFile ?? process.execPath,
      uid: options.uid ?? process.getuid?.() ?? 0,
      now,
      isWakeProcess: false,
      authorization: () => Promise.resolve({ scheduledPrompts: false }),
      files: nodeBackgroundFiles(),
      run: backgroundProcessRunner(process.env),
    })
  const background = new ScheduleBackgroundCoordinator({
    entry: backgroundEntry,
    consent,
    now,
    nextWakeAtMs: async () => {
      let next: number | undefined
      const workspaces = await registry.list()
      for (const workspace of workspaces) {
        const jobs = await store.list(workspace)
        for (const job of jobs) {
          if (job.paused || job.nextFireAtMs === undefined) continue
          if (next === undefined || job.nextFireAtMs < next) next = job.nextFireAtMs
        }
      }
      return next
    },
  })
  const controls = new Map<string, ScheduleControlPort>()
  const readDeferred = async (): Promise<z.infer<typeof deferredFileSchema>> => {
    const raw = await options.fs.read('runtime/deferred-events.json')
    if (raw === undefined) return []
    try {
      return deferredFileSchema.parse(JSON.parse(raw))
    } catch {
      throw new Error('scheduleStoredJsonInvalid')
    }
  }
  const scanDeferred = async (): Promise<void> => {
    let pending: z.infer<typeof deferredFileSchema>
    try {
      pending = await readDeferred()
    } catch (error: unknown) {
      onError(error)
      return
    }
    const remaining: z.infer<typeof deferredFileSchema> = []
    let isChanged = false
    for (const deferred of pending) {
      if (deferred.dueMs > now()) {
        remaining.push(deferred)
        continue
      }
      isChanged = true
      try {
        await scheduler.fireEvent(
          deferred.workspaceKey,
          deferred.scheduleId,
          deferred.event,
          deferred.dueMs,
        )
      } catch {
        remaining.push(deferred)
      }
    }
    if (isChanged)
      await options.fs.replace('runtime/deferred-events.json', JSON.stringify(remaining))
  }
  const controlFor = (cwd: string): Promise<ScheduleControlPort> => {
    const key = workspaceKey(path.resolve(cwd))
    const existing = controls.get(key)
    if (existing !== undefined) return Promise.resolve(existing)
    let consent: ScheduleControlDeps['consent'] = options.consent
    if (
      consent === undefined &&
      runtimeDelivery !== undefined &&
      options.runtimeDelivery?.billing !== undefined
    )
      consent = (schedule, caller) => runtimeDelivery.consent(schedule, path.resolve(cwd), caller)
    const control = createScheduleControl({
      ...(consent !== undefined && { consent }),
      store,
      authority,
      scheduler,
      background,
      workspaceKey: key,
      workspaceRoot: path.resolve(cwd),
      now,
      workspaces: () => registry.list(),
      onCreate: (createdKey: string) => registry.add(createdKey, path.resolve(cwd)),
      scanDeferred,
    })
    controls.set(key, control)
    return Promise.resolve(control)
  }
  const surface = new ScheduleSurface({
    ...(options.caller !== undefined && { caller: options.caller }),
    request: (request, caller) => {
      if (!('workspaceKey' in request))
        return Promise.resolve({
          kind: 'refused' as const,
          reason: UI_TEXT.scheduleV2.runtime.hostUnavailable,
        })
      const control = controls.get(request.workspaceKey)
      if (control === undefined)
        return Promise.resolve({
          kind: 'refused' as const,
          reason: UI_TEXT.scheduleV2.runtime.hostUnavailable,
        })
      return control.request(request, caller)
    },
    background,
    askBackground: () => Promise.reject(new Error(UI_TEXT.scheduleV2.runtime.consentRequired)),
    notice: (reason: string) => {
      process.stderr.write(`${reason}\n`)
    },
  })
  const watched = new Map<string, number>()
  const polling = new Map<string, Promise<void>>()
  const pollWorkspace = (workspace: string): Promise<void> => {
    const existing = polling.get(workspace)
    if (existing !== undefined) return existing
    const work = (async () => {
      try {
        await scheduler.recover(workspace)
        await scheduler.poll(workspace)
      } finally {
        polling.delete(workspace)
      }
    })()
    polling.set(workspace, work)
    return work
  }
  const activeTicks = new Set<Promise<void>>()
  const track = (work: Promise<void>) => {
    activeTicks.add(work)
    void work.finally(() => activeTicks.delete(work)).catch(onError)
  }
  let engineTimer: ReturnType<typeof setInterval> | undefined
  const watchWorkspace = async (cwd: string): Promise<() => Promise<void>> => {
    const key = workspaceKey(path.resolve(cwd))
    await registry.add(key, path.resolve(cwd))
    watched.set(key, (watched.get(key) ?? 0) + 1)
    if (engineTimer === undefined) {
      const tick = () => {
        for (const workspace of watched.keys()) {
          if (!host.holds(workspace)) continue
          track(pollWorkspace(workspace))
        }
        track(
          (async () => {
            try {
              await scanDeferred()
            } catch (error: unknown) {
              onError(error)
            }
          })(),
        )
      }
      engineTimer = setInterval(tick, SCHEDULE_POLL_INTERVAL_MS)
      tick()
    }
    let isReleased = false
    const release = (): Promise<void> => {
      if (!isReleased) {
        isReleased = true
        const remaining = (watched.get(key) ?? 1) - 1
        if (remaining === 0) watched.delete(key)
        else watched.set(key, remaining)
        if (engineTimer !== undefined && watched.size === 0) {
          clearInterval(engineTimer)
          engineTimer = undefined
        }
      }
      return Promise.resolve()
    }
    return release
  }
  const runtime = new ScheduleRuntime({
    controlFor: (cwd, _caller) => controlFor(cwd),
    host,
    surface,
    background,
    watchWorkspace,
    ...(runtimeDelivery !== undefined && {
      attachSession: (cwd, session) => runtimeDelivery.attach(cwd, session),
    }),
    dueWorkspaces: () => registry.list(),
    close: async () => {
      closeSignal.abort()
      await runtimeDelivery?.close()
      await coreScheduler.close()
      await Promise.allSettled(activeDispatches)
      await Promise.allSettled(activeTicks)
      controls.clear()
    },
    verifyWake: options.verifyWake ?? (() => Promise.resolve({ scheduledPrompts: false })),
    ...(options.platform !== undefined && { platform: options.platform }),
  })
  return { runtime, scheduler, store, errors, registry, scanDeferred, delivery, pollWorkspace }
}
