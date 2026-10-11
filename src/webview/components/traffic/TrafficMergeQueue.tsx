import { fill, formatBytes, UI_TEXT } from '../../../shared/l10n/text'
import { TrafficActions, TrafficSection, trafficScope, type TrafficProps } from './TrafficParts'
export function TrafficMergeQueue({ state, postMessage }: TrafficProps) {
  return (
    <TrafficSection title={UI_TEXT.teamTraffic.mergeQueue}>
      <button
        type="button"
        onClick={() => {
          postMessage({
            type: 'traffic/queue',
            ...trafficScope(state),
            action: state.mergePaused ? 'resumeMerge' : 'pauseMerge',
          })
        }}
      >
        {state.mergePaused ? UI_TEXT.teamTraffic.resumeQueue : UI_TEXT.teamTraffic.pause}
      </button>
      <ol className="traffic-list">
        {state.mergeQueue.map((candidate) => (
          <li key={candidate.taskId}>
            <strong>{candidate.taskId}</strong>
            <p>
              {fill(UI_TEXT.teamTraffic.queuePosition, {
                position: candidate.position,
                reason: candidate.reason,
              })}
            </p>
            <p>{UI_TEXT.teamTrafficDetails[candidate.state]}</p>
            {candidate.checkLocation && (
              <p>
                {UI_TEXT.teamSchedulerSettings.checkSlots}: {candidate.checkLocation}
              </p>
            )}
            {candidate.flaky && <p>{UI_TEXT.teamTraffic.flaky}</p>}
            {candidate.landingBranch && <code>{candidate.landingBranch}</code>}
            <TrafficActions
              actions={candidate.actions}
              label={(action) => UI_TEXT.teamTraffic[action]}
              onAction={(action) => {
                postMessage({
                  type: 'traffic/merge',
                  ...trafficScope(state),
                  taskId: candidate.taskId,
                  expected: candidate,
                  action,
                })
              }}
            />
          </li>
        ))}
      </ol>
      <h4>{UI_TEXT.teamTraffic.diskUse}</h4>
      <ul className="traffic-list">
        {state.copies.map((copy) => (
          <li key={copy.taskId}>
            {copy.taskId}: {formatBytes(copy.bytes)}
            {(copy.state === 'merged' || copy.state === 'discarded') && (
              <button
                type="button"
                onClick={() => {
                  postMessage({
                    type: 'traffic/cleanup',
                    ...trafficScope(state),
                    taskId: copy.taskId,
                    expected: copy,
                  })
                }}
              >
                {UI_TEXT.teamTraffic.cleanup}
              </button>
            )}
          </li>
        ))}
      </ul>
    </TrafficSection>
  )
}
