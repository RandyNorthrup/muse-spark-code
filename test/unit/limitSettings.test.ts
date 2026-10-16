// B22/B17 (D115): the two retained bounds no peer harness shares are the
// person's settings. These clamps are pure logic through the real modules:
// garbage falls back to the default, in-range values pass through.
import { describe, expect, it } from 'vitest'
import { judgeTimeoutMs } from '../../src/core/judge/engine'
import { questionMaxOpen } from '../../src/shared/questionDeadline'
import {
  JUDGE_REQUEST_TIMEOUT_MS,
  MILLISECONDS_PER_SECOND,
  OPEN_QUESTIONS_MAX,
} from '../../src/shared/constants'

describe('questionMaxOpen', () => {
  it('keeps the default where no setting is wired', () => {
    expect(questionMaxOpen()).toBe(OPEN_QUESTIONS_MAX)
    expect(questionMaxOpen(undefined)).toBe(OPEN_QUESTIONS_MAX)
  })

  it('passes an in-range choice through', () => {
    expect(questionMaxOpen(2)).toBe(2)
    expect(questionMaxOpen(100)).toBe(100)
  })

  it('clamps below the minimum and above the maximum', () => {
    expect(questionMaxOpen(1)).toBe(2)
    expect(questionMaxOpen(500)).toBe(100)
  })

  it('falls back to the default for garbage', () => {
    expect(questionMaxOpen(NaN)).toBe(OPEN_QUESTIONS_MAX)
    expect(questionMaxOpen('20')).toBe(OPEN_QUESTIONS_MAX)
    expect(questionMaxOpen(null)).toBe(OPEN_QUESTIONS_MAX)
  })
})

describe('judgeTimeoutMs', () => {
  it('keeps the default where no setting is wired', () => {
    expect(judgeTimeoutMs()).toBe(JUDGE_REQUEST_TIMEOUT_MS)
    expect(judgeTimeoutMs(undefined)).toBe(JUDGE_REQUEST_TIMEOUT_MS)
  })

  it('converts the person\u{2019}s seconds to milliseconds', () => {
    expect(judgeTimeoutMs(60)).toBe(60 * MILLISECONDS_PER_SECOND)
    expect(judgeTimeoutMs(10)).toBe(10 * MILLISECONDS_PER_SECOND)
    expect(judgeTimeoutMs(600)).toBe(600 * MILLISECONDS_PER_SECOND)
  })

  it('clamps outside the allowed range', () => {
    expect(judgeTimeoutMs(5)).toBe(10 * MILLISECONDS_PER_SECOND)
    expect(judgeTimeoutMs(3600)).toBe(600 * MILLISECONDS_PER_SECOND)
  })

  it('falls back to the default for garbage', () => {
    expect(judgeTimeoutMs(NaN)).toBe(JUDGE_REQUEST_TIMEOUT_MS)
    expect(judgeTimeoutMs('60')).toBe(JUDGE_REQUEST_TIMEOUT_MS)
    expect(judgeTimeoutMs(null)).toBe(JUDGE_REQUEST_TIMEOUT_MS)
  })
})
