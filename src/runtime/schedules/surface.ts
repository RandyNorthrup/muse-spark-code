import { Usd, maxUsd, nonnegativeUsdSchema } from '../../shared/usd'
// One channel for the companion, native bridges, TUI, desktop and VS Code panel.
import {
  scheduleWebviewMessageSchema,
  scheduleResponseMessageSchema,
  type ScheduleHostResponseMessage,
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
import { scheduleStoredUnreadableReason } from './consent'
import {
  checkMuseCodeBinding,
  isMuseCodeOnceTarget,
  type MuseCodeBindingCheckDeps,
  type MuseCodeBindingPorts,
} from '../../host/schedules/museCodeBinding'

export interface ScheduleSurfaceDeps {
  readonly request: (request: ScheduleRequest, caller?: ScheduleCallerContext) => Promise<unknown>
  /** The editor supplies its actual paid gate/budget and session context. */
  readonly caller?: () => ScheduleCallerContext
  readonly background: ScheduleBackgroundCoordinator
  /** Only interactive creation invokes the first-schedule question. */
  readonly askBackground: () => Promise<unknown>
  readonly notice: (reason: string) => void
  /** The window's Muse Code timed-send binding (M88 lane C); absent stays unbound. */
  readonly museCode?: MuseCodeBindingPorts
  /** A binding sweep's failure lands here; the list still answers. */
  readonly reportError: (error: unknown) => void
}

/**
The binding sweep's store side over a control request path (M88 lane
C): list rows arrive parsed, a removal answers whether it landed.
*/
export function museCodeBindingChannel(
  request: (input: ScheduleRequest) => Promise<unknown>,
): Pick<MuseCodeBindingCheckDeps, 'list' | 'remove'> {
  return {
    list: async (workspaceKey: string) => {
      const parsed = scheduleResponseSchema.parse(
        await request({ method: 'schedules/list', workspaceKey }),
      )
      if (parsed.kind !== 'list') throw new Error(UI_TEXT.scheduleV2.runtime.invalidResponse)
      return parsed.schedules
    },
    remove: async (workspaceKey: string, id: string) => {
      const parsed = scheduleResponseSchema.parse(
        await request({ method: 'schedules/remove', workspaceKey, id }),
      )
      return parsed.kind === 'accepted'
    },
  }
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
    case 'schedules/backgroundStatus':
    case 'schedules/backgroundMaintain': {
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
      (r.draft.paidCapUsd !== '0' || r.draft.grant.paidCapUsd !== '0') &&
      (caller?.scheduledPrompts !== true ||
        caller.maxBudgetUsd === undefined ||
        !nonnegativeUsdSchema.safeParse(caller.maxBudgetUsd).success ||
        Usd.from(caller.maxBudgetUsd).compare(
          Usd.from(maxUsd(r.draft.paidCapUsd, r.draft.grant.paidCapUsd)),
        ) < 0)
    )
      return { kind: 'refused', reason: UI_TEXT.scheduleV2.runtime.paidAuthorizationRequired }
    // While the window's environment carries META_API_KEY, Muse Code
    // offers no timed send (M88 lane C): the draft would bill that key.
    if (
      r.method === 'schedules/create' &&
      this.deps.museCode?.hasEnvironmentKey() === true &&
      isMuseCodeOnceTarget(r.draft.target, r.draft.trigger)
    )
      return { kind: 'refused', reason: UI_TEXT.museCodeOnceEnvKeyRefused }
    // Before the surface lists, a seen sign-out or sign-in clears the
    // workspace's Muse Code once-schedules (M88 lane C). The list still
    // answers when the sweep fails: admission guards every dispatch,
    // and the report keeps why the sweep did not run.
    if (r.method === 'schedules/list' && this.deps.museCode !== undefined) {
      const binding = this.deps.museCode
      try {
        await checkMuseCodeBinding({
          workspaceKey: r.workspaceKey,
          currentSignIn: binding.currentSignIn,
          seen: binding.seen,
          notice: binding.notice,
          nowMs: Date.now(),
          ...museCodeBindingChannel((input) => forward(input, caller)),
        })
      } catch (error: unknown) {
        this.deps.reportError(error)
      }
    }
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
        // An unreadable consent file names its errno's kind word, never the
        // generic unavailable (P3-4).
        reason:
          scheduleLauncherReason(error) ??
          scheduleStoredUnreadableReason(error) ??
          UI_TEXT.scheduleV2.runtime.unavailable,
      }
    }
  }
  /** Bridges translate their outer transport only; this versioned envelope stays intact. */
  async message(input: unknown, cwd: string): Promise<ScheduleHostResponseMessage> {
    const envelope = scheduleWebviewMessageSchema.safeParse(input)
    if (!envelope.success) throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
    const response = await this.request(envelope.data.request, workspaceKey(cwd))
    return scheduleResponseMessageSchema.parse({
      type: 'schedulesResponse',
      version: SCHEDULE_PROTOCOL_VERSION,
      requestId: envelope.data.requestId,
      response,
    })
  }
}
