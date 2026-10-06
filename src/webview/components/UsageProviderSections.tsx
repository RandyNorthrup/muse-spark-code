import { paidCostUsd, paidFeatureName, type PaidState } from '../../shared/paid'
import { UI_TEXT, type ModelPricing, TAB_DAILY_BUDGET_DEFAULT_USD } from '../../shared/constants'
import { fill, formatNumber, plural } from '../../shared/l10n/text'
import { backendLabel, formatTokenWindow } from '../../shared/palette'
import { planLabel, type AccountFacts, type ProviderUsageRow } from '../../shared/usage'
import { formatUsd } from '../../core/usage/insights'
import type { UsageReport } from '../state/uiState'
export { PlanUsageSection } from './PlanUi'

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

/**
 * How a provider row's cost reads: settled dollars, `unpriced`, `local`,
 * `plan`, or nothing yet for a priced model the host has not settled (M95).
 */
function providerCost(row: ProviderUsageRow): string | undefined {
  if (row.pricing === 'plan') return UI_TEXT.modelPlan
  if (row.costUsd !== undefined) {
    return formatUsd(row.costUsd)
  }
  switch (row.pricing) {
    case 'priced': {
      return undefined
    }
    case 'unpriced': {
      return UI_TEXT.modelUnpriced
    }
    case 'local': {
      // A local model shows cost 0 (M95 acceptance 10).
      return formatUsd(0)
    }
  }
}

/**
 * This window's tallies per BYO provider (M95): tokens with their settled
 * cost, and an account-connected key's own usage, limit and remainder where
 * the provider reports them (today only OpenRouter's `/key`, in USD). Each
 * metric is its own row, so no language's word order is assumed.
 */
export function ProvidersSection({
  providers,
}: {
  readonly providers: readonly ProviderUsageRow[]
}) {
  return (
    <>
      <h3 className="usage-heading">{UI_TEXT.providersSectionTitle}</h3>
      <dl className="usage-facts">
        {providers.map((row) => {
          const cost = providerCost(row)
          return (
            <div key={row.providerId}>
              <dt>{row.providerLabel}</dt>
              <dd>
                {cost === undefined
                  ? `${formatTokenWindow(row.inputTokens)} / ${formatTokenWindow(row.outputTokens)}`
                  : `${formatTokenWindow(row.inputTokens)} / ${formatTokenWindow(row.outputTokens)} · ${cost}`}
              </dd>
              {row.keyUsage === undefined ? null : (
                <>
                  <dt>{UI_TEXT.usageKeyUsage}</dt>
                  <dd>
                    <dl className="usage-facts">
                      <dt>{UI_TEXT.usageToday}</dt>
                      <dd>{formatUsd(row.keyUsage.todayUsd)}</dd>
                      <dt>{UI_TEXT.usageThisMonth}</dt>
                      <dd>{formatUsd(row.keyUsage.monthUsd)}</dd>
                      {row.keyUsage.limitUsd === undefined ? null : (
                        <>
                          <dt>{UI_TEXT.usageLimit}</dt>
                          <dd>{formatUsd(row.keyUsage.limitUsd)}</dd>
                        </>
                      )}
                      {row.keyUsage.remainingUsd === undefined ? null : (
                        <>
                          <dt>{UI_TEXT.usageRemaining}</dt>
                          <dd>{formatUsd(row.keyUsage.remainingUsd)}</dd>
                        </>
                      )}
                    </dl>
                  </dd>
                </>
              )}
            </div>
          )
        })}
      </dl>
    </>
  )
}

export function AccountSection({
  report,
  modelId,
  modelPricing,
  providerId,
  provider,
}: {
  readonly report: UsageReport
  readonly modelId: string | undefined
  readonly modelPricing: ModelPricing | undefined
  readonly providerId: string | undefined
  readonly provider: string
}) {
  const { account } = report
  const signIn =
    providerId === 'chatgpt' || providerId === 'copilot'
      ? fill(UI_TEXT.planUi.providerMark, { provider })
      : signInLabel(account?.signInMethod)
  const plan = modelPricing === 'plan' ? UI_TEXT.modelPlan : planFor(report)
  return (
    <dl className="usage-facts">
      <dt>{UI_TEXT.usageAuthMethod}</dt>
      <dd>{signIn}</dd>
      <dt>{UI_TEXT.usagePlan}</dt>
      <dd>{plan}</dd>
      <dt>{UI_TEXT.usageBackend}</dt>
      <dd>{modelPricing === 'plan' ? provider : backendLabel(report.backend)}</dd>
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
 * The Tab row (M94 lane U, PLAN.md D73 acceptance 16): today's spend against
 * the daily budget, the request count, and the on/off state. "Today" is the
 * ledger's total for the local day across every window, shown once Tab has
 * run in this window (the ledger is read by dist/tab.js); "This window" is
 * this window's reported cost; the budget is the configured one (RVM94HU
 * 23–24). While Tab is off and has never run here, the row says off with the
 * budget instead of zeros that read as use. The facts wrap, as the other
 * token rows do (RVM94HU 25).
 */
export function TabRow({
  paid,
  state,
  useText,
}: {
  readonly paid: PaidState
  readonly state: string
  readonly useText: string
}) {
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
            {`${useText} · ${fill(UI_TEXT.usagePaidTabTokens, {
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
