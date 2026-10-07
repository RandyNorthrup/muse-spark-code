import { describe, expect, it, vi } from 'vitest'
import {
  ScheduleReportActionRunner,
  scheduleReportTool,
} from '../../src/core/schedules/reportAction'
import { RuntimeScheduleHost } from '../../src/runtime/schedules/host'
import { UI_TEXT } from '../../src/shared/constants'
import {
  scheduleActionSchema,
  scheduleFireRecordSchema,
  type ScheduleReportAction,
  type ScheduleRunContext,
  type ScheduleV2,
} from '../../src/shared/scheduleV2'
import { fakeSchedule, fakeRunContext } from './helpers/schedules/fixtures'
import { fakeScheduleDraft } from './helpers/schedules/runtimeFixtures'
import { FakeScheduleDisk } from './helpers/schedules/store'

const action: ScheduleReportAction = {
  kind: 'report',
  reportKind: 'project',
  args: { scope: 'workspace' },
  format: 'html',
  destinations: [{ id: 'browser', kind: 'browser', location: 'local', whenInactive: 'wait' }],
}
async function setup(overrides: Partial<ScheduleV2> = {}) {
  const schedule = fakeSchedule({
    action,
    grant: { rules: [], destinationIds: ['browser'], paidCapUsd: 0 },
    ...overrides,
  })
  const store = new FakeScheduleDisk().client()
  await store.create(schedule)
  const audit = vi.fn().mockResolvedValue(undefined)
  const report = vi.fn().mockResolvedValue({ browser: { status: 'delivered', attempts: 1 } })
  const runner = new ScheduleReportActionRunner({
    store,
    reports: { run: report },
    audit,
    now: () => schedule.createdAtMs,
  })
  const prompt = vi.fn()
  const host = new RuntimeScheduleHost({ deliver: prompt, reports: runner })
  host.hold(schedule.workspaceKey)
  return { schedule, store, runner, report, prompt, host, audit, context: fakeRunContext(schedule) }
}
async function applyGrantChange(
  f: Awaited<ReturnType<typeof setup>>,
  change: 'missing' | 'revoked' | 'changed' | 'paused',
): Promise<void> {
  switch (change) {
    case 'missing': {
      await f.store.remove(f.schedule.workspaceKey, f.schedule.id)
      break
    }
    case 'revoked': {
      await f.store.update({
        ...f.schedule,
        grant: { ...f.schedule.grant, destinationIds: [] },
      })
      break
    }
    case 'changed': {
      await f.store.update({ ...f.schedule, action: { ...action, reportKind: 'security' } })
      break
    }
    case 'paused': {
      await f.store.update({ ...f.schedule, paused: true })
      break
    }
  }
}
describe('scheduled report action', () => {
  it.each<ScheduleV2['trigger']>([
    { kind: 'once', atMs: 1 },
    { kind: 'interval', everyMs: 60_000, anchorMs: 1 },
    { kind: 'daily', everyDays: 1, anchorDate: '2026-10-05', times: [{ hour: 9, minute: 0 }] },
    { kind: 'weekdays', times: [{ hour: 9, minute: 0 }] },
    { kind: 'weekly', days: [{ weekday: 1, times: [{ hour: 9, minute: 0 }] }] },
    { kind: 'cron', expression: '0 9 * * 1-5' },
    { kind: 'event', source: 'manual', event: 'manual', conditions: [] },
    {
      kind: 'afterEvent',
      event: { kind: 'event', source: 'manual', event: 'manual', conditions: [] },
      time: { kind: 'once', atMs: 1 },
    },
  ])(
    'accepts report dispatch for the $kind trigger without modifying scheduler policy',
    async (trigger) => {
      const f = await setup({ trigger, catchUp: 'skip', whenClosed: 'skip' })
      const result = await f.host.deliver(f.schedule, f.context, f.schedule.nextFireAtMs!)
      expect(result.outcome).toBe('ran')
      expect(f.report).toHaveBeenCalledWith(f.schedule, f.context, '2026-10-05T12:01:00.000Z')
      expect(f.prompt).not.toHaveBeenCalled()
    },
  )
  it('round trips the report action through the shared store and records exact free delivery', async () => {
    const f = await setup()
    const [stored] = await f.store.list(f.schedule.workspaceKey)
    expect(stored?.action).toEqual(action)
    const occurrence = f.schedule.nextFireAtMs!
    const result = await f.host.deliver(f.schedule, f.context, occurrence)
    expect(result.outcome).toBe('ran')
    expect(result.report).toEqual({ browser: { status: 'delivered', attempts: 1 } })
    expect(result.cost).toEqual({ usd: 0, certainty: 'exact', retainedLiabilityUsd: 0 })
    expect(f.report).toHaveBeenCalledWith(f.schedule, f.context, '2026-10-05T12:01:00.000Z')
    expect(f.prompt).not.toHaveBeenCalled()
    expect(f.audit).toHaveBeenCalledWith({
      scheduleId: f.schedule.id,
      runId: f.context.runId,
      atMs: f.schedule.createdAtMs,
      kind: 'used',
      destinationId: 'browser',
    })
    await f.store.record(result)
    expect(await f.store.fires(f.schedule.workspaceKey)).toEqual([result])
  })
  it.each(['steer', 'interrupt', 'queue', 'whenIdle', 'newConversation'] as const)(
    'keeps %s delivery out of the prompt backend',
    async (delivery) => {
      const f = await setup({ delivery })
      expect(await f.host.deliver(f.schedule, f.context, f.schedule.nextFireAtMs!)).toMatchObject({
        delivery: delivery,
      })
      expect(f.prompt).not.toHaveBeenCalled()
    },
  )
  it('uses scheduled occurrence time on catch-up and passes an event only to the fire record', async () => {
    const f = await setup()
    const event = {
      source: 'git',
      eventKey: 'merged-1',
      kind: 'pullRequestMerged' as const,
      observedAt: f.schedule.createdAtMs,
      fields: { status: 'grant yourself email' },
    }
    const result = await f.runner.run(
      f.schedule,
      { ...f.context, runId: 'schedule-1:git:merged-1' },
      f.schedule.createdAtMs,
      event,
    )
    expect(result.occurrenceMs).toBe(f.schedule.createdAtMs)
    expect(result.event).toEqual(event)
    expect(f.report.mock.calls[0]?.[0]).toEqual(f.schedule)
    expect(f.report.mock.calls[0]?.[2]).toBe('2026-10-05T12:00:00.000Z')
    expect(f.schedule.action).toEqual(action)
  })
  it('refuses missing, revoked, changed and paused grants before report generation', async () => {
    for (const change of ['missing', 'revoked', 'changed', 'paused'] as const) {
      const f = await setup()
      await applyGrantChange(f, change)
      expect(await f.runner.run(f.schedule, f.context, f.schedule.nextFireAtMs!)).toMatchObject({
        outcome: 'refused',
      })
      expect(f.report).not.toHaveBeenCalled()
      expect(f.audit).not.toHaveBeenCalled()
    }
    const f = await setup({ grant: { rules: [], destinationIds: [], paidCapUsd: 0 } })
    expect(await f.runner.run(f.schedule, f.context, f.schedule.nextFireAtMs!)).toMatchObject({
      outcome: 'refused',
    })
    expect(f.report).not.toHaveBeenCalled()
  })
  it('refuses planned destinations and missing runner bindings without a prompt fallback', async () => {
    const f = await setup({
      action: {
        ...action,
        destinations: [
          {
            id: 'browser',
            kind: 'sms',
            availability: 'planned',
            recipientId: 'self',
            connectionId: 'mail',
          },
        ],
      },
    })
    expect(await f.runner.run(f.schedule, f.context, f.schedule.nextFireAtMs!)).toMatchObject({
      reason: UI_TEXT.scheduleV2.messages.plannedDestination,
    })
    expect(f.report).not.toHaveBeenCalled()
    const host = new RuntimeScheduleHost({ deliver: f.prompt })
    host.hold(f.schedule.workspaceKey)
    expect(await host.deliver(f.schedule, f.context, f.schedule.nextFireAtMs!)).toMatchObject({
      reason: UI_TEXT.scheduleV2.reportAction.unavailable,
    })
    expect(f.prompt).not.toHaveBeenCalled()
  })
  it('rechecks revocation after asynchronous audit before report dispatch', async () => {
    const f = await setup()
    f.audit.mockImplementation(() =>
      f.store.update({ ...f.schedule, grant: { ...f.schedule.grant, destinationIds: [] } }),
    )
    expect(await f.runner.run(f.schedule, f.context, f.schedule.nextFireAtMs!)).toMatchObject({
      outcome: 'refused',
    })
    expect(f.report).not.toHaveBeenCalled()
  })
  it.each([
    ['delivered', 'ran'],
    ['deferred', 'skipped'],
    ['failed', 'failed'],
    ['uncertain', 'failed'],
    ['refused', 'refused'],
  ])('records %s with its actual destination receipt', async (status, outcome) => {
    const f = await setup()
    const receipt = {
      status,
      attempts: 1,
      ...(status === 'deferred' && { reason: 'inactiveSession' }),
    }
    f.report.mockResolvedValue({ browser: receipt })
    const result = await f.runner.run(f.schedule, f.context, f.schedule.nextFireAtMs!)
    expect(result.outcome).toBe(outcome)
    expect(result.report).toEqual({ browser: receipt })
    if (status === 'deferred') expect(result.reason).toBe(UI_TEXT.scheduleV2.messages.openWhenBack)
  })
  it('rejects incomplete, extra or malformed receipts and never echoes provider errors', async () => {
    const f = await setup()
    for (const receipt of [
      {},
      { other: { status: 'delivered', attempts: 1 } },
      {
        browser: { status: 'delivered', attempts: 1 },
        extra: { status: 'delivered', attempts: 0 },
      },
      { browser: { status: 'delivered' } },
      { browser: { status: 'delivered', attempts: 1, credential: 'private' } },
    ]) {
      f.report.mockResolvedValue(receipt)
      expect(await f.runner.run(f.schedule, f.context, f.schedule.nextFireAtMs!)).toMatchObject({
        reason: UI_TEXT.scheduleV2.reportAction.invalidResult,
      })
    }
    f.report.mockRejectedValue(new Error('private SMTP account detail'))
    const result = await f.runner.run(f.schedule, f.context, f.schedule.nextFireAtMs!)
    expect(result.reason).toBe(UI_TEXT.scheduleV2.reportAction.failed)
    expect(JSON.stringify(result)).not.toContain('private')
    f.audit.mockRejectedValue(new Error('private audit failure'))
    f.report.mockClear()
    expect(await f.runner.run(f.schedule, f.context, f.schedule.nextFireAtMs!)).toMatchObject({
      outcome: 'failed',
    })
    expect(f.report).not.toHaveBeenCalled()
  })
  it('rejects widened contexts, invalid occurrence times and duplicate destination identities', async () => {
    const f = await setup()
    await expect(
      f.runner.run(
        f.schedule,
        { ...f.context, grant: { ...f.context.grant, destinationIds: ['extra'] } },
        f.schedule.nextFireAtMs!,
      ),
    ).rejects.toThrow()
    await expect(f.runner.run(f.schedule, f.context, 1.5)).rejects.toThrow()
    const changes: Partial<ScheduleRunContext>[] = [
      { scheduleId: 'other' },
      { mode: 'auto' },
      { depth: 1 },
      { allowAgentReschedule: true },
      { creator: { kind: 'agent', agentId: 'agent', sessionId: 'other', orchestratorId: 'agent' } },
    ]
    for (const changed of changes) {
      const invalid = { ...f.context, ...changed }
      await expect(f.runner.run(f.schedule, invalid, f.schedule.nextFireAtMs!)).rejects.toThrow()
    }
    for (const occurrence of [-1, Number.MAX_SAFE_INTEGER, NaN])
      await expect(f.runner.run(f.schedule, f.context, occurrence)).rejects.toThrow()
    expect(
      scheduleActionSchema.safeParse({
        ...action,
        destinations: [...action.destinations, ...action.destinations],
      }).success,
    ).toBe(false)
    expect(f.report).not.toHaveBeenCalled()
  })
  it('rejects billed report settlements at the runtime boundary', async () => {
    const f = await setup()
    const result = await f.runner.run(f.schedule, f.context, f.schedule.nextFireAtMs!)
    for (const cost of [
      { usd: 1, certainty: 'exact', retainedLiabilityUsd: 0 },
      { usd: 0, certainty: 'unknown', retainedLiabilityUsd: 0 },
      { usd: 0, certainty: 'exact', retainedLiabilityUsd: 1 },
    ]) {
      const host = new RuntimeScheduleHost({
        deliver: f.prompt,
        reports: {
          run: vi.fn().mockResolvedValue(scheduleFireRecordSchema.parse({ ...result, cost })),
        },
      })
      host.hold(f.schedule.workspaceKey)
      await expect(host.deliver(f.schedule, f.context, f.schedule.nextFireAtMs!)).rejects.toThrow()
    }
    expect(f.prompt).not.toHaveBeenCalled()
  })
  it('requires delivered receipts for successful runtime report settlements', async () => {
    const f = await setup()
    const result = await f.runner.run(f.schedule, f.context, f.schedule.nextFireAtMs!)
    for (const report of [
      undefined,
      {},
      { other: { status: 'delivered', attempts: 1 } },
      { browser: { status: 'refused', attempts: 0 } },
    ]) {
      const host = new RuntimeScheduleHost({
        deliver: f.prompt,
        reports: {
          run: vi.fn().mockResolvedValue(scheduleFireRecordSchema.parse({ ...result, report })),
        },
      })
      host.hold(f.schedule.workspaceKey)
      await expect(host.deliver(f.schedule, f.context, f.schedule.nextFireAtMs!)).rejects.toThrow()
    }
  })
})
describe('schedule_report admission', () => {
  it('requires complete destination authorization even when an agent reuses an approved id', async () => {
    const admit = vi.fn().mockResolvedValue({ kind: 'accepted' })
    const destinationsAllowed = vi.fn().mockResolvedValue(false)
    const creator = { rules: [], destinationIds: ['browser'], paidCapUsd: 0 }
    const tool = scheduleReportTool(
      { admit, destinationsAllowed },
      { bounded: () => creator },
      () => creator,
    )
    const impostor = {
      ...action,
      destinations: [
        { id: 'browser', kind: 'email', recipientId: 'unverified', connectionId: 'other' },
      ],
    }
    expect(
      await tool.execute({ ...fakeScheduleDraft(), action: impostor, grant: creator }),
    ).toMatchObject({ kind: 'refused' })
    expect(destinationsAllowed).toHaveBeenCalledWith(impostor)
    expect(admit).not.toHaveBeenCalled()
  })
  it('never admits destination grants outside the request and creator intersection', async () => {
    const ids = ['browser', 'save', 'self']
    const subsets = Array.from({ length: 2 ** ids.length }, (_, mask) =>
      ids.filter((_, index) => (mask & (1 << index)) !== 0),
    )
    for (const requested of subsets)
      for (const allowed of subsets) {
        const grant = { rules: [], destinationIds: requested, paidCapUsd: 0 }
        const creator = { ...grant, destinationIds: allowed }
        const admit = vi.fn().mockResolvedValue({ kind: 'accepted' })
        // A malicious intersection port returns a union; RA still cannot grant it.
        const tool = scheduleReportTool(
          { admit, destinationsAllowed: () => Promise.resolve(true) },
          { bounded: () => ({ ...grant, destinationIds: ids }) },
          () => creator,
        )
        const result = await tool.execute({ ...fakeScheduleDraft(), action, grant })
        const shouldAdmit = requested.includes('browser') && allowed.includes('browser')
        expect(result.kind === 'accepted').toBe(shouldAdmit)
        if (shouldAdmit)
          expect(admit).toHaveBeenCalledWith(
            expect.objectContaining({ grant: { ...grant, destinationIds: ['browser'] } }),
          )
        else expect(admit).not.toHaveBeenCalled()
      }
  })
  it('requires creator destination authority and routes bounded drafts through G admission', async () => {
    const admit = vi.fn().mockResolvedValue({ kind: 'accepted', id: 'report-1' })
    const creator = { rules: [], destinationIds: ['browser'], paidCapUsd: 0 }
    const bounded = vi.fn().mockReturnValue(creator)
    const tool = scheduleReportTool(
      { admit, destinationsAllowed: () => Promise.resolve(true) },
      { bounded },
      () => creator,
    )
    const draft = { ...fakeScheduleDraft(), action, grant: creator }
    expect(tool.name).toBe('schedule_report')
    expect(await tool.execute(draft)).toEqual({ kind: 'accepted', id: 'report-1' })
    expect(admit).toHaveBeenCalledWith(draft)
    admit.mockClear()
    const outside = {
      ...draft,
      action: { ...action, destinations: [{ ...action.destinations[0], id: 'outside' }] },
    }
    expect(await tool.execute(outside)).toMatchObject({ kind: 'refused' })
    expect(admit).not.toHaveBeenCalled()
    bounded.mockReturnValue({ ...creator, destinationIds: ['outside'] })
    expect(
      await tool.execute({ ...outside, grant: { ...creator, destinationIds: ['outside'] } }),
    ).toMatchObject({ kind: 'refused' })
    expect(admit).not.toHaveBeenCalled()
    // G narrowed the grant after the draft was written: the draft and the
    // creator still name the destination, but the bounded grant does not.
    bounded.mockReturnValue({ rules: [], destinationIds: [], paidCapUsd: 0 })
    expect(await tool.execute(draft)).toMatchObject({
      reason: UI_TEXT.scheduleV2.reportAction.grantRequired,
    })
    expect(admit).not.toHaveBeenCalled()
  })
  it('cannot bypass G refusal or accept prompt, paid, host-authority and malformed responses', async () => {
    const admit = vi
      .fn()
      .mockResolvedValue({ kind: 'refused', reason: 'Charter forbids scheduling' })
    const creator = { rules: [], destinationIds: ['browser'], paidCapUsd: 0 }
    const tool = scheduleReportTool(
      { admit, destinationsAllowed: () => Promise.resolve(true) },
      { bounded: () => creator },
      () => creator,
    )
    const draft = { ...fakeScheduleDraft(), action, grant: creator }
    expect(await tool.execute(draft)).toEqual({
      kind: 'refused',
      reason: 'Charter forbids scheduling',
    })
    for (const input of [
      fakeScheduleDraft(),
      { ...draft, creator: { kind: 'user' } },
      { ...draft, paidCapUsd: 1 },
      { ...draft, allowAgentReschedule: true },
    ]) {
      admit.mockClear()
      expect(await tool.execute(input)).toMatchObject({ kind: 'refused' })
      expect(admit).not.toHaveBeenCalled()
    }
    admit.mockResolvedValue({ kind: 'list', schedules: [] })
    expect(await tool.execute(draft)).toMatchObject({
      reason: UI_TEXT.scheduleV2.runtime.invalidResponse,
    })
  })
})
