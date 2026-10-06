// The Account & Usage modal (M8, rebuilt in D17 after Claude Code's): the
// account (sign-in method, plan, backend, CLI version, model), the
// subscription windows Muse Code last observed (the current block and the
// rolling week as bars with their reset times, "as of" the observation),
// this conversation's tokens with a dollar estimate on the Model API, and
// what is contributing to the usage over the last day or week, read from
// the CLI's trace logs on this machine. Opened from the palette's Account &
// usage row, `/usage` and `/cost`; centred over the transcript with the
// chat dimmed behind it.

import { lazy, Suspense, useEffect, useState } from 'react'
import {
  META_DASHBOARD_URL,
  MODEL_API_PRICES_VERIFIED_ON,
  type ModelPricing,
  UI_TEXT,
  USAGE_COUNTDOWN_REFRESH_MS,
} from '../../shared/constants'
import { fill, formatPercent, plural, templateParts } from '../../shared/l10n/text'
import {
  type PaidState,
  listedPaidFeatures,
  usablePaidFeatures,
  modelApiPaidTier,
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
import type { TeamUsageSummary } from '../../shared/teamView'
import type { ContextSummary, UsageReport, UsageSummary } from '../state/uiState'
import type { UiState } from '../state/uiState'
import type { SignInMethod, WebviewToHostMessage } from '../../shared/protocol'
import type { ModelOption } from '../../shared/protocol'
const AccountSection = lazy(async () => {
  const module = await import('./UsageProviderSections')
  return { default: module.AccountSection }
})
const PlanUsageSection = lazy(async () => {
  const module = await import('./UsageProviderSections')
  return { default: module.PlanUsageSection }
})
import { Modal } from './Modal'
import { FactRows } from './FactRows'

const ProviderUsageSection = lazy(async () => {
  const module = await import('./ProviderUsageSection')
  return { default: module.ProviderUsageSection }
})

const PaidSection = lazy(async () => {
  const module = await import('./PaidUsageSection')
  return { default: module.PaidSection }
})

const TeamSection = lazy(async () => {
  const module = await import('./TeamUi')
  return { default: module.TeamSection }
})

export interface UsageDialogProps {
  readonly models?: readonly ModelOption[]
  /** undefined while the host has not answered `readUsage`. */
  readonly report: UsageReport | undefined
  readonly usage: UsageSummary | undefined
  readonly context: ContextSummary | undefined
  /**
   * The team's tasks, tokens and cost (M96 lane U2); undefined where the
   * team cannot run: the dialog is today's.
   */
  readonly team?: TeamUsageSummary | undefined
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

const ROW_META_CLASS = 'usage-row-meta'

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
        <div className={ROW_META_CLASS}>{UI_TEXT.usageAwaitingFreshReport}</div>
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
      <div className={ROW_META_CLASS}>{meta}</div>
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
      <p className={ROW_META_CLASS}>
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

/** Keep absent token facts absent while sharing their number formatting. */
function tokenCount(value: number | undefined): string | undefined {
  return value === undefined ? undefined : formatTokenWindow(value)
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
    return <p className={ROW_META_CLASS}>{UI_TEXT.usageNoSession}</p>
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
      <dl className="usage-facts">
        <FactRows
          rows={[
            [UI_TEXT.usageInput, tokenCount(usage?.inputTokens)],
            [UI_TEXT.usageOutput, tokenCount(usage?.outputTokens)],
            [UI_TEXT.usageCached, tokenCount(usage?.cachedTokens)],
            [
              UI_TEXT.usageCacheHits,
              usage?.cachedTokens === undefined
                ? undefined
                : formatPercent(percentOf(usage.cachedTokens, usage.inputTokens)),
            ],
            [UI_TEXT.usageContext, contextValue],
            [UI_TEXT.usagePackedAvoided, tokenCount(usage?.packedTokensAvoided)],
            [UI_TEXT.usageAddedByHooks, tokenCount(usage?.hookTokensAdded)],
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
      </dl>
      {costUsd === undefined ? null : (
        <p className={ROW_META_CLASS}>
          {fill(UI_TEXT.usageCostNote, { date: MODEL_API_PRICES_VERIFIED_ON })}
        </p>
      )}
      {cost === undefined && pricing === 'unpriced' ? (
        <p className={ROW_META_CLASS}>{UI_TEXT.usageUnpricedDetail}</p>
      ) : null}
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
      <p className={ROW_META_CLASS}>{UI_TEXT.usageContributingNote}</p>
      {chosen.attempts === 0 ? (
        <p className={ROW_META_CLASS}>{UI_TEXT.usageInsightNone}</p>
      ) : (
        <>
          <ul className="usage-insights">
            {(
              [
                [chosen.reminderAttempts, UI_TEXT.usageInsightReminders],
                [chosen.subagentAttempts, UI_TEXT.usageInsightSubagents],
                [chosen.longSessionAttempts, UI_TEXT.usageInsightLong],
              ] as const
            ).map(([count, template], index) => (
              <InsightLine
                key={index}
                share={percentOf(count, chosen.attempts)}
                template={template}
              />
            ))}
          </ul>
          <p className={ROW_META_CLASS}>
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

export function UsageDialogContent({
  models = [],
  report,
  usage,
  context,
  team,
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
    body = <p className={ROW_META_CLASS}>{UI_TEXT.usageLoading}</p>
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
          <Suspense fallback={<p role="status">{UI_TEXT.usageLoading}</p>}>
            <ProviderUsageSection providers={report.providers} />
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
            <Suspense fallback={<p role="status">{UI_TEXT.usageLoading}</p>}>
              <PaidSection paid={paid} features={paidFeatures} onForgetPaidUse={onForgetPaidUse} />
            </Suspense>
          </>
        ) : null}
        {team === undefined ? null : (
          <>
            <h3 className="usage-heading">{UI_TEXT.teamUsageTitle}</h3>
            <Suspense fallback={null}>
              <TeamSection team={team} />
            </Suspense>
          </>
        )}
        <h3 className="usage-heading">{UI_TEXT.usageContributing}</h3>
        {report.insights === undefined ? (
          <p className={ROW_META_CLASS}>
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
          <p className={ROW_META_CLASS}>{UI_TEXT.signInApiKeyDetail}</p>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              onSetupSignIn('byo')
            }}
          >
            {UI_TEXT.startWithOwnModel}
          </button>
          <p className={ROW_META_CLASS}>{UI_TEXT.startWithOwnModelDetail}</p>
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
    <UsageDialogContent
      auth={state.auth}
      report={state.usageReport}
      usage={state.usage}
      context={state.context}
      team={state.usageReport?.team}
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
      onOpenUsagePage={() => {
        postMessage({ type: 'hostAction', action: 'openUsagePage' })
      }}
      onClose={onClose}
    />
  )
}
