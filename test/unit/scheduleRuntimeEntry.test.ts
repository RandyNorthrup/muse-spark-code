import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { parseScheduleCommand } from '../../src/runtime/schedules/args'
import {
  createScheduleEngine,
  type ScheduleEngineOptions,
} from '../../src/runtime/schedules/engine'
import { SCHEDULE_PROTOCOL_VERSION } from '../../src/shared/constants'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { Usd } from '../../src/shared/usd'
import { scheduleResponseMessageSchema } from '../../src/shared/scheduleProtocol'
import { memoryScheduleQueue, MemoryScheduleFs } from './helpers/schedules/storage'
import { fakeSchedule } from './helpers/schedules/fixtures'

const cwd = '/probe/workspace'
const START_MS = Date.parse('2026-10-07T12:00:00Z')

function draft(nowMs: number, overrides: Record<string, unknown> = {}) {
  const schedule = fakeSchedule({
    trigger: { kind: 'once', atMs: nowMs + 60_000 },
    ...overrides,
  })
  const {
    name,
    action,
    trigger,
    target,
    delivery,
    whenClosed,
    catchUp,
    mode,
    grant,
    paidCapUsd,
    parallel,
    zone,
    end,
    pinned,
  } = schedule
  return {
    name,
    action,
    trigger,
    target,
    delivery,
    whenClosed,
    catchUp,
    mode,
    grant,
    paidCapUsd,
    parallel,
    zone,
    ...(end !== undefined && { end }),
    pinned,
  }
}

function paidDraft(nowMs: number, paidCapUsd: number) {
  return draft(nowMs, {
    paidCapUsd,
    grant: { rules: [], destinationIds: [], paidCapUsd },
  })
}

function fixture(
  input: {
    fs?: MemoryScheduleFs
    clock?: { nowMs: number }
    hasDelivery?: boolean
    consent?: ScheduleEngineOptions['consent']
    caller?: ScheduleEngineOptions['caller']
  } = {},
) {
  const fs = input.fs ?? new MemoryScheduleFs()
  const clock = input.clock ?? { nowMs: START_MS }
  const engine = createScheduleEngine({
    fs,
    queue: memoryScheduleQueue(fs),
    ...(input.hasDelivery !== false && {
      delivery: () => ({
        targets: {
          find: () => Promise.resolve(undefined),
          open: () => Promise.reject(new Error('no live session')),
          fresh: () => Promise.reject(new Error('no live session')),
        },
        runs: { run: () => Promise.reject(new Error('no live session')) },
        prompt: () => 'scheduled test prompt',
      }),
    }),
    now: () => clock.nowMs,
    ...(input.consent !== undefined && { consent: input.consent }),
    ...(input.caller !== undefined && { caller: input.caller }),
    verifyWake: () => Promise.resolve({ scheduledPrompts: false }),
    platform: 'linux',
    homeDir: '/home/rig',
    dataDir: '/data',
    executable: '/node',
    agentFile: '/agent.js',
    uid: 1000,
    backgroundEntry: {
      status: () => Promise.resolve({ registered: false }),
      register: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    },
  })
  const run = async (argv: readonly string[]) => {
    const [operation] = argv
    const parsed = parseScheduleCommand(operation === 'run-due' ? argv : [...argv, '--cwd', cwd])
    if (!parsed.ok) throw new Error(parsed.reason)
    return await engine.runtime.command(parsed.options, cwd, false)
  }
  return { engine, run, clock }
}

