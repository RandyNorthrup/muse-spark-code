import { USD_DECIMAL_ZERO } from '../../shared/usdConstants'
import { Usd, type UsdAmount } from '../../shared/usd'
// The Account & Usage modal (M8, rebuilt in D17 after Claude Code's): the
// account (sign-in method, plan, backend, CLI version, model), the
// subscription windows Muse Code last observed (the current block and the
// rolling week as bars with their reset times, "as of" the observation),
// this conversation's tokens with a dollar estimate on the Model API, and
// what is contributing to the usage over the last day or week, read from
// the CLI's trace logs on this machine. Opened from the palette's Account &
// usage row, `/usage` and `/cost`; centred over the transcript with the
// chat dimmed behind it.

import { useEffect, useState } from 'react'
import {
  META_DASHBOARD_URL,
  MILLISECONDS_PER_SECOND,
  MODEL_API_PRICES_VERIFIED_ON,
  PAID_PRICES_VERIFIED_ON,
  TAB_DAILY_BUDGET_DEFAULT_USD,
  type PaidFeature,
  UI_TEXT,
  USAGE_COUNTDOWN_REFRESH_MS,
} from '../../shared/constants'
import { fill, formatNumber, formatPercent, plural, templateParts } from '../../shared/l10n/text'
import {
  paidCostUsd,
  paidFeatureName,
  type PaidState,
  type PaidTally,
  listedPaidFeatures,
  paidTotalUsd,
  usablePaidFeatures,
} from '../../shared/paid'
import { backendLabel, formatTokenWindow } from '../../shared/palette'
import { relativeTime } from '../../shared/sessions'
import {
  barValue,
  FULL_PERCENT,
  formatDuration,
  formatWindowLength,
  planLabel,
  type AccountFacts,
  type SubscriptionUsage,
  type UsageInsights,
} from '../../shared/usage'
import { estimateCostUsd, formatUsd, percentOf } from '../../core/usage/insights'
import type { ContextSummary, UsageReport, UsageSummary } from '../state/uiState'
import type { UiState } from '../state/uiState'
import type { SignInMethod } from '../../shared/protocol'
import { formatDurationMs } from '../agentFormat'
import { Modal } from './Modal'

export interface UsageDialogProps {
  /** undefined while the host has not answered `readUsage`. */
  readonly report: UsageReport | undefined
  readonly usage: UsageSummary | undefined
  readonly context: ContextSummary | undefined
  readonly modelId: string | undefined
  /** The paid features that are on and this window's tally (M33, PLAN.md D30). */
  readonly paid: PaidState
  readonly auth: UiState['auth']
  readonly onInstallMuseCode: () => void
  readonly onSetupSignIn: (method: SignInMethod) => void
  /** "Ask again" (M58): no paid feature stays allowed always in this workspace. */
  readonly onForgetPaidUse: () => void
  readonly now: () => number
  readonly onOpenExternal: (url: string) => void
  readonly onClose: () => void
}

type InsightWindow = 'day' | 'week'

function percentLabel(usedPercent: number): string {
  return fill(UI_TEXT.usagePercentUsed, { percent: formatPercent(usedPercent) })
}

function UsageBar({
  label,
  usedPercent,
  resetsAtMs,
  detail,
  nowMs,
}: {
  readonly label: string
  readonly usedPercent: number
  readonly resetsAtMs: number
  readonly detail: string | undefined
  readonly nowMs: number
}) {
  if (resetsAtMs <= nowMs) {
    return (
      <div className="usage-row">
        <div className="usage-row-head">
          <span>{label}</span>
        </div>
        <div className="usage-row-meta">{UI_TEXT.usageAwaitingFreshReport}</div>
      </div>
    )
  }
  const meta = [
    detail,
    fill(UI_TEXT.usageResetsIn, { duration: formatDuration(resetsAtMs, nowMs) }),
  ]
    .filter((part) => part !== undefined)
    .join(' · ')
  return (
    <div className="usage-row">
      <div className="usage-row-head">
        <span>{label}</span>
        <span className="usage-percent">{percentLabel(usedPercent)}</span>
      </div>
      <progress
        className="usage-bar"
        value={barValue(usedPercent)}
        max={FULL_PERCENT}
        aria-label={`${label}: ${percentLabel(usedPercent)}`}
      />
      <div className="usage-row-meta">{meta}</div>
    </div>
  )
}

