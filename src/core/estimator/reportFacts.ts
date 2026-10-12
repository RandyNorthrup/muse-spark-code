// Typed estimator facts for the report-kinds lane (M117 C-M117-3R6): the
// exact typed fields the estimator exports, so no report kind decodes an
// English sentence. Amounts travel raw (numbers for counts/percent, exact
// decimal strings for usd); labels travel as rows, never parsed from text.
import type { EstimateLimitContext } from './limitContext'

export interface EstimatorReportOwner {
  readonly kind: 'account' | 'machine'
  readonly id: string
  readonly providerId: string | null
  readonly generation: string | null
}
export interface EstimatorReportWindow {
  readonly startsAt: string | null
  readonly resetsAt: string | null
  readonly periodSeconds: number | null
  readonly calendarPeriod: 'day' | 'week' | 'month' | null
}
export interface EstimatorReportFact {
  readonly owner: EstimatorReportOwner
  readonly metric: string
  readonly unit: 'requests' | 'tokens' | 'percent' | 'usd' | null
  readonly used: number | string | null
  readonly limit: number | string | null
  readonly remaining: number | string | null
  readonly window: EstimatorReportWindow
  readonly observedAt: string
  readonly observedBy: string
}
export interface EstimatorReportLabel {
  readonly accountId: string
  readonly providerId: string
  readonly label: string
}
export interface EstimatorReportFacts {
  readonly facts: readonly EstimatorReportFact[]
  readonly labels: readonly EstimatorReportLabel[]
}

/** The context's facts and labels as typed report rows, field for field. */
export function reportFactsFromContext(context: EstimateLimitContext): EstimatorReportFacts {
  return {
    facts: context.facts.map((fact) => ({
      owner: {
        kind: fact.owner.kind,
        id: fact.owner.id,
        providerId: fact.owner.providerId,
        generation: fact.owner.generation,
      },
      metric: fact.metric,
      unit: fact.unit,
      used: fact.used,
      limit: fact.limit,
      remaining: fact.remaining,
      window: {
        startsAt: fact.window.startsAt,
        resetsAt: fact.window.resetsAt,
        periodSeconds: fact.window.periodSeconds,
        calendarPeriod: fact.window.calendarPeriod,
      },
      observedAt: fact.observedAt,
      observedBy: fact.observedBy,
    })),
    labels: context.labels.map((label) => ({
      accountId: label.accountId,
      providerId: label.providerId,
      label: label.label,
    })),
  }
}
