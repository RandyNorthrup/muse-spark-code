// The team ledger (M96 lane A, PLAN.md D75): the durable record. Rows live
// in a daily append-only file; history survives a reload; a crashed window's
// task shows as interrupted with its partial usage; retention rolls old rows
// into totals rows; briefs are redacted.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as filesystem from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  teamDayKey,
  TeamMeter,
  sumTeamTotals,
  ZERO_TEAM_METER_USAGE,
} from '../../src/core/team/teamMeter'
import {
  isTeamLedgerActive,
  ledgerMeterRows,
  TeamLedger,
  resetLedgerRow,
  type TeamLedgerOutcome,
  type TeamLedgerRecord,
} from '../../src/host/team/teamLedger'

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof filesystem>()),
}))

import { FakeLogOutputChannel } from './helpers/fakes'

const realSetTimeout = setTimeout
const realClearTimeout = clearTimeout

async function publicationWithin(promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = realSetTimeout(() => {
          reject(new Error('Publication did not answer'))
        }, 2000)
      }),
    ])
  } finally {
    if (timer !== undefined) realClearTimeout(timer)
  }
}

const directories: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

async function ledgerDir(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'team-ledger-'))
  directories.push(directory)
  return directory
}

function taskRecord(taskId: string, overrides: Partial<TeamLedgerRecord> = {}): TeamLedgerRecord {
  return {
    kind: 'task',
    taskId,
    workspaceId: 'ws',
    roleId: 'engineering',
    entryId: 'eng-1',
    agentKey: 'opus',
    modelId: 'muse-spark-1.3',
    provider: 'meta',
    billing: 'key',
    settings: [{ name: 'effort', value: 'high' }],
    workspaceMode: 'own-branch',
    branch: 'agents/engineering/task-1',
    brief: 'Add retries to the fetcher',
    reasonCode: 'delegate',
    startMs: 1_000_000,
    status: 'running',
    outcome: undefined,
    usage: { ...ZERO_TEAM_METER_USAGE, tasks: 1 },
    estimated: false,
    links: {},
    lease: { holder: 'window-a', sinceMs: 1_000_000 },
    ...overrides,
  }
}

function openLedger(directory: string, windowId = 'window-a', nowMs = 1_000_000): TeamLedger {
  return new TeamLedger({
    directory,
    workspaceId: 'ws',
    windowId,
    now: () => nowMs,
    flushMs: 2000,
    log: new FakeLogOutputChannel(),
    retentionDays: 30,
  })
}

async function lifetimeInput(ledger: TeamLedger, taskId: string, atMs: number): Promise<number> {
  const { rows } = await ledger.read()
  const meter = new TeamMeter({ rows: () => ledgerMeterRows(rows), openReservations: () => [] })
  return meter.used(
    'eng-1',
    { measure: 'inputTokens', window: 'lifetime' },
    { taskId, dayKey: teamDayKey(atMs) },
  ).value
}

