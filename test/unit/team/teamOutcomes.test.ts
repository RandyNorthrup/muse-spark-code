// M120 lane 5 (PLAN.md D103): per-role, per-candidate outcome recorder,
// reorder suggestions from recorded outcomes, and opt-in auto-order.

import { describe, expect, it } from 'vitest'
import { TEAM_LEARNED_MIN_TASKS } from '../../../src/shared/constants'
import { teamPreferenceListSchema, type TeamOutcomeStats } from '../../../src/shared/teamPreference'
import {
  applyRoleAutoOrder,
  recordOutcome,
  suggestRoleReorder,
  teamTaskOutcomeSchema,
  type TeamTaskOutcome,
} from '../../../src/core/team/outcomes'

function outcome(overrides: Partial<TeamTaskOutcome> = {}): TeamTaskOutcome {
  return {
    roleId: 'frontend',
    candidateId: 'muse',
    roundsToAcceptance: 1,
    findings: [],
    durationMs: 60_000,
    redesign: false,
    ...overrides,
  }
}

function statsFor(candidateId: string, accepted: number, tasks: number): TeamOutcomeStats {
  let stats: TeamOutcomeStats | undefined
  for (let i = 0; i < tasks; i += 1) {
    stats = recordOutcome(stats, outcome({ candidateId, roundsToAcceptance: i < accepted ? 1 : 3 }))
  }
  if (stats === undefined) {
    throw new Error('stats need at least one task')
  }
  return stats
}

function backendStats(): TeamOutcomeStats {
  let stats: TeamOutcomeStats | undefined
  for (let i = 0; i < 5; i += 1) {
    stats = recordOutcome(stats, outcome({ roleId: 'backend', roundsToAcceptance: 1 }))
  }
  if (stats === undefined) {
    throw new Error('stats need at least one task')
  }
  return stats
}

const list = teamPreferenceListSchema.parse({
  role: 'frontend',
  workspace: 'own-branch',
  continueOnNext: false,
  pool: [
    { id: 'codex', concurrent: 1, caps: [] },
    { id: 'muse', concurrent: 1, caps: [] },
  ],
})

describe('recordOutcome', () => {
  it('starts a record from one task and accumulates the next', () => {
    const first = recordOutcome(
      undefined,
      outcome({ roundsToAcceptance: 1, findings: ['high', 'low'], durationMs: 1000 }),
    )
    expect(first).toStrictEqual({
      roleId: 'frontend',
      candidateId: 'muse',
      tasks: 1,
      firstReviewAccepted: 1,
      findings: { critical: 0, high: 1, medium: 0, low: 1, info: 0 },
      roundsToAcceptance: 1,
      durationMs: 1000,
      redesigns: 0,
    })
    const second = recordOutcome(first, outcome({ roundsToAcceptance: 3, redesign: true }))
    expect(second.tasks).toBe(2)
    expect(second.firstReviewAccepted).toBe(1)
    expect(second.roundsToAcceptance).toBe(4)
    expect(second.redesigns).toBe(1)
  })

  it('refuses a record for another role or candidate instead of merging it', () => {
    const base = recordOutcome(undefined, outcome())
    expect(() => recordOutcome(base, outcome({ roleId: 'backend' }))).toThrow()
    expect(() => recordOutcome(base, outcome({ candidateId: 'codex' }))).toThrow()
  })

  it('refuses tasks without review rounds and unknown severities', () => {
    expect(teamTaskOutcomeSchema.safeParse(outcome({ roundsToAcceptance: 0 })).success).toBe(false)
    expect(
      teamTaskOutcomeSchema.safeParse({ ...outcome(), findings: ['catastrophic'] }).success,
    ).toBe(false)
  })
})

describe('suggestRoleReorder', () => {
  it('suggests the clearly better candidate with its figures', () => {
    const stats = [statsFor('muse', 4, 5), statsFor('codex', 1, 5)]
    for (const entry of stats) {
      expect(entry.tasks).toBeGreaterThanOrEqual(TEAM_LEARNED_MIN_TASKS)
    }
    const suggestion = suggestRoleReorder({ roleId: 'frontend', order: ['codex', 'muse'], stats })
    expect(suggestion?.suggestedOrder).toStrictEqual(['muse', 'codex'])
    expect(suggestion?.reason).toBe(
      'muse: 4 of 5 frontend tasks accepted on first review; codex: 1 of 5.',
    )
  })

  it('stays quiet below the evidence bar or without a clear gap', () => {
    const thin = [statsFor('muse', 3, 3), statsFor('codex', 0, 4)]
    expect(
      suggestRoleReorder({ roleId: 'frontend', order: ['codex', 'muse'], stats: thin }),
    ).toBeUndefined()
    const close = [statsFor('muse', 4, 5), statsFor('codex', 3, 5)]
    expect(
      suggestRoleReorder({ roleId: 'frontend', order: ['codex', 'muse'], stats: close }),
    ).toBeUndefined()
    const ordered = [statsFor('codex', 4, 5), statsFor('muse', 1, 5)]
    expect(
      suggestRoleReorder({ roleId: 'frontend', order: ['codex', 'muse'], stats: ordered }),
    ).toBeUndefined()
  })

  it('keeps candidates below the bar in their slots and ignores other roles', () => {
    const stats = [statsFor('muse', 4, 5), statsFor('codex', 1, 5), backendStats()]
    const suggestion = suggestRoleReorder({
      roleId: 'frontend',
      order: ['codex', 'newcomer', 'muse'],
      stats,
    })
    expect(suggestion?.suggestedOrder).toStrictEqual(['muse', 'newcomer', 'codex'])
  })
})

describe('applyRoleAutoOrder', () => {
  const stats = [statsFor('muse', 4, 5), statsFor('codex', 1, 5)]

  it('leaves the pool alone unless the role opted in', () => {
    expect(applyRoleAutoOrder(list, stats)).toBe(list)
    expect(
      applyRoleAutoOrder({ ...list, autoOrder: false }, stats).pool.map((c) => c.id),
    ).toStrictEqual(['codex', 'muse'])
  })

  it('reorders an opted-in pool exactly as the suggestion orders it', () => {
    const reordered = applyRoleAutoOrder({ ...list, autoOrder: true }, stats)
    expect(reordered.pool.map((candidate) => candidate.id)).toStrictEqual(['muse', 'codex'])
    expect(reordered.autoOrder).toBe(true)
  })

  it('keeps an opted-in pool when the record supports its order', () => {
    const supporting = [statsFor('codex', 4, 5), statsFor('muse', 1, 5)]
    const kept = applyRoleAutoOrder({ ...list, autoOrder: true }, supporting)
    expect(kept.pool.map((candidate) => candidate.id)).toStrictEqual(['codex', 'muse'])
  })
})