function SubscriptionSection({
  subscription,
  nowMs,
}: {
  readonly subscription: SubscriptionUsage
  readonly nowMs: number
}) {
  return (
    <>
      <UsageBar
        label={UI_TEXT.usageWindow}
        usedPercent={subscription.window.usedPercent}
        resetsAtMs={subscription.window.resetsAtMs}
        detail={formatWindowLength(subscription.window.windowDurationMins)}
        nowMs={nowMs}
      />
      <UsageBar
        label={UI_TEXT.usageWeekly}
        usedPercent={subscription.weekly.usedPercent}
        resetsAtMs={subscription.weekly.resetsAtMs}
        detail={undefined}
        nowMs={nowMs}
      />
      <p className="usage-row-meta">
        {fill(UI_TEXT.usageAsOf, {
          time: relativeTime(new Date(subscription.observedAtMs).toISOString(), nowMs),
        })}
      </p>
    </>
  )
}

/** "21K / 1M", or the used count alone when the window is unknown. */
function contextValueOf(context: ContextSummary | undefined): string | undefined {
  if (context === undefined) {
    return undefined
  }
  const used = formatTokenWindow(context.usedTokens)
  return context.windowTokens === undefined
    ? used
    : `${used} / ${formatTokenWindow(context.windowTokens)}`
}

/**
 * What the prompt cache saved (M82): the uncached price minus the priced
 * one, with its share of the uncached price. Defined only where a cost is
 * priced (the Model API); Muse Code reports no honest cache totals
 * (PLAN.md D26).
 */
function cacheSavings(
  usage: UsageSummary,
  costUsd: UsdAmount,
  modelId: string,
): { readonly amount: UsdAmount; readonly percent: number } {
  const uncached = estimateCostUsd(
    { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedTokens: 0 },
    modelId,
  )
  const amount = Usd.from(uncached).subtract(Usd.from(costUsd)).toAmount()
  const ratio =
    Usd.from(uncached).compare(Usd.from(0)) > 0
      ? Usd.from(amount).times(100).floorDivide(Usd.from(uncached))
      : USD_DECIMAL_ZERO
  return { amount, percent: Number(ratio) }
}

function TokensSection({
  usage,
  context,
  costUsd,
  modelId,
}: {
  readonly usage: UsageSummary | undefined
  readonly context: ContextSummary | undefined
  readonly costUsd: UsdAmount | undefined
  readonly modelId: string | undefined
}) {
  if (usage === undefined && context === undefined) {
    return <p className="usage-row-meta">{UI_TEXT.usageNoSession}</p>
  }
  const contextValue = contextValueOf(context)
  const savings =
    usage !== undefined && costUsd !== undefined && modelId !== undefined
      ? cacheSavings(usage, costUsd, modelId)
      : undefined
  return (
    <>
      <dl className="usage-facts">
        {usage !== undefined && (
          <>
            <dt>{UI_TEXT.usageInput}</dt>
            <dd>{formatTokenWindow(usage.inputTokens)}</dd>
            <dt>{UI_TEXT.usageOutput}</dt>
            <dd>{formatTokenWindow(usage.outputTokens)}</dd>
            {usage.cachedTokens === undefined ? null : (
              <>
                <dt>{UI_TEXT.usageCached}</dt>
                <dd>{formatTokenWindow(usage.cachedTokens)}</dd>
                <dt>{UI_TEXT.usageCacheHits}</dt>
                <dd>{formatPercent(percentOf(usage.cachedTokens, usage.inputTokens))}</dd>
              </>
            )}
          </>
        )}
        {contextValue !== undefined && (
          <>
            <dt>{UI_TEXT.usageContext}</dt>
            <dd>{contextValue}</dd>
          </>
        )}
        {usage?.packedTokensAvoided === undefined ? null : (
          <>
            <dt>{UI_TEXT.usagePackedAvoided}</dt>
            <dd>{formatTokenWindow(usage.packedTokensAvoided)}</dd>
          </>
        )}
        {usage?.hookTokensAdded === undefined ? null : (
          <>
            <dt>{UI_TEXT.usageAddedByHooks}</dt>
            <dd>{formatTokenWindow(usage.hookTokensAdded)}</dd>
          </>
        )}
        {costUsd !== undefined && (
          <>
            <dt>{UI_TEXT.usageCost}</dt>
            <dd>{formatUsd(costUsd)}</dd>
          </>
        )}
        {savings !== undefined && (
          <>
            <dt>{UI_TEXT.usageCacheSavings}</dt>
            <dd>
              {fill(UI_TEXT.usageCacheSavingsValue, {
                amount: formatUsd(savings.amount),
                percent: formatPercent(savings.percent),
              })}
            </dd>
          </>
        )}
      </dl>
      {costUsd === undefined ? null : (
        <p className="usage-row-meta">
          {fill(UI_TEXT.usageCostNote, { date: MODEL_API_PRICES_VERIFIED_ON })}
        </p>
      )}
    </>
  )
}

