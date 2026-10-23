// People and roles (M110h lane M, D90.16): who may do what on a shared
// node, and which OIDC groups map to which role. Team mode refuses to
// admit anyone until the owner records the terms decision (Q-M110); the
// matrix below is the law once they do.
import * as z from 'zod/mini'

export const teamRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer'])
export type NodeTeamRole = z.infer<typeof teamRoleSchema>

export const teamActionSchema = z.enum([
  'manageTeam',
  'manageNode',
  'runAgents',
  'readAgents',
  'spendBudget',
  'readAudit',
])
export type NodeTeamAction = z.infer<typeof teamActionSchema>

const TEAM_MATRIX: Readonly<Record<NodeTeamRole, ReadonlySet<NodeTeamAction>>> = {
  owner: new Set([
    'manageTeam',
    'manageNode',
    'runAgents',
    'readAgents',
    'spendBudget',
    'readAudit',
  ]),
  admin: new Set(['manageNode', 'runAgents', 'readAgents', 'spendBudget', 'readAudit']),
  member: new Set(['runAgents', 'readAgents', 'spendBudget']),
  viewer: new Set(['readAgents']),
}

/** True when this role holds this action. Unknown pairs refuse. */
export function canTeam(role: NodeTeamRole, action: NodeTeamAction): boolean {
  const parsedRole = teamRoleSchema.parse(role)
  const parsedAction = teamActionSchema.parse(action)
  return TEAM_MATRIX[parsedRole].has(parsedAction)
}

export const teamTermsSchema = z.strictObject({
  acceptedByOwner: z.boolean(),
  acceptedAt: z.optional(z.int().check(z.gte(0))),
})
export type TeamTerms = z.infer<typeof teamTermsSchema>

export const teamMemberSchema = z.strictObject({
  person: z.string().check(z.minLength(1)),
  role: teamRoleSchema,
})
export type TeamMember = z.infer<typeof teamMemberSchema>

/* Admit one person, or refuse: team mode waits on the owner terms decision. */
export function admitTeamMember(
  roster: readonly TeamMember[],
  member: TeamMember,
  terms: TeamTerms,
): readonly TeamMember[] {
  const parsed = teamMemberSchema.parse(member)
  const grant = teamTermsSchema.parse(terms)
  if (!grant.acceptedByOwner) throw new Error('team mode waits on the owner terms decision')
  if (roster.some((entry) => entry.person === parsed.person))
    throw new Error('this person is already on the team')
  return [...roster, parsed]
}

export function removeTeamMember(
  roster: readonly TeamMember[],
  person: string,
  by: NodeTeamRole,
): readonly TeamMember[] {
  if (!canTeam(teamRoleSchema.parse(by), 'manageTeam'))
    throw new Error('removing a person takes the owner role')
  if (roster.every((entry) => entry.person !== person))
    throw new Error('this person is not on the team')
  return roster.filter((entry) => entry.person !== person)
}

/** The person's own OIDC group mapping: first listed group wins. */
export function mapOidcGroups(
  groups: readonly string[],
  mapping: Readonly<Record<string, NodeTeamRole>>,
): NodeTeamRole | undefined {
  for (const group of groups) {
    const role = mapping[group]
    if (role !== undefined) return teamRoleSchema.parse(role)
  }
  return undefined
}
