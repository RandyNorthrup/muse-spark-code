import { describe, expect, it } from 'vitest'
import { advanceFakeTeamDay, refundedTeamOutcome } from './helpers/teamFakes'
import { settleTeamJournalClaim, type TeamSettlementClaims } from '../../src/host/team/teamJournal'

// Test-only model of lane A's five-operation D78 contract at 8901ea1b.
// Shared state survives reconstruction; permanent intents are never removed.
const DAY = '2026-10-05'
const NEXT_DAY = '2026-10-06'
const REQUEST = {
  workspaceId: 'workspace',
  entryId: 'entry',
  agentKey: 'agent',
  taskId: 'task',
  dayKey: DAY,
  startMs: 1000,
  tokens: 1000,
  inputTokens: 800,
  outputTokens: 200,
  spendUsd: 1,
}
const REPORTED = {
  kind: 'reported',
  tokens: 200,
  inputTokens: 100,
  outputTokens: 100,
  spendUsd: 0.2,
} as const
const BUDGETS = {
  paidDailyBudgetUsd: 4,
  teamDailyBudgetUsd: 2,
  teamDailyBudgetTokens: 2000,
  workspaceDailyBudgetUsd: 2,
  workspaceDailyBudgetTokens: 2000,
}
type Record = NonNullable<Awaited<ReturnType<TeamSettlementClaims['lookupByClaimId']>>> & {
  readonly reservation: typeof REQUEST & { readonly id: string }
}
type Outcome = NonNullable<Record['outcome']>
const fields = ['kind', 'tokens', 'inputTokens', 'outputTokens', 'spendUsd'] as const

function sum(
  records: readonly Record[],
  measure: 'tokens' | 'inputTokens' | 'outputTokens' | 'spendUsd',
) {
  return records.reduce((total, row) => total + (row.outcome ?? row.reservation)[measure], 0)
}

class MemoryClaims implements TeamSettlementClaims {
  public readonly calls: string[] = []
  public constructor(
    public readonly state = {
      records: new Map<string, Record>(),
      otherPaidUsd: new Map<string, number>(),
      latest: '',
      next: 1,
    },
    private readonly shouldLoseAck = false,
  ) {}
  private finish(id: string, outcome: Outcome): Promise<void> {
    const claim = this.state.records.get(id)
    if (claim === undefined) return Promise.reject(new Error('Missing claim'))
    const previous = claim.outcome
    if (previous !== undefined && fields.some((field) => previous[field] !== outcome[field]))
      return Promise.reject(new Error('Conflicting outcome'))
    this.state.records.set(id, { ...claim, outcome: Object.freeze({ ...outcome }) })
    return this.shouldLoseAck
      ? Promise.reject(new Error('Lost acknowledgement'))
      : Promise.resolve()
  }
  public latestDay(candidate: string): Promise<string> {
    return advanceFakeTeamDay(this.state, candidate)
  }
  public claim(request: typeof REQUEST) {
    const reservation = Object.freeze({ ...request, id: `claim-${String(this.state.next++)}` })
    this.state.records.set(reservation.id, { reservation })
    this.calls.push('claim')
    return Promise.resolve({
      reservation,
      check: (limits: {
        budgets: typeof BUDGETS
        caps: readonly {
          measure: 'tokens' | 'inputTokens' | 'outputTokens' | 'spendUsd' | 'tasks'
          window: 'day' | 'task' | 'lifetime'
          amount: number
        }[]
      }) => {
        const own = this.state.records.get(reservation.id)
        if (
          own === undefined ||
          own.outcome !== undefined ||
          reservation.dayKey !== this.state.latest
        )
          throw new Error('Closed or obsolete claim')
        const rows = Array.from(this.state.records, ([, record]) => record)
        const day = rows.filter((row) => row.reservation.dayKey === reservation.dayKey)
        const workspace = day.filter(
          (row) => row.reservation.workspaceId === reservation.workspaceId,
        )
        const checks = [
          [
            sum(day, 'spendUsd') + (this.state.otherPaidUsd.get(reservation.dayKey) ?? 0),
            limits.budgets.paidDailyBudgetUsd,
            'paid',
            'spendUsd',
          ],
          [sum(day, 'spendUsd'), limits.budgets.teamDailyBudgetUsd, 'team', 'spendUsd'],
          [sum(day, 'tokens'), limits.budgets.teamDailyBudgetTokens, 'team', 'tokens'],
          [
            sum(workspace, 'spendUsd'),
            limits.budgets.workspaceDailyBudgetUsd,
            'workspace',
            'spendUsd',
          ],
          [
            sum(workspace, 'tokens'),
            limits.budgets.workspaceDailyBudgetTokens,
            'workspace',
            'tokens',
          ],
        ] as const
        for (const [used, amount, scope, measure] of checks)
          if (amount === 0 || used > amount)
            return { ok: false, scope, measure, window: 'day', used, amount } as const
        for (const cap of limits.caps) {
          const scope = rows.filter(
            (row) =>
              row.outcome?.kind !== 'refunded' &&
              row.reservation.workspaceId === reservation.workspaceId &&
              row.reservation.entryId === reservation.entryId &&
              (cap.window !== 'day' || row.reservation.dayKey === reservation.dayKey) &&
              (cap.window !== 'task' || row.reservation.taskId === reservation.taskId),
          )
          const used =
            cap.measure === 'tasks'
              ? new Set(scope.map((row) => row.reservation.taskId)).size
              : sum(scope, cap.measure)
          if (used > cap.amount)
            return {
              ok: false,
              measure: cap.measure,
              window: cap.window,
              used,
              amount: cap.amount,
            } as const
        }
        return { ok: true } as const
      },
    })
  }
  public settle(id: string, outcome: Parameters<TeamSettlementClaims['settle']>[1]) {
    this.calls.push('settle')
    return this.finish(id, outcome)
  }
  public refund(id: string) {
    this.calls.push('refund')
    return this.finish(id, refundedTeamOutcome())
  }
  public lookupByClaimId(id: string): Promise<Record | undefined> {
    this.calls.push('lookup')
    return Promise.resolve(this.state.records.get(id))
  }
}

