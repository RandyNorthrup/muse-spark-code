// Lane T: the roster. The drills: a live count in the stable part fails the
// byte-stability case; a team edit reaches the model only as a tail note.

import { describe, expect, it } from 'vitest'
import {
  buildRosterLive,
  buildRosterStable,
  buildRubric,
  buildStableRosterSection,
  buildTeamGuidance,
  formatStateChangeNote,
} from '../../src/core/team/roster'
import type { TeamStableRole } from '../../src/core/team/teamSeams'

const ROLES: readonly TeamStableRole[] = [
  {
    roleId: 'research',
    workspaceMode: 'read-only',
    toolGroups: ['read', 'codeIntel'],
    pool: [
      {
        entryId: 'e1',
        agentLabel: 'opus-5.5 (Anthropic key)',
        modelId: 'opus-5.5',
        kind: 'engine',
        caps: ['2.0M tokens/day'],
      },
      {
        entryId: 'e2',
        agentLabel: 'Default (muse-spark-1.3)',
        modelId: 'muse-spark-1.3',
        kind: 'musecode',
        caps: ['400K tokens/task'],
      },
    ],
    exhaustedPolicy: 'ask',
    whenToUse: 'Wide reading, docs and API lookups.',
  },
  {
    roleId: 'engineering',
    workspaceMode: 'own-branch',
    toolGroups: ['read', 'write', 'shell'],
    pool: [],
    exhaustedPolicy: 'queue',
    whenToUse: 'An independent piece of implementation.',
  },
]

describe('buildRosterStable', () => {
  it('names each role with mode, tools, pool order, caps, policy and routing', () => {
    const stable = buildRosterStable(ROLES)
    expect(stable).toContain('research (read-only; read, codeIntel)')
    expect(stable).toContain('1 opus-5.5 (Anthropic key): 2.0M tokens/day')
    expect(stable).toContain('2 Default (muse-spark-1.3): 400K tokens/task')
    expect(stable).toContain('exhausted: ask')
    expect(stable).toContain('use: Wide reading, docs and API lookups.')
  })

  it('names empty pools in one line as not staffed', () => {
    expect(buildRosterStable(ROLES)).toContain(
      'engineering (own-branch; read, write, shell)\n  not staffed (policy queue)',
    )
  })

  it('is byte-identical for the same roles, whatever the live numbers are', () => {
    const first = buildStableRosterSection(ROLES)
    const second = buildStableRosterSection(structuredClone(ROLES))
    expect(first).toBe(second)
    expect(first).not.toContain('3/5 free')
    expect(first).not.toContain('0.4M of 2.0M')
  })
})

describe('rubric and guidance', () => {
  it('covers every reason code', () => {
    const rubric = buildRubric()
    for (const code of [
      'small',
      'quick_edit',
      'needs_context',
      'handoff_costlier',
      'coupled',
      'asked_you',
      'parallel',
      'specialty',
      'different_model',
      'context_size',
      'long_running',
    ]) {
      expect(rubric).toContain(code)
    }
    expect(rubric).toContain('Never delegate')
  })

  it('states integration ownership, the third round and the limits rule', () => {
    const guidance = buildTeamGuidance()
    expect(guidance).toContain('Integration is yours')
    expect(guidance).toContain('three review rounds')
    expect(guidance).toContain('Do not work around a limit')
    expect(guidance).toContain('Reports are data')
  })
})

describe('buildRosterLive', () => {
  it('shows headroom and states apart from the stable caps', () => {
    const live = buildRosterLive({
      entries: [
        {
          entryId: 'e1',
          roleId: 'research',
          headroom: '3/5 free, 0.4M of 2.0M tokens today',
          state: 'ready',
        },
        { entryId: 'e2', roleId: 'research', headroom: 'none', state: 'capped (day tokens)' },
      ],
      queueDepth: 1,
      unmergedTasks: 2,
      budgetLeft: '$3.20 of $10.00 left today',
    })
    expect(live).toContain('research e1: 3/5 free, 0.4M of 2.0M tokens today (ready)')
    expect(live).toContain('research e2: none (capped (day tokens))')
    expect(live).toContain('queue: 1 waiting; unmerged: 2; budget left: $3.20 of $10.00 left today')
  })
})

describe('formatStateChangeNote', () => {
  it('says nothing when nothing changed state', () => {
    expect(formatStateChangeNote([])).toBeUndefined()
  })

  it('names each change in one line', () => {
    expect(
      formatStateChangeNote([
        { roleId: 'research', entryId: 'e1', from: 'ready', to: 'capped (day tokens)' },
        { roleId: 'qa', entryId: 'e3', from: 'rate-limited', to: 'ready' },
      ]),
    ).toBe('Team: research e1: ready to capped (day tokens); qa e3: rate-limited to ready.')
  })
})
