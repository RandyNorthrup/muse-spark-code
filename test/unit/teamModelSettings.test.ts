// Model settings (M96 lane F): exactly the settings the model supports,
// their cost notes, role defaults and the intensity shift clamped to the
// model's tiers.

import { describe, expect, it } from 'vitest'
import {
  defaultEntryEffort,
  roleBaseEffort,
  settingCostNote,
  shiftEffort,
  supportedSettings,
  TEAM_EFFORT_LADDER,
  TEAM_MODEL_SETTINGS,
  type TeamModelSettingsSource,
  type ResolvedEntrySettings,
} from '../../src/core/team/modelSettings'

const META_TIERS = ['minimal', 'low', 'medium', 'high', 'xhigh']

function source(overrides: Partial<TeamModelSettingsSource> = {}): TeamModelSettingsSource {
  return {
    modelRef: 'muse-spark-1.3',
    effortTiers: [...META_TIERS],
    supportsThinking: true,
    supportsThinkingBudget: true,
    supportsServiceTier: true,
    supportsSampling: true,
    supportsVerbosity: false,
    supportsParallelToolCalls: true,
    supportsContextCap: true,
    supportsMaxOutputTokens: true,
    maxOutputTokensMinimum: 16,
    ...overrides,
  }
}

describe('supportedSettings', () => {
  it('shows every supported setting, including the output cap when supported', () => {
    expect(supportedSettings(source({ modelRef: 'other-model', supportsVerbosity: true }))).toEqual(
      [...TEAM_MODEL_SETTINGS],
    )
  })

  it('hides sampling and verbosity for Muse Spark models', () => {
    const settings = supportedSettings(source())
    expect(settings).not.toContain('sampling')
    expect(settings).not.toContain('verbosity')
  })

  it('hides effort when the model serves no tier', () => {
    expect(supportedSettings(source({ effortTiers: [] }))).not.toContain('effort')
  })

  it('hides what the model does not take', () => {
    const settings = supportedSettings(
      source({
        effortTiers: [],
        supportsThinking: false,
        supportsThinkingBudget: false,
        supportsServiceTier: false,
        supportsSampling: false,
        supportsVerbosity: false,
        supportsParallelToolCalls: false,
        supportsContextCap: false,
        supportsMaxOutputTokens: false,
      }),
    )
    expect(settings).toEqual([])
  })

  it('exposes a thinking budget only when supported and carries it in task settings', () => {
    expect(supportedSettings(source())).toContain('thinkingBudget')
    expect(supportedSettings(source({ supportsThinkingBudget: false }))).not.toContain(
      'thinkingBudget',
    )
    expect(supportedSettings(source({ supportsThinking: false }))).not.toContain('thinkingBudget')
    const settings: ResolvedEntrySettings = {
      effort: 'high',
      thinking: true,
      thinkingBudgetTokens: 4096,
      serviceTier: undefined,
      maxOutputTokens: undefined,
      temperature: undefined,
      topP: undefined,
      verbosity: undefined,
      parallelToolCalls: undefined,
      contextCapTokens: undefined,
    }
    expect(settings.thinkingBudgetTokens).toBe(4096)
  })
})

describe('cost notes and role defaults', () => {
  it('notes each setting in one line', () => {
    for (const setting of TEAM_MODEL_SETTINGS) {
      expect(settingCostNote(setting).length).toBeGreaterThan(0)
    }
    expect(settingCostNote('effort')).toContain('twice')
  })

  it('suggests the base effort per role', () => {
    expect(roleBaseEffort('marketing')).toBe('low')
    expect(roleBaseEffort('docs')).toBe('low')
    expect(roleBaseEffort('research')).toBe('medium')
    expect(roleBaseEffort('design')).toBe('medium')
    expect(roleBaseEffort('qa')).toBe('medium')
    expect(roleBaseEffort('engineering')).toBe('high')
    expect(roleBaseEffort('code-review')).toBe('high')
    expect(roleBaseEffort('custom-role')).toBe('medium')
  })
})

describe('shiftEffort', () => {
  it('walks the ladder from the base', () => {
    expect(TEAM_EFFORT_LADDER).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(shiftEffort('medium', 0, META_TIERS)).toBe('medium')
    expect(shiftEffort('high', 1, [...META_TIERS, 'max'])).toBe('xhigh')
    expect(shiftEffort('low', -2, META_TIERS)).toBe('minimal')
  })

  it('clamps to the tiers the model serves', () => {
    // Heavy on a model without max: one step past high lands on xhigh.
    expect(shiftEffort('high', 1, META_TIERS)).toBe('xhigh')
    // Max on Standard 1.3 only: two steps past high lands on max there.
    expect(shiftEffort('high', 2, [...META_TIERS, 'max'])).toBe('max')
    // Meta never gets none: a model without low falls back to its nearest.
    expect(shiftEffort('low', 0, ['medium', 'high'])).toBe('medium')
  })

  it('walks the provider tier order including non-Meta tiers', () => {
    expect(shiftEffort('high', 1, ['low', 'medium', 'high', 'max'])).toBe('max')
    expect(shiftEffort('normal', 1, ['low', 'normal', 'high'])).toBe('high')
    expect(shiftEffort('normal', -1, ['low', 'normal', 'high'])).toBe('low')
    expect(shiftEffort('turbo', 1, ['turbo', 'turbo-max'])).toBe('turbo-max')
    expect(shiftEffort('turbo-max', 2, ['turbo', 'turbo-max'])).toBe('turbo-max')
  })

  it('falls back to the first tier for an unknown want or tier', () => {
    expect(shiftEffort('turbo', 0, ['medium'])).toBe('medium')
    expect(shiftEffort('medium', 0, ['weird'])).toBe('weird')
    expect(shiftEffort('medium', 1, [])).toBe('medium')
  })

  it('shifts Default from the picker effort', () => {
    expect(defaultEntryEffort('medium', 1, META_TIERS)).toBe('high')
    expect(defaultEntryEffort('medium', -1, META_TIERS)).toBe('low')
  })
})
