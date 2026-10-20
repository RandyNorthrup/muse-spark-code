// The Auto reviewer's approval failures (src/host/review/museCodeReviewer.ts,
// src/host/review/reviewedApprovals.ts): a review that cannot run and a
// review that cannot be asked leave the card to the user and are recorded
// by kind only; an answer that settled meanwhile is the host's own news,
// never the failure's words.
import { describe, expect, it } from 'vitest'
import {
  type AgentHost,
  type AgentSession,
  PromptSettledError,
} from '../../src/core/agent/agentBackend'
import { failureForLog } from '../../src/core/backends/musecode/logText'
import { ReviewBreaker } from '../../src/core/backends/modelapi/autoReviewer'
import { UI_TEXT } from '../../src/shared/constants'
import { MuseCodeReviewer } from '../../src/host/review/museCodeReviewer'
import {
  ReviewedApprovals,
  type ReviewedApprovalsDeps,
  type ReviewHold,
} from '../../src/host/review/reviewedApprovals'
import { recordLog } from './helpers/recordLog'
import { usingTempDir } from './helpers/temporaryFolders'

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

function hold(session: AgentSession, host: AgentHost): ReviewHold {
  return {
    session,
    host: () => Promise.resolve(host),
    modelId: 'model',
    request: {
      userRequest: undefined,
      recentCalls: [],
      tool: 'bash',
      action: '{}',
      workspaceRoot: '',
      platform: process.platform,
    },
  }
}

describe('ReviewedApprovals', () => {
  it('leaves the card to the user when the review cannot run, by kind only', async () => {
    await usingTempDir('reviewed-approvals-', async (root) => {
      const { log, warnings } = recordLog()
      const { cards, showCard } = recordCards()
      const startFailure = new Error('side session refused at /secret/path')
      const host = {
        startSession: () => Promise.reject(startFailure),
      } as unknown as AgentHost
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
      const session = { sessionId: 'session-1' } as unknown as AgentSession
      try {
        approvals.hold(approvalEvent(), hold(session, host))
        await settled(() => cards.length > 0)
      } finally {
        reviewer.dispose()
      }
      expect(cards).toHaveLength(1)
      expect(cards[0]?.note).toBe(UI_TEXT.autoReviewerFailed)
      expect(warnings.length).toBeGreaterThan(0)
      for (const warning of warnings) {
        expect(warning).toContain('Error')
        expect(warning).not.toContain('/secret/path')
      }
    })
  })

  it('leaves the card to the user when the review cannot be asked, by kind only', async () => {
    const { log, warnings } = recordLog()
    const { cards, showCard } = recordCards()
    const askFailure = new Error('review refused at /secret/path')
    const deps: ReviewedApprovalsDeps = {
      showCard: (event, note) => {
        showCard(event, note)
      },
      notice: () => undefined,
      mayAllow: () => false,
      log,
      describeFailure: failureForLog,
    }
    const approvals = new ReviewedApprovals(
      deps,
      new ReviewBreaker(),
      () => Promise.reject(askFailure),
      () => false,
    )
    const session = { sessionId: 'session-1' } as unknown as AgentSession
    const host = {} as unknown as AgentHost
    approvals.hold(approvalEvent(), hold(session, host))
    await settled(() => cards.length > 0)
    expect(cards).toHaveLength(1)
    expect(cards[0]?.note).toBe(UI_TEXT.autoReviewerFailed)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Error')
    expect(warnings[0]).not.toContain('/secret/path')
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
    const approvals = new ReviewedApprovals(
      deps,
      new ReviewBreaker(),
      () => Promise.resolve({ decision: 'allow', reason: 'reads only', hasTripped: false }),
      () => false,
    )
    const decideFailure = new PromptSettledError('gone', 'settled at /secret/path')
    const session = {
      sessionId: 'session-1',
      decideApproval: () => Promise.reject(decideFailure),
    } as unknown as AgentSession
    const host = {} as unknown as AgentHost
    approvals.hold(approvalEvent(), hold(session, host))
    await settled(() => infos.some((line) => line.includes('answer to')) || cards.length > 0)
    expect(cards).toHaveLength(0)
    expect(infos.some((line) => line.includes('PromptSettledError'))).toBe(true)
    for (const line of infos) {
      expect(line).not.toContain('/secret/path')
    }
  })
})
