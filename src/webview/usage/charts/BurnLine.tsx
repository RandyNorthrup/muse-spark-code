import { USAGE_TEXT } from '../../../shared/l10n/usageTable'
import { fill, formatDateTime } from '../../../shared/l10n/text'
import type { UsagePageState } from '../../../shared/usagePage'
import { costPlot, metricText, money } from '../display'
import { ChartFrame } from './ChartFrame'
import { Usd } from '../../../shared/usd'

export function BurnLine({
  budget,
  now,
}: {
  readonly budget: UsagePageState['budgets'][number]
  readonly now: number
}) {
  // Geometry in whole nano-dollars (`costPlot`); every label shows the
  // original amount, never a value rebuilt from geometry (M121 P2-2).
  const spent = costPlot(budget.spentUsd) ?? 0
  const projected = costPlot(budget.projectedUsd)
  const cap = costPlot(budget.capUsd)
  const points = [
    {
      id: 'now',
      label: formatDateTime(now),
      values: [spent, undefined, cap],
      texts: [money(budget.spentUsd), undefined, money(budget.capUsd)],
    },
    {
      id: 'projection',
      label: budget.resetsAt === undefined ? USAGE_TEXT.unknown : formatDateTime(budget.resetsAt),
      values: [undefined, projected, cap],
      texts: [undefined, money(budget.projectedUsd), money(budget.capUsd)],
    },
  ]
  const series = [
    { id: 'spent', label: USAGE_TEXT.totalCost, colour: 'blue' },
    {
      id: 'projection',
      label: fill(USAGE_TEXT.budgetProjection, { amount: money(budget.projectedUsd) }),
      colour: 'purple',
    },
    { id: 'cap', label: USAGE_TEXT.limits, colour: 'orange' },
  ]
  // At least one dollar of scale, as before.
  const max = Math.max(costPlot(Usd.from(1).toAmount()) ?? 1, spent, projected ?? 0, cap ?? 0)
  return (
    <ChartFrame
      title={USAGE_TEXT.chartBurn}
      summary={fill(USAGE_TEXT.budgetProjection, { amount: money(budget.projectedUsd) })}
      series={series}
      points={points}
      format={(value) => metricText(value, 'cost')}
    >
      {(_active, pattern) => (
        <>
          <circle
            className="usage-series-blue"
            fill={pattern('blue')}
            cx={0}
            cy={100 - (spent / max) * 100}
            r={2}
          />
          {projected === undefined ? null : (
            <line
              className="usage-line usage-projection usage-series-purple"
              x1={0}
              y1={100 - (spent / max) * 100}
              x2={100}
              y2={100 - (projected / max) * 100}
            />
          )}
          {cap === undefined ? null : (
            <line
              className="usage-line usage-series-orange"
              x1={0}
              x2={100}
              y1={100 - (cap / max) * 100}
              y2={100 - (cap / max) * 100}
            />
          )}
        </>
      )}
    </ChartFrame>
  )
}
