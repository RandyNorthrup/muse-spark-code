import { describe, expect, it } from 'vitest'
import {
  checkAndReserve,
  settleTeamReservation,
  TeamMeter,
  type TeamClaimOutcome,
  type TeamDailyBudgets,
} from '../../src/core/team/teamMeter'
import { FakeTeamJournal } from './helpers/teamFakes'
import { UI_TEXT } from '../../src/shared/constants'

const DAY = '2026-10-05'
const NEXT_DAY = '2026-10-06'
const BUDGETS: TeamDailyBudgets = {
  paidDailyBudgetUsd: 50,
  teamDailyBudgetUsd: 50,
  teamDailyBudgetTokens: 25_000_000,
  workspaceDailyBudgetUsd: 10,
  workspaceDailyBudgetTokens: 5_000_000,
}
const REQUEST = {
  workspaceId: 'ws',
  entryId: 'eng-1',
  agentKey: 'meta',
  taskId: 'task-1',
  tokens: 9000,
  inputTokens: 9000,
  outputTokens: 0,
  spendUsd: 0.5,
  startMs: 1_000_000,
  dayKey: DAY,
  caps: [{ measure: 'tokens', window: 'day', amount: 10_000 }],
  budgets: () => BUDGETS,
} as const
const emptyMeter = () => new TeamMeter({ rows: () => [], openReservations: () => [] })

class LostAckJournal extends FakeTeamJournal {
  public override async settle(
    id: string,
    outcome: Exclude<TeamClaimOutcome, { readonly kind: 'refunded' }>,
  ): Promise<void> {
    await super.settle(id, outcome)
    throw new Error('Acknowledgement lost')
  }
  public override async refund(id: string): Promise<void> {
    await super.refund(id)
    throw new Error('Acknowledgement lost')
  }
}

class WrongLookupJournal extends FakeTeamJournal {
  public override lookupByClaimId(_id: string) {
    return super.lookupByClaimId('res-1')
  }
}

