import { UI_TEXT } from '../../shared/constants'
import { formatTokenWindow } from '../../shared/palette'
import type { ProviderUsageRow } from '../../shared/usage'
import { formatUsd } from '../../core/usage/insights'
import { FactRows } from './FactRows'

/**
 * How a provider row's cost reads: settled dollars, `unpriced`, `local`,
 * `plan`, or nothing yet for a priced model the host has not settled (M95).
 */
function providerCost(row: ProviderUsageRow): string | undefined {
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
    case 'plan': {
      return UI_TEXT.modelPlan
    }
  }
}

/**
 * This window's tallies per BYO provider (M95): tokens with their settled
 * cost, and an account-connected key's own usage, limit and remainder where
 * the provider reports them (today only OpenRouter's `/key`, in USD). Each
 * metric is its own row, so no language's word order is assumed.
 */
export function ProviderUsageSection({
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
          const tokens = `${formatTokenWindow(row.inputTokens)} / ${formatTokenWindow(row.outputTokens)}`
          return (
            <div key={row.providerId}>
              <dt>{row.providerLabel}</dt>
              <dd>{cost === undefined ? tokens : `${tokens} · ${cost}`}</dd>
              {row.keyUsage === undefined ? null : (
                <>
                  <dt>{UI_TEXT.usageKeyUsage}</dt>
                  <dd>
                    <dl className="usage-facts">
                      <FactRows
                        rows={[
                          [UI_TEXT.usageToday, formatUsd(row.keyUsage.todayUsd)],
                          [UI_TEXT.usageThisMonth, formatUsd(row.keyUsage.monthUsd)],
                          [
                            UI_TEXT.usageLimit,
                            row.keyUsage.limitUsd === undefined
                              ? undefined
                              : formatUsd(row.keyUsage.limitUsd),
                          ],
                          [
                            UI_TEXT.usageRemaining,
                            row.keyUsage.remainingUsd === undefined
                              ? undefined
                              : formatUsd(row.keyUsage.remainingUsd),
                          ],
                        ]}
                      />
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
