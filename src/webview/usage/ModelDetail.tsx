import { USAGE_TEXT } from '../../shared/l10n/usageTable'
import { fill, formatUnit } from '../../shared/l10n/text'
import type { UsagePageState } from '../../shared/usagePage'
import { dayLabel, type PostUsage } from './display'
import { TotalsGrid } from './KpiTiles'
import { StackedColumns } from './charts/StackedColumns'
import { useMoneyDisplay } from '../money'

/** A per-million rate with the lazy money chunk's exact display. */
function PriceText({ value }: { readonly value: number | undefined }) {
  const money = useMoneyDisplay()
  if (value === undefined) {
    return <>{USAGE_TEXT.unknown}</>
  }
  const cost = money === undefined ? undefined : money.formatTestCost(money.parseAmount(value))
  return cost === undefined ? null : <>{cost}</>
}

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
          <dd>
            <PriceText value={price?.inputPerMillion} />
          </dd>
        </div>
        <div>
          <dt>{USAGE_TEXT.cachedTokens}</dt>
          <dd>
            <PriceText value={price?.cachedPerMillion} />
          </dd>
        </div>
        <div>
          <dt>{USAGE_TEXT.cacheWriteTokens}</dt>
          <dd>
            <PriceText value={price?.cacheWritePerMillion} />
          </dd>
        </div>
        <div>
          <dt>
            {fill(USAGE_TEXT.cacheWrite1hTokens, {
              duration: formatUnit(1, 'hour'),
            })}
          </dt>
          <dd>
            <PriceText value={price?.cacheWrite1hPerMillion} />
          </dd>
        </div>
        <div>
          <dt>{USAGE_TEXT.outputTokens}</dt>
          <dd>
            <PriceText value={price?.outputPerMillion} />
          </dd>
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
