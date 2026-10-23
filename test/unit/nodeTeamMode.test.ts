// M110h lane M: the role matrix holds for every role and action, nobody
// joins before the owner's terms decision, OIDC groups map by the
// person's own table, namespaces and homes cannot cross, one person's
// credential never serves another, and budgets admit or refuse by name
// with every movement audited.
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  admitTeamMember,
  canTeam,
  mapOidcGroups,
  removeTeamMember,
  type NodeTeamAction,
  type NodeTeamRole,
} from '../../src/runtime/node/team/roles'
import {
  derivePersonNamespace,
  personHomePath,
  personSandboxLabel,
  scopeCredentialUse,
} from '../../src/runtime/node/team/namespaces'
import { admitTeamSpend, appendTeamAudit, teamSpentFor } from '../../src/runtime/node/team/budgets'

const MATRIX: Readonly<Record<NodeTeamRole, readonly NodeTeamAction[]>> = {
  owner: ['manageTeam', 'manageNode', 'runAgents', 'readAgents', 'spendBudget', 'readAudit'],
  admin: ['manageNode', 'runAgents', 'readAgents', 'spendBudget', 'readAudit'],
  member: ['runAgents', 'readAgents', 'spendBudget'],
  viewer: ['readAgents'],
}
const ACTIONS: readonly NodeTeamAction[] = [
  'manageTeam',
  'manageNode',
  'runAgents',
  'readAgents',
  'spendBudget',
  'readAudit',
]

describe('team roles', () => {
  it('holds the matrix for every role and action', () => {
    const roles: readonly NodeTeamRole[] = ['owner', 'admin', 'member', 'viewer']
    for (const role of roles) {
      for (const action of ACTIONS) {
        expect(canTeam(role, action)).toBe(MATRIX[role].includes(action))
      }
    }
  })

  it('admits nobody before the owner terms decision', () => {
    expect(() =>
      admitTeamMember([], { person: 'ada', role: 'member' }, { acceptedByOwner: false }),
    ).toThrow('team mode waits on the owner terms decision')
    const roster = admitTeamMember([], { person: 'ada', role: 'member' }, { acceptedByOwner: true })
    expect(roster).toEqual([{ person: 'ada', role: 'member' }])
    expect(() =>
      admitTeamMember(roster, { person: 'ada', role: 'viewer' }, { acceptedByOwner: true }),
    ).toThrow('this person is already on the team')
    expect(() => removeTeamMember(roster, 'ada', 'admin')).toThrow(
      'removing a person takes the owner role',
    )
    expect(removeTeamMember(roster, 'ada', 'owner')).toEqual([])
  })

  it('maps OIDC groups by the person table, first group wins', () => {
    const mapping = { 'team-admins': 'admin', 'team-members': 'member' } as const
    expect(mapOidcGroups(['team-members', 'team-admins'], mapping)).toBe('member')
    expect(mapOidcGroups(['team-admins'], mapping)).toBe('admin')
    expect(mapOidcGroups(['strangers'], mapping)).toBeUndefined()
  })
})

describe('team scoping', () => {
  it('derives distinct namespaces and homes that cannot cross', () => {
    const secret = randomBytes(32)
    const ada = derivePersonNamespace('ada', secret)
    const grace = derivePersonNamespace('grace', secret)
    expect(ada).toHaveLength(64)
    expect(ada).not.toBe(grace)
    expect(derivePersonNamespace('ada', secret)).toBe(ada)
    expect(derivePersonNamespace('ada', randomBytes(32))).not.toBe(ada)
    expect(personHomePath('ada')).toBe('home/ada')
    expect(personSandboxLabel('ada')).toBe('muse-person-ada')
    expect(() => personHomePath('../root')).toThrow()
    expect(() => {
      scopeCredentialUse('ada', 'ada')
    }).not.toThrow()
    expect(() => {
      scopeCredentialUse('ada', 'grace')
    }).toThrow('this credential belongs to another person')
  })
})

describe('team budgets and audit', () => {
  it('admits under the budget and refuses past it by name', () => {
    const first = admitTeamSpend(
      [],
      { person: 'ada', amountCents: 400, at: 100, for: 'model call' },
      1000,
    )
    if (!first.admitted) throw new Error('the first spend fits')
    expect(teamSpentFor(first.ledger, 'ada')).toBe(400)
    expect(teamSpentFor(first.ledger, 'grace')).toBe(0)
    const second = admitTeamSpend(
      first.ledger,
      { person: 'ada', amountCents: 700, at: 200, for: 'model call' },
      1000,
    )
    expect(second).toEqual({ admitted: false, reason: 'ada has 600 of 1000 cents left' })
    const open = admitTeamSpend(
      first.ledger,
      { person: 'grace', amountCents: 999_999, at: 300, for: 'model call' },
      undefined,
    )
    expect(open.admitted).toBe(true)
  })

  it('audits every movement beside who moved it', () => {
    const log = appendTeamAudit(
      appendTeamAudit([], { at: 100, person: 'ada', action: 'spend', detail: '400 cents' }),
      { at: 200, person: 'owner', action: 'admit', detail: 'ada joined' },
    )
    expect(log).toHaveLength(2)
    expect(log[1]).toMatchObject({ person: 'owner', action: 'admit' })
  })
})
