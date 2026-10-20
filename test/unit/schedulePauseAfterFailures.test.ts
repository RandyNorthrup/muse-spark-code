// D121: a schedule never pauses itself by default; only a count the
// person sets in `museSpark.schedulePauseAfterFailures` pauses one. The
// real store settles real failed fires on a real filesystem journal here:
// with nothing set four failures in a row leave the schedule firing, with
// a count of two the second failure pauses it and names why, and every
// failure is still recorded in the run history either way.
import { describe, expect, it } from 'vitest'
import { createScheduleStore } from '../../src/core/schedules/store'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import { scheduleFireRecordSchema, scheduleV2Schema } from '../../src/shared/scheduleV2'
import { SETTING_DEFAULTS } from '../../src/shared/constants'
import { readSettings, type SettingsSource } from '../../src/host/settings'
import type { Logger } from '../../src/host/logger'
import {
  FIXTURE_WORKSPACE_KEY,
  fireFixture,
  scheduleFixture,
} from './helpers/reporting/reportKindFixtures'
import { removeFolder, temporaryDir } from './helpers/temporaryFolders'

function silentLog(): Logger {
  return {
    trace: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }
}

function settingSource(values: Record<string, unknown>): SettingsSource {
  return {
    get: (key: string) => values[key],
  }
}

async function withStore<T>(
  pauseAfterFailures: number | (() => number) | undefined,
  work: (store: ReturnType<typeof createScheduleStore>, root: string) => Promise<T>,
): Promise<T> {
  const root = await temporaryDir('schedules-pause-')
  try {
    const store = createScheduleStore(
      createNodeScheduleFs(root),
      pauseAfterFailures === undefined ? undefined : { pauseAfterFailures },
    )
    return await work(store, root)
  } finally {
    await removeFolder(root)
  }
}

async function failingSchedule(
  store: ReturnType<typeof createScheduleStore>,
  failures: number,
): Promise<void> {
  const job = scheduleV2Schema.parse(scheduleFixture(FIXTURE_WORKSPACE_KEY))
  await store.create(job)
  for (let index = 0; index < failures; index += 1)
    await store.record(
      scheduleFireRecordSchema.parse(
        fireFixture({
          runId: `sched-1:fail-${String(index)}`,
          outcome: 'failed',
          reason: 'Delivery failed: Error',
          occurrenceMs: 1500 + index,
          observedAtMs: 1600 + index,
        }),
      ),
    )
}

async function listed(store: ReturnType<typeof createScheduleStore>) {
  const jobs = await store.list(FIXTURE_WORKSPACE_KEY)
  if (jobs[0] === undefined) throw new Error('expected the schedule to list')
  return jobs[0]
}

describe('schedule pause after failures', () => {
  it('defaults to never pausing: the setting reads 0', () => {
    expect(SETTING_DEFAULTS.schedulePauseAfterFailures).toBe(0)
    expect(readSettings(settingSource({}), silentLog()).schedulePauseAfterFailures).toBe(0)
  })

  it('still applies a person-set count and refuses what it cannot hold', () => {
    const warnings: string[] = []
    const log: Logger = {
      trace: () => undefined,
      info: () => undefined,
      warn: (message: string) => {
        warnings.push(message)
      },
      error: () => undefined,
    }
    expect(readSettings(settingSource({ schedulePauseAfterFailures: 2 }), log)).toMatchObject({
      schedulePauseAfterFailures: 2,
    })
    expect(warnings).toEqual([])
    expect(
      readSettings(settingSource({ schedulePauseAfterFailures: -1 }), log)
        .schedulePauseAfterFailures,
    ).toBe(0)
    expect(warnings).toHaveLength(1)
  })

  it('keeps firing through four failures in a row with nothing set', async () => {
    await withStore(undefined, async (store) => {
      await failingSchedule(store, 4)
      const job = await listed(store)
      expect(job.paused).toBe(false)
      expect(job.pauseReason).toBeUndefined()
      expect(job.consecutiveFailures).toBe(0)
      const history = await store.fires(FIXTURE_WORKSPACE_KEY)
      expect(history).toHaveLength(4)
      expect(history.every((fire) => fire.outcome === 'failed')).toBe(true)
    })
  })

  it('pauses at a person-set count of two and names why', async () => {
    await withStore(2, async (store) => {
      await failingSchedule(store, 2)
      const job = await listed(store)
      expect(job.paused).toBe(true)
      expect(job.pauseReason).toBe('consecutiveFailures')
      expect(job.consecutiveFailures).toBe(2)
      const history = await store.fires(FIXTURE_WORKSPACE_KEY)
      expect(history).toHaveLength(2)
    })
  })

  it('reads a changed count live: failures before it do not pause, failures under it do', async () => {
    let count = 0
    await withStore(
      () => count,
      async (store) => {
        await failingSchedule(store, 3)
        const before = await listed(store)
        expect(before.paused).toBe(false)
        count = 2
        await store.record(
          scheduleFireRecordSchema.parse(
            fireFixture({
              runId: 'sched-1:fail-live-1',
              outcome: 'failed',
              reason: 'Delivery failed: Error',
              occurrenceMs: 1600,
              observedAtMs: 1700,
            }),
          ),
        )
        const middle = await listed(store)
        expect(middle.paused).toBe(false)
        await store.record(
          scheduleFireRecordSchema.parse(
            fireFixture({
              runId: 'sched-1:fail-live-2',
              outcome: 'failed',
              reason: 'Delivery failed: Error',
              occurrenceMs: 1700,
              observedAtMs: 1800,
            }),
          ),
        )
        const job = await listed(store)
        expect(job.paused).toBe(true)
        expect(job.pauseReason).toBe('consecutiveFailures')
      },
    )
  })
})
