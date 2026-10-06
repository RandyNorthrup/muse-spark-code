import {
  scheduleRequestSchema,
  scheduleResponseSchema,
  type ScheduleRequest,
} from '../../shared/scheduleV2'
import {
  SCHEDULE_CLEANUP_EXIT_CODE,
  SCHEDULE_TIMELINE_HOURS,
  UI_TEXT,
} from '../../shared/constants'
import { formatDateTime, formatNumber } from '../../shared/l10n/text'
import { workspaceKey } from '../dataFolder'
import type { ScheduleCommandOptions, ScheduleCallerContext } from './args'
import { scheduleLauncherReason } from './registration'

/** S supplies admission, claims and final settlement; X never dispatches a turn itself. */
export interface ScheduleControlPort {
  request(request: ScheduleRequest, caller?: ScheduleCallerContext): Promise<unknown>
  runDue(): Promise<void>
  close(): Promise<void>
}

export interface ScheduleCommandResult {
  readonly exitCode: number
  readonly output: string
  readonly warning?: string
}

/** Cleanup cannot erase a command's committed acknowledgement. */
export async function settleScheduleCommand(
  work: () => Promise<ScheduleCommandResult>,
  close: () => Promise<void>,
): Promise<ScheduleCommandResult> {
  let result: ScheduleCommandResult | undefined
  try {
    result = await work()
  } finally {
    try {
      await close()
    } catch (error: unknown) {
      if (result !== undefined) {
        const reason = scheduleLauncherReason(error)
        result = {
          ...result,
          exitCode: SCHEDULE_CLEANUP_EXIT_CODE,
          warning:
            reason === undefined
              ? UI_TEXT.scheduleV2.runtime.cleanupFailed
              : `${UI_TEXT.scheduleV2.runtime.cleanupFailed}: ${reason}`,
        }
      }
    }
  }
  return result
}

function requestOf(options: ScheduleCommandOptions, cwd: string): ScheduleRequest {
  const key = workspaceKey(cwd)
  switch (options.operation) {
    case 'add': {
      const draft: unknown = JSON.parse(options.draft ?? '')
      return scheduleRequestSchema.parse({ method: 'schedules/create', workspaceKey: key, draft })
    }
    case 'list': {
      return scheduleRequestSchema.parse({ method: 'schedules/list', workspaceKey: key })
    }
    case 'timeline': {
      return scheduleRequestSchema.parse({
        method: 'schedules/timeline',
        workspaceKey: key,
        hours: Number(options.hours ?? SCHEDULE_TIMELINE_HOURS[0]),
      })
    }
    case 'background-off': {
      return { method: 'schedules/backgroundRemove' }
    }
    case 'background-status': {
      return { method: 'schedules/backgroundStatus' }
    }
    case 'run-due': {
      throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
    }
    case 'background-maintain': {
      return { method: 'schedules/backgroundStatus' }
    }
    default: {
      const suffix = options.operation === 'run-now' ? 'runNow' : options.operation
      return scheduleRequestSchema.parse({
        method: `schedules/${suffix}`,
        workspaceKey: key,
        id: options.id,
      })
    }
  }
}

export function scheduleResultText(input: unknown): string {
  const response = scheduleResponseSchema.parse(input)
  switch (response.kind) {
    case 'refused': {
      return response.reason
    }
    case 'accepted': {
      return response.id === undefined
        ? UI_TEXT.scheduleV2.runtime.accepted
        : `${UI_TEXT.scheduleV2.runtime.accepted}: ${response.id}`
    }
    case 'list': {
      return response.schedules.length === 0
        ? UI_TEXT.scheduleV2.runtime.empty
        : response.schedules
            .map((s) => {
              const next =
                s.nextFireAtMs === undefined
                  ? UI_TEXT.scheduleV2.labels.trigger
                  : formatDateTime(s.nextFireAtMs)
              return `${s.name} (${s.id})\t${UI_TEXT.scheduleV2.delivery[s.delivery]}\t${s.paused ? UI_TEXT.scheduleV2.labels.paused : next}`
            })
            .join('\n')
    }
    case 'timeline': {
      return response.entries.length === 0
        ? UI_TEXT.scheduleV2.runtime.empty
        : response.entries
            .map(
              (e) =>
                `${e.scheduleId}\t${formatDateTime(e.atMs)}${e.collisionIds.length === 0 ? '' : `\t${UI_TEXT.scheduleV2.messages.collision}`}`,
            )
            .join('\n')
    }
    case 'backgroundStatus': {
      return response.status.registered
        ? `${UI_TEXT.scheduleV2.labels.background}: ${response.status.nextWakeAtMs === undefined ? UI_TEXT.scheduleV2.runtime.accepted : formatDateTime(response.status.nextWakeAtMs)}`
        : UI_TEXT.scheduleV2.messages.backgroundRemoved
    }
    case 'grantAudit': {
      return response.entries.map((e) => `${formatDateTime(e.atMs)}\t${e.kind}`).join('\n')
    }
    case 'eventSources': {
      return response.sources
        .map(
          (s) =>
            `${s.id}: ${s.capability.available ? UI_TEXT.scheduleV2.runtime.accepted : s.capability.reason}`,
        )
        .join('\n')
    }
    case 'historyPreview': {
      return response.preview.available
        ? formatNumber(response.preview.matchedCount)
        : response.preview.reason
    }
  }
}

/** One invocation settles its due work and closes even after a refusal or failure. */
export async function runScheduleCommand(
  options: ScheduleCommandOptions,
  cwd: string,
  control: ScheduleControlPort,
): Promise<ScheduleCommandResult> {
  return await settleScheduleCommand(
    () => executeScheduleCommand(options, cwd, control),
    () => control.close(),
  )
}

async function executeScheduleCommand(
  options: ScheduleCommandOptions,
  cwd: string,
  control: ScheduleControlPort,
): Promise<ScheduleCommandResult> {
  let response: unknown
  try {
    if (options.operation === 'run-due') {
      await control.runDue()
      response = { kind: 'accepted' }
    } else {
      let request: ScheduleRequest
      try {
        request = requestOf(options, cwd)
      } catch {
        return failure(options, UI_TEXT.scheduleV2.runtime.invalidRequest)
      }
      response = await control.request(request)
    }
    const parsed = scheduleResponseSchema.safeParse(response)
    if (!parsed.success) return failure(options, UI_TEXT.scheduleV2.runtime.invalidResponse)
    return {
      exitCode: parsed.data.kind === 'refused' ? 1 : 0,
      output: options.isJson ? JSON.stringify(parsed.data) : scheduleResultText(parsed.data),
    }
  } catch {
    return failure(options, UI_TEXT.scheduleV2.runtime.unavailable)
  }
}

function failure(options: ScheduleCommandOptions, reason: string): ScheduleCommandResult {
  return {
    exitCode: 1,
    output: options.isJson ? JSON.stringify({ kind: 'refused', reason }) : reason,
  }
}
