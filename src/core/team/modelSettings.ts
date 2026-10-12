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

import {
  UI_TEXT,
  TEAM_BOUND_SETTING_KEYS,
  TEAM_EFFORT_LADDER,
  TEAM_ROLE_IDS,
  TEAM_ROLE_BASE_EFFORT,
  TEAM_DEFAULT_ROLE_EFFORT,
} from '../../shared/constants'
import { knownEffortTiers } from '../../shared/effort'
import { fill } from '../../shared/l10n/text'
import type { TeamModelSettings } from '../../shared/teamConfig'
import type { ModelCapabilityRecord } from '../providers/capabilityRecord'

/**
 * A model's current capabilities for settings validation (RVCM963JB P2-5):
 * the record the model serves today, qualified provider ids included. An
 * unknown half stays unknown: only verified lists and maxima refuse.
 */
export interface TeamSettingCapabilities {
  /** Effort tiers the model serves now; undefined when unknown. */
  readonly effortTiers: readonly string[] | undefined
  /** Maximum output tokens the model serves now; undefined when unknown. */
  readonly maxOutputTokens: number | undefined
}

/** The validation view of a capability record: only verified evidence refuses. */
export function teamSettingCapabilities(record: ModelCapabilityRecord): TeamSettingCapabilities {
  const effort = record.reasoning.effortLevels
  return {
    effortTiers: effort.state === 'yes' ? effort.value : undefined,
    maxOutputTokens: record.output.maxTokens,
  }
}

/** A saved setting's refusal, naming the setting, value and model. */
function unsupportedSetting(setting: string, value: unknown, modelId: string): string {
  return fill(UI_TEXT.teamSettingUnsupported, {
    setting,
    value: String(value),
    model: modelId,
  })
}

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

export { TEAM_MODEL_SETTINGS } from '../../shared/constants'

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

/**
 * A saved effort tier or output cap against the model's current
 * capabilities: an effort the model does not serve and a cap above the
 * model's maximum refuse with their reason, never silently changed or
 * clamped later. Without capabilities the fixed family table decides effort
 * and only malformed caps refuse; the session re-checks live tiers at apply.
 * Returns the specific translated reason, if any.
 */
export function refuseUnservedSetting(
  settings: TeamModelSettings | undefined,
  modelId: string,
  capabilities?: TeamSettingCapabilities,
): string | undefined {
  const effort = settings?.effort
  if (effort !== undefined) {
    const tiers = capabilities?.effortTiers ?? knownEffortTiers(modelId)
    if (effort === '' || tiers?.every((tier) => tier !== effort) === true)
      return unsupportedSetting('effort', effort, modelId)
  }
  const outputCap = settings?.outputCap
  const maximum = capabilities?.maxOutputTokens
  return outputCap !== undefined &&
    (!Number.isSafeInteger(outputCap) ||
      outputCap < 1 ||
      (maximum !== undefined && outputCap > maximum))
    ? unsupportedSetting('outputCap', outputCap, modelId)
    : undefined
}

/**
 * A worker's saved settings against its entry model's current capabilities,
 * before the working copy exists. Unknown keys, empty or unserved efforts
 * and malformed or above-maximum caps refuse with their specific reason,
 * never silently changed or clamped later. Returns the specific translated
 * reason, if any.
 */
export function validateWorkerSettings(
  settings: TeamModelSettings | undefined,
  modelId: string,
  capabilities?: TeamSettingCapabilities,
): string | undefined {
  const entries = Object.entries(settings ?? {})
  for (const [key, value] of entries) {
    if (TEAM_BOUND_SETTING_KEYS.every((bound) => bound !== key))
      return unsupportedSetting(key, value, modelId)
  }
  return refuseUnservedSetting(settings, modelId, capabilities)
}

export type TeamEffortBase = 'low' | 'medium' | 'high'

/** A charter suggests each role's base effort (D75). */
export function roleBaseEffort(role: string): TeamEffortBase {
  const builtIn = TEAM_ROLE_IDS.find((id) => id === role)
  return builtIn === undefined ? TEAM_DEFAULT_ROLE_EFFORT : TEAM_ROLE_BASE_EFFORT[builtIn]
}

/**
 * Known effort names used to map a base missing from the supplied tiers.
 * Intensity steps walk the provider's own ordered tiers. M95 supplies
 * only supported tiers: Meta never gets `none`, and `max` only on Standard
 * 1.3 (D75).
 */
export { TEAM_EFFORT_LADDER } from '../../shared/constants'

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
