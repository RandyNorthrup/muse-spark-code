import { ESTIMATE_PRIOR_SIGMA } from '../../../shared/constants'

/** Observed lower bounds, not complete/representative M116 projections. See prior.md. */
const REVIEW_RECORDS = [
  { laneId: 'M70:e', rounds: 4, record: 'docs/certification/m70.md' },
  { laneId: 'M83:import', rounds: 5, record: 'docs/certification/m83e.md' },
  { laneId: 'M91:P', rounds: 3, record: 'docs/certification/m91-p.md' },
]

/** Duration parameters describe log(actualHours / estimatedHours). */
export function calibrationPrior() {
  const rounds = REVIEW_RECORDS.reduce((total, record) => total + record.rounds, 0)
  const continuations = REVIEW_RECORDS.reduce((total, record) => total + record.rounds - 1, 0)
  return {
    mu: 0,
    sigma: ESTIMATE_PRIOR_SIGMA,
    reviewRoundRate: continuations / rounds,
    reviewSamples: REVIEW_RECORDS.length,
    // Uniform Bernoulli prior: the legacy narratives have no eligible-module denominator.
    redesignRisk: 1 / 2,
    reviewRecords: REVIEW_RECORDS.map((record) => ({ ...record })),
  }
}
