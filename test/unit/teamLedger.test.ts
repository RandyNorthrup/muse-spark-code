// The team ledger (M96 lane A, PLAN.md D75): the durable record. Rows live
// in a daily append-only file; history survives a reload; a crashed window's
// task shows as interrupted with its partial usage; retention rolls old rows
// into totals rows; briefs are redacted.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { teamDayKey, ZERO_TEAM_METER_USAGE } from '../../src/core/team/teamMeter'
import {
  isTeamLedgerActive,
  ledgerMeterRows,
  TeamLedger,
  type TeamLedgerRecord,
} from '../../src/host/team/teamLedger'

const directories: string[] = []
afterEach(async () => {
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

async function openLedger(directory: string, windowId = 'window-a', nowMs = 1_000_000): Promise<TeamLedger> {
  const ledger = new TeamLedger({
    directory,
    workspaceId: 'ws',
    windowId,
    now: () => nowMs,
    flushMs: 2000,
    retentionDays: 30,
  })
  return ledger
}

describe('teamLedger', () => {
  it('keeps history across a simulated reload, last state change wins', async () => {
    const directory = await ledgerDir()
    const first = await openLedger(directory)
    await first.record(taskRecord('task-1'))
    await first.record({ ...taskRecord('task-1'), status: 'finished', outcome: undefined, endMs: 1_001_000 })
    await first.dispose()

    const second = await openLedger(directory)
    const { rows, skippedLines } = await second.read()
    expect(skippedLines).toBe(0)
    expect(TeamLedger.latestByTask(rows).get('task-1')?.status).toBe('finished')
    await second.dispose()
  })

  it('a two-writer race on one folder loses no row: every append lands whole', async () => {
    const directory = await ledgerDir()
    const left = await openLedger(directory, 'window-a')
    const right = await openLedger(directory, 'window-b')
    await Promise.all([
      (async () => {
        for (let n = 0; n < 25; n += 1) {
          await left.record(taskRecord(`left-${String(n)}`))
        }
      })(),
      (async () => {
        for (let n = 0; n < 25; n += 1) {
          await right.record(taskRecord(`right-${String(n)}`))
        }
      })(),
    ])
    await left.dispose()
    await right.dispose()
    const reader = await openLedger(directory)
    const { rows, skippedLines } = await reader.read()
    expect(skippedLines).toBe(0)
    expect(TeamLedger.latestByTask(rows).size).toBe(50)
    await reader.dispose()
  })

  it('an interrupted run shows with its partial usage after the crash', async () => {
    const directory = await ledgerDir()
    const running = await openLedger(directory, 'window-a')
    await running.record(
      taskRecord('task-1', {
        usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 3000, outputTokens: 1500, tasks: 1 },
      }),
    )
    await running.dispose()

    // The window died: a new window marks the still-active row interrupted.
    const next = await openLedger(directory, 'window-b', 2_000_000)
    const { rows } = await next.read()
    const latest = TeamLedger.latestByTask(rows).get('task-1')
    expect(latest?.status).toBe('running')
    expect(isTeamLedgerActive(latest?.status ?? 'finished')).toBe(true)
    const marked = await next.markInterrupted(
      latest!,
      { ...ZERO_TEAM_METER_USAGE, inputTokens: 3000, outputTokens: 1500, tasks: 1 },
      false,
      false,
    )
    expect(marked).toBe(true)
    const after = await next.read()
    const done = TeamLedger.latestByTask(after.rows).get('task-1')
    expect(done?.status).toBe('interrupted')
    expect(done?.outcome).toBe('interrupted')
    expect(done?.usage.inputTokens).toBe(3000)
    // Marking a finished task again does nothing.
    expect(await next.markInterrupted(done!, done!.usage, false, false)).toBe(false)
    await next.dispose()
  })

  it('skips a crashed writer’s partial tail line and keeps every whole row', async () => {
    const directory = await ledgerDir()
    const ledger = await openLedger(directory)
    await ledger.record(taskRecord('task-1'))
    await ledger.dispose()
    const dayKey = teamDayKey(1_000_000)
    const file = path.join(directory, `team-${dayKey}.jsonl`)
    await writeFile(file, `${await readFile(file, 'utf8')}{"version":1,"kind":"task","taskId":"half`, 'utf8')
    const reader = await openLedger(directory)
    const { rows, skippedLines } = await reader.read()
    expect(skippedLines).toBe(1)
    expect(TeamLedger.latestByTask(rows).get('task-1')?.status).toBe('running')
    await reader.dispose()
  })

  it('redacts secrets in the brief and stores no other prompt text', async () => {
    const directory = await ledgerDir()
    const ledger = await openLedger(directory)
    await ledger.record(
      taskRecord('task-1', { brief: 'Rotate the key sk-live-secret-value-123 now' }),
    )
    await ledger.dispose()
    const reader = await openLedger(directory)
    const { rows } = await reader.read()
    const brief = TeamLedger.latestByTask(rows).get('task-1')?.brief ?? ''
    expect(brief).not.toContain('sk-live-secret-value-123')
    await reader.dispose()
  })

  it('bounds the brief: a long brief is cut, the row stays small', async () => {
    const directory = await ledgerDir()
    const ledger = await openLedger(directory)
    await ledger.record(taskRecord('task-1', { brief: 'x'.repeat(5000) }))
    await ledger.dispose()
    const reader = await openLedger(directory)
    const { rows } = await reader.read()
    expect((TeamLedger.latestByTask(rows).get('task-1')?.brief ?? '').length).toBeLessThanOrEqual(500)
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
      retentionDays: 30,
    })
    await old.record(
      taskRecord('old-1', {
        startMs: 1_000_000 - 40 * 24 * 60 * 60 * 1000,
        dayKey: oldDay,
        usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 1_000_000, outputTokens: 500_000, tasks: 1 },
      }),
    )
    await old.dispose()

    const ledger = await openLedger(directory, 'window-a', 1_000_000)
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
      retentionDays: 0,
    })
    await ledger.record(taskRecord('task-1'))
    expect(await ledger.prune()).toEqual({ rolled: 0, removed: 0 })
    await ledger.dispose()
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
      retentionDays: 30,
    })
    const dayKey = teamDayKey(1_000_000)
    const file = path.join(directory, `team-${dayKey}.jsonl`)
    // The start flushes at once (a state change from nothing).
    await ledger.record(taskRecord('task-1'))
    expect((await readFile(file, 'utf8')).split('\n').filter((line) => line !== '')).toHaveLength(1)
    // A usage-only update waits for the timer.
    nowMs += 1000
    await ledger.record({
      ...taskRecord('task-1'),
      usage: { ...ZERO_TEAM_METER_USAGE, inputTokens: 500, tasks: 1 },
    })
    expect((await readFile(file, 'utf8')).split('\n').filter((line) => line !== '')).toHaveLength(1)
    await ledger.flush()
    expect((await readFile(file, 'utf8')).split('\n').filter((line) => line !== '')).toHaveLength(2)
    // A state change flushes at once again.
    await ledger.record({ ...taskRecord('task-1'), status: 'finished', endMs: nowMs })
    expect((await readFile(file, 'utf8')).split('\n').filter((line) => line !== '')).toHaveLength(3)
    await ledger.dispose()
  })

  it('refuses an invalid row before anything reaches the file', async () => {
    const directory = await ledgerDir()
    const ledger = await openLedger(directory)
    await expect(ledger.record({ ...taskRecord('task-1'), status: 'bogus' as never })).rejects.toThrow(
      /invalid/,
    )
    await ledger.dispose()
  })
})
