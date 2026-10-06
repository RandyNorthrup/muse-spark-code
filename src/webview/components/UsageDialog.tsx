// The Account & Usage modal (M8, rebuilt in D17 after Claude Code's): the
// account (sign-in method, plan, backend, CLI version, model), the
// subscription windows Muse Code last observed (the current block and the
// rolling week as bars with their reset times, "as of" the observation),
// this conversation's tokens with a dollar estimate on the Model API, and
// what is contributing to the usage over the last day or week, read from
// the CLI's trace logs on this machine. Opened from the palette's Account &
// usage row, `/usage` and `/cost`; centred over the transcript with the
// chat dimmed behind it.

import { Fragment, lazy, Suspense, useEffect, useState } from 'react'
import {
  META_DASHBOARD_URL,
  MODEL_API_PRICES_VERIFIED_ON,
  type ModelPricing,
  PAID_PRICES_VERIFIED_ON,
  type PaidFeature,
  UI_TEXT,
  USAGE_COUNTDOWN_REFRESH_MS,
} from '../../shared/constants'
import { fill, formatNumber, formatPercent, plural, templateParts } from '../../shared/l10n/text'
import {
  modelApiPaidTier,
  paidCostUsd,
  paidFeatureName,
  type PaidState,
  listedPaidFeatures,
  paidTotalUsd,
  usablePaidFeatures,
} from '../../shared/paid'
import { formatTokenWindow } from '../../shared/palette'
import { relativeTime } from '../../shared/sessions'
import {
  barValue,
  FULL_PERCENT,
  formatDuration,
  formatWindowLength,
  type SubscriptionUsage,
  type UsageInsights,
} from '../../shared/usage'
import { estimateCostUsd, formatUsd, percentOf } from '../../core/usage/insights'
import type { ContextSummary, UsageReport, UsageSummary } from '../state/uiState'
import type { UiState } from '../state/uiState'
import type { SignInMethod, WebviewToHostMessage } from '../../shared/protocol'
import type { ModelOption } from '../../shared/protocol'
const TabRow = lazy(async () => {
  const module = await import('./UsageProviderSections')
  return { default: module.TabRow }
})
const AccountSection = lazy(async () => {
  const module = await import('./UsageProviderSections')
  return { default: module.AccountSection }
})
const ProvidersSection = lazy(async () => {
  const module = await import('./UsageProviderSections')
  return { default: module.ProvidersSection }
})
const PlanUsageSection = lazy(async () => {
  const module = await import('./UsageProviderSections')
  return { default: module.PlanUsageSection }
})
import { paidUseText } from '../agentFormat'
import { Modal } from './Modal'

export interface UsageDialogProps {
  readonly models?: readonly ModelOption[]
  /** undefined while the host has not answered `readUsage`. */
  readonly report: UsageReport | undefined
  readonly usage: UsageSummary | undefined
  readonly context: ContextSummary | undefined
  readonly modelId: string | undefined
  /** The current model's price kind (M95): unpriced counts tokens only. */
  readonly modelPricing: ModelPricing | undefined
  /** The paid features that are on and this window's tally (M33, PLAN.md D30). */
  readonly paid: PaidState
  readonly auth: UiState['auth']
  readonly onInstallMuseCode: () => void
  readonly onSetupSignIn: (method: SignInMethod) => void
  /** "Ask again" (M58): no paid feature stays allowed always in this workspace. */
  readonly onForgetPaidUse: () => void
  readonly now: () => number
  readonly onOpenExternal: (url: string) => void
  /** The chat's existing bridge supplies openUsagePage (editor wiring lane). */
  readonly onOpenUsagePage?: () => void
  readonly onClose: () => void
}

function Facts({ rows }: { readonly rows: readonly (readonly [string, string | undefined])[] }) {
  return (
    <dl className="usage-facts">
      {rows.map(([label, value]) =>
        value === undefined ? null : (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </Fragment>
        ),
      )}
    </dl>
  )
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
  costUsd: number,
  modelId: string,
): { readonly amount: number; readonly percent: number } {
  const uncached = estimateCostUsd(
    { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedTokens: 0 },
    modelId,
  )
  const amount = uncached - costUsd
  return { amount, percent: uncached > 0 ? percentOf(amount, uncached) : 0 }
}

