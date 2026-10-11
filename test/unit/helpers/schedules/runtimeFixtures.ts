import { vi } from 'vitest'
import type { ScheduleControlPort } from '../../../../src/runtime/schedules/command'
import type { BackgroundConsentStore } from '../../../../src/runtime/schedules/background'
import {
  scheduleDraftSchema,
  type scheduleResponseSchema,
  type scheduleBackgroundConsentSchema,
} from '../../../../src/shared/scheduleV2'
import { fakeSchedule } from './fixtures'

type ScheduleResponse = ReturnType<typeof scheduleResponseSchema.parse>

export function fakeRuntimeScheduleControl(response?: ScheduleResponse) {
  return {
    request: vi
      .fn<ScheduleControlPort['request']>()
      .mockResolvedValue(response ?? { kind: 'list', schedules: [] }),
    runDue: vi.fn<ScheduleControlPort['runDue']>().mockResolvedValue(),
    close: vi.fn<ScheduleControlPort['close']>().mockResolvedValue(),
  }
}

/** Single-owner tests use this only when persistence is outside the assertion. */
export function transientBackgroundConsent(): BackgroundConsentStore {
  return { exclusive: (work) => work(undefined, () => Promise.resolve()) }
}

export function serializedBackgroundConsent() {
  type Consent = ReturnType<typeof scheduleBackgroundConsentSchema.parse>
  let consent: Consent | undefined
  let tail = Promise.resolve(undefined)
  const store: BackgroundConsentStore = {
    async exclusive(work) {
      const previous = tail,
        next = Promise.withResolvers<undefined>()
      tail = next.promise
      await previous
      try {
        return await work(consent, (value) => {
          consent = structuredClone(value)
          return Promise.resolve()
        })
      } finally {
        next.resolve(undefined)
      }
    },
  }
  return { store, current: () => consent }
}

export function fakeScheduleDraft() {
  const s = fakeSchedule()
  return scheduleDraftSchema.parse({
    name: s.name,
    action: s.action,
    trigger: s.trigger,
    target: s.target,
    delivery: s.delivery,
    whenClosed: s.whenClosed,
    catchUp: s.catchUp,
    mode: s.mode,
    grant: s.grant,
    paidCapUsd: s.paidCapUsd,
    parallel: s.parallel,
    zone: s.zone,
    end: s.end,
    pinned: s.pinned,
  })
}
