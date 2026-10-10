import { accountsNoticeSchema, modelsAccountsSliceSchema } from '../../../../shared/accountsPanel'
import { UI_TEXT } from '../../../../shared/constants'
import { fill, formatDateTime, formatNumber } from '../../../../shared/l10n/text'
import { formatUsd, parseUsd } from '../../../../shared/accountUsd'
import { ExternalLink } from '../../../components/ExternalLink'

/** Transcript metadata: event ids stay opaque; labels are resolved locally. */
export function AccountNotices({
  value,
  events,
  onOpenLink,
}: {
  readonly value: unknown
  readonly events: readonly unknown[]
  readonly onOpenLink: (url: string) => void
}) {
  const slice = modelsAccountsSliceSchema.safeParse(value)
  if (!slice.success) return <p role="alert">{UI_TEXT.accounts.invalidAccount}</p>
  const names = (id: string) => slice.data.accounts.find((row) => row.id === id)?.label ?? id
  const periodNames = {
    day: UI_TEXT.usageDay,
    week: UI_TEXT.usageWeek,
    month: UI_TEXT.accounts.month,
  }
  const metricNames = {
    spendUsd: UI_TEXT.accounts.spend,
    inputTokens: UI_TEXT.accounts.inputTokens,
    outputTokens: UI_TEXT.accounts.outputTokens,
    requests: UI_TEXT.accounts.requests,
  }
  return (
    <div className="account-notices" role="log" aria-label={UI_TEXT.accounts.title}>
      {events.map((value, index) => {
        const parsed = accountsNoticeSchema.safeParse(value)
        if (!parsed.success || parsed.data.event.provider !== slice.data.provider) return null
        const event = parsed.data.event
        if (event.type === 'spread') return null
        const reset = parsed.data.resetAt
        if (event.type === 'stop')
          return (
            <div key={index}>
              <p>
                {reset === null
                  ? fill(UI_TEXT.accounts.resetUnknown, { provider: slice.data.providerLabel })
                  : fill(UI_TEXT.accounts.stopped, {
                      provider: slice.data.providerLabel,
                      reset: formatDateTime(Date.parse(reset)),
                    })}
              </p>
              {slice.data.usageUrl === null ? null : (
                <ExternalLink
                  url={slice.data.usageUrl}
                  title={UI_TEXT.usageHeading}
                  onOpenLink={onOpenLink}
                  onRefuseLink={undefined}
                />
              )}
            </div>
          )
        const trigger = event.trigger
        // Display rule: a shortened cap renders with ceiling, never below the
        // exact trigger, so an exact reach always shows value >= cap. Reach
        // state itself comes from the exact trigger event, never the text.
        const threshold =
          trigger.kind === 'vendorLimit'
            ? UI_TEXT.accounts.vendorLimit
            : `${UI_TEXT.accounts.userCap}: ${metricNames[trigger.metric]} (${periodNames[trigger.period]}) ${trigger.metric === 'spendUsd' ? formatUsd(parseUsd(trigger.threshold)) : formatNumber(trigger.threshold)}`
        return (
          <div key={index}>
            <p>
              {fill(UI_TEXT.accounts.swapNotice, {
                provider: slice.data.providerLabel,
                account: names(event.account),
                previous: names(event.previousAccount),
                threshold,
              })}
            </p>
            <p>
              {fill(UI_TEXT.accounts.coldCache, { cost: formatUsd(parseUsd(event.coldCacheUsd)) })}
            </p>
          </div>
        )
      })}
    </div>
  )
}