async function claim(journal: MemoryClaims, request = REQUEST) {
  const dayKey = await journal.latestDay(request.dayKey)
  return await journal.claim({ ...request, dayKey })
}

describe('M96 K injected D78 settlement', () => {
  it.each(['reported', 'nonsent'] as const)(
    'finds a lost %s acknowledgement after restart without another charge or credit',
    async (kind) => {
      const journal = new MemoryClaims(undefined, true)
      const first = await claim(journal)
      const outcome = kind === 'reported' ? REPORTED : ({ kind: 'nonsent' } as const)
      await expect(settleTeamJournalClaim(journal, first.reservation.id, outcome)).rejects.toThrow(
        'Lost acknowledgement',
      )
      expect(journal.calls).toContain(kind === 'nonsent' ? 'refund' : 'settle')
      const restarted = new MemoryClaims(journal.state)
      await settleTeamJournalClaim(restarted, first.reservation.id, outcome)
      expect(restarted.calls).toEqual(['lookup'])
      expect(journal.state.records.size).toBe(1)
      const recorded = await restarted.lookupByClaimId(first.reservation.id)
      expect(recorded?.outcome).toMatchObject({
        kind: kind === 'reported' ? 'reported' : 'refunded',
      })
      const next = await claim(restarted, {
        ...REQUEST,
        tokens: 1800,
        inputTokens: 1600,
        spendUsd: 1.8,
      })
      expect(next.check({ budgets: BUDGETS, caps: [] }).ok).toBe(true)
    },
  )
  it('retains an unacknowledged intent and the whole unknown allowance; conflicts never refund it', async () => {
    const journal = new MemoryClaims()
    const first = await claim(journal)
    const restarted = new MemoryClaims(journal.state)
    expect(await restarted.lookupByClaimId(first.reservation.id)).toEqual({
      reservation: first.reservation,
    })
    await settleTeamJournalClaim(restarted, first.reservation.id, { kind: 'unknown' })
    await settleTeamJournalClaim(restarted, first.reservation.id, { kind: 'unknown' })
    expect(restarted.calls.filter((call) => call === 'settle')).toHaveLength(1)
    const recorded = await restarted.lookupByClaimId(first.reservation.id)
    expect(recorded?.outcome).toMatchObject({
      kind: 'liability',
      tokens: 1000,
      inputTokens: 800,
      outputTokens: 200,
      spendUsd: 1,
    })
    await expect(
      settleTeamJournalClaim(restarted, first.reservation.id, { kind: 'nonsent' }),
    ).rejects.toThrow('TEAM_CLAIM_CONFLICT')
    const next = await claim(restarted, { ...REQUEST, tokens: 1001 })
    expect(next.check({ budgets: BUDGETS, caps: [] }).ok).toBe(false)
  })
  it('settles before-midnight claims to their own day and keeps latest day on clock rollback', async () => {
    const journal = new MemoryClaims()
    const first = await claim(journal)
    const tomorrow = await claim(journal, { ...REQUEST, dayKey: NEXT_DAY })
    expect(() => first.check({ budgets: BUDGETS, caps: [] })).toThrow('obsolete')
    await settleTeamJournalClaim(journal, first.reservation.id, REPORTED)
    const restarted = new MemoryClaims(journal.state)
    expect(await restarted.latestDay(DAY)).toBe(NEXT_DAY)
    const recorded = await restarted.lookupByClaimId(first.reservation.id)
    expect(recorded?.reservation.dayKey).toBe(DAY)
    expect(tomorrow.check({ budgets: BUDGETS, caps: [] }).ok).toBe(true)
  })
  it('two windows share team and other-paid spend; lowered limits refuse dispatch without losing existing claims', async () => {
    const one = new MemoryClaims()
    const two = new MemoryClaims(one.state)
    const [first, second] = await Promise.all([
      claim(one),
      claim(two, { ...REQUEST, workspaceId: 'other' }),
    ])
    expect(first.check({ budgets: BUDGETS, caps: [] }).ok).toBe(true)
    const third = await claim(two, { ...REQUEST, workspaceId: 'third' })
    expect(third.check({ budgets: BUDGETS, caps: [] })).toMatchObject({ ok: false, scope: 'team' })
    await settleTeamJournalClaim(two, third.reservation.id, { kind: 'nonsent' })
    expect(second.check({ budgets: { ...BUDGETS, teamDailyBudgetUsd: 1 }, caps: [] }).ok).toBe(
      false,
    )
    expect(one.state.records.size).toBe(3)
    await settleTeamJournalClaim(two, second.reservation.id, { kind: 'nonsent' })
    one.state.otherPaidUsd.set(DAY, 4)
    expect(first.check({ budgets: BUDGETS, caps: [] }).ok).toBe(false)
    const recorded = await one.lookupByClaimId(first.reservation.id)
    expect(recorded?.outcome).toBeUndefined()
  })
  it('refuses missing or mismatched ids and every conflicting outcome component', async () => {
    const journal = new MemoryClaims()
    const first = await claim(journal)
    journal.state.records.set('wrong', { reservation: first.reservation })
    await expect(settleTeamJournalClaim(journal, 'wrong', REPORTED)).rejects.toThrow(
      'TEAM_CLAIM_UNAVAILABLE',
    )
    await expect(settleTeamJournalClaim(journal, 'missing', REPORTED)).rejects.toThrow(
      'TEAM_CLAIM_UNAVAILABLE',
    )
    await settleTeamJournalClaim(journal, first.reservation.id, REPORTED)
    for (const measure of ['tokens', 'inputTokens', 'outputTokens', 'spendUsd'] as const)
      await expect(
        settleTeamJournalClaim(journal, first.reservation.id, { ...REPORTED, [measure]: 0 }),
      ).rejects.toThrow('TEAM_CLAIM_CONFLICT')
    const sameUsage = await claim(journal, {
      ...REQUEST,
      tokens: REPORTED.tokens,
      inputTokens: REPORTED.inputTokens,
      outputTokens: REPORTED.outputTokens,
      spendUsd: REPORTED.spendUsd,
    })
    await settleTeamJournalClaim(journal, sameUsage.reservation.id, REPORTED)
    await expect(
      settleTeamJournalClaim(journal, sameUsage.reservation.id, { kind: 'unknown' }),
    ).rejects.toThrow('TEAM_CLAIM_CONFLICT')
  })
})
