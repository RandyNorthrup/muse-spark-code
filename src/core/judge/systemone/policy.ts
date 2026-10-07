// Price, labels and the deterministic-gate seam for a remote SystemOne call.
// Confidence math lives in ../math.ts. This file does not select a route.
import { TOKENS_PER_MILLION } from '../../../shared/constants'
import type { SystemOneServicePreset } from '../../providers/presets'
import type { JudgeOutcome } from '../schema'

/** Published per-million token rates. Output is a captured 0, not an omitted field. */
export interface SystemOneRates {
  readonly inputUsdPerMillion: number
  readonly outputUsdPerMillion: number
}

/**
 * USD for a captured token count at the capability's rates.
 * Throws rather than returning a made-up finite cost.
 */
export function systemOneUsd(
  inputTokens: number,
  outputTokens: number,
  rates: SystemOneRates,
): number {
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
  const inputCharge = (inputTokens * rates.inputUsdPerMillion) / TOKENS_PER_MILLION
  const outputCharge = (outputTokens * rates.outputUsdPerMillion) / TOKENS_PER_MILLION
  const total = inputCharge + outputCharge
  if (!Number.isFinite(total)) throw new TypeError('systemone-rate')
  return total
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
 * Copy the deterministic gate and record only whether a separate answer
 * arrived. The copy never clears a failing check or fails a passing one.
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
