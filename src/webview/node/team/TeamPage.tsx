// The node's team page (M110c lane U3, D90.12): the team's tree and merge
// queue as M96c's board shows them, read from the orchestrator host. Pure:
// the node server supplies the tree, the queue and the actions, and
// mounting waits on lane N.
import { UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import type { TeamTreeData } from '../../../shared/teamView'
import { TeamTree, type TeamTreeActions } from '../../components/TeamTree'

export interface NodeQueueRow {
  readonly id: string
  readonly position: number
  readonly reason: string
}

export interface NodeTeamPageProps {
  readonly tree: TeamTreeData
  readonly queue: readonly NodeQueueRow[]
  readonly actions?: TeamTreeActions | undefined
}

export function NodeTeamPage({ tree, queue, actions }: NodeTeamPageProps) {
  return (
    <>
      <section aria-label={UI_TEXT.teamTreeLabel}>
        <h2>{UI_TEXT.teamTreeLabel}</h2>
        <TeamTree tree={tree} actions={actions} />
      </section>
      <section aria-label={UI_TEXT.teamTraffic.mergeQueue}>
        <h2>{UI_TEXT.teamTraffic.mergeQueue}</h2>
        {queue.length === 0 ? (
          <p>{UI_TEXT.teamTraffic.noTasks}</p>
        ) : (
          <ol>
            {queue.map((row) => (
              <li key={row.id}>
                {fill(UI_TEXT.teamTraffic.queuePosition, {
                  position: row.position,
                  reason: row.reason,
                })}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  )
}
