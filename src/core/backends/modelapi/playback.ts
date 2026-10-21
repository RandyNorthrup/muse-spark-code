// The playback turn on the Model API backend (D203): its own instructions
// and no tools at all. A `/playback` the user asks for is a turn of the
// conversation that answers from working memory only; a tool it names is
// refused in code, offered or not, in every mode, Bypass included.

import { PLAYBACK_MODEL_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { agentRoleText, type InstructionFacts, rulesText } from './instructions'

const PARAGRAPH = '\n\n'

/** What the model is told when it names any tool on a playback turn. */
export function playbackToolRefusal(name: string): string {
  return `${name} ${PLAYBACK_MODEL_TEXT.playbackToolRefused}`
}

/**
A playback reply with the contract's opening (D203): the verbatim marker
line first, then the model's own text. A stochastic model can paraphrase
or omit the requested prefix, so the host enforces it instead of trusting
the prompt. Empty text stays empty (no reply, nothing to open); text that
already opens with the marker — past leading blank lines — is returned
unchanged, never doubled.
*/
export function ensurePlaybackMarker(text: string): string {
  const marker = PLAYBACK_MODEL_TEXT.playbackMarker
  return text === '' || text.trimStart().startsWith(marker) ? text : `${marker}\n${text}`
}

/** What the host does with a playback turn's streamed text against the marker. */
export interface PlaybackMarkerCheck {
  /** The prefix to emit before this delta when the text diverged from the marker. */
  readonly inject: string
  /** True once the text is known to open with the marker. */
  readonly ensured: boolean
}

/**
A playback turn's streamed text against the marker (D203), called with the
message's text so far and its next delta. Text that opens with the marker
is compliant; text the marker still prefixes may yet comply, so it flows
untouched; anything else diverged, and the host prefixes the marker line
itself before the delta. Pure; the turn's flag records `ensured`.
*/
export function checkPlaybackMarker(textSoFar: string, delta: string): PlaybackMarkerCheck {
  const marker = PLAYBACK_MODEL_TEXT.playbackMarker
  const candidate = `${textSoFar}${delta}`
  if (candidate.startsWith(marker)) {
    return { inject: '', ensured: true }
  }
  return marker.startsWith(candidate)
    ? { inject: '', ensured: false }
    : { inject: `${marker}\n`, ensured: true }
}

export interface PlaybackFacts {
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  /** `YYYY-MM-DD` in the host's clock. */
  readonly today: string
  /** The session goal's instructions, the working memory the turn reports. */
  readonly goalSection: string | undefined
  /** The workspace's rules files, trusted workspaces only (D13). */
  readonly rules: string | undefined
  /** A team conversation's roster and guidance (M96), as its ordinary turns carry it. */
  readonly teamRoster: string | undefined
  /** The custom agent's role the session runs as (M76), as its ordinary turns carry it. */
  readonly agent: InstructionFacts['agent']
}

/** The playback turn's system instructions: who it is, that no tools exist, what to report. */
export function playbackInstructionsFor(facts: PlaybackFacts): string {
  const role = [
    PLAYBACK_MODEL_TEXT.playbackRole,
    fill(PLAYBACK_MODEL_TEXT.playbackWorkspace, {
      root: facts.workspaceRoot,
      platform: facts.platform,
    }),
    PLAYBACK_MODEL_TEXT.playbackNoTools,
    PLAYBACK_MODEL_TEXT.playbackSections,
    PLAYBACK_MODEL_TEXT.playbackAnswer,
  ].join(PARAGRAPH)
  const sections = [
    role,
    fill(PLAYBACK_MODEL_TEXT.playbackEnvironment, { today: facts.today }),
    facts.goalSection,
    rulesText(facts.rules),
    facts.teamRoster,
    agentRoleText(facts.agent),
  ]
  return sections.filter((section) => section !== undefined).join(PARAGRAPH)
}
