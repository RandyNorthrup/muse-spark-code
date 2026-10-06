// How an agent's state and time read, wherever an agent is shown: the Agent
// map, a subagent's row, a workflow run and its agents (M14, M47). Moved out
// of AgentMap.tsx in M47 so the workflow view can use it without a cycle.

import { UI_TEXT } from '../shared/constants'
import type { PaidFeature } from '../shared/constants'
import type { PaidTally } from '../shared/paid'
import { fill, plural, formatUnit } from '../shared/l10n/text'

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

export function paidUseText(feature: PaidFeature, tally: PaidTally): string {
  if (feature === 'voice')
    return fill(UI_TEXT.usagePaidAudio, {
      duration: formatDurationMs(tally.voiceSeconds * MILLISECONDS_PER_SECOND),
    })
  const counts = {
    webSearch: [UI_TEXT.usagePaidSearches, tally.webSearches],
    imageGeneration: [UI_TEXT.usagePaidImages, tally.images],
    scheduledPrompts: [UI_TEXT.usagePaidScheduled, tally.scheduledRuns],
    subagents: [UI_TEXT.usagePaidSubagentRequests, tally.subagentRequests ?? 0],
    autoReviewer: [UI_TEXT.usagePaidAutoReviews, tally.autoReviews ?? 0],
    bestOfN: [UI_TEXT.usagePaidBestOfNAttempts, tally.bestOfNAttempts ?? 0],
    tab: [UI_TEXT.usagePaidTabRequests, tally.tabRequests ?? 0],
    hookModels: [UI_TEXT.usagePaidHookModelRuns, tally.hookModelRuns ?? 0],
    judge: [UI_TEXT.usagePaidJudgeCalls, tally.judgeCalls ?? 0],
  } as const
  const [forms, count] = counts[feature]
  return plural(forms, count)
}
