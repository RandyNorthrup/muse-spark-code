import type { UsdAmount } from '../../shared/usd'

/** The captured usage-report schemas use numbers; this projection never admits spending. */
export function reportingAmount(amount: UsdAmount): number {
  const value = Number(amount)
  if (!Number.isFinite(value)) throw new Error('Nonfinite USD reporting projection')
  return value
}
