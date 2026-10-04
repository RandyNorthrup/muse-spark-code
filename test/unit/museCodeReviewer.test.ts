// The Auto reviewer on Muse Code (M90, PLAN.md D69): its side session on a
// real MuseCodeHost over the in-memory MSP transport, answered with the
// frames captured live on 2026-10-03 (helpers/reviewerCapture.ts), and what
// one conversation's approvals become (reviewedApprovals.ts): ALLOW is the
// allow-once choice, on every stage of the line; anything else is the card.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { PromptSettledError } from '../../src/core/agent/agentBackend'
import { failureForLog } from '../../src/core/backends/musecode/logText'
import { mapNotification } from '../../src/core/backends/musecode/mapNotification'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import { MuseCodeReviewer } from '../../src/host/review/museCodeReviewer'
import type { ReviewedApprovals } from '../../src/host/review/reviewedApprovals'
import type { AgentEvent } from '../../src/shared/agentEvents'
import {
  MODEL_TEXT,
  MUSE_CODE_REVIEWER_TURNS_PER_SESSION,
  THINKING_OFF_EFFORT,
  UI_TEXT,
} from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { FakeAgentSession } from './helpers/fakeAgent'
import { FakeLogOutputChannel } from './helpers/fakes'
import { type FakeHostHandle, fakeMspHost, refusalOf } from './helpers/fakeMsp'
import {
  CAPTURED_REPLY,
  reminderChildFrame,
  reviewReplyFrames,
  reviewTurnCompleted,
  reviewTurnStarted,
  sideSessionStarted,
} from './helpers/reviewerCapture'
import { raceRequested, raceUpdated, RACE_APPROVAL_ID } from './helpers/stageRaceCapture'
import { removeFolder } from './helpers/temporaryFolders'

type ApprovalRequest = Extract<AgentEvent, { type: 'approvalRequested' }>
type ApprovalUpdate = Extract<AgentEvent, { type: 'approvalUpdated' }>

const CONTRIBUTOR = 'muse-spark-1.3-contributor'
const USER_REQUEST = 'Count the lines in notes.md'
const SHORT_TIMEOUT_MS = 400
const folders: string[] = []

afterAll(async () => {
  await Promise.all(folders.map((folder) => removeFolder(folder)))
})

/** The captured eight-stage PowerShell line, as the panel maps it, asked by turn `t1`. */
function shellRequest(approvalId = RACE_APPROVAL_ID, turnId = 't1'): ApprovalRequest {
  const mapped = mapNotification({
    method: 'approval/requested',
    params: { ...raceRequested('s1'), approvalId, turnId },
  })
  if (typeof mapped === 'string' || !('event' in mapped)) {
    throw new Error('the captured request did not map')
  }
  const { event } = mapped
  if (event.type !== 'approvalRequested') {
    throw new Error('not an approval request')
  }
  return event
}

/** The captured stage update: stage `waiting` is the one Muse Code waits on. */
function stageUpdate(waiting: number, command?: string): ApprovalUpdate {
  const params = raceUpdated('s1', waiting)
  const mapped = mapNotification({
    method: 'approval/updated',
    params:
      command === undefined
        ? params
        : { ...params, subject: { kind: 'shell', command, stages: [] } },
  })
  if (
    typeof mapped === 'string' ||
    !('event' in mapped) ||
    mapped.event.type !== 'approvalUpdated'
  ) {
    throw new Error('the captured update did not map')
  }
  return mapped.event
}

function answeringHost(): FakeHostHandle {
  const handle = fakeMspHost()
  let sides = 0
  let turns = 0
  handle.server.handle('session/start', (params) => {
    sides += 1
    return sideSessionStarted(`side-${String(sides)}`, params['workspaceRoot'], params['modelId'])
  })
  handle.server.handle('session/setReasoningEffort', (params) => ({
    commandId: params['commandId'],
    status: 'accepted',
  }))
  handle.server.handle('turn/start', (params) => {
    turns += 1
    return reviewTurnStarted(params['commandId'], `rt-${String(turns)}`)
  })
  for (const method of ['turn/cancel', 'task/stopAll']) {
    handle.server.handle(method, (params) => ({
      commandId: params['commandId'],
      status: 'accepted',
    }))
  }
  return handle
}

