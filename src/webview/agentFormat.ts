// How an agent's state and time read, wherever an agent is shown: the Agent
// map, a subagent's row, a workflow run and its agents (M14, M47). Moved out
// of AgentMap.tsx in M47 so the workflow view can use it without a cycle.

import { UI_TEXT } from '../shared/constants'

/** A status as the display language says it; one the table does not list shows as it came. */
export function agentStatusLabel(status: string): string {
  return Object.entries(UI_TEXT.agentStatuses).find(([known]) => known === status)?.[1] ?? status
}

/** "45s", "1m 30s": the shared helper, kept here for the agent views. */
export { formatDurationMs } from '../shared/l10n/text'
