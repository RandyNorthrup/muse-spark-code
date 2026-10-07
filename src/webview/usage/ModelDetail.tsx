import { USAGE_TEXT } from '../../shared/l10n/usageTable'
import { fill, formatUnit } from '../../shared/l10n/text'
import type { UsagePageState } from '../../shared/usagePage'
import { dayLabel, type PostUsage } from './display'
import { TotalsGrid } from './KpiTiles'
import { StackedColumns } from './charts/StackedColumns'
import { formatTestCost } from '../models/components/CostNotice'

export function ModelDetail({
  state,
  post,
  onClose,
}: {
  readonly state: UsagePageState
  readonly post: PostUsage
  readonly onClose: () => void
}) {
  const detail = state.modelDetail
  if (detail === undefined) return null
  const price = detail.price
  const priceText = (value: number | undefined) =>
    value === undefined ? USAGE_TEXT.unknown : formatTestCost(value)
  const source =
    price === undefined
      ? USAGE_TEXT.unknown
      : {
          list: USAGE_TEXT.priceList,
          catalogue: USAGE_TEXT.priceCatalogue,
          user: USAGE_TEXT.priceUser,
          'meta-published': USAGE_TEXT.priceMetaPublished,
        }[price.source]
  return (
    <section className="usage-model-detail" aria-labelledby="usage-model-title">
      <h2 id="usage-model-title">
        {USAGE_TEXT.modelDetail}: {detail.provider} / {detail.model}
      </h2>
      <button type="button" onClick={onClose}>
        {USAGE_TEXT.close}
      </button>
      <button
        type="button"
        disabled={state.capabilities?.models === false}
        onClick={() => {
          post({ type: 'usage/openModels', provider: detail.provider, model: detail.model })
        }}
      >
        {USAGE_TEXT.setPrice}
      </button>
      {detail.pricedLater ? (
        <>
          <h3>{USAGE_TEXT.pricedLater}</h3>
          <p>{USAGE_TEXT.pricedLaterNote}</p>
        </>
      ) : null}
      <TotalsGrid totals={detail.totals} />
      <h3>{USAGE_TEXT.pricePerMillion}</h3>
      <dl>
        <div>
          <dt>{USAGE_TEXT.inputTokens}</dt>
          <dd>{priceText(price?.inputPerMillion)}</dd>
        </div>
        <div>
          <dt>{USAGE_TEXT.cachedTokens}</dt>
          <dd>{priceText(price?.cachedPerMillion)}</dd>
        </div>
        <div>
          <dt>{USAGE_TEXT.cacheWriteTokens}</dt>
          <dd>{priceText(price?.cacheWritePerMillion)}</dd>
        </div>
        <div>
          <dt>
            {fill(USAGE_TEXT.cacheWrite1hTokens, {
              duration: formatUnit(1, 'hour'),
            })}
          </dt>
          <dd>{priceText(price?.cacheWrite1hPerMillion)}</dd>
        </div>
        <div>
          <dt>{USAGE_TEXT.outputTokens}</dt>
          <dd>{priceText(price?.outputPerMillion)}</dd>
        </div>
        <div>
          <dt>{USAGE_TEXT.priceSource}</dt>
          <dd>{source}</dd>
        </div>
        <div>
          <dt>{USAGE_TEXT.priceDate}</dt>
          <dd>{price === undefined ? USAGE_TEXT.unknown : dayLabel(price.date)}</dd>
        </div>
      </dl>
      {detail.trend.length === 0 ? (
        <p>{USAGE_TEXT.emptyRange}</p>
      ) : (
        <StackedColumns
          state={{
            ...state,
            query: { ...state.query, metric: 'cost', groupBy: 'model' },
            buckets: detail.trend,
            breakdown: detail.trend
              .flatMap((bucket) => bucket.groups)
              .filter(
                (row, index, all) =>
                  all.findIndex((candidate) => candidate.id === row.id) === index,
              ),
          }}
        />
      )}
    </section>
  )
}
