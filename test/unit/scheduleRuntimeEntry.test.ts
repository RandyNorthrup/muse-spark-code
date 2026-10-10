import { describe, expect, it } from 'vitest'
import { parseScheduleCommand } from '../../src/runtime/schedules/args'
import { createScheduleEngine } from '../../src/runtime/schedules/engine'
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

function fixture(input: { fs?: MemoryScheduleFs; clock?: { nowMs: number } } = {}) {
  const fs = input.fs ?? new MemoryScheduleFs()
  const clock = input.clock ?? { nowMs: START_MS }
  const engine = createScheduleEngine({
    fs,
    queue: memoryScheduleQueue(fs),
    now: () => clock.nowMs,
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
