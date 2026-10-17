// A turn that needs the user while the VS Code window is unfocused (M82):
// a long turn that ended, or one waiting on an approval or a question.
//
// The controller names what deserves a notice with `attentionNotice`, keyed
// by session and event. `BackgroundNotifier`, one per window, shows each key
// once, since two surfaces on one session both receive the event, and only
// while `museSpark.notifyOnBackgroundTurn` is on and the window unfocused.
// VS Code gives extensions no OS-level notification, so the notice is VS
// Code's own: it waits in the window's corner until the user comes back.
//
// Terminals pass through verbatim (PLAN.md D36): every one but `cancelled`
// counts as ended, and a word the wire adds later is told as "ended", with
// no meaning guessed for it.

import {
  BACKGROUND_NOTICE_KEYS_MAX,
  BACKGROUND_TURN_NOTIFICATION_MIN_MS,
  UI_TEXT,
} from '../../shared/constants'
import type { AgentEvent } from '../../shared/agentEvents'
import { type Logger, logRejection } from '../logger'

const COMPLETED_TERMINAL = 'completed'
const FAILED_TERMINAL = 'failed'
const CANCELLED_TERMINAL = 'cancelled'

/** A notice worth raising: what it says, and the key that raises it once. */
export interface AttentionNotice {
  readonly key: string
  readonly message: string
}

function endedMessage(terminal: string): string {
  if (terminal === COMPLETED_TERMINAL) {
    return UI_TEXT.notifyTurnDone
  }
  return terminal === FAILED_TERMINAL ? UI_TEXT.notifyTurnFailed : UI_TEXT.notifyTurnEnded
}

/**
 * The notice this session's event deserves, or undefined: none for a short
 * turn's end (it answered before the user looked away), a cancelled turn
 * (stopping it took the window), or a pending card shown again to a later
 * surface (it began waiting before that surface arrived). A turn whose
 * length the backend did not report may have been long, so it notifies.
 */
export function attentionNotice(sessionId: string, event: AgentEvent): AttentionNotice | undefined {
  switch (event.type) {
    case 'turnCompleted': {
      const isShort =
        event.durationMs !== undefined && event.durationMs < BACKGROUND_TURN_NOTIFICATION_MIN_MS
      return isShort || event.terminal === CANCELLED_TERMINAL
        ? undefined
        : { key: `${sessionId}:turn:${event.turnId}`, message: endedMessage(event.terminal) }
    }
    case 'approvalRequested': {
      return event.isReplayed === true
        ? undefined
        : {
            key: `${sessionId}:approval:${event.approvalId}`,
            message: UI_TEXT.notifyApprovalWaiting,
          }
    }
    case 'questionRequested': {
      return event.isReplayed === true
        ? undefined
        : {
            key: `${sessionId}:question:${event.userInputId}`,
            message: UI_TEXT.notifyQuestionWaiting,
          }
    }
    default: {
      return undefined
    }
  }
}

export interface BackgroundNotifierDeps {
  /** `museSpark.notifyOnBackgroundTurn`, read per notice. */
  readonly isEnabled: () => boolean
  /** `vscode.window.state.focused`, read per notice. */
  readonly isWindowFocused: () => boolean
  /** Shows the notice; true when the user asked to see the conversation. */
  readonly show: (message: string) => Promise<boolean>
  readonly log: Logger
}

/** The window's attention notices: each key once, and only while the window is unfocused. */
export class BackgroundNotifier {
  private readonly raised = new Set<string>()

  public constructor(private readonly deps: BackgroundNotifierDeps) {}

  /** Shows the notice, and reveals its conversation when the user asks. */
  private async raise(message: string, reveal: () => void): Promise<void> {
    try {
      if (await this.deps.show(message)) {
        reveal()
      }
    } catch (error: unknown) {
      logRejection(this.deps.log, 'The background notice')(error)
    }
  }

  /** Raises the notice unless it was raised already; `reveal` brings its conversation into view. */
  public notify(notice: AttentionNotice, reveal: () => void): void {
    if (this.raised.has(notice.key)) {
      return
    }
    // Remembered whether or not it shows: a focused window saw it arrive.
    this.raised.add(notice.key)
    if (this.raised.size > BACKGROUND_NOTICE_KEYS_MAX) {
      const [oldest] = this.raised
      if (oldest !== undefined) {
        this.raised.delete(oldest)
      }
    }
    if (!this.deps.isEnabled() || this.deps.isWindowFocused()) {
      return
    }
    void this.raise(notice.message, reveal)
  }
}

/** One background reminder per session/turn, through the existing setting/focus rule. */
export function notifyOpenQuestions(sessionId: string, turnId: string): AttentionNotice {
  return { key: `${sessionId}:openQuestions:${turnId}`, message: UI_TEXT.notifyOpenQuestions }
}
