// Lane A accounting (M96, PLAN.md D75): meters as sums over ledger rows
// plus open reservations; reported versus estimated; resets.

import { describe, expect, it } from 'vitest'
import {
  checkAndReserve,
  sumTeamTotals,
  settleTeamReservation,
  teamDayKey,
  TeamMeter,
  ZERO_TEAM_METER_USAGE,
  type TeamMeterRow,
  type TeamMeterUsage,
} from '../../src/core/team/teamMeter'
import { resetLedgerRow } from '../../src/host/team/teamLedger'
import { FakeTeamJournal } from './helpers/teamFakes'

const DAY = teamDayKey(1_000_000)
const REQUEST = {
  workspaceId: 'ws',
  entryId: 'eng-1',
  agentKey: 'opus',
  taskId: 'task-1',
  tokens: 9000,
  inputTokens: 9000,
  outputTokens: 0,
  spendUsd: 0.5,
  dayKey: DAY,
  startMs: 1_000_000,
  budgets: () => ({
    paidDailyBudgetUsd: 50,
    teamDailyBudgetUsd: 50,
    teamDailyBudgetTokens: 25_000_000,
    workspaceDailyBudgetUsd: 50,
    workspaceDailyBudgetTokens: 25_000_000,
  }),
} as const

function usage(partial: Partial<TeamMeterUsage>): TeamMeterUsage {
  return { ...ZERO_TEAM_METER_USAGE, ...partial }
}

function taskRow(
  entryId: string,
  taskId: string,
  inputTokens: number,
  outputTokens: number,
  extra: Partial<TeamMeterRow> = {},
): TeamMeterRow {
  return {
    kind: 'task',
    entryId,
    agentKey: 'agent',
    roleId: 'engineering',
    taskId,
    dayKey: DAY,
    startMs: 1_000_000,
    usage: usage({ inputTokens, outputTokens, tasks: 1 }),
    estimated: false,
    ...extra,
  }
}

function emptyScope(): TeamMeterRow[] {
  return []
}

function meterWith(rows: TeamMeterRow[]): { meter: TeamMeter } {
  return {
    meter: new TeamMeter({
      rows: () => rows,
      openReservations: () => [],
    }),
  }
}

