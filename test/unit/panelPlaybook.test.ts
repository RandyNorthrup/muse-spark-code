import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { PLAYBOOK_FINDING_CLASSES, PLAYBOOK_LAUNDER_WINDOW_MS } from '../../src/shared/constants'
import type { ReviewBlock, ReviewResolution } from '../../src/shared/reviewFindings'
import type { PanelPlaybookReview } from '../../src/core/orchestration/panelPlaybook'
import { PlaybookRefusedError } from '../../src/core/orchestration/playbookIntegration'
import { integrationFixture } from './helpers/playbookIntegration'
import { answerAll, design, latestRound, reviewBlock } from './playbookPolicyFixture'

function observeRedesign(
  ticket: PanelPlaybookReview,
  policy: ReturnType<typeof integrationFixture>['policy'],
  outcome: ReviewResolution['outcome'],
  reason: string,
): void {
  ticket.bind('redesign')
  ticket.observe(
    reply('redesign', {
      findings: [],
      coverage: [...PLAYBOOK_FINDING_CLASSES],
      resolution: latestRound(policy).findings.map((finding) => ({
        findingId: finding.id,
        outcome,
        reason,
      })),
    }),
  )
}

function reply(turnId: string, block: ReviewBlock): AgentEvent {
  return {
    type: 'itemCompleted',
    item: {
      itemId: `${turnId}-answer`,
      turnId,
      kind: 'agentMessage',
      status: 'completed',
      text: `\`\`\`muse-review\n${JSON.stringify(block)}\n\`\`\``,
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('M116 panel review integration', () => {
  it('counts three independent full reviews on the same files and offers Plan a redesign', async () => {
    const f = integrationFixture()
    const parts = [
      { type: 'text', text: 'M70 request stays unchanged outside the charter' },
    ] as const
    for (let round = 0; round < 3; round += 1) {
      const ticket = f.panel.review('s1', [String.raw`src\core\schedules\store.ts`])
      expect(ticket.parts(parts)).toEqual(parts)
      const turn = `review-${String(round)}`
      const before = f.policy.getRecord().filter((record) => record.kind === 'round').length
      // Native backends can send the result before the submit promise acknowledges it.
      ticket.observe(
        reply('unrelated-turn', { findings: [], coverage: [...PLAYBOOK_FINDING_CLASSES] }),
      )
      ticket.observe(reply(turn, reviewBlock()))
      ticket.observe({ type: 'turnCompleted', turnId: turn, terminal: 'completed' })
      expect(f.policy.getRecord().filter((record) => record.kind === 'round')).toHaveLength(before)
      ticket.bind(turn)
      expect(ticket.isClosed).toBe(true)
      expect(latestRound(f.policy).round).toBe(round + 1)
      expect(answerAll(f.policy).kind).toBe('allow')
    }
    expect(f.registry.review).toHaveBeenCalledWith('s1', ['src/core/schedules/store.ts'])
    expect(f.events.offerRedesign).toHaveBeenCalledWith(f.work.module)
    const patch = vi.fn(() => Promise.resolve())
    await expect(f.panel.dispatch('delegate', 's1', 'next-patch', patch)).rejects.toThrow(
      PlaybookRefusedError,
    )
    expect(patch).not.toHaveBeenCalled()
    expect(f.policy.recordDesignDecision(design()).kind).toBe('allow')
    const ticket = f.panel.review('redesign-session', f.work.module.files)
    ticket.parts(parts)
    expect(f.registry.reviewParts).toHaveBeenLastCalledWith(
      parts,
      expect.any(Object),
      expect.objectContaining({ round: 3, findings: latestRound(f.policy).findings }),
    )
    observeRedesign(ticket, f.policy, 'impossible', 'One atomic claim removes the race.')
    ticket.observe({ type: 'turnCompleted', turnId: 'redesign', terminal: 'completed' })
    expect(f.policy.beforeFixRound(f.work.module).kind).toBe('allow')
  })

  it('does not count incomplete coverage and waits for every prior answer', () => {
    const f = integrationFixture()
    let ticket = f.panel.review('s1', f.work.module.files)
    ticket.bind('partial')
    ticket.observe(reply('partial', { ...reviewBlock(), coverage: ['concurrency'] }))
    ticket.observe({ type: 'turnCompleted', turnId: 'partial', terminal: 'completed' })
    expect(f.policy.getRecord().some((record) => record.kind === 'round')).toBe(false)
    expect(f.events.note.mock.calls.some(([note]) => note.code === 'coverageIncomplete')).toBe(true)
    ticket = f.panel.review('s1', f.work.module.files)
    ticket.bind('full')
    ticket.observe(reply('full', reviewBlock()))
    ticket.observe({ type: 'turnCompleted', turnId: 'full', terminal: 'completed' })
    expect(() => f.panel.review('s1', f.work.module.files)).toThrow(PlaybookRefusedError)
    expect(f.events.note).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: 'answersPending' }),
    )
    answerAll(f.policy)
    f.panel.review('s1', f.work.module.files).cancel()
  })

  it.each(['caught', 'remains'] as const)(
    'keeps %s redesign evidence open and user-first',
    (outcome) => {
      const f = integrationFixture()
      for (let round = 0; round < 3; round += 1) {
        const ticket = f.panel.review('s1', f.work.module.files)
        ticket.bind(String(round))
        ticket.observe(reply(String(round), reviewBlock()))
        ticket.observe({ type: 'turnCompleted', turnId: String(round), terminal: 'completed' })
        answerAll(f.policy)
      }
      f.policy.recordDesignDecision(design())
      const ticket = f.panel.review('s1', f.work.module.files)
      observeRedesign(ticket, f.policy, outcome, 'The original multi-step claim remains.')
      ticket.observe({ type: 'turnCompleted', turnId: 'redesign', terminal: 'completed' })
      expect(f.events.note.mock.calls.some(([note]) => note.needsUser)).toBe(true)
      expect(f.policy.beforeFixRound(f.work.module).kind).toBe('refuse')
    },
  )

  it('refuses model/self-declared reviewer identity conflicts before a request', () => {
    const f = integrationFixture()
    f.registry.review = () => ({
      module: f.work.module,
      agents: {
        implementerId: 'same',
        reviewerId: 'same',
        implementerSessionId: 'session',
        reviewerSessionId: 'session',
      },
    })
    expect(() => f.panel.review('s1', f.work.module.files)).toThrow(PlaybookRefusedError)
    expect(f.events.note).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: 'reviewerConflict' }),
    )
  })

  it('never certifies missing, malformed, duplicate or cancelled review results', () => {
    const f = integrationFixture()
    for (const terminal of ['cancelled', 'failed']) {
      const ticket = f.panel.review('s1', f.work.module.files)
      ticket.bind(terminal)
      ticket.observe(reply(terminal, reviewBlock()))
      ticket.observe({ type: 'turnCompleted', turnId: terminal, terminal })
      expect(ticket.isClosed).toBe(true)
    }
    const missing = f.panel.review('s1', f.work.module.files)
    missing.bind('missing')
    expect(() => {
      missing.observe({ type: 'turnCompleted', turnId: 'missing', terminal: 'completed' })
    }).toThrow()
    const malformed = f.panel.review('s1', f.work.module.files)
    malformed.bind('bad')
    expect(() => {
      malformed.observe({
        type: 'itemCompleted',
        item: {
          itemId: 'bad',
          turnId: 'bad',
          kind: 'agentMessage',
          status: 'completed',
          text: '```muse-review\n{}\n```',
        },
      })
    }).toThrow()
    malformed.cancel()
    const duplicate = f.panel.review('s1', f.work.module.files)
    duplicate.bind('duplicate')
    duplicate.observe(reply('duplicate', reviewBlock()))
    duplicate.observe(reply('duplicate', reviewBlock()))
    expect(() => {
      duplicate.observe({ type: 'turnCompleted', turnId: 'duplicate', terminal: 'completed' })
    }).toThrow()
    expect(f.policy.getRecord().some((record) => record.kind === 'round')).toBe(false)
  })

  it('renewal keeps the admitted generation and cancellation rejects late events', async () => {
    vi.useFakeTimers()
    const f = integrationFixture()
    const renew = vi.spyOn(f.policy, 'renewPatch')
    const ticket = f.panel.review('s1', f.work.module.files)
    ticket.bind('long-review')
    f.advance(PLAYBOOK_LAUNDER_WINDOW_MS / 2)
    await vi.advanceTimersByTimeAsync(PLAYBOOK_LAUNDER_WINDOW_MS / 2)
    expect(renew).toHaveBeenCalled()
    ticket.cancel()
    ticket.observe(reply('long-review', reviewBlock()))
    ticket.observe({ type: 'turnCompleted', turnId: 'long-review', terminal: 'completed' })
    expect(f.policy.getRecord().some((record) => record.kind === 'round')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
