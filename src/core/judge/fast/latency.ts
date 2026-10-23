// M125 lane E (D107): the rolling complete-call latency window one
// engine is judged by. The last 50 attempts; a timeout, error or
// no-answer is a miss with infinite latency, so three trailing misses
// suspend the engine at once. Our own cancellations are never
// recorded: there is no cancel path, only completed outcomes. For a
// local engine the samples are 2j's verified path, never raw
// inference. Timestamps are caller-supplied, so tests use exact
// values and production passes its clock.
import { JUDGE_FAST_LATENCY_WINDOW, JUDGE_FAST_REQUALIFY_PROBES } from '../../../shared/constants'

export type LatencyOutcome = { readonly latencyMs: number } | { readonly miss: true }

interface LatencySample {
  readonly atMs: number
  readonly outcome: LatencyOutcome
}

const TRAILING_MISS_SUSPENSION = 3
const P95_QUANTILE = 0.95

export class EngineLatency {
  private readonly samples: LatencySample[] = []

  constructor(private readonly maxSamples: number = JUDGE_FAST_LATENCY_WINDOW) {}

  /** Record one completed attempt; a miss carries infinite latency. */
  public record(outcome: LatencyOutcome, atMs: number): void {
    this.samples.push({ atMs, outcome })
    if (this.samples.length > this.maxSamples)
      this.samples.splice(0, this.samples.length - this.maxSamples)
  }

  /** Drop samples older than the TTL (hosted sample expiry). */
  public prune(nowMs: number, ttlMs: number): void {
    const cutoff = nowMs - ttlMs
    while (this.samples.length > 0 && (this.samples[0]?.atMs ?? 0) < cutoff) this.samples.shift()
  }

  /** Restart the window after requalification. */
  public reset(): void {
    this.samples.length = 0
  }

  public get size(): number {
    return this.samples.length
  }

  /** Trailing consecutive misses; three suspend the engine. */
  public trailingMisses(): number {
    let misses = 0
    for (let index = this.samples.length - 1; index >= 0; index -= 1) {
      if (!('miss' in (this.samples[index]?.outcome ?? {}))) break
      misses += 1
    }
    return misses
  }

  public isSuspended(): boolean {
    return this.trailingMisses() >= TRAILING_MISS_SUSPENSION
  }

  /**
  The rolling p95 in milliseconds, a miss as infinity. An empty window
  has no measurement, so it fits no deadline class.
  */
  public p95(): number {
    if (this.samples.length === 0) return Infinity
    const latencies = this.samples
      .map((sample) => ('miss' in sample.outcome ? Infinity : sample.outcome.latencyMs))
      .toSorted((left, right) => left - right)
    const rank = Math.ceil(latencies.length * P95_QUANTILE) - 1
    return latencies[Math.min(latencies.length - 1, rank)] ?? Infinity
  }
}

/**
Consecutive in-budget background probes toward (re)qualification. A
suspended or skipped local engine requalifies after three in a row,
then its window restarts; an unmeasured engine warms up after one
(lane choice: the minimal measurement before first use). Probes carry
no workspace content and a miss or over-budget answer restarts the
count. The caller spaces the probes; the tracker counts consecutive
in-budget answers.
*/
export class ProbeTracker {
  private consecutive = 0

  constructor(private readonly needed: number = JUDGE_FAST_REQUALIFY_PROBES) {}

  /** Record one probe; true when the engine qualifies now. */
  public probe(outcome: LatencyOutcome, budgetMs: number): boolean {
    this.consecutive =
      !('miss' in outcome) && outcome.latencyMs <= budgetMs ? this.consecutive + 1 : 0
    return this.consecutive >= this.needed
  }

  public get progress(): number {
    return this.consecutive
  }
}
