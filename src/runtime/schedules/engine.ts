import { homedir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import * as z from 'zod/mini'
import { createScheduleStore, type ScheduleRunIntent } from '../../core/schedules/store'
import { createScheduler } from '../../core/schedules/scheduler'
import { ScheduleDelivery } from '../../core/schedules/delivery'
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
import { scheduleEventSchema, type ScheduleEvent } from '../../shared/scheduleEvents'
import {
  scheduleFireRecordSchema,
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
import { createScheduleControl } from './control'
import { createWorkspaceRegistry } from './registry'
import { scheduleTimePlan } from './timePlan'
import type { ScheduleControlPort } from './command'

export interface ScheduleEngineOptions {
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
  const now = options.now ?? Date.now
  const store = createScheduleStore(options.fs)
  const late: { delivery?: ScheduleDelivery } = {}
  const host: RuntimeScheduleHost = new RuntimeScheduleHost({
    now,
    monotonicNow: () => performance.now(),
    deliver: (
      schedule: ScheduleV2,
      context: ScheduleRunContext,
      occurrenceMs: number,
      event?: ScheduleEvent,
    ): Promise<ScheduleDeliveryResult> => {
      const delivery = late.delivery
      if (delivery === undefined) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
      return delivery.deliver(schedule, context, occurrenceMs, event)
    },
  })
  const delivery = new ScheduleDelivery({
    now,
    monotonicNow: () => performance.now(),
    holds: (workspace: string) => host.holds(workspace),
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
  })
  late.delivery = delivery
  const errors: unknown[] = []
  const onError =
    options.onError ??
    ((error: unknown) => {
      if (errors.length < SCHEDULE_ENGINE_ERROR_MAX) errors.push(error)
    })
  const scheduler = createScheduler({
    store,
    runs: store,
    queue: options.queue,
    host,
    time: { plan: (schedule, clock) => scheduleTimePlan(schedule, clock) },
    failureSettlement: (intent: ScheduleRunIntent) =>
      Promise.resolve(
        scheduleFireRecordSchema.parse({
          runId: intent.runId,
          scheduleId: intent.schedule.id,
          workspaceKey: intent.schedule.workspaceKey,
          occurrenceMs: intent.occurrenceMs,
          observedAtMs: now(),
          target: intent.schedule.target,
          delivery: intent.schedule.delivery,
          outcome: 'failed',
          refusedActions: [],
          cost: { usd: 0, certainty: 'unknown', retainedLiabilityUsd: 0 },
          ...(intent.event !== undefined && { event: intent.event }),
        }),
      ),
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
  const authority = createAuthorityStore(store, options.fs, 'runtime/grant-audits.json')
  const consent = createBackgroundConsentStore(options.fs, 'runtime/background-consent.json')
  const registry = createWorkspaceRegistry(options.fs, 'runtime/workspaces.json')
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
    const control = createScheduleControl({
      store,
      authority,
      scheduler,
      background,
      workspaceKey: key,
      workspaceRoot: path.resolve(cwd),
      now,
      workspaces: () => registry.list(),
      onCreate: (createdKey: string) => registry.add(createdKey),
      scanDeferred,
    })
    controls.set(key, control)
    return Promise.resolve(control)
  }
  const surface = new ScheduleSurface({
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
  const watched = new Set<string>()
  let engineTimer: ReturnType<typeof setInterval> | undefined
  const watchWorkspace = (cwd: string): Promise<() => Promise<void>> => {
    const key = workspaceKey(path.resolve(cwd))
    watched.add(key)
    if (engineTimer === undefined) {
      const tick = () => {
        for (const workspace of watched) {
          if (!host.holds(workspace)) continue
          void scheduler
            .recover(workspace)
            .catch((error: unknown) => {
              onError(error)
            })
            .then(async () => {
              await scheduler.poll(workspace)
            })
            .catch((error: unknown) => {
              onError(error)
            })
        }
        void scanDeferred().catch((error: unknown) => {
          onError(error)
        })
      }
      engineTimer = setInterval(tick, SCHEDULE_POLL_INTERVAL_MS)
      tick()
    }
    let isReleased = false
    const release = (): Promise<void> => {
      if (!isReleased) {
        isReleased = true
        watched.delete(key)
        if (engineTimer !== undefined && watched.size === 0) {
          clearInterval(engineTimer)
          engineTimer = undefined
        }
      }
      return Promise.resolve()
    }
    return Promise.resolve(release)
  }
  const runtime = new ScheduleRuntime({
    controlFor: (cwd, _caller) => controlFor(cwd),
    host,
    surface,
    background,
    watchWorkspace,
    dueWorkspaces: () => registry.list(),
    close: () => {
      controls.clear()
      return Promise.resolve()
    },
    verifyWake: options.verifyWake ?? (() => Promise.resolve({ scheduledPrompts: false })),
    ...(options.platform !== undefined && { platform: options.platform }),
  })
  return { runtime, scheduler, store, errors, registry, scanDeferred }
}
