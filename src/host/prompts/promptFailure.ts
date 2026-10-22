// The prompt boundary's failure words (read by promptEntry.ts): a message
// from the known fixed list passes through, and anything else — private
// paths, prompt text, a foreign error — reads as the fixed invalid words.
// The boundary discards the original cause by design, so only this
// function's answer ever crosses it, to the person or the log. VS
// Code-free, so the unit tests can drive it.
import { UI_TEXT } from '../../shared/constants'

/**
Whether the failure is the prompt store's own damage report: only that
named condition is repaired in place, and every other failure keeps its
cause for the caller.
*/
export function isPromptStoreDamaged(error: unknown): boolean {
  return error instanceof Error && error.message === UI_TEXT.promptStoreDamaged
}

/**
The defined refusals every sharing surface reports, read at use time so
the installed language is the one shown. The panel boundary and the
headless command boundary (promptEntry.ts) keep the same list.
*/
export function safePromptMessages(): readonly string[] {
  return [
    UI_TEXT.promptFileInvalid,
    UI_TEXT.promptLimits,
    UI_TEXT.promptStoreDamaged,
    UI_TEXT.promptStoreBusy,
    UI_TEXT.promptWorkspaceRequired,
    UI_TEXT.shareRangeInvalid,
    UI_TEXT.shareTooLarge,
    UI_TEXT.shareAttachmentUnavailable,
    UI_TEXT.sharePreviewExpired,
    UI_TEXT.exportNothing,
    UI_TEXT.exportHistoryUnavailable,
    UI_TEXT.exportWaitForTurn,
    UI_TEXT.shareConfidential,
    UI_TEXT.shareCancelled,
  ]
}

/**
The failure the person may read: a message from the known fixed list, or
the fixed invalid words. The boundary discards the original cause by
design (see below), so only this function's answer ever crosses it.
*/
export function safePromptFailure(error: unknown): Error {
  const safeMessages = safePromptMessages()
  // The boundary discards the original cause: it may contain private paths or prompt text.
  return new Error(
    error instanceof Error && safeMessages.includes(error.message)
      ? error.message
      : UI_TEXT.promptFileInvalid,
  )
}
