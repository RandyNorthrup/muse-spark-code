import { UI_TEXT } from '../../../shared/l10n/text'
import { TrafficActions, TrafficSection, trafficScope, type TrafficProps } from './TrafficParts'
export function TrafficLeases({ state, postMessage }: TrafficProps) {
  return (
    <TrafficSection title={UI_TEXT.teamTraffic.leases}>
      <h4>{UI_TEXT.teamTraffic.writeSet}</h4>
      <ul className="traffic-list">
        {state.writeLeases.map((lease) => (
          <li key={`${lease.holder.taskId}:${String(lease.holder.attempt)}`}>
            <strong>{lease.holder.taskId}</strong>
            {lease.exclusiveWriter && <p>{UI_TEXT.teamTraffic.exclusiveWriter}</p>}
            <ul>
              {lease.paths.map((path) => (
                <li key={path}>
                  <code>{path}</code>
                </li>
              ))}
            </ul>
            {lease.inheritedFrom && <p>{lease.inheritedFrom.taskId}</p>}
          </li>
        ))}
      </ul>
      <h4>{UI_TEXT.teamTraffic.resources}</h4>
      <ul className="traffic-list">
        {state.resources.map((resource) => (
          <li key={resource.id}>
            <strong>
              {resource.id}: {resource.holder}
            </strong>
            <ul>
              {resource.waiters.map((waiter) => (
                <li key={waiter}>{waiter}</li>
              ))}
            </ul>
            {resource.actions.includes('releaseAnyway') && (
              <p>{UI_TEXT.teamTrafficNotices.userDecision}</p>
            )}
            <TrafficActions
              actions={resource.actions}
              label={(action) =>
                action === 'takeBack'
                  ? UI_TEXT.teamTraffic.takeBack
                  : UI_TEXT.teamTrafficDetails[action]
              }
              onAction={(action) => {
                postMessage({
                  type: 'traffic/resource',
                  ...trafficScope(state),
                  resourceId: resource.id,
                  expected: resource,
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
