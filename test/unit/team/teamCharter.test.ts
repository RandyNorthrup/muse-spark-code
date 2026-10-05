// Lane R (M96, PLAN.md D75): the charter generator.

import { describe, expect, it } from 'vitest'
import { TEAM_MODEL_TEXT } from '../../../src/shared/constants'
import { buildTeamCharter, type CharterRole } from '../../../src/core/team/charter'
import { describeToolsForCharter } from '../../../src/core/team/toolsets'

const RESEARCH: CharterRole = {
  id: 'research',
  description: 'Wide reading with sources.',
  workspace: 'read-only',
  writePaths: undefined,
  done: undefined,
  report: 'summary',
  delegates: [],
  body: 'Start from the question.',
}

describe('buildTeamCharter', () => {
  it('lays its parts out in the plan order', () => {
    const { charter } = buildTeamCharter(RESEARCH, {
      groups: ['read', 'codeIntel', 'readOnlyShell', 'report'],
    })
    const order = [
      'You are the `research` worker',
      'Your purpose: Wide reading with sources.',
      'Your workspace is read-only',
      'You may:',
      'You must never:',
      'Done means:',
      'Hand back',
      'Start from the question.',
    ]
    let at = -1
    for (const part of order) {
      const next = charter.indexOf(part, at + 1)
      expect(next).toBeGreaterThan(at)
      at = next
    }
  })

  it('lists exactly the resolved tools in its "You may" line', () => {
    const groups = ['read', 'write', 'report'] as const
    const { generated } = buildTeamCharter(
      { ...RESEARCH, workspace: 'own-branch', writePaths: ['docs/**'] },
      { groups: [...groups] },
    )
    expect(generated).toContain(`You may: ${describeToolsForCharter([...groups], ['docs/**'])}.`)
    // The charter says what the tools enforce: an own-branch writer merges never.
    expect(generated).toContain('merged by the orchestrator, never by yourself')
  })

  it('generates the workspace sentence from the resolved mode, never hand-written', () => {
    const ownBranch = buildTeamCharter(
      { ...RESEARCH, workspace: 'own-branch', writePaths: ['docs/**'] },
      { groups: ['read', 'write', 'report'] },
    )
    expect(ownBranch.generated).toContain('Your workspace is your own branch')
    expect(ownBranch.generated).not.toContain('Your workspace is read-only')
  })

  it('names delegates only where the role has them', () => {
    const solo = buildTeamCharter(RESEARCH, { groups: ['read', 'report'] })
    expect(solo.generated).toContain('start a worker;')
    expect(solo.generated).not.toContain('Through `delegate`')
    const lead = buildTeamCharter(
      { ...RESEARCH, delegates: ['qa', 'engineering'] },
      { groups: ['read', 'report'] },
    )
    expect(lead.generated).toContain(
      'Through `delegate` you may start workers in these roles only: qa, engineering.',
    )
  })

  it('falls back to the report shape when done is missing, and keeps a filed done', () => {
    const review = buildTeamCharter(
      { ...RESEARCH, report: 'review' },
      { groups: ['read', 'report'] },
    )
    expect(review.generated).toContain(TEAM_MODEL_TEXT.teamDoneDefaultReview)
    const filed = buildTeamCharter(
      { ...RESEARCH, done: 'Ship it.' },
      { groups: ['read', 'report'] },
    )
    expect(filed.generated).toContain('Done means: Ship it.')
  })

  it('holds no task-specific bytes: one role and entry starts with the same bytes', () => {
    const first = buildTeamCharter(RESEARCH, { groups: ['read', 'report'] })
    const second = buildTeamCharter(RESEARCH, { groups: ['read', 'report'] })
    expect(second.charter).toBe(first.charter)
    expect(first.generated).not.toContain('agents/research/task-123')
    expect(first.generated).not.toContain('2026-10-04')
  })

  it('keeps the generated parts when only the user text changes', () => {
    const before = buildTeamCharter(RESEARCH, { groups: ['read', 'report'] })
    const after = buildTeamCharter(
      { ...RESEARCH, description: 'Other words.', done: 'Other done.', body: 'Other method.' },
      { groups: ['read', 'report'] },
    )
    expect(after.charter).not.toBe(before.charter)
    // The generated parts before "Your purpose" and after it are unchanged
    // except the two user-word slots.
    expect(after.generated).toContain(before.generated.split('Your purpose:', 2)[0] ?? '')
  })
})