describe('teamLedger', () => {
  it('round-trips successful tasks that need no merge as done', async () => {
    const directory = await ledgerDir()
    const ledger = openLedger(directory)
    await ledger.record(taskRecord('research-done', { status: 'finished', outcome: 'done' }))
    await ledger.flush()
    const restored = await openLedger(directory).read()
    expect(TeamLedger.latestByTask(restored.rows).get('research-done')?.outcome).toBe('done')
  })
  it('A2-F01 retention drains a concurrent usage update before publishing its rollup', async () => {
    const directory = await ledgerDir()
    const nowMs = new Date(2026, 9, 5).getTime()
    const startMs = nowMs - 40 * 86_400_000
    const ledger = openLedger(directory, 'window-a', nowMs)
    const record = taskRecord('retention-race', {
      startMs,
      status: 'finished',
      usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 100, tasks: 1 },
    })
    await ledger.record(record)
    const pruning = ledger.prune()
    const updating = ledger.record({
      ...record,
      usage: { ...record.usage, inputTokens: 300 },
    })
    await Promise.all([pruning, updating])
    await ledger.flush()
    for (const reader of [ledger, openLedger(directory, 'window-a', nowMs)]) {
      expect(await lifetimeInput(reader, record.taskId, nowMs)).toBe(300)
      const { rows } = await reader.read()
      expect(sumTeamTotals(ledgerMeterRows(rows), { dayKey: undefined }).tokens).toBe(300)
    }
  })

  it.each([
    { before: 100, after: 300, estimated: false },
    { before: 300, after: 100, estimated: true },
  ])('A2-F01 a post-retention settlement supersedes its old rollup (%j)', async (usage) => {
    const directory = await ledgerDir()
    const nowMs = new Date(2026, 9, 5).getTime()
    const record = taskRecord('late-settlement', {
      startMs: nowMs - 40 * 86_400_000,
      status: 'finished',
      estimated: usage.estimated,
      usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: usage.before },
    })
    const ledger = openLedger(directory, 'window-a', nowMs)
    await ledger.record(record)
    await ledger.prune()
    await ledger.record({
      ...record,
      estimated: false,
      usage: { ...record.usage, inputTokens: usage.after },
    })
    await ledger.flush()
    const reader = openLedger(directory, 'window-a', nowMs)
    expect(await lifetimeInput(reader, record.taskId, nowMs)).toBe(usage.after)
    const { rows } = await reader.read()
    expect(sumTeamTotals(ledgerMeterRows(rows), { dayKey: undefined }).tokens).toBe(usage.after)
    expect(ledgerMeterRows(rows).every((row) => !row.estimated)).toBe(true)
    await reader.prune()
    expect(await lifetimeInput(reader, record.taskId, nowMs)).toBe(usage.after)
  })

  it.each(['finished', 'running'] as const)(
    'A2-F02 refuses a stale takeover snapshot after a durable %s update',
    async (status) => {
      const directory = await ledgerDir()
      const owner = openLedger(directory)
      const record = taskRecord('stale-takeover', {
        usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 100 },
      })
      await owner.record(record)
      const recovery = openLedger(directory, 'window-b')
      const original = await recovery.read()
      const stale = TeamLedger.latestByTask(original.rows).get(record.taskId)
      if (stale === undefined) throw new Error('Missing active snapshot')
      await owner.record({ ...record, status, usage: { ...record.usage, inputTokens: 300 } })
      await owner.flush()
      expect(
        await recovery.markInterrupted(stale, stale.usage, false, {
          kind: 'userTakeover',
          ownerId: 'window-a',
        }),
      ).toBe(false)
      const { rows } = await recovery.read()
      expect(TeamLedger.latestByTask(rows).get(record.taskId)?.status).toBe(status)
      expect(sumTeamTotals(ledgerMeterRows(rows), { dayKey: undefined }).tokens).toBe(300)
    },
  )

  it('A2-F02 checks takeover after an already queued local completion publishes', async () => {
    const directory = await ledgerDir()
    const ledger = openLedger(directory)
    const record = taskRecord('local-takeover')
    await ledger.record(record)
    const original = await ledger.read()
    const stale = TeamLedger.latestByTask(original.rows).get(record.taskId)
    if (stale === undefined) throw new Error('Missing active snapshot')
    const finishing = ledger.record({
      ...record,
      status: 'finished',
      usage: { ...record.usage, inputTokens: 300 },
    })
    const recovering = ledger.markInterrupted(stale, stale.usage, false, undefined)
    await finishing
    expect(await recovering).toBe(false)
    expect(await lifetimeInput(ledger, record.taskId, record.startMs)).toBe(300)
  })

  it('A2-F03 persists only approved fields from enriched records, including nested objects', async () => {
    const directory = await ledgerDir()
    const ledger = openLedger(directory)
    const marker = 'private-content-outside-the-brief'
    const record = taskRecord('enriched')
    const enriched = {
      ...record,
      prompt: marker,
      fileContent: marker,
      usage: { ...record.usage, fileContent: marker },
      settings: [{ name: 'effort', value: 'high', prompt: marker }],
      links: { transcript: 'task/transcript', fileContent: marker },
      lease: { ...record.lease, prompt: marker },
    }
    await ledger.record(enriched)
    await ledger.flush()
    const file = path.join(directory, 'window-a', `team-${teamDayKey(record.startMs)}.jsonl`)
    const stored = await readFile(file, 'utf8')
    expect(stored).not.toContain(marker)
    const { rows } = await openLedger(directory).read()
    expect(TeamLedger.latestByTask(rows).get(record.taskId)?.links.transcript).toBe(
      'task/transcript',
    )
  })

  it.each([false, true])(
    'F02 serializes multi-day flushes and failed retries (failure=%s)',
    async (fail) => {
      const directory = await ledgerDir()
      const ledger = openLedger(directory)
      const day = teamDayKey(1_000_000)
      const next = teamDayKey(1_000_000 + 86_400_000)
      await ledger.record(taskRecord('race', { dayKey: day }))
      await ledger.record(
        taskRecord('race', { dayKey: day, usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 200 } }),
      )
      await ledger.record(
        taskRecord('race', { dayKey: next, usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 50 } }),
      )
      const blocked = Promise.withResolvers<undefined>()
      const entered = Promise.withResolvers<undefined>()
      const real = await vi.importActual<typeof filesystem>('node:fs/promises')
      vi.spyOn(filesystem, 'open').mockImplementationOnce(async (...args) => {
        entered.resolve(undefined)
        await blocked.promise
        if (fail) throw new Error('Older append failed')
        return await real.open(...args)
      })
      const older = (async () => {
        try {
          await ledger.flush()
        } catch {
          expect(fail).toBe(true)
        }
      })()
      await entered.promise
      const newer = ledger.record(
        taskRecord('race', {
          dayKey: next,
          status: 'finished',
          usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 75 },
        }),
      )
      blocked.resolve(undefined)
      await Promise.all([older, newer])
      await ledger.flush()
      const read = await ledger.read()
      expect(TeamLedger.latestByTask(read.rows).get('race')?.status).toBe('finished')
      expect(sumTeamTotals(ledgerMeterRows(read.rows), { dayKey: undefined }).tokens).toBe(275)
    },
  )

  it('F05 a reset retains later settlement from an already running task across reload and retention', async () => {
    const directory = await ledgerDir()
    const nowMs = new Date(2026, 9, 5).getTime()
    const startMs = nowMs - 40 * 86_400_000
    const ledger = openLedger(directory, 'window-a', nowMs)
    await ledger.record(
      taskRecord('continuing', {
        startMs,
        usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 100, tasks: 1 },
      }),
    )
    await ledger.record(
      resetLedgerRow({
        workspaceId: 'ws',
        entryId: 'eng-1',
        window: 'lifetime',
        clearedEntryId: 'eng-1',
        startMs: startMs + 1,
      }),
    )
    await ledger.record(
      taskRecord('continuing', {
        startMs,
        status: 'finished',
        usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 300, tasks: 1 },
      }),
    )
    const check = async (reader: TeamLedger) => {
      expect(await lifetimeInput(reader, 'continuing', nowMs)).toBe(200)
    }
    await check(openLedger(directory, 'window-a', nowMs))
    await ledger.prune()
    await check(openLedger(directory, 'window-a', nowMs))
  })

  it('F05 Reset never captures settlement arriving while its baseline is read', async () => {
    const directory = await ledgerDir()
    const startMs = new Date(2026, 9, 5).getTime()
    const ledger = openLedger(directory, 'window-a', startMs)
    await ledger.record(
      taskRecord('during-reset', {
        startMs,
        usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 100 },
      }),
    )
    const entered = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    const real = await vi.importActual<typeof filesystem>('node:fs/promises')
    vi.spyOn(filesystem, 'readFile').mockImplementationOnce(async (...args) => {
      entered.resolve(undefined)
      await resume.promise
      return await real.readFile(...args)
    })
    const reset = ledger.record(
      resetLedgerRow({
        workspaceId: 'ws',
        entryId: 'eng-1',
        window: 'lifetime',
        clearedEntryId: 'eng-1',
        startMs: startMs + 1,
      }),
    )
    await entered.promise
    const settled = ledger.record(
      taskRecord('during-reset', {
        startMs,
        status: 'finished',
        usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 300 },
      }),
    )
    resume.resolve(undefined)
    await Promise.all([reset, settled])
    expect(await lifetimeInput(ledger, 'during-reset', startMs)).toBe(200)
  })

  it('F08 retention uses the task state across days and expires every old brief', async () => {
    const directory = await ledgerDir()
    const nowMs = new Date(2026, 9, 5).getTime()
    const oldMs = nowMs - 40 * 86_400_000
    const ledger = openLedger(directory, 'window-a', nowMs)
    await ledger.record(
      taskRecord('overnight', {
        startMs: oldMs,
        dayKey: teamDayKey(oldMs),
        usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 100 },
      }),
    )
    await ledger.record(
      taskRecord('overnight', {
        startMs: oldMs,
        dayKey: teamDayKey(oldMs + 86_400_000),
        status: 'finished',
        usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 200 },
      }),
    )
    expect(await ledger.prune()).toEqual({ rolled: 2, removed: 2 })
    const read = await ledger.read()
    expect(read.rows.every((row) => row.brief === '' && !isTeamLedgerActive(row.status))).toBe(true)
    expect(sumTeamTotals(ledgerMeterRows(read.rows), { dayKey: undefined }).tokens).toBe(300)
  })

  it('F06 timer publication failures are logged and retried with bounded backoff', async () => {
    const directory = await ledgerDir()
    vi.useFakeTimers()
    const log = new FakeLogOutputChannel()
    const ledger = new TeamLedger({
      directory,
      workspaceId: 'ws',
      windowId: 'window-a',
      now: Date.now,
      flushMs: 2000,
      retentionDays: 30,
      log,
    })
    await ledger.record(taskRecord('timer'))
    await ledger.record(
      taskRecord('timer', { usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 100 } }),
    )
    const real = await vi.importActual<typeof filesystem>('node:fs/promises')
    const open = vi.spyOn(filesystem, 'open')
    for (let i = 0; i < 7; i += 1)
      open.mockRejectedValueOnce(new Error('Private account/path failure'))
    const flush = vi.spyOn(ledger, 'flush')
    ledger.start()
    for (const [index, delay] of [2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000].entries()) {
      const logged = Promise.withResolvers<undefined>()
      log.warn.mockImplementationOnce(() => {
        logged.resolve(undefined)
      })
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(flush).toHaveBeenCalledTimes(index)
      await vi.advanceTimersByTimeAsync(1)
      await publicationWithin(logged.promise)
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(open).toHaveBeenCalledTimes(7)
    expect(log.warn).toHaveBeenCalledTimes(7)
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('Private account/path')
    const written = Promise.withResolvers<undefined>()
    open.mockImplementationOnce(async (...args) => {
      const handle = await real.open(...args)
      const append = handle.appendFile.bind(handle)
      vi.spyOn(handle, 'appendFile').mockImplementationOnce(async (...writeArgs) => {
        await append(...writeArgs)
        written.resolve(undefined)
      })
      return handle
    })
    await vi.advanceTimersByTimeAsync(60_000)
    await publicationWithin(written.promise)
    await ledger.dispose()
    expect(vi.getTimerCount()).toBe(0)
    const read = await ledger.read()
    expect(TeamLedger.latestByTask(read.rows).get('timer')?.usage.inputTokens).toBe(100)
  })
  it('does not lose a pending row when publication fails, and surfaces unreadable storage', async () => {
    const directory = await ledgerDir()
    const ledger = openLedger(directory)
    const failure = new Error('Disk unavailable')
    vi.spyOn(filesystem, 'open').mockRejectedValueOnce(failure)
    await expect(ledger.record(taskRecord('retry'))).rejects.toThrow('Disk unavailable')
    await ledger.flush()
    const read = await ledger.read()
    expect(TeamLedger.latestByTask(read.rows).has('retry')).toBe(true)
    vi.spyOn(filesystem, 'readdir').mockRejectedValueOnce(
      Object.assign(new Error('Denied'), { code: 'EACCES' }),
    )
    await expect(ledger.read()).rejects.toThrow('Denied')
  })

  it('acknowledges state only after syncing; a lost sync answer can retry without duplicate use', async () => {
    const directory = await ledgerDir()
    const ledger = openLedger(directory)
    const real = await vi.importActual<typeof filesystem>('node:fs/promises')
    vi.spyOn(filesystem, 'open').mockImplementationOnce(async (...args) => {
      const handle = await real.open(...args)
      vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('Sync failed'))
      return handle
    })
    await expect(
      ledger.record(
        taskRecord('sync', { usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 100, tasks: 1 } }),
      ),
    ).rejects.toThrow('Sync failed')
    await ledger.flush()
    const read = await ledger.read()
    expect(sumTeamTotals(ledgerMeterRows(read.rows), { dayKey: undefined }).tokens).toBe(100)
  })

  it('never treats a fresh, stale or missing hint as permission to interrupt another owner', async () => {
    const directory = await ledgerDir()
    const owner = openLedger(directory)
    await owner.record(taskRecord('live'))
    const recovery = openLedger(directory, 'window-b', 2_000_000)
    const original = await recovery.read()
    const latest = TeamLedger.latestByTask(original.rows).get('live')
    if (latest === undefined) throw new Error('missing row')
    const sourcePath = path.join(directory, 'window-a', `team-${teamDayKey(latest.startMs)}.jsonl`)
    const originalBytes = await readFile(sourcePath)
    for (const hint of ['fresh', 'stale', 'missing']) {
      expect(await recovery.markInterrupted(latest, latest.usage, false, undefined), hint).toBe(
        false,
      )
    }
    const active = await owner.read()
    expect(TeamLedger.latestByTask(active.rows).get('live')?.status).toBe('running')
    expect(
      await recovery.markInterrupted(latest, latest.usage, false, {
        kind: 'userTakeover',
        ownerId: 'wrong',
      }),
    ).toBe(false)
    expect(
      await recovery.markInterrupted(latest, { ...latest.usage, inputTokens: 3000 }, false, {
        kind: 'userTakeover',
        ownerId: 'window-a',
      }),
    ).toBe(true)
    const source = await readFile(
      path.join(directory, 'window-a', `team-${teamDayKey(latest.startMs)}.jsonl`),
      'utf8',
    )
    expect(source).not.toContain('interrupted')
    const updated = await recovery.read()
    const taken = TeamLedger.latestByTask(updated.rows).get('live')
    expect(taken?.recoveryDecision).toEqual({ kind: 'userTakeover', ownerId: 'window-a' })
    expect(taken?.lease.holder).toBe('window-b')
    expect(await readFile(sourcePath)).toEqual(originalBytes)
    if (taken === undefined) throw new Error('missing takeover')
    expect(TeamLedger.latestByTask([taken, latest]).get('live')?.status).toBe('interrupted')
    expect(ledgerMeterRows([taken, latest])[0]?.usage).toEqual(taken.usage)
    const takeoverRollup = { ...taken, kind: 'totals' as const, sourceTaskId: taken.taskId }
    expect(ledgerMeterRows([latest, takeoverRollup])[0]?.usage).toEqual(taken.usage)
    expect(ledgerMeterRows([takeoverRollup, latest])[0]?.usage).toEqual(taken.usage)
  })

  it('refuses foreign-owner writes, another workspace and path traversal before publication', async () => {
    const directory = await ledgerDir()
    const ledger = openLedger(directory, 'window-b')
    await expect(ledger.record(taskRecord('foreign'))).rejects.toThrow()
    await expect(
      ledger.record(
        taskRecord('foreign', { workspaceId: 'other', lease: { holder: 'window-b', sinceMs: 0 } }),
      ),
    ).rejects.toThrow()
    await expect(
      ledger.record(
        taskRecord('foreign', { dayKey: '../escape', lease: { holder: 'window-b', sinceMs: 0 } }),
      ),
    ).rejects.toThrow(/invalid/)
    expect(() => openLedger(directory, '../escape')).toThrow()
  })

  it("retention leaves another owner's old terminal records byte-exact and keeps active own tasks", async () => {
    const directory = await ledgerDir()
    const oldMs = 1_000_000 - 40 * 86_400_000
    const owner = openLedger(directory, 'window-a', oldMs)
    await owner.record(taskRecord('foreign-old', { startMs: oldMs, status: 'finished' }))
    const reader = openLedger(directory, 'window-b')
    await reader.record(
      taskRecord('own-active', { startMs: oldMs, lease: { holder: 'window-b', sinceMs: oldMs } }),
    )
    const source = path.join(directory, 'window-a', `team-${teamDayKey(oldMs)}.jsonl`)
    const before = await readFile(source)
    expect(await reader.prune()).toEqual({ rolled: 0, removed: 0 })
    expect(await readFile(source)).toEqual(before)
    const active = await reader.read()
    expect(TeamLedger.latestByTask(active.rows).get('own-active')?.status).toBe('running')
  })

  it('meters use the latest cumulative snapshot and retain reset markers through pruning', async () => {
    const directory = await ledgerDir()
    const nowMs = new Date(2026, 9, 5).getTime()
    const ledger = openLedger(directory, 'window-a', nowMs)
    const oldMs = nowMs - 40 * 86_400_000
    await ledger.record(
      taskRecord('old', {
        startMs: oldMs,
        usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 1000, tasks: 1 },
      }),
    )
    await ledger.record(
      taskRecord('old', {
        startMs: oldMs,
        status: 'finished',
        usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 2000, tasks: 1 },
      }),
    )
    await ledger.record(
      resetLedgerRow({
        workspaceId: 'ws',
        entryId: 'eng-1',
        window: 'lifetime',
        clearedEntryId: 'eng-1',
        startMs: oldMs + 1,
      }),
    )
    await ledger.record(
      taskRecord('new', {
        startMs: nowMs,
        status: 'finished',
        usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 100, tasks: 1 },
      }),
    )
    const readMeter = async () => {
      const read = await ledger.read()
      return ledgerMeterRows(read.rows)
    }
    expect(sumTeamTotals(await readMeter(), { dayKey: undefined }).tokens).toBe(2100)
    expect(await ledger.prune()).toEqual({ rolled: 2, removed: 1 })
    const meter = new TeamMeter({ rows: () => rows, openReservations: () => [] })
    const rows = await readMeter()
    expect(
      meter.used(
        'eng-1',
        { measure: 'tokens', window: 'lifetime' },
        { taskId: 'new', dayKey: teamDayKey(nowMs) },
      ).value,
    ).toBe(100)
    expect(sumTeamTotals(rows, { dayKey: undefined }).tokens).toBe(2100)
  })

  it('a usage batch spanning midnight writes each snapshot to its own daily file', async () => {
    const directory = await ledgerDir()
    const ledger = openLedger(directory)
    const day = teamDayKey(1_000_000)
    const next = teamDayKey(1_000_000 + 86_400_000)
    await ledger.record(taskRecord('task', { dayKey: day }))
    await ledger.record(
      taskRecord('task', { dayKey: day, usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 100 } }),
    )
    await ledger.record(
      taskRecord('task', { dayKey: next, usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 200 } }),
    )
    await ledger.flush()
    const nextText = await readFile(path.join(directory, 'window-a', `team-${next}.jsonl`), 'utf8')
    expect(nextText).toContain(next)
    const read = await ledger.read()
    const rows = ledgerMeterRows(read.rows)
    expect(sumTeamTotals(rows, { dayKey: day }).tokens).toBe(100)
    expect(sumTeamTotals(rows, { dayKey: next }).tokens).toBe(200)
  })

  it('keeps history across a simulated reload, last state change wins', async () => {
    const directory = await ledgerDir()
    const first = openLedger(directory)
    await first.record(taskRecord('task-1'))
    await first.record({
      ...taskRecord('task-1'),
      status: 'finished',
      outcome: undefined,
      endMs: 1_001_000,
    })
    await first.dispose()

    const second = openLedger(directory)
    const { rows, skippedLines } = await second.read()
    expect(skippedLines).toBe(0)
    expect(TeamLedger.latestByTask(rows).get('task-1')?.status).toBe('finished')
    await second.dispose()
  })

  it('a two-writer race on one folder loses no row: every append lands whole', async () => {
    const directory = await ledgerDir()
    const left = openLedger(directory, 'window-a')
    const right = openLedger(directory, 'window-b')
    await Promise.all([
      (async () => {
        for (let n = 0; n < 25; n += 1) {
          await left.record(taskRecord(`left-${String(n)}`))
        }
      })(),
      (async () => {
        for (let n = 0; n < 25; n += 1) {
          await right.record(
            taskRecord(`right-${String(n)}`, { lease: { holder: 'window-b', sinceMs: 1_000_000 } }),
          )
        }
      })(),
    ])
    await left.dispose()
    await right.dispose()
    const reader = openLedger(directory)
    const { rows, skippedLines } = await reader.read()
    expect(skippedLines).toBe(0)
    expect(TeamLedger.latestByTask(rows).size).toBe(50)
    await reader.dispose()
  })

  it('an interrupted run shows with its partial usage after the crash', async () => {
    const directory = await ledgerDir()
    const running = openLedger(directory, 'window-a')
    await running.record(
      taskRecord('task-1', {
        usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 3000, outputTokens: 1500, tasks: 1 },
      }),
    )
    await running.dispose()

    // The window died: a new window marks the still-active row interrupted.
    const next = openLedger(directory, 'window-b', 2_000_000)
    const { rows } = await next.read()
    const latest = TeamLedger.latestByTask(rows).get('task-1')
    expect(latest?.status).toBe('running')
    expect(isTeamLedgerActive(latest?.status ?? 'finished')).toBe(true)
    const isMarked = await next.markInterrupted(
      latest!,
      { ...ZERO_TEAM_METER_USAGE, inputTokens: 3000, outputTokens: 1500, tasks: 1 },
      false,
      { kind: 'userTakeover', ownerId: 'window-a' },
    )
    expect(isMarked).toBe(true)
    const after = await next.read()
    const done = TeamLedger.latestByTask(after.rows).get('task-1')
    expect(done?.status).toBe('interrupted')
    const outcome: TeamLedgerOutcome | undefined = done?.outcome ?? undefined
    expect(outcome).toBe('interrupted')
    expect(done?.usage.inputTokens).toBe(3000)
    // Marking a finished task again does nothing.
    expect(await next.markInterrupted(done!, done!.usage, false, undefined)).toBe(false)
    await next.dispose()
  })

  it('skips a crashed writer’s partial tail line and keeps every whole row', async () => {
    const directory = await ledgerDir()
    const ledger = openLedger(directory)
    await ledger.record(taskRecord('task-1'))
    await ledger.dispose()
    const dayKey = teamDayKey(1_000_000)
    const file = path.join(directory, 'window-a', `team-${dayKey}.jsonl`)
    await writeFile(
      file,
      `${await readFile(file, 'utf8')}{"version":1,"kind":"task","taskId":"half`,
      'utf8',
    )
    const reader = openLedger(directory)
    const { rows, skippedLines } = await reader.read()
    expect(skippedLines).toBe(1)
    expect(TeamLedger.latestByTask(rows).get('task-1')?.status).toBe('running')
    // A later append cannot join the partial tail and lose another whole row.
    await reader.record(taskRecord('after-crash'))
    const appended = await reader.read()
    expect(appended.skippedLines).toBe(1)
    expect(TeamLedger.latestByTask(appended.rows).has('after-crash')).toBe(true)
    await reader.dispose()
  })

  it('redacts secrets in the brief and stores no other prompt text', async () => {
    const directory = await ledgerDir()
    // Built up, never a literal secret shape (repo convention).
    const secret = `sk-${'a'.repeat(24)}`
    const ledger = openLedger(directory)
    await ledger.record(taskRecord('task-1', { brief: `Rotate the key ${secret} now` }))
    await ledger.dispose()
    const reader = openLedger(directory)
    const { rows } = await reader.read()
    const brief = TeamLedger.latestByTask(rows).get('task-1')?.brief ?? ''
    expect(brief).not.toContain(secret)
    expect(brief).toContain('[redacted]')
    await reader.dispose()
  })

  it('bounds the brief: a long brief is cut, the row stays small', async () => {
    const directory = await ledgerDir()
    const ledger = openLedger(directory)
    await ledger.record(taskRecord('task-1', { brief: 'x'.repeat(5000) }))
    await ledger.dispose()
    const reader = openLedger(directory)
    const { rows } = await reader.read()
    expect((TeamLedger.latestByTask(rows).get('task-1')?.brief ?? '').length).toBeLessThanOrEqual(
      500,
    )
    await reader.dispose()
  })

  it('retention rolls old task rows into totals rows and removes the file', async () => {
    const directory = await ledgerDir()
    const oldDay = teamDayKey(1_000_000 - 40 * 24 * 60 * 60 * 1000)
    const old = new TeamLedger({
      directory,
      workspaceId: 'ws',
      windowId: 'window-a',
      now: () => 1_000_000 - 40 * 24 * 60 * 60 * 1000,
      flushMs: 2000,
      log: new FakeLogOutputChannel(),
      retentionDays: 30,
    })
    await old.record(
      taskRecord('old-1', {
        startMs: 1_000_000 - 40 * 24 * 60 * 60 * 1000,
        dayKey: oldDay,
        status: 'finished',
        usage: {
          ...ZERO_TEAM_METER_USAGE,
          inputTokens: 1_000_000,
          outputTokens: 500_000,
          tasks: 1,
        },
      }),
    )
    await old.dispose()

    const ledger = openLedger(directory, 'window-a', 1_000_000)
    const pruned = await ledger.prune()
    expect(pruned).toEqual({ rolled: 1, removed: 1 })
    const { rows } = await ledger.read()
    const meterRows = ledgerMeterRows(rows)
    const lifetime = meterRows.filter((row) => row.entryId === 'eng-1')
    expect(lifetime).toHaveLength(1)
    expect(lifetime[0]?.kind).toBe('totals')
    expect(lifetime[0]?.usage.inputTokens).toBe(1_000_000)
    await ledger.dispose()
  })

  it('retention with 0 keeps everything', async () => {
    const directory = await ledgerDir()
    const ledger = new TeamLedger({
      directory,
      workspaceId: 'ws',
      windowId: 'window-a',
      now: () => 1_000_000,
      flushMs: 2000,
      log: new FakeLogOutputChannel(),
      retentionDays: 0,
    })
    await ledger.record(taskRecord('task-1'))
    expect(await ledger.prune()).toEqual({ rolled: 0, removed: 0 })
    await ledger.dispose()
  })

  it('a crash after the rollup append and before removal never duplicates lifetime use', async () => {
    const directory = await ledgerDir()
    const ledger = openLedger(directory)
    const oldMs = 1_000_000 - 40 * 86_400_000
    await ledger.record(
      taskRecord('old', {
        startMs: oldMs,
        status: 'finished',
        usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 2000, tasks: 1 },
      }),
    )
    vi.spyOn(filesystem, 'rm').mockRejectedValueOnce(new Error('Removal interrupted'))
    await expect(ledger.prune()).rejects.toThrow('Removal interrupted')
    const before = await ledger.read()
    expect(sumTeamTotals(ledgerMeterRows(before.rows), { dayKey: undefined }).tokens).toBe(2000)
    const restarted = openLedger(directory)
    expect(await restarted.prune()).toEqual({ rolled: 1, removed: 1 })
    const after = await restarted.read()
    expect(sumTeamTotals(ledgerMeterRows(after.rows), { dayKey: undefined }).tokens).toBe(2000)
    expect(sumTeamTotals(ledgerMeterRows(after.rows), { dayKey: undefined }).tasks).toBe(1)
  })

  it('flushes state changes at once and batches usage updates for the timer', async () => {
    const directory = await ledgerDir()
    let nowMs = 1_000_000
    const ledger = new TeamLedger({
      directory,
      workspaceId: 'ws',
      windowId: 'window-a',
      now: () => nowMs,
      flushMs: 60_000,
      log: new FakeLogOutputChannel(),
      retentionDays: 30,
    })
    const dayKey = teamDayKey(1_000_000)
    const file = path.join(directory, 'window-a', `team-${dayKey}.jsonl`)
    const lineCount = async (): Promise<number> => {
      const text = await readFile(file, 'utf8')
      return text.split('\n').filter((line) => line !== '').length
    }
    // The start flushes at once (a state change from nothing).
    await ledger.record(taskRecord('task-1'))
    expect(await lineCount()).toBe(1)
    // A usage-only update waits for the timer.
    nowMs += 1000
    await ledger.record({
      ...taskRecord('task-1'),
      usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 500, tasks: 1 },
    })
    expect(await lineCount()).toBe(1)
    await ledger.flush()
    expect(await lineCount()).toBe(2)
    // A state change flushes at once again.
    await ledger.record({ ...taskRecord('task-1'), status: 'finished', endMs: nowMs })
    expect(await lineCount()).toBe(3)
    await ledger.dispose()
  })

  it('refuses an invalid row before anything reaches the file', async () => {
    const directory = await ledgerDir()
    const ledger = openLedger(directory)
    await expect(
      ledger.record({ ...taskRecord('task-1'), status: 'bogus' as never }),
    ).rejects.toThrow(/invalid/)
    await ledger.dispose()
  })
})
