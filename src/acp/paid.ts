// The paid Model API features in the agent (M63c, PLAN.md D30, D62): "opt in
// and loud", as in the panel. A feature is off unless the editor started the
// agent with its flag, and then until the user accepts its price in the
// editor, asked at the first prompt that follows. The answer holds until
// the agent stops; a refusal, a cancelled question or a client that cannot
// ask all leave it off, and it is not asked again.

import type { CoreLogger } from '../core/logging'
import type { AcpPaidFeature, PaidFeature } from '../shared/constants'

/** Asks the user, naming the price; true only when they turned the feature on. */
export type PriceQuestion = (feature: AcpPaidFeature) => Promise<boolean>

export class AcpPaidFeatures {
  private readonly accepted = new Set<PaidFeature>()
  private readonly declined = new Set<PaidFeature>()
  /** A question on screen now: another prompt waits for its answer, never asks twice. */
  private readonly asking = new Map<AcpPaidFeature, Promise<void>>()
  private readonly used = new Map<PaidFeature, number>()

  public constructor(
    private readonly requested: readonly AcpPaidFeature[],
    private readonly log: CoreLogger,
  ) {}

  private async ask(feature: AcpPaidFeature, isPriceAccepted: PriceQuestion): Promise<void> {
    try {
      await this.answer(feature, isPriceAccepted)
    } finally {
      this.asking.delete(feature)
    }
  }

  private async answer(feature: AcpPaidFeature, isPriceAccepted: PriceQuestion): Promise<void> {
    let isAccepted = false
    try {
      isAccepted = await isPriceAccepted(feature)
    } catch (error: unknown) {
      this.log.warn(
        `Paid feature ${feature}: the price could not be asked, so it stays off: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (isAccepted) {
      this.accepted.add(feature)
      this.log.info(`Paid feature ${feature} turned on; the user accepted its price`)
    } else {
      this.declined.add(feature)
      this.log.info(`Paid feature ${feature} left off; its price was not accepted`)
    }
  }

  /** Whether the backend may use the feature: its flag given and its price accepted. */
  public isOn(feature: PaidFeature): boolean {
    return this.accepted.has(feature)
  }

  /** Asks, one at a time, for every flagged feature not answered yet. */
  public async settle(isPriceAccepted: PriceQuestion): Promise<void> {
    for (const feature of this.requested) {
      if (this.accepted.has(feature) || this.declined.has(feature)) {
        continue
      }
      let asked = this.asking.get(feature)
      if (asked === undefined) {
        asked = this.ask(feature, isPriceAccepted)
        this.asking.set(feature, asked)
      }
      await asked
    }
  }

  /** A billed use, tallied for the log: the agent has no usage dialog. */
  public noteUse(feature: PaidFeature, units: number): void {
    const total = (this.used.get(feature) ?? 0) + units
    this.used.set(feature, total)
    this.log.info(
      `Paid use of ${feature}: ${String(units)}, ${String(total)} since the agent started`,
    )
  }
}
