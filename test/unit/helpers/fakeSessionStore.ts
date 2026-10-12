import { Usd, sumUsd, isPositiveUsd, type UsdAmount } from '../../../src/shared/usd'
// An in-memory SessionStore for the Model API host tests: what was saved,
// by id, and a switch that makes the next save fail.

import {
  headerOf,
  type SessionStore,
  type StoredSession,
} from '../../../src/core/backends/modelapi/sessionStore'
import type { SessionBudgetTotal } from '../../../src/core/backends/modelapi/sessionBudget'
import { EXEC_USD_DECIMALS, UI_TEXT } from '../../../src/shared/constants'
import { formatUsd as formatExactUsd } from '../../../src/shared/l10n/exactUsd'
import { fill } from '../../../src/shared/l10n/text'

interface MemoryBudget {
  readonly seed: UsdAmount
  hasUnknownHistoricalFees: boolean
  readonly entries: Map<
    string,
    {
      readonly costUsd: UsdAmount
      readonly isUnbounded: boolean
      readonly hasUnknownCost: boolean
      readonly hasUnboundedCost: boolean
      readonly isSettled: boolean
    }
  >
}

function hasUnknownLegacySpending(session: StoredSession): boolean {
  const pending = [session]
  const isTokenTotalKnown = session.budgetSpentUsd !== undefined
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) {
      continue
    }
    const hasFlatFees = current.transcript.some(({ item }) =>
      ['imageGeneration', 'webSearch'].includes(item.paid ?? ''),
    )
    const hasTokens = current.usage.inputTokens + current.usage.outputTokens > 0
    if (hasFlatFees || (!isTokenTotalKnown && hasTokens)) {
      return true
    }
    pending.push(...(current.children ?? []).map((child) => child.session))
  }
  return false
}

function budgetKey(sessionId: string, accountId: string): string {
  return `${accountId}:${sessionId}`
}

export interface MemorySessionStore extends SessionStore {
  readonly saved: Map<string, StoredSession>
  failNextSave: boolean
}

