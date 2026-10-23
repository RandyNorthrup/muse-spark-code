// Price, labels and the deterministic-gate seam for a remote SystemOne call.
// Confidence math lives in ../math.ts. This file does not select a route.
import { TOKENS_PER_MILLION } from '../../../shared/constants'
import { Usd } from '../../../shared/usd'
import { USD_DECIMAL_RADIX, USD_LIABILITY_DECIMALS } from '../../../shared/usdConstants'
import type { SystemOneServicePreset } from '../../providers/presets'
import type { JudgeOutcome } from '../schema'

/** Published per-million token rates. Output is a captured 0, not an omitted field. */
export interface SystemOneRates {
  readonly inputUsdPerMillion: number
  readonly outputUsdPerMillion: number
}

/** Nano-USD in one USD: the liability precision (USD_LIABILITY_DECIMALS). */
const NANO_USD_PER_USD = USD_DECIMAL_RADIX ** USD_LIABILITY_DECIMALS

/**
Exact nano-USD for a captured token count at the capability's rates
(RVM98P2R2 8): the published decimal rates enter once, the arithmetic is
exact, and a liability rounds up to the nano-USD. Throws rather than
returning a made-up finite cost.
*/
export function systemOneNanoUsd(
  inputTokens: number,
  outputTokens: number,
  rates: SystemOneRates,
): bigint {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0) {
    throw new TypeError('systemone-tokens')
  }
  if (!Number.isSafeInteger(outputTokens) || outputTokens < 0) {
    throw new TypeError('systemone-tokens')
  }
  if (!Number.isFinite(rates.inputUsdPerMillion) || rates.inputUsdPerMillion < 0) {
    throw new TypeError('systemone-rate')
  }
  if (!Number.isFinite(rates.outputUsdPerMillion) || rates.outputUsdPerMillion < 0) {
    throw new TypeError('systemone-rate')
  }
  return Usd.from(rates.inputUsdPerMillion)
    .times(inputTokens)
    .add(Usd.from(rates.outputUsdPerMillion).times(outputTokens))
    .divide(TOKENS_PER_MILLION)
    .ceiling(USD_LIABILITY_DECIMALS)
    .units(USD_LIABILITY_DECIMALS)
}

/**
USD for a captured token count, as the number-based money ports take it:
the closest number to the exact nano-USD amount, so it prints and parses
back to that exact decimal.
*/
export function systemOneUsd(
  inputTokens: number,
  outputTokens: number,
  rates: SystemOneRates,
): number {
  return Number(systemOneNanoUsd(inputTokens, outputTokens, rates)) / NANO_USD_PER_USD
}

/** The frozen route's product labels. A call cannot rewrite them. */
export function systemOneRouteLabels(preset: SystemOneServicePreset): {
  readonly tested: false
  readonly optIn: true
  readonly autoSelectable: false
} {
  return {
    tested: preset.tested,
    optIn: preset.optIn,
    autoSelectable: preset.autoSelectable,
  }
}

export interface DeterministicGate<Check> {
  readonly passed: boolean
  readonly checks: readonly Check[]
}

export interface SystemOneGate<Check> {
  readonly passed: boolean
  readonly checks: readonly Check[]
  readonly cautionOnly: true
  readonly advisory: boolean
}

/**
Copy the deterministic gate and record only whether a separate answer
arrived. The copy never clears a failing check or fails a passing one.
*/
export function applySystemOneGate<Check>(
  deterministicGate: DeterministicGate<Check>,
  outcome: JudgeOutcome,
): SystemOneGate<Check> {
  return {
    passed: deterministicGate.passed,
    checks: [...deterministicGate.checks],
    cautionOnly: true,
    advisory: outcome.outcome === 'answered',
  }
}