function TokensSection({
  usage,
  context,
  costUsd,
  modelId,
  pricing,
}: {
  readonly usage: UsageSummary | undefined
  readonly context: ContextSummary | undefined
  readonly costUsd: number | undefined
  readonly modelId: string | undefined
  /** The current model lost its price card (M95): tokens only, said so. */
  readonly pricing: ModelPricing | undefined
}) {
  if (usage === undefined && context === undefined) {
    return <p className="usage-row-meta">{UI_TEXT.usageNoSession}</p>
  }
  // A local model shows cost 0; an unpriced one counts tokens only (M95).
  const cost = costUsd ?? (pricing === 'local' ? 0 : undefined)
  const contextValue = contextValueOf(context)
  const savings =
    usage !== undefined && cost !== undefined && modelId !== undefined && costUsd !== undefined
      ? cacheSavings(usage, cost, modelId)
      : undefined
  return (
    <>
      <Facts
        rows={[
          [
            UI_TEXT.usageInput,
            usage === undefined ? undefined : formatTokenWindow(usage.inputTokens),
          ],
          [
            UI_TEXT.usageOutput,
            usage === undefined ? undefined : formatTokenWindow(usage.outputTokens),
          ],
          [
            UI_TEXT.usageCached,
            usage?.cachedTokens === undefined ? undefined : formatTokenWindow(usage.cachedTokens),
          ],
          [
            UI_TEXT.usageCacheHits,
            usage?.cachedTokens === undefined
              ? undefined
              : formatPercent(percentOf(usage.cachedTokens, usage.inputTokens)),
          ],
          [UI_TEXT.usageContext, contextValue],
          [
            UI_TEXT.usagePackedAvoided,
            usage?.packedTokensAvoided === undefined
              ? undefined
              : formatTokenWindow(usage.packedTokensAvoided),
          ],
          [
            UI_TEXT.usageAddedByHooks,
            usage?.hookTokensAdded === undefined
              ? undefined
              : formatTokenWindow(usage.hookTokensAdded),
          ],
          [UI_TEXT.usageCost, cost === undefined ? undefined : formatUsd(cost)],
          [
            UI_TEXT.usageCacheSavings,
            savings === undefined
              ? undefined
              : fill(UI_TEXT.usageCacheSavingsValue, {
                  amount: formatUsd(savings.amount),
                  percent: formatPercent(savings.percent),
                }),
          ],
        ]}
      />
      {costUsd === undefined ? null : (
        <p className="usage-row-meta">
          {fill(UI_TEXT.usageCostNote, { date: MODEL_API_PRICES_VERIFIED_ON })}
        </p>
      )}
      {cost === undefined && pricing === 'unpriced' ? (
        <p className="usage-row-meta">{UI_TEXT.usageUnpricedDetail}</p>
      ) : null}
    </>
  )
}

/** What this window used of one paid feature: "3 searches", "2 images", "1m 30s of audio". */

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

