import type {
  ScheduleBackgroundPort,
  scheduleBackgroundConsentSchema,
} from '../../../../src/shared/scheduleV2'
import type * as z from 'zod/mini'

export class FakeScheduleBackground implements ScheduleBackgroundPort {
  private nextWakeAtMs: number | undefined
  readonly registrations: number[] = []
  status(): Promise<{ registered: boolean; nextWakeAtMs?: number }> {
    return Promise.resolve({
      registered: this.nextWakeAtMs !== undefined,
      ...(this.nextWakeAtMs !== undefined && { nextWakeAtMs: this.nextWakeAtMs }),
    })
  }
  register(
    nextWakeAtMs: number,
    consent: z.infer<typeof scheduleBackgroundConsentSchema>,
  ): Promise<void> {
    if (consent.choice !== 'yes') return Promise.reject(new Error('Explicit Yes is required'))
    this.registrations.push(nextWakeAtMs)
    this.nextWakeAtMs = nextWakeAtMs
    return Promise.resolve()
  }
  remove(): Promise<void> {
    this.nextWakeAtMs = undefined
    return Promise.resolve()
  }
}
