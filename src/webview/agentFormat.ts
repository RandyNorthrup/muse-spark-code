// How an agent's state and time read, wherever an agent is shown: the Agent
// map, a subagent's row, a workflow run and its agents (M14, M47). Moved out
// of AgentMap.tsx in M47 so the workflow view can use it without a cycle.

import { UI_TEXT } from '../shared/constants'
import { formatUnit } from '../shared/l10n/text'

/** A status as the display language says it; one the table does not list shows as it came. */
export function agentStatusLabel(status: string): string {
  return Object.entries(UI_TEXT.agentStatuses).find(([known]) => known === status)?.[1] ?? status
}

const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60

/** "45s", "1m 30s", in the display language's short units. */
export function formatDurationMs(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / MILLISECONDS_PER_SECOND)
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  const seconds = formatUnit(totalSeconds % SECONDS_PER_MINUTE, 'second')
  return minutes === 0 ? seconds : `${formatUnit(minutes, 'minute')} ${seconds}`
}
