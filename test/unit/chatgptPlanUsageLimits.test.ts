// OPENAI-G28: the plan's x-codex-* limit headers are parsed and carried on
// the tally; a header the plan stops sending is absent, not zero. Pure
// logic through the real module: header records in, tallies out.
import { describe, expect, it } from 'vitest'
import {
  parsePlanLimitHeaders,
  recordPlanUsage,
} from '../../src/core/providers/subscriptions/planUsage'

describe('plan limit headers', () => {
  it('reads both reported windows out of the response headers', () => {
    expect(
      parsePlanLimitHeaders(
        {
          'x-codex-primary-used-percent': '62.5',
          'x-codex-primary-window-minutes': '300',
          'x-codex-primary-reset-after-seconds': '7320',
          'x-codex-secondary-used-percent': '11',
        },
        1000,
      ),
    ).toEqual({
      observedAt: 1000,
      primary: { usedPercent: 62.5, windowMins: 300, resetAfterSecs: 7320 },
      secondary: { usedPercent: 11 },
    })
  })

  it('leaves a missing or non-numeric header absent, never zero', () => {
    expect(parsePlanLimitHeaders({}, 1000)).toBeUndefined()
    expect(parsePlanLimitHeaders({ 'x-codex-primary-used-percent': 'soon' }, 1000)).toBeUndefined()
    expect(
      parsePlanLimitHeaders(
        {
          'X-Codex-Primary-Used-Percent': '150.2',
          'x-codex-primary-reset-after-seconds': '-4',
          'x-ratelimit-remaining-requests': '9',
        },
        1000,
      ),
    ).toEqual({ observedAt: 1000, primary: { usedPercent: 150.2 } })
  })

  it('carries the latest windows on the tally and keeps them past a headerless attempt', () => {
    const limits = {
      observedAt: 1000,
      primary: { usedPercent: 62.5, windowMins: 300, resetAfterSecs: 7320 },
    }
    const tallied = recordPlanUsage([], { providerId: 'chatgpt', limits })
    expect(tallied).toHaveLength(1)
    expect(tallied[0].limits).toEqual(limits)
    const again = recordPlanUsage(tallied, { providerId: 'chatgpt' })
    expect(again[0].requests).toBe(2)
    expect(again[0].limits).toEqual(limits)
  })
})
