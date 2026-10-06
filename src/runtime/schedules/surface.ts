// One channel for the companion, native bridges, TUI, desktop and VS Code panel.
import {
  scheduleWebviewMessageSchema,
  scheduleHostMessageSchema,
  type ScheduleHostMessage,
} from '../../shared/scheduleProtocol'
import {
  scheduleRequestSchema,
  scheduleResponseSchema,
  type ScheduleRequest,
} from '../../shared/scheduleV2'
import { SCHEDULE_PROTOCOL_VERSION, UI_TEXT } from '../../shared/constants'
import { workspaceKey } from '../dataFolder'
import type { ScheduleBackgroundCoordinator } from './background'
import type { ScheduleCallerContext } from './args'
import { scheduleLauncherReason } from './registration'

export interface ScheduleSurfaceDeps {
  readonly request: (request: ScheduleRequest, caller?: ScheduleCallerContext) => Promise<unknown>
  /** The editor supplies its actual paid gate/budget and session context. */
  readonly caller?: () => ScheduleCallerContext
  readonly background: ScheduleBackgroundCoordinator
  /** Only interactive creation invokes the first-schedule question. */
  readonly askBackground: () => Promise<unknown>
  readonly notice: (reason: string) => void
}

function isResponseFor(
  request: ScheduleRequest,
  response: ReturnType<typeof scheduleResponseSchema.parse>,
): boolean {
  if (response.kind === 'refused') return true
  switch (request.method) {
    case 'schedules/list': {
      return (
        response.kind === 'list' &&
        response.schedules.every((s) => s.workspaceKey === request.workspaceKey)
      )
    }
    case 'schedules/timeline': {
      return response.kind === 'timeline'
    }
    case 'schedules/grantAudit': {
      return (
        response.kind === 'grantAudit' &&
        response.scheduleId === request.id &&
        response.entries.every((entry) => entry.scheduleId === request.id)
      )
    }
    case 'schedules/eventSources': {
      return response.kind === 'eventSources'
    }
    case 'schedules/historyPreview': {
      return (
        response.kind === 'historyPreview' &&
        JSON.stringify(response.trigger) === JSON.stringify(request.trigger) &&
        JSON.stringify(response.range) === JSON.stringify(request.range)
      )
    }
    case 'schedules/backgroundStatus': {
      return response.kind === 'backgroundStatus'
    }
    default: {
      return (
        response.kind === 'accepted' &&
        (!('id' in request) || response.id === undefined || response.id === request.id)
      )
    }
  }
}

export class ScheduleSurface {
  constructor(private readonly deps: ScheduleSurfaceDeps) {}
  async request(
    input: unknown,
    key: string,
    forward = this.deps.request,
    caller = this.deps.caller?.(),
  ): Promise<ReturnType<typeof scheduleResponseSchema.parse>> {
    const request = scheduleRequestSchema.safeParse(input)
    if (!request.success || ('workspaceKey' in request.data && request.data.workspaceKey !== key))
      return { kind: 'refused', reason: UI_TEXT.scheduleV2.runtime.invalidRequest }
    const r = request.data
    if (
      (r.method === 'schedules/create' || r.method === 'schedules/update') &&
      (r.draft.paidCapUsd > 0 || r.draft.grant.paidCapUsd > 0) &&
      (caller?.scheduledPrompts !== true ||
        caller.maxBudgetUsd === undefined ||
        !Number.isFinite(caller.maxBudgetUsd) ||
        caller.maxBudgetUsd < Math.max(r.draft.paidCapUsd, r.draft.grant.paidCapUsd))
    )
      return { kind: 'refused', reason: UI_TEXT.scheduleV2.runtime.paidAuthorizationRequired }
    let raw: unknown
    try {
      switch (r.method) {
        case 'schedules/backgroundStatus': {
          raw = { kind: 'backgroundStatus', status: await this.deps.background.status() }
          break
        }
        case 'schedules/backgroundRemove': {
          await this.deps.background.remove()
          raw = { kind: 'accepted' }
          break
        }
        case 'schedules/background': {
          await this.deps.background.decide(r.consent)
          raw = { kind: 'accepted' }
          break
        }
        default: {
          raw = caller === undefined ? await forward(r) : await forward(r, caller)
          const result = scheduleResponseSchema.parse(raw)
          if (!isResponseFor(r, result))
            return { kind: 'refused', reason: UI_TEXT.scheduleV2.runtime.invalidResponse }
          if (result.kind === 'accepted') {
            try {
              if (r.method === 'schedules/create' && (caller === undefined || caller.isInteractive))
                await this.deps.background.firstSchedule(this.deps.askBackground)
              await this.deps.background.reconcile()
            } catch (error: unknown) {
              try {
                this.deps.notice(
                  scheduleLauncherReason(error) ?? UI_TEXT.scheduleV2.runtime.backgroundUnavailable,
                )
              } catch {
                // Creation already committed: notifier failure cannot invite a duplicate retry.
                return result
              }
            }
          }
        }
      }
      const result = scheduleResponseSchema.safeParse(raw)
      return result.success && isResponseFor(r, result.data)
        ? result.data
        : { kind: 'refused', reason: UI_TEXT.scheduleV2.runtime.invalidResponse }
    } catch (error: unknown) {
      return {
        kind: 'refused',
        reason: scheduleLauncherReason(error) ?? UI_TEXT.scheduleV2.runtime.unavailable,
      }
    }
  }
  /** Bridges translate their outer transport only; this versioned envelope stays intact. */
  async message(input: unknown, cwd: string): Promise<ScheduleHostMessage> {
    const envelope = scheduleWebviewMessageSchema.safeParse(input)
    if (!envelope.success) throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
    const response = await this.request(envelope.data.request, workspaceKey(cwd))
    return scheduleHostMessageSchema.parse({
      type: 'schedulesResponse',
      version: SCHEDULE_PROTOCOL_VERSION,
      requestId: envelope.data.requestId,
      response,
    })
  }
}
