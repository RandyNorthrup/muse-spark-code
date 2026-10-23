// M125 lane H: the smoke verdict. Right counts, nearest-rank p50
// and p95 mirroring the resolver, the smoke bar and the health
// single. runSmoke's asker is 2j-bound, so only the verdict proves
// here; the runner proves with the runtime in real life.
import { describe, expect, it } from 'vitest'
import { smokeVerdict } from '../../src/core/judge/setup/smoke'

describe('setup smoke verdict', () => {
  it('passes ten for ten with exact ranks', () => {
    const results = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((latencyMs) => ({
      correct: true,
      latencyMs,
    }))
    expect(smokeVerdict(results)).toEqual({
      correct: 10,
      total: 10,
      p50Ms: 5,
      p95Ms: 10,
      passed: true,
    })
  })

  it('fails below the bar and passes on it', () => {
    const seven = Array.from({ length: 10 }, (_, index) => ({
      correct: index < 7,
      latencyMs: 100,
    }))
    const failed = smokeVerdict(seven)
    expect(failed.correct).toBe(7)
    expect(failed.passed).toBe(false)
    const eight = Array.from({ length: 10 }, (_, index) => ({
      correct: index < 8,
      latencyMs: 100,
    }))
    expect(smokeVerdict(eight).passed).toBe(true)
  })

  it('judges health over one fixture question', () => {
    expect(smokeVerdict([{ correct: true, latencyMs: 250 }], 1)).toEqual({
      correct: 1,
      total: 1,
      p50Ms: 250,
      p95Ms: 250,
      passed: true,
    })
    expect(smokeVerdict([{ correct: false, latencyMs: 250 }], 1).passed).toBe(false)
  })

  it('leaves no answers unknown, never zero', () => {
    const verdict = smokeVerdict([])
    expect(verdict).toEqual({ correct: 0, total: 0, passed: false })
    expect('p50Ms' in verdict).toBe(false)
    expect('p95Ms' in verdict).toBe(false)
  })
})