/** What this window used of one paid feature: "3 searches", "2 images", "1m 30s of audio". */
function paidUseText(feature: PaidFeature, tally: PaidTally): string {
  switch (feature) {
    case 'webSearch': {
      return plural(UI_TEXT.usagePaidSearches, tally.webSearches)
    }
    case 'imageGeneration': {
      return plural(UI_TEXT.usagePaidImages, tally.images)
    }
    case 'voice': {
      return fill(UI_TEXT.usagePaidAudio, {
        duration: formatDurationMs(tally.voiceSeconds * MILLISECONDS_PER_SECOND),
      })
    }
    case 'scheduledPrompts': {
      return plural(UI_TEXT.usagePaidScheduled, tally.scheduledRuns)
    }
    case 'subagents': {
      return plural(UI_TEXT.usagePaidSubagentRequests, tally.subagentRequests ?? 0)
    }
    case 'autoReviewer': {
      return plural(UI_TEXT.usagePaidAutoReviews, tally.autoReviews ?? 0)
    }
    case 'bestOfN': {
      return plural(UI_TEXT.usagePaidBestOfNAttempts, tally.bestOfNAttempts ?? 0)
    }
    // M94 lane 0: the row's request count, keeping this total while lane U
    // writes the Tab row (tokens, cached tokens, costs, budget).
    case 'tab': {
      return plural(UI_TEXT.usagePaidTabRequests, tally.tabRequests ?? 0)
    }
    case 'hookModels': {
      return plural(UI_TEXT.usagePaidHookModelRuns, tally.hookModelRuns ?? 0)
    }
    case 'judge': {
      return plural(UI_TEXT.usagePaidJudgeCalls, tally.judgeCalls ?? 0)
    }
  }
}

/**
 * The paid features this backend uses (D30 rule 5; on Muse Code, the key's
 * images and voice, M44): each one's state, this window's use and its
 * estimated cost at the published prices.
 */
