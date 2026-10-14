// The plan catalogue's per-model facts, parsed from the plan's own
// catalogue (GET /v1/models with the plan token). Fixture: the lead's
// value-blind capture of 2026-10-14 through our own app on Windows with
// the owner's ChatGPT Pro sign-in: field names throughout, and
// gpt-6.1-sol's level, default, tier and summary fields verbatim. No
// sign-in or model call runs here: the fixture is data, and every
// assertion below runs through the real parsing, policy and codec
// modules.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { chatGptPlanFacts } from '../../src/core/providers/subscriptions/chatgptPlanFacts'
import {
  planDefaultEffort,
  planFastTier,
  planOfferedLevels,
  resolvePlanEffort,
  type ChatGptPlanFacts,
} from '../../src/core/backends/modelapi/planFacts'
import { effortForPolicy, modelPolicyFor } from '../../src/core/backends/modelapi/modelPolicy'

function entry(): unknown {
  return JSON.parse(
    readFileSync(
      new URL('../fixtures/chatgpt-catalogue/gpt-6.1-sol.json', import.meta.url),
      'utf8',
    ),
  )
}

function facts(): ChatGptPlanFacts {
  const parsed = chatGptPlanFacts(entry())
  if (parsed === undefined) throw new Error('the captured entry parses')
  return parsed
}

function policyFor(parsed: ChatGptPlanFacts) {
  return modelPolicyFor('chatgpt/gpt-6.1-sol', {
    capabilities: { toolCalling: true },
    pricing: { kind: 'plan' },
    planFacts: parsed,
  })
}

describe('chatgpt catalogue facts', () => {
  it('parses the captured entry with unknown fields ignored', () => {
    const parsed = facts()
    expect(parsed.slug).toBe('gpt-6.1-sol')
    expect(parsed.reasoningLevels).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
    expect(parsed.defaultReasoningLevel).toBe('low')
    expect(parsed.supportsReasoningSummary).toBe(true)
    expect(parsed.serviceTiers).toEqual([
      { id: 'priority', name: 'Fast', description: '2x speed, increased usage' },
    ])
    expect(parsed.defaultServiceTier).toBeUndefined()
  })

  it('finds the priority tier behind the Fast switch', () => {
    expect(planFastTier(facts())).toEqual({
      id: 'priority',
      name: 'Fast',
      description: '2x speed, increased usage',
    })
    expect(planFastTier({ ...facts(), serviceTiers: [] })).toBeUndefined()
  })

  it('offers low through max, leaving ultra out of every picker', () => {
    // `ultra` ("Maximum reasoning with automatic task delegation") is not
    // in the app's effort vocabulary, so no surface can honestly offer it.
    expect(planOfferedLevels(facts())).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('defaults to the catalogue default', () => {
    expect(planDefaultEffort(facts())).toBe('low')
  })

  it('sends a listed level as named, never none to this model', () => {
    const parsed = facts()
    expect(resolvePlanEffort(parsed, 'xhigh')).toBe('xhigh')
    expect(resolvePlanEffort(parsed, 'low')).toBe('low')
    expect(resolvePlanEffort(parsed, 'max')).toBe('max')
    expect(resolvePlanEffort(parsed, 'none')).toBe('none')
  })

  it('maps ultra the way the provider client does: multi-agent, else max', () => {
    // The catalogue names no multi-agent effort for this entry, so ultra
    // rides as the highest listed level.
    expect(resolvePlanEffort(facts(), 'ultra')).toBe('max')
    const withMultiAgent: ChatGptPlanFacts = {
      ...facts(),
      multiAgentReasoningEffort: 'high',
    }
    expect(resolvePlanEffort(withMultiAgent, 'ultra')).toBe('high')
  })

  it('falls back to the catalogue default for an unlisted level', () => {
    expect(resolvePlanEffort(facts(), 'minimal')).toBe('low')
  })
})

describe('chatgpt plan policy', () => {
  it('keeps xhigh as xhigh on the plan route', () => {
    const policy = policyFor(facts())
    expect(policy.reasoning.effortLevels).toEqual({
      state: 'yes',
      value: ['low', 'medium', 'high', 'xhigh', 'max'],
    })
    expect(effortForPolicy(policy, 'xhigh')).toBe('xhigh')
    expect(effortForPolicy(policy, 'low')).toBe('low')
    expect(effortForPolicy(policy, 'ultra')).toBe('max')
  })

  it('omits the summary only where the catalogue refuses the parameter', () => {
    expect(policyFor(facts()).reasoning.planFacts?.supportsReasoningSummary).toBe(true)
    const refused = policyFor({ ...facts(), supportsReasoningSummary: false })
    expect(refused.reasoning.planFacts?.supportsReasoningSummary).toBe(false)
  })
})
