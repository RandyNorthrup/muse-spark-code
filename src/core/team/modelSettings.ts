// Model settings per entry (M96 lane F, PLAN.md D75): every setting a
// model supports, from M95's capabilities, Muse Code's profiles and ACP
// config options; their cost notes; role defaults. Unsupported settings
// are hidden, not greyed out. Pure; no `vscode` import.
//
// Seams: the capability data, price cards and profiles are M95's and lane
// R's capability check; here they arrive as the injected
// `TeamModelSettingsSource`. A task's settings are fixed when it starts
// (SoL-Pi rule 1): an edit applies to the next task, which the runner
// (lanes T and W) enforces by snapshotting `ResolvedEntrySettings`.

import { UI_TEXT } from '../../shared/constants'

/** Every setting an entry or the orchestrator slot may expose. */
export type TeamModelSetting =
  | 'effort'
  | 'thinking'
  | 'thinkingBudget'
  | 'serviceTier'
  | 'maxOutputTokens'
  | 'sampling'
  | 'verbosity'
  | 'parallelToolCalls'
  | 'contextCap'

export const TEAM_MODEL_SETTINGS: readonly TeamModelSetting[] = [
  'effort',
  'thinking',
  'thinkingBudget',
  'serviceTier',
  'maxOutputTokens',
  'sampling',
  'verbosity',
  'parallelToolCalls',
  'contextCap',
]

/**
 * What M95 knows about one model, reduced to what the settings need: the
 * effort tiers its provider serves, which optional settings it accepts,
 * and whether Meta advises leaving sampling unset.
 */
export interface TeamModelSettingsSource {
  readonly modelRef: string
  /** The provider's own effort levels, in order (Meta: minimal to xhigh). */
  readonly effortTiers: readonly string[]
  readonly supportsThinking: boolean
  readonly supportsThinkingBudget: boolean
  readonly supportsServiceTier: boolean
  readonly supportsSampling: boolean
  readonly supportsVerbosity: boolean
  readonly supportsParallelToolCalls: boolean
  readonly supportsContextCap: boolean
  readonly supportsMaxOutputTokens: boolean
  readonly maxOutputTokensMinimum: number
}

/** A task's fixed settings, snapshotted when it starts. */
export interface ResolvedEntrySettings {
  readonly effort: string | undefined
  readonly thinking: boolean | undefined
  readonly thinkingBudgetTokens: number | undefined
  readonly serviceTier: string | undefined
  readonly maxOutputTokens: number | undefined
  readonly temperature: number | undefined
  readonly topP: number | undefined
  readonly verbosity: string | undefined
  readonly parallelToolCalls: boolean | undefined
  readonly contextCapTokens: number | undefined
}

/**
 * Exactly the settings the model supports (D75). Meta advises leaving
 * temperature and top-p unset (M94 research A11) and refuses verbosity
 * (M94 research A2), so sampling and verbosity stay hidden for Muse Spark
 * models even where the wire would take them.
 */
export function supportedSettings(source: TeamModelSettingsSource): readonly TeamModelSetting[] {
  const settings: TeamModelSetting[] = []
  if (source.effortTiers.length > 0) {
    settings.push('effort')
  }
  if (source.supportsThinking) {
    settings.push('thinking')
    if (source.supportsThinkingBudget) {
      settings.push('thinkingBudget')
    }
  }
  if (source.supportsServiceTier) {
    settings.push('serviceTier')
  }
  if (source.supportsMaxOutputTokens) {
    settings.push('maxOutputTokens')
  }
  if (source.supportsSampling && !isMuseSparkModel(source.modelRef)) {
    settings.push('sampling')
  }
  if (source.supportsVerbosity && !isMuseSparkModel(source.modelRef)) {
    settings.push('verbosity')
  }
  if (source.supportsParallelToolCalls) {
    settings.push('parallelToolCalls')
  }
  if (source.supportsContextCap) {
    settings.push('contextCap')
  }
  return settings
}

function isMuseSparkModel(modelRef: string): boolean {
  return modelRef.startsWith('muse-spark-')
}

/** Each setting's one-line cost note (D75). */
export function settingCostNote(setting: TeamModelSetting): string {
  switch (setting) {
    case 'effort': {
      return UI_TEXT.teamSettingCostEffort
    }
    case 'thinking': {
      return UI_TEXT.teamSettingCostThinking
    }
    case 'thinkingBudget': {
      return UI_TEXT.teamSettingCostThinking
    }
    case 'serviceTier': {
      return UI_TEXT.teamSettingCostServiceTier
    }
    case 'maxOutputTokens': {
      return UI_TEXT.teamSettingCostMaxOutput
    }
    case 'sampling': {
      return UI_TEXT.teamSettingCostSampling
    }
    case 'verbosity': {
      return UI_TEXT.teamSettingCostVerbosity
    }
    case 'parallelToolCalls': {
      return UI_TEXT.teamSettingCostParallel
    }
    case 'contextCap': {
      return UI_TEXT.teamSettingCostContextCap
    }
  }
}

export type TeamEffortBase = 'low' | 'medium' | 'high'

/** A charter suggests each role's base effort (D75). */
export function roleBaseEffort(role: string): TeamEffortBase {
  switch (role) {
    case 'marketing':
    case 'docs': {
      return 'low'
    }
    case 'research':
    case 'design':
    case 'qa': {
      return 'medium'
    }
    case 'engineering':
    case 'code-review': {
      return 'high'
    }
    default: {
      return 'medium'
    }
  }
}

/**
 * Known effort names used to map a base missing from the supplied tiers.
 * Intensity steps walk the provider's own ordered tiers. M95 supplies
 * only supported tiers: Meta never gets `none`, and `max` only on Standard
 * 1.3 (D75).
 */
export const TEAM_EFFORT_LADDER: readonly string[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

export function shiftEffort(base: string, steps: number, tiers: readonly string[]): string {
  if (tiers.length === 0) {
    return base
  }
  const supportedBase = tiers.includes(base) ? base : nearestTier(base, tiers)
  const tierIndex = tiers.indexOf(supportedBase)
  return tiers[Math.min(tiers.length - 1, Math.max(0, tierIndex + steps))] ?? supportedBase
}

/** The tier the model serves closest to the shifted effort. */
function nearestTier(wanted: string, tiers: readonly string[]): string {
  const wantedIndex = TEAM_EFFORT_LADDER.indexOf(wanted)
  if (wantedIndex === -1 || tiers.length === 0) {
    return tiers[0] ?? wanted
  }
  let best = tiers[0] ?? wanted
  let bestDistance = Number.MAX_SAFE_INTEGER
  for (const tier of tiers) {
    const index = TEAM_EFFORT_LADDER.indexOf(tier)
    const distance = index === -1 ? Number.MAX_SAFE_INTEGER : Math.abs(index - wantedIndex)
    if (!(distance < bestDistance)) {
      continue
    }

    best = tier
    bestDistance = distance
  }
  return best
}

/**
 * Default inherits the composer's picker settings, live, shifted by the
 * intensity level's step and clamped to the model's tiers (D75).
 */
export function defaultEntryEffort(
  pickerEffort: string,
  effortSteps: number,
  tiers: readonly string[],
): string {
  return shiftEffort(pickerEffort, effortSteps, tiers)
}
