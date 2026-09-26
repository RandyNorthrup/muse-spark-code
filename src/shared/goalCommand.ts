// `/goal …` typed in the prompt (M45, PLAN.md D38), read as Muse Code's TUI
// reads it (docs/muse-code/interactive, "Goals and long-running loops"):
//
//   /goal <objective>        set the session goal
//   /goal edit <objective>   change its objective
//   /goal pause              pause it
//   /goal resume             resume it
//   /goal clear              drop it
//
// A word after `/goal` is a verb only when it is the whole argument (edit
// takes the rest as its objective): `/goal pause the build` sets a goal.
// Pure; the webview posts the command instead of sending a message.

import type { GoalCommandVerb } from './constants'

export interface GoalPrompt {
  readonly verb: GoalCommandVerb
  /** `set` and `edit`: the objective, trimmed; empty when none was typed. */
  readonly objective: string | undefined
}

const BARE_VERBS: readonly GoalCommandVerb[] = ['pause', 'resume', 'clear']
const EDIT_VERB = 'edit'
// `/goal` (GOAL_SLASH_COMMAND) and what follows it.
const GOAL_PROMPT = /^\/goal(?:\s+([\s\S]*))?$/
const WORD_AND_REST = /^(\S+)(?:\s+([\s\S]*))?$/

/** The goal command a prompt is, or undefined for any other text. */
export function parseGoalPrompt(text: string): GoalPrompt | undefined {
  const match = GOAL_PROMPT.exec(text.trim())
  if (match === null) {
    return undefined
  }
  const rest = (match[1] ?? '').trim()
  const bare = BARE_VERBS.find((verb) => verb === rest)
  if (bare !== undefined) {
    return { verb: bare, objective: undefined }
  }
  const words = WORD_AND_REST.exec(rest)
  return words?.[1] === EDIT_VERB
    ? { verb: 'edit', objective: (words[2] ?? '').trim() }
    : { verb: 'set', objective: rest }
}

/** Whether the verb changes the objective, so it needs one. */
export function requiresObjective(verb: GoalCommandVerb): boolean {
  return verb === 'set' || verb === 'edit'
}
