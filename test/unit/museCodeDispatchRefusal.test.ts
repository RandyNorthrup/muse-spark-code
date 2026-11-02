// M88 lane C (PLAN.md D67, item 15): a host's admission refusal
// settles the fire as refused with the host's own sentence, never
// failed with a generic reason. Admission runs before any live session
// is borrowed or any host opens, on every lease path.
import { describe, expect, it } from 'vitest'
import { ScheduleDelivery } from '../../src/core/schedules/delivery'
import { scheduleDispatchRefusal } from '../../src/core/schedules/dispatchRefusal'
import { ScheduleBackgroundTargets } from '../../src/host/schedules/backgroundTarget'
import { noScheduleCost } from '../../src/shared/scheduleV2'
import { UI_TEXT } from '../../src/shared/constants'
import { runContextFixture, scheduleFixture } from './helpers/scheduleFixtures'

function neverReached(name: string): () => never {
  return () => {
    throw new Error(`must stay unreached: ${name}`)
  }
}

function refusedDelivery(error: Error) {
  return new ScheduleDelivery({
    now: () => 1,
    monotonicNow: () => 1,
    holds: () => true,
    targets: {
      find: () => Promise.reject(error),
      open: () => Promise.reject(error),
      fresh: () => Promise.reject(error),
    },
    runs: {
      run: neverReached('runs.run'),
    },
    prompt: neverReached('prompt'),
  })
}

function refusingTargets() {
  const refusal = scheduleDispatchRefusal(UI_TEXT.museCodeOnceAccountChanged)
  return new ScheduleBackgroundTargets({
    admit: () => Promise.reject(refusal),
    findLive: neverReached('findLive'),
    host: neverReached('host'),
    options: neverReached('options'),
    contexts: {
      submit: neverReached('submit'),
    },
    publish: neverReached('publish'),
  })
}

describe('dispatch refusal settlement', () => {
  it('settles a branded refusal as refused with the sentence', async () => {
    const job = scheduleFixture({ delivery: 'whenIdle' })
    const refusal = scheduleDispatchRefusal(UI_TEXT.museCodeOnceAccountChanged)
    const result = await refusedDelivery(refusal).deliver(
      job,
      runContextFixture(job),
      1_700_000_060_000,
    )
    expect(result.outcome).toBe('refused')
    expect(result.reason).toBe(UI_TEXT.museCodeOnceAccountChanged)
    expect(result.scheduleId).toBe(job.id)
  })

  it('keeps any other target failure a generic failure', async () => {
    const job = scheduleFixture({ delivery: 'whenIdle' })
    const result = await refusedDelivery(new Error('target exploded')).deliver(
      job,
      runContextFixture(job),
      1_700_000_060_000,
    )
    expect(result.outcome).toBe('failed')
    expect(result.reason).toBe(UI_TEXT.scheduleCommandFailed)
  })

  it('costs a refused fire nothing either way', async () => {
    const job = scheduleFixture({ delivery: 'whenIdle' })
    const refusal = scheduleDispatchRefusal(UI_TEXT.museCodeOnceEnvKeyRefused)
    const result = await refusedDelivery(refusal).deliver(
      job,
      runContextFixture(job),
      1_700_000_060_000,
    )
    expect(result.cost).toEqual(noScheduleCost())
  })
})

describe('target admission order', () => {
  it('refuses before borrowing a live session', async () => {
    const job = scheduleFixture()
    await expect(refusingTargets().find(job)).rejects.toThrow(UI_TEXT.museCodeOnceAccountChanged)
  })

  it('refuses before opening or starting anything', async () => {
    const job = scheduleFixture()
    await expect(refusingTargets().open(job)).rejects.toThrow(UI_TEXT.museCodeOnceAccountChanged)
    await expect(refusingTargets().fresh(job, 1_700_000_060_000)).rejects.toThrow(
      UI_TEXT.museCodeOnceAccountChanged,
    )
  })
})
