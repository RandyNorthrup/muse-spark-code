import { Usd } from '../../shared/usd'
import { homedir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import * as z from 'zod/mini'
import { createScheduleStore, type ScheduleRunIntent } from '../../core/schedules/store'
import { createScheduler } from '../../core/schedules/scheduler'
import { ScheduleDelivery, type ScheduleDeliveryDeps } from '../../core/schedules/delivery'
import { ScheduleReportActionRunner } from '../../core/schedules/reportAction'
import { createScheduleReportPort } from '../../core/schedules/reportAdapter'
import { createReportOccurrencePort } from '../../core/schedules/reportOccurrences'
import type { ScheduleAuthorityStore } from '../../core/schedules/grantAudit'
import { ScheduleEventEngine } from '../../core/schedules/events/engine'
import { createEventClaimStore } from '../../core/schedules/events/claimStore'
import { ScheduleEventIntake } from '../../core/schedules/events/intake'
import { hostEventHub } from '../../core/schedules/events/hostHub'
import { ScheduleEventPrivacy } from '../../core/schedules/events/privacy'
import { localGitRefs, ScheduleGitSource } from '../../core/schedules/events/git'
import { ScheduleFilesSource } from '../../core/schedules/events/files'
import { ScheduleManualSource } from '../../core/schedules/events/signals'
import { scheduleDependencySources } from '../../core/schedules/events/dependencies'
import type { ScheduleEventSource } from '../../shared/scheduleEvents'
import { createNodeFileWatcher } from './fileWatcher'
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
  SCHEDULE_RULE_MAX_CHARS,
  UI_TEXT,
} from '../../shared/constants'
import { failureForLog } from '../../core/backends/musecode/logText'
import type { CoreLogger } from '../../core/logging'
import { fill } from '../../shared/l10n/text'
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
import { migrateSchedules, type ScheduleMigrationSource } from '../../core/schedules/migrate'
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
  /**
  A host installs complete unattended delivery; absent hosts stay refused.
  A host whose delivery loads on its first use returns its promise.
  */
  readonly delivery?: (
    authority: ScheduleAuthorityStore,
  ) =>
    | Pick<ScheduleDeliveryDeps, 'targets' | 'runs' | 'prompt'>
    | Promise<Pick<ScheduleDeliveryDeps, 'targets' | 'runs' | 'prompt'>>
  readonly fs: ScheduleFsPort
  /**
  D121: the person's pause-after-failures count (0 never pauses), read
  live on every settlement when it is a function. Absent never pauses.
  */
  readonly pauseAfterFailures?: number | (() => number)
  readonly queue: ScheduleQueuePort
  /** M52's v1 jobs migrate into v2 once per workspace, verified then removed. */
  readonly migration?: {
    readonly source: ScheduleMigrationSource
    readonly zone: string
  }
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
  /** Hosts whose workspace trust can refuse git observation (VS Code).
  Absent trusts the process's own machine (the CLI, ACP). */
  readonly isWorkspaceTrusted?: (root: string) => boolean
  /** The installed locale for report documents. Absent reads English. */
  readonly locale?: string
  /** Failures the person gets as fixed sentences keep their kind here. */
  readonly log: CoreLogger
}

