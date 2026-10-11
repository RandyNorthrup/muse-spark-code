import { USAGE_TEXT } from '../../shared/l10n/usageTable'
import { fill, formatPercent, plural } from '../../shared/l10n/text'
import type { UsageTotals, UsageQuery } from '../../shared/usagePage'
import type { UsageCertainty } from '../../shared/usageJournal'
import {
  metricValue,
  metricLabel,
  metricText,
  certaintyLabel,
  costText,
  totalsFacts,
} from './display'

function certaintyNote(certainty: UsageCertainty): string | undefined {
  switch (certainty) {
    case 'uncertain': {
      return USAGE_TEXT.uncertainNote
    }
    case 'unpriced': {
      return USAGE_TEXT.unpricedNote
    }
    case 'local': {
      return USAGE_TEXT.localNote
    }
    case 'estimated': {
      return USAGE_TEXT.estimatedNote
    }
    default: {
      return undefined
    }
  }
}

export function TotalsGrid({ totals }: { readonly totals: UsageTotals }) {
  return (
    <dl className="usage-kpis">
      {totalsFacts(totals).map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}
export function KpiTiles({
  totals,
  previous,
  metric,
}: {
  readonly totals: UsageTotals
  readonly previous: UsageTotals
  readonly metric: UsageQuery['metric']
}) {
  const currentCost = metricValue(totals, metric)
  const previousCost = metricValue(previous, metric)
  let comparison: string
  if (previous.records === 0) comparison = USAGE_TEXT.noPreviousPeriod
  else if (currentCost === undefined || previousCost === undefined || previousCost === 0)
    comparison = USAGE_TEXT.unknown
  else
    comparison = fill(USAGE_TEXT.periodChange, {
      change: formatPercent(((currentCost - previousCost) / previousCost) * 100),
    })
  return (
    <section aria-label={USAGE_TEXT.totalCost}>
      <TotalsGrid totals={totals} />
      <p>
        {USAGE_TEXT.previousPeriod}: {costText(previous)}
      </p>
      <p>
        {USAGE_TEXT.previousPeriod}: {metricLabel(metric)}: {metricText(previousCost, metric)}
      </p>
      <p>{comparison}</p>
      <h2>{USAGE_TEXT.certainty}</h2>
      <ul className="usage-certainties">
        {totals.costs.map((row) => (
          <li key={row.certainty}>
            <strong>{certaintyLabel(row.certainty)}</strong>:{' '}
            {plural(USAGE_TEXT.recordCount, row.records)} · {costText({ ...totals, costs: [row] })}
            {certaintyNote(row.certainty) === undefined ? null : (
              <p>{certaintyNote(row.certainty)}</p>
            )}
          </li>
        ))}
      </ul>
      {totals.tokens.estimated === true ? <p>{USAGE_TEXT.estimatedNote}</p> : null}
      <p>{USAGE_TEXT.apiEquivalentNote}</p>
      <p>{USAGE_TEXT.reasoningNote}</p>
    </section>
  )
}
