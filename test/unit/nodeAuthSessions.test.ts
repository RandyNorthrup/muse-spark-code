import { afterEach, describe, expect, it } from 'vitest'
import {
  NODE_SESSION_IDLE_MS,
  NODE_SESSION_MAX_MS,
  NODE_STEP_UP_TTL_MS,
  NODE_MAX_SESSIONS,
  NODE_MAX_CHALLENGES,
} from '../../src/shared/constants'
import { NodeMemorySessions } from '../../src/runtime/node/auth/sessions'
import { recordCalls } from './helpers/recordCalls'

const signal = new AbortController().signal
const digest = 'a'.repeat(64)
const time = { now: 1000, monotonic: 0 }
const attachedCalls = recordCalls<[]>()
const endedCalls = recordCalls<[string]>()
const lifecycle = { attached: attachedCalls.fn, ended: endedCalls.fn }
const sessions = new NodeMemorySessions(
  { now: () => time.now, monotonicMs: () => time.monotonic },
  'owner',
  lifecycle,
)
afterEach(() => {
  sessions.endAll()
  time.now = 1000
  time.monotonic = 0
  attachedCalls.calls.length = 0
  endedCalls.calls.length = 0
})

describe('H06/H08 memory capabilities', () => {
  it('authenticates a random bearer, never a public ID, and detaches on signout', async () => {
    const s = sessions.create()
    expect(s.bearer).toMatch(/^[\w-]{43}$/u)
    expect(JSON.stringify(s.session)).not.toContain(s.bearer)
    const verified = await sessions.verifyBearer(s.bearer, signal)
    expect(verified.id).toBe(s.session.id)
    expect(() => sessions.verifyBearer(s.session.id, signal)).toThrow()
    await expect(sessions.verifyBearer('z'.repeat(43), signal)).rejects.toThrow()
    const cancellation = sessions.sessionSignal(s.session.id)
    sessions.end(s.session.id)
    expect(cancellation.aborted).toBe(true)
    expect(endedCalls.calls).toContainEqual([s.session.id])
    await expect(sessions.verifyBearer(s.bearer, signal)).rejects.toThrow()
  })
  it('expires at the exact idle boundary despite wall-clock rollback', () => {
    const s = sessions.create()
    const cancellation = sessions.sessionSignal(s.session.id)
    time.now = 0
    time.monotonic = NODE_SESSION_IDLE_MS
    expect(() => sessions.verifyBearer(s.bearer, signal)).toThrow('expired')
    expect(cancellation.aborted).toBe(true)
    expect(endedCalls.calls).toHaveLength(1)
  })
  it('activity refreshes idle time but never the absolute deadline', async () => {
    const s = sessions.create()
    for (let tick = 1; tick < NODE_SESSION_MAX_MS / (NODE_SESSION_IDLE_MS / 2); tick++) {
      time.monotonic += NODE_SESSION_IDLE_MS / 2
      time.now += NODE_SESSION_IDLE_MS / 2
      const verified = await sessions.verifyBearer(s.bearer, signal)
      expect(verified.absoluteExpiresAt).toBe(s.session.absoluteExpiresAt)
    }
    time.monotonic = NODE_SESSION_MAX_MS
    expect(() => sessions.verifyBearer(s.bearer, signal)).toThrow('expired')
  })
  it('refuses aborted requests and closed lifecycle attachments', () => {
    const s = sessions.create()
    const aborted = AbortSignal.abort()
    expect(() => sessions.verifyBearer(s.bearer, aborted)).toThrow()
    const attached = lifecycle.attached
    lifecycle.attached = () => {
      throw new Error('locked')
    }
    try {
      expect(() => sessions.create()).toThrow('locked')
    } finally {
      lifecycle.attached = attached
    }
    expect(endedCalls.calls).toHaveLength(1)
  })
  it('aborts all sessions even when one detach callback fails', () => {
    const first = sessions.create()
    const second = sessions.create()
    const signals = [
      sessions.sessionSignal(first.session.id),
      sessions.sessionSignal(second.session.id),
    ]
    const ended = lifecycle.ended
    lifecycle.ended = () => {
      throw new Error('detach failed')
    }
    try {
      expect(() => {
        sessions.endAll()
      }).toThrow('unavailable')
    } finally {
      lifecycle.ended = ended
    }
    expect(signals.every((item) => item.aborted)).toBe(true)
  })
  it('bounds simultaneous sessions and releases expired slots', () => {
    for (let index = 0; index < NODE_MAX_SESSIONS; index++) sessions.create()
    expect(() => sessions.create()).toThrow('Too many')
    time.monotonic = NODE_SESSION_IDLE_MS
    expect(() => sessions.create()).not.toThrow()
  })
})

describe('H08/H19 one UV proof per exact physical action', () => {
  it('does not extend fresh UV through slow persistence or accept future verification', () => {
    const session = sessions.create()
    time.monotonic = NODE_STEP_UP_TTL_MS
    expect(() =>
      sessions.issueProof(session.session.id, 'maker.action', digest, {
        time: 1000,
        monotonicMs: 0,
      }),
    ).toThrow('expired')
    expect(() =>
      sessions.issueProof(session.session.id, 'maker.action', digest, {
        time: 1000,
        monotonicMs: time.monotonic + 1,
      }),
    ).toThrow('expired')
  })
  it.each(['action', 'actionDigest', 'sessionId'] as const)(
    'refuses a changed %s and burns the proof',
    async (field) => {
      const s = sessions.create()
      const other = sessions.create()
      const proof = sessions.issueProof(s.session.id, 'maker.action', digest)
      const binding = proof
      const changed = { ...binding }
      if (field === 'action') changed.action = 'terminal.open'
      else if (field === 'sessionId') changed.sessionId = other.session.id
      else changed.actionDigest = 'b'.repeat(64)
      await expect(sessions.consumeStepUp(changed, signal)).rejects.toThrow()
      await expect(sessions.consumeStepUp(binding, signal)).rejects.toThrow()
    },
  )
  it('atomically consumes one proof, rejecting concurrent reuse', async () => {
    const s = sessions.create()
    const proof = sessions.issueProof(s.session.id, 'maker.action', digest)
    const binding = proof
    const settled = await Promise.allSettled([
      sessions.consumeStepUp(binding, signal),
      sessions.consumeStepUp(binding, signal),
    ])
    expect(settled.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
  })
  it('expires at five minutes on the time.monotonic clock and drops on lock', async () => {
    const s = sessions.create()
    const proof = sessions.issueProof(s.session.id, 'maker.action', digest)
    time.monotonic = NODE_STEP_UP_TTL_MS
    time.now = 0
    await expect(
      sessions.consumeStepUp(
        { sessionId: s.session.id, id: proof.id, action: proof.action, actionDigest: digest },
        signal,
      ),
    ).rejects.toThrow()
    const cancellation = sessions.sessionSignal(s.session.id)
    sessions.endAll()
    expect(cancellation.aborted).toBe(true)
  })
  it('caps pending proofs before allocation', () => {
    const s = sessions.create()
    for (let index = 0; index < NODE_MAX_CHALLENGES; index++)
      sessions.issueProof(s.session.id, 'maker.action', digest)
    expect(() => sessions.issueProof(s.session.id, 'maker.action', digest)).toThrow('Too many')
  })
})
