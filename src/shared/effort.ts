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

/**
 * A served catalogue row's tiers (C-M106-3R3): the ordered selectable tiers,
 * their display strings, and the row's default, as `model/list` sent them.
 * Unknown tiers ride verbatim. Satisfied by the host summary and the
 * webview's model row alike.
 */
export interface CatalogueTiers {
  readonly variants?: readonly string[] | 'unknown' | undefined
  readonly reasoningEffortVariants?:
    readonly { readonly tier: string; readonly description?: string | undefined }[] | undefined
  readonly defaultReasoningEffort?: string | undefined
}

export function effortLabel(effort: EffortLevel): string {
  return UI_TEXT.effortLevels[effort]
}

/**
 * A served model row, as any layer carries it: the controller's cached
 * options, the palette context's models, the ACP session's summaries. Every
 * admission caller resolves tiers through `servedEffortLevels` below, never
 * by reading the static family table directly (RVCM1063D cause 1).
 */
export interface ServedEffortRow extends CatalogueTiers {
  readonly modelId?: string | undefined
  readonly effortLevels?: readonly EffortLevel[] | undefined
}

/**
 * The tiers a model may be asked for (RVCM1063D cause 1): the served
 * catalogue's row for this model id, through `effortLevelsFor`. The dots,
 * keyboard stepping, the palette slash command, the conversation
 * controller's admission and ACP all call this one function. No caller reads
 * `MODEL_EFFORT_LEVELS` itself.
 */
export function servedEffortLevels(
  models: readonly ServedEffortRow[] | undefined,
  modelId: string | undefined,
): readonly EffortLevel[] {
  const row = models?.find((model) => model.modelId === modelId)
  return effortLevelsFor(modelId, row?.effortLevels, row)
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
  catalogue?: CatalogueTiers,
): readonly EffortLevel[] {
  if (catalogue?.variants !== undefined) {
    return catalogue.variants === 'unknown' ? [] : catalogue.variants.filter(isEffortLevel)
  }
  if (supported !== undefined) return supported
  if (modelId?.includes('/') === true) return []
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
