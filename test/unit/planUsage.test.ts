import { describe, expect, it } from 'vitest'
import { planUsageSchema, recordPlanUsage } from '../../src/core/providers/subscriptions/planUsage'

function row(providerId: string, requests = 0) {
  return {
    providerId,
    requests,
    reported: { requests: 0, inputTokens: 0, outputTokens: 0 },
    estimated: { requests: 0, inputTokens: 0, outputTokens: 0 },
  }
}

describe('plan usage', () => {
  it('counts a dispatch even when the 200 SSE stream fails and reports no usage', () => {
    const tallies = recordPlanUsage([], { providerId: 'chatgpt' })
    expect(tallies).toEqual([row('chatgpt', 1)])
    expect(Object.keys(tallies[0] ?? {})).not.toContain('costUsd')
  })
  it('keeps reported tokens separate from estimates and counts requests per provider', () => {
    let tallies = recordPlanUsage([], {
      providerId: 'copilot',
      tokens: {
        inputTokens: 100,
        outputTokens: 20,
        source: 'estimated',
      },
    })
    tallies = recordPlanUsage(tallies, {
      providerId: 'chatgpt',
      tokens: {
        inputTokens: 1000,
        outputTokens: 200,
        source: 'reported',
      },
    })
    tallies = recordPlanUsage(tallies, { providerId: 'chatgpt' })
    expect(tallies).toEqual([
      { ...row('chatgpt', 2), reported: { requests: 1, inputTokens: 1000, outputTokens: 200 } },
      { ...row('copilot', 1), estimated: { requests: 1, inputTokens: 100, outputTokens: 20 } },
    ])
    const serialized = JSON.stringify(tallies)
    expect(planUsageSchema.parse(JSON.parse(serialized))).toEqual(tallies)
  })
  it('does not mutate caller-owned rows', () => {
    const original = [row('chatgpt', 1)]
    const copy = structuredClone(original)
    recordPlanUsage(original, {
      providerId: 'chatgpt',
      tokens: {
        inputTokens: 1,
        outputTokens: 2,
        source: 'reported',
      },
    })
    expect(original).toEqual(copy)
  })
  it.each([-1, 0.5, NaN, Infinity])('refuses invalid token count %s', (inputTokens) => {
    expect(() =>
      recordPlanUsage([], {
        providerId: 'chatgpt',
        tokens: {
          inputTokens,
          outputTokens: 0,
          source: 'reported',
        },
      }),
    ).toThrow('plan-usage.invalid-tally')
  })
  it('refuses invalid provider ids, duplicate rows and inconsistent reported requests', () => {
    expect(() => recordPlanUsage([], { providerId: 'meta' })).toThrow()
    expect(() =>
      recordPlanUsage([row('chatgpt'), row('chatgpt')], { providerId: 'chatgpt' }),
    ).toThrow()
    expect(
      planUsageSchema.safeParse([
        {
          ...row('chatgpt'),
          reported: {
            requests: 1,
            inputTokens: 0,
            outputTokens: 0,
          },
        },
      ]).success,
    ).toBe(false)
  })
  it('refuses overflow before returning an invalid tally', () => {
    expect(() =>
      recordPlanUsage([row('chatgpt', Number.MAX_SAFE_INTEGER)], {
        providerId: 'chatgpt',
      }),
    ).toThrow('plan-usage.invalid-tally')
  })
})
