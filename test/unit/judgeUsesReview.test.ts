import { afterEach, describe, expect, it, vi } from 'vitest'
import { isReviewableApproval } from '../../src/core/agent/approvalRules'
import { ReviewBreaker } from '../../src/core/backends/modelapi/autoReviewer'
import { mapNotification } from '../../src/core/backends/musecode/mapNotification'
import type { JudgeRuntime } from '../../src/core/judge/engine'
import type { JudgeOutcome } from '../../src/core/judge/schema'
import type { JudgeAdvisory, JudgeFence } from '../../src/core/judge/use'
import { JudgeUses } from '../../src/host/judge/uses'
import {
  ReviewedApprovals,
  type ReviewHold,
  type ReviewOne,
} from '../../src/host/review/reviewedApprovals'
import type { MuseCodeReviewOutcome } from '../../src/host/review/museCodeReviewer'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { FakeAgentHost, FakeAgentSession } from './helpers/fakeAgent'
import { FakeLogOutputChannel } from './helpers/fakes'
import { raceUpdated } from './helpers/stageRaceCapture'
import { capturedApproval } from './helpers/judgeApprovalFixtures'
import { useAction, useAnswer, useOutput, usePolicy, useQuestion } from './helpers/judgeUsesFixture'

type Approval = Extract<AgentEvent, { type: 'approvalRequested' }>

/** M90's named live capture; no new MSP field or shape invented here. */
function approval(): Approval {
  return capturedApproval()
}

/** Synthetic internal network subjects reuse M90's captured approval envelope. */
function identicalNetworkApprovals(event: Approval): readonly [Approval, Approval] {
  const first: Approval = {
    ...event,
    toolName: 'network',
    rawArgs: '{"host":"example.com"}',
    subject: { kind: 'network', host: 'example.com' },
  }
  return [
    first,
    {
      ...first,
      approvalId: 'other-approval',
      itemId: 'other-item',
      requirementId: { ...first.requirementId, approvalId: 'other-approval' },
    },
  ]
}

function deferred<T>() {
  return Promise.withResolvers<T>()
}

const allow: MuseCodeReviewOutcome = {
  decision: 'allow',
  reason: 'independent reviewer reason',
  hasTripped: false,
}
const ask: MuseCodeReviewOutcome = {
  decision: 'ask',
  cause: 'declined',
  reason: 'independent ask',
  hasTripped: false,
}

