import { Usd, maxUsd, nonnegativeUsdSchema, type UsdAmount } from '../../shared/usd'
import { randomUUID } from 'node:crypto'
import { ScheduleGrantEditor } from '../../core/schedules/grantAudit'
import type { ScheduleAuthorityStore } from '../../core/schedules/grantAudit'
import { ScheduleEventPrivacy } from '../../core/schedules/events/privacy'
import { ScheduleEventRegistry } from '../../core/schedules/events/registry'
import { ScheduleManualSource } from '../../core/schedules/events/signals'
import { nextScheduleTime, previewScheduleTimes } from '../../core/schedules/time/scheduleTime'
import type { createScheduler } from '../../core/schedules/scheduler'
import { MILLISECONDS_PER_HOUR, UI_TEXT } from '../../shared/constants'
import {
  scheduleRequestSchema,
  type scheduleResponseSchema,
  scheduleV2Schema,
  scheduleViewV2Of,
  type ScheduleDraft,
  type ScheduleRequest,
  type ScheduleStoreV2,
  type ScheduleV2,
} from '../../shared/scheduleV2'
import type { ScheduleCallerContext } from './args'
import type { ScheduleControlPort } from './command'
import type { ScheduleBackgroundCoordinator } from './background'

type ScheduleResponse = ReturnType<typeof scheduleResponseSchema.parse>

function refused(reason: string): ScheduleResponse {
  return { kind: 'refused', reason }
}

/** Host-owned identity no draft may supply: ids, creators, depth and pause. */
interface AdmittedIdentity {
  readonly id: string
  readonly revision: number
  readonly workspaceKey: string
  readonly creator: ScheduleV2['creator']
  readonly depth: number
  readonly allowAgentReschedule: boolean
  readonly paused: boolean
}

function admittedDraft(
  draft: ScheduleDraft,
  identity: AdmittedIdentity,
  firstFire: number | undefined,
): ScheduleDraft & AdmittedIdentity & { readonly version: 2; readonly nextFireAtMs?: number } {
  return {
    ...draft,
    version: 2,
    ...identity,
    ...(firstFire !== undefined && { nextFireAtMs: firstFire }),
  }
}

export interface ScheduleControlDeps {
  readonly store: ScheduleStoreV2
  readonly authority: ScheduleAuthorityStore
  readonly scheduler: ReturnType<typeof createScheduler>
  readonly background: ScheduleBackgroundCoordinator
  readonly workspaceKey: string
  readonly workspaceRoot: string
  readonly now: () => number
  readonly workspaces: () => Promise<readonly string[]>
  readonly onCreate: (workspaceKey: string) => Promise<void>
  readonly scanDeferred: () => Promise<void>
}

