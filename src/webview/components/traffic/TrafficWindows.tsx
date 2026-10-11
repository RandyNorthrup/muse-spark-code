import { formatNumber, plural, UI_TEXT } from '../../../shared/l10n/text'
import { TrafficSection, trafficScope, type TrafficProps } from './TrafficParts'
export function TrafficWindows({ state, postMessage }: TrafficProps) {
  const peers = state.windows.filter(
    (hint) => hint.windowInstanceId !== state.board.windowInstanceId,
  )
  const hints = peers.filter((hint) => hint.fresh)
  let workers = state.localWorkers
  for (const hint of hints) workers += hint.workers
  return (
    <TrafficSection title={UI_TEXT.teamTraffic.otherWindows}>
      <p>
        {plural(UI_TEXT.teamTraffic.machineLoad, hints.length + 1, {
          workers: plural(UI_TEXT.teamTraffic.workerCount, workers),
        })}
      </p>
      <p>
        {UI_TEXT.teamTraffic.lanes}: {formatNumber(workers)} / {formatNumber(state.workerCap)}
      </p>
      {workers > state.workerCap && <p>{UI_TEXT.teamTrafficDetails.advisoryExceeded}</p>}
      <ul className="traffic-list">
        {peers.map((hint) => (
          <li key={hint.windowInstanceId}>
            <strong>{hint.workspace}</strong>
            {!hint.fresh && <p>{UI_TEXT.teamTrafficDetails.staleHint}</p>}
            <p>{plural(UI_TEXT.teamTraffic.workerCount, hint.workers)}</p>
            <p>
              {UI_TEXT.teamTrafficDetails.processWorkers}: {formatNumber(hint.processWorkers)} ·{' '}
              {UI_TEXT.teamTrafficDetails.heavyCommands}: {formatNumber(hint.heavyCommands)}
            </p>
            <ul>
              {[...hint.branches, ...hint.paths, ...hint.servers].map((value, index) => (
                <li key={`${String(index)}:${value}`}>
                  <code>{value}</code>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                postMessage({
                  type: 'traffic/window',
                  ...trafficScope(state),
                  otherWindowId: hint.windowInstanceId,
                  action: 'openWindow',
                })
              }}
            >
              {UI_TEXT.teamTraffic.openWindow}
            </button>
          </li>
        ))}
      </ul>
    </TrafficSection>
  )
}
