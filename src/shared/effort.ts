// Reasoning-effort helpers shared by the composer (labels, slider steps) and
// the conversation controller (the wire value sent to the host).

import { EFFORT_LABELS, EFFORT_LEVELS, type EffortLevel, THINKING_OFF_EFFORT } from './constants'

export function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value)
}

export function effortLabel(effort: EffortLevel): string {
  return EFFORT_LABELS[effort]
}

/**
 * The MSP `ReasoningEffort` for the session: the chosen tier while Thinking
 * is on, `none` while it is off. The chosen tier is kept so switching
 * Thinking back on restores it.
 */
export function effortForThinking(effort: EffortLevel, isThinkingEnabled: boolean): string {
  return isThinkingEnabled ? effort : THINKING_OFF_EFFORT
}

/** Slider position (0-based) for a tier. */
export function effortIndex(effort: EffortLevel): number {
  return EFFORT_LEVELS.indexOf(effort)
}

/** The tier at a slider position, clamped to the ends. */
export function effortAt(index: number): EffortLevel {
  const clamped = Math.min(Math.max(index, 0), EFFORT_LEVELS.length - 1)
  return EFFORT_LEVELS[clamped] ?? EFFORT_LEVELS[0]
}
