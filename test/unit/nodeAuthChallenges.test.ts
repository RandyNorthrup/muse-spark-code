import { createHmac, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  NODE_CHALLENGE_KEY_BYTES,
  NODE_CHALLENGE_MAX_CHARS,
  NODE_CHALLENGE_TTL_MS,
} from '../../src/shared/constants'
import { nodeChallengeTokenSchema } from '../../src/shared/nodeAuth'
import { NodeChallenges } from '../../src/runtime/node/auth/challenges'

function fixture(key = randomBytes(NODE_CHALLENGE_KEY_BYTES)) {
  let wall = 1000
  let mono = 0
  const clock = { now: () => wall, monotonicMs: () => mono }
  const challenges = new NodeChallenges(clock, 'home.local', 'https://home.local:7443', key)
  return {
    challenges,
    clock,
    key,
    advance: (ms: number) => {
      mono += ms
      wall += ms
    },
    wall: (ms: number) => {
      wall += ms
    },
  }
}

function rewrite(id: string, change: (payload: Record<string, unknown>) => void, key?: Buffer) {
  const bytes = Buffer.from(id, 'base64url')
  // Test-only mutation of our authored token, never an external wire guess.
  const payload: Record<string, unknown> = JSON.parse(
    bytes.subarray(0, -NODE_CHALLENGE_KEY_BYTES).toString(),
  )
  change(payload)
  const body = Buffer.from(JSON.stringify(payload))
  return Buffer.concat([
    body,
    key === undefined
      ? bytes.subarray(-NODE_CHALLENGE_KEY_BYTES)
      : createHmac('sha256', key).update(body).digest(),
  ]).toString('base64url')
}

function changeChallenge(id: string, field: string, value: unknown, key?: Buffer) {
  return rewrite(
    id,
    (payload) => {
      const challenge = payload['challenge']
      if (typeof challenge !== 'object' || challenge === null) throw new Error('missing challenge')
      Object.assign(challenge, { [field]: value })
    },
    key,
  )
}

