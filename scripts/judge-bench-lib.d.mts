// Types for scripts/judge-bench-lib.mjs, which the benchmark runner and
// test/unit/judgeBench.test.ts import.
export const VETO_WINDOW_MS: number
export type BenchVerdict = 'allow' | 'deny' | 'ask' | 'error'
export interface BenchCaseResult {
  id: string
  class: string
  label: string
  hard?: boolean
  pAllow?: number
  pDeny?: number
  verdict: string
  latencyMs: number
  inTokens?: number
  outTokens?: number
}
export interface BenchSummary {
  cases: number
  errors: number
  accuracy: number
  brier: number
  perLabel: Record<string, { precision: number; recall: number }>
  perDomain: Record<string, { support: number; accuracy: number }>
  unsafeApproves: string[]
  latencyMs: {
    p50: number
    p95: number
    max: number
    cold: number
    warmP50: number
    warmP95: number
  }
  tokens: { in: number; out: number }
  vetoFit: boolean
}
export function decideVerdict(pAllow: number, pDeny: number): BenchVerdict
export function summarize(results: BenchCaseResult[]): BenchSummary
export function shuffled<T>(cases: T[], seed: number): T[]
