import {
  MILLISECONDS_PER_SECOND,
  PAID_PRICES_VERIFIED_ON,
  TAB_DAILY_BUDGET_DEFAULT_USD,
  type PaidFeature,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatNumber, plural } from '../../shared/l10n/text'
import {
  paidCostUsd,
  paidFeatureName,
  paidTotalUsd,
  type PaidState,
  type PaidTally,
} from '../../shared/paid'
import { formatUsd } from '../../core/usage/insights'
import { formatDurationMs } from '../agentFormat'

/** What this window used of one paid feature: "3 searches", "2 images", "1m 30s of audio". */
function paidUseText(feature: PaidFeature, tally: PaidTally): string {
  if (feature === 'legalExplanation') return formatNumber(tally.legalExplanations ?? 0)
  if (feature === 'voice') {
    return fill(UI_TEXT.usagePaidAudio, {
      duration: formatDurationMs(tally.voiceSeconds * MILLISECONDS_PER_SECOND),
    })
  }
  const values = {
    webSearch: [UI_TEXT.usagePaidSearches, tally.webSearches],
    imageGeneration: [UI_TEXT.usagePaidImages, tally.images],
    scheduledPrompts: [UI_TEXT.usagePaidScheduled, tally.scheduledRuns],
    subagents: [UI_TEXT.usagePaidSubagentRequests, tally.subagentRequests],
    autoReviewer: [UI_TEXT.usagePaidAutoReviews, tally.autoReviews],
    teamWorkers: [UI_TEXT.usagePaidTeamTasks, tally.teamWorkerRequests],
    bestOfN: [UI_TEXT.usagePaidBestOfNAttempts, tally.bestOfNAttempts],
    tab: [UI_TEXT.usagePaidTabRequests, tally.tabRequests],
    hookModels: [UI_TEXT.usagePaidHookModelRuns, tally.hookModelRuns],
    judge: [UI_TEXT.usagePaidJudgeCalls, tally.judgeCalls],
  } as const
  const [forms, count] = values[feature]
  return plural(forms, count ?? 0)
}

/**
 * The paid features this backend uses (D30 rule 5; on Muse Code, the key's
 * images and voice, M44): each one's state, this window's use and its
 * estimated cost at the published prices.
 */
export function PaidSection({
  paid,
  features,
  onForgetPaidUse,
}: {
  readonly paid: PaidState
  readonly features: readonly PaidFeature[]
  readonly onForgetPaidUse: () => void
}) {
  const always = features.filter((feature) => paid.alwaysAllowed.includes(feature))
  return (
    <>
      <dl className="usage-facts">
        {features.map((feature) => (
          <PaidRow key={feature} feature={feature} paid={paid} />
        ))}
        <dt>
          {features.includes('subagents') ? UI_TEXT.usagePaidExtraTotal : UI_TEXT.usagePaidTotal}
        </dt>
        <dd>{formatUsd(paidTotalUsd(paid.tally))}</dd>
      </dl>
      <p className={'usage-row-meta'}>
        {fill(UI_TEXT.usagePaidNote, { date: PAID_PRICES_VERIFIED_ON })}
      </p>
      {features.includes('subagents') ? (
        <p className={'usage-row-meta'}>{UI_TEXT.usagePaidSubagentSubset}</p>
      ) : null}
      {always.length === 0 ? null : (
        <div className="usage-paid-always">
          <p className={'usage-row-meta'}>
            {fill(UI_TEXT.usagePaidAlwaysNote, {
              features: always.map((feature) => paidFeatureName(feature)).join(', '),
            })}
          </p>
          <button type="button" className="button-secondary" onClick={onForgetPaidUse}>
            {UI_TEXT.usagePaidAskAgain}
          </button>
        </div>
      )}
    </>
  )
}

function paidRowState(feature: PaidFeature, paid: PaidState): string {
  if (!paid.features.includes(feature)) {
    return UI_TEXT.usagePaidOff
  }
  return paid.alwaysAllowed.includes(feature) ? UI_TEXT.usagePaidOnAlways : UI_TEXT.usagePaidOn
}

function paidTokenTally(feature: PaidFeature, { tally }: PaidState) {
  if (feature === 'judge') return [tally.judgeCalls, tally.judgeUnknownRequests, tally.judgeTokens]
  if (feature === 'legalExplanation')
    return [
      tally.legalExplanations,
      tally.legalExplanationUnknownRequests,
      tally.legalExplanationTokens,
    ]
  if (feature === 'autoReviewer') {
    return [tally.autoReviews, tally.autoReviewUnknownRequests, tally.autoReviewTokens]
  }
  if (feature === 'bestOfN') {
    return [tally.bestOfNRequests, tally.bestOfNUnknownRequests, tally.bestOfNTokens]
  }
  return feature === 'hookModels'
    ? [tally.hookModelRuns, tally.hookModelUnknownRequests, tally.hookModelTokens]
    : [tally.subagentRequests, tally.subagentUnknownRequests, tally.subagentTokens]
}

