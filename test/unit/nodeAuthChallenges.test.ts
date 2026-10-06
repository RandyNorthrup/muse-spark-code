import { describe, expect, it } from 'vitest'
import { NODE_CHALLENGE_TTL_MS, NODE_MAX_CHALLENGES } from '../../src/shared/constants'
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
    const { challenges } = fixture()
    const a = challenges.issue('signin')
    const b = challenges.issue('signin')
    expect(a.challenge).toHaveLength(43)
    expect(a.challenge).not.toBe(b.challenge)
    expect(challenges.take(a.id, 'signin').challenge).toEqual(a)
    expect(() => challenges.take(a.id, 'signin')).toThrow('expired')
  })
  it('refuses a swapped purpose and burns that challenge', () => {
    const { challenges } = fixture()
    const a = challenges.issue('enroll', 'a'.repeat(64))
    expect(() => challenges.take(a.id, 'signin')).toThrow('expired')
    expect(() => challenges.take(a.id, 'enroll')).toThrow('expired')
  })
  it('refuses a challenge at its exact five-minute deadline', () => {
    const { challenges, advance } = fixture()
    const a = challenges.issue('signin')
    advance(NODE_CHALLENGE_TTL_MS)
    expect(() => challenges.take(a.id, 'signin')).toThrow('expired')
  })
  it('rejects before allocation at the cap and prunes expired slots', () => {
    const { challenges, advance } = fixture()
    for (let count = 0; count < NODE_MAX_CHALLENGES; count++) challenges.issue('signin')
    expect(() => challenges.issue('signin')).toThrow('Too many')
    advance(NODE_CHALLENGE_TTL_MS)
    expect(() => challenges.issue('signin')).not.toThrow()
  })
  it('binds exact action/session/digest and ends only that session’s challenges', () => {
    const { challenges } = fixture()
    const a = challenges.stepUp('session-a', 'maker.action', 'a'.repeat(64))
    const b = challenges.stepUp('session-b', 'terminal.open', 'b'.repeat(64))
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
    const a = challenges.issue('signin')
    challenges.clear()
    expect(() => challenges.take(a.id, 'signin')).toThrow('expired')
  })
})
