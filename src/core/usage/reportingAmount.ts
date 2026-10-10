import type { UsdAmount } from '../../shared/usd'
import type { SessionBudgetTotal } from '../backends/modelapi/sessionBudget'
import type { UsageBudgetRead } from './usageService'

/** The captured usage-report schemas use numbers; this projection never admits spending. */
export function reportingAmount(amount: UsdAmount): number {
  const value = Number(amount)
  if (!Number.isFinite(value)) throw new Error('Nonfinite USD reporting projection')
  return value
}

/**
 * Today's shared-daily-budget read: the day scope, the ledger total and the
 * next-midnight reset are identical in VS Code and the standalone runtime
 * (RVCM1132B finding 3); only the cap policy differs per caller, so it stays
 * a parameter. The ledger read never seeds an unopened journal.
 */
export async function paidDailyToday(input: {
  readonly readExisting: (
    scope: string,
    accountId: string,
  ) => Promise<(SessionBudgetTotal & { readonly uncertainUsd?: UsdAmount }) | undefined>
  readonly accountId: string
  readonly scope: string
  readonly now: number
  readonly capUsd: number
  readonly stopped: boolean
  readonly raisedToday?: boolean | undefined
}): Promise<readonly UsageBudgetRead[]> {
  const total = await input.readExisting(input.scope, input.accountId)
  const reset = new Date(input.now)
  reset.setHours(0, 0, 0, 0)
  reset.setDate(reset.getDate() + 1)
  return [
    paidDailyBudgetRead({
      id: input.scope,
      spentUsd: Number(total?.spentUsd ?? 0),
      ...(total?.uncertainUsd !== undefined && {
        uncertainUsd: reportingAmount(total.uncertainUsd),
      }),
      capUsd: input.capUsd,
      stopped: input.stopped,
      ...(input.raisedToday !== undefined && { raisedToday: input.raisedToday }),
      resetsAt: reset.getTime(),
    }),
  ]
}

/**
 * One shared-daily-budget Limits row: VS Code's daily reader and the
 * standalone runtime's reader report the same shape (RVCM1132B finding 3),
 * so the two call sites share this constructor instead of repeating it.
 */
export function paidDailyBudgetRead(input: {
  readonly id: string
  readonly spentUsd: number
  readonly uncertainUsd?: number | undefined
  readonly capUsd: number
  readonly stopped: boolean
  readonly raisedToday?: boolean | undefined
  readonly resetsAt: number
}): UsageBudgetRead {
  return {
    budget: {
      id: input.id,
      kind: 'paidDaily',
      spentUsd: input.spentUsd,
      ...(input.uncertainUsd !== undefined && { uncertainUsd: input.uncertainUsd }),
      capUsd: input.capUsd,
      stopped: input.stopped,
      ...(input.raisedToday !== undefined && { raisedToday: input.raisedToday }),
      resetsAt: input.resetsAt,
    },
  }
}
