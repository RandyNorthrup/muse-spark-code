// Types for test/hostApi/run.mjs, which the unit tests import (M104g).
// The contract's own shapes are the conformance schemas.
export const contract: {
  readonly protocol: string
  readonly backends: readonly string[]
  readonly scenarios: readonly { readonly id: string }[]
  readonly waiting: readonly unknown[]
}

export interface WaitingLeg {
  readonly backend: string
  readonly scenario: string
  readonly hosts?: readonly string[]
  readonly need: string
}
export function waitingLegs(loaded?: unknown): WaitingLeg[]
export function validateReport(
  host: string,
  report: unknown,
): {
  readonly protocol: string
  readonly host: string
  readonly results: readonly {
    readonly backend: string
    readonly scenario: string
    readonly observations: Record<string, unknown>
    readonly skipped: false
  }[]
}

export type ConformanceOutcome =
  | { readonly host: string; readonly outcome: 'pending'; readonly need: string }
  | { readonly host: string; readonly outcome: 'failed'; readonly error: string }
  | { readonly host: string; readonly outcome: 'skipped-host-absent'; readonly reason: string }
  | {
      readonly host: string
      readonly outcome: 'waiting' | 'conformant'
      readonly protocol: string
      readonly scenarios: number
      readonly backends: readonly string[]
      readonly waiting: readonly WaitingLeg[]
      readonly report: unknown
    }
export function runConformance(
  root: string,
  hosts?: readonly string[],
  run?: (command: string, args: readonly string[], options: unknown) => string,
): ConformanceOutcome[]
