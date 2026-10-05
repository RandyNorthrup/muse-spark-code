// Lane R (M96, PLAN.md D75): the workspace team and the lowering merge.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEAM_ENTRY,
  emptyWorkspaceTeam,
  isDefaultEntry,
  lowerTeamWithJson,
  parseTeamJson,
  resolveDefaultEntry,
  resolveWorkspaceTeam,
  staffWithDefault,
  teamJsonPath,
  teamModelIds,
  teamRoleIds,
  type TeamLoweringBase,
} from '../../../src/core/team/teamConfig'

const Muse = { backend: 'museCode' as const, model: 'muse-spark-1.3' }
const CONTRIBUTOR = { backend: 'modelApi' as const, model: 'muse-spark-1.3-contributor' }

describe('Default as an entry', () => {
  it('staffs every role without a custom entry with Default alone', () => {
    const team = staffWithDefault(emptyWorkspaceTeam(), teamRoleIds())
    for (const id of teamRoleIds()) {
      expect(team.roles[id]).toEqual({ entries: [DEFAULT_TEAM_ENTRY] })
    }
    expect(teamRoleIds()).toHaveLength(7)
  })

  it('keeps custom pools, and resolves Default live at each task start', () => {
    const custom = staffWithDefault(
      { roles: { engineering: { entries: [{ kind: 'agent', agent: Muse }] } }, orchestrator: {} },
      teamRoleIds(),
    )
    expect(custom.roles['engineering']?.entries).toHaveLength(1)
    expect(
      isDefaultEntry(custom.roles['research']?.entries[0] ?? { kind: 'agent', agent: Muse }),
    ).toBe(true)
    expect(resolveDefaultEntry(Muse)).toEqual({ kind: 'agent', agent: Muse })
    // A picker change applies to the next delegation.
    expect(resolveDefaultEntry(CONTRIBUTOR)).toEqual({ kind: 'agent', agent: CONTRIBUTOR })
  })
})

describe('resolveWorkspaceTeam', () => {
  it('layers the user default under the workspace choices', () => {
    const team = resolveWorkspaceTeam({
      user: {
        roles: { engineering: { entries: [{ kind: 'agent', agent: Muse }] } },
        orchestrator: { agent: Muse },
      },
      workspace: {
        roles: { research: { entries: [{ kind: 'agent', agent: CONTRIBUTOR }] } },
      },
    })
    expect(team.roles['engineering']?.entries).toEqual([{ kind: 'agent', agent: Muse }])
    expect(team.roles['research']?.entries).toEqual([{ kind: 'agent', agent: CONTRIBUTOR }])
    expect(team.roles['qa']?.entries).toEqual([DEFAULT_TEAM_ENTRY])
    // The workspace did not name an orchestrator: the user's stands.
    expect(team.orchestrator).toEqual({ agent: Muse })
    // Reset to Default restores the picker's behaviour.
    expect(resolveWorkspaceTeam({}).orchestrator).toEqual({})
  })

  it('RVM96RB2 R10: keeps the complete orchestrator slot and settings through workspace resolution', () => {
    const agent = {
      kind: 'engine' as const,
      agentId: 'meta-model-api',
      pays: 'key' as const,
      provider: 'meta',
      model: 'muse-spark-1.3',
    }
    const orchestrator = {
      agent,
      settings: { effort: 'xhigh', outputCap: 100, parallelToolCalls: false },
    }
    const team = resolveWorkspaceTeam({ workspace: { orchestrator } })
    expect(team.orchestrator).toEqual(orchestrator)
    expect(resolveDefaultEntry(agent, orchestrator.settings)).toEqual({
      kind: 'agent',
      agent,
      settings: orchestrator.settings,
    })
    expect(staffWithDefault(team, teamRoleIds()).orchestrator).toEqual(orchestrator)
    expect(resolveWorkspaceTeam({ user: { orchestrator } }).orchestrator).toEqual(orchestrator)
  })

  it('lists the distinct models Default aside', () => {
    const team = resolveWorkspaceTeam({
      workspace: {
        roles: {
          engineering: { entries: [{ kind: 'agent', agent: Muse }] },
          research: { entries: [DEFAULT_TEAM_ENTRY] },
        },
        orchestrator: { agent: Muse },
      },
    })
    expect(teamModelIds(team)).toEqual(['muse-spark-1.3'])
  })
})