describe('H04/H05/H09 stateless authenticated one-use challenges', () => {
  it('H09 bounds opaque tokens independently of ids and bearers', () => {
    expect(nodeChallengeTokenSchema.safeParse('a'.repeat(NODE_CHALLENGE_MAX_CHARS)).success).toBe(
      true,
    )
    expect(
      nodeChallengeTokenSchema.safeParse('a'.repeat(NODE_CHALLENGE_MAX_CHARS + 1)).success,
    ).toBe(false)
  })
  it('uses 128-bit random nonces and signs the exact complete token with WebAuthn', () => {
    const { challenges } = fixture()
    const a = challenges.issue('signin')
    const b = challenges.issue('signin')
    expect(a.challenge).toBe(a.id)
    expect(a.challenge).not.toBe(b.challenge)
    const verified = challenges.verify(a.id, 'signin')
    expect(Buffer.from(verified.nonce, 'base64url')).toHaveLength(16)
    expect(verified.challenge).toEqual(a)
    // Verification alone is not consumption: failed proofs retain no nonce.
    expect(challenges.verify(a.id, 'signin').challenge).toEqual(a)
    challenges.consume(verified)
    expect(() => challenges.verify(a.id, 'signin')).toThrow('expired')
  })
  it('refuses wrong purpose without burning an unproved challenge', () => {
    const { challenges } = fixture()
    const a = challenges.issue('enroll', 'a'.repeat(64))
    expect(() => challenges.verify(a.id, 'signin')).toThrow('expired')
    expect(challenges.verify(a.id, 'enroll').setupHash).toBe('a'.repeat(64))
  })
  it.each(['id', 'purpose', 'issuedAt', 'expiresAt', 'origin', 'rpId', 'actionDigest'])(
    'refuses forged %s before proof work',
    (field) => {
      const { challenges } = fixture()
      const a = challenges.stepUp('session-a', 'maker.action', 'a'.repeat(64))
      const forged = changeChallenge(a.id, field, field.endsWith('At') ? 1 : 'forged')
      expect(() => challenges.verify(forged, 'stepUp')).toThrow('Sign in')
      expect(() => challenges.verify(a.id.slice(0, 1), 'stepUp')).toThrow()
      expect(() => challenges.verify(a.id, 'stepUp')).not.toThrow()
    },
  )
  it('refuses expiry at the exact monotonic deadline even after wall rollback', () => {
    const f = fixture()
    const a = f.challenges.issue('signin')
    f.advance(NODE_CHALLENGE_TTL_MS - 1)
    expect(() => f.challenges.verify(a.id, 'signin')).not.toThrow()
    f.advance(1)
    f.wall(-NODE_CHALLENGE_TTL_MS)
    expect(() => f.challenges.verify(a.id, 'signin')).toThrow('expired')
  })
  it('checks wall expiry, future issuance and the exact authenticated lifetime', () => {
    const f = fixture()
    const a = f.challenges.issue('signin')
    f.wall(NODE_CHALLENGE_TTL_MS)
    expect(() => f.challenges.verify(a.id, 'signin')).toThrow('expired')
    f.wall(-NODE_CHALLENGE_TTL_MS - 1)
    expect(() => f.challenges.verify(a.id, 'signin')).toThrow('expired')
    f.wall(1)
    for (const token of [
      changeChallenge(a.id, 'expiresAt', 1000 + NODE_CHALLENGE_TTL_MS - 1, f.key),
      rewrite(
        a.id,
        (p) => {
          p['issuedMono'] = 1
        },
        f.key,
      ),
    ])
      expect(() => f.challenges.verify(token, 'signin')).toThrow('expired')
  })
  it('refuses a correctly authenticated token for another configured RP/origin', () => {
    const f = fixture()
    const a = f.challenges.issue('signin')
    const token = rewrite(
      a.id,
      (payload) => {
        const challenge = payload['challenge']
        if (typeof challenge !== 'object' || challenge === null)
          throw new Error('missing challenge')
        Object.assign(challenge, { rpId: 'other.local', origin: 'https://other.local:7443' })
      },
      f.key,
    )
    expect(() => f.challenges.verify(token, 'signin')).toThrow('expired')
  })
  it('retains no issuance table or failed proofs; prunes only successfully consumed nonces', () => {
    const f = fixture()
    const a = f.challenges.issue('signin')
    for (let index = 0; index < 1000; index++) f.challenges.issue('signin')
    const consumed: unknown = Reflect.get(f.challenges, 'consumed')
    expect(consumed).toBeInstanceOf(Map)
    if (!(consumed instanceof Map)) throw new Error('missing replay set')
    expect(consumed.size).toBe(0)
    expect(Reflect.has(f.challenges, 'pending')).toBe(false)
    const verified = f.challenges.verify(a.id, 'signin')
    f.challenges.consume(verified)
    expect(consumed.size).toBe(1)
    expect(() => {
      f.challenges.consume(verified)
    }).toThrow('expired')
    f.advance(NODE_CHALLENGE_TTL_MS)
    f.challenges.issue('signin')
    expect(consumed.size).toBe(0)
    expect(() => f.challenges.verify(a.id, 'signin')).toThrow('expired')
  })
  it('refuses consumption after asynchronous verification outlasts the challenge', () => {
    const f = fixture()
    const a = f.challenges.issue('signin')
    const verified = f.challenges.verify(a.id, 'signin')
    f.advance(NODE_CHALLENGE_TTL_MS)
    expect(() => {
      f.challenges.consume(verified)
    }).toThrow('expired')
  })
  it('binds exact session/action/digest, isolates nodes and invalidates on lock or restart', () => {
    const f = fixture()
    const a = f.challenges.stepUp('session-a', 'maker.action', 'a'.repeat(64))
    expect(f.challenges.verify(a.id, 'stepUp').challenge).toMatchObject({
      sessionId: 'session-a',
      action: 'maker.action',
      actionDigest: 'a'.repeat(64),
    })
    expect(() => fixture().challenges.verify(a.id, 'stepUp')).toThrow('Sign in')
    const restarted = new NodeChallenges(f.clock, 'home.local', 'https://home.local:7443', f.key)
    expect(() => restarted.verify(a.id, 'stepUp')).toThrow('expired')
    f.challenges.clear()
    expect(() => f.challenges.verify(a.id, 'stepUp')).toThrow('expired')
    expect(
      () => new NodeChallenges(f.clock, 'home.local', 'https://home.local:7443', Buffer.alloc(0)),
    ).toThrow()
  })
})