function setup(advisory?: JudgeAdvisory) {
  const session = new FakeAgentSession('s1', 'fixture-model')
  const host = new FakeAgentHost()
  const judge = deferred<JudgeOutcome>()
  const review = deferred<MuseCodeReviewOutcome>()
  const runtime = { judge: vi.fn<JudgeRuntime['judge']>(() => judge.promise) }
  let policy = usePolicy()
  let binding = {}
  const uses = new JudgeUses({
    runtime,
    policy: () => policy,
    binding: () => binding,
    question: () => useQuestion('review-signal'),
    redact: (text) => text.replaceAll('fixture-secret', '<redacted>'),
  })
  const cards = vi.fn<(event: Approval, note: string | undefined) => void>()
  const reviewOne = vi.fn<ReviewOne>(() => review.promise)
  const approvals = new ReviewedApprovals(
    {
      judgeUses: uses,
      judge: advisory,
      showCard: cards,
      notice: vi.fn(),
      mayAllow: () => true,
      log: new FakeLogOutputChannel(),
      describeFailure: () => 'fixture failure',
    },
    new ReviewBreaker(),
    reviewOne,
    () => false,
  )
  const hold: ReviewHold = {
    session,
    host: () => Promise.resolve(host),
    modelId: session.modelId,
    request: {
      userRequest: 'fixture-secret',
      recentCalls: [],
      tool: 'shell',
      action: 'fixture action',
      workspaceRoot: '/fixture',
      platform: 'darwin',
    },
  }
  const event = approval()
  return {
    session,
    judge,
    review,
    runtime,
    cards,
    approvals,
    hold,
    event,
    uses,
    reviewOne,
    policy: () => policy,
    changePolicy: (next: typeof policy) => {
      policy = next
    },
    replaceBinding: () => {
      binding = {}
    },
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('independent reviewer and synchronous caution fence', () => {
  it.each(['caution', 'none'] as const)(
    'reads both independent holders when the shipped phase-1 fence returns %s',
    async (outcome) => {
      const fence: JudgeFence = { read: vi.fn(() => outcome), card: vi.fn(), discard: vi.fn() }
      const advisory: JudgeAdvisory = {
        start: vi.fn(() => fence),
        discardTurn: vi.fn(),
        discardSession: vi.fn(),
      }
      const t = setup(advisory)
      t.approvals.hold(t.event, t.hold)
      t.judge.resolve(useOutput(t.policy(), undefined, {}, 'review'))
      await flush()
      t.review.resolve(allow)
      await flush()
      expect(fence.read).toHaveBeenCalledOnce()
      expect(t.runtime.judge.mock.calls[0]?.[1].aborted).toBe(true)
      expect(t.cards).toHaveBeenCalledExactlyOnceWith(
        outcome === 'caution' ? { ...t.event, judgeCaution: true } : t.event,
        undefined,
      )
      expect(t.session.decideApproval).not.toHaveBeenCalled()
    },
  )

  it('refuses aborted, wrong-use and oversized inputs before a source call', () => {
    const t = setup()
    const stop = new AbortController()
    stop.abort()
    expect(
      t.uses.startReview({ action: useAction(), state: t.hold.request }, stop.signal),
    ).toBeUndefined()
    t.changePolicy(usePolicy('skill-suggestion'))
    expect(
      t.uses.startReview(
        { action: useAction(), state: t.hold.request },
        new AbortController().signal,
      ),
    ).toBeUndefined()
    t.changePolicy(usePolicy())
    expect(
      t.uses.startReview(
        { action: useAction(), state: { ...t.hold.request, action: 'x'.repeat(70_000) } },
        new AbortController().signal,
      ),
    ).toBeUndefined()
    expect(t.runtime.judge).not.toHaveBeenCalled()
  })

  it('a ready caution returns ALLOW to the normal card without changing the reviewer input', async () => {
    const t = setup()
    t.approvals.hold(t.event, t.hold)
    expect(t.cards).not.toHaveBeenCalled()
    expect(t.runtime.judge).toHaveBeenCalledOnce()
    expect(t.runtime.judge.mock.calls[0]?.[0].state).not.toContain('fixture-secret')
    t.judge.resolve(useOutput(t.policy(), undefined, {}, 'review'))
    await flush()
    t.review.resolve(allow)
    await flush()
    expect(t.cards).toHaveBeenCalledExactlyOnceWith(t.event, undefined)
    expect(t.session.decideApproval).not.toHaveBeenCalled()
    expect(t.reviewOne.mock.calls[0]?.[0]).toMatchObject({ request: t.hold.request })
  })

  it('identical actions share one dispatch with independent abort and latch lifetimes', async () => {
    for (const exit of ['abort-pending', 'discard-ready', 'read-ready', 'join-ready'] as const) {
      const t = setup()
      const firstStop = new AbortController()
      const lastStop = new AbortController()
      const input = { action: useAction(), state: t.hold.request }
      const first = t.uses.startReview(input, firstStop.signal)
      if (exit === 'join-ready') {
        t.judge.resolve(useOutput(t.policy(), undefined, {}, 'review'))
        await flush()
      }
      const last = t.uses.startReview(input, lastStop.signal)
      expect(first).toBeDefined()
      expect(last).toBeDefined()
      if (exit === 'abort-pending') {
        firstStop.abort()
      }
      t.judge.resolve(useOutput(t.policy(), undefined, {}, 'review'))
      await flush()
      if (exit === 'read-ready') {
        expect(first?.read()).toBe(true)
      }
      first?.discard()
      first?.discard()
      firstStop.abort()
      expect(first?.read()).toBe(false)
      expect(t.runtime.judge.mock.calls[0]?.[1].aborted).toBe(false)
      expect(last?.read()).toBe(true)
      expect(last?.read()).toBe(false)
      expect(t.runtime.judge).toHaveBeenCalledOnce()
      expect(t.runtime.judge.mock.calls[0]?.[1].aborted).toBe(true)
    }
  })

  it('resolving one of two identical reviewable approvals preserves the other caution card', async () => {
    const t = setup()
    const [first, other] = identicalNetworkApprovals(t.event)
    expect(isReviewableApproval(first, 'auto', 't1')).toBe(true)
    expect(isReviewableApproval(other, 'auto', 't1')).toBe(true)
    t.approvals.hold(first, t.hold)
    t.approvals.hold(other, t.hold)
    t.judge.resolve(useOutput(t.policy(), undefined, {}, 'review'))
    await flush()
    t.approvals.resolved({
      type: 'approvalResolved',
      approvalId: first.approvalId,
      itemId: first.itemId,
      decision: 'denied',
      resolvedBy: 'user',
    })
    t.review.resolve(allow)
    await flush()
    expect(t.cards).toHaveBeenCalledExactlyOnceWith(other, undefined)
    expect(t.session.decideApproval).not.toHaveBeenCalled()
    expect(t.runtime.judge).toHaveBeenCalledOnce()
  })

  it('a pending shared call survives the first reviewer fence without delaying it', async () => {
    const t = setup()
    const [first, other] = identicalNetworkApprovals(t.event)
    const firstReview = deferred<MuseCodeReviewOutcome>()
    t.reviewOne.mockReturnValueOnce(firstReview.promise)
    t.approvals.hold(first, t.hold)
    t.approvals.hold(other, t.hold)
    await flush()
    firstReview.resolve(allow)
    await flush()
    expect(t.session.decideApproval).toHaveBeenCalledOnce()
    expect(t.cards).not.toHaveBeenCalled()
    expect(t.runtime.judge.mock.calls[0]?.[1].aborted).toBe(false)
    t.judge.resolve(useOutput(t.policy(), undefined, {}, 'review'))
    await flush()
    t.review.resolve(allow)
    await flush()
    expect(t.cards).toHaveBeenCalledExactlyOnceWith(other, undefined)
    expect(t.session.decideApproval).toHaveBeenCalledOnce()
    expect(t.runtime.judge).toHaveBeenCalledOnce()
  })

  it('only the last shared holder cancels, and stale holders cannot consume a rebound entry', async () => {
    for (const change of ['abort', 'binding'] as const) {
      const t = setup()
      const input = { action: useAction(), state: t.hold.request }
      const first = t.uses.startReview(input, new AbortController().signal)
      const lastStop = new AbortController()
      const last = t.uses.startReview(input, lastStop.signal)
      first?.discard()
      expect(t.runtime.judge.mock.calls[0]?.[1].aborted).toBe(false)
      if (change === 'abort') {
        lastStop.abort()
        expect(t.runtime.judge.mock.calls[0]?.[1].aborted).toBe(true)
      } else {
        t.replaceBinding()
      }
      const nextResult = deferred<JudgeOutcome>()
      t.runtime.judge.mockReturnValueOnce(nextResult.promise)
      const next = t.uses.startReview(input, new AbortController().signal)
      expect(t.runtime.judge.mock.calls[0]?.[1].aborted).toBe(true)
      last?.discard()
      lastStop.abort()
      t.judge.resolve(useOutput(t.policy(), undefined, {}, 'review'))
      await flush()
      const joined = t.uses.startReview(input, new AbortController().signal)
      nextResult.resolve(useOutput(t.policy(), undefined, {}, 'review'))
      await flush()
      expect(last?.read()).toBe(false)
      expect(next?.read()).toBe(true)
      expect(joined?.read()).toBe(true)
      expect(t.runtime.judge).toHaveBeenCalledTimes(2)
    }
  })

  it('a fast reviewer never waits for a delayed judge and drops its late answer', async () => {
    const t = setup()
    t.approvals.hold(t.event, t.hold)
    t.review.resolve(allow)
    await flush()
    expect(t.session.decideApproval).toHaveBeenCalledOnce()
    expect(t.runtime.judge.mock.calls[0]?.[1].aborted).toBe(true)
    t.judge.resolve(useOutput(t.policy(), undefined, {}, 'review'))
    await flush()
    expect(t.cards).not.toHaveBeenCalled()
    expect(t.session.decideApproval).toHaveBeenCalledOnce()
  })

  it('a safe or failed judge leaves the reviewer ALLOW unchanged', async () => {
    for (const kind of ['safe', 'failed'] as const) {
      const t = setup()
      t.approvals.hold(t.event, t.hold)
      if (kind === 'failed') {
        t.judge.reject(new Error('fixture failure'))
      } else {
        t.judge.resolve(useOutput(t.policy(), useAnswer('review-signal', 0), {}, 'review'))
      }
      await flush()
      t.review.resolve(allow)
      await flush()
      expect(t.session.decideApproval).toHaveBeenCalledOnce()
      expect(t.cards).not.toHaveBeenCalled()
    }
  })

  it('a throwing start seam cannot prevent the independent reviewer from answering', async () => {
    const t = setup()
    vi.spyOn(t.uses, 'startReview').mockImplementation(() => {
      throw new Error('fixture failure')
    })
    t.approvals.hold(t.event, t.hold)
    t.review.resolve(allow)
    await flush()
    expect(t.session.decideApproval).toHaveBeenCalledOnce()
    expect(t.runtime.judge).not.toHaveBeenCalled()
  })

  it('replacement holds explicitly discard the prior caution latch', async () => {
    const t = setup()
    const read = vi.fn(() => false)
    const discard = vi.fn()
    vi.spyOn(t.uses, 'startReview').mockReturnValue({ read, discard })
    t.approvals.hold(t.event, t.hold)
    t.approvals.hold(t.event, t.hold)
    expect(discard).toHaveBeenCalledOnce()
    t.review.resolve(allow)
    await flush()
    expect(read).toHaveBeenCalledOnce()
    expect(t.session.decideApproval).toHaveBeenCalledOnce()
  })

  it('a failed latch read cannot prevent the reviewer from answering', async () => {
    const t = setup()
    const discard = vi.fn()
    vi.spyOn(t.uses, 'startReview').mockReturnValue({
      read: () => {
        throw new Error('fixture failure')
      },
      discard,
    })
    t.approvals.hold(t.event, t.hold)
    t.review.resolve(allow)
    await flush()
    expect(discard).toHaveBeenCalledOnce()
    expect(t.session.decideApproval).toHaveBeenCalledOnce()
  })

  it('a failed policy read discards a ready latch as no opinion', async () => {
    const runtime = {
      judge: vi.fn<JudgeRuntime['judge']>(() =>
        Promise.resolve(useOutput(usePolicy(), undefined, {}, 'review')),
      ),
    }
    const policy = vi.fn(() => usePolicy())
    const binding = {}
    const uses = new JudgeUses({
      runtime,
      policy,
      binding: () => binding,
      question: () => useQuestion('review-signal'),
      redact: (text) => text,
    })
    const t = setup()
    const latch = uses.startReview(
      { action: useAction(), state: t.hold.request },
      new AbortController().signal,
    )
    await flush()
    policy.mockImplementation(() => {
      throw new Error('fixture failure')
    })
    expect(latch?.read()).toBe(false)
    expect(runtime.judge.mock.calls[0]?.[1].aborted).toBe(true)
  })

  it('every lifecycle exit explicitly discards an injected latch', () => {
    for (const exit of ['resolved', 'release', 'forget', 'subject'] as const) {
      const t = setup()
      const discard = vi.fn()
      vi.spyOn(t.uses, 'startReview').mockReturnValue({ read: () => false, discard })
      t.approvals.hold(t.event, t.hold)
      if (exit === 'resolved') {
        t.approvals.resolved({
          type: 'approvalResolved',
          approvalId: t.event.approvalId,
          itemId: t.event.itemId,
          decision: 'denied',
          resolvedBy: 'user',
        })
      } else if (exit === 'subject') {
        t.approvals.updated({
          type: 'approvalUpdated',
          approvalId: t.event.approvalId,
          requirementId: t.event.requirementId,
          availableChoices: t.event.availableChoices,
          subject: { ...t.event.subject, command: 'changed' },
        })
      } else {
        t.approvals[exit]()
      }
      expect(discard).toHaveBeenCalledOnce()
      t.approvals.forget()
    }
  })

  it.each(['safe', 'unsure', 'failed', 'malformed', 'ask-caution'] as const)(
    '%s cannot grant or bypass the independent reviewer',
    async (kind) => {
      const t = setup()
      t.approvals.hold(t.event, t.hold)
      if (kind === 'failed') {
        t.judge.reject(new Error('fixture failure'))
      } else if (kind === 'malformed') {
        t.judge.resolve({ outcome: 'no-answer', reason: 'engine-failure' })
      } else {
        t.judge.resolve(
          useOutput(
            t.policy(),
            useAnswer('review-signal', { safe: 0, unsure: 0.5, 'ask-caution': 0.99 }[kind]),
            {},
            'review',
          ),
        )
      }
      await flush()
      t.review.resolve(ask)
      await flush()
      expect(t.session.decideApproval).not.toHaveBeenCalled()
      expect(t.cards).toHaveBeenCalledOnce()
      expect(t.cards.mock.calls[0]?.[1]).toContain('independent ask')
    },
  )

  it('missing adoption evidence or off mode dispatches nothing and leaves ALLOW unchanged', async () => {
    for (const patch of [{ evidence: undefined }, { isOn: false }]) {
      const t = setup()
      t.changePolicy({ ...t.policy(), ...patch })
      t.approvals.hold(t.event, t.hold)
      t.review.resolve(allow)
      await flush()
      expect(t.runtime.judge).not.toHaveBeenCalled()
      expect(t.session.decideApproval).toHaveBeenCalledOnce()
      expect(t.cards).not.toHaveBeenCalled()
    }
  })

  it('cancellation, release, reset, forget and subject replacement discard held results', async () => {
    for (const action of ['resolved', 'release', 'reset', 'forget', 'subject'] as const) {
      const t = setup()
      t.approvals.hold(t.event, t.hold)
      if (action === 'resolved') {
        t.approvals.resolved({
          type: 'approvalResolved',
          approvalId: t.event.approvalId,
          itemId: t.event.itemId,
          decision: 'denied',
          resolvedBy: 'user',
        })
      } else if (action === 'subject') {
        const mapped = mapNotification({
          method: 'approval/updated',
          params: {
            ...raceUpdated('s1', 1),
            subject: { kind: 'shell', command: 'different command', stages: [] },
          },
        })
        if (
          typeof mapped === 'string' ||
          !('event' in mapped) ||
          mapped.event.type !== 'approvalUpdated'
        ) {
          throw new Error('captured update did not map')
        }
        expect(t.approvals.updated(mapped.event)).toBe(true)
      } else {
        t.approvals[action]()
      }
      expect(t.runtime.judge.mock.calls[0]?.[1].aborted).toBe(true)
      t.judge.resolve(useOutput(t.policy(), undefined, {}, 'review'))
      t.review.resolve(allow)
      await flush()
      expect(t.session.decideApproval).not.toHaveBeenCalled()
      expect(t.cards).toHaveBeenCalledTimes(
        ['release', 'reset', 'subject'].includes(action) ? 1 : 0,
      )
    }
  })

  it('rebinding drops ready results as well as results arriving after a source/owner change', async () => {
    for (const isReady of [true, false]) {
      const t = setup()
      t.approvals.hold(t.event, t.hold)
      if (isReady) {
        t.judge.resolve(useOutput(t.policy(), undefined, {}, 'review'))
        await flush()
      }
      t.replaceBinding()
      if (!isReady) {
        t.judge.resolve(useOutput(t.policy(), undefined, {}, 'review'))
        await flush()
        expect(t.runtime.judge.mock.calls[0]?.[1].aborted).toBe(true)
      }
      t.review.resolve(allow)
      await flush()
      expect(t.session.decideApproval).toHaveBeenCalledOnce()
      expect(t.cards).not.toHaveBeenCalled()
    }
  })

  it('rechecks evidence and mode at the fence after an answer is ready', async () => {
    for (const change of [
      'off',
      'profile',
      'paired',
      'golden',
      'threshold',
      'use',
      'identity',
    ] as const) {
      const t = setup()
      t.approvals.hold(t.event, t.hold)
      t.judge.resolve(useOutput(t.policy(), undefined, {}, 'review'))
      await flush()
      const policy = t.policy()
      if (policy.evidence === undefined) {
        throw new Error('fixture evidence missing')
      }
      const changes = {
        off: { ...policy, isOn: false },
        profile: { ...policy, evidence: { ...policy.evidence, profileId: 'new' } },
        paired: { ...policy, evidence: { ...policy.evidence, pairedM75Receipt: 'new' } },
        golden: { ...policy, evidence: { ...policy.evidence, borrowedGoldenReceipt: 'new' } },
        threshold: { ...policy, evidence: { ...policy.evidence, threshold: 1 } },
        use: usePolicy('skill-suggestion'),
        identity: { ...policy, identity: { ...policy.identity, modelVersion: 'new' } },
      }
      t.changePolicy(changes[change])
      t.review.resolve(allow)
      await flush()
      expect(t.session.decideApproval).toHaveBeenCalledOnce()
    }
  })

  it('keeps an identical restarted action safe from the previous callback', async () => {
    const t = setup()
    const stop = new AbortController()
    const first = t.uses.startReview({ action: useAction(), state: t.hold.request }, stop.signal)
    first?.discard()
    const nextResult = deferred<JudgeOutcome>()
    t.runtime.judge.mockImplementationOnce(() => nextResult.promise)
    const next = t.uses.startReview(
      { action: useAction(), state: t.hold.request },
      new AbortController().signal,
    )
    t.judge.resolve(useOutput(t.policy(), undefined, {}, 'review'))
    await flush()
    expect(first?.read()).toBe(false)
    nextResult.resolve(useOutput(t.policy(), undefined, {}, 'review'))
    await flush()
    expect(next?.read()).toBe(true)
    expect(next?.read()).toBe(false)
  })
})