function setup(options: { readonly timeoutMs?: number } = {}) {
  const handle = answeringHost()
  const log = new FakeLogOutputChannel()
  const host = new MuseCodeHost(handle.host, log)
  const folder = mkdtempSync(path.join(tmpdir(), 'muse-reviewer-'))
  folders.push(folder)
  const root = path.join(folder, 'museCodeReviewer')
  const sideIds: string[] = []
  const reviewer = new MuseCodeReviewer({
    root,
    log,
    onSideSession: (sessionId) => {
      sideIds.push(sessionId)
    },
    describeFailure: failureForLog,
    timeoutMs: options.timeoutMs ?? 5000,
  })
  const conversation = new FakeAgentSession('s1', CONTRIBUTOR)
  const cards: [ApprovalRequest, string | undefined][] = []
  const notices: [string, string][] = []
  const mayAllow = { value: true }
  const approvals: ReviewedApprovals = reviewer.conversation({
    showCard: (event, note) => {
      cards.push([event, note])
    },
    notice: (level, text) => {
      notices.push([level, text])
    },
    mayAllow: () => mayAllow.value,
    log,
    describeFailure: failureForLog,
  })
  const hold = (
    event: ApprovalRequest = shellRequest(),
    modelId = CONTRIBUTOR,
    onHost: MuseCodeHost = host,
  ) => {
    approvals.hold(event, {
      session: conversation,
      host: () => Promise.resolve(onHost),
      modelId,
      request: {
        userRequest: USER_REQUEST,
        recentCalls: [{ tool: 'read_file', args: '{"path":"notes.md"}' }],
        tool: event.toolName,
        action: event.subject.command ?? event.rawArgs,
        workspaceRoot: '/ws',
        platform: 'win32',
      },
    })
  }
  return {
    handle,
    log,
    host,
    root,
    sideIds,
    reviewer,
    conversation,
    cards,
    notices,
    mayAllow,
    approvals,
    hold,
  }
}

type Rig = ReturnType<typeof setup>

/** The `index`th review turn (1-based) once it was sent: its session, id and text. */
async function reviewTurn(handle: FakeHostHandle, index: number) {
  await vi.waitFor(() => {
    expect(handle.server.requestsFor('turn/start').length).toBeGreaterThanOrEqual(index)
  })
  const params = handle.server.requestsFor('turn/start')[index - 1]?.params ?? {}
  const input = params['input']
  const first: unknown = Array.isArray(input) ? input[0] : undefined
  const text =
    typeof first === 'object' && first !== null && 'text' in first && typeof first.text === 'string'
      ? first.text
      : ''
  return { sessionId: String(params['sessionId']), turnId: `rt-${String(index)}`, text }
}

/** The captured reply and turn end; reminder activity is tested as a failure below. */
function answer(
  handle: FakeHostHandle,
  turn: { readonly sessionId: string; readonly turnId: string },
  text: string,
  options: { readonly isEnded?: boolean } = {},
): void {
  for (const frame of reviewReplyFrames(turn.sessionId, turn.turnId, text)) {
    handle.server.notify(frame.method, frame.params)
  }
  if (options.isEnded !== false) {
    handle.server.notify('turn/completed', reviewTurnCompleted(turn.sessionId, turn.turnId))
  }
}

/** A review answered ALLOW: its turn is the `index`th, its decision the `decisions`th. */
async function allowOnce(
  t: Rig,
  index = 1,
  event = shellRequest(),
  decisions = index,
): Promise<void> {
  t.hold(event)
  answer(t.handle, await reviewTurn(t.handle, index), CAPTURED_REPLY)
  await vi.waitFor(() => {
    expect(t.conversation.decideApproval).toHaveBeenCalledTimes(decisions)
  })
}

