import type * as z from 'zod/mini'
import { UI_TEXT } from '../../shared/constants'
import {
  scheduleBackgroundConsentSchema,
  scheduleBackgroundStatusSchema,
  type ScheduleBackgroundPort,
} from '../../shared/scheduleV2'

type Consent = z.infer<typeof scheduleBackgroundConsentSchema>

/** S binds this to its cross-process lock and owner-only atomic state writes. */
export interface BackgroundConsentStore {
  exclusive<T>(
    work: (current: Consent | undefined, save: (consent: Consent) => Promise<void>) => Promise<T>,
  ): Promise<T>
}
export interface BackgroundCoordinatorDeps {
  readonly entry: ScheduleBackgroundPort
  readonly consent: BackgroundConsentStore
  readonly now: () => number
  readonly nextWakeAtMs: () => Promise<number | undefined>
}

/** The same owner supplies Settings, first-schedule UI and uninstall removal. */
export class ScheduleBackgroundCoordinator {
  constructor(private readonly deps: BackgroundCoordinatorDeps) {}
  private async reconcileWith(consent: Consent): Promise<void> {
    const next = await this.deps.nextWakeAtMs()
    if (next === undefined) await this.deps.entry.remove()
    else await this.deps.entry.register(next, consent)
  }
  /** The CLI published its wake marker first. A mutator already holding this
   * lock must finish before the wake starts an engine; later mutators see the
   * marker and wait for kernel exit. Never hold the consent lock across a turn. */
  async wakeBarrier(): Promise<void> {
    await this.deps.consent.exclusive(() => Promise.resolve())
  }
  async firstSchedule(ask: () => Promise<unknown>): Promise<void> {
    await this.deps.consent.exclusive(async (current, save) => {
      if (current !== undefined) return
      const answer = scheduleBackgroundConsentSchema.parse(await ask())
      await save(answer)
      if (answer.choice === 'yes') await this.reconcileWith(answer)
      else await this.deps.entry.remove()
    })
  }
  async decide(input: unknown): Promise<void> {
    const consent = scheduleBackgroundConsentSchema.parse(input)
    await this.deps.consent.exclusive(async (_current, save) => {
      // Publish the user's restriction before changing the OS entry.
      await save(consent)
      if (consent.choice === 'yes') await this.reconcileWith(consent)
      else await this.deps.entry.remove()
    })
  }
  async reconcile(): Promise<void> {
    await this.deps.consent.exclusive(async (consent) => {
      if (consent?.choice === 'yes') await this.reconcileWith(consent)
      else await this.deps.entry.remove()
    })
  }
  async status(): Promise<z.infer<typeof scheduleBackgroundStatusSchema>> {
    return scheduleBackgroundStatusSchema.parse(await this.deps.entry.status())
  }
  async remove(): Promise<void> {
    await this.deps.consent.exclusive(async (_current, save) => {
      await save(
        scheduleBackgroundConsentSchema.parse({ choice: 'never', decidedAtMs: this.deps.now() }),
      )
      await this.deps.entry.remove()
    })
  }
  async register(nextWakeAtMs: number, input: unknown): Promise<void> {
    const consent = scheduleBackgroundConsentSchema.parse(input)
    if (consent.choice !== 'yes') throw new Error(UI_TEXT.scheduleV2.runtime.consentRequired)
    await this.deps.consent.exclusive(async (_current, save) => {
      await save(consent)
      await this.deps.entry.register(nextWakeAtMs, consent)
    })
  }
}
