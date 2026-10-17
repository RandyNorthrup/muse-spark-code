import { previewScheduleTimes } from '../../core/schedules/time/scheduleTime'
import { UI_TEXT } from '../../shared/constants'
import type { ScheduleDraft, ScheduleRequest } from '../../shared/scheduleV2'
import type { ScheduleSurfacePort } from './ports'

/**
 * W's surface port over the panel's versioned channel (M115). Requests go
 * to the host bridge; time previews compute locally with T's pure times —
 * the runtime has no draft-preview endpoint, and the editor needs fire
 * times before the schedule exists.
 */
export function createScheduleSurfacePort(
  channel: {
    request(request: ScheduleRequest): Promise<unknown>
    subscribeChanges(listener: (message: unknown) => void): () => void
  },
  nowMs: () => number,
): ScheduleSurfacePort {
  return {
    request: (request) => channel.request(request),
    preview: (draft: ScheduleDraft): Promise<unknown> => {
      if (draft.trigger.kind === 'event')
        return Promise.resolve({
          available: false,
          reason: UI_TEXT.scheduleV2.messages.historyUnavailable,
        })
      const times = previewScheduleTimes(
        {
          trigger: draft.trigger,
          zone: draft.zone,
          ...(draft.end !== undefined && { end: draft.end }),
          fireCount: 0,
        },
        nowMs(),
      )
      return Promise.resolve({ available: true, times: [...times] })
    },
    subscribeChanges: (listener) => channel.subscribeChanges(listener),
  }
}