/** The service behind ScheduleControlPort: store CRUD, scheduler dispatch, audits and previews. */
export function createScheduleControl(deps: ScheduleControlDeps): ScheduleControlPort {
  const editor = new ScheduleGrantEditor(deps.authority, deps.now)
  const registry = new ScheduleEventRegistry(
    deps.workspaceKey,
    [new ScheduleManualSource(deps.workspaceKey, deps.now)],
    new ScheduleEventPrivacy(
      [deps.workspaceRoot],
      {
        // No taint observer is wired here; admission still scrubs before use.
        // The block is returned only to keep the hook a non-empty function.
        mark: (block) => block,
      },
      UI_TEXT.scheduleV2.messages.eventUntrusted,
    ),
  )

  const firstFireAtMs = (
    schedule: Pick<ScheduleV2, 'trigger' | 'zone' | 'end'>,
  ): number | undefined => {
    if (schedule.trigger.kind === 'event' || schedule.trigger.kind === 'afterEvent')
      return undefined
    return nextScheduleTime(
      {
        trigger: schedule.trigger,
        zone: schedule.zone,
        ...(schedule.end !== undefined && { end: schedule.end }),
        fireCount: 0,
      },
      deps.now(),
    )
  }

  const paidGate = (
    draft: { paidCapUsd: UsdAmount; grant: { paidCapUsd: UsdAmount } },
    caller?: ScheduleCallerContext,
  ): ScheduleResponse | undefined => {
    const cap = maxUsd(draft.paidCapUsd, draft.grant.paidCapUsd)
    if (cap === '0') return undefined
    return caller?.scheduledPrompts === true &&
      caller.maxBudgetUsd !== undefined &&
      nonnegativeUsdSchema.safeParse(caller.maxBudgetUsd).success &&
      Usd.from(caller.maxBudgetUsd).compare(Usd.from(cap)) >= 0
      ? undefined
      : refused(UI_TEXT.scheduleV2.runtime.paidAuthorizationRequired)
  }

  const admitTiming = (
    draft: ScheduleDraft,
    caller?: ScheduleCallerContext,
  ): ScheduleResponse | { now: number; firstFire: number | undefined } => {
    const gate = paidGate(draft, caller)
    if (gate !== undefined) return gate
    const now = deps.now()
    const firstFire = firstFireAtMs(draft)
    return firstFire === undefined &&
      draft.trigger.kind !== 'event' &&
      draft.trigger.kind !== 'afterEvent'
      ? refused(UI_TEXT.scheduleV2.runtime.invalidRequest)
      : { now, firstFire }
  }

  const create = async (
    workspaceKey: string,
    draft: ScheduleRequest & { method: 'schedules/create' },
    caller?: ScheduleCallerContext,
  ): Promise<ScheduleResponse> => {
    const admitted = admitTiming(draft.draft, caller)
    if ('kind' in admitted) return admitted
    const { now, firstFire } = admitted
    const schedule = scheduleV2Schema.parse({
      ...admittedDraft(
        draft.draft,
        {
          id: randomUUID(),
          revision: 0,
          workspaceKey,
          creator: { kind: 'user' },
          depth: 0,
          allowAgentReschedule: false,
          paused: false,
        },
        firstFire,
      ),
      createdAtMs: now,
      updatedAtMs: now,
      fireCount: 0,
      consecutiveFailures: 0,
    })
    const isCreated = await editor.create(schedule)
    if (!isCreated) return refused(UI_TEXT.scheduleV2.runtime.invalidRequest)
    await deps.onCreate(workspaceKey)
    return { kind: 'accepted', id: schedule.id }
  }

  const update = async (
    workspaceKey: string,
    id: string,
    revision: number,
    draft: ScheduleRequest & { method: 'schedules/update' },
    caller?: ScheduleCallerContext,
  ): Promise<ScheduleResponse> => {
    const gate = paidGate(draft.draft, caller)
    if (gate !== undefined) return gate
    const current = await deps.authority.read(workspaceKey, id)
    if (current?.revision !== revision) return refused(UI_TEXT.scheduleV2.runtime.invalidRequest)
    const admitted = admitTiming(draft.draft, caller)
    if ('kind' in admitted) return admitted
    const { now, firstFire } = admitted
    const next = scheduleV2Schema.parse({
      ...admittedDraft(
        draft.draft,
        {
          id: current.id,
          revision: current.revision,
          workspaceKey: current.workspaceKey,
          creator: current.creator,
          depth: current.depth,
          allowAgentReschedule: current.allowAgentReschedule,
          paused: current.paused,
        },
        firstFire,
      ),
      ...(current.pauseReason !== undefined && { pauseReason: current.pauseReason }),
      ...(current.migration !== undefined && { migration: current.migration }),
      createdAtMs: current.createdAtMs,
      updatedAtMs: now,
      fireCount: current.fireCount,
      consecutiveFailures: current.consecutiveFailures,
      ...(current.lastFireAtMs !== undefined && { lastFireAtMs: current.lastFireAtMs }),
      paidConsent: undefined,
    })
    const isOk = await deps.store.update(next)
    if (!isOk) return refused(UI_TEXT.scheduleV2.runtime.invalidRequest)
    await deps.authority.append({ scheduleId: id, atMs: now, kind: 'changed' })
    return { kind: 'accepted', id }
  }

  const setPaused = async (
    workspaceKey: string,
    id: string,
    isPaused: boolean,
  ): Promise<ScheduleResponse> => {
    const current = await deps.authority.read(workspaceKey, id)
    if (current === undefined) return refused(UI_TEXT.scheduleV2.runtime.invalidRequest)
    const isOk = await deps.store.update(
      scheduleV2Schema.parse({ ...current, paused: isPaused, updatedAtMs: deps.now() }),
    )
    return isOk ? { kind: 'accepted', id } : refused(UI_TEXT.scheduleV2.runtime.invalidRequest)
  }

  const timeline = async (workspaceKey: string, hours: number): Promise<ScheduleResponse> => {
    const now = deps.now()
    const through = now + hours * MILLISECONDS_PER_HOUR
    const jobs = await deps.store.list(workspaceKey)
    const byInstant = new Map<
      number,
      { scheduleId: string; target: ScheduleV2['target']; creator: ScheduleV2['creator'] }[]
    >()
    const collect = (job: (typeof jobs)[number], instants: readonly number[]): void => {
      for (const atMs of instants) {
        if (atMs > through) return
        const group = byInstant.get(atMs) ?? []
        group.push({ scheduleId: job.id, target: job.target, creator: job.creator })
        byInstant.set(atMs, group)
      }
    }
    for (const job of jobs) {
      if (job.paused) continue
      const instants = previewScheduleTimes(
        {
          trigger: job.trigger,
          zone: job.zone,
          ...(job.end !== undefined && { end: job.end }),
          fireCount: job.fireCount,
        },
        now,
      )
      collect(job, instants)
    }
    const entries = [...byInstant]
      .toSorted(([a], [b]) => a - b)
      .flatMap(([atMs, group]) => {
        const [first, ...rest] = group
        if (first === undefined) return []
        return [
          {
            scheduleId: first.scheduleId,
            atMs,
            target: first.target,
            collisionIds: rest.map((entry) => entry.scheduleId),
            creator: first.creator,
          },
        ]
      })
    return { kind: 'timeline', entries }
  }

  return {
    async request(input: unknown, caller?: ScheduleCallerContext): Promise<unknown> {
      const request = scheduleRequestSchema.parse(input)
      switch (request.method) {
        case 'schedules/list': {
          const schedules = await deps.store.list(request.workspaceKey)
          return {
            kind: 'list',
            schedules: schedules.map((schedule) => scheduleViewV2Of(schedule)),
          }
        }
        case 'schedules/create': {
          return await create(request.workspaceKey, request, caller)
        }
        case 'schedules/update': {
          return await update(request.workspaceKey, request.id, request.revision, request, caller)
        }
        case 'schedules/remove': {
          const isRemoved = await deps.store.remove(request.workspaceKey, request.id)
          return isRemoved
            ? { kind: 'accepted', id: request.id }
            : refused(UI_TEXT.scheduleV2.runtime.invalidRequest)
        }
        case 'schedules/pause': {
          return await setPaused(request.workspaceKey, request.id, true)
        }
        case 'schedules/resume': {
          return await setPaused(request.workspaceKey, request.id, false)
        }
        case 'schedules/revokeGrant': {
          const isRevoked = await editor.revoke(request.workspaceKey, request.id)
          return isRevoked
            ? { kind: 'accepted', id: request.id }
            : refused(UI_TEXT.scheduleV2.runtime.invalidRequest)
        }
        case 'schedules/runNow':
        case 'schedules/fire': {
          return await deps.scheduler.request(request, randomUUID())
        }
        case 'schedules/timeline': {
          return await timeline(request.workspaceKey, request.hours)
        }
        case 'schedules/grantAudit': {
          const entries = await editor.audit(request.workspaceKey, request.id)
          return { kind: 'grantAudit', scheduleId: request.id, entries: [...entries] }
        }
        case 'schedules/eventSources': {
          return registry.list()
        }
        case 'schedules/historyPreview': {
          return await registry.preview(request)
        }
        case 'schedules/backgroundStatus': {
          return {
            kind: 'backgroundStatus',
            status: await deps.background.status(),
          }
        }
        case 'schedules/backgroundRemove': {
          await deps.background.remove()
          return { kind: 'accepted' }
        }
        case 'schedules/background': {
          await deps.background.decide(request.consent)
          return { kind: 'accepted' }
        }
        default: {
          throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
        }
      }
    },
    async runDue(): Promise<void> {
      await deps.scanDeferred()
      const workspaces = await deps.workspaces()
      for (const workspace of workspaces) {
        await deps.scheduler.poll(workspace)
        await deps.scheduler.recover(workspace)
      }
    },
    close(): Promise<void> {
      return Promise.resolve()
    },
  }
}
