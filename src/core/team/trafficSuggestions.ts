// M96d Traffic suggestions (PLAN.md D75): the `trafficBottleneck`
// suggestion kind on M95's engine contract — pure rules over local
// facts, each suggestion carrying its reason, never applied without
// a click. Count and frequency thresholds are the person's own
// settings and arrive in the context; an unset threshold keeps its
// rule silent. Only presence (> 0), exact blockage (no free lane)
// and the defined meaning of "most" (> 1/2) are inline.

import { TEAM_INTENSITY_ORDER, UI_TEXT, type TeamIntensityLevel } from '../../shared/constants'
import { plural } from '../../shared/l10n/text'
import { intensityName } from './intensity'

/** The one M96d kind: every suggestion names a traffic bottleneck. */
export type TrafficSuggestionKind = 'trafficBottleneck'

export type TrafficBottleneckAction =
  | { readonly action: 'addReviewer'; readonly role: string; readonly modelRef: string }
  | {
      readonly action: 'raiseIntensity'
      readonly from: TeamIntensityLevel
      readonly to: TeamIntensityLevel
    }
  | {
      readonly action: 'addProviderEntry'
      readonly entryId: string
      readonly role: string
      readonly modelRef: string
      readonly provider: string
    }
  | { readonly action: 'declareSharedFile'; readonly path: string }
  | { readonly action: 'addRunner'; readonly runners: number }
  | {
      readonly action: 'lowerIntensity'
      readonly from: TeamIntensityLevel
      readonly to: TeamIntensityLevel
    }
  | { readonly action: 'userWaiters'; readonly count: number }

export interface TrafficSuggestion {
  readonly kind: TrafficSuggestionKind
  readonly action: TrafficBottleneckAction
  readonly reason: string
}

/** Dismissals, stored by the host and keyed per rule below. */
export interface TrafficDismissalStore {
  isDismissed(key: string): boolean
  dismiss(key: string): void
}

/**
The person's own thresholds: an unset one keeps its rule silent. No
threshold of ours fires a suggestion.
*/
export interface TrafficSuggestionThresholds {
  readonly reviewWaiters?: number | undefined
  readonly runningWaiters?: number | undefined
  readonly throttles?: number | undefined
  readonly loadGuardTrips?: number | undefined
}

export interface TrafficReviewerCandidate {
  readonly modelRef: string
}

export interface TrafficThrottledEntry {
  readonly entryId: string
  readonly role: string
  readonly provider: string
  readonly throttles: number
  /** Capable models on other providers, the host's preference first. */
  readonly candidates: readonly TrafficProviderCandidate[]
}

export interface TrafficProviderCandidate {
  readonly modelRef: string
  readonly provider: string
}

/** Everything the rules read; the host derives it from live traffic. */
export interface TrafficSuggestionContext {
  readonly reviewWaiters: number
  readonly reviewerHeadroom: number
  readonly reviewRole: string
  /** Capable models serving no reviewer yet, the host's preference first. */
  readonly reviewerCandidates: readonly TrafficReviewerCandidate[]
  readonly runningWaiters: number
  readonly level: TeamIntensityLevel
  readonly throttledEntries: readonly TrafficThrottledEntry[]
  /** Merge and predicted conflicts per path over the period. */
  readonly conflictsByPath: ReadonlyMap<string, number>
  readonly loadGuardTrips: number
  readonly runners: number
  readonly canAddRunner: boolean
  readonly userWaiters: number
  readonly thresholds: TrafficSuggestionThresholds
  readonly dismissals: TrafficDismissalStore
}

function dismissalKey(action: TrafficBottleneckAction): string {
  switch (action.action) {
    case 'addReviewer': {
      return 'addReviewer'
    }
    case 'raiseIntensity': {
      return 'raiseIntensity'
    }
    case 'addProviderEntry': {
      return `addProviderEntry:${action.entryId}`
    }
    case 'declareSharedFile': {
      return `declareSharedFile:${action.path}`
    }
    case 'addRunner': {
      return 'addRunner'
    }
    case 'lowerIntensity': {
      return 'lowerIntensity'
    }
    case 'userWaiters': {
      return 'userWaiters'
    }
  }
}

/** Remembers a dismissal; the host calls this when the person dismisses. */
export function dismissTrafficSuggestion(
  store: TrafficDismissalStore,
  suggestion: TrafficSuggestion,
): void {
  store.dismiss(dismissalKey(suggestion.action))
}

function nextLevel(level: TeamIntensityLevel, steps: 1 | -1): TeamIntensityLevel | undefined {
  const index = TEAM_INTENSITY_ORDER.indexOf(level) + steps
  return TEAM_INTENSITY_ORDER[index]
}

function suggestReviewer(context: TrafficSuggestionContext): TrafficSuggestion | undefined {
  const threshold = context.thresholds.reviewWaiters
  const candidate = context.reviewerCandidates[0]
  if (
    threshold === undefined ||
    candidate === undefined ||
    context.reviewWaiters < threshold ||
    context.reviewerHeadroom > 0 ||
    context.dismissals.isDismissed('addReviewer')
  )
    return undefined
  const count = context.reviewWaiters
  return {
    kind: 'trafficBottleneck',
    action: { action: 'addReviewer', role: context.reviewRole, modelRef: candidate.modelRef },
    reason: plural(UI_TEXT.trafficSuggestAddReviewer, count, {
      count,
      model: candidate.modelRef,
      role: context.reviewRole,
    }),
  }
}

