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
  type TeamReportShape,
  type TeamToolGroup,
  type TeamWorkspaceMode,
} from '../../shared/constants'
import { describeToolsForCharter } from './toolsets'

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

/** The tools the charter's "You may" line lists: the resolved groups. */
export interface CharterTools {
  readonly groups: readonly TeamToolGroup[]
}

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
  const mustNever =
    role.delegates.length === 0
      ? TEAM_MODEL_TEXT.teamCharterMustNever
      : `${TEAM_MODEL_TEXT.teamCharterMustNever} ${fillSlot(TEAM_MODEL_TEXT.teamCharterMayDelegate, 'roles', role.delegates.join(', '))}`
  const sections = [
    fillSlot(TEAM_MODEL_TEXT.teamCharterWho, 'role', role.id),
    fillSlot(TEAM_MODEL_TEXT.teamCharterPurpose, 'description', role.description),
    WORKSPACE_TEXTS[role.workspace],
    fillSlot(
      TEAM_MODEL_TEXT.teamCharterYouMay,
      'tools',
      describeToolsForCharter(tools.groups, role.writePaths),
    ),
    mustNever,
    fillSlot(TEAM_MODEL_TEXT.teamCharterDone, 'done', role.done ?? DONE_DEFAULTS[role.report]),
    REPORT_CONTRACTS[role.report],
  ]
  const generated = sections.join('\n\n')
  return { generated, body: role.body, charter: `${generated}\n\n${role.body}` }
}
