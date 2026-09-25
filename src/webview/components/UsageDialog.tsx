// The Account & Usage modal (M8, rebuilt in D17 after Claude Code's): the
// account (sign-in method, plan, backend, CLI version, model), the
// subscription windows Muse Code last observed (the current block and the
// rolling week as bars with their reset times, "as of" the observation),
// this conversation's tokens with a dollar estimate on the Model API, and
// what is contributing to the usage over the last day or week, read from
// the CLI's trace logs on this machine. Opened from the palette's Account &
// usage row, `/usage` and `/cost`; centred over the transcript with the
// chat dimmed behind it.

import { useState } from 'react'
import {
  META_DASHBOARD_URL,
  MILLISECONDS_PER_SECOND,
  MODEL_API_PRICES_VERIFIED_ON,
  PAID_PRICES_VERIFIED_ON,
  type PaidFeature,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatPercent, plural, templateParts } from '../../shared/l10n/text'
import {
  paidCostUsd,
  paidFeatureName,
  type PaidState,
  type PaidTally,
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
import { formatDurationMs } from './AgentMap'
import { Modal } from './Modal'

export interface UsageDialogProps {
  /** undefined while the host has not answered `readUsage`. */
  readonly report: UsageReport | undefined
  readonly usage: UsageSummary | undefined
  readonly context: ContextSummary | undefined
  readonly modelId: string | undefined
  /** The paid features that are on and this window's tally (M33, PLAN.md D30). */
  readonly paid: PaidState
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

function TokensSection({
  usage,
  context,
  costUsd,
}: {
  readonly usage: UsageSummary | undefined
  readonly context: ContextSummary | undefined
  readonly costUsd: number | undefined
}) {
  if (usage === undefined && context === undefined) {
    return <p className="usage-row-meta">{UI_TEXT.usageNoSession}</p>
  }
  const contextValue = contextValueOf(context)
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
        {costUsd !== undefined && (
          <>
            <dt>{UI_TEXT.usageCost}</dt>
            <dd>{formatUsd(costUsd)}</dd>
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
}: {
  readonly paid: PaidState
  readonly features: readonly PaidFeature[]
}) {
  return (
    <>
      <dl className="usage-facts">
        {features.map((feature) => (
          <PaidRow key={feature} feature={feature} paid={paid} />
        ))}
        <dt>{UI_TEXT.usagePaidTotal}</dt>
        <dd>{formatUsd(paidTotalUsd(paid.tally))}</dd>
      </dl>
      <p className="usage-row-meta">
        {fill(UI_TEXT.usagePaidNote, { date: PAID_PRICES_VERIFIED_ON })}
      </p>
    </>
  )
}

function PaidRow({ feature, paid }: { readonly feature: PaidFeature; readonly paid: PaidState }) {
  const state = paid.features.includes(feature) ? UI_TEXT.usagePaidOn : UI_TEXT.usagePaidOff
  return (
    <>
      <dt>{`${paidFeatureName(feature)} (${state})`}</dt>
      <dd>
        {`${paidUseText(feature, paid.tally)} · ${formatUsd(paidCostUsd(feature, paid.tally))}`}
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
  now,
  onOpenExternal,
  onClose,
}: UsageDialogProps) {
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
  const paidFeatures = usablePaidFeatures(report?.backend, paid.isKeyStored)
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
        <TokensSection usage={usage} context={context} costUsd={costUsd} />
        {paidFeatures.length > 0 ? (
          <>
            <h3 className="usage-heading">{UI_TEXT.usagePaidHeading}</h3>
            <PaidSection paid={paid} features={paidFeatures} />
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
    </Modal>
  )
}
