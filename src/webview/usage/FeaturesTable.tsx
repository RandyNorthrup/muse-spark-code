import { USAGE_TEXT } from '../../shared/l10n/usageTable'
import type { UsagePageState } from '../../shared/usagePage'
import { TotalCells } from './BreakdownTable'
import { count, duration, kindLabel } from './display'

export function FeaturesTable({ features }: { readonly features: UsagePageState['features'] }) {
  if (features.length === 0)
    return (
      <section>
        <h2>{USAGE_TEXT.features}</h2>
        <p>{USAGE_TEXT.emptyRange}</p>
      </section>
    )
  return (
    <section>
      <h2>{USAGE_TEXT.features}</h2>
      <div
        className="usage-table-scroll"
        role="region"
        aria-label={USAGE_TEXT.features}
        tabIndex={0}
      >
        <table>
          <caption>{USAGE_TEXT.features}</caption>
          <thead>
            <tr>
              {[
                USAGE_TEXT.feature,
                USAGE_TEXT.cost,
                USAGE_TEXT.inputTokens,
                USAGE_TEXT.outputTokens,
                USAGE_TEXT.cachedTokens,
                USAGE_TEXT.cacheWriteTokens,
                USAGE_TEXT.reasoningTokens,
                USAGE_TEXT.requests,
                USAGE_TEXT.time,
                USAGE_TEXT.retries,
                USAGE_TEXT.rateLimited,
                USAGE_TEXT.searches,
                USAGE_TEXT.images,
                USAGE_TEXT.audioSeconds,
              ].map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {features.map((row) => (
              <tr key={row.kind}>
                <th scope="row">{kindLabel(row.kind)}</th>
                <TotalCells totals={row.totals} />
                <td>{count(row.totals.units.searches)}</td>
                <td>{count(row.totals.units.images)}</td>
                <td>
                  {duration(
                    row.totals.units.audioSeconds === undefined
                      ? undefined
                      : row.totals.units.audioSeconds * MILLISECONDS_PER_SECOND,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
import { MILLISECONDS_PER_SECOND } from '../../shared/constants'