describe('team D78 claim adapter', () => {
  it('a missing published intent refuses the final dispatch check', async () => {
    const journal = new FakeTeamJournal()
    const admitted = await checkAndReserve(emptyMeter(), journal, REQUEST)
    if (!admitted.ok) throw new Error('unreachable')
    journal.state.claims.delete(admitted.reservation.id)
    expect(admitted.check).toThrow('Claim closed or day obsolete')
  })

  it('zero in any daily budget stops even a zero-valued request', async () => {
    for (const name of Object.keys(BUDGETS)) {
      const journal = new FakeTeamJournal()
      const stopped = await checkAndReserve(emptyMeter(), journal, {
        ...REQUEST,
        tokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        spendUsd: 0,
        budgets: () => ({ ...BUDGETS, [name]: 0 }),
      })
      expect(stopped).toMatchObject({ ok: false, amount: 0 })
      expect(journal.calls).toContain('refund')
    }
  })

  it('reported input and output replace their own allowances; requests never count as more tasks', async () => {
    const journal = new FakeTeamJournal()
    const caps = [
      { measure: 'inputTokens', window: 'day', amount: 1000 },
      { measure: 'outputTokens', window: 'day', amount: 500 },
      { measure: 'tasks', window: 'day', amount: 1 },
    ] as const
    const first = await checkAndReserve(emptyMeter(), journal, {
      ...REQUEST,
      tokens: 1100,
      inputTokens: 800,
      outputTokens: 300,
      caps,
    })
    if (!first.ok) throw new Error('unreachable')
    await settleTeamReservation(journal, first.reservation.id, {
      kind: 'reported',
      tokens: 500,
      inputTokens: 400,
      outputTokens: 100,
      spendUsd: 0.1,
    })
    const next = await checkAndReserve(emptyMeter(), journal, {
      ...REQUEST,
      tokens: 1000,
      inputTokens: 600,
      outputTokens: 400,
      caps,
    })
    expect(next.ok).toBe(true)
    const tooMuch = await checkAndReserve(emptyMeter(), journal, {
      ...REQUEST,
      tokens: 100,
      inputTokens: 100,
      outputTokens: 0,
      caps,
    })
    expect(tooMuch).toMatchObject({ ok: false, measure: 'inputTokens' })
    const local = new TeamMeter({
      rows: () => [
        {
          kind: 'task',
          taskId: REQUEST.taskId,
          entryId: REQUEST.entryId,
          agentKey: REQUEST.agentKey,
          roleId: 'engineering',
          dayKey: DAY,
          startMs: REQUEST.startMs,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            reasoningTokens: 0,
            calls: 0,
            tasks: 1,
            costUsd: 0,
            hookTokens: 0,
            paidToolTokens: 0,
          },
          estimated: false,
        },
      ],
      openReservations: () => [],
    })
    const withinTask = await checkAndReserve(local, new FakeTeamJournal(), {
      ...REQUEST,
      caps: [{ measure: 'tasks', window: 'day', amount: 1 }],
    })
    expect(withinTask.ok).toBe(true)
  })

  it('publishes the intent before checking or dispatching and rereads lowered budgets at dispatch', async () => {
    const journal = new FakeTeamJournal()
    let budgets = BUDGETS
    const result = await checkAndReserve(emptyMeter(), journal, {
      ...REQUEST,
      budgets: () => budgets,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(journal.calls).toEqual(['claim', 'check'])
    expect(result.check()).toEqual({ ok: true })
    budgets = { ...budgets, paidDailyBudgetUsd: 0.4 }
    expect(result.check()).toMatchObject({ ok: false, scope: 'paid', used: 0.5, amount: 0.4 })
    const held = await journal.open()
    expect(held).toHaveLength(1)
    await settleTeamReservation(journal, result.reservation.id, { kind: 'nonsent' })
    expect(await journal.open()).toEqual([])
  })

  it('two stale windows publish concurrently; the complete scope prevents a cap overrun', async () => {
    const journal = new FakeTeamJournal()
    const outcomes = await Promise.all([
      checkAndReserve(emptyMeter(), journal, REQUEST),
      checkAndReserve(emptyMeter(), new FakeTeamJournal(journal.state), {
        ...REQUEST,
        taskId: 'task-2',
      }),
    ])
    expect(outcomes.filter((result) => result.ok).length).toBeLessThanOrEqual(1)
    const open = await journal.open()
    expect(open.reduce((sum, claim) => sum + claim.tokens, 0)).toBeLessThanOrEqual(10_000)
    for (const claim of open) await settleTeamReservation(journal, claim.id, { kind: 'nonsent' })
    const retry = await checkAndReserve(emptyMeter(), journal, REQUEST)
    expect(retry.ok).toBe(true)
  })

  it('team and paid budgets aggregate all workspaces while workspace limits remain separate', async () => {
    const journal = new FakeTeamJournal()
    const first = await checkAndReserve(emptyMeter(), journal, REQUEST)
    if (!first.ok) throw new Error('unreachable')
    await settleTeamReservation(journal, first.reservation.id, {
      kind: 'reported',
      tokens: 8000,
      inputTokens: 8000,
      outputTokens: 0,
      spendUsd: 0.4,
    })
    const budgets = { ...BUDGETS, teamDailyBudgetUsd: 0.8 }
    const refused = await checkAndReserve(emptyMeter(), journal, {
      ...REQUEST,
      workspaceId: 'other',
      budgets: () => budgets,
    })
    expect(refused).toMatchObject({ ok: false, scope: 'team', used: 0.9 })
    journal.state.otherPaidUsd.set(DAY, 49.2)
    expect(
      await checkAndReserve(emptyMeter(), journal, { ...REQUEST, workspaceId: 'other' }),
    ).toMatchObject({ ok: false, scope: 'paid' })
    journal.state.otherPaidUsd.clear()
    const other = await checkAndReserve(emptyMeter(), journal, { ...REQUEST, workspaceId: 'other' })
    expect(other.ok).toBe(true)
  })

  it.each([
    { workspaceDailyBudgetUsd: 0.4 },
    { workspaceDailyBudgetTokens: 8000 },
    { teamDailyBudgetTokens: 8000 },
    { paidDailyBudgetUsd: 0 },
  ])('refuses and durably refunds a request exceeding %j', async (limits) => {
    const journal = new FakeTeamJournal()
    const result = await checkAndReserve(emptyMeter(), journal, {
      ...REQUEST,
      budgets: () => ({ ...BUDGETS, ...limits }),
    })
    expect(result.ok).toBe(false)
    expect(journal.calls).toEqual(['claim', 'check', 'refund'])
    expect(await journal.lookupByClaimId('res-1')).toMatchObject({
      outcome: { kind: 'refunded', tokens: 0, spendUsd: 0 },
    })
  })

  it('a reported outcome replaces the reservation after restart and is never charged twice', async () => {
    const journal = new LostAckJournal()
    const first = await checkAndReserve(emptyMeter(), journal, REQUEST)
    if (!first.ok) throw new Error('unreachable')
    const outcome = {
      kind: 'reported',
      tokens: 8000,
      inputTokens: 8000,
      outputTokens: 0,
      spendUsd: 0.4,
    } as const
    await expect(settleTeamReservation(journal, first.reservation.id, outcome)).rejects.toThrow(
      'Acknowledgement lost',
    )
    const restarted = new FakeTeamJournal(journal.state)
    await settleTeamReservation(restarted, first.reservation.id, outcome)
    expect(restarted.calls).toEqual(['lookupByClaimId'])
    expect(await restarted.open()).toEqual([])
    const next = await checkAndReserve(emptyMeter(), restarted, {
      ...REQUEST,
      tokens: 2000,
      inputTokens: 2000,
      outputTokens: 0,
    })
    expect(next.ok).toBe(true)
    if (!next.ok) throw new Error('unreachable')
    expect(next.check()).toEqual({ ok: true })
    await expect(
      settleTeamReservation(restarted, first.reservation.id, { ...outcome, spendUsd: 0 }),
    ).rejects.toThrow()
  })

  it('a lost refund acknowledgement is found by id after restart without another credit', async () => {
    const journal = new LostAckJournal()
    const first = await checkAndReserve(emptyMeter(), journal, REQUEST)
    if (!first.ok) throw new Error('unreachable')
    await expect(
      settleTeamReservation(journal, first.reservation.id, { kind: 'nonsent' }),
    ).rejects.toThrow('Acknowledgement lost')
    const restarted = new FakeTeamJournal(journal.state)
    await settleTeamReservation(restarted, first.reservation.id, { kind: 'nonsent' })
    expect(restarted.calls).toEqual(['lookupByClaimId'])
    expect(await restarted.lookupByClaimId(first.reservation.id)).toMatchObject({
      outcome: { kind: 'refunded' },
    })
    const retry = await checkAndReserve(emptyMeter(), restarted, REQUEST)
    expect(retry.ok).toBe(true)
  })

  it('no receipt retains full liability, and unknown settlement never credits zero', async () => {
    const journal = new FakeTeamJournal()
    const first = await checkAndReserve(emptyMeter(), journal, REQUEST)
    if (!first.ok) throw new Error('unreachable')
    const restarted = new FakeTeamJournal(journal.state)
    const held = await restarted.open()
    expect(held[0]?.tokens).toBe(9000)
    await settleTeamReservation(restarted, first.reservation.id, { kind: 'unknown' })
    expect(await restarted.lookupByClaimId(first.reservation.id)).toMatchObject({
      outcome: {
        kind: 'liability',
        tokens: 9000,
        inputTokens: 9000,
        outputTokens: 0,
        spendUsd: 0.5,
      },
    })
    await settleTeamReservation(restarted, first.reservation.id, { kind: 'unknown' })
    expect(restarted.calls.filter((call) => call === 'settle:liability')).toHaveLength(1)
    const blocked = await checkAndReserve(emptyMeter(), restarted, {
      ...REQUEST,
      tokens: 2000,
      inputTokens: 2000,
      outputTokens: 0,
    })
    expect(blocked.ok).toBe(false)
    await expect(
      settleTeamReservation(restarted, first.reservation.id, { kind: 'nonsent' }),
    ).rejects.toThrow()
  })

  it('the durable latest day survives restart and clock rollback; old claims settle to their own day', async () => {
    const journal = new FakeTeamJournal()
    const before = await checkAndReserve(emptyMeter(), journal, REQUEST)
    if (!before.ok) throw new Error('unreachable')
    const after = await checkAndReserve(emptyMeter(), journal, { ...REQUEST, dayKey: NEXT_DAY })
    expect(after.ok).toBe(true)
    expect(() => before.check()).toThrow('day obsolete')
    await settleTeamReservation(journal, before.reservation.id, {
      kind: 'reported',
      tokens: 8000,
      inputTokens: 8000,
      outputTokens: 0,
      spendUsd: 0.4,
    })
    const restarted = new FakeTeamJournal(journal.state)
    const rollback = await checkAndReserve(emptyMeter(), restarted, {
      ...REQUEST,
      tokens: 2000,
      inputTokens: 2000,
      outputTokens: 0,
      dayKey: DAY,
    })
    expect(rollback.ok).toBe(false)
    expect(journal.state.latest).toBe(NEXT_DAY)
    const old = await restarted.lookupByClaimId(before.reservation.id)
    expect(old?.reservation.dayKey).toBe(DAY)
  })

  it('throws on missing storage and refunds a known nonsent claim when final admission throws', async () => {
    const journal = new FakeTeamJournal()
    await expect(settleTeamReservation(journal, 'missing', { kind: 'unknown' })).rejects.toThrow(
      UI_TEXT.sessionBudgetStoreUnavailable,
    )
    await expect(
      checkAndReserve(emptyMeter(), journal, {
        ...REQUEST,
        budgets: () => {
          throw new Error('Ledger unavailable')
        },
      }),
    ).rejects.toThrow('Ledger unavailable')
    expect(await journal.lookupByClaimId('res-1')).toMatchObject({ outcome: { kind: 'refunded' } })
    const wrong = new WrongLookupJournal()
    await checkAndReserve(emptyMeter(), wrong, REQUEST)
    await expect(settleTeamReservation(wrong, 'different-id', { kind: 'unknown' })).rejects.toThrow(
      UI_TEXT.sessionBudgetStoreUnavailable,
    )
  })
})
