// The Auto reviewer's pure parts (M78, PLAN.md D49): the answer read
// strictly, its input fenced as data, and the circuit breaker.

import { describe, expect, it } from 'vitest'
import {
  parseReviewerAnswer,
  ReviewBreaker,
  reviewerInput,
} from '../../src/core/backends/modelapi/autoReviewer'
import {
  AUTO_REVIEWER_BREAKER_CONSECUTIVE,
  AUTO_REVIEWER_BREAKER_WINDOW,
  AUTO_REVIEWER_BREAKER_WINDOW_LIMIT,
  AUTO_REVIEWER_REASON_MAX_CHARS,
  AUTO_REVIEWER_RECENT_CALL_MAX_CHARS,
  AUTO_REVIEWER_TEXT_MAX_CHARS,
} from '../../src/shared/constants'

describe('parseReviewerAnswer: only ALLOW or ASK with a reason (M78)', () => {
  it.each([
    ['ALLOW: reads files only', { decision: 'allow', reason: 'reads files only' }],
    ['allow - runs the tests', { decision: 'allow', reason: 'runs the tests' }],
    ['  ASK: deletes the build folder', { decision: 'ask', reason: 'deletes the build folder' }],
    [
      '\n\nAsk — pushes to a remote\nALLOW: ignored',
      { decision: 'ask', reason: 'pushes to a remote' },
    ],
  ] as const)('%j', (text, answer) => {
    expect(parseReviewerAnswer(text)).toEqual(answer)
  })

  it.each([
    '',
    'Sure, this looks safe.',
    'ALLOWED: fine',
    'I would ALLOW: this',
    'DENY: no',
    'ALLOW fine',
    'ALLOW:',
    'ASK:   ',
  ])('reads %j as no answer', (text) => {
    expect(parseReviewerAnswer(text)).toBeUndefined()
  })

  it('cuts a long reason', () => {
    const answer = parseReviewerAnswer(`ASK: ${'x'.repeat(AUTO_REVIEWER_REASON_MAX_CHARS * 2)}`)
    expect(answer?.reason).toHaveLength(AUTO_REVIEWER_REASON_MAX_CHARS + 1)
  })
})

describe('reviewerInput: everything the reviewer reads is fenced as data (M78)', () => {
  it('names the request, the turn’s calls and the action, each cut to its limit', () => {
    const input = reviewerInput({
      userRequest: 'run the tests',
      recentCalls: [
        { tool: 'read_file', args: '{"path":"package.json"}' },
        { tool: 'bash', args: 'x'.repeat(AUTO_REVIEWER_RECENT_CALL_MAX_CHARS * 2) },
      ],
      tool: 'bash',
      action: `npm test ${'y'.repeat(AUTO_REVIEWER_TEXT_MAX_CHARS)}`,
      workspaceRoot: '/work',
      platform: 'linux',
    })
    expect(input).toContain('<<<\nrun the tests\n>>>')
    expect(input).toContain('read_file {"path":"package.json"}')
    expect(input).toContain('tool: bash\naction: npm test')
    expect(input).toContain('workspace: /work\nplatform: linux')
    expect(input).not.toContain('y'.repeat(AUTO_REVIEWER_TEXT_MAX_CHARS))
    expect(input).not.toContain('x'.repeat(AUTO_REVIEWER_RECENT_CALL_MAX_CHARS))
  })

  it('says "(none)" where there is nothing', () => {
    const input = reviewerInput({
      userRequest: undefined,
      recentCalls: [],
      tool: 'bash',
      action: 'ls',
      workspaceRoot: '/work',
      platform: 'linux',
    })
    expect(input.match(/\(none\)/g)).toHaveLength(2)
  })
})

describe('ReviewBreaker (M78)', () => {
  it('trips after the declines in a row, once, until the user sends a message', () => {
    const breaker = new ReviewBreaker()
    for (let index = 1; index < AUTO_REVIEWER_BREAKER_CONSECUTIVE; index += 1) {
      expect(breaker.record(false)).toBe(false)
    }
    expect(breaker.record(false)).toBe(true)
    expect(breaker.isTripped).toBe(true)
    expect(breaker.record(false)).toBe(false)
    breaker.reset()
    expect(breaker.isTripped).toBe(false)
  })

  it('does not trip while allows come between the declines, until the window holds too many', () => {
    const breaker = new ReviewBreaker()
    let trippedAt = 0
    for (let review = 1; review <= AUTO_REVIEWER_BREAKER_WINDOW; review += 1) {
      // Two declines, then an allow: never three in a row.
      if (breaker.record(review % 3 === 0)) {
        trippedAt = review
        break
      }
    }
    const declinesBeforeTrip = trippedAt - Math.floor(trippedAt / 3)
    expect(trippedAt).toBeGreaterThan(0)
    expect(declinesBeforeTrip).toBe(AUTO_REVIEWER_BREAKER_WINDOW_LIMIT)
  })

  it('forgets declines older than the window', () => {
    const breaker = new ReviewBreaker()
    for (let index = 0; index < AUTO_REVIEWER_BREAKER_WINDOW_LIMIT - 1; index += 1) {
      breaker.record(false)
      breaker.record(true)
    }
    for (let index = 0; index < AUTO_REVIEWER_BREAKER_WINDOW; index += 1) {
      breaker.record(true)
    }
    expect(breaker.record(false)).toBe(false)
    expect(breaker.isTripped).toBe(false)
  })
})
