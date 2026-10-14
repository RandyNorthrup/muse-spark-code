// Skill announcement dedupe through the real helper, with data passed in:
// a plugin's lone skill listed twice reads once, distinct skills stay.
import { describe, expect, it } from 'vitest'
import { dedupeSkillSelectors } from '../../src/acp/agent'

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
  it('collapses exact repeats and keeps unrelated selectors', () => {
    expect(
      dedupeSkillSelectors([skill('plan'), skill('plan'), skill('other:skill')]).map(
        (entry) => entry.selector,
      ),
    ).toEqual(['plan', 'other:skill'])
  })
})