describe('schedule runtime entry over the real store', () => {
  it('shares in-flight recovery and polling across timer and explicit callers', async () => {
    const { engine } = fixture()
    const recovered = Promise.withResolvers<undefined>()
    const recover = vi
      .spyOn(engine.scheduler, 'recover')
      .mockImplementation(() => recovered.promise)
    const poll = vi.spyOn(engine.scheduler, 'poll').mockResolvedValue()
    try {
      const release = await engine.runtime.holdWorkspace(path.resolve(cwd))
      const first = engine.pollWorkspace(workspaceKey(path.resolve(cwd)))
      const second = engine.pollWorkspace(workspaceKey(path.resolve(cwd)))
      expect(first).toBe(second)
      expect(recover).toHaveBeenCalledOnce()
      recovered.resolve(undefined)
      await first
      expect(poll).toHaveBeenCalledOnce()
      await release()
    } finally {
      recovered.resolve(undefined)
      await engine.runtime.close()
    }
  })
  it.each([true, false])(
    'asks before paid panel creation and commits only approval (%s)',
    async (allow) => {
      const consent = vi.fn<NonNullable<ScheduleEngineOptions['consent']>>(async (schedule) => {
        expect(await engine.store.list(schedule.workspaceKey)).toEqual([])
        return allow
          ? {
              modelId: 'muse-spark-1.3',
              accountId: 'test-account',
              priceTier: 'verified',
              dailyCapUsd: Usd.from(1).toAmount(),
              sharedDailyBudgetUsd: Usd.from(5).toAmount(),
              grantedAtMs: START_MS,
              extras: [],
              scope: 'schedule',
            }
          : undefined
      })
      const { engine } = fixture({
        consent,
        caller: () => ({
          source: 'interactive',
          isInteractive: true,
          scheduledPrompts: true,
          maxBudgetUsd: Usd.from(5).toAmount(),
        }),
      })
      try {
        const response = await engine.runtime.message(
          {
            type: 'schedulesRequest',
            version: SCHEDULE_PROTOCOL_VERSION,
            requestId: 'paid-create',
            request: {
              method: 'schedules/create',
              workspaceKey: workspaceKey(path.resolve(cwd)),
              draft: paidDraft(START_MS, 1),
            },
          },
          path.resolve(cwd),
        )
        expect(consent).toHaveBeenCalledOnce()
        expect(scheduleResponseMessageSchema.parse(response).response.kind).toBe(
          allow ? 'accepted' : 'refused',
        )
        const records = await engine.store.list(workspaceKey(path.resolve(cwd)))
        expect(records).toHaveLength(allow ? 1 : 0)
        if (allow) expect(records[0]?.paidConsent?.scope).toBe('schedule')
      } finally {
        await engine.runtime.close()
      }
    },
  )
  it('keeps polling after one of two panels releases the same workspace', async () => {
    vi.useFakeTimers()
    const { engine } = fixture()
    const poll = vi.spyOn(engine.scheduler, 'poll').mockResolvedValue()
    const recover = vi.spyOn(engine.scheduler, 'recover').mockResolvedValue()
    try {
      const first = await engine.runtime.holdWorkspace(path.resolve(cwd))
      const second = await engine.runtime.holdWorkspace(path.resolve(cwd))
      await vi.advanceTimersByTimeAsync(0)
      poll.mockClear()
      recover.mockClear()
      await first()
      await first()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(poll).toHaveBeenCalledOnce()
      expect(recover).toHaveBeenCalledOnce()
      await second()
      poll.mockClear()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(poll).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      await engine.runtime.close()
      vi.useRealTimers()
    }
  })
  it('adds, lists, pauses, resumes, timelines and removes a schedule', async () => {
    const { run, engine, clock } = fixture()
    const empty = await run(['list'])
    expect(empty.exitCode).toBe(0)
    const added = await run(['add', '--draft', JSON.stringify(draft(clock.nowMs))])
    expect(added.exitCode).toBe(0)
    const listed = await run(['list'])
    expect(listed.exitCode).toBe(0)
    expect(listed.output).toContain('Check the build')
    const workspaces = await engine.registry.list()
    const [created] = await engine.store.list(workspaces[0] ?? 'missing')
    const id = created?.id ?? 'missing'
    const paused = await run(['pause', id])
    expect(paused.exitCode).toBe(0)
    const relisted = await run(['list'])
    expect(relisted.output).toContain('Paused')
    const resumed = await run(['resume', id])
    expect(resumed.exitCode).toBe(0)
    const timeline = await run(['timeline', '--hours', '24'])
    expect(timeline.exitCode).toBe(0)
    const removed = await run(['remove', id])
    expect(removed.exitCode).toBe(0)
    const cleared = await run(['list'])
    expect(cleared.output).toBe('No schedules or upcoming fires.')
  })

  it('refuses a paid draft without flags and accepts it with flag and budget', async () => {
    const { run, clock } = fixture()
    const paid = paidDraft(clock.nowMs, 5)
    const refused = await run(['add', '--draft', JSON.stringify(paid)])
    expect(refused.exitCode).toBe(1)
    expect(refused.output).toContain('--max-budget-usd')
    const accepted = await run([
      'add',
      '--draft',
      JSON.stringify(paid),
      '--scheduled-prompts',
      '--max-budget-usd',
      '5',
    ])
    expect(accepted.exitCode).toBe(0)
  })

  it('settles a due run without a live session as an explicit failure, exactly once', async () => {
    const fs = new MemoryScheduleFs()
    const clock = { nowMs: START_MS }
    const { run, engine } = fixture({ fs, clock })
    const added = await run(['add', '--draft', JSON.stringify(draft(clock.nowMs))])
    expect(added.exitCode).toBe(0)
    clock.nowMs += 120_000
    const due = await run(['run-due'])
    expect(due.exitCode).toBe(0)
    const workspaces = await engine.registry.list()
    expect(workspaces).toHaveLength(1)
    const fires = await engine.store.fires(workspaces[0] ?? 'missing')
    expect(fires).toHaveLength(1)
    expect(fires[0]).toMatchObject({ outcome: 'failed' })
    // run-due closes the runtime one-shot, so the repeat is a fresh engine
    // over the same store, as after a restart: still exactly one fire.
    const restarted = fixture({ fs, clock })
    const again = await restarted.run(['run-due'])
    expect(again.exitCode).toBe(0)
    expect(await engine.store.fires(workspaces[0] ?? 'missing')).toHaveLength(1)
  })

  it('leaves an over-budget paid draft refused without spending', async () => {
    const { run, clock } = fixture()
    const paid = paidDraft(clock.nowMs, 5)
    const refused = await run([
      'add',
      '--draft',
      JSON.stringify(paid),
      '--scheduled-prompts',
      '--max-budget-usd',
      '4',
    ])
    expect(refused.exitCode).toBe(1)
    expect(refused.output).toContain('--max-budget-usd')
  })
})

it('a runtime with delivery ports removed preserves a due Once fire while ACP holds its workspace', async () => {
  const { engine, clock } = fixture({ hasDelivery: false })
  const job = fakeSchedule({
    workspaceKey: workspaceKey(cwd),
    trigger: { kind: 'once', atMs: clock.nowMs },
    nextFireAtMs: clock.nowMs,
  })
  await engine.store.create(job)
  try {
    await engine.runtime.holdWorkspace(cwd)
    await engine.pollWorkspace(job.workspaceKey)
    expect(await engine.store.fires(job.workspaceKey)).toEqual([])
    expect(await engine.store.pending(job.workspaceKey)).toEqual([])
    const jobs = await engine.store.list(job.workspaceKey)
    expect(jobs[0]).toMatchObject({
      nextFireAtMs: clock.nowMs,
      fireCount: 0,
    })
  } finally {
    await engine.runtime.close()
  }
})
