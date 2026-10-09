import { describe, expect, it } from 'vitest'
import {
  NODE_CHALLENGE_TTL_MS,
  NODE_CHALLENGE_BACKOFF_MS,
  NODE_SOURCE_CHALLENGES,
  NODE_SIGNIN_CHALLENGES,
  NODE_STEP_UP_CHALLENGES,
} from '../../src/shared/constants'
import { NodeChallenges } from '../../src/runtime/node/auth/challenges'

function fixture() {
  let time = 0
  const clock = { now: () => time, monotonicMs: () => time }
  const challenges = new NodeChallenges(clock, 'home.local', 'https://home.local:7443')
  return {
    challenges,
    advance: (ms: number) => {
      time += ms
    },
  }
}

describe('H04/H05/H09 bounded one-use challenges', () => {
  it('uses cryptographic randomness and consumes each challenge once', () => {
    const { challenges, advance } = fixture()
    const a = challenges.issue('signin', 'source')
    advance(NODE_CHALLENGE_BACKOFF_MS)
    const b = challenges.issue('signin', 'source')
    expect(a.challenge).toHaveLength(43)
    expect(a.challenge).not.toBe(b.challenge)
    expect(challenges.take(a.id, 'signin').challenge).toEqual(a)
    expect(() => challenges.take(a.id, 'signin')).toThrow('expired')
  })
  it('refuses a swapped purpose and burns that challenge', () => {
    const { challenges } = fixture()
    const a = challenges.issue('enroll', 'source', 'a'.repeat(64))
    expect(() => challenges.take(a.id, 'signin')).toThrow('expired')
    expect(() => challenges.take(a.id, 'enroll')).toThrow('expired')
  })
  it('refuses a challenge at its exact five-minute deadline', () => {
    const { challenges, advance } = fixture()
    const a = challenges.issue('signin', 'source')
    advance(NODE_CHALLENGE_TTL_MS)
    expect(() => challenges.take(a.id, 'signin')).toThrow('expired')
  })
  it('H09 backs off successful issuance globally despite rotating sources and ids', () => {
    const { challenges, advance } = fixture()
    const issued = challenges.issue('signin', 'source-a')
    challenges.take(issued.id, 'signin')
    expect(() => challenges.issue('signin', 'source-b')).toThrow('Too many')
    advance(NODE_CHALLENGE_BACKOFF_MS - 1)
    expect(() => challenges.issue('signin', 'source-c')).toThrow('Too many')
    advance(1)
    expect(() => challenges.issue('signin', 'source-d')).not.toThrow()
  })
  it('H09 caps outstanding challenges per source without extending backoff on refusal', () => {
    const { challenges, advance } = fixture()
    const pending = []
    for (let count = 0; count < NODE_SOURCE_CHALLENGES; count++) {
      pending.push(challenges.issue('signin', 'source'))
      advance(NODE_CHALLENGE_BACKOFF_MS)
    }
    expect(() => challenges.issue('signin', 'source')).toThrow('Too many')
    expect(() => challenges.issue('signin', 'different-source')).not.toThrow()
    const first = pending[0]
    if (first === undefined) throw new Error('missing pending challenge')
    expect(challenges.take(first.id, 'signin').challenge).toEqual(first)
    advance(NODE_CHALLENGE_TTL_MS)
    expect(() => challenges.issue('signin', 'source')).not.toThrow()
  })
  it('H04/H09 reserves setup capacity even when anonymous slots are held', () => {
    const { challenges, advance } = fixture()
    for (let count = 0; count < NODE_SIGNIN_CHALLENGES; count++) {
      challenges.issue('signin', `source-${String(count)}`)
      if (count < NODE_SIGNIN_CHALLENGES - 1) advance(NODE_CHALLENGE_BACKOFF_MS)
    }
    const enrollment = challenges.issue('enroll', 'owner', 'a'.repeat(64))
    expect(challenges.take(enrollment.id, 'enroll').setupHash).toBe('a'.repeat(64))
    expect(() => challenges.issue('signin', 'new-source')).toThrow('Too many')
    advance(NODE_CHALLENGE_TTL_MS)
    expect(() => challenges.issue('signin', 'new-source')).not.toThrow()
  })
  it('H09/H19 step-up has independent global backoff and source bounds', () => {
    const { challenges, advance } = fixture()
    const issue = (source: string) =>
      challenges.stepUp('session-a', 'maker.action', 'a'.repeat(64), source)
    issue('source')
    expect(() => issue('different-source')).toThrow('Too many')
    advance(NODE_CHALLENGE_BACKOFF_MS)
    issue('source')
    advance(NODE_CHALLENGE_BACKOFF_MS)
    expect(() => issue('source')).toThrow('Too many')
    expect(() => issue('different-source')).not.toThrow()
  })
  it('H04/H09/H19 caps step-up and enrollment globally with separate reserved slots', () => {
    const { challenges, advance } = fixture()
    for (let count = 0; count < NODE_STEP_UP_CHALLENGES; count++) {
      challenges.stepUp(
        `session-${String(count)}`,
        'maker.action',
        'a'.repeat(64),
        `source-${String(count)}`,
      )
      advance(NODE_CHALLENGE_BACKOFF_MS)
    }
    expect(() =>
      challenges.stepUp('new-session', 'maker.action', 'a'.repeat(64), 'new-source'),
    ).toThrow('Too many')
    for (let count = 0; count < NODE_SOURCE_CHALLENGES; count++)
      challenges.issue('enroll', `owner-${String(count)}`, 'a'.repeat(64))
    expect(() => challenges.issue('enroll', 'new-owner', 'a'.repeat(64))).toThrow('Too many')
  })
  it('binds exact action/session/digest and ends only that session’s challenges', () => {
    const { challenges, advance } = fixture()
    const a = challenges.stepUp('session-a', 'maker.action', 'a'.repeat(64), 'source-a')
    advance(NODE_CHALLENGE_BACKOFF_MS)
    const b = challenges.stepUp('session-b', 'terminal.open', 'b'.repeat(64), 'source-b')
    challenges.end('session-a')
    expect(() => challenges.take(a.id, 'stepUp')).toThrow('expired')
    expect(challenges.take(b.id, 'stepUp').challenge).toMatchObject({
      sessionId: 'session-b',
      action: 'terminal.open',
      actionDigest: 'b'.repeat(64),
    })
  })
  it('invalidates all purposes on lock', () => {
    const { challenges } = fixture()
    const a = challenges.issue('signin', 'source')
    challenges.clear()
    expect(() => challenges.take(a.id, 'signin')).toThrow('expired')
  })
})
