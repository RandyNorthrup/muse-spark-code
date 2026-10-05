import { UI_TEXT } from '../../../shared/l10n/text'
import { TrafficActions, TrafficSection, trafficScope, type TrafficProps } from './TrafficParts'
export function TrafficConflicts({ state, postMessage }: TrafficProps) {
  return (
    <TrafficSection title={UI_TEXT.teamTraffic.conflicts}>
      <ul className="traffic-list">
        {state.conflicts.map((conflict) => (
          <li key={conflict.id}>
            <strong>{conflict.taskIds.join(', ')}</strong>
            <ul>
              {conflict.paths.map((path) => (
                <li key={path}>
                  <code>{path}</code>
                </li>
              ))}
            </ul>
            <TrafficActions
              actions={conflict.actions}
              label={(action) => UI_TEXT.teamTraffic[action]}
              onAction={(action) => {
                postMessage({
                  type: 'traffic/conflict',
                  ...trafficScope(state),
                  conflictId: conflict.id,
                  action,
                })
              }}
            />
          </li>
        ))}
      </ul>
    </TrafficSection>
  )
}
