import { expect, it, vi } from 'vitest'
import { createScheduler } from '../../src/core/schedules/scheduler'
import { createScheduleStore } from '../../src/core/schedules/store'
import { UI_TEXT } from '../../src/shared/constants'
import { noScheduleCost } from '../../src/shared/scheduleV2'
import { fakeSchedule } from './helpers/schedules/fixtures'
import { MemoryScheduleFs } from './helpers/schedules/storage'

it.each([
  'schedulePaused',
  'scheduleDeleted',
  'scheduleEdited',
  'scheduleEnded',
  'admissionLost',
  'workspaceNotHeld',
] as const)('records the translated %s cause for a core-decided skip', async (reason) => {
  const store = createScheduleStore(new MemoryScheduleFs())
  const job = fakeSchedule()
  await store.create(job)
  const now = job.nextFireAtMs!
  const intent = {
    schedule: job,
    runId: `${job.id}:${String(now)}`,
    occurrenceMs: now,
    advancesTime: true,
  }
  await store.admit(intent)
  const deliver = vi.fn(() => Promise.reject(new Error('skipped fire must not dispatch')))
  const state = { isHeld: true }
  const scheduler = createScheduler({
    store,
    runs: {
      ...store,
      advance: reason === 'admissionLost' ? () => Promise.resolve(false) : store.advance,
    },
    queue: {
      serialize: async (_key, work) => {
        switch (reason) {
          case 'schedulePaused': {
            await store.update({ ...job, paused: true })
            break
          }
          case 'scheduleDeleted': {
            await store.remove(job.workspaceKey, job.id)
            break
          }
          case 'scheduleEdited': {
            await store.update({ ...job, delivery: 'interrupt' })
            break
          }
          case 'scheduleEnded': {
            await store.update({ ...job, end: { atMs: now } })
            break
          }
          case 'workspaceNotHeld': {
            state.isHeld = false
            break
          }
        }
        await work()
      },
    },
    host: {
      now: () => now,
      monotonicNow: () => now,
      holds: () => state.isHeld,
      deliver,
      lookupRun: (id) => store.lookupRun(job.workspaceKey, id),
    },
    time: { plan: () => ({ missed: false }) },
    deferEvent: () => Promise.resolve(),
    failureSettlement: () => Promise.reject(new Error('no delivery to settle')),
  })
  await scheduler.recover(job.workspaceKey)
  expect(await store.fires(job.workspaceKey)).toEqual([
    expect.objectContaining({
      outcome: 'skipped',
      reason: UI_TEXT.scheduleV2.messages[reason],
      cost: noScheduleCost(),
    }),
  ])
  expect(deliver).not.toHaveBeenCalled()
  await scheduler.close()
})
