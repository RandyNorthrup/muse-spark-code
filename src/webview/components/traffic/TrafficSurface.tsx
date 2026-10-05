import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { UI_TEXT } from '../../../shared/l10n/text'
import { type TrafficSurfaceProps } from './TrafficView'
import { TrafficBoard } from './TrafficBoard'
import { TrafficLanes } from './TrafficLanes'
import { TrafficLeases } from './TrafficLeases'
import { TrafficWindows } from './TrafficWindows'
import { TrafficRecovery } from './TrafficRecovery'
import { TrafficConflicts } from './TrafficConflicts'
import { TrafficMergeQueue } from './TrafficMergeQueue'
import { TrafficMetrics } from './TrafficMetrics'
import { trafficScope } from './TrafficParts'
import './traffic.css'

const tabs = [
  'board',
  'lanes',
  'leases',
  'otherWindows',
  'recovery',
  'conflicts',
  'mergeQueue',
  'metrics',
] as const
export default function TrafficSurface(props: TrafficSurfaceProps) {
  const { state, postMessage, announce } = props
  const [selected, setSelected] = useState<(typeof tabs)[number]>('board')
  const id = useId()
  const tabButtons = useRef(new Map<string, HTMLButtonElement>())
  const live = useRef<HTMLParagraphElement>(null)
  const seen = useRef(new Set(state.announcements.map((event) => event.id)))
  useEffect(() => {
    const messages: string[] = []
    for (const event of state.announcements) {
      if (seen.current.has(event.id)) continue
      seen.current.add(event.id)
      const label =
        event.kind === 'landed'
          ? UI_TEXT.teamTaskStates.merged
          : UI_TEXT.teamTrafficDetails.returned
      messages.push(`${label}: ${event.taskId}`)
    }
    if (messages.length === 0) return
    const message = messages.join('; ')
    if (announce) announce(message)
    else if (live.current) live.current.textContent = message
  }, [state.announcements, announce])
  function navigate(event: KeyboardEvent<HTMLButtonElement>) {
    const target = event.currentTarget
    const index = tabs.findIndex((tab) => tabButtons.current.get(tab) === target)
    let next: number
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown': {
        next = (index + 1) % tabs.length
        break
      }
      case 'ArrowLeft':
      case 'ArrowUp': {
        next = (index - 1 + tabs.length) % tabs.length
        break
      }
      case 'Home': {
        next = 0
        break
      }
      case 'End': {
        next = tabs.length - 1
        break
      }
      default: {
        return
      }
    }
    event.preventDefault()
    const tab = tabs[next]
    if (!tab) {
      return
    }

    setSelected(tab)
    tabButtons.current.get(tab)?.focus()
  }
  const sections = {
    board: TrafficBoard,
    lanes: TrafficLanes,
    leases: TrafficLeases,
    otherWindows: TrafficWindows,
    recovery: TrafficRecovery,
    conflicts: TrafficConflicts,
    mergeQueue: TrafficMergeQueue,
    metrics: TrafficMetrics,
  }
  const Section = sections[selected]
  return (
    <div className="traffic-view">
      <h2>{UI_TEXT.teamTraffic.title}</h2>
      <p>{UI_TEXT.teamTrafficNotices.windowCaps}</p>
      {state.hostBusy && <p>{UI_TEXT.teamTraffic.hostBusy}</p>}
      {state.board.paused && <p>{UI_TEXT.teamTrafficNotices.queuePaused}</p>}
      <button
        type="button"
        onClick={() => {
          postMessage({
            type: 'traffic/queue',
            ...trafficScope(state),
            action: state.board.paused ? 'resume' : 'pause',
          })
        }}
      >
        {state.board.paused ? UI_TEXT.teamTraffic.resumeQueue : UI_TEXT.teamTraffic.pauseQueue}
      </button>
      <div className="traffic-tabs" role="tablist" aria-label={UI_TEXT.teamTraffic.title}>
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`${id}-${tab}`}
            aria-controls={`${id}-panel`}
            aria-selected={selected === tab}
            tabIndex={selected === tab ? 0 : -1}
            ref={(element) => {
              if (element) tabButtons.current.set(tab, element)
              else tabButtons.current.delete(tab)
            }}
            onKeyDown={navigate}
            onClick={() => {
              setSelected(tab)
            }}
          >
            {UI_TEXT.teamTraffic[tab]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${selected}`} tabIndex={0}>
        <Section state={state} postMessage={postMessage} />
      </div>
      {!announce && (
        <p
          className="traffic-announcement"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          ref={live}
        />
      )}
    </div>
  )
}
