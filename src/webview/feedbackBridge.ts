import type { FeedbackSubmitPort } from '../core/backends/musecode/feedback'
import { UI_TEXT } from '../shared/constants'
import { parseHostToWebviewMessage, type WebviewToHostMessage } from '../shared/protocol'

/** Request ids, unique while the bridge is open; closing removes the listener. */

/**
 * The feedback dialog's port over the host bridge (C-M106-3R2): the preview
 * and the send round-trip with `requestId` correlation, in the shape of the
 * sharing RPC. Every answer is parsed with the shared zod bridge before
 * use; a malformed or stale answer is dropped and the dialog keeps waiting.
 * Closing rejects the in-flight send and forgets every waiter.
 */
export function feedbackBridge(post: (message: WebviewToHostMessage) => void): {
  readonly port: FeedbackSubmitPort
  open(): void
  close(): void
} {
  const previews = new Map<number, (note: string) => void>()
  const submits = new Map<number, { resolve(outcome: string): void; reject(error: Error): void }>()
  let nextRequestId = 1
  let isOpen = false
  const receive = (event: MessageEvent<unknown>) => {
    const parsed = parseHostToWebviewMessage(event.data)
    if (!parsed.ok) return
    const message = parsed.message
    if (message.type === 'feedbackPreview') {
      const resolve = previews.get(message.requestId)
      previews.delete(message.requestId)
      resolve?.(message.note)
      return
    }
    if (message.type !== 'feedbackOutcome') return
    const waiter = submits.get(message.requestId)
    submits.delete(message.requestId)
    if (waiter === undefined) return
    if (message.error === undefined) waiter.resolve(message.outcome ?? UI_TEXT.feedbackFailed)
    else waiter.reject(new Error(message.error))
  }
  return {
    port: {
      scrubNote: (note) =>
        new Promise<string>((resolve) => {
          if (!isOpen) {
            resolve(note)
            return
          }
          const requestId = nextRequestId++
          previews.set(requestId, resolve)
          post({ type: 'previewFeedback', requestId, note })
        }),
      submit: (request) => {
        if (request.withFiles || request.attachSessionRecord) {
          // The dialog never offers these; a caller that sets them is
          // refused like the reader refuses the uncertified receipt.
          return Promise.reject(new Error(UI_TEXT.feedbackRecordUnsupported))
        }
        return new Promise<string>((resolve, reject) => {
          if (!isOpen) {
            reject(new Error(UI_TEXT.feedbackFailed))
            return
          }
          const requestId = nextRequestId++
          submits.set(requestId, { resolve, reject })
          post({
            type: 'submitFeedback',
            requestId,
            sessionId: request.sessionId,
            classification: request.classification,
            note: request.note,
          })
        })
      },
    },
    open: () => {
      isOpen = true
      window.addEventListener('message', receive)
    },
    close: () => {
      isOpen = false
      window.removeEventListener('message', receive)
      previews.clear()
      for (const waiter of submits.values()) waiter.reject(new Error(UI_TEXT.feedbackFailed))
      submits.clear()
    },
  }
}
