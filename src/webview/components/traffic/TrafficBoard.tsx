import { useId } from 'react'
import { fill, formatNumber, UI_TEXT } from '../../../shared/l10n/text'
import { teamPrioritySchema } from '../../../shared/team'
import { TrafficActions, TrafficSection, trafficScope, type TrafficProps } from './TrafficParts'

export function TrafficBoard({ state, postMessage }: TrafficProps) {
  const id = useId()
  const ranks = new Map(state.ranks.map((rank, index) => [rank.taskId, { rank, index }]))
  const tasks = state.board.tasks.toSorted((a, b) => {
    if (a.state === 'ready' && b.state !== 'ready') return -1
    return b.state === 'ready' && a.state !== 'ready'
      ? 1
      : (ranks.get(a.id)?.index ?? state.ranks.length) -
          (ranks.get(b.id)?.index ?? state.ranks.length)
  })
  return (
    <TrafficSection title={UI_TEXT.teamTraffic.board}>
      {tasks.length === 0 && <p>{UI_TEXT.teamTraffic.noTasks}</p>}
      <ol className="traffic-list">
        {tasks.map((task) => {
          const rank = ranks.get(task.id)?.rank
          const actions = state.taskActions.find(
            (row) => row.taskId === task.id && row.attempt === task.currentAttempt,
          )
          const attempt = task.attempts.at(-1)
          const send = (action: NonNullable<typeof actions>['actions'][number], extra = {}) => {
            postMessage({
              type: 'traffic/task',
              ...trafficScope(state),
              taskId: task.id,
              attempt: task.currentAttempt,
              action,
              ...extra,
            })
          }
          return (
            <li
              key={task.id}
              aria-label={`${task.roleId}, ${task.id}, ${UI_TEXT.teamTaskStates[task.state]}`}
            >
              <strong>
                {task.roleId}: {task.id}
              </strong>
              <p>
                {UI_TEXT.teamTaskStates[task.state]} · {UI_TEXT.teamTaskSizes[task.size]}
              </p>
              {task.branch && <code>{task.branch}</code>}
              {attempt && (
                <p>
                  {attempt.entryId} · {attempt.modelId} · {formatNumber(attempt.number)}
                </p>
              )}
              {rank && (
                <p>
                  {fill(UI_TEXT.teamTraffic.score, rank)} = {formatNumber(rank.score)}
                </p>
              )}
              {task.blockedReason && <p>{task.blockedReason}</p>}
              {actions?.reason && <p>{actions.reason}</p>}
              {attempt?.state === 'uncertain' && (
                <p>{UI_TEXT.teamTrafficNotices.uncertainAttempt}</p>
              )}
              {actions?.actions.includes('continueAnyway') && (
                <p>{UI_TEXT.teamTrafficNotices.userDecision}</p>
              )}
              {actions && (
                <>
                  <TrafficActions
                    actions={actions.actions.filter(
                      (action) => action !== 'priority' && action !== 'reassign',
                    )}
                    label={(action) =>
                      action === 'raiseLimit'
                        ? UI_TEXT.teamTrafficDetails.raiseLimit
                        : UI_TEXT.teamTraffic[action]
                    }
                    onAction={(action) => {
                      send(action)
                    }}
                  />
                  {actions.actions.includes('priority') && (
                    <label htmlFor={`${id}-${task.id}-priority`}>
                      {UI_TEXT.teamTraffic.priority}
                      <select
                        id={`${id}-${task.id}-priority`}
                        value={task.priority}
                        onChange={(event) => {
                          const priority = teamPrioritySchema.safeParse(event.target.value)
                          if (priority.success) send('priority', { priority: priority.data })
                        }}
                      >
                        {teamPrioritySchema.options.map((priority) => (
                          <option key={priority} value={priority}>
                            {UI_TEXT.teamPriorities[priority]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {actions.actions.includes('reassign') && (
                    <label htmlFor={`${id}-${task.id}-entry`}>
                      {UI_TEXT.teamTraffic.reassign}
                      <select
                        id={`${id}-${task.id}-entry`}
                        value=""
                        onChange={(event) => {
                          if (event.target.value) send('reassign', { entryId: event.target.value })
                        }}
                      >
                        <option value="" disabled>
                          {UI_TEXT.teamTraffic.reassign}
                        </option>
                        {state.entries
                          .filter((entry) => entry.roleId === task.roleId)
                          .map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.label}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ol>
    </TrafficSection>
  )
}
