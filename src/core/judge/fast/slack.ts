// M125 lane E (D107): slack scheduling. An S decision applies only
// inside a real window — the model's generation for the state it was
// sent, a result settled while its round still runs, hooks,
// verification or compaction. A lone result has no window, so its
// triage uses the deterministic parser or an I engine, and the output
// goes out whole as today. Late answers are never applied. Pure and
// synchronous; the cascade owns the clock.
import type { FastWindow } from './classes'

/** Where an S decision may run. `lone` is the absence of a window. */
export type SlackWindowKind =
  'generation' | 'round' | 'hooks' | 'verification' | 'compaction' | 'lone'

/** The window a lifecycle moment offers an S decision. */
export function slackWindow(kind: SlackWindowKind): FastWindow {
  return kind === 'lone' ? 'none' : 'real'
}

/** Whether an answer that settled this late misses its deadline. */
export function isLateAnswer(startedMs: number, settledMs: number, deadlineMs: number): boolean {
  return (
    !Number.isFinite(startedMs) || !Number.isFinite(settledMs) || settledMs - startedMs > deadlineMs
  )
}
