// M125 lane H (D107 §8.1 step 4): the ten-question smoke. Batched,
// warm, productive: it counts right answers and feeds verified-path
// latency back to the table. The questions are injected (their words
// ship with the wizard's bundles); the verdict math here is pure and
// covered. Health is the same verdict over one fixture question.
import { JUDGE_SETUP_SMOKE_MIN_CORRECT } from '../../../shared/constants'

const P50_QUANTILE = 0.5
const P95_QUANTILE = 0.95

export interface SmokeQuestion {
  readonly id: string
  readonly family: string
}

export interface SmokeAnswer {
  readonly correct: boolean
  readonly latencyMs: number
}

export interface SmokeVerdict {
  readonly correct: number
  readonly total: number
  /** Nearest-rank over answers, mirroring the resolver's p95. Unknown when unanswered. */
  readonly p50Ms?: number | undefined
  readonly p95Ms?: number | undefined
  readonly passed: boolean
}

function quantile(sorted: readonly number[], quantile: number): number | undefined {
  if (sorted.length === 0) return undefined
  const rank = Math.ceil(sorted.length * quantile) - 1
  return sorted[Math.min(sorted.length - 1, rank)]
}

/**
The verdict over answers: right count and latency ranks, passing at
minCorrect (the smoke bar by default, 1 for the health fixture). No
answers is not passed, with unknown latency — never zero.
*/
export function smokeVerdict(
  results: readonly SmokeAnswer[],
  minCorrect: number = JUDGE_SETUP_SMOKE_MIN_CORRECT,
): SmokeVerdict {
  const correct = results.filter((result) => result.correct).length
  const latencies = results
    .map((result) => result.latencyMs)
    .toSorted((left, right) => left - right)
  const p50Ms = quantile(latencies, P50_QUANTILE)
  const p95Ms = quantile(latencies, P95_QUANTILE)
  return {
    correct,
    total: results.length,
    ...(p50Ms !== undefined && { p50Ms }),
    ...(p95Ms !== undefined && { p95Ms }),
    passed: results.length > 0 && correct >= minCorrect,
  }
}

/**
Ask the batch through the judge and judge the verdict. The asker is
2j-bound (live-proof deferred with the runtime); a failure it throws
fails setup loudly.
@unwired M125 smoke batch run (wiring: the setup flow, lane W)
*/
export async function runSmoke(
  questions: readonly SmokeQuestion[],
  ask: (questions: readonly SmokeQuestion[]) => Promise<readonly SmokeAnswer[]>,
  minCorrect?: number,
): Promise<SmokeVerdict> {
  return smokeVerdict(await ask(questions), minCorrect)
}
