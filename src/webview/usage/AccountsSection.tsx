// M102/W mount this module by dynamic import on the usage page only.
import { useId } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { formatDateTime } from '../../shared/l10n/text'
import type { AccountUsageMeter, AccountUsageReport } from '../../core/usage/accountUsage'
import {
  accountUsageEventText,
  accountUsageMeterText,
  accountUsageRowText,
} from '../../core/usage/usageText'
import './AccountsSection.css'

function Meter({ meter }: { readonly meter: AccountUsageMeter }) {
  const text = accountUsageMeterText(meter)
  return (
    <div className="account-usage-meter">
      <p>
        {text.label}: {text.value}
      </p>
      {meter.progress === null ? null : (
        <progress
          max={100}
          value={meter.progress}
          aria-label={text.label}
          aria-valuetext={text.value}
        />
      )}
      <p>{text.detail}</p>
    </div>
  )
}

/** Report is supplied by M102's validated bridge, never read from vendor frames. */
export default function AccountsSection({ report }: { readonly report: AccountUsageReport }) {
  const titleId = useId()
  return (
    <section className="account-usage" aria-labelledby={titleId}>
      <h2 id={titleId}>{UI_TEXT.accounts.title}</h2>
      {report.accounts.map((row) => (
        <section
          key={JSON.stringify([row.provider, row.account])}
          aria-label={`${row.providerLabel} · ${row.label}`}
        >
          <h3>
            {row.providerLabel} · {row.label}
          </h3>
          {accountUsageRowText(row).map((line) => (
            <p key={line}>{line}</p>
          ))}
          {row.meters.map((meter) => (
            <Meter key={JSON.stringify([meter.metric, meter.period, meter.window])} meter={meter} />
          ))}
        </section>
      ))}
      {report.events.length === 0 ? null : (
        <section aria-label={UI_TEXT.accounts.usageEvents}>
          <h3>{UI_TEXT.accounts.usageEvents}</h3>
          <ol>
            {report.events.map((event, index) => (
              <li key={index}>
                <time dateTime={event.time}>{formatDateTime(Date.parse(event.time))}</time>
                <p>{accountUsageEventText(event, report)}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  )
}
