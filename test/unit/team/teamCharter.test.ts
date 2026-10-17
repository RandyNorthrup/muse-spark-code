// Lane R (M96, PLAN.md D75): the charter generator.

import { describe, expect, it } from 'vitest'
import {
  TEAM_MODEL_TEXT,
  TEAM_TOOL_GROUP_TOOLS,
  type TeamToolGroup,
} from '../../../src/shared/constants'
import {
  buildTeamCharter,
  type CharterRole,
  type CharterTools,
} from '../../../src/core/team/charter'
import { describeToolsForCharter, resolveTeamToolset } from '../../../src/core/team/toolsets'

function charterTools(
  groups: readonly TeamToolGroup[],
  writePaths?: readonly string[],
): CharterTools {
  return resolveTeamToolset(
    { groups, writePaths },
    {
      offered: groups.flatMap((group) => TEAM_TOOL_GROUP_TOOLS[group]),
      webSearchAllowed: true,
      imagesAllowed: true,
      delegates: [],
    },
  )
}

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
  it('uses the met tool names without claiming withheld write capabilities', () => {
    const resolved = resolveTeamToolset(
      { groups: ['write', 'report'], writePaths: ['docs/**'] },
      {
        offered: ['edit_file', 'report'],
        webSearchAllowed: false,
        imagesAllowed: false,
        delegates: [],
      },
    )
    const { generated } = buildTeamCharter(
      { ...RESEARCH, workspace: 'own-branch', writePaths: ['docs/**'] },
      resolved,
    )
    expect(generated).toContain(`You may: ${resolved.youMay}.`)
    expect(generated).toContain('edit_file')
    expect(generated).not.toContain('create and edit files')
    expect(generated).not.toContain('write_file')
    expect(generated).not.toContain('{commands}')
    expect(generated).not.toContain('{delegateClause}')
  })
  it('lays its parts out in the plan order', () => {
    const { charter } = buildTeamCharter(
      RESEARCH,
      charterTools(['read', 'codeIntel', 'readOnlyShell', 'report']),
    )
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
      charterTools(groups, ['docs/**']),
    )
    expect(generated).toContain(`You may: ${describeToolsForCharter([...groups], ['docs/**'])}.`)
    // The charter says what the tools enforce: an own-branch writer merges never.
    expect(generated).toContain('merged by the orchestrator, never by yourself')
  })

  it('generates the workspace sentence from the resolved mode, never hand-written', () => {
    const ownBranch = buildTeamCharter(
      { ...RESEARCH, workspace: 'own-branch', writePaths: ['docs/**'] },
      charterTools(['read', 'write', 'report']),
    )
    expect(ownBranch.generated).toContain('Your workspace is your own branch')
    expect(ownBranch.generated).not.toContain('Your workspace is read-only')
  })

  it('names delegates only where the role has them', () => {
    const solo = buildTeamCharter(RESEARCH, charterTools(['read', 'report']))
    expect(solo.generated).toContain('start a worker;')
    expect(solo.generated).not.toContain('Through `delegate`')
    const lead = buildTeamCharter(
      { ...RESEARCH, delegates: ['qa', 'engineering'] },
      charterTools(['read', 'report']),
    )
    expect(lead.generated).toContain(
      'except through `delegate` for these roles only: qa, engineering',
    )
  })

  it('falls back to the report shape when done is missing, and keeps a filed done', () => {
    const review = buildTeamCharter(
      { ...RESEARCH, report: 'review' },
      charterTools(['read', 'report']),
    )
    expect(review.generated).toContain(TEAM_MODEL_TEXT.teamDoneDefaultReview)
    const filed = buildTeamCharter(
      { ...RESEARCH, done: 'Ship it.' },
      charterTools(['read', 'report']),
    )
    expect(filed.generated).toContain('Done means: Ship it.')
  })

  it('holds no task-specific bytes: one role and entry starts with the same bytes', () => {
    const first = buildTeamCharter(RESEARCH, charterTools(['read', 'report']))
    const second = buildTeamCharter(RESEARCH, charterTools(['read', 'report']))
    expect(second.charter).toBe(first.charter)
    expect(first.generated).not.toContain('agents/research/task-123')
    expect(first.generated).not.toContain('2026-10-04')
  })

  it('keeps the generated parts when only the user text changes', () => {
    const before = buildTeamCharter(RESEARCH, charterTools(['read', 'report']))
    const after = buildTeamCharter(
      { ...RESEARCH, description: 'Other words.', done: 'Other done.', body: 'Other method.' },
      charterTools(['read', 'report']),
    )
    expect(after.charter).not.toBe(before.charter)
    // The generated parts before "Your purpose" and after it are unchanged
    // except the two user-word slots.
    expect(after.generated).toContain(before.generated.split('Your purpose:', 2)[0] ?? '')
  })
})
