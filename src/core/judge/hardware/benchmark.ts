// M125 lane H (D107): the scan's CPU throughput probe. A fixed hashing
// loop in time-sliced chunks, so the event loop stays responsive while
// the probe measures. The hard deadline always wins: the probe reports
// what it measured, never more than the budget. No verified-path
// mapping exists yet, so the result is a raw rate, never a class.
import { createHash } from 'node:crypto'
import { JUDGE_SCAN_BENCH_MS } from '../../../shared/constants'
import type { JudgeBenchmarkResult } from './types'

const CHUNK_ITERATIONS = 2000
const BENCH_BYTES = 'judge-scan-benchmark'
const MS_PER_SECOND = 1000

function hashChunk(): void {
  for (let index = 0; index < CHUNK_ITERATIONS; index += 1) {
    createHash('sha256').update(BENCH_BYTES).digest()
  }
}

const nextTick = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve)
  })

/** Hash until the deadline, yielding between chunks. */
export async function runCpuBenchmark(
  deadlineMs: number = JUDGE_SCAN_BENCH_MS,
): Promise<JudgeBenchmarkResult> {
  const started = Date.now()
  let iterations = 0
  for (;;) {
    hashChunk()
    iterations += CHUNK_ITERATIONS
    if (Date.now() - started >= deadlineMs) break
    await nextTick()
  }
  const elapsedMs = Date.now() - started
  return {
    kind: 'unmapped',
    iterations,
    elapsedMs,
    ratePerSec: elapsedMs === 0 ? 0 : (iterations / elapsedMs) * MS_PER_SECOND,
  }
}
