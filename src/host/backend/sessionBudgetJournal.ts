// Adapter for session snapshots and one-time v1/v2 migration. All new money uses spendLedger.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  createSpendLedger,
  SpendLedgerError,
  isSpendLedgerError,
  type LedgerScope,
  type LedgerTotal,
  type LedgerEntry,
} from '../../core/paid/spendLedger'
import {
  SessionBudgetExceededError,
  PaidBudgetStopError,
  type SessionBudgetClaim,
  type SessionBudgetTotal,
  type PaidStopDetails,
} from '../../core/backends/modelapi/sessionBudget'
import type { StoredSession } from '../../core/backends/modelapi/sessionStore'
import { EXEC_USD_DECIMALS, UI_TEXT } from '../../shared/constants'
import { fill, formatDateTime, plural, setUiText } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import type { UiText } from '../../shared/l10n/en'
import { Usd, type UsdAmount } from '../../shared/usd'
import { storeErrorCode } from './storeErrors'
const JOURNAL_DIRECTORY = 'budget-journal'
const INTENT_DIRECTORY = 'budget-intents'
const CLAIMS_DIRECTORY = 'claims'
const SEED_FILE = 'seed.json'
const CLAIM_FILE = 'claim.json'
const SESSION_ID = /^[A-Za-z0-9_-]+$/
const ACCOUNT_ID = /^[a-f0-9]{64}$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

// Captured v1 numbers and v2 decimal strings; the version decides the accepted lane.
const usdSchema = z.union([
  z.number().check(z.nonnegative()),
  z.string().check(z.regex(/^\d+(?:\.\d+)?$/u)),
])
const versionSchema = z.union([z.literal(1), z.literal(2)])
const identity = {
  version: versionSchema,
  scopeId: z.string().check(z.regex(UUID)),
  sessionId: z.string().check(z.regex(SESSION_ID)),
  accountId: z.string().check(z.regex(ACCOUNT_ID)),
}
function isVersionMoney(version: 1 | 2, value: string | number | undefined): boolean {
  return (
    value === undefined || (version === 1 ? typeof value === 'number' : typeof value === 'string')
  )
}
const seedSchema = z.pipe(
  z
    .object({ ...identity, spentUsd: usdSchema, hasUnknownHistoricalFees: z.boolean() })
    .check(z.refine((seed) => isVersionMoney(seed.version, seed.spentUsd))),
  z.transform((seed) => ({ ...seed, spentUsd: Usd.from(seed.spentUsd).toString() })),
)
const claimSchema = z.pipe(
  z
    .object({
      ...identity,
      claimId: z.string().check(z.regex(UUID)),
      ownerId: z.string().check(z.regex(UUID)),
      ownerPid: z.optional(z.number().check(z.int(), z.minimum(1))),
      ownerStartMs: z.optional(z.number().check(z.int(), z.minimum(1))),
      reservedUsd: usdSchema,
      settledUsd: z.optional(usdSchema),
      retainedUsd: z.optional(usdSchema),
      hasUnknownCost: z.optional(z.boolean()),
      isUnbounded: z.optional(z.boolean()),
      hasUnboundedCost: z.optional(z.boolean()),
    })
    .check(
      z.refine((claim) =>
        [claim.reservedUsd, claim.settledUsd, claim.retainedUsd].every((amount) =>
          isVersionMoney(claim.version, amount),
        ),
      ),
    ),
  z.transform((claim) => {
    const { reservedUsd, settledUsd, retainedUsd, ...fields } = claim
    return {
      ...fields,
      reservedUsd: Usd.from(reservedUsd).toString(),
      ...(settledUsd !== undefined && { settledUsd: Usd.from(settledUsd).toString() }),
      ...(retainedUsd !== undefined && { retainedUsd: Usd.from(retainedUsd).toString() }),
    }
  }),
)

