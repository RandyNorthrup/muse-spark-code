// Skill announcement dedupe and plan-model refs through the real helpers,
// with data passed in: a plugin's lone skill listed twice reads once,
// distinct skills stay, and only validated plan refs qualify.
import { describe, expect, it } from 'vitest'
import { dedupeSkillSelectors } from '../../src/acp/agent'
import { isPlanModelRef } from '../../src/shared/providerRouting'

const skill = (selector: string, description = 'does things', argumentHint?: string) => ({
  selector,
  displayName: selector,
  description,
  argumentHint,
})

describe('dedupeSkillSelectors', () => {
  it('collapses a bare name with its identically-reading self-qualified pair', () => {
    expect(
      dedupeSkillSelectors([skill('threejs', '3D help'), skill('threejs:threejs', '3D help')]).map(
        (entry) => entry.selector,
      ),
    ).toEqual(['threejs'])
  })
  it('keeps a self-qualified pair that reads differently', () => {
    expect(
      dedupeSkillSelectors([skill('threejs', 'plugin'), skill('threejs:threejs', 'skill')]).map(
        (entry) => entry.selector,
      ),
    ).toEqual(['threejs', 'threejs:threejs'])
  })
  it('announces an exact selector once even when its metadata changed', () => {
    const first = skill('plan', 'original description')
    expect(dedupeSkillSelectors([first, skill('plan', 'updated description')])).toEqual([first])
  })
  it('collapses exact repeats and keeps unrelated selectors', () => {
    expect(
      dedupeSkillSelectors([skill('plan'), skill('plan'), skill('other:skill')]).map(
        (entry) => entry.selector,
      ),
    ).toEqual(['plan', 'other:skill'])
  })
})

describe('isPlanModelRef', () => {
  it.each(['chatgpt/gpt-6.1-sol', 'copilot/gpt-5'])('qualifies %j', (model) => {
    expect(isPlanModelRef(model)).toBe(true)
  })
  it.each(['muse-spark-1.3', 'meta/muse-spark-1.3', 'openai/gpt-x', 'chatgpt', ''])(
    'rejects %j',
    (model) => {
      expect(isPlanModelRef(model)).toBe(false)
    },
  )
})
