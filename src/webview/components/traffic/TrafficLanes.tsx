import { formatNumber, UI_TEXT } from '../../../shared/l10n/text'
import { TrafficSection, type TrafficProps } from './TrafficParts'
export function TrafficLanes({ state }: TrafficProps) {
  return (
    <TrafficSection title={UI_TEXT.teamTraffic.lanes}>
      <ul className="traffic-list">
        {state.lanes.map((lane) => (
          <li key={lane.id}>
            <strong>{lane.label}</strong>
            <p>
              {formatNumber(lane.busy)} / {formatNumber(lane.capacity)}
            </p>
            <p>
              {UI_TEXT.teamTrafficDetails.freeSlots}:{' '}
              {formatNumber(Math.max(0, lane.capacity - lane.busy))}
            </p>
            <meter
              min={0}
              max={Math.max(1, lane.capacity)}
              value={lane.busy}
              aria-label={lane.label}
            />
          </li>
        ))}
      </ul>
    </TrafficSection>
  )
}
