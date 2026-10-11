import type { UsdAmount } from '../../../src/shared/usdSchema'

export function malformedUsd(input: number): UsdAmount {
  // Deliberately violate the branded port to test runtime refusal (PLAN §8).
  return input as unknown as UsdAmount
}