/** A failed review has exactly one failure card and no automatic decision. */
async function expectFailure(t: Rig): Promise<void> {
  await vi.waitFor(() => {
    expect(t.cards).toEqual([[expect.anything(), UI_TEXT.autoReviewerFailed]])
  })
  expect(t.conversation.decideApproval).not.toHaveBeenCalled()
}

/** An open breaker leaves every waiting approval to its card. */
async function expectPaused(t: Rig): Promise<void> {
  await vi.waitFor(() => {
    expect(t.cards).toHaveLength(4)
  })
  expect(t.cards.at(-1)?.[1]).toBe(UI_TEXT.autoReviewerPaused)
  expect(t.handle.server.requestsFor('turn/start')).toHaveLength(3)
  expect(t.conversation.decideApproval).not.toHaveBeenCalled()
}

describe('the Auto reviewer on Muse Code (M90)', () => {
  it.each(['kind', 'command', 'path', 'host', 'toolName'] as const)(
    'drops held and allowed verdicts when subject %s changes',
    async (field) => {
      const held = setup()
      held.hold()
      const turn = await reviewTurn(held.handle, 1)
      const update = stageUpdate(1)
      const changed = { ...update, subject: { ...update.subject, [field]: 'changed' } }
      expect(held.approvals.updated(changed)).toBe(true)
      expect(held.cards).toEqual([
        [expect.objectContaining({ subject: changed.subject }), undefined],
      ])
      answer(held.handle, turn, CAPTURED_REPLY)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(held.cards).toHaveLength(1)
      expect(held.conversation.decideApproval).not.toHaveBeenCalled()
      const allowed = setup()
      await allowOnce(allowed)
      expect(allowed.approvals.updated(changed)).toBe(true)
      expect(allowed.cards).toHaveLength(1)
      expect(allowed.conversation.decideApproval).toHaveBeenCalledOnce()
    },
  )

  it('rechecks mayAllow before answering a later stage', async () => {
    const t = setup()
    await allowOnce(t)
    t.mayAllow.value = false
    t.approvals.updated(stageUpdate(1))
    expect(t.cards).toEqual([[expect.anything(), undefined]])
    expect(t.conversation.decideApproval).toHaveBeenCalledOnce()
  })

  it('shows a later stage without allow_once as a card', async () => {
    const t = setup()
    await allowOnce(t)
    t.approvals.updated({ ...stageUpdate(1), availableChoices: [] })
    expect(t.cards).toEqual([[expect.anything(), undefined]])
    expect(t.conversation.decideApproval).toHaveBeenCalledOnce()
  })

  it('gives a denied resolution no Allowed reason despite an allowance', async () => {
    const t = setup()
    await allowOnce(t)
    expect(
      t.approvals.resolved({
        type: 'approvalResolved',
        approvalId: RACE_APPROVAL_ID,
        itemId: RACE_APPROVAL_ID,
        decision: 'denied',
        resolvedBy: 'user',
      }),
    ).toBeUndefined()
  })

  it('a new accepted message releases held reviews and drops old allowances', async () => {
    const t = setup()
    await allowOnce(t)
    t.hold(shellRequest('a2'))
    const turn = await reviewTurn(t.handle, 2)
    t.approvals.reset()
    expect(t.cards).toHaveLength(1)
    expect(t.approvals.updated(stageUpdate(1))).toBe(false)
    answer(t.handle, turn, CAPTURED_REPLY)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(t.cards).toHaveLength(1)
    expect(t.conversation.decideApproval).toHaveBeenCalledOnce()
  })

  it('rechecks a breaker opened while reviews waited in the queue', async () => {
    const t = setup()
    for (const index of [1, 2, 3, 4]) t.hold(shellRequest(`a${String(index)}`))
    for (const index of [1, 2, 3]) {
      answer(t.handle, await reviewTurn(t.handle, index), 'ASK: not sure')
      await vi.waitFor(() => {
        expect(t.cards.length).toBeGreaterThanOrEqual(index)
      })
    }
    await expectPaused(t)
  })

  it('three timeouts trip the breaker without another side turn', async () => {
    const t = setup({ timeoutMs: SHORT_TIMEOUT_MS })
    for (const index of [1, 2, 3]) {
      t.hold(shellRequest(`a${String(index)}`))
      await vi.waitFor(() => {
        expect(t.cards).toHaveLength(index)
      })
    }
    t.hold(shellRequest('a4'))
    await expectPaused(t)
  })

  it('fails fast for a non-started review turn', async () => {
    const t = setup()
    t.handle.server.handle('turn/start', (params) => ({
      ...reviewTurnStarted(params['commandId'], 'rt-1'),
      disposition: 'completed',
    }))
    t.hold()
    await expectFailure(t)
  })

  it.each(['deadline', 'release'] as const)(
    'sends no side turn after effort setup %s',
    async (cause) => {
      const t = setup({ timeoutMs: cause === 'release' ? 5000 : SHORT_TIMEOUT_MS })
      t.handle.server.silence('session/setReasoningEffort')
      t.hold()
      await vi.waitFor(() => {
        expect(t.handle.server.requestsFor('session/setReasoningEffort')).toHaveLength(1)
      })
      if (cause === 'release') t.approvals.release()
      await vi.waitFor(() => {
        expect(t.cards).toHaveLength(1)
      })
      await vi.waitFor(() => {
        expect(t.handle.server.requestsFor('task/stopAll')).toHaveLength(1)
      })
      const effort = t.handle.server.requestsFor('session/setReasoningEffort')[0]
      t.handle.server.incoming.push(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: effort?.id,
          result: { commandId: effort?.params?.['commandId'], status: 'accepted' },
        })}\n`,
      )
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(t.handle.server.requestsFor('turn/start')).toHaveLength(0)
      expect(t.cards[0]?.[1]).toBe(cause === 'deadline' ? UI_TEXT.autoReviewerFailed : undefined)
    },
  )

  it.each(['failed', 'cancelled', 'rejected', 'timedOut'] as const)(
    'never accepts ALLOW from a %s reply item',
    async (status) => {
      const t = setup()
      t.hold()
      const turn = await reviewTurn(t.handle, 1)
      for (const frame of reviewReplyFrames(turn.sessionId, turn.turnId, CAPTURED_REPLY)) {
        const item = frame.params['item']
        const replacement = typeof item === 'object' && item !== null ? { ...item, status } : item
        t.handle.server.notify(
          frame.method,
          frame.method === 'item/completed'
            ? {
                ...frame.params,
                item: replacement,
              }
            : frame.params,
        )
      }
      t.handle.server.notify('turn/completed', reviewTurnCompleted(turn.sessionId, turn.turnId))
      await expectFailure(t)
    },
  )

  it.each(['failed', 'cancelled'] as const)(
    'never accepts ALLOW when its turn ends %s',
    async (terminal) => {
      const t = setup()
      t.hold()
      const turn = await reviewTurn(t.handle, 1)
      answer(t.handle, turn, CAPTURED_REPLY, { isEnded: false })
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(t.conversation.decideApproval).not.toHaveBeenCalled()
      t.handle.server.notify(
        'turn/completed',
        reviewTurnCompleted(turn.sessionId, turn.turnId, terminal),
      )
      await expectFailure(t)
    },
  )

  it('cancels captured reminder activity and recreates the side session', async () => {
    const t = setup()
    t.hold()
    const turn = await reviewTurn(t.handle, 1)
    answer(t.handle, turn, CAPTURED_REPLY, { isEnded: false })
    t.handle.server.notify('item/completed', reminderChildFrame(turn.sessionId, turn.turnId))
    await vi.waitFor(() => {
      expect(t.cards).toEqual([[expect.anything(), UI_TEXT.autoReviewerFailed]])
    })
    expect(t.handle.server.requestsFor('turn/cancel')).toHaveLength(1)
    expect(t.conversation.decideApproval).not.toHaveBeenCalled()
    await allowOnce(t, 2, shellRequest('a2'), 1)
    expect(t.sideIds).toEqual(['side-1', 'side-2'])
  })

  it('reviews in a hidden Plan-mode side session on the conversation’s model, thinking off', async () => {
    const t = setup()
    t.hold()
    const turn = await reviewTurn(t.handle, 1)
    const start = t.handle.server.requestsFor('session/start')[0]?.params
    expect(start).toMatchObject({
      workspaceRoot: t.root,
      modelId: CONTRIBUTOR,
      approvalMode: 'denyUnmatched',
    })
    // No tool server, so no `ide` tools either.
    expect(start).not.toHaveProperty('config')
    expect(t.sideIds).toEqual(['side-1'])
    expect(t.handle.server.requestsFor('session/setReasoningEffort')[0]?.params).toMatchObject({
      sessionId: 'side-1',
      reasoningEffort: THINKING_OFF_EFFORT,
    })
    expect(turn.sessionId).toBe('side-1')
    // M78's rubric and input, every part fenced as data (acceptance 5).
    expect(turn.text.startsWith(MODEL_TEXT.autoReviewerInstructions)).toBe(true)
    expect(turn.text).toContain('Use no tools.')
    expect(turn.text).toContain(`<<<\n${USER_REQUEST}\n>>>`)
    expect(turn.text).toContain('read_file {"path":"notes.md"}')
    expect(turn.text).toContain(`tool: powershell\naction: ${shellRequest().subject.command ?? ''}`)
    expect(turn.text).toContain('workspace: /ws\nplatform: win32')
    answer(t.handle, turn, CAPTURED_REPLY)
    await vi.waitFor(() => {
      expect(t.conversation.decideApproval).toHaveBeenCalledOnce()
    })
  })

  it('answers ALLOW with the allow-once choice only, no card, and names its reason when resolved', async () => {
    const t = setup()
    await allowOnce(t)
    expect(t.conversation.decideApproval).toHaveBeenCalledExactlyOnceWith({
      approvalId: RACE_APPROVAL_ID,
      choiceId: 'allow_once',
      requirementId: { approvalId: RACE_APPROVAL_ID, sourceIndex: 0 },
    })
    expect(t.cards).toEqual([])
    // The first review in the window says what it does, once.
    expect(t.notices).toEqual([['info', UI_TEXT.museCodeReviewerNotice]])
    expect(
      t.approvals.resolved({
        type: 'approvalResolved',
        approvalId: RACE_APPROVAL_ID,
        itemId: RACE_APPROVAL_ID,
        decision: 'approved',
        resolvedBy: 'user',
      }),
    ).toBe(
      fill(UI_TEXT.autoReviewAllowed, {
        reason: 'reads workspace file to fulfill line-count request',
      }),
    )
    // Nothing the reviewer said reached Muse Code but the one decision (acceptance 5).
    const methods = t.handle.server.requests.map((request) => request.method)
    expect(new Set(methods)).toEqual(
      new Set(['session/start', 'session/setReasoningEffort', 'turn/start']),
    )
  })

  it('allows each later stage of the line it allowed once, and asks for a different line', async () => {
    const t = setup()
    await allowOnce(t)
    expect(t.approvals.updated(stageUpdate(1))).toBe(true)
    await vi.waitFor(() => {
      expect(t.conversation.decideApproval).toHaveBeenCalledTimes(2)
    })
    expect(t.conversation.decideApproval.mock.calls[1]?.[0]).toEqual({
      approvalId: RACE_APPROVAL_ID,
      choiceId: 'allow_once',
      requirementId: { approvalId: RACE_APPROVAL_ID, sourceIndex: 1 },
    })
    expect(t.approvals.updated(stageUpdate(2, 'Remove-Item -Recurse C:\\'))).toBe(true)
    expect(t.conversation.decideApproval).toHaveBeenCalledTimes(2)
    expect(t.cards.map(([event, note]) => [event.requirementId.sourceIndex, note])).toEqual([
      [2, undefined],
    ])
    // An approval it never had is the panel's.
    expect(t.approvals.updated(stageUpdate(3))).toBe(false)
  })

  it.each([
    [
      'ASK',
      'ASK: deletes files outside the workspace',
      () => fill(UI_TEXT.autoReviewAsked, { reason: 'deletes files outside the workspace' }),
    ],
    ['an unreadable reply', 'Looks fine to me.', () => UI_TEXT.autoReviewerUnreadable],
    ['ALLOW without a reason', 'ALLOW:', () => UI_TEXT.autoReviewerUnreadable],
  ])('leaves %s to the user, the card saying why', async (_case, reply, note) => {
    const t = setup()
    t.hold()
    answer(t.handle, await reviewTurn(t.handle, 1), reply)
    await vi.waitFor(() => {
      expect(t.cards).toHaveLength(1)
    })
    expect(t.cards[0]?.[1]).toBe(note())
    expect(t.cards[0]?.[0].approvalId).toBe(RACE_APPROVAL_ID)
    expect(t.conversation.decideApproval).not.toHaveBeenCalled()
  })

  it('leaves a review with no reply in time to the user and lets its side session go', async () => {
    const t = setup({ timeoutMs: SHORT_TIMEOUT_MS })
    t.hold()
    await reviewTurn(t.handle, 1)
    await vi.waitFor(() => {
      expect(t.cards).toEqual([[expect.anything(), UI_TEXT.autoReviewerFailed]])
    })
    // Its turn is stopped, and the next review starts a side session of its own.
    await vi.waitFor(() => {
      expect(t.handle.server.requestsFor('turn/cancel')[0]?.params).toMatchObject({
        sessionId: 'side-1',
      })
    })
    await allowOnce(t, 2, shellRequest('a2'), 1)
    expect(t.sideIds).toEqual(['side-1', 'side-2'])
  })

  it('leaves the approval to the user when the side session cannot start, or its turn ends with no reply', async () => {
    const refused = setup()
    refused.handle.server.handle('session/start', refusalOf('internal'))
    refused.hold()
    await vi.waitFor(() => {
      expect(refused.cards).toEqual([[expect.anything(), UI_TEXT.autoReviewerFailed]])
    })
    const ended = setup()
    ended.hold()
    const turn = await reviewTurn(ended.handle, 1)
    ended.handle.server.notify(
      'turn/completed',
      reviewTurnCompleted(turn.sessionId, turn.turnId, 'failed'),
    )
    await vi.waitFor(() => {
      expect(ended.cards).toEqual([[expect.anything(), UI_TEXT.autoReviewerFailed]])
    })
  })

  it('trips its breaker after three declines, then asks with no review until the next message', async () => {
    const t = setup()
    for (const index of [1, 2, 3]) {
      t.hold(shellRequest(`a${String(index)}`))
      answer(t.handle, await reviewTurn(t.handle, index), 'ASK: not sure')
      await vi.waitFor(() => {
        expect(t.cards).toHaveLength(index)
      })
    }
    expect(t.notices.at(-1)).toEqual(['warning', UI_TEXT.autoReviewerTripped])
    t.hold(shellRequest('a4'))
    await vi.waitFor(() => {
      expect(t.cards.at(-1)?.[1]).toBe(UI_TEXT.autoReviewerPaused)
    })
    expect(t.handle.server.requestsFor('turn/start')).toHaveLength(3)
    // The user's next message: the reviewer answers again.
    t.approvals.reset()
    await allowOnce(t, 4, shellRequest('a5'), 1)
  })

  it('reviews one approval at a time in the window, in order', async () => {
    const t = setup()
    const other = t.reviewer.conversation({
      showCard: vi.fn(),
      notice: vi.fn(),
      mayAllow: () => true,
      log: t.log,
      describeFailure: failureForLog,
    })
    t.hold(shellRequest('a1'))
    other.hold(shellRequest('a2'), {
      session: t.conversation,
      host: () => Promise.resolve(t.host),
      modelId: CONTRIBUTOR,
      request: {
        userRequest: undefined,
        recentCalls: [],
        tool: 'powershell',
        action: 'Get-ChildItem',
        workspaceRoot: '/ws',
        platform: 'win32',
      },
    })
    const first = await reviewTurn(t.handle, 1)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(t.handle.server.requestsFor('turn/start')).toHaveLength(1)
    // Its reply comes first; the next turn waits for this one's end.
    answer(t.handle, first, CAPTURED_REPLY, { isEnded: false })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(t.conversation.decideApproval).not.toHaveBeenCalled()
    expect(t.handle.server.requestsFor('turn/start')).toHaveLength(1)
    t.handle.server.notify('turn/completed', reviewTurnCompleted(first.sessionId, first.turnId))
    const second = await reviewTurn(t.handle, 2)
    expect(second.sessionId).toBe('side-1')
    expect(second.text).toContain('action: Get-ChildItem')
    // The window's notice was said once, by the first review.
    expect(t.notices).toEqual([['info', UI_TEXT.museCodeReviewerNotice]])
  })

  it('leaves the next review to the user while the side session is still busy, and starts afresh', async () => {
    const t = setup({ timeoutMs: SHORT_TIMEOUT_MS })
    t.hold(shellRequest('a1'))
    answer(t.handle, await reviewTurn(t.handle, 1), CAPTURED_REPLY, { isEnded: false })
    t.approvals.release()
    t.hold(shellRequest('a2'))
    await vi.waitFor(() => {
      expect(t.cards).toHaveLength(2)
    })
    expect(t.cards.map(([, note]) => note)).toEqual([undefined, UI_TEXT.autoReviewerFailed])
    expect(t.handle.server.requestsFor('turn/cancel')).toHaveLength(1)
    await allowOnce(t, 2, shellRequest('a3'), 1)
    expect(t.sideIds).toEqual(['side-1', 'side-2'])
  })

  it('starts its side session again after Muse Code restarts, exits or closes it, and for another model', async () => {
    const t = setup()
    await allowOnce(t, 1, shellRequest('a1'))
    // Muse Code restarted: the conversation's host is a new one.
    const restarted = answeringHost()
    const newHost = new MuseCodeHost(restarted.host, t.log)
    t.hold(shellRequest('a2'), CONTRIBUTOR, newHost)
    answer(restarted, await reviewTurn(restarted, 1), CAPTURED_REPLY)
    await vi.waitFor(() => {
      expect(t.conversation.decideApproval).toHaveBeenCalledTimes(2)
    })
    expect(restarted.server.requestsFor('session/start')).toHaveLength(1)
    // Muse Code closed it.
    restarted.server.notify('session/closed', { sessionId: 'side-1', reason: 'hostShutdown' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    t.hold(shellRequest('a3'), CONTRIBUTOR, newHost)
    answer(restarted, await reviewTurn(restarted, 2), CAPTURED_REPLY)
    await vi.waitFor(() => {
      expect(t.conversation.decideApproval).toHaveBeenCalledTimes(3)
    })
    expect(restarted.server.requestsFor('session/start')).toHaveLength(2)
    // The conversation runs on another model.
    t.hold(shellRequest('a4'), 'muse-spark-1.3', newHost)
    answer(restarted, await reviewTurn(restarted, 3), CAPTURED_REPLY)
    await vi.waitFor(() => {
      expect(t.conversation.decideApproval).toHaveBeenCalledTimes(4)
    })
    expect(restarted.server.requestsFor('session/start').at(-1)?.params).toMatchObject({
      modelId: 'muse-spark-1.3',
    })
    // Muse Code exited.
    restarted.exit(1)
    await new Promise((resolve) => setTimeout(resolve, 50))
    t.hold(shellRequest('a5'), 'muse-spark-1.3', newHost)
    answer(restarted, await reviewTurn(restarted, 4), CAPTURED_REPLY)
    await vi.waitFor(() => {
      expect(t.conversation.decideApproval).toHaveBeenCalledTimes(5)
    })
    expect(restarted.server.requestsFor('session/start')).toHaveLength(4)
    expect(t.sideIds).toEqual(['side-1', 'side-1', 'side-2', 'side-3', 'side-4'])
  })

  it(`starts a fresh side session after ${String(MUSE_CODE_REVIEWER_TURNS_PER_SESSION)} reviews`, async () => {
    const t = setup()
    for (let index = 1; index <= MUSE_CODE_REVIEWER_TURNS_PER_SESSION + 1; index += 1) {
      await allowOnce(t, index, shellRequest(`a${String(index)}`))
    }
    expect(t.handle.server.requestsFor('session/start')).toHaveLength(2)
    const last = await reviewTurn(t.handle, MUSE_CODE_REVIEWER_TURNS_PER_SESSION + 1)
    expect(last.sessionId).toBe('side-2')
  })

  it('shows the card without the reviewer’s answer when it may no longer allow it', async () => {
    const t = setup()
    t.mayAllow.value = false
    t.hold()
    answer(t.handle, await reviewTurn(t.handle, 1), CAPTURED_REPLY)
    await vi.waitFor(() => {
      expect(t.cards).toEqual([[expect.anything(), undefined]])
    })
    expect(t.conversation.decideApproval).not.toHaveBeenCalled()
  })

  it('shows nothing for an approval settled, or a conversation gone, while it was reviewed', async () => {
    const t = setup()
    t.hold(shellRequest('a1'))
    const turn = await reviewTurn(t.handle, 1)
    expect(
      t.approvals.resolved({
        type: 'approvalResolved',
        approvalId: 'a1',
        itemId: 'a1',
        decision: 'abort',
        resolvedBy: 'user',
      }),
    ).toBeUndefined()
    answer(t.handle, turn, CAPTURED_REPLY)
    t.hold(shellRequest('a2'))
    const next = await reviewTurn(t.handle, 2)
    t.approvals.forget()
    answer(t.handle, next, CAPTURED_REPLY)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(t.cards).toEqual([])
    expect(t.conversation.decideApproval).not.toHaveBeenCalled()
  })

  it('hands every approval it holds to the user at once when Auto is left', async () => {
    const t = setup()
    t.hold()
    await reviewTurn(t.handle, 1)
    t.approvals.release()
    expect(t.cards).toEqual([
      [expect.objectContaining({ approvalId: RACE_APPROVAL_ID }), undefined],
    ])
  })

  it('shows the card when its answer cannot be sent, and nothing when the approval was settled', async () => {
    const failing = setup()
    failing.conversation.decideApproval.mockRejectedValueOnce(new Error('connection closed'))
    failing.hold()
    answer(failing.handle, await reviewTurn(failing.handle, 1), CAPTURED_REPLY)
    await vi.waitFor(() => {
      expect(failing.cards).toEqual([[expect.anything(), UI_TEXT.autoReviewerFailed]])
    })
    const settled = setup()
    settled.conversation.decideApproval.mockRejectedValueOnce(
      new PromptSettledError('alreadySettled', 'approval closed'),
    )
    settled.hold()
    answer(settled.handle, await reviewTurn(settled.handle, 1), CAPTURED_REPLY)
    await vi.waitFor(() => {
      expect(settled.conversation.decideApproval).toHaveBeenCalledOnce()
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(settled.cards).toEqual([])
  })

  it('shows the failure card immediately when the host exits during the review', async () => {
    const t = setup()
    t.hold()
    answer(t.handle, await reviewTurn(t.handle, 1), CAPTURED_REPLY, { isEnded: false })
    t.handle.exit(1)
    await expectFailure(t)
  })

  it('lets its side session go with the window', async () => {
    const t = setup()
    await allowOnce(t)
    t.reviewer.dispose()
    await vi.waitFor(() => {
      expect(t.handle.server.requestsFor('task/stopAll')).toHaveLength(1)
    })
  })
})
