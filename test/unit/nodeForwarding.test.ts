// M110a F1: approval asks mint id, digest and expiry; only an answer echoing
// all three is accepted, once, never as Bypass.
import { describe, expect, it } from 'vitest'
import {
  answerForward,
  ForwardingDesk,
  mintForwardRequest,
  type ForwardAnswer,
} from '../../src/core/devices/forwarding'

const DIGEST = 'a'.repeat(64)
const OTHER_DIGEST = 'b'.repeat(64)

function ask() {
  return mintForwardRequest({
    actionDigest: DIGEST,
    nowMono: 1_000_000,
    ttlMs: 60_000,
    nodeName: 'pi',
    workspaceName: 'muse',
    taskName: 'lane-pool-3',
    actionSummary: 'run cargo test in the sandbox',
  })
}

function allow(requestId: string, digest = DIGEST): ForwardAnswer {
  return { requestId, actionDigest: digest, decision: 'allow', asBypass: false }
}

describe('approval forwarding', () => {
  it('an answer echoing id and digest is accepted, and a deny denies', () => {
    const desk = new ForwardingDesk()
    const first = ask()
    const second = ask()
    desk.ask(first)
    desk.ask(second)
    expect(desk.answer(allow(first.requestId), 1_000_001)).toEqual({
      verdict: 'accept',
      decision: 'allow',
    })
    expect(desk.answer({ ...allow(second.requestId), decision: 'deny' }, 1_000_001)).toEqual({
      verdict: 'accept',
      decision: 'deny',
    })
  })
  it('a wrong id, a wrong digest, or no filed ask is a mismatch', () => {
    const desk = new ForwardingDesk()
    const request = ask()
    desk.ask(request)
    expect(desk.answer(allow('no-such-ask'), 1_000_001)).toEqual({ verdict: 'mismatch' })
    expect(desk.answer(allow(request.requestId, OTHER_DIGEST), 1_000_001)).toEqual({
      verdict: 'mismatch',
    })
    expect(
      answerForward(request, allow(request.requestId, OTHER_DIGEST), 1_000_001, new Set()),
    ).toEqual({ verdict: 'mismatch' })
  })
  it('a late answer expires and prunes, on the monotonic clock', () => {
    const desk = new ForwardingDesk()
    const request = ask()
    desk.ask(request)
    expect(desk.answer(allow(request.requestId), 1_060_000)).toEqual({ verdict: 'expired' })
    expect(desk.pendingCount).toBe(1)
    expect(desk.prune(1_060_000)).toBe(1)
    expect(desk.pendingCount).toBe(0)
  })
  it('an ask answers once: the second answer is a replay, and Bypass never lands', () => {
    const desk = new ForwardingDesk()
    const request = ask()
    desk.ask(request)
    expect(desk.answer(allow(request.requestId), 1_000_001).verdict).toBe('accept')
    expect(desk.answer(allow(request.requestId), 1_000_002)).toEqual({ verdict: 'replay' })
    const bypass = ask()
    desk.ask(bypass)
    expect(desk.answer({ ...allow(bypass.requestId), asBypass: true }, 1_000_001)).toEqual({
      verdict: 'bypass-refused',
    })
  })
  it('filing the same ask twice is a caller bug', () => {
    const desk = new ForwardingDesk()
    const request = ask()
    desk.ask(request)
    expect(() => {
      desk.ask(request)
    }).toThrow(/duplicate forward request/)
  })
  it('asks validate: digests are sha-256 hex, names are never empty', () => {
    expect(ask().requestId).not.toBe(ask().requestId)
    expect(() =>
      mintForwardRequest({
        actionDigest: 'not-a-digest',
        nowMono: 0,
        ttlMs: 1,
        nodeName: 'n',
        workspaceName: 'w',
        taskName: 't',
        actionSummary: 's',
      }),
    ).toThrow()
  })
})
