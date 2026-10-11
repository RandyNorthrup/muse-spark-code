// Reasoning-effort helpers shared by the composer (labels, slider steps) and
// the conversation controller (the wire value sent to the host).

import {
  EFFORT_LEVELS,
  type EffortLevel,
  MODEL_EFFORT_LEVELS,
  THINKING_OFF_EFFORT,
  UI_TEXT,
} from './constants'

export function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value)
}

export function effortLabel(effort: EffortLevel): string {
  return UI_TEXT.effortLevels[effort]
}

/**
 * The MSP `ReasoningEffort` for the session: the chosen tier while Thinking
 * is on, `none` while it is off. The chosen tier is kept so switching
 * Thinking back on restores it.
 */
export function effortForThinking(effort: EffortLevel, isThinkingEnabled: boolean): string {
  return isThinkingEnabled ? effort : THINKING_OFF_EFFORT
}

/**
 * The tiers a model serves (verified live per model family, see
 * MODEL_EFFORT_LEVELS); the full UI range when the model is unknown or not
 * yet reported, so the slider never offers less than the CLI does.
 */
export function effortLevelsFor(
  modelId: string | undefined,
  supported?: readonly EffortLevel[],
): readonly EffortLevel[] {
  if (modelId?.includes('/') === true) return supported ?? []
  if (modelId === undefined) {
    return EFFORT_LEVELS
  }
  const family = Object.keys(MODEL_EFFORT_LEVELS).find((prefix) => modelId.startsWith(prefix))
  return family === undefined ? EFFORT_LEVELS : (MODEL_EFFORT_LEVELS[family] ?? EFFORT_LEVELS)
}

/** Slider position (0-based) for a tier; -1 when the model does not serve it. */
export function effortIndex(levels: readonly EffortLevel[], effort: EffortLevel): number {
  return levels.indexOf(effort)
}

/** The tier at a slider position, clamped to the ends. */
export function effortAt(levels: readonly EffortLevel[], index: number): EffortLevel {
  const clamped = Math.min(Math.max(index, 0), levels.length - 1)
  return levels[clamped] ?? EFFORT_LEVELS[0]
}

/**
 * What the selected model is sent for one requested reasoning setting (lane
 * DSTHINK3): a level it lists, its documented Thinking-off switch, nothing
 * (the model's default), or the typed refusal `unsupported_reasoning_effort`.
 */
export type ReasoningDecision =
  | { readonly kind: 'effort'; readonly effort: string }
  | { readonly kind: 'off' }
  | { readonly kind: 'default' }
  | { readonly kind: 'refuse'; readonly code: 'unsupported_reasoning_effort' }

/** The selected model's reasoning facts, taken from its capability record. */
export interface ReasoningControl {
  /** The record's declared effort levels; undefined when it declares none. */
  readonly effortLevels: readonly string[] | undefined
  /** The record affirms Thinking can be disabled (`canDisable` yes). */
  readonly canDisable: boolean
  /**
   * The model's documented Thinking-off switch from its preset. Undefined:
   * none is declared and the codec keeps owning effort `none` exactly as
   * before this resolver, so those requests stay byte-identical.
   */
  readonly thinkingOff: 'thinking-switch' | undefined
}

const REFUSED: ReasoningDecision = { kind: 'refuse', code: 'unsupported_reasoning_effort' }

/**
 * The one mapping from a requested setting to a model's request. With a
 * declared switch: off only where the record affirms `canDisable`, an
 * unlisted on-level moves to the nearest listed on-level (a tie takes the
 * higher), never to off; no listed on-level sends nothing. Without one, a
 * listed level rides as named and anything else is the codec's `none`.
 */
export function resolveReasoning(model: ReasoningControl, requested: string): ReasoningDecision {
  const listed = model.effortLevels ?? []
  if (model.thinkingOff === undefined) {
    if (listed.includes(requested)) return { kind: 'effort', effort: requested }
    return { kind: requested === THINKING_OFF_EFFORT ? 'off' : 'default' }
  }
  if (requested === THINKING_OFF_EFFORT) return model.canDisable ? { kind: 'off' } : REFUSED
  if (!isEffortLevel(requested)) return REFUSED
  if (listed.includes(requested)) return { kind: 'effort', effort: requested }
  const wanted = EFFORT_LEVELS.indexOf(requested)
  let nearest: EffortLevel | undefined
  for (const level of EFFORT_LEVELS) {
    if (!listed.includes(level)) continue
    const distance = Math.abs(EFFORT_LEVELS.indexOf(level) - wanted)
    if (nearest === undefined || distance <= Math.abs(EFFORT_LEVELS.indexOf(nearest) - wanted))
      nearest = level
  }
  return nearest === undefined ? { kind: 'default' } : { kind: 'effort', effort: nearest }
}
