import type { FeedbackSubmitPort } from '../core/backends/musecode/feedback'
import { FEEDBACK_NOTE_MAX_CHARS, UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'
import { parseHostToWebviewMessage, type WebviewToHostMessage } from '../shared/protocol'

/**
 * Request ids, unique for the webview's lifetime: a late answer to a closed
 * dialog's id can never match a new dialog's first request (RVCM1063 #5).
 * A holder object, so no function reassigns a module-level binding.
 */
const feedbackRequestIds = { next: 1 }

/** The refusal for a note past the protocol maximum, before anything posts. */
function noteTooLong(): Error {
  return new Error(fill(UI_TEXT.feedbackNoteTooLong, { max: FEEDBACK_NOTE_MAX_CHARS }))
}

/**
 * The feedback dialog's port over the host bridge (C-M106-3R2): the preview
 * and the send round-trip with `requestId` correlation, in the shape of the
 * sharing RPC. Every answer is parsed with the shared zod bridge before
 * use; a malformed or stale answer is dropped and the dialog keeps waiting.
 * A refused preview or submit (an overlong note, an outcome with neither
 * result nor refusal, a close) rejects, so nothing leaves the dialog
 * waiting. Closing rejects every waiter and removes the listener.
 */
export function feedbackBridge(post: (message: WebviewToHostMessage) => void): {
  readonly port: FeedbackSubmitPort
  open(): void
  close(): void
} {
  const previews = new Map<number, { resolve(note: string): void; reject(error: Error): void }>()
  const submits = new Map<number, { resolve(outcome: string): void; reject(error: Error): void }>()
  let isOpen = false
  const receive = (event: MessageEvent<unknown>) => {
    const parsed = parseHostToWebviewMessage(event.data)
    if (!parsed.ok) return
    const message = parsed.message
    if (message.type === 'feedbackPreview') {
      const waiter = previews.get(message.requestId)
      previews.delete(message.requestId)
      waiter?.resolve(message.note)
      return
    }
    if (message.type !== 'feedbackOutcome') return
    const waiter = submits.get(message.requestId)
    submits.delete(message.requestId)
    if (waiter === undefined) return
    // Only an uploaded receipt resolves: any other outcome arrives as a
    // refusal, and a reply carrying neither resolves as a failure rather
    // than a false success (RVCM1063 #8).
    if (message.error === undefined) {
      if (message.outcome === undefined) {
        waiter.reject(new Error(UI_TEXT.feedbackFailed))
      } else {
        waiter.resolve(message.outcome)
      }
    } else {
      waiter.reject(new Error(message.error))
    }
  }
  return {
    port: {
      scrubNote: (note) =>
        new Promise<string>((resolve, reject) => {
          if (!isOpen) {
            resolve(note)
            return
          }
          if (note.length > FEEDBACK_NOTE_MAX_CHARS) {
            reject(noteTooLong())
            return
          }
          const requestId = feedbackRequestIds.next++
          previews.set(requestId, { resolve, reject })
          post({ type: 'previewFeedback', requestId, note })
        }),
      submit: (request) => {
        if (request.withFiles || request.attachSessionRecord) {
          // The dialog never offers these; a caller that sets them is
          // refused like the reader refuses the uncertified receipt.
          return Promise.reject(new Error(UI_TEXT.feedbackRecordUnsupported))
        }
        if (request.note.length > FEEDBACK_NOTE_MAX_CHARS) {
          return Promise.reject(noteTooLong())
        }
        return new Promise<string>((resolve, reject) => {
          if (!isOpen) {
            reject(new Error(UI_TEXT.feedbackFailed))
            return
          }
          const requestId = feedbackRequestIds.next++
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
      for (const waiter of previews.values()) waiter.reject(new Error(UI_TEXT.feedbackFailed))
      previews.clear()
      for (const waiter of submits.values()) waiter.reject(new Error(UI_TEXT.feedbackFailed))
      submits.clear()
    },
  }
}