export type SessionBudgetJournalDeps = {
  readonly directory: string
  readonly sleep: (ms: number) => Promise<void>
  readonly l10n?: { readonly table: UiText; readonly locale: string }
  readonly dailyStop?: { readonly setting: string; readonly nowMs: () => number }
} & (
  | { readonly loadSession: (sessionId: string) => Promise<StoredSession | undefined> }
  | { readonly initialBudget: () => Promise<SessionBudgetTotal> }
)
function projectTotal(
  total: LedgerTotal,
): SessionBudgetTotal & { readonly uncertainUsd?: UsdAmount } {
  return {
    spentUsd: total.spentUsd,
    hasUnknownHistoricalFees: total.unknownHistory,
    ...(Usd.from(total.heldUsd).compare(Usd.from(0)) > 0 && { heldUsd: total.heldUsd }),
    ...(Usd.from(total.uncertainUsd).add(Usd.from(total.heldUsd)).compare(Usd.from(0)) > 0 && {
      hasBoundedUnknownCost: true,
    }),
    ...(Usd.from(total.uncertainUsd).compare(Usd.from(0)) > 0 && {
      uncertainUsd: total.uncertainUsd,
    }),
  }
}
function nextMidnight(now: number): number {
  const date = new Date(now)
  date.setDate(date.getDate() + 1)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}
