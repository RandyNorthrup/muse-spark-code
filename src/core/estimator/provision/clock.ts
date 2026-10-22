import { EstimateDiagnosticError } from '../diagnostic'

/** Injected epoch milliseconds, monotonic within this lifecycle/run owner. */
export class EstimateProvisionClock {
  private previous = 0
  constructor(
    private readonly read: () => number,
    private readonly failure: string,
  ) {}

  now(): number {
    const now = this.read()
    if (
      !Number.isSafeInteger(now) ||
      now < this.previous ||
      !Number.isFinite(new Date(now).getTime())
    )
      throw new EstimateDiagnosticError(this.failure)
    this.previous = now
    return now
  }
}
