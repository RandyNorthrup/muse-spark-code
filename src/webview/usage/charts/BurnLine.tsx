import { USAGE_TEXT } from '../../../shared/l10n/usageTable'
import { fill, formatDateTime } from '../../../shared/l10n/text'
import type { UsagePageState } from '../../../shared/usagePage'
import { money } from '../display'
import { ChartFrame } from './ChartFrame'

export function BurnLine({
  budget,
  now,
}: {
  readonly budget: UsagePageState['budgets'][number]
  readonly now: number
}) {
  const points = [
    { id: 'now', label: formatDateTime(now), values: [budget.spentUsd, undefined, budget.capUsd] },
    {
      id: 'projection',
      label: budget.resetsAt === undefined ? USAGE_TEXT.unknown : formatDateTime(budget.resetsAt),
      values: [undefined, budget.projectedUsd, budget.capUsd],
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
  const max = Math.max(1, budget.spentUsd, budget.projectedUsd ?? 0, budget.capUsd ?? 0)
  return (
    <ChartFrame
      title={USAGE_TEXT.chartBurn}
      summary={fill(USAGE_TEXT.budgetProjection, { amount: money(budget.projectedUsd) })}
      series={series}
      points={points}
      format={money}
    >
      {() => (
        <>
          <circle
            className="usage-series-blue"
            cx={0}
            cy={100 - (budget.spentUsd / max) * 100}
            r={2}
          />
          {budget.projectedUsd === undefined ? null : (
            <line
              className="usage-line usage-projection usage-series-purple"
              x1={0}
              y1={100 - (budget.spentUsd / max) * 100}
              x2={100}
              y2={100 - (budget.projectedUsd / max) * 100}
            />
          )}
          {budget.capUsd === undefined ? null : (
            <line
              className="usage-line usage-series-orange"
              x1={0}
              x2={100}
              y1={100 - (budget.capUsd / max) * 100}
              y2={100 - (budget.capUsd / max) * 100}
            />
          )}
        </>
      )}
    </ChartFrame>
  )
}