/** The conservative failed accounting for a delivery round that produced no
settlement: a failed outcome with unknown cost and retained liability,
naming the delivery failure kind so the history shows why the fire
failed instead of a reason-less failure. */
export function scheduleFailedSettlement(
  intent: ScheduleRunIntent,
  error: unknown,
  observedAtMs: number,
): ScheduleDeliveryResult {
  return scheduleFireRecordSchema.parse({
    runId: intent.runId,
    scheduleId: intent.schedule.id,
    workspaceKey: intent.schedule.workspaceKey,
    occurrenceMs: intent.occurrenceMs,
    observedAtMs,
    target: intent.schedule.target,
    delivery: intent.schedule.delivery,
    outcome: 'failed',
    reason: fill(UI_TEXT.scheduleV2.messages.deliveryFailed, {
      reason: failureForLog(error),
    }).slice(0, SCHEDULE_RULE_MAX_CHARS),
    refusedActions: [],
    cost: {
      usd: Usd.from(0).toAmount(),
      certainty: 'unknown',
      retainedLiabilityUsd: Usd.from(0).toAmount(),
    },
    ...(intent.event !== undefined && { event: intent.event }),
  })
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
export async function createScheduleEngine(options: ScheduleEngineOptions) {
  const closeSignal = new AbortController()
  const now = options.now ?? Date.now
  // The person's stop for engine waits: close or the delivery stop. The
  // store itself binds only the delivery stop, so close-time settlement
  // still runs; calls that must end at close name this combined stop.
  const combined = AbortSignal.any([closeSignal.signal, options.signal ?? closeSignal.signal])
  const store = createScheduleStore(options.fs, {
    ...(options.pauseAfterFailures !== undefined && {
      pauseAfterFailures: options.pauseAfterFailures,
    }),
    ...(options.signal !== undefined && { signal: options.signal }),
  })
  const authority = createAuthorityStore(store, options.fs, 'runtime/grant-audits.json', {
    signal: combined,
  })
  const registry = createWorkspaceRegistry(options.fs, 'runtime/workspaces.json', {
    signal: combined,
  })
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
    signal: combined,
    lookupRun: (workspace, runId) => store.lookupRun(workspace, runId),
    monotonicNow: () => performance.now(),
    deliver: async (
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
        return scheduleFireRecordSchema.parse({
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
        })
      const delivery = late.delivery
      if (delivery === undefined) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
      const result = await delivery.deliver(schedule, context, occurrenceMs, event)
      // A turn that ran (or failed trying) is observable as an event, so one
      // schedule can follow another. Refused, missed and skipped fires ran no
      // turn and publish nothing. A publish failure never fails the delivery.
      if (result.outcome === 'ran' || result.outcome === 'failed') {
        const occurrence = scheduleEventSchema.parse({
          source: 'agents',
          eventKey: `turn:${result.runId}`,
          kind: 'turnFinished',
          fields: { scheduleId: schedule.id, status: result.outcome },
          observedAt: now(),
        })
        try {
          await intakes.get(schedule.workspaceKey)?.offerPublished(occurrence)
        } catch (error: unknown) {
          report(error)
        }
        try {
          hostEventHub(schedule.workspaceKey, 'agents', ['turnFinished']).publish(occurrence)
        } catch (error: unknown) {
          report(error)
        }
      }
      return result
    },
  })
  // RA's report lane: the delivery runner with M115's authority and
  // occurrences. M113's backend binds with its lane; until then every
  // report fire refuses with the pending sentence.
  const reportRunner = new ScheduleReportActionRunner({
    store,
    log: options.log,
    reports: createScheduleReportPort({
      store,
      authorityStore: authority,
      occurrences: createReportOccurrencePort(options.fs),
      locale: options.locale ?? 'en',
      roots: (workspace) => registry.root(workspace),
    }),
    audit: (entry) => authority.append(entry),
    now,
  })
  const delivery = new ScheduleDelivery({
    now,
    monotonicNow: () => performance.now(),
    holds: (workspace: string) => host.holds(workspace),
    reports: {
      deliver: (schedule, context, occurrenceMs, event) =>
        reportRunner.run(schedule, context, occurrenceMs, event),
    },
    ...((await options.delivery?.(authority)) ??
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
  // Every poll failure lands here: the bounded host record when the embedder
  // keeps its own, the embedder's handler otherwise.
  const report =
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
    store: {
      ...store,
      record: (fire, callOptions) => store.record(terminalReason(fire), callOptions),
    },
    runs: {
      ...store,
      advance: (intent, callOptions) => store.advance(intent, callOptions),
      startDispatch: (intent, liabilityUsd, callOptions) =>
        store.startDispatch(intent, liabilityUsd, callOptions),
      lookupRun: (workspace, runId, callOptions) => store.lookupRun(workspace, runId, callOptions),
      acknowledge: (fire, callOptions) => store.acknowledge(terminalReason(fire), callOptions),
    },
    queue: options.queue,
    host,
    time: { plan: (schedule, clock) => scheduleTimePlan(schedule, clock) },
    failureSettlement: (intent: ScheduleRunIntent, error: unknown) =>
      Promise.resolve(scheduleFailedSettlement(intent, error, now())),
    deferEvent: (schedule: ScheduleV2, event: ScheduleEvent) => deferComposedEvent(schedule, event),
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
          const fires = await store.fires(request.workspaceKey, { signal: combined })
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
  const consent = createBackgroundConsentStore(options.fs, 'runtime/background-consent.json', {
    signal: combined,
  })
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
      const workspaces = await registry.list({ signal: combined })
      for (const workspace of workspaces) {
        const jobs = await store.list(workspace, { signal: combined })
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
    const raw = await options.fs.read('runtime/deferred-events.json', { signal: combined })
    if (raw === undefined) return []
    try {
      return deferredFileSchema.parse(JSON.parse(raw))
    } catch {
      throw new Error('scheduleStoredJsonInvalid')
    }
  }
  // E persists a composed event until its time is due; the intake and the
  // scheduler share this one deferral.
  const deferComposedEvent = async (schedule: ScheduleV2, event: ScheduleEvent): Promise<void> => {
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
      undefined,
      { signal: combined },
    )
  }
  // C-M115-4's production event set per workspace: local git, files, the
  // agents hub this engine publishes to, and manual. Milestone sources
  // arrive with their ports; until then each names its owner as the reason.
  const intakes = new Map<string, ScheduleEventIntake>()
  const isWorkspaceTrusted = options.isWorkspaceTrusted ?? (() => true)
  const intakeFor = (cwd: string): ScheduleEventIntake => {
    const root = path.resolve(cwd)
    const key = workspaceKey(root)
    const existing = intakes.get(key)
    if (existing !== undefined) return existing
    const rejected = (id: string): void => {
      report(new Error(`scheduleEventRejected:${id}`))
    }
    const sources: ScheduleEventSource[] = [
      new ScheduleManualSource(key, now),
      new ScheduleGitSource(
        localGitRefs(root, () => isWorkspaceTrusted(root)),
        now,
      ),
      new ScheduleFilesSource(['**'], createNodeFileWatcher({ root, now, report }), rejected),
      hostEventHub(key, 'agents', ['turnFinished']),
      ...scheduleDependencySources({}, now, rejected),
    ]
    const intake = new ScheduleEventIntake({
      store,
      workspaceKey: key,
      sources,
      engine: new ScheduleEventEngine(
        now,
        createEventClaimStore(options.fs, key),
        new ScheduleEventPrivacy(
          [root],
          {
            // No taint observer is wired here; admission still scrubs before use.
            mark: (block) => block,
          },
          UI_TEXT.scheduleV2.messages.eventUntrusted,
        ),
      ),
      fire: async (schedule, event, occurrenceMs) => {
        if (schedule.trigger.kind === 'afterEvent') await deferComposedEvent(schedule, event)
        else await scheduler.fireEvent(schedule.workspaceKey, schedule.id, event, occurrenceMs)
      },
      now,
      report,
    })
    intakes.set(key, intake)
    return intake
  }
  const pollIntake = async (workspace: string): Promise<void> => {
    const held = intakes.get(workspace)
    if (held !== undefined) {
      await held.poll()
      return
    }
    const root = await registry.root(workspace)
    if (root === undefined) return
    await intakeFor(root).poll()
  }
  const scanDeferred = async (): Promise<void> => {
    let pending: z.infer<typeof deferredFileSchema>
    try {
      pending = await readDeferred()
    } catch (error: unknown) {
      // The stop ends the scan quietly: close already owns the outcome.
      if (combined.aborted) return
      report(error)
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
      await options.fs.replace(
        'runtime/deferred-events.json',
        JSON.stringify(remaining),
        undefined,
        {
          signal: combined,
        },
      )
  }
  const controlFor = async (cwd: string): Promise<ScheduleControlPort> => {
    const key = workspaceKey(path.resolve(cwd))
    const existing = controls.get(key)
    if (existing !== undefined) return existing
    // A failed migration leaves nothing cached, so the next control request
    // retries it; receipts keep every retry idempotent. The v1 jobs stay
    // until one retry verifies and removes each of them.
    if (options.migration !== undefined)
      await migrateSchedules(options.migration.source, store, key, options.migration.zone, {
        signal: combined,
      })
    let consent: ScheduleControlDeps['consent'] = options.consent
    if (
      consent === undefined &&
      runtimeDelivery !== undefined &&
      options.runtimeDelivery?.billing !== undefined
    )
      consent = (schedule, caller) => runtimeDelivery.consent(schedule, path.resolve(cwd), caller)
    const intake = intakeFor(cwd)
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
      eventSources: intake.sources(),
      pollEvents: (workspace) => pollIntake(workspace),
      discardEvents: (scheduleId) => intake.discard(scheduleId),
    })
    controls.set(key, control)
    return control
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
        await pollIntake(workspace)
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
    void work.finally(() => activeTicks.delete(work)).catch(report)
  }
  let engineTimer: ReturnType<typeof setInterval> | undefined
  const watchWorkspace = async (cwd: string): Promise<() => Promise<void>> => {
    const key = workspaceKey(path.resolve(cwd))
    await registry.add(key, path.resolve(cwd))
    watched.set(key, (watched.get(key) ?? 0) + 1)
    // The tick below polls this workspace's intake; subscribed sources
    // stay subscribed while the workspace is watched.
    intakeFor(cwd)
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
              report(error)
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
    log: options.log,
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
      for (const intake of intakes.values()) intake.close()
      // A throw from one stage never skips the rest of close: every dispatch
      // and tick is still joined before the first error is rethrown. The
      // settled reasons below keep their identity, as in the drain loop.
      const stages = await Promise.allSettled([runtimeDelivery?.close(), coreScheduler.close()])
      await Promise.allSettled(activeDispatches)
      await Promise.allSettled(activeTicks)
      controls.clear()
      intakes.clear()
      for (const stage of stages) if (stage.status === 'rejected') throw stage.reason
    },
    verifyWake: options.verifyWake ?? (() => Promise.resolve({ scheduledPrompts: false })),
    ...(options.platform !== undefined && { platform: options.platform }),
  })
  return { runtime, scheduler, store, errors, registry, scanDeferred, delivery, pollWorkspace }
}
