// The text of a playback turn (D203), the same on every backend and
// surface: what to report, that no tools are available, and the marker line
// the answer must open with so the person knows it is the agent's own
// understanding. Model text: English whatever the display language.

import { PLAYBACK_MODEL_TEXT } from '../../shared/constants'

const PARAGRAPH = '\n\n'

/** The user message a `/playback` turn sends: the report it must give, from memory only. */
export function playbackTurnText(): string {
  return [
    PLAYBACK_MODEL_TEXT.playbackRole,
    PLAYBACK_MODEL_TEXT.playbackNoTools,
    PLAYBACK_MODEL_TEXT.playbackSections,
    `${PLAYBACK_MODEL_TEXT.playbackAnswer} The marker line:\n${PLAYBACK_MODEL_TEXT.playbackMarker}`,
  ].join(PARAGRAPH)
}