function PaidRow({ feature, paid }: { readonly feature: PaidFeature; readonly paid: PaidState }) {
  if (feature === 'tab') {
    return (
      <Suspense fallback={null}>
        <TabRow
          paid={paid}
          state={paidRowState('tab', paid)}
          useText={paidUseText('tab', paid.tally)}
        />
      </Suspense>
    )
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
            {(
              [
                [chosen.reminderAttempts, UI_TEXT.usageInsightReminders],
                [chosen.subagentAttempts, UI_TEXT.usageInsightSubagents],
                [chosen.longSessionAttempts, UI_TEXT.usageInsightLong],
              ] as const
            ).map(([attempts, template]) => (
              <InsightLine
                key={template}
                share={percentOf(attempts, chosen.attempts)}
                template={template}
              />
            ))}
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
  models = [],
  report,
  usage,
  context,
  modelId,
  modelPricing: listedPricing,
  paid,
  auth,
  onInstallMuseCode,
  onSetupSignIn,
  onForgetPaidUse,
  now,
  onOpenExternal,
  onOpenUsagePage,
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
  // The bound reference remains authoritative while the catalogue is recovering.
  const providerId = modelId?.includes('/') ? modelId.split('/', 1)[0] : undefined
  const model = models.find((option) => option.modelId === modelId)
  const provider =
    (model?.providerId === providerId ? model?.providerLabel : undefined) ??
    providerId ??
    UI_TEXT.modelPlan
  const modelPricing = providerId === 'chatgpt' || providerId === 'copilot' ? 'plan' : listedPricing
  // Priced on the Model API only, whose usage always carries its cached total.
  const cachedTokens = usage?.cachedTokens
  const costUsd =
    usage !== undefined &&
    cachedTokens !== undefined &&
    modelId !== undefined &&
    (modelPricing === undefined || modelPricing === 'priced') &&
    modelApiPaidTier(modelId) !== undefined &&
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
    let usageNote =
      report.backend === 'modelApi' ? UI_TEXT.usageModelApiNote : UI_TEXT.usageNoSubscription
    if (modelPricing === 'plan') usageNote = UI_TEXT.planUi.usageDetail
    body = (
      <>
        <h3 className="usage-heading">{UI_TEXT.usageAccount}</h3>
        <Suspense fallback={null}>
          <AccountSection
            report={report}
            modelId={modelId}
            modelPricing={modelPricing}
            providerId={providerId}
            provider={provider}
          />
        </Suspense>
        <h3 className="usage-heading">{UI_TEXT.usageHeading}</h3>
        {report.subscription === undefined ? (
          <p className="usage-row-meta">{usageNote}</p>
        ) : (
          <SubscriptionSection subscription={report.subscription} nowMs={nowMs} />
        )}
        <h3 className="usage-heading">{UI_TEXT.usageSessionTokens}</h3>
        <TokensSection
          usage={usage}
          context={context}
          costUsd={costUsd}
          modelId={modelId}
          pricing={modelPricing}
        />
        {report.providers !== undefined && report.providers.length > 0 ? (
          <Suspense fallback={null}>
            <ProvidersSection providers={report.providers} />
          </Suspense>
        ) : null}
        {report.plans !== undefined && report.plans.length > 0 ? (
          <Suspense fallback={null}>
            <PlanUsageSection rows={report.plans} models={models} onOpenExternal={onOpenExternal} />
          </Suspense>
        ) : null}
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
      <button
        type="button"
        className="button-secondary"
        disabled={onOpenUsagePage === undefined}
        onClick={onOpenUsagePage}
      >
        {UI_TEXT.openUsagePage}
      </button>
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
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              onSetupSignIn('byo')
            }}
          >
            {UI_TEXT.startWithOwnModel}
          </button>
          <p className="usage-row-meta">{UI_TEXT.startWithOwnModelDetail}</p>
        </div>
      ) : null}
    </Modal>
  )
}

/** The state-backed App adapter stays with the deferred account surface. */
export function UsageSurface({
  state,
  postMessage,
  onSetupSignIn,
  now,
  onOpenExternal,
  onClose,
}: {
  readonly state: UiState
  readonly postMessage: (message: WebviewToHostMessage) => void
  readonly onSetupSignIn: (method: SignInMethod) => void
  readonly now: () => number
  readonly onOpenExternal: (url: string) => void
  readonly onClose: () => void
}) {
  return (
    <UsageDialog
      auth={state.auth}
      report={state.usageReport}
      usage={state.usage}
      context={state.context}
      modelId={state.model?.modelId}
      modelPricing={state.models.find((model) => model.modelId === state.model?.modelId)?.pricing}
      models={state.models}
      paid={state.paid}
      onInstallMuseCode={() => {
        postMessage({ type: 'installMuseCode' })
      }}
      onSetupSignIn={(method) => {
        onClose()
        onSetupSignIn(method)
      }}
      onForgetPaidUse={() => {
        postMessage({ type: 'forgetPaidUse' })
      }}
      now={now}
      onOpenExternal={onOpenExternal}
      onClose={onClose}
    />
  )
}