function PaidSection({
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
      <p className="usage-row-meta">
        {fill(UI_TEXT.usagePaidNote, { date: PAID_PRICES_VERIFIED_ON })}
      </p>
      {features.includes('subagents') ? (
        <p className="usage-row-meta">{UI_TEXT.usagePaidSubagentSubset}</p>
      ) : null}
      {always.length === 0 ? null : (
        <div className="usage-paid-always">
          <p className="usage-row-meta">
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

function paidTokenTally(feature: PaidFeature, paid: PaidState) {
  if (feature === 'judge')
    return [paid.tally.judgeCalls, paid.tally.judgeUnknownRequests, paid.tally.judgeTokens]
  if (feature === 'autoReviewer') {
    return [
      paid.tally.autoReviews,
      paid.tally.autoReviewUnknownRequests,
      paid.tally.autoReviewTokens,
    ]
  }
  if (feature === 'bestOfN') {
    return [paid.tally.bestOfNRequests, paid.tally.bestOfNUnknownRequests, paid.tally.bestOfNTokens]
  }
  if (feature === 'hookModels') {
    return [
      paid.tally.hookModelRuns,
      paid.tally.hookModelUnknownRequests,
      paid.tally.hookModelTokens,
    ]
  }
  return [
    paid.tally.subagentRequests,
    paid.tally.subagentUnknownRequests,
    paid.tally.subagentTokens,
  ]
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
  const state = paidRowState('tab', paid)
  const requests = paid.tally.tabRequests ?? 0
  const unknown = paid.tally.tabUnknownRequests ?? 0
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
            {`${paidUseText('tab', paid.tally)} · ${fill(UI_TEXT.usagePaidTabTokens, {
              tokens: formatNumber(paid.tally.tabTokens ?? 0),
              cached: formatNumber(paid.tally.tabCachedTokens ?? 0),
            })} · ${fill(UI_TEXT.usagePaidTabReported, { cost })}`}
            {unknown > 0 ? (
              <p className="usage-row-meta">{plural(UI_TEXT.usagePaidSubagentUnknown, unknown)}</p>
            ) : null}
            <p className="usage-row-meta">
              {todayUsd === undefined
                ? windowText
                : `${fill(UI_TEXT.usagePaidTabCostToday, { cost: formatUsd(todayUsd) })} · ${windowText}`}
            </p>
            <p className="usage-row-meta">{fill(UI_TEXT.usagePaidTabBudget, { budget })}</p>
          </>
        ) : (
          <span className="usage-row-meta">{fill(UI_TEXT.usagePaidTabBudget, { budget })}</span>
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
  const isReview = feature === 'autoReviewer'
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
            {unknown > 0 ? (
              <p className="usage-row-meta">{plural(UI_TEXT.usagePaidSubagentUnknown, unknown)}</p>
            ) : null}
          </>
        ) : null}
      </dd>
    </>
  )
}

function signInLabel(method: AccountFacts['signInMethod'] | undefined): string {
  if (method === 'cli') {
    return UI_TEXT.usageAuthCli
  }
  return method === 'apiKey' ? UI_TEXT.usageAuthKey : UI_TEXT.usageAuthNone
}

function planFor(report: UsageReport): string {
  if (report.subscription !== undefined) {
    return planLabel(report.subscription.tier)
  }
  return report.backend === 'modelApi' ? UI_TEXT.usagePlanPayAsYouGo : UI_TEXT.usagePlanUnknown
}

function AccountSection({
  report,
  modelId,
}: {
  readonly report: UsageReport
  readonly modelId: string | undefined
}) {
  const { account } = report
  const signIn = signInLabel(account?.signInMethod)
  const plan = planFor(report)
  return (
    <dl className="usage-facts">
      <dt>{UI_TEXT.usageAuthMethod}</dt>
      <dd>{signIn}</dd>
      <dt>{UI_TEXT.usagePlan}</dt>
      <dd>{plan}</dd>
      <dt>{UI_TEXT.usageBackend}</dt>
      <dd>{backendLabel(report.backend)}</dd>
      {account?.cliVersion === undefined ? null : (
        <>
          <dt>{UI_TEXT.usageCliVersion}</dt>
          <dd>{account.cliVersion}</dd>
        </>
      )}
      {modelId === undefined ? null : (
        <>
          <dt>{UI_TEXT.usageModel}</dt>
          <dd>{modelId}</dd>
        </>
      )}
    </dl>
  )
}

/**
 * One `{percent} of model attempts…` line with the share in its own
 * emphasis, wherever the language puts it; the table's check keeps
 * `{percent}` the template's only slot.
 */
function InsightLine({ share, template }: { readonly share: number; readonly template: string }) {
  return (
    <li className="usage-insight">
      {templateParts(template).map((part, index) =>
        typeof part === 'string' ? (
          part
        ) : (
          <span key={String(index)} className="usage-insight-share">
            {formatPercent(share)}
          </span>
        ),
      )}
    </li>
  )
}

function InsightsSection({
  insights,
}: {
  readonly insights: { readonly day: UsageInsights; readonly week: UsageInsights }
}) {
  const [window, setWindow] = useState<InsightWindow>('day')
  const chosen = insights[window]
  return (
    <>
      <div className="usage-toggle" role="radiogroup" aria-label={UI_TEXT.usageContributing}>
        {(['day', 'week'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={window === option}
            className={window === option ? 'usage-toggle-on' : undefined}
            onClick={() => {
              setWindow(option)
            }}
          >
            {option === 'day' ? UI_TEXT.usageDay : UI_TEXT.usageWeek}
          </button>
        ))}
      </div>
      <p className="usage-row-meta">{UI_TEXT.usageContributingNote}</p>
      {chosen.attempts === 0 ? (
        <p className="usage-row-meta">{UI_TEXT.usageInsightNone}</p>
      ) : (
        <>
          <ul className="usage-insights">
            <InsightLine
              share={percentOf(chosen.reminderAttempts, chosen.attempts)}
              template={UI_TEXT.usageInsightReminders}
            />
            <InsightLine
              share={percentOf(chosen.subagentAttempts, chosen.attempts)}
              template={UI_TEXT.usageInsightSubagents}
            />
            <InsightLine
              share={percentOf(chosen.longSessionAttempts, chosen.attempts)}
              template={UI_TEXT.usageInsightLong}
            />
          </ul>
          <p className="usage-row-meta">
            {fill(UI_TEXT.usageInsightTotals, {
              attempts: plural(UI_TEXT.modelAttemptsCount, chosen.attempts),
              sessions: plural(UI_TEXT.sessionsCount, chosen.sessions),
            })}
          </p>
        </>
      )}
    </>
  )
}

export function UsageDialog({
  report,
  usage,
  context,
  modelId,
  paid,
  auth,
  onInstallMuseCode,
  onSetupSignIn,
  onForgetPaidUse,
  now,
  onOpenExternal,
  onClose,
}: UsageDialogProps) {
  const [confirmInstall, setConfirmInstall] = useState(false)
  const [, setCountdownTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdownTick((tick) => tick + 1)
    }, USAGE_COUNTDOWN_REFRESH_MS)
    return () => {
      clearInterval(interval)
    }
  }, [])
  const nowMs = now()
  // Priced on the Model API only, whose usage always carries its cached total.
  const cachedTokens = usage?.cachedTokens
  const costUsd =
    usage !== undefined &&
    cachedTokens !== undefined &&
    modelId !== undefined &&
    report?.backend === 'modelApi'
      ? estimateCostUsd(
          { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedTokens },
          modelId,
        )
      : undefined
  const paidFeatures = listedPaidFeatures(
    usablePaidFeatures(report?.backend, paid.isKeyStored),
    paid.tally,
  )
  let body
  if (report === undefined) {
    body = <p className="usage-row-meta">{UI_TEXT.usageLoading}</p>
  } else {
    body = (
      <>
        <h3 className="usage-heading">{UI_TEXT.usageAccount}</h3>
        <AccountSection report={report} modelId={modelId} />
        <h3 className="usage-heading">{UI_TEXT.usageHeading}</h3>
        {report.subscription === undefined ? (
          <p className="usage-row-meta">
            {report.backend === 'modelApi'
              ? UI_TEXT.usageModelApiNote
              : UI_TEXT.usageNoSubscription}
          </p>
        ) : (
          <SubscriptionSection subscription={report.subscription} nowMs={nowMs} />
        )}
        <h3 className="usage-heading">{UI_TEXT.usageSessionTokens}</h3>
        <TokensSection usage={usage} context={context} costUsd={costUsd} modelId={modelId} />
        {paidFeatures.length > 0 ? (
          <>
            <h3 className="usage-heading">{UI_TEXT.usagePaidHeading}</h3>
            <PaidSection paid={paid} features={paidFeatures} onForgetPaidUse={onForgetPaidUse} />
          </>
        ) : null}
        <h3 className="usage-heading">{UI_TEXT.usageContributing}</h3>
        {report.insights === undefined ? (
          <p className="usage-row-meta">
            {report.backend === 'modelApi'
              ? UI_TEXT.usageInsightUnavailable
              : UI_TEXT.usageInsightNoLogs}
          </p>
        ) : (
          <InsightsSection insights={report.insights} />
        )}
        <button
          type="button"
          className="usage-link"
          onClick={() => {
            onOpenExternal(META_DASHBOARD_URL)
          }}
        >
          {UI_TEXT.usageOpenDashboard}
        </button>
      </>
    )
  }
  return (
    <Modal title={UI_TEXT.usageLabel} titleId="usage-title" onClose={onClose}>
      {body}
      {auth.status === 'signedIn' ? (
        <div className="usage-setup">
          {auth.hasCli === false ? (
            <>
              {auth.installState === 'running' ? (
                <p role="status">{UI_TEXT.installWaiting}</p>
              ) : (
                <>
                  {auth.installState === 'failed' ? (
                    <p role="alert">{auth.detail ?? UI_TEXT.installTimedOut}</p>
                  ) : null}
                  {confirmInstall && auth.installCommand !== undefined ? (
                    <div className="gate-install-confirm">
                      <p>{UI_TEXT.installConfirmDetail}</p>
                      <code className="gate-install-command">{auth.installCommand}</code>
                      <button
                        type="button"
                        className="button-primary"
                        onClick={() => {
                          setConfirmInstall(false)
                          onInstallMuseCode()
                        }}
                      >
                        {UI_TEXT.installConfirmAction}
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => {
                          setConfirmInstall(false)
                        }}
                      >
                        {UI_TEXT.installCancelAction}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => {
                        setConfirmInstall(true)
                      }}
                    >
                      {UI_TEXT.installStartAction}
                    </button>
                  )}
                </>
              )}
            </>
          ) : null}
          {auth.hasCli === true && auth.hasCliSession === false && auth.backend === 'modelApi' ? (
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                onSetupSignIn('browser')
              }}
            >
              {UI_TEXT.signInBrowser}
            </button>
          ) : null}
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              onSetupSignIn('apiKey')
            }}
          >
            {paid.isKeyStored ? UI_TEXT.usageReplaceModelApiKey : UI_TEXT.usageAddModelApiKey}
          </button>
          <p className="usage-row-meta">{UI_TEXT.signInApiKeyDetail}</p>
        </div>
      ) : null}
    </Modal>
  )
}