export function memorySessionStore(): MemorySessionStore {
  const saved = new Map<string, StoredSession>()
  const budgets = new Map<string, MemoryBudget>()
  let claims = 0
  const ensure = (sessionId: string, accountId: string): MemoryBudget => {
    const key = budgetKey(sessionId, accountId)
    const existing = budgets.get(key)
    if (existing !== undefined) {
      return existing
    }
    const session = saved.get(sessionId)
    if (session?.accountId !== accountId) {
      throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    }
    const isFreshFork = session.budgetIsFreshFork === true
    if (
      isFreshFork &&
      (session.budgetSpentUsd === undefined ||
        Usd.from(session.budgetSpentUsd).compare(Usd.from(0)) !== 0 ||
        session.forkedFrom === undefined ||
        !/^[A-Za-z0-9_-]+$/.test(session.forkedFrom))
    ) {
      throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    }
    const budget: MemoryBudget = {
      seed: session.budgetSpentUsd ?? Usd.from(0).toAmount(),
      hasUnknownHistoricalFees: !isFreshFork && hasUnknownLegacySpending(session),
      entries: new Map(),
    }
    budgets.set(key, budget)
    return budget
  }
  // Mirrors the journal's round-7 split: settled + unknown is bounded and
  // counted; only unbounded unknowns refuse a capped run.
  const totalFor = (budget: MemoryBudget): SessionBudgetTotal => {
    let spentUsd = budget.seed
    let hasUnknownHistoricalFees = budget.hasUnknownHistoricalFees
    let hasBoundedUnknownCost = false
    for (const entry of budget.entries.values()) {
      spentUsd = sumUsd(spentUsd, entry.costUsd)
      const isUnboundedUnknown =
        entry.hasUnboundedCost || (!entry.isSettled && (entry.hasUnknownCost || entry.isUnbounded))
      hasUnknownHistoricalFees ||= isUnboundedUnknown
      hasBoundedUnknownCost ||= entry.hasUnknownCost && !isUnboundedUnknown
    }
    return {
      spentUsd: Usd.from(spentUsd).toAmount(),
      hasUnknownHistoricalFees,
      ...(hasBoundedUnknownCost && { hasBoundedUnknownCost: true as const }),
    }
  }
  const project = (session: StoredSession): StoredSession => {
    const budget =
      session.accountId === undefined
        ? undefined
        : budgets.get(budgetKey(session.sessionId, session.accountId))
    if (budget === undefined) {
      return session
    }
    const { budgetSpentUsd: _old, ...rest } = session
    const total = totalFor(budget)
    return { ...rest, ...(isPositiveUsd(total.spentUsd) && { budgetSpentUsd: total.spentUsd }) }
  }
  const store: MemorySessionStore = {
    saved,
    failNextSave: false,
    budget: {
      read: (sessionId, accountId) => Promise.resolve(totalFor(ensure(sessionId, accountId))),
      reserve: (sessionId, accountId, costUsd, liability) => {
        const budget = ensure(sessionId, accountId)
        claims += 1
        const claimId = String(claims)
        const isUnbounded = liability?.isUnbounded === true
        const hasUnknownCost = liability?.hasUnknownCost === true
        const hasUnboundedCost = liability?.hasUnboundedCost === true
        budget.entries.set(claimId, {
          costUsd,
          isUnbounded,
          hasUnknownCost,
          hasUnboundedCost,
          isSettled: false,
        })
        let isSettled = false
        return Promise.resolve({
          claimId,
          reservedUsd: Usd.from(costUsd).toAmount(),
          check(capUsd) {
            if (isSettled) {
              throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
            }
            const total = totalFor(budget)
            if (isPositiveUsd(capUsd) && total.hasUnknownHistoricalFees) {
              // A conversation ledger: a new conversation starts fresh.
              throw new Error(
                fill(UI_TEXT.sessionBudgetConversationFeesUnknown, {
                  scope: sessionId,
                  spent: formatExactUsd(total.spentUsd, EXEC_USD_DECIMALS),
                }),
              )
            }
            if (isPositiveUsd(capUsd) && Usd.from(total.spentUsd).compare(Usd.from(capUsd)) > 0) {
              throw new Error(UI_TEXT.sessionBudgetStopped)
            }
            return total
          },
          settle(actualCostUsd, isUnknown = hasUnknownCost, isFinal = true) {
            isSettled = isFinal
            budget.entries.set(claimId, {
              costUsd: actualCostUsd,
              isUnbounded,
              hasUnknownCost: isUnknown,
              hasUnboundedCost,
              isSettled: isFinal,
            })
            return Promise.resolve(totalFor(budget))
          },
        })
      },
      record: (sessionId, accountId, costUsd, hasUnknownCost = false) => {
        const budget = ensure(sessionId, accountId)
        claims += 1
        budget.entries.set(String(claims), {
          costUsd,
          isUnbounded: false,
          hasUnknownCost,
          hasUnboundedCost: false,
          isSettled: true,
        })
        return Promise.resolve(totalFor(budget))
      },
    },
    list: () => Promise.resolve(Array.from(saved.values(), (session) => headerOf(session))),
    load: (sessionId) => {
      const session = saved.get(sessionId)
      return Promise.resolve(session === undefined ? undefined : structuredClone(project(session)))
    },
    save(session) {
      if (store.failNextSave) {
        store.failNextSave = false
        return Promise.reject(new Error('disk full'))
      }
      const previous = saved.get(session.sessionId)
      if (previous?.accountId !== undefined) {
        ensure(previous.sessionId, previous.accountId)
      }
      saved.set(session.sessionId, structuredClone(project(session)))
      if (previous === undefined && session.accountId !== undefined) {
        ensure(session.sessionId, session.accountId)
      }
      return Promise.resolve()
    },
    remove(sessionId) {
      saved.delete(sessionId)
      return Promise.resolve()
    },
  }
  return store
}
