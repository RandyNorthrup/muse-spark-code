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

function doneText(done: string | undefined, report: TeamReportShape): string {
  if (done !== undefined) {
    return done
  }
  return report === 'review'
    ? TEAM_MODEL_TEXT.teamDoneDefaultReview
    : report === 'qa'
      ? TEAM_MODEL_TEXT.teamDoneDefaultQa
      : TEAM_MODEL_TEXT.teamDoneDefaultSummary
}

function reportContract(report: TeamReportShape): string {
  return report === 'review'
    ? TEAM_MODEL_TEXT.teamReportContractReview
    : report === 'qa'
      ? TEAM_MODEL_TEXT.teamReportContractQa
      : TEAM_MODEL_TEXT.teamReportContractSummary
}

function workspaceText(workspace: TeamWorkspaceMode): string {
  return workspace === 'read-only'
    ? TEAM_MODEL_TEXT.teamCharterWorkspaceReadOnly
    : workspace === 'in-place'
      ? TEAM_MODEL_TEXT.teamCharterWorkspaceInPlace
      : TEAM_MODEL_TEXT.teamCharterWorkspaceOwnBranch
}

/** A role's charter: the generated parts, then the role's own guidance. */
export function buildTeamCharter(role: CharterRole, tools: CharterTools): TeamCharter {
  const sections = [
    TEAM_MODEL_TEXT.teamCharterWho.replaceAll('{role}', role.id),
    TEAM_MODEL_TEXT.teamCharterPurpose.replaceAll('{description}', role.description),
    workspaceText(role.workspace),
    TEAM_MODEL_TEXT.teamCharterYouMay.replaceAll(
      '{tools}',
      describeToolsForCharter(tools.groups, role.writePaths),
    ),
    role.delegates.length === 0
      ? TEAM_MODEL_TEXT.teamCharterMustNever
      : `${TEAM_MODEL_TEXT.teamCharterMustNever} ${TEAM_MODEL_TEXT.teamCharterMayDelegate.replaceAll('{roles}', role.delegates.join(', '))}`,
    TEAM_MODEL_TEXT.teamCharterDone.replaceAll('{done}', doneText(role.done, role.report)),
    reportContract(role.report),
  ]
  const generated = sections.join('\n\n')
  return { generated, body: role.body, charter: `${generated}\n\n${role.body}` }
}