describe('teamJsonPath', () => {
  it('names .muse/team.json on both platforms', () => {
    expect(teamJsonPath('/ws', 'linux')).toBe('/ws/.muse/team.json')
    expect(teamJsonPath(String.raw`C:\ws`, 'win32')).toBe(String.raw`C:\ws\.muse\team.json`)
  })
})

const BASE: TeamLoweringBase = {
  roles: {
    engineering: { caps: { concurrent: 2, dayTokens: 20_000 } },
    research: { caps: { dayTokens: 10_000 } },
  },
  budgets: { dayUsd: 50, dayTokens: 25_000_000 },
}

describe('parseTeamJson', () => {
  it('reads a lowering file', () => {
    expect(
      parseTeamJson(
        JSON.stringify({
          roles: { engineering: { caps: { dayTokens: 10_000 } }, research: { off: true } },
          budgets: { dayUsd: 10 },
        }),
      ),
    ).toEqual({
      ok: true,
      file: {
        roles: { engineering: { caps: { dayTokens: 10_000 } }, research: { off: true } },
        budgets: { dayUsd: 10 },
      },
    })
    expect(parseTeamJson('{}')).toEqual({ ok: true, file: { roles: {} } })
  })

  it('refuses a file that adds or widens, whole, naming the key', () => {
    expect(parseTeamJson('nope')).toEqual({ ok: false, reason: 'team.json is not JSON' })
    expect(parseTeamJson(JSON.stringify({ agents: [] }))).toEqual({
      ok: false,
      reason: 'team.json holds an unknown key: agents',
    })
    expect(parseTeamJson(JSON.stringify({ roles: { qa: { workspace: 'in-place' } } }))).toEqual({
      ok: false,
      reason: 'team.json holds an unknown key: roles.qa.workspace',
    })
    expect(parseTeamJson(JSON.stringify({ roles: { qa: { entries: [] } } }))).toEqual({
      ok: false,
      reason: 'team.json holds an unknown key: roles.qa.entries',
    })
    expect(parseTeamJson(JSON.stringify({ roles: { qa: { off: 'yes' } } }))).toEqual({
      ok: false,
      reason: 'team.json holds an invalid roles.qa.off',
    })
    expect(parseTeamJson(JSON.stringify({ roles: { qa: { caps: { dayTokens: -1 } } } }))).toEqual({
      ok: false,
      reason: 'team.json holds an invalid roles.qa.caps.dayTokens',
    })
  })
})

describe('lowerTeamWithJson', () => {
  it('lowers caps and budgets, turns roles off, and names a reviewer', () => {
    const parsed = parseTeamJson(
      JSON.stringify({
        roles: {
          engineering: { caps: { dayTokens: 10_000 }, reviewer: 'code-review' },
          research: { off: true },
        },
        budgets: { dayUsd: 10 },
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }
    expect(lowerTeamWithJson(BASE, parsed.file)).toEqual({
      ok: true,
      lowered: {
        offRoles: ['research'],
        reviewers: { engineering: 'code-review' },
        caps: { engineering: { dayTokens: 10_000 } },
        budgets: { dayUsd: 10 },
      },
    })
  })

  it('refuses a raise or an addition whole', () => {
    const raised = parseTeamJson(
      JSON.stringify({ roles: { engineering: { caps: { dayTokens: 30_000 } } } }),
    )
    expect(raised.ok).toBe(true)
    if (raised.ok) {
      expect(lowerTeamWithJson(BASE, raised.file)).toEqual({
        ok: false,
        reason: 'team.json raises roles.engineering.caps.dayTokens',
      })
    }
    const addedRole = parseTeamJson(JSON.stringify({ roles: { marketing: { off: true } } }))
    if (addedRole.ok) {
      expect(lowerTeamWithJson(BASE, addedRole.file)).toEqual({
        ok: false,
        reason: 'team.json adds a role: marketing',
      })
    }
    const addedCap = parseTeamJson(
      JSON.stringify({ roles: { engineering: { caps: { spend: 5 } } } }),
    )
    if (addedCap.ok) {
      expect(lowerTeamWithJson(BASE, addedCap.file)).toEqual({
        ok: false,
        reason: 'team.json adds a cap: roles.engineering.caps.spend',
      })
    }
    const raisedBudget = parseTeamJson(JSON.stringify({ budgets: { dayUsd: 500 } }))
    if (raisedBudget.ok) {
      expect(lowerTeamWithJson(BASE, raisedBudget.file)).toEqual({
        ok: false,
        reason: 'team.json raises budgets.dayUsd',
      })
    }
  })
})
