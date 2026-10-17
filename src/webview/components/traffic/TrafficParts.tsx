import { type ReactNode } from 'react'
import { UI_TEXT } from '../../../shared/l10n/text'
import { type TrafficMessage, type TrafficSlice } from '../../../shared/modelsPanel'

export interface TrafficProps {
  state: TrafficSlice
  postMessage: (message: TrafficMessage) => void
}
export function trafficScope(state: TrafficSlice) {
  return { workspaceId: state.board.workspaceId, windowInstanceId: state.board.windowInstanceId }
}
export function TrafficSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="traffic-section" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  )
}
export function TrafficActions<T extends string>({
  actions,
  label,
  onAction,
}: {
  actions: readonly T[]
  label: (action: T) => string
  onAction: (action: T) => void
}) {
  return (
    <div className="traffic-actions">
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          onClick={() => {
            onAction(action)
          }}
        >
          {label(action)}
        </button>
      ))}
    </div>
  )
}
export function recoveryLabel(action: TrafficSlice['recovery'][number]['actions'][number]): string {
  switch (action) {
    case 'resume': {
      return UI_TEXT.teamTrafficDetails.resume
    }
    case 'discard': {
      return UI_TEXT.teamTrafficDetails.discard
    }
    default: {
      return UI_TEXT.teamTraffic[action]
    }
  }
}
