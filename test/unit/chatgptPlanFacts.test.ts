// OPENAI-G26: a plan model's numbers come from its own documented record.
// Model figures quote the provider's model pages, each read 2026-10-13:
// gpt-5.3-codex (400,000 context window; 272,000 maximum input; 128,000 max
// output; low, medium, high, xhigh effort) and codex-mini-latest (200,000
// context window; 100,000 max output; no documented effort levels). Pure
// logic through the real modules: slugs and evidence in, policy out.
import { describe, expect, it } from 'vitest'
import { chatGptPlanFactsFor } from '../../src/core/providers/subscriptions/chatgptPlanFacts'
import { effortForPolicy, modelPolicyFor } from '../../src/core/backends/modelapi/modelPolicy'

describe('chatgpt plan model facts', () => {
  it('knows the documented codex windows and effort levels', () => {
    expect(chatGptPlanFactsFor('gpt-5.3-codex')).toEqual({
      contextTokens: 400_000,
      maxInputTokens: 272_000,
      maxOutputTokens: 128_000,
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
    })
    expect(chatGptPlanFactsFor('gpt-5.2-codex')?.contextTokens).toBe(400_000)
    expect(chatGptPlanFactsFor('codex-mini-latest')).toEqual({
      contextTokens: 200_000,
      maxOutputTokens: 100_000,
    })
  })

  it('leaves an unknown slug without facts instead of Meta numbers', () => {
    expect(chatGptPlanFactsFor('gpt-9.9-codex')).toBeUndefined()
  })

  it('sends a documented level as a level once the record carries it', () => {
    const facts = chatGptPlanFactsFor('gpt-5.3-codex')
    const policy = modelPolicyFor('chatgpt/gpt-5.3-codex', {
      capabilities: { toolCalling: true },
      pricing: { kind: 'plan' },
      ...(facts?.effortLevels !== undefined && { effortLevels: facts.effortLevels }),
      ...(facts?.maxOutputTokens !== undefined && { maxOutputTokens: facts.maxOutputTokens }),
    })
    expect(effortForPolicy(policy, 'high')).toBe('high')
    expect(effortForPolicy(policy, 'xhigh')).toBe('xhigh')
    expect(policy.output.maxTokens).toBe(128_000)
  })
})
