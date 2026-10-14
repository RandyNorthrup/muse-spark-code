// Every editor surface offers a plan model's own effort levels: the ACP
// effort option, the panel slider (through the model summary) and
// `exec --effort` (through that same option). These run through the real
// ACP helpers with model summaries as data: a plan model lists its
// catalogue levels with its catalogue default, and every other model
// keeps the shared range and standing default. No session runs here.
import { describe, expect, it } from 'vitest'
import { defaultEffortFor, modelEffortLevels } from '../../src/acp/agent'
import type { ModelSummary } from '../../src/core/agent/agentBackend'
import { DEFAULT_EFFORT, EFFORT_LEVELS } from '../../src/shared/constants'

function summary(overrides: Partial<ModelSummary> & { modelId: string }): ModelSummary {
  return {
    displayLabel: overrides.modelId,
    contextLimit: undefined,
    isDefault: false,
    isActive: false,
    ...overrides,
  }
}

const planModel = summary({
  modelId: 'chatgpt/gpt-6.1-sol',
  displayLabel: 'chatgpt/gpt-6.1-sol',
  providerId: 'chatgpt',
  effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaultEffort: 'low',
  fastTier: { id: 'priority', name: 'Fast', description: '2x speed, increased usage' },
})

describe('plan model effort levels', () => {
  it('lists low through max for the plan model, with its catalogue default', () => {
    expect(modelEffortLevels([planModel], 'chatgpt/gpt-6.1-sol')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    expect(defaultEffortFor([planModel], 'chatgpt/gpt-6.1-sol')).toBe('low')
  })

  it('keeps the shared range and standing default where the model names none', () => {
    const meta = summary({ modelId: 'muse-spark-1.3' })
    expect(modelEffortLevels([meta], 'muse-spark-1.3')).toEqual([...EFFORT_LEVELS])
    expect(defaultEffortFor([meta], 'muse-spark-1.3')).toBe(DEFAULT_EFFORT)
    expect(modelEffortLevels([], 'chatgpt/gpt-6.1-sol')).toEqual([])
    expect(defaultEffortFor([], 'chatgpt/gpt-6.1-sol')).toBe(DEFAULT_EFFORT)
  })

  it('ignores a default the model does not serve', () => {
    const odd = summary({
      ...planModel,
      defaultEffort: 'minimal',
    })
    expect(defaultEffortFor([odd], 'chatgpt/gpt-6.1-sol')).toBe(DEFAULT_EFFORT)
  })
})