describe('teamMeter', () => {
  it('accounting after a switch: each part charges the entry that sent it, labelled reported', () => {
    // Three requests on entry 1 (3,000 + 4,000 + 2,000) and two on entry 2 (5,000 + 1,000).
    const rows = [
      taskRow('eng-1', 'task-1', 2000, 1000),
      taskRow('eng-1', 'task-1', 2500, 1500),
      taskRow('eng-1', 'task-1', 1000, 1000),
      taskRow('eng-2', 'task-1', 3000, 2000),
      taskRow('eng-2', 'task-1', 500, 500),
    ]
    const { meter } = meterWith(rows)
    const entry1 = meter.used(
      'eng-1',
      { measure: 'tokens', window: 'day' },
      { taskId: 'task-1', dayKey: DAY },
    )
    const entry2 = meter.used(
      'eng-2',
      { measure: 'tokens', window: 'day' },
      { taskId: 'task-1', dayKey: DAY },
    )
    expect(entry1).toEqual({ value: 9000, estimated: false })
    expect(entry2).toEqual({ value: 6000, estimated: false })
    const totals = sumTeamTotals(rows, { dayKey: DAY })
    expect(totals.tokens).toBe(15_000)
    expect(totals.estimatedTokens).toBe(0)
    expect(totals.tasks).toBe(5)
  })

  it('labels measured counts estimated where the agent reports nothing', () => {
    const rows = [taskRow('eng-1', 'task-1', 1000, 500, { estimated: true })]
    const { meter } = meterWith(rows)
    expect(
      meter.used('eng-1', { measure: 'tokens', window: 'day' }, { taskId: 'task-1', dayKey: DAY }),
    ).toEqual({ value: 1500, estimated: true })
    // Reported rows stay reported: the estimate never wins over a reported figure.
    const mixed = [
      taskRow('eng-1', 'task-1', 1000, 500, { estimated: true }),
      taskRow('eng-1', 'task-2', 1000, 500, { estimated: false }),
    ]
    const mixedMeter = meterWith(mixed).meter
    const input = mixedMeter.used(
      'eng-1',
      { measure: 'inputTokens', window: 'day' },
      { taskId: 'task-2', dayKey: DAY },
    )
    expect(input.value).toBe(2000)
  })

  it('sums each measure in each window: task, day and lifetime', () => {
    const otherDay = teamDayKey(1_000_000 + 86_400_000)
    const rows = [
      taskRow('eng-1', 'task-1', 1000, 500),
      taskRow('eng-1', 'task-2', 2000, 500, { dayKey: otherDay }),
    ]
    const { meter } = meterWith(rows)
    const scope = { taskId: 'task-1', dayKey: DAY }
    expect(meter.used('eng-1', { measure: 'tokens', window: 'task' }, scope).value).toBe(1500)
    expect(meter.used('eng-1', { measure: 'tokens', window: 'day' }, scope).value).toBe(1500)
    expect(
      meter.used('eng-1', { measure: 'tokens', window: 'lifetime' }, { ...scope, dayKey: otherDay })
        .value,
    ).toBe(4000)
    expect(meter.used('eng-1', { measure: 'inputTokens', window: 'day' }, scope).value).toBe(1000)
    expect(meter.used('eng-1', { measure: 'outputTokens', window: 'day' }, scope).value).toBe(500)
    expect(meter.used('eng-1', { measure: 'tasks', window: 'day' }, scope).value).toBe(1)
    expect(meter.used('eng-1', { measure: 'tasks', window: 'lifetime' }, scope).value).toBe(2)
  })

  it('counts retention rollups, so a spent lifetime cap never refills when task rows age out', () => {
    const rows: TeamMeterRow[] = [
      {
        kind: 'totals',
        entryId: 'eng-1',
        agentKey: 'agent',
        roleId: 'engineering',
        taskId: 'totals:eng-1:old',
        dayKey: '2026-01-01',
        startMs: 100,
        usage: usage({ inputTokens: 1_000_000, outputTokens: 500_000, tasks: 40 }),
        estimated: false,
      },
    ]
    const { meter } = meterWith(rows)
    expect(
      meter.used('eng-1', { measure: 'tokens', window: 'lifetime' }, { taskId: 't', dayKey: DAY })
        .value,
    ).toBe(1_500_000)
  })

  it('reset clears exactly the window it names, and the ledger keeps the record', () => {
    const reset = resetLedgerRow({
      workspaceId: 'ws',
      entryId: 'eng-1',
      window: 'lifetime',
      clearedEntryId: 'eng-1',
      startMs: 2_000_000,
    })
    const rows: TeamMeterRow[] = [
      taskRow('eng-1', 'old', 1000, 500, { startMs: 1_000_000 }),
      {
        kind: 'reset',
        entryId: 'eng-1',
        agentKey: '',
        roleId: '',
        taskId: reset.taskId,
        dayKey: DAY,
        startMs: reset.startMs,
        usage: ZERO_TEAM_METER_USAGE,
        estimated: false,
        clearedWindow: 'lifetime',
        clearedEntryId: 'eng-1',
      },
      taskRow('eng-1', 'new', 100, 50, { startMs: 3_000_000 }),
    ]
    const { meter } = meterWith(rows)
    // The lifetime window counts only rows after the reset…
    expect(
      meter.used('eng-1', { measure: 'tokens', window: 'lifetime' }, { taskId: 'new', dayKey: DAY })
        .value,
    ).toBe(150)
    // …while the day window (a different window) is untouched by it.
    expect(
      meter.used('eng-1', { measure: 'tokens', window: 'day' }, { taskId: 'new', dayKey: DAY })
        .value,
    ).toBe(1650)
  })

  it('a task past its minutes is stopped', () => {
    expect(TeamMeter.isTaskOverdue(1_000_000, 30, 1_000_000 + 29 * 60 * 1000)).toBe(false)
    expect(TeamMeter.isTaskOverdue(1_000_000, 30, 1_000_000 + 30 * 60 * 1000)).toBe(true)
  })

  it('reservations: written before the request is sent, and reported usage replaces them', async () => {
    const journal = new FakeTeamJournal()
    const meter = new TeamMeter({ rows: () => [], openReservations: () => [] })
    const admitted = await checkAndReserve(meter, journal, {
      ...REQUEST,
      caps: [{ measure: 'tokens', window: 'day', amount: 10_000 }],
    })
    expect(admitted.ok).toBe(true)
    expect(journal.calls).toEqual(['claim', 'check'])

    // The open reservation counts, so a second request past the cap is refused and reserves nothing.
    const metered = new TeamMeter({
      rows: () => [],
      openReservations: () => [
        {
          id: 'res-1',
          dayKey: DAY,
          startMs: 1_000_000,
          workspaceId: 'ws',
          entryId: 'eng-1',
          agentKey: 'opus',
          taskId: 'task-1',
          tokens: 9000,
          inputTokens: 9000,
          outputTokens: 0,
          spendUsd: 0.5,
        },
      ],
    })
    const refused = await checkAndReserve(metered, journal, {
      ...REQUEST,
      caps: [{ measure: 'tokens', window: 'day', amount: 10_000 }],
      tokens: 2000,
      inputTokens: 2000,
      spendUsd: 0.1,
    })
    expect(refused.ok).toBe(false)
    if (refused.ok) throw new Error('unreachable')
    expect(refused.used).toBe(9000)
    expect(journal.calls).toEqual(['claim', 'check'])

    // Reported usage settles the reservation; a sent request with no usage keeps its liability.
    if (!admitted.ok) throw new Error('unreachable')
    await settleTeamReservation(journal, admitted.reservation.id, {
      kind: 'reported',
      tokens: 8500,
      inputTokens: 8500,
      outputTokens: 0,
      spendUsd: 0.45,
    })
    // A different request without reported usage keeps its whole reservation.
    const unknown = await journal.claim({ ...admitted.reservation, taskId: 'unknown' })
    await settleTeamReservation(journal, unknown.reservation.id, { kind: 'unknown' })
    expect(journal.calls).toContain('settle:liability')
    const open = await journal.open()
    expect(open.map((held) => held.id)).toEqual([unknown.reservation.id])
  })

  it('two windows reserve against the same day headroom, and only one is admitted', async () => {
    const journal = new FakeTeamJournal()
    // Both windows read the same workspace scope: the second sees the first's reservation.
    const held: { id: string }[] = []
    const openOf = () =>
      held.map((r) => ({
        id: r.id,
        dayKey: DAY,
        startMs: 1_000_000,
        workspaceId: 'ws',
        entryId: 'eng-1',
        agentKey: 'opus',
        taskId: 'a',
        tokens: 9000,
        inputTokens: 9000,
        outputTokens: 0,
        spendUsd: 0.5,
      }))
    const windowA = new TeamMeter({ rows: emptyScope, openReservations: openOf })
    const windowB = new TeamMeter({ rows: emptyScope, openReservations: openOf })
    const caps = [{ measure: 'tokens' as const, window: 'day' as const, amount: 10_000 }]
    const first = await checkAndReserve(windowA, journal, {
      ...REQUEST,
      taskId: 'a',
      caps,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('unreachable')
    held.push({ id: first.reservation.id })
    const second = await checkAndReserve(windowB, journal, {
      ...REQUEST,
      taskId: 'b',
      caps,
    })
    expect(second.ok).toBe(false)
    expect(journal.calls).toEqual(['claim', 'check'])
  })

  it('team totals keep estimated, hook-added and paid-tool lines apart', () => {
    const rows = [
      taskRow('eng-1', 't1', 1000, 500, {
        usage: usage({
          inputTokens: 1000,
          outputTokens: 500,
          tasks: 1,
          hookTokens: 200,
          paidToolTokens: 50,
          costUsd: 0.01,
        }),
      }),
      taskRow('eng-2', 't2', 2000, 1000, {
        estimated: true,
        usage: usage({ inputTokens: 2000, outputTokens: 1000, tasks: 1, costUsd: 0.02 }),
      }),
    ]
    const totals = sumTeamTotals(rows, { dayKey: DAY })
    expect(totals).toEqual({
      tokens: 4500,
      costUsd: 0.03,
      tasks: 2,
      estimatedTokens: 3000,
      hookTokens: 200,
      paidToolTokens: 50,
    })
  })

  it('an old open liability stays in lifetime and its own day, while reset never refunds it', async () => {
    const journal = new FakeTeamJournal()
    const reservation = await journal.claim({
      workspaceId: 'ws',
      entryId: 'eng-1',
      agentKey: 'meta',
      taskId: 'old',
      tokens: 9000,
      inputTokens: 9000,
      outputTokens: 0,
      spendUsd: 0.5,
      startMs: 1_000_000,
      dayKey: DAY,
    })
    const held = await journal.open()
    const next = teamDayKey(1_000_000 + 86_400_000)
    const reset: TeamMeterRow = {
      ...taskRow('eng-1', 'reset', 0, 0),
      kind: 'reset',
      clearedWindow: 'lifetime',
      clearedEntryId: 'eng-1',
      startMs: 1_000_001,
    }
    const meter = new TeamMeter({ rows: () => [reset], openReservations: () => held })
    expect(
      meter.used('eng-1', { measure: 'tokens', window: 'day' }, { taskId: 'new', dayKey: next })
        .value,
    ).toBe(0)
    expect(
      meter.used(
        'eng-1',
        { measure: 'tokens', window: 'lifetime' },
        { taskId: 'new', dayKey: next },
      ).value,
    ).toBe(9000)
    expect(
      meter.used('eng-1', { measure: 'tokens', window: 'day' }, { taskId: 'old', dayKey: DAY })
        .value,
    ).toBe(9000)
    const durable = await journal.lookupByClaimId(reservation.reservation.id)
    expect(durable?.outcome).toBeUndefined()
  })

  it('open input and output liabilities count their own components', async () => {
    const journal = new FakeTeamJournal()
    await journal.claim({
      workspaceId: 'ws',
      entryId: 'eng-1',
      agentKey: 'meta',
      taskId: 'task',
      tokens: 9000,
      inputTokens: 8000,
      outputTokens: 1000,
      spendUsd: 0.5,
      startMs: 1_000_000,
      dayKey: DAY,
    })
    const held = await journal.open()
    const meter = new TeamMeter({ rows: () => [], openReservations: () => held })
    const scope = { taskId: 'task', dayKey: DAY }
    expect(meter.used('eng-1', { measure: 'inputTokens', window: 'day' }, scope)).toEqual({
      value: 8000,
      estimated: true,
    })
    expect(meter.used('eng-1', { measure: 'outputTokens', window: 'day' }, scope)).toEqual({
      value: 1000,
      estimated: true,
    })
  })
})
