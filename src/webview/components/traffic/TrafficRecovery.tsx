import { useId, useState } from 'react'
import { fill, formatDateTime, formatNumber, UI_TEXT } from '../../../shared/l10n/text'
import {
  TrafficActions,
  TrafficSection,
  recoveryLabel,
  trafficScope,
  type TrafficProps,
} from './TrafficParts'
export function TrafficRecovery({ state, postMessage }: TrafficProps) {
  const [includeEdits, setIncludeEdits] = useState(false)
  const id = useId()
  return (
    <TrafficSection title={UI_TEXT.teamTraffic.recovery}>
      <label htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={includeEdits}
          onChange={(event) => {
            setIncludeEdits(event.target.checked)
          }}
        />
        {UI_TEXT.teamTraffic.includeEdits}
      </label>
      <ul className="traffic-list">
        {state.recovery.map((row) => (
          <li key={row.id}>
            <strong>{row.taskId ?? row.launchId ?? row.id}</strong>
            <p>{row.detail}</p>
            {row.ownerMayBeLive && <p>{UI_TEXT.teamTrafficDetails.ownerMayBeLive}</p>}
            {row.pid !== undefined && (
              <p>
                {formatNumber(row.pid)} · {row.match && UI_TEXT.teamTrafficDetails[row.match]}
              </p>
            )}
            {row.startedAt !== undefined && <p>{formatDateTime(row.startedAt)}</p>}
            {row.lockPath && (
              <p>{fill(UI_TEXT.teamTrafficNotices.lockHeld, { path: row.lockPath })}</p>
            )}
            <ul>
              {row.paths.map((path) => (
                <li key={path}>
                  <code>{path}</code>
                </li>
              ))}
            </ul>
            <TrafficActions
              actions={row.actions.filter(
                (action) =>
                  !(
                    row.ownerMayBeLive && ['resume', 'discard', 'recover', 'stop'].includes(action)
                  ) &&
                  (action !== 'recover' || row.lockPath === undefined),
              )}
              label={recoveryLabel}
              onAction={(action) => {
                postMessage({
                  type: 'traffic/recovery',
                  ...trafficScope(state),
                  recoveryId: row.id,
                  expected: row,
                  action,
                  ...(action === 'newTask' && { includeEdits }),
                })
              }}
            />
          </li>
        ))}
      </ul>
    </TrafficSection>
  )
}
