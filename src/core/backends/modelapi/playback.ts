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
