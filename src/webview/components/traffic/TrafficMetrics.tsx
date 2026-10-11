import { MILLISECONDS_PER_SECOND } from '../../../shared/constants'
import {
  formatDateTime,
  formatNumber,
  formatPercent,
  formatUnit,
  UI_TEXT,
} from '../../../shared/l10n/text'
import { formatUsd } from '../../../shared/l10n/exactUsd'
import { TrafficSection, type TrafficProps } from './TrafficParts'

const ratio = (numerator: number, denominator: number) =>
  denominator === 0 ? '—' : formatNumber(numerator / denominator)
const duration = (ms: number | null) =>
  ms === null ? '—' : formatUnit(ms / MILLISECONDS_PER_SECOND, 'second')
export function TrafficMetrics({ state }: TrafficProps) {
  return (
    <TrafficSection title={UI_TEXT.teamTraffic.metrics}>
      {state.metrics.map((metrics, index) => (
        <section
          key={index}
          aria-label={[
            UI_TEXT.teamTrafficMetrics[metrics.period],
            metrics.roleId,
            metrics.entryId,
            metrics.agentProfileId,
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          <h4>
            {[
              UI_TEXT.teamTrafficMetrics[metrics.period],
              metrics.roleId,
              metrics.entryId,
              metrics.agentProfileId,
            ]
              .filter(Boolean)
              .join(' · ')}
          </h4>
          <dl className="traffic-metrics">
            <dt>{UI_TEXT.teamTrafficMetrics.utilisation}</dt>
            <dd>
              {metrics.availableSlotMs === 0
                ? '—'
                : formatPercent((100 * metrics.busySlotMs) / metrics.availableSlotMs)}
            </dd>
            <dt>{UI_TEXT.teamTrafficMetrics.waitMedian}</dt>
            <dd>{duration(metrics.waitMedianMs)}</dd>
            <dt>{UI_TEXT.teamTrafficMetrics.waitP90}</dt>
            <dd>{duration(metrics.waitP90Ms)}</dd>
            <dt>{UI_TEXT.teamTrafficMetrics.conflictRate}</dt>
            <dd>
              {UI_TEXT.teamTrafficDetails.predictedRate}:{' '}
              {ratio(metrics.predictedConflicts, metrics.writingTasks)} ·{' '}
              {UI_TEXT.teamTrafficDetails.mergeRate}:{' '}
              {ratio(metrics.mergeConflicts, metrics.landings)}
            </dd>
            <dt>{UI_TEXT.teamTrafficMetrics.reworkRate}</dt>
            <dd>
              {UI_TEXT.teamTrafficDetails.reviewRounds}:{' '}
              {ratio(metrics.reworkRounds, metrics.taskCount)} ·{' '}
              {UI_TEXT.teamTrafficDetails.reassignments}:{' '}
              {ratio(metrics.reassignments, metrics.taskCount)} ·{' '}
              {UI_TEXT.teamTrafficDetails.candidatesReturned}:{' '}
              {ratio(metrics.candidatesReturned, metrics.taskCount)}
            </dd>
            <dt>
              {UI_TEXT.teamTrafficMetrics.costPerMerge} · {UI_TEXT.teamTrafficMetrics.reported}
            </dt>
            <dd>
              {metrics.mergedChanges === 0
                ? '—'
                : formatUsd(metrics.reportedCostUsd / metrics.mergedChanges, 2)}{' '}
              · {UI_TEXT.goalTokens}: {ratio(metrics.reportedTokens, metrics.mergedChanges)}
            </dd>
            <dt>
              {UI_TEXT.teamTrafficMetrics.costPerMerge} · {UI_TEXT.teamTrafficMetrics.estimated}
            </dt>
            <dd>
              {metrics.mergedChanges === 0
                ? '—'
                : formatUsd(metrics.estimatedCostUsd / metrics.mergedChanges, 2)}{' '}
              · {UI_TEXT.goalTokens}: {ratio(metrics.estimatedTokens, metrics.mergedChanges)}
            </dd>
            <dt>{UI_TEXT.teamTrafficMetrics.timeToMerge}</dt>
            <dd>{duration(metrics.timeToMergeMedianMs)}</dd>
          </dl>
          <h4>{UI_TEXT.teamTrafficMetrics.queueDepth}</h4>
          <ul>
            {metrics.queueDepth.map((sample, sampleIndex) => (
              <li key={sampleIndex}>
                {formatDateTime(sample.at)}: {UI_TEXT.teamTaskStates.ready}{' '}
                {formatNumber(sample.ready)} · {UI_TEXT.teamTaskStates.blocked}{' '}
                {formatNumber(sample.blocked)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </TrafficSection>
  )
}
