// One browser chunk for the optional team tree, cards, usage and worker labels.
import { Fragment } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { formatNumber } from '../../shared/l10n/text'
import { formatTokenWindow } from '../../shared/palette'
import { formatUsd } from '../../core/usage/insights'
import type { TeamUsageFigures, TeamUsageSummary } from '../../shared/teamView'

export { TeamTree } from './TeamTree'
export { TeamCard, TeamWorkerLabel } from './TeamCards'

/**
 * The Usage Team section (M96 lane U2, PLAN.md D75): tasks, tokens and cost
 * today and in this window, per role and per entry, with key, subscription
 * and local apart, and estimated figures marked.
 */
function teamFiguresText(figures: TeamUsageFigures): string {
  return `${formatNumber(figures.tasks)} ${UI_TEXT.teamUsageTasks} · ${formatTokenWindow(figures.inputTokens + figures.outputTokens)} · ${formatUsd(figures.costUsd)}`
}

function TeamFigures({ figures }: { readonly figures: TeamUsageFigures }) {
  return (
    <dd>
      {teamFiguresText(figures)}
      {figures.estimated ? (
        <>
          {' '}
          <span className="team-estimated">{UI_TEXT.teamEstimated}</span>
        </>
      ) : null}
    </dd>
  )
}

export function TeamSection({ team }: { readonly team: TeamUsageSummary }) {
  return (
    <dl className="usage-facts">
      <dt>{UI_TEXT.teamUsageToday}</dt>
      <TeamFigures figures={team.today} />
      <dt>{UI_TEXT.teamUsageWindow}</dt>
      <TeamFigures figures={team.window} />
      {team.byRole.map((row) => (
        <Fragment key={`role-${row.roleId}`}>
          <dt>{row.name}</dt>
          <TeamFigures figures={row.figures} />
        </Fragment>
      ))}
      {team.byEntry.map((row) => (
        <Fragment key={`entry-${row.entryId}`}>
          <dt>
            {row.label} ({row.payKind})
          </dt>
          <TeamFigures figures={row.figures} />
        </Fragment>
      ))}
    </dl>
  )
}
