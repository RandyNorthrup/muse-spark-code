// Lane R (M96, PLAN.md D75): the role charter generator.
//
// Every worker's instructions begin with its role's charter. It is
// generated from the role's resolved settings, so it cannot drift: what
// the charter says, the tools enforce. Only the purpose (`description`),
// `done` and the body are the user's words; the rest is fixed English in
// `TEAM_MODEL_TEXT`. The charter holds nothing that varies by task: no
// branch, folder, task id or date.

import {
  TEAM_MODEL_TEXT,
  TEAM_READ_ONLY_COMMANDS,
  TEAM_REPORT_FENCE,
  type TeamReportShape,
  type TeamWorkspaceMode,
} from '../../shared/constants'
import type { ResolvedTeamToolset } from './toolsets'

/** A role's resolved settings, as the charter reads them. */
export interface CharterRole {
  readonly id: string
  readonly description: string
  readonly workspace: TeamWorkspaceMode
  readonly writePaths?: readonly string[] | undefined
  readonly done?: string | undefined
  readonly report: TeamReportShape
  readonly delegates: readonly string[]
  /** The role's own guidance: after the charter, method but never power. */
  readonly body: string
}

/** The final toolset, whose words preserve the captured policy and met names. */
export type CharterTools = ResolvedTeamToolset

export interface TeamCharter {
  /**
   * The generated parts, in the plan's order (who, purpose, workspace, you
   * may, you must never, done, hand back): the same bytes for every task of
   * one role and entry.
   */
  readonly generated: string
  readonly body: string
  readonly charter: string
}

const DONE_DEFAULTS: Readonly<Record<TeamReportShape, string>> = {
  summary: TEAM_MODEL_TEXT.teamDoneDefaultSummary,
  review: TEAM_MODEL_TEXT.teamDoneDefaultReview,
  qa: TEAM_MODEL_TEXT.teamDoneDefaultQa,
}

const REPORT_CONTRACTS: Readonly<Record<TeamReportShape, string>> = {
  summary: TEAM_MODEL_TEXT.teamReportContractSummary,
  review: TEAM_MODEL_TEXT.teamReportContractReview,
  qa: TEAM_MODEL_TEXT.teamReportContractQa,
}

const WORKSPACE_TEXTS: Readonly<Record<TeamWorkspaceMode, string>> = {
  'read-only': TEAM_MODEL_TEXT.teamCharterWorkspaceReadOnly,
  'own-branch': TEAM_MODEL_TEXT.teamCharterWorkspaceOwnBranch,
  'in-place': TEAM_MODEL_TEXT.teamCharterWorkspaceInPlace,
}

/** Fills one `{slot}`; split and join keep a `$` in the value literal. */
function fillSlot(template: string, slot: string, value: string): string {
  return template.split(`{${slot}}`).join(value)
}

/** A role's charter: the generated parts, then the role's own guidance. */
export function buildTeamCharter(role: CharterRole, tools: CharterTools): TeamCharter {
  const mustNever = fillSlot(
    TEAM_MODEL_TEXT.teamCharterMustNever,
    'delegateClause',
    role.delegates.length === 0
      ? ''
      : fillSlot(TEAM_MODEL_TEXT.teamCharterDelegateClause, 'roles', role.delegates.join(', ')),
  )
  const sections = [
    fillSlot(TEAM_MODEL_TEXT.teamCharterWho, 'role', role.id),
    fillSlot(TEAM_MODEL_TEXT.teamCharterPurpose, 'description', role.description),
    fillSlot(WORKSPACE_TEXTS[role.workspace], 'commands', TEAM_READ_ONLY_COMMANDS.join(', ')),
    fillSlot(TEAM_MODEL_TEXT.teamCharterYouMay, 'tools', tools.youMay),
    mustNever,
    fillSlot(TEAM_MODEL_TEXT.teamCharterDone, 'done', role.done ?? DONE_DEFAULTS[role.report]),
    fillSlot(
      fillSlot(TEAM_MODEL_TEXT.teamCharterHandBack, 'fence', TEAM_REPORT_FENCE),
      'contract',
      REPORT_CONTRACTS[role.report],
    ),
  ]
  const generated = sections.join('\n\n')
  return { generated, body: role.body, charter: `${generated}\n\n${role.body}` }
}
