import { describe, expect, it, vi } from 'vitest'
import type * as z from 'zod/mini'
import {
  ScheduleBackgroundCoordinator,
  type BackgroundConsentStore,
} from '../../src/runtime/schedules/background'
import type { scheduleBackgroundConsentSchema } from '../../src/shared/scheduleV2'
import { FakeScheduleBackground } from './helpers/schedules/background'

type Consent = z.infer<typeof scheduleBackgroundConsentSchema>
function consentStore() {
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
function setup() {
  const entry = new FakeScheduleBackground(),
    consent = consentStore()
  const nextWakeAtMs = vi.fn<() => Promise<number | undefined>>().mockResolvedValue(2000)
  const coordinator = new ScheduleBackgroundCoordinator({
    entry,
    consent: consent.store,
    now: () => 1000,
    nextWakeAtMs,
  })
  return { entry, consent, coordinator, nextWakeAtMs }
}
describe('schedule background consent', () => {
  it.each(['notNow', 'never'] as const)(
    'remembers %s across hosts without registering or asking again',
    async (choice) => {
      const { coordinator, entry, consent, nextWakeAtMs } = setup()
      const ask = vi.fn().mockResolvedValue({ choice, decidedAtMs: 1000 })
      await coordinator.firstSchedule(ask)
      const other = new ScheduleBackgroundCoordinator({
        entry,
        consent: consent.store,
        now: () => 1000,
        nextWakeAtMs,
      })
      await other.firstSchedule(ask)
      await other.reconcile()
      expect(ask).toHaveBeenCalledOnce()
      expect(entry.registrations).toEqual([])
      expect(await other.status()).toEqual({ registered: false })
    },
  )
  it('asks once under concurrent hosts, and only Yes registers the next fire', async () => {
    const { coordinator, entry, consent } = setup()
    const answer = Promise.withResolvers<unknown>(),
      ask = vi.fn(() => answer.promise)
    const first = coordinator.firstSchedule(ask),
      second = coordinator.firstSchedule(ask)
    await Promise.resolve()
    expect(entry.registrations).toEqual([])
    answer.resolve({ choice: 'yes', decidedAtMs: 1000 })
    await Promise.all([first, second])
    expect(ask).toHaveBeenCalledOnce()
    expect(consent.current()).toEqual({ choice: 'yes', decidedAtMs: 1000 })
    expect(entry.registrations).toEqual([2000])
    expect(await coordinator.status()).toEqual({ registered: true, nextWakeAtMs: 2000 })
  })
  it('refuses invalid consent and never upgrades Not now or Never to Yes', async () => {
    const { coordinator, entry } = setup()
    const register = vi.spyOn(entry, 'register')
    await expect(
      coordinator.firstSchedule(() => Promise.resolve({ choice: 'yes', decidedAtMs: -1 })),
    ).rejects.toThrow()
    for (const choice of ['notNow', 'never'])
      await expect(coordinator.register(2000, { choice, decidedAtMs: 1000 })).rejects.toThrow()
    expect(entry.registrations).toEqual([])
    expect(register).not.toHaveBeenCalled()
  })
  it('rearms once, removes when there is no next fire, and off survives later reconciliation', async () => {
    const { coordinator, entry, nextWakeAtMs, consent } = setup()
    await coordinator.decide({ choice: 'yes', decidedAtMs: 1000 })
    nextWakeAtMs.mockResolvedValue(3000)
    await coordinator.reconcile()
    expect(entry.registrations).toEqual([2000, 3000])
    nextWakeAtMs.mockResolvedValue(undefined)
    await coordinator.reconcile()
    expect(await coordinator.status()).toEqual({ registered: false })
    await coordinator.remove()
    nextWakeAtMs.mockResolvedValue(4000)
    await coordinator.reconcile()
    expect(consent.current()?.choice).toBe('never')
    expect(entry.registrations).toEqual([2000, 3000])
  })
  it('reports native removal failures after publishing the restriction', async () => {
    const { coordinator, consent, entry } = setup()
    vi.spyOn(entry, 'remove').mockRejectedValue(new Error('OS denied removal'))
    await expect(coordinator.remove()).rejects.toThrow('OS denied removal')
    expect(consent.current()?.choice).toBe('never')
    await expect(coordinator.decide({ choice: 'notNow', decidedAtMs: 1000 })).rejects.toThrow()
    expect(consent.current()?.choice).toBe('notNow')
  })
  it('validates decisions and status at the OS and UI boundaries', async () => {
    const { coordinator, entry } = setup()
    await expect(
      coordinator.decide({ choice: 'yes', decidedAtMs: 1000, extra: true }),
    ).rejects.toThrow()
    vi.spyOn(entry, 'status').mockResolvedValue({ registered: false, nextWakeAtMs: 2000 })
    await expect(coordinator.status()).rejects.toThrow()
    expect(entry.registrations).toEqual([])
  })
})
