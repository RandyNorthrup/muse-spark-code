// The Auto reviewer's approval failures (src/host/review/museCodeReviewer.ts,
// src/host/review/reviewedApprovals.ts): a review that cannot run and a
// review that cannot be asked leave the card to the user and are recorded
// by kind only; an answer that settled meanwhile is the host's own news,
// never the failure's words. Hosts and sessions are the product's own
// MuseCodeHost/MuseSession over the SDK's real Connection, fed by the
// recorded 1.4.7 capture (see helpers/museReplay.ts): refused methods fail
// through the real host code, and the settled refusal maps through the
// product's own settled-kinds table to a real PromptSettledError.
import { afterEach, describe, expect, it } from 'vitest'
import { failureForLog } from '../../src/core/backends/musecode/logText'
import { ReviewBreaker } from '../../src/core/backends/modelapi/autoReviewer'
import { UI_TEXT } from '../../src/shared/constants'
import { MuseCodeReviewer } from '../../src/host/review/museCodeReviewer'
import {
  ReviewedApprovals,
  type ReviewedApprovalsDeps,
} from '../../src/host/review/reviewedApprovals'
import { recordLog } from './helpers/recordLog'
import { usingTempDir } from './helpers/temporaryFolders'
import {
  closeLiveHosts,
  refuseUnscripted,
  startLiveHost,
  startLiveSession,
  startResult,
} from './helpers/museReplay'

afterEach(async () => {
  await closeLiveHosts()
})

function recordCards() {
  const cards: { readonly note: string | undefined }[] = []
  return {
    cards,
    showCard: (_event: unknown, note: string | undefined) => {
      cards.push({ note })
    },
  }
}

async function settled(isDone: () => boolean): Promise<void> {
  for (let waited = 0; waited < 100 && !isDone(); waited += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

// The held approval's identifying fields; the probes below never pick.
function approvalEvent() {
  return {
    approvalId: 'approval-1',
    turnId: 'turn-1',
    toolName: 'bash',
    rawArgs: '{}',
    requirementId: { sourceIndex: 0 },
    availableChoices: [{ choiceId: 'allow-once', decision: 'approved', scope: 'once' }],
  } as unknown as Parameters<ReviewedApprovals['hold']>[0]
}

function reviewRequest() {
  return {
    userRequest: undefined,
    recentCalls: [],
    tool: 'bash',
    action: '{}',
    workspaceRoot: '',
    platform: process.platform,
  }
}

describe('ReviewedApprovals', () => {
  it('leaves the card to the user when the review cannot run, by kind only', async () => {
    await usingTempDir('reviewed-approvals-', async (root) => {
      const { log, warnings, infos } = recordLog()
      const { cards, showCard } = recordCards()
      // The conversation's own session starts; the reviewer's side session
      // never does: the CLI refuses through the real host.
      const conversation = await startLiveSession(() => {
        throw new Error('unexpected method')
      })
      const reviewing = startLiveHost((method) => {
        if (method === 'session/start') return refuseUnscripted(method)
        throw new Error(`unexpected ${method}`)
      })
      const reviewer = new MuseCodeReviewer({
        root,
        log,
        onSideSession: () => undefined,
        describeFailure: failureForLog,
        timeoutMs: 1000,
      })
      const approvals = reviewer.conversation({
        showCard: (event, note) => {
          showCard(event, note)
        },
        notice: () => undefined,
        mayAllow: () => false,
        log,
        describeFailure: failureForLog,
      })
      try {
        approvals.hold(approvalEvent(), {
          session: conversation.session,
          host: () => Promise.resolve(reviewing.host),
          modelId: 'model',
          request: reviewRequest(),
        })
        await settled(() => cards.length > 0)
      } finally {
        reviewer.dispose()
      }
      expect(cards).toHaveLength(1)
      expect(cards[0]?.note).toBe(UI_TEXT.autoReviewerFailed)
      expect(warnings.length).toBeGreaterThan(0)
      for (const warning of warnings) {
        expect(warning).toContain('harnessGap')
        expect(warning).not.toContain('/secret/path')
      }
      for (const line of infos) {
        expect(line).not.toContain('/secret/path')
      }
    })
  })

  it('leaves the card to the user when the review cannot be asked, by kind only', async () => {
    await usingTempDir('reviewed-approvals-', async (root) => {
      const { log, warnings, infos } = recordLog()
      const { cards, showCard } = recordCards()
      const conversation = await startLiveSession(() => {
        throw new Error('unexpected method')
      })
      // The side session starts, but its turn is refused through the real host.
      const reviewing = startLiveHost((method) => {
        if (method === 'session/start') return { result: startResult }
        if (method === 'turn/start') return refuseUnscripted(method)
        if (method === 'turn/cancel') return { result: {} }
        if (method === 'task/stopAll') return { result: {} }
        throw new Error(`unexpected ${method}`)
      })
      const reviewer = new MuseCodeReviewer({
        root,
        log,
        onSideSession: () => undefined,
        describeFailure: failureForLog,
        timeoutMs: 1000,
      })
      const approvals = reviewer.conversation({
        showCard: (event, note) => {
          showCard(event, note)
        },
        notice: () => undefined,
        mayAllow: () => false,
        log,
        describeFailure: failureForLog,
      })
      try {
        approvals.hold(approvalEvent(), {
          session: conversation.session,
          host: () => Promise.resolve(reviewing.host),
          modelId: 'model',
          request: reviewRequest(),
        })
        await settled(() => cards.length > 0)
      } finally {
        reviewer.dispose()
      }
      expect(cards).toHaveLength(1)
      expect(cards[0]?.note).toBe(UI_TEXT.autoReviewerFailed)
      expect(warnings.length).toBeGreaterThan(0)
      for (const warning of warnings) {
        expect(warning).toContain('harnessGap')
        expect(warning).not.toContain('/secret/path')
      }
      for (const line of infos) {
        expect(line).not.toContain('/secret/path')
      }
    })
  })

  it('takes a settled answer as the host news, never the failure words', async () => {
    const { log, infos } = recordLog()
    const { cards, showCard } = recordCards()
    const deps: ReviewedApprovalsDeps = {
      showCard: (event, note) => {
        showCard(event, note)
      },
      notice: () => undefined,
      mayAllow: () => true,
      log,
      describeFailure: failureForLog,
    }
    // The review allows it; the decision lands after the prompt settled, so
    // the CLI refuses with its settled kind and the product maps it to a
    // real PromptSettledError.
    const live = await startLiveSession((method) => {
      if (method === 'approval/decide')
        return {
          error: {
            code: -32_602,
            data: { kind: 'approvalAlreadyResolved', retryable: false },
            message: 'settled at /secret/path',
          },
        }
      if (method === 'task/stopAll') return { result: {} }
      throw new Error(`unexpected ${method}`)
    })
    const approvals = new ReviewedApprovals(
      deps,
      new ReviewBreaker(),
      () => Promise.resolve({ decision: 'allow', reason: 'reads only', hasTripped: false }),
      () => false,
    )
    approvals.hold(approvalEvent(), {
      session: live.session,
      host: () => Promise.resolve(live.host),
      modelId: 'model',
      request: reviewRequest(),
    })
    await settled(() => infos.some((line) => line.includes('answer to')) || cards.length > 0)
    expect(cards).toHaveLength(0)
    expect(infos.some((line) => line.includes('PromptSettledError'))).toBe(true)
    for (const line of infos) {
      expect(line).not.toContain('/secret/path')
    }
  })
})
