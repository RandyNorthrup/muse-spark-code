import {
  SCHEDULE_POLL_INTERVAL_MS,
  SCHEDULE_PROTOCOL_VERSION,
  UI_TEXT,
} from '../../shared/constants'
import {
  parseScheduleHostMessage,
  parseScheduleWebviewMessage,
  type ScheduleWebviewMessage,
} from '../../shared/scheduleProtocol'
import type { ScheduleRequest } from '../../shared/scheduleV2'
import type { MessageSource } from '../hostBridge'
import type { ScheduleResponse } from './ports'

/** The same versioned envelope works with VS Code and the MHP bridge. */
export function scheduleChannel(
  messages: MessageSource,
  post: (message: ScheduleWebviewMessage) => void,
) {
  const pending = new Map<
    string,
    {
      resolve: (response: ScheduleResponse) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const changes = new Set<(message: unknown) => void>()
  const prefix = crypto.randomUUID()
  let sequence = 0
  let isDisposed = false
  const receive = (event: MessageEvent<unknown>) => {
    const parsed = parseScheduleHostMessage(event.data)
    if (!parsed.ok) return
    if (parsed.message.type === 'scheduleChanged') {
      for (const listener of changes) listener(parsed.message)
      return
    }
    const waiting = pending.get(parsed.message.requestId)
    if (waiting === undefined) return
    clearTimeout(waiting.timer)
    pending.delete(parsed.message.requestId)
    waiting.resolve(parsed.message.response)
  }
  messages.addEventListener('message', receive)
  return {
    subscribeChanges: (listener: (message: unknown) => void) => {
      if (!isDisposed) changes.add(listener)
      return () => {
        changes.delete(listener)
      }
    },
    request: (request: ScheduleRequest): Promise<ScheduleResponse> =>
      new Promise((resolve, reject) => {
        if (isDisposed) {
          reject(new Error(UI_TEXT.scheduleV2.editor.loadFailed))
          return
        }
        const requestId = `${prefix}:${String(sequence++)}`
        const parsed = parseScheduleWebviewMessage({
          type: 'schedulesRequest',
          version: SCHEDULE_PROTOCOL_VERSION,
          requestId,
          request,
        })
        if (!parsed.ok) {
          reject(new Error(UI_TEXT.scheduleV2.editor.invalid))
          return
        }
        const timer = setTimeout(() => {
          pending.delete(requestId)
          reject(new Error(UI_TEXT.scheduleV2.editor.loadFailed))
        }, SCHEDULE_POLL_INTERVAL_MS)
        pending.set(requestId, { resolve, reject, timer })
        try {
          post(parsed.message)
        } catch {
          clearTimeout(timer)
          pending.delete(requestId)
          reject(new Error(UI_TEXT.scheduleV2.editor.loadFailed))
        }
      }),
    dispose: () => {
      isDisposed = true
      messages.removeEventListener('message', receive)
      for (const waiting of pending.values()) {
        clearTimeout(waiting.timer)
        waiting.reject(new Error(UI_TEXT.scheduleV2.editor.loadFailed))
      }
      pending.clear()
      changes.clear()
    },
  }
}
