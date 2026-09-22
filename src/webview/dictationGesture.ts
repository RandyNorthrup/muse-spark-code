// The microphone's press semantics (M9), the Claude Code gesture: a tap
// toggles recording, a hold records while held. A press is a pointer down on
// the button, Space/Enter on the focused button, or Ctrl+D in the composer;
// the matching release decides which gesture it was.

import {
  DICTATION_HOLD_MS,
  type DictationAction,
  type DictationUiStatus,
} from '../shared/constants'

export interface DictationPress {
  readonly at: number
  readonly action: DictationAction
}

/** What a press does: idle starts, starting or listening stops, unavailable nothing. */
export function pressAction(status: DictationUiStatus): DictationAction | undefined {
  switch (status) {
    case 'idle': {
      return 'start'
    }
    case 'starting':
    case 'listening': {
      return 'stop'
    }
    case 'unavailable': {
      return undefined
    }
  }
}

/**
 * What the release of `press` does: a press that started recording and
 * lasted at least DICTATION_HOLD_MS was push-to-talk, so releasing stops. A
 * shorter press was a tap and the recording keeps going.
 */
export function releaseAction(
  press: DictationPress | undefined,
  now: number,
): DictationAction | undefined {
  if (press?.action !== 'start') {
    return undefined
  }
  return now - press.at >= DICTATION_HOLD_MS ? 'stop' : undefined
}
