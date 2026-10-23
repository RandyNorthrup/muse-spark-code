import { describe, expect, it } from 'vitest'
import { LintCache, type LintIdentity, type LintDecision } from '../../src/core/judge/lint/cache'
import type { JudgeRequest } from '../../src/core/judge/schema'

const request: JudgeRequest = {
  state: 'source-content-sentinel',
  questions: {
    rule: { type: 'choice', instructions: 'criteria-sentinel', criteria: { A: 'pass', B: 'fail' } },
  },
}
const identity: LintIdentity = {
  endpoint: 'https://example.invalid/systemone',
  model: 'fixture-model',
  source: 'same',
  profile: 'fixture-profile',
  criteriaVersion: 'criteria-1',
  credentialFingerprint: 'opaque-credential-fingerprint',
  provenance: 'independent',
}
const decisions = [{ outcome: 'fail', confidence: 0.9 }] as const

describe('source-free lint cache', () => {
  it('stores only hashed identity and bounded outcome primitives', () => {
    const cache = new LintCache(2)
    cache.put(request, identity, decisions)
    const serialized = JSON.stringify(cache)
    for (const content of [request.state, 'criteria-sentinel', ...Object.values(identity)]) {
      expect(serialized).not.toContain(content)
    }
    expect(cache.toJSON()[0]?.digest).toMatch(/^[a-f\d]{64}$/)
    expect(cache.get(request, identity)).toEqual(decisions)
  })

  it.each([
    { endpoint: 'https://elsewhere.invalid/systemone' },
    { model: 'different-model' },
    { source: 'separate' },
    { profile: 'profile-2' },
    { criteriaVersion: 'criteria-2' },
    { credentialFingerprint: 'different-fingerprint' },
    { provenance: 'experimental-systemone' },
  ] satisfies Partial<LintIdentity>[])('invalidates a changed identity %#', (change) => {
    const cache = new LintCache(2)
    cache.put(request, identity, decisions)
    expect(cache.get(request, { ...identity, ...change })).toBeUndefined()
  })

  it('invalidates source, options and question ordering byte changes', () => {
    const cache = new LintCache(2)
    cache.put(request, identity, decisions)
    expect(cache.get({ ...request, state: 'new-source' }, identity)).toBeUndefined()
    expect(
      cache.get(
        {
          ...request,
          questions: {
            rule: { type: 'choice', instructions: 'changed', criteria: { B: 'fail', A: 'pass' } },
          },
        },
        identity,
      ),
    ).toBeUndefined()
  })

  it('does not retain mutable references supplied or returned by the caller', () => {
    const cache = new LintCache(2)
    const input: LintDecision[] = [{ outcome: 'fail', confidence: 0.9 }]
    cache.put(request, identity, input)
    input[0]!.confidence = 0.1
    const first = cache.get(request, identity)
    first![0]!.confidence = 0.2
    const exported = cache.toJSON()
    exported[0]!.decisions[0]!.confidence = 0.3
    expect(cache.get(request, identity)).toEqual(decisions)
  })

  it('evicts the oldest entry at its injected capacity', () => {
    const cache = new LintCache(1)
    cache.put(request, identity, decisions)
    cache.put({ ...request, state: 'second' }, identity, decisions)
    expect(cache.get(request, identity)).toBeUndefined()
    expect(cache.get({ ...request, state: 'second' }, identity)).toEqual(decisions)
  })

  it.each([0, -1, 1.5, NaN, Infinity])('rejects capacity %s', (capacity) => {
    expect(() => new LintCache(capacity)).toThrow('lint-cache-invalid-capacity')
  })

  it('rejects wire extras and a mismatched answer count instead of caching content', () => {
    const cache = new LintCache(2)
    const extras = [{ ...decisions[0], source: 'leaked-source' }]
    expect(() => {
      cache.put(request, identity, extras)
    }).toThrow()
    expect(() => {
      cache.put(request, identity, [])
    }).toThrow('lint-cache-answer-count')
    expect(cache.toJSON()).toEqual([])
  })

  it.each([-1, 1.1, NaN, Infinity])('rejects invalid cached confidence %s', (confidence) => {
    const cache = new LintCache(2)
    expect(() => {
      cache.put(request, identity, [{ outcome: 'fail', confidence }])
    }).toThrow()
    expect(cache.toJSON()).toEqual([])
  })
})