function UnknownPaidRequests({ count }: { readonly count: number }) {
  return count > 0 ? (
    <p className={'usage-row-meta'}>{plural(UI_TEXT.usagePaidSubagentUnknown, count)}</p>
  ) : null
}

/**
 * The Tab row (M94 lane U, PLAN.md D73 acceptance 16): today's spend against
 * the daily budget, the request count, and the on/off state. "Today" is the
 * ledger's total for the local day across every window, shown once Tab has
 * run in this window (the ledger is read by dist/tab.js); "This window" is
 * this window's reported cost; the budget is the configured one (RVM94HU
 * 23–24). While Tab is off and has never run here, the row says off with the
 * budget instead of zeros that read as use. The facts wrap, as the other
 * token rows do (RVM94HU 25).
 */

function TabRow({ paid }: { readonly paid: PaidState }) {
  const { tally } = paid
  const state = paidRowState('tab', paid)
  const requests = tally.tabRequests ?? 0
  const unknown = tally.tabUnknownRequests ?? 0
  const hasRun = requests > 0 || paid.features.includes('tab')
  const cost = formatUsd(paidCostUsd('tab', paid.tally))
  const todayUsd = paid.tab?.todayUsd
  const budget = formatUsd(paid.tab?.budgetUsd ?? TAB_DAILY_BUDGET_DEFAULT_USD)
  const windowText = fill(UI_TEXT.usagePaidTabCostWindow, { cost })
  return (
    <>
      <dt>{`${paidFeatureName('tab')} (${state})`}</dt>
      <dd className="usage-paid-child">
        {hasRun ? (
          <>
            {`${paidUseText('tab', tally)} · ${fill(UI_TEXT.usagePaidTabTokens, {
              tokens: formatNumber(tally.tabTokens ?? 0),
              cached: formatNumber(tally.tabCachedTokens ?? 0),
            })} · ${fill(UI_TEXT.usagePaidTabReported, { cost })}`}
            <UnknownPaidRequests count={unknown} />
            <p className={'usage-row-meta'}>
              {todayUsd === undefined
                ? windowText
                : `${fill(UI_TEXT.usagePaidTabCostToday, { cost: formatUsd(todayUsd) })} · ${windowText}`}
            </p>
            <p className={'usage-row-meta'}>{fill(UI_TEXT.usagePaidTabBudget, { budget })}</p>
          </>
        ) : (
          <span className={'usage-row-meta'}>{fill(UI_TEXT.usagePaidTabBudget, { budget })}</span>
        )}
      </dd>
    </>
  )
}

function PaidRow({ feature, paid }: { readonly feature: PaidFeature; readonly paid: PaidState }) {
  if (feature === 'tab') {
    return <TabRow paid={paid} />
  }
  const state = paidRowState(feature, paid)
  const isReview = feature === 'autoReviewer' || feature === 'legalExplanation'
  const isAttempt = feature === 'bestOfN'
  const [requests = 0, unknown = 0, tokens = 0] = paidTokenTally(feature, paid)
  const isTokenFeature =
    feature === 'subagents' ||
    isReview ||
    isAttempt ||
    feature === 'hookModels' ||
    feature === 'judge'
  const isEntirelyUnknown = isTokenFeature && requests > 0 && requests === unknown
  const cost = formatUsd(paidCostUsd(feature, paid.tally))
  let costDetail = cost
  if (feature === 'scheduledPrompts') {
    costDetail = UI_TEXT.usageScheduledIncluded
  } else if (isTokenFeature) {
    costDetail = fill(
      isAttempt ? UI_TEXT.usagePaidBestOfNIncluded : UI_TEXT.usagePaidSubagentReported,
      { cost },
    )
  }
  return (
    <>
      <dt>{`${paidFeatureName(feature)} (${state})`}</dt>
      <dd className={isTokenFeature ? 'usage-paid-child' : undefined}>
        {paidUseText(feature, paid.tally)}
        {isEntirelyUnknown ? null : ` · ${costDetail}`}
        {isTokenFeature ? (
          <>
            {isEntirelyUnknown
              ? null
              : ` · ${fill(UI_TEXT.agentTokens, { tokens: formatNumber(tokens) })}`}
            <UnknownPaidRequests count={unknown} />
          </>
        ) : null}
      </dd>
    </>
  )
}