function suggestRaiseIntensity(context: TrafficSuggestionContext): TrafficSuggestion | undefined {
  const threshold = context.thresholds.runningWaiters
  const to = nextLevel(context.level, 1)
  if (
    threshold === undefined ||
    to === undefined ||
    context.runningWaiters < threshold ||
    context.dismissals.isDismissed('raiseIntensity')
  )
    return undefined
  const count = context.runningWaiters
  return {
    kind: 'trafficBottleneck',
    action: { action: 'raiseIntensity', from: context.level, to },
    reason: plural(UI_TEXT.trafficSuggestRaiseIntensity, count, {
      count,
      from: intensityName(context.level),
      to: intensityName(to),
    }),
  }
}

function suggestProviderEntries(context: TrafficSuggestionContext): readonly TrafficSuggestion[] {
  const threshold = context.thresholds.throttles
  if (threshold === undefined) return []
  const suggestions: TrafficSuggestion[] = []
  for (const entry of context.throttledEntries) {
    const candidate = entry.candidates.find((model) => model.provider !== entry.provider)
    const key = `addProviderEntry:${entry.entryId}`
    if (
      candidate === undefined ||
      entry.throttles < threshold ||
      context.dismissals.isDismissed(key)
    )
      continue
    suggestions.push({
      kind: 'trafficBottleneck',
      action: {
        action: 'addProviderEntry',
        entryId: entry.entryId,
        role: entry.role,
        modelRef: candidate.modelRef,
        provider: candidate.provider,
      },
      reason: plural(UI_TEXT.trafficSuggestAddProviderEntry, entry.throttles, {
        count: entry.throttles,
        entry: entry.entryId,
        model: candidate.modelRef,
        provider: candidate.provider,
      }),
    })
  }
  return suggestions
}

function suggestSharedFile(context: TrafficSuggestionContext): TrafficSuggestion | undefined {
  let total = 0
  let top: string | undefined
  let topCount = 0
  for (const [path, count] of context.conflictsByPath) {
    total += count
    if (!(count > topCount)) {
      continue
    }

    top = path
    topCount = count
  }
  // "Most" means a strict majority; ties and empty periods stay silent.
  if (top === undefined || total === 0 || topCount * 2 <= total) return undefined
  const key = `declareSharedFile:${top}`
  if (context.dismissals.isDismissed(key)) return undefined
  return {
    kind: 'trafficBottleneck',
    action: { action: 'declareSharedFile', path: top },
    reason: plural(UI_TEXT.trafficSuggestDeclareSharedFile, topCount, {
      count: topCount,
      total,
      path: top,
    }),
  }
}

function suggestLoadGuard(context: TrafficSuggestionContext): readonly TrafficSuggestion[] {
  const threshold = context.thresholds.loadGuardTrips
  if (threshold === undefined || context.loadGuardTrips < threshold) return []
  const suggestions: TrafficSuggestion[] = []
  const trips = context.loadGuardTrips
  if (context.canAddRunner && !context.dismissals.isDismissed('addRunner'))
    suggestions.push({
      kind: 'trafficBottleneck',
      action: { action: 'addRunner', runners: context.runners + 1 },
      reason: plural(UI_TEXT.trafficSuggestAddRunner, trips, {
        count: trips,
        runners: context.runners + 1,
      }),
    })
  const to = nextLevel(context.level, -1)
  if (to !== undefined && !context.dismissals.isDismissed('lowerIntensity'))
    suggestions.push({
      kind: 'trafficBottleneck',
      action: { action: 'lowerIntensity', from: context.level, to },
      reason: plural(UI_TEXT.trafficSuggestLowerIntensity, trips, {
        count: trips,
        from: intensityName(context.level),
        to: intensityName(to),
      }),
    })
  return suggestions
}

function suggestUserWaiters(context: TrafficSuggestionContext): TrafficSuggestion | undefined {
  const count = context.userWaiters
  if (count <= 0 || context.dismissals.isDismissed('userWaiters')) return undefined
  return {
    kind: 'trafficBottleneck',
    action: { action: 'userWaiters', count },
    reason: plural(UI_TEXT.trafficSuggestUserWaiters, count, { count }),
  }
}

/**
Every suggestion the rules fire, each with its reason; dismissed ones
stay out. Rule order is stable: reviewer, intensity, provider
entries, shared file, load guard, user waiters.
*/
export function buildTrafficSuggestions(
  context: TrafficSuggestionContext,
): readonly TrafficSuggestion[] {
  const reviewer = suggestReviewer(context)
  const raise = suggestRaiseIntensity(context)
  const shared = suggestSharedFile(context)
  const waiters = suggestUserWaiters(context)
  return [
    ...(reviewer === undefined ? [] : [reviewer]),
    ...(raise === undefined ? [] : [raise]),
    ...suggestProviderEntries(context),
    ...(shared === undefined ? [] : [shared]),
    ...suggestLoadGuard(context),
    ...(waiters === undefined ? [] : [waiters]),
  ]
}