function formatStop(details: PaidStopDetails): string {
  return fill(UI_TEXT.execPaidDailyStopped, {
    cap: formatUsd(details.limitUsd, EXEC_USD_DECIMALS),
    spent: formatUsd(details.spentUsd, EXEC_USD_DECIMALS),
    held: formatUsd(details.heldUsd, EXEC_USD_DECIMALS),
    requests: plural(UI_TEXT.execPaidOpenRequests, details.openClaims),
    reset: formatDateTime(details.resetsAtMs),
    setting: details.setting,
  })
}
function hasHistoricalTokens(session: StoredSession): boolean {
  return (
    session.usage.inputTokens > 0 ||
    session.usage.outputTokens > 0 ||
    (session.children ?? []).some((child) => hasHistoricalTokens(child.session))
  )
}
function hasHistoricalFlatFees(session: StoredSession): boolean {
  return (
    session.transcript.some(
      ({ item }) => item.paid === 'webSearch' || item.paid === 'imageGeneration',
    ) || (session.children ?? []).some((child) => hasHistoricalFlatFees(child.session))
  )
}
export function createSessionBudgetJournal(deps: SessionBudgetJournalDeps) {
  if (deps.l10n !== undefined) setUiText(deps.l10n.table, deps.l10n.locale)
  const scopeFor = (sessionId: string, accountId: string): LedgerScope => {
    if (!SESSION_ID.test(sessionId) || !ACCOUNT_ID.test(accountId))
      throw new SpendLedgerError('integrity', { scope: sessionId, file: 'scope' })
    return {
      id: sessionId,
      identity: `${accountId}/${sessionId}`,
      directory: path.join(deps.directory, 'spend-ledger-v3', accountId, sessionId),
    }
  }
  const ledger = createSpendLedger({
    sleep: deps.sleep,
    initial: async (scope) => {
      const accountId = path.basename(path.dirname(scope.directory))
      const old = path.join(deps.directory, JOURNAL_DIRECTORY, accountId, scope.id)
      const intent = path.join(deps.directory, INTENT_DIRECTORY, accountId, scope.id)
      if (existsSync(old) || existsSync(intent)) {
        try {
          const seed = seedSchema.parse(JSON.parse(readFileSync(path.join(old, SEED_FILE), 'utf8')))
          if (seed.sessionId !== scope.id || seed.accountId !== accountId)
            throw new SpendLedgerError('integrity', { scope: scope.id, file: 'legacy seed' })
          let settled = Usd.from(seed.spentUsd)
          let uncertain = Usd.from(0)
          let isUnknownHistory = seed.hasUnknownHistoricalFees
          const open: LedgerEntry[] = []
          const legacyClaims = readdirSync(path.join(old, CLAIMS_DIRECTORY))
          for (const id of legacyClaims) {
            const claim = claimSchema.parse(
              JSON.parse(readFileSync(path.join(old, CLAIMS_DIRECTORY, id, CLAIM_FILE), 'utf8')),
            )
            if (
              claim.claimId !== id ||
              claim.scopeId !== seed.scopeId ||
              claim.sessionId !== scope.id ||
              claim.accountId !== accountId
            )
              throw new SpendLedgerError('integrity', { scope: scope.id, file: 'legacy claim' })
            const bound = Usd.from(claim.retainedUsd ?? claim.reservedUsd).toAmount()
            // Old retries can cover multiple billed attempts. They cannot be certified as bounded.
            isUnknownHistory ||=
              claim.hasUnknownCost === true ||
              claim.hasUnboundedCost === true ||
              (claim.settledUsd === undefined && claim.isUnbounded === true)
            if (claim.settledUsd === undefined) {
              open.push({ id, bound, amount: bound, state: 'reserved' })
            } else {
              if (claim.hasUnknownCost === true)
                uncertain = uncertain
                  .add(Usd.from(claim.settledUsd))
                  .add(
                    Usd.from(bound).compare(Usd.from(claim.settledUsd)) > 0
                      ? Usd.from(bound).subtract(Usd.from(claim.settledUsd))
                      : Usd.from(0),
                  )
              else settled = settled.add(Usd.from(claim.settledUsd))
            }
          }
          return {
            settled: settled.toAmount(),
            uncertain: uncertain.toAmount(),
            unknownHistory: isUnknownHistory,
            open,
          }
        } catch (error: unknown) {
          if (isSpendLedgerError(error)) throw error
          throw new SpendLedgerError(
            storeErrorCode(error) === 'ENOENT'
              ? 'recovery'
              : storeErrorCode(error) === undefined
                ? 'damaged'
                : 'unreadable',
            { scope: scope.id, file: 'legacy journal', errno: storeErrorCode(error) },
            error,
          )
        }
      }
      if ('initialBudget' in deps) {
        const initial = await deps.initialBudget()
        return { settled: initial.spentUsd, unknownHistory: initial.hasUnknownHistoricalFees }
      }
      const session = await deps.loadSession(scope.id)
      if (session?.sessionId !== scope.id || session.accountId !== accountId)
        throw new SpendLedgerError('integrity', { scope: scope.id, file: 'session' })
      const isFresh = session.budgetIsFreshFork === true
      if (
        isFresh &&
        (session.budgetSpentUsd !== '0' ||
          session.forkedFrom === undefined ||
          !SESSION_ID.test(session.forkedFrom))
      )
        throw new SpendLedgerError('integrity', { scope: scope.id, file: 'fork' })
      const isUnknownHistory =
        !isFresh &&
        ((session.budgetSpentUsd === undefined && hasHistoricalTokens(session)) ||
          hasHistoricalFlatFees(session))
      return {
        settled: Usd.from(session.budgetSpentUsd ?? 0).toAmount(),
        unknownHistory: isUnknownHistory,
      }
    },
  })
  const describe = (
    _scope: LedgerScope,
    total: LedgerTotal,
    cap: UsdAmount,
    bound: UsdAmount = Usd.from(0).toAmount(),
  ) => {
    const daily = deps.dailyStop
    if (daily !== undefined) {
      const details: PaidStopDetails = {
        limitUsd: cap,
        spentUsd: Usd.from(total.spentUsd)
          .subtract(Usd.from(total.uncertainUsd))
          .subtract(Usd.from(total.heldUsd))
          .toAmount(),
        heldUsd: Usd.from(total.heldUsd).add(Usd.from(total.uncertainUsd)).toAmount(),
        openClaims: total.openClaims,
        resetsAtMs: nextMidnight(daily.nowMs()),
        setting: daily.setting,
      }
      return new PaidBudgetStopError(formatStop(details), details)
    }
    return new SessionBudgetExceededError(
      fill(UI_TEXT.sessionBudgetStopped, {
        estimate: formatUsd(bound),
        cap: formatUsd(cap),
        spent: formatUsd(total.spentUsd),
      }),
    )
  }
  const reserveAdmitted = async (
    sessionId: string,
    accountId: string,
    amount: UsdAmount,
    cap: UsdAmount = Usd.from(0).toAmount(),
    tariff: 'known' | 'unknown' = 'known',
  ): Promise<SessionBudgetClaim> => {
    const scope = scopeFor(sessionId, accountId)
    try {
      const claim = await ledger.admit(scope, amount, cap, tariff)
      let wasSent = false
      return {
        claimId: claim.id,
        reservedUsd: claim.bound,
        markSent: () => {
          claim.markSent()
          wasSent = true
        },
        markUnsent: () => {
          claim.markUnsent()
          wasSent = false
        },
        check: (liveCap) => {
          const total = claim.check()
          if (Usd.from(liveCap).compare(Usd.from(0)) > 0) {
            if (total.unknownHistory)
              throw new SpendLedgerError('legacy', { scope: scope.id, total: total.spentUsd })
            if (Usd.from(total.spentUsd).compare(Usd.from(liveCap)) > 0)
              throw describe(scope, total, liveCap, amount)
          }
          return projectTotal(total)
        },
        settle: async (actual, state = 'settled') =>
          projectTotal(
            state === 'reserved'
              ? await claim.retain(actual)
              : await claim.settle(
                  state === 'settled' && !wasSent && Usd.from(actual).compare(Usd.from(0)) === 0
                    ? 'released'
                    : state,
                  actual,
                ),
          ),
      }
    } catch (error: unknown) {
      if (isSpendLedgerError(error) && error.kind === 'budget') {
        const total = ledger.readExisting(scope)
        if (total === undefined) throw error
        throw describe(scope, total, cap, amount)
      }
      throw error
    }
  }
  const journal = {
    reserveAdmitted,
    reserve: reserveAdmitted,
    read: async (sessionId: string, accountId: string) =>
      projectTotal(await ledger.read(scopeFor(sessionId, accountId))),
    readExisting: async (sessionId: string, accountId: string) => {
      const scope = scopeFor(sessionId, accountId)
      const existing = ledger.readExisting(scope)
      if (existing !== undefined) return projectTotal(existing)
      if (!existsSync(path.join(deps.directory, JOURNAL_DIRECTORY, accountId, sessionId))) return
      return projectTotal(await ledger.read(scope))
    },
    describeStop: async (
      sessionId: string,
      accountId: string,
      cap: UsdAmount,
    ): Promise<PaidBudgetStopError> => {
      const scope = scopeFor(sessionId, accountId)
      const error = describe(scope, await ledger.read(scope), cap)
      if (error instanceof PaidBudgetStopError) return error
      throw new SpendLedgerError('integrity', { scope: sessionId, file: 'daily scope' })
    },
    lookupByClaimId: (sessionId: string, accountId: string, id: string) => {
      const entry = ledger.lookup(scopeFor(sessionId, accountId), id)
      return Promise.resolve({
        claimId: id,
        ownerId: entry.owner === undefined ? '' : JSON.stringify(entry.owner),
        reservedUsd: Usd.from(entry.bound).toAmount(),
        ...(entry.state !== 'reserved' && { settledUsd: Usd.from(entry.amount).toAmount() }),
        state: entry.state,
      })
    },
    record: async (
      sessionId: string,
      accountId: string,
      amount: UsdAmount,
      state: 'settled' | 'uncertain' | 'released' = 'settled',
    ) => projectTotal(await ledger.record(scopeFor(sessionId, accountId), amount, state)),
    project: async (session: StoredSession): Promise<StoredSession> => {
      if (session.accountId === undefined) return session
      const existing = await journal.readExisting(session.sessionId, session.accountId)
      if (existing === undefined) return session
      const { budgetIsFreshFork: _fresh, ...rest } = session
      return { ...rest, budgetSpentUsd: existing.spentUsd }
    },
  }
  return journal
}
