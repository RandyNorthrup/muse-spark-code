import { describe, expect, it, vi } from 'vitest'
import { RuntimeScheduleHost } from '../../src/runtime/schedules/host'
import { fakeRunContext, fakeSchedule } from './helpers/schedules/fixtures'
import { scheduleFireRecordSchema, type ScheduleRunContext } from '../../src/shared/scheduleV2'

function setup() {
  const schedule = fakeSchedule()
  const context = fakeRunContext(schedule)
  const record = scheduleFireRecordSchema.parse({
    runId: context.runId,
    scheduleId: schedule.id,
    workspaceKey: schedule.workspaceKey,
    occurrenceMs: schedule.nextFireAtMs,
    observedAtMs: schedule.nextFireAtMs,
    target: schedule.target,
    delivery: schedule.delivery,
    outcome: 'refused',
    reason: 'Approval refused',
    refusedActions: [
      { actionClass: 'physical', tool: 'physical', reason: 'Always refused unattended' },
    ],
    cost: { usd: 0.1, certainty: 'unknown', retainedLiabilityUsd: 0.2 },
  })
  const deliver = vi.fn().mockResolvedValue(record)
  const host = new RuntimeScheduleHost({ deliver, now: () => 5000, monotonicNow: () => 23 })
  return { host, deliver, record, schedule, context }
}
describe('runtime scheduler host', () => {
  it('holds a workspace until its last session closes and releases idempotently', () => {
    const { host } = setup()
    const first = host.hold('one'),
      second = host.hold('one'),
      third = host.hold('two')
    first()
    first()
    expect(host.holds('one')).toBe(true)
    second()
    expect(host.holds('one')).toBe(false)
    expect(host.holds('two')).toBe(true)
    third()
    expect(host.holds('two')).toBe(false)
    expect(host.now()).toBe(5000)
    expect(host.monotonicNow()).toBe(23)
    const defaults = new RuntimeScheduleHost({ deliver: vi.fn() })
    expect(defaults.now()).toBeGreaterThan(0)
    expect(defaults.monotonicNow()).toBeGreaterThan(0)
  })
  it('waits for final settlement and preserves refusal, cost and retained liability', async () => {
    const { host, deliver, record, schedule, context } = setup()
    host.hold(schedule.workspaceKey)
    const pending = Promise.withResolvers<unknown>()
    deliver.mockReturnValue(pending.promise)
    let isFinished = false
    const delivery = (async () => {
      const result = await host.deliver(schedule, context, record.occurrenceMs)
      isFinished = true
      return result
    })()
    await Promise.resolve()
    expect(isFinished).toBe(false)
    pending.resolve(record)
    expect(await delivery).toEqual(record)
    expect(deliver).toHaveBeenCalledWith(schedule, context, record.occurrenceMs, undefined)
  })
  it('rejects delivery without ownership or with widened run authority', async () => {
    const { host, deliver, record, schedule, context } = setup()
    await expect(host.deliver(schedule, context, record.occurrenceMs)).rejects.toThrow()
    host.hold(schedule.workspaceKey)
    const changes: Partial<ScheduleRunContext>[] = [
      { scheduleId: 'other' },
      { mode: 'auto' },
      { depth: 1 },
      { allowAgentReschedule: true },
      { grant: { ...context.grant, rules: [{ id: 'shell', kind: 'tool', name: 'shell' }] } },
      { creator: { kind: 'agent', agentId: 'agent', sessionId: 'other', orchestratorId: 'agent' } },
    ]
    for (const changed of changes)
      await expect(
        host.deliver(schedule, { ...context, ...changed }, record.occurrenceMs),
      ).rejects.toThrow()
    await expect(host.deliver(schedule, context, -1)).rejects.toThrow()
    expect(deliver).not.toHaveBeenCalled()
  })
  it('rejects a mismatched or incomplete final settlement', async () => {
    const { host, deliver, record, schedule, context } = setup()
    host.hold(schedule.workspaceKey)
    for (const changed of [
      { runId: 'other' },
      { scheduleId: 'other' },
      { workspaceKey: 'other' },
      { occurrenceMs: record.occurrenceMs + 1 },
      { target: { ...schedule.target, sessionId: 'other' } },
      { delivery: 'steer' },
      { cost: undefined },
    ]) {
      deliver.mockResolvedValue({ ...record, ...changed })
      await expect(host.deliver(schedule, context, record.occurrenceMs)).rejects.toThrow()
    }
  })
})
