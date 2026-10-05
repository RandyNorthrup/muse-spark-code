import { JUDGE_CARD_CHOICES } from './helpers/judgeUseRig'
import { describe, expect, it, vi } from 'vitest'
import { ReviewBreaker, parseReviewerAnswer } from '../../src/core/backends/modelapi/autoReviewer'
import { ModelApiHost, ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import { ReviewedApprovals } from '../../src/host/review/reviewedApprovals'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import { FakeAgentHost, FakeAgentSession } from './helpers/fakeAgent'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { judgeUseRig } from './helpers/judgeUseRig'
import { watchSessionTurns } from './helpers/sessionTurns'

type Card = Extract<AgentEvent, { type: 'approvalRequested' }>
const REQUEST: Card = {
  type: 'approvalRequested',
  approvalId: 'a1',
  itemId: 'i1',
  toolName: 'bash',
  rawArgs: '{"command":"npm test"}',
  turnId: 't1',
  requirementId: { approvalId: 'a1', sourceIndex: 0 },
  subject: { kind: 'shell', command: 'npm test' },
  availableChoices: [...JUDGE_CARD_CHOICES],
  isJudgeEscalated: false,
  isProtectedWrite: false,
}

function museRig(outcome?: 'caution' | 'none' | 'failed') {
  const judge = judgeUseRig({ outcome })
  const review = Promise.withResolvers<{ decision: 'allow'; reason: string; hasTripped: boolean }>()
  const session = new FakeAgentSession('s1', 'muse-spark-1.3')
  const cards: Card[] = []
  const approvals = new ReviewedApprovals(
    {
      judge: judge.judge,
      showCard: (event) => {
        cards.push(event)
      },
      notice: vi.fn(),
      mayAllow: () => true,
      log: new FakeLogOutputChannel(),
      describeFailure: () => 'failure',
    },
    new ReviewBreaker(),
    () => review.promise,
    () => false,
  )
  approvals.hold(REQUEST, {
    session,
    host: () => Promise.resolve(new FakeAgentHost()),
    modelId: session.modelId,
    request: {
      userRequest: 'run tests',
      recentCalls: [],
      tool: 'bash',
      action: 'npm test',
      workspaceRoot: '/ws',
      platform: 'linux',
    },
  })
  return {
    ...judge,
    review,
    session,
    approvals,
    cards,
    finish: () => {
      review.resolve({ decision: 'allow', reason: 'allowed by reviewer', hasTripped: false })
    },
  }
}

describe('Muse Code extension-owned reviewer fence', () => {
  it('a ready caution turns reviewer ALLOW into a card, never an approval', async () => {
    const rig = museRig('caution')
    await vi.waitFor(() => {
      expect(rig.jobs).toHaveLength(1)
    })
    rig.finish()
    await vi.waitFor(() => {
      expect(rig.cards).toHaveLength(1)
    })
    expect(rig.cards[0]?.judgeCaution).toBe(true)
    expect(rig.session.decideApproval).not.toHaveBeenCalled()
  })

  it.each(['none', 'failed', undefined] as const)(
    'a %s result leaves the reviewer verdict unchanged and drops late caution',
    async (outcome) => {
      const rig = museRig(outcome)
      await vi.waitFor(() => {
        expect(rig.jobs).toHaveLength(1)
      })
      rig.finish()
      await vi.waitFor(() => {
        expect(rig.session.decideApproval).toHaveBeenCalledTimes(1)
      })
      expect(rig.cards).toEqual([])
      expect(rig.settle('caution')).toBe(false)
      expect(rig.session.decideApproval).toHaveBeenCalledWith(
        expect.objectContaining({ choiceId: 'allow_once' }),
      )
    },
  )

  it.each(['release', 'forget', 'resolved', 'updated'] as const)(
    'discards a judge when an approval is %s while reviewer is pending',
    async (method) => {
      const rig = museRig()
      await vi.waitFor(() => {
        expect(rig.jobs).toHaveLength(1)
      })
      if (method === 'resolved')
        rig.approvals.resolved({
          type: 'approvalResolved',
          approvalId: 'a1',
          itemId: 'i1',
          decision: 'abort',
          resolvedBy: 'user',
        })
      else if (method === 'updated')
        rig.approvals.updated({
          type: 'approvalUpdated',
          approvalId: 'a1',
          requirementId: REQUEST.requirementId,
          subject: { kind: 'shell', command: 'different' },
          availableChoices: REQUEST.availableChoices,
        })
      else rig.approvals[method]()
      expect(rig.settle('caution')).toBe(false)
      rig.finish()
      await Promise.resolve()
      expect(rig.session.decideApproval).not.toHaveBeenCalled()
    },
  )
})

async function modelRig(
  outcome?: 'caution' | 'none' | 'failed',
  hasReviewer = true,
  command = 'npm test',
) {
  const judge = judgeUseRig({ outcome })
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({}, '/ws')
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client: fakeModelApiClient(api, log),
      workspaceRoot: '/ws',
      io,
      log,
    }),
    judge: judge.judge,
    permissionSettings: () => ({
      commandRules: [{ pattern: ['pwd'], decision: 'allow', match: ['pwd'] }],
      profiles: {},
      profile: '',
      repositoryRules: {},
    }),
    isPaidFeatureOn: (feature) => hasReviewer && feature === 'autoReviewer',
    allowsPaidUse: () => Promise.resolve(true),
  })
  const session = await host.startSession({
    workspaceRoot: '/ws',
    modelId: 'muse-spark-1.3',
    approvalMode: 'onRequest',
  })
  if (!(session instanceof ModelApiSession)) throw new Error('wrong session type')
  const watched = watchSessionTurns(session)
  api.script(
    { calls: [{ name: 'bash', arguments: JSON.stringify({ command }), callId: 'sh1' }] },
    ...(hasReviewer
      ? [{ text: 'ALLOW: allowed by reviewer', usage: { input: 900, output: 20 } }]
      : []),
    { text: 'done' },
  )
  const done = watched.turnDone()
  await session.sendTurn([{ type: 'text', text: 'run tests' }])
  return { ...judge, ...watched, done, io, api, session }
}

