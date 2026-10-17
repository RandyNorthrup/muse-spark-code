// `/handoff …` typed in the prompt (M74, PLAN.md D49): what follows the
// command, trimmed, is the goal the new conversation starts with; undefined
// when none was typed. Anything else is ordinary prompt text. Pure; the
// webview posts the command instead of sending a message.

export interface HandoffPrompt {
  /** The goal for the new conversation, trimmed; undefined when none was typed. */
  readonly goal: string | undefined
}

const HANDOFF_PROMPT = /^\/handoff(?:\s+([\s\S]*))?$/

/** The handoff command a prompt is, or undefined for any other text. */
export function parseHandoffPrompt(text: string): HandoffPrompt | undefined {
  const match = HANDOFF_PROMPT.exec(text.trim())
  if (match === null) {
    return undefined
  }
  const goal = (match[1] ?? '').trim()
  return { goal: goal === '' ? undefined : goal }
}
