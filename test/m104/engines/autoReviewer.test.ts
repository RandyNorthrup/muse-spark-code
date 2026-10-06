import { describe, expect, it, vi } from 'vitest'
import { createRuntimeAutoReviewer } from '../../../src/runtime/features/autoReviewer'
import * as bundle from '../../../src/host/review/museCodeReviewerEntry'
import { MuseCodeHost } from '../../../src/core/backends/musecode/MuseCodeHost'
import { mapNotification } from '../../../src/core/backends/musecode/mapNotification'
import { failureForLog } from '../../../src/core/backends/musecode/logText'
import { UI_TEXT } from '../../../src/shared/constants'
import { FakeLogOutputChannel } from '../../unit/helpers/fakes'
import { FakeAgentSession } from '../../unit/helpers/fakeAgent'
import { fakeMspHost } from '../../unit/helpers/fakeMsp'
import { raceRequested } from '../../unit/helpers/stageRaceCapture'
import {
  CAPTURED_REPLY,
  reviewReplyFrames,
  reviewTurnCompleted,
  reviewTurnStarted,
  sideSessionStarted,
} from '../../unit/helpers/reviewerCapture'
import { engineFixtures } from './fixtures'

const fixtures = engineFixtures()
async function setup() {
  const root = await fixtures.folder('m104-pb-auto-')
  const state = { isTrusted: true, canReview: true, isCurrent: true, isOn: true }
  const load = vi.fn(() => bundle)
  const log = new FakeLogOutputChannel()
  const owner = fixtures.own(
    createRuntimeAutoReviewer(
      {
        root,
        bundlePath: 'owned-muse-reviewer.js',
        loadBundle: load,
        log,
        isOn: () => state.isOn,
        isTrusted: () => state.isTrusted,
        canReview: () => state.canReview,
        assertCurrent: () => {
          if (!state.isCurrent) throw new Error('replaced')
        },
      },
      UI_TEXT,
      'en',
    ),
  )
  const handle = fakeMspHost()
  const host = new MuseCodeHost(handle.host, log)
  handle.server.handle('session/start', (params) =>
    sideSessionStarted('side', params['workspaceRoot'], params['modelId']),
  )
  for (const method of ['session/setReasoningEffort', 'turn/cancel', 'task/stopAll'])
    handle.server.handle(method, (params) => ({
      commandId: params['commandId'],
      status: 'accepted',
    }))
  handle.server.handle('turn/start', (params) =>
    reviewTurnStarted(params['commandId'], 'review-turn'),
  )
  fixtures.own({ dispose: () => host.close() })
  const session = new FakeAgentSession('s1', 'muse-spark-1.3-contributor')
  const cards = vi.fn()
  function hold() {
    const mapped = mapNotification({ method: 'approval/requested', params: raceRequested('s1') })
    if (
      typeof mapped === 'string' ||
      !('event' in mapped) ||
      mapped.event.type !== 'approvalRequested'
    )
      throw new Error('capture did not map')
    const approvals = owner.reviewer.reviewer().conversation({
      showCard: cards,
      notice: () => undefined,
      mayAllow: () => true,
      log,
      describeFailure: failureForLog,
    })
    approvals.hold(mapped.event, {
      session,
      host: () => Promise.resolve(host),
      modelId: session.modelId,
      request: {
        userRequest: 'Count the lines',
        recentCalls: [],
        tool: mapped.event.toolName,
        action: mapped.event.rawArgs,
        workspaceRoot: root,
        platform: process.platform,
      },
    })
    return approvals
  }
  function answer() {
    for (const frame of reviewReplyFrames('side', 'review-turn', CAPTURED_REPLY))
      handle.server.notify(frame.method, frame.params)
    handle.server.notify('turn/completed', reviewTurnCompleted('side', 'review-turn'))
  }
  return { owner, state, load, handle, session, cards, hold, answer }
}

describe('portable Auto reviewer owner', () => {
  it.each(['isTrusted', 'canReview', 'isCurrent', 'isOn'] as const)(
    'refuses %s before loading or starting a side session',
    async (field) => {
      const rig = await setup()
      rig.state[field] = false
      expect(rig.owner.reviewer.isOn()).toBe(false)
      expect(() => rig.owner.reviewer.reviewer()).toThrow(UI_TEXT.autoReviewerFailed)
      expect(rig.load).not.toHaveBeenCalled()
      expect(rig.handle.server.requestsFor('session/start')).toHaveLength(0)
    },
  )
  it('uses the captured reviewer answer to allow only the exact original request once', async () => {
    const rig = await setup()
    rig.hold()
    await vi.waitFor(() => {
      expect(rig.handle.server.requestsFor('turn/start')).toHaveLength(1)
    })
    rig.answer()
    await vi.waitFor(() => {
      expect(rig.session.decideApproval.mock.calls).toHaveLength(1)
    })
    expect(rig.session.decideApproval.mock.calls[0]?.[0].choiceId).toBe('allow_once')
    expect(rig.cards).not.toHaveBeenCalled()
    expect(rig.owner.reviewer.isSideSession('side')).toBe(true)
  })
  it('leaves the card after capability withdrawal while the captured reply is pending', async () => {
    const rig = await setup()
    rig.hold()
    await vi.waitFor(() => {
      expect(rig.handle.server.requestsFor('turn/start')).toHaveLength(1)
    })
    rig.state.canReview = false
    rig.answer()
    await vi.waitFor(() => {
      expect(rig.cards).toHaveBeenCalledOnce()
    })
    expect(rig.session.decideApproval.mock.calls).toHaveLength(0)
  })
  it('cancels a running review and drains cleanup before profile release', async () => {
    const rig = await setup()
    rig.hold()
    await vi.waitFor(() => {
      expect(rig.handle.server.requestsFor('turn/start')).toHaveLength(1)
    })
    await rig.owner.dispose()
    expect(rig.handle.server.requestsFor('turn/cancel')).toHaveLength(1)
    expect(rig.session.decideApproval.mock.calls).toHaveLength(0)
    expect(rig.owner.reviewer.isOn()).toBe(false)
  })
})