async function firstCard(events: AgentEvent[]): Promise<Card> {
  return await vi.waitFor(() => {
    const card = events.find((event) => event.type === 'approvalRequested')
    expect(card).toBeDefined()
    if (card === undefined) throw new Error('No card')
    return card
  })
}

async function reject(rig: Awaited<ReturnType<typeof modelRig>>, card: Card): Promise<void> {
  await rig.session.decideApproval({
    approvalId: card.approvalId,
    requirementId: card.requirementId,
    choiceId: 'abort',
  })
  await rig.done
  rig.session.dispose()
}

describe('Model API reviewer and card fences', () => {
  it('a ready caution turns ALLOW into the normal card without executing', async () => {
    const rig = await modelRig('caution')
    const card = await firstCard(rig.events)
    expect(card.judgeCaution).toBe(true)
    expect(rig.io.shellCalls).toEqual([])
    expect(rig.jobs).toHaveLength(1)
    await reject(rig, card)
  })

  it.each(['none', 'failed', undefined] as const)(
    'a %s judge leaves ALLOW unchanged; no user path awaits it',
    async (outcome) => {
      const rig = await modelRig(outcome)
      await rig.done
      expect(rig.io.shellCalls.map((call) => call.command)).toEqual(['npm test'])
      expect(rig.events.some((event) => event.type === 'approvalRequested')).toBe(false)
      expect(rig.settle('caution')).toBe(false)
      rig.session.dispose()
    },
  )

  it('renders a card before the delayed judge and adds only a caution note', async () => {
    const rig = await modelRig(undefined, false)
    const card = await firstCard(rig.events)
    expect(card.judgeCaution).toBeUndefined()
    await vi.waitFor(() => {
      expect(rig.jobs).toHaveLength(1)
    })
    rig.settle('caution')
    expect(rig.events.filter((event) => event.type === 'approvalCaution')).toEqual([
      { type: 'approvalCaution', approvalId: card.approvalId, requirementId: card.requirementId },
    ])
    expect(rig.io.shellCalls).toEqual([])
    await reject(rig, card)
    expect(rig.settle('caution')).toBe(false)
  })

  it('discards at the synchronous user answer before any queued callback can add a note', async () => {
    const rig = await modelRig(undefined, false)
    const card = await firstCard(rig.events)
    await vi.waitFor(() => {
      expect(rig.jobs).toHaveLength(1)
    })
    const decided = rig.session.decideApproval({
      approvalId: card.approvalId,
      requirementId: card.requirementId,
      choiceId: 'abort',
    })
    expect(rig.settle('caution')).toBe(false)
    expect(rig.events.filter((event) => event.type === 'approvalCaution')).toEqual([])
    await decided
    await rig.done
    rig.session.dispose()
  })

  it('discards pending card work on cancellation and a model switch', async () => {
    for (const change of ['cancel', 'model'] as const) {
      const rig = await modelRig(undefined, false)
      const card = await firstCard(rig.events)
      await vi.waitFor(() => {
        expect(rig.jobs).toHaveLength(1)
      })
      if (change === 'cancel') await rig.session.cancel()
      else await rig.session.setModel('muse-spark-1.1')
      expect(rig.settle('caution')).toBe(false)
      if (change === 'model') await reject(rig, card)
      else {
        await rig.done
        rig.session.dispose()
      }
    }
  })

  it('does not start or charge a judge on an immediate Auto allow', async () => {
    const rig = await modelRig(undefined, false, 'pwd')
    await rig.done
    expect(rig.jobs).toEqual([])
    expect(rig.prepare).not.toHaveBeenCalled()
    expect(rig.io.shellCalls.map((call) => call.command)).toEqual(['pwd'])
    rig.session.dispose()
  })

  it('keeps Judge outputs out of the ALLOW parser', () => {
    expect(parseReviewerAnswer('caution')).toBeUndefined()
    expect(parseReviewerAnswer('none')).toBeUndefined()
    expect(parseReviewerAnswer('{"answer":"no","confidence":100}')).toBeUndefined()
    // Only the reviewer's own text has authority; JudgeUse never passes it here.
    expect(parseReviewerAnswer('ALLOW: reviewer')).toEqual({
      decision: 'allow',
      reason: 'reviewer',
    })
    expect(UI_TEXT.judgeCaution).not.toContain('ALLOW:')
  })
})
