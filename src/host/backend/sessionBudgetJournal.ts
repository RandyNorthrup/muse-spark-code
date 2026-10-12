// Shared session spend (M82): each request owns one durable row before its
// synchronous final admission. Rows are never elected over, stolen, or
// removed; an unclosed request keeps its full liability after a crash.
// One-time seed creation has a durable intent outside the journal scope,
// so an incomplete or missing scope can never be silently seeded again.

import { randomUUID } from 'node:crypto'
import { rmdirSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdir, rmdir, stat } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  SessionBudgetExceededError,
  PaidBudgetStopError,
  type PaidStopDetails,
} from '../../core/backends/modelapi/sessionBudget'
import type {
  SessionBudgetClaim,
  SessionBudgetJournal,
  SessionBudgetTotal,
} from '../../core/backends/modelapi/sessionBudget'
import type { StoredSession } from '../../core/backends/modelapi/sessionStore'
import { formatUsd } from '../../core/usage/insights'
import {
  DAILY_BUDGET_LOCK_ATTEMPTS,
  DAILY_BUDGET_LOCK_WAIT_MS,
  DAILY_BUDGET_OWNER_START_SKEW_MS,
  EXEC_USD_DECIMALS,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatDateTime, plural, setUiText } from '../../shared/l10n/text'
import { formatUsd as formatExactUsd } from '../../shared/l10n/exactUsd'
import type { UiText } from '../../shared/l10n/en'
import { Usd, usdAmountSchema, type UsdAmount } from '../../shared/usd'
import { writeFileAtomically } from '../fsAtomic'
import { storeErrorCode } from './storeErrors'

const JOURNAL_DIRECTORY = 'budget-journal'
const INTENT_DIRECTORY = 'budget-intents'
const CLAIMS_DIRECTORY = 'claims'
const SEED_FILE = 'seed.json'
const CLAIM_FILE = 'claim.json'
const SENT_DIRECTORY = 'send-intent'
const LOCK_OWNER_PREFIX = 'owner-'
const LOCK_OWNER_PATTERN =
  /^owner-(\d+)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const MISSING = 'ENOENT'
const EXISTS = 'EEXIST'
const SESSION_ID = /^[A-Za-z0-9_-]+$/
const ACCOUNT_ID = /^[a-f0-9]{64}$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

const legacySeedSchema = z.object({
  version: z.literal(1),
  scopeId: z.string().check(z.regex(UUID)),
  sessionId: z.string().check(z.regex(SESSION_ID)),
  accountId: z.string().check(z.regex(ACCOUNT_ID)),
  spentUsd: z.number().check(z.nonnegative()),
  hasUnknownHistoricalFees: z.boolean(),
})
const usdSchema = z.string().check(z.regex(/^\d+(?:\.\d+)?$/))
const decimalSeedSchema = z.extend(legacySeedSchema, {
  version: z.literal(2),
  spentUsd: usdSchema,
})
type Seed = z.infer<typeof decimalSeedSchema>
const seedSchema = z.pipe(
  z.union([legacySeedSchema, decimalSeedSchema]),
  z.transform((seed): Seed => ({
    ...seed,
    version: 2,
    spentUsd: Usd.from(seed.spentUsd).toString(),
  })),
)

const legacyClaimSchema = z.object({
  version: z.literal(1),
  scopeId: z.string().check(z.regex(UUID)),
  claimId: z.string().check(z.regex(UUID)),
  ownerId: z.string().check(z.regex(UUID)),
  ownerPid: z.optional(z.number().check(z.int(), z.minimum(1))),
  // D2: the owner's process start (wall ms) beside its pid, so a reused pid
  // on a later boot is still provably gone.
  ownerStartMs: z.optional(z.number().check(z.int(), z.minimum(1))),
  sessionId: z.string().check(z.regex(SESSION_ID)),
  accountId: z.string().check(z.regex(ACCOUNT_ID)),
  reservedUsd: z.number().check(z.nonnegative()),
  settledUsd: z.optional(z.number().check(z.nonnegative())),
  retainedUsd: z.optional(z.number().check(z.nonnegative())),
  hasUnknownCost: z.optional(z.boolean()),
  isUnbounded: z.optional(z.boolean()),
})
const decimalClaimSchema = z.extend(legacyClaimSchema, {
  version: z.literal(2),
  reservedUsd: usdSchema,
  settledUsd: z.optional(usdSchema),
  retainedUsd: z.optional(usdSchema),
})
type Claim = z.infer<typeof decimalClaimSchema>
const claimSchema = z.pipe(
  z.union([legacyClaimSchema, decimalClaimSchema]),
  z.transform((claim): Claim => {
    const { reservedUsd, settledUsd, retainedUsd, ...fields } = claim
    return {
      ...fields,
      version: 2,
      reservedUsd: Usd.from(reservedUsd).toString(),
      ...(settledUsd !== undefined && { settledUsd: Usd.from(settledUsd).toString() }),
      ...(retainedUsd !== undefined && { retainedUsd: Usd.from(retainedUsd).toString() }),
    }
  }),
)
type ClaimView = Omit<Claim, 'reservedUsd' | 'settledUsd' | 'retainedUsd'> & {
  readonly reservedUsd: UsdAmount
  readonly settledUsd?: UsdAmount
  readonly retainedUsd?: UsdAmount
}

const claimFlagsSchema = z.object({
  isUnbounded: z.optional(z.boolean()),
  hasUnknownCost: z.optional(z.boolean()),
})
type ClaimFlags = z.infer<typeof claimFlagsSchema>

export type SessionBudgetJournalDeps = {
  readonly l10n?: { readonly table: UiText; readonly locale: string }
  readonly directory: string
  readonly sleep: (ms: number) => Promise<void>
  /** Daily scopes recover only new, durably nonsent claims whose PID no longer exists. */
  readonly recoverUnsent?: boolean
  readonly rename?: (from: string, to: string) => Promise<void>
  /**
   * D1: daily scopes refuse with the numbers (limit, spent, held, reset,
   * setting). Session scopes omit this and keep their numbers-only sentence.
   */
  readonly dailyStop?: { readonly setting: string; readonly nowMs: () => number }
} & (
  | {
      /** Reads the authoritative session file without its journal projection. */
      readonly loadSession: (sessionId: string) => Promise<StoredSession | undefined>
    }
  | {
      /** D78: an independent new daily scope has no earlier session history. */
      readonly initialBudget: () => Promise<
        Omit<SessionBudgetTotal, 'spentUsd'> & { readonly spentUsd: UsdAmount }
      >
    }
)

interface ProjectedSessionBudgetJournal extends SessionBudgetJournal {
  /** Atomic admission. A crashed lock is never stolen; its scope fails closed. */
  reserveAdmitted(
    sessionId: string,
    accountId: string,
    costUsd: UsdAmount,
    capUsd: UsdAmount,
  ): Promise<SessionBudgetClaim>
  /** A usage view must never seed an unopened budget ledger. */
  readExisting(
    sessionId: string,
    accountId: string,
  ): Promise<(SessionBudgetTotal & { readonly uncertainUsd?: UsdAmount }) | undefined>
  /**
   * D1: the refusal's numbers after the fact (a stop marker, a day
   * rollover). Recovers first, so a dead process's hold never refuses.
   * Rejects where no daily narrative exists; callers keep the plain error.
   */
  describeStop(
    sessionId: string,
    accountId: string,
    capUsd: UsdAmount,
  ): Promise<PaidBudgetStopError>
  /** Existing journal data owns this field; an unopened journal leaves a snapshot alone. */
  project(session: StoredSession): Promise<StoredSession>
  /** Read-only reconciliation; ownership of settlement stays with the creator. */
  lookupByClaimId(sessionId: string, accountId: string, claimId: string): Promise<ClaimView>
}

interface Scope {
  readonly sessionId: string
  readonly accountId: string
  readonly directory: string
  readonly intent: string
}

function unavailable(cause?: unknown): Error {
  return new Error(UI_TEXT.sessionBudgetStoreUnavailable, { cause })
}

function assertCost(costUsd: UsdAmount): void {
  if (!usdAmountSchema.safeParse(costUsd).success || Usd.from(costUsd).compare(Usd.from(0)) < 0) {
    throw unavailable()
  }
}

async function isPresent(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch (error: unknown) {
    if (storeErrorCode(error) === MISSING) {
      return false
    }
    throw unavailable(error)
  }
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

/** The parent's recorded spend includes children; flat fee rows remain independently unknown. */
function hasUnknownHistory(session: StoredSession): boolean {
  if (session.budgetIsFreshFork === true) {
    if (
      session.budgetSpentUsd === undefined ||
      Usd.from(session.budgetSpentUsd).compare(Usd.from(0)) !== 0 ||
      session.forkedFrom === undefined ||
      !SESSION_ID.test(session.forkedFrom)
    ) {
      throw unavailable()
    }
    // Only the controlled first fork snapshot proves these copied rows
    // belong to the parent. Legacy zero/forkedFrom without the marker does not.
    return false
  }
  return (
    (session.budgetSpentUsd === undefined && hasHistoricalTokens(session)) ||
    hasHistoricalFlatFees(session)
  )
}

function readSeed(scope: Scope): Seed {
  try {
    if (!statSync(scope.intent).isDirectory() || !statSync(scope.directory).isDirectory()) {
      throw unavailable()
    }
    const seed = seedSchema.parse(
      JSON.parse(readFileSync(path.join(scope.directory, SEED_FILE), 'utf8')),
    )
    if (seed.sessionId !== scope.sessionId || seed.accountId !== scope.accountId) {
      throw unavailable()
    }
    return seed
  } catch (error: unknown) {
    throw unavailable(error)
  }
}

function readClaim(scope: Scope, seed: Seed, claimId: string): Claim {
  try {
    if (!UUID.test(claimId)) {
      throw unavailable()
    }
    const claim = claimSchema.parse(
      JSON.parse(
        readFileSync(path.join(scope.directory, CLAIMS_DIRECTORY, claimId, CLAIM_FILE), 'utf8'),
      ),
    )
    if (
      claim.scopeId !== seed.scopeId ||
      claim.claimId !== claimId ||
      claim.sessionId !== scope.sessionId ||
      claim.accountId !== scope.accountId
    ) {
      throw unavailable()
    }
    return claim
  } catch (error: unknown) {
    throw unavailable(error)
  }
}

function totalFor(scope: Scope, isUsageView = false) {
  try {
    const seed = readSeed(scope)
    let spent = Usd.from(seed.spentUsd)
    let hasUnknownHistoricalFees = seed.hasUnknownHistoricalFees
    let uncertainUsd = Usd.from(0).toAmount()
    // D1: the held sum and open count behind a refusal's numbers.
    let held = Usd.from(0)
    let openClaims = 0
    const claimIds = readdirSync(path.join(scope.directory, CLAIMS_DIRECTORY))
    for (const claimId of claimIds) {
      const claim = readClaim(scope, seed, claimId)
      spent = spent.add(Usd.from(claim.settledUsd ?? claim.retainedUsd ?? claim.reservedUsd))
      if (claim.settledUsd === undefined || claim.hasUnknownCost === true)
        uncertainUsd = Usd.from(uncertainUsd)
          .add(Usd.from(claim.settledUsd ?? claim.retainedUsd ?? claim.reservedUsd))
          .toAmount()
      if (claim.settledUsd === undefined) {
        held = held.add(Usd.from(claim.retainedUsd ?? claim.reservedUsd))
        openClaims += 1
      }
      hasUnknownHistoricalFees ||=
        // New daily claims retain a known bounded liability even without a receipt.
        // Legacy unknown fees and unbounded requests still prevent capped admission.
        (claim.hasUnknownCost === true &&
          (claim.ownerPid === undefined || claim.isUnbounded === true)) ||
        (claim.isUnbounded === true && claim.settledUsd === undefined)
    }
    assertCost(spent.toAmount())
    return {
      spent,
      hasUnknownHistoricalFees,
      held: held.toAmount(),
      openClaims,
      ...(isUsageView && Usd.from(uncertainUsd).compare(Usd.from(0)) > 0 && { uncertainUsd }),
    }
  } catch (error: unknown) {
    throw unavailable(error)
  }
}

/** One localized sentence for a paid stop: its own reason, never a generic one. */
function formatPaidBudgetStop(details: PaidStopDetails): string {
  return fill(UI_TEXT.execPaidDailyStopped, {
    cap: formatExactUsd(details.limitUsd, EXEC_USD_DECIMALS),
    spent: formatExactUsd(details.spentUsd, EXEC_USD_DECIMALS),
    held: formatExactUsd(details.heldUsd, EXEC_USD_DECIMALS),
    requests: plural(UI_TEXT.execPaidOpenRequests, details.openClaims),
    reset: formatDateTime(details.resetsAtMs),
    setting: details.setting,
  })
}

/** A day boundary past midnight, and the tick math behind /proc start times. */
const NEXT_DAY_HOUR = 24
const PROC_TICKS_PER_SECOND = 100
const MS_PER_SECOND = 1000

/** Next local midnight from a clock: when a daily scope resets. */
function nextMidnightMs(nowMs: number): number {
  const date = new Date(nowMs)
  date.setHours(NEXT_DAY_HOUR, 0, 0, 0)
  return date.getTime()
}

/**
 * D2: another process's start (wall ms) from its kernel record, so a pid
 * the OS has since handed to a new process is still provably gone.
 * Undefined where the platform keeps no such record: the caller stays
 * conservative and treats a live pid as a live owner.
 */
function processStartMs(pid: number): number | undefined {
  return process.platform === 'linux' && Number.isSafeInteger(pid) && pid > 0
    ? startFromProc(pid)
    : undefined
}

function startFromProc(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8')
    // The command name may hold spaces and parens; fields start past its end.
    const fields = stat
      .slice(stat.lastIndexOf(')') + 1)
      .trim()
      .split(/\s+/)
    const starttime = Number(fields[19])
    const btime = Number(/btime (\d+)/.exec(readFileSync('/proc/stat', 'utf8'))?.[1] ?? '')
    return Number.isFinite(starttime) && Number.isFinite(btime)
      ? Math.round((btime + starttime / PROC_TICKS_PER_SECOND) * MS_PER_SECOND)
      : undefined
  } catch {
    return undefined
  }
}

function projectedTotal(scope: Scope): SessionBudgetTotal {
  const total = totalFor(scope)
  return {
    spentUsd: total.spent.toAmount(),
    hasUnknownHistoricalFees: total.hasUnknownHistoricalFees,
  }
}

export function createSessionBudgetJournal(
  deps: SessionBudgetJournalDeps,
): ProjectedSessionBudgetJournal {
  if (deps.l10n !== undefined) setUiText(deps.l10n.table, deps.l10n.locale)
  const ownerId = randomUUID()
  // D2: this process's own start, recorded beside every owned claim's pid.
  const ownerStartMs = Date.now() - Math.round(process.uptime() * MS_PER_SECOND)
  const options = {
    sleep: deps.sleep,
    ...(deps.rename !== undefined && { rename: deps.rename }),
  }

  const scopeFor = (sessionId: string, accountId: string): Scope => {
    if (!SESSION_ID.test(sessionId) || !ACCOUNT_ID.test(accountId)) {
      throw unavailable()
    }
    return {
      sessionId,
      accountId,
      directory: path.join(deps.directory, JOURNAL_DIRECTORY, accountId, sessionId),
      intent: path.join(deps.directory, INTENT_DIRECTORY, accountId, sessionId),
    }
  }

  const ensure = async (scope: Scope): Promise<Seed> => {
    const [hasIntent, hasScope] = await Promise.all([
      isPresent(scope.intent),
      isPresent(scope.directory),
    ])
    if (hasIntent || hasScope) {
      // An existing intent never grants another writer the right to seed.
      return readSeed(scope)
    }
    const loadBudget = async (shouldCheckHistory = true): Promise<SessionBudgetTotal> => {
      if ('initialBudget' in deps) {
        const initial = await deps.initialBudget()
        return { ...initial, spentUsd: Usd.from(initial.spentUsd).toAmount() }
      }
      const session = await deps.loadSession(scope.sessionId)
      if (session?.sessionId !== scope.sessionId || session.accountId !== scope.accountId)
        throw unavailable()
      return {
        spentUsd: Usd.from(session.budgetSpentUsd ?? 0).toAmount(),
        hasUnknownHistoricalFees: shouldCheckHistory && hasUnknownHistory(session),
      }
    }
    // As before: validate ownership first; history failures retain the intent.
    await loadBudget(false)
    try {
      await mkdir(path.dirname(scope.intent), { recursive: true })
      await mkdir(scope.intent)
    } catch (error: unknown) {
      if (storeErrorCode(error) === EXISTS) {
        return readSeed(scope)
      }
      throw unavailable(error)
    }
    try {
      // Only the intent creator reaches this path. A crash leaves the
      // intent behind and future readers refuse, rather than resetting spend.
      const fresh = await loadBudget()
      await mkdir(path.dirname(scope.directory), { recursive: true })
      await mkdir(scope.directory)
      await mkdir(path.join(scope.directory, CLAIMS_DIRECTORY))
      const spentUsd = fresh.spentUsd
      assertCost(spentUsd)
      const seed: Seed = {
        version: 2,
        scopeId: randomUUID(),
        sessionId: scope.sessionId,
        accountId: scope.accountId,
        spentUsd: Usd.from(spentUsd).toString(),
        hasUnknownHistoricalFees: fresh.hasUnknownHistoricalFees,
      }
      await writeFileAtomically(
        path.join(scope.directory, SEED_FILE),
        JSON.stringify(seed),
        options,
      )
      return readSeed(scope)
    } catch (error: unknown) {
      throw unavailable(error)
    }
  }

  const writeClaim = async (
    scope: Scope,
    seed: Seed,
    costUsd: UsdAmount,
    isNonsentReservation: boolean,
    flags: ClaimFlags = {},
  ): Promise<Claim> => {
    assertCost(costUsd)
    const claim: Claim = {
      version: 2,
      scopeId: seed.scopeId,
      claimId: randomUUID(),
      ownerId,
      ...(deps.recoverUnsent === true &&
        isNonsentReservation && { ownerPid: process.pid, ownerStartMs }),
      sessionId: scope.sessionId,
      accountId: scope.accountId,
      reservedUsd: Usd.from(costUsd).toString(),
      ...(flags.hasUnknownCost === true && { hasUnknownCost: true }),
      ...(flags.isUnbounded === true && { isUnbounded: true }),
    }
    const directory = path.join(scope.directory, CLAIMS_DIRECTORY, claim.claimId)
    let hasCreatedIntent = false
    try {
      // The owned directory is a permanent intent. An absent or partial
      // payload blocks all admission until its original writer publishes it.
      await mkdir(directory)
      hasCreatedIntent = true
      await writeFileAtomically(path.join(directory, CLAIM_FILE), JSON.stringify(claim), options)
      return claim
    } catch (error: unknown) {
      if (hasCreatedIntent && isNonsentReservation) {
        try {
          // No claim reached a caller, so no request could have been sent.
          // Only this creator can close its known nonsent row. A second
          // IO failure leaves the original intent/liability blocking admission.
          const currentSeed = readSeed(scope)
          if (currentSeed.scopeId !== seed.scopeId) {
            throw unavailable()
          }
          if (await isPresent(path.join(directory, CLAIM_FILE))) {
            const current = readClaim(scope, currentSeed, claim.claimId)
            if (
              current.ownerId !== ownerId ||
              current.reservedUsd !== claim.reservedUsd ||
              (current.settledUsd !== undefined && current.settledUsd !== '0')
            ) {
              throw unavailable()
            }
          }
          await writeFileAtomically(
            path.join(directory, CLAIM_FILE),
            JSON.stringify({ ...claim, settledUsd: '0', hasUnknownCost: false }),
            options,
          )
        } catch {
          // Preserve the original failure; nobody treats this as a successful reservation.
        }
      }
      throw unavailable(error)
    }
  }

  const claimFor = (scope: Scope, seed: Seed, created: Claim): SessionBudgetClaim => {
    let settling: Promise<SessionBudgetTotal> | undefined
    let settlingCost: UsdAmount | undefined
    let isSettlingCostUnknown: boolean | undefined
    let isSettlingFinal: boolean | undefined
    const owned = (): Claim => {
      const currentSeed = readSeed(scope)
      const claim = readClaim(scope, currentSeed, created.claimId)
      if (
        currentSeed.scopeId !== seed.scopeId ||
        claim.ownerId !== ownerId ||
        claim.reservedUsd !== created.reservedUsd
      ) {
        throw unavailable()
      }
      return claim
    }
    const settleEntry = async (
      actualCostUsd: UsdAmount,
      hasUnknownCost: boolean,
      isFinal: boolean,
    ): Promise<SessionBudgetTotal> => {
      const claim = owned()
      const amount = Usd.from(actualCostUsd)
      if (!isFinal && amount.compare(Usd.from(claim.retainedUsd ?? claim.reservedUsd)) < 0) {
        throw unavailable()
      }
      if (claim.settledUsd !== undefined) {
        if (
          claim.settledUsd !== amount.toString() ||
          (claim.hasUnknownCost === true) !== hasUnknownCost
        ) {
          throw unavailable()
        }
        return projectedTotal(scope)
      }
      try {
        await writeFileAtomically(
          path.join(scope.directory, CLAIMS_DIRECTORY, created.claimId, CLAIM_FILE),
          JSON.stringify({
            ...claim,
            ...(isFinal ? { settledUsd: amount.toString() } : { retainedUsd: amount.toString() }),
            hasUnknownCost,
          }),
          options,
        )
        return projectedTotal(scope)
      } catch (error: unknown) {
        throw unavailable(error)
      }
    }
    return {
      claimId: created.claimId,
      reservedUsd: Usd.from(created.reservedUsd).toAmount(),
      ...(created.ownerPid !== undefined && {
        markUnsent: () => {
          const claim = owned()
          if (claim.settledUsd !== undefined) throw unavailable()
          try {
            rmdirSync(path.join(scope.directory, CLAIMS_DIRECTORY, claim.claimId, SENT_DIRECTORY))
          } catch (error: unknown) {
            if (storeErrorCode(error) !== MISSING) throw unavailable(error)
          }
        },
        markSent: () => {
          const claim = owned()
          if (claim.settledUsd !== undefined) throw unavailable()
          const marker = path.join(scope.directory, CLAIMS_DIRECTORY, claim.claimId, SENT_DIRECTORY)
          try {
            mkdirSync(marker)
          } catch (error: unknown) {
            if (storeErrorCode(error) !== EXISTS) throw unavailable(error)
          }
        },
      }),
      check(capUsd) {
        assertCost(capUsd)
        if (settling !== undefined) {
          throw unavailable()
        }
        const claim = owned()
        if (claim.settledUsd !== undefined) {
          throw unavailable()
        }
        const total = totalFor(scope)
        if (Usd.from(capUsd).compare(Usd.from(0)) > 0 && total.hasUnknownHistoricalFees) {
          throw new SessionBudgetExceededError(UI_TEXT.sessionBudgetLegacyFeesUnknown)
        }
        if (
          Usd.from(capUsd).compare(Usd.from(0)) > 0 &&
          total.spent.compare(Usd.from(capUsd)) > 0
        ) {
          // D1: a daily scope refuses with its numbers; the refused claim's
          // own reservation is not counted as spent or held.
          if (deps.dailyStop !== undefined) {
            const own = Usd.from(created.reservedUsd)
            const settled = total.spent.subtract(Usd.from(total.held))
            const held =
              Usd.from(total.held).compare(own) > 0
                ? Usd.from(total.held).subtract(own)
                : Usd.from(0)
            const details: PaidStopDetails = {
              limitUsd: Usd.from(capUsd).toAmount(),
              spentUsd: settled.toAmount(),
              heldUsd: held.toAmount(),
              openClaims: Math.max(0, total.openClaims - 1),
              resetsAtMs: nextMidnightMs(deps.dailyStop.nowMs()),
              setting: deps.dailyStop.setting,
            }
            throw new PaidBudgetStopError(formatPaidBudgetStop(details), details)
          }
          throw new SessionBudgetExceededError(
            fill(UI_TEXT.sessionBudgetStopped, {
              estimate: formatUsd(Usd.from(created.reservedUsd).toAmount()),
              cap: formatUsd(capUsd),
              spent: formatUsd(total.spent.subtract(Usd.from(created.reservedUsd)).toAmount()),
            }),
          )
        }
        return {
          spentUsd: total.spent.toAmount(),
          hasUnknownHistoricalFees: total.hasUnknownHistoricalFees,
        }
      },
      async settle(actualCostUsd, hasUnknownCost, isFinal = true) {
        assertCost(actualCostUsd)
        const validated = claimFlagsSchema.parse({ hasUnknownCost })
        const isUnknown =
          validated.hasUnknownCost ?? isSettlingCostUnknown ?? owned().hasUnknownCost === true
        if (
          settlingCost !== undefined &&
          (isSettlingCostUnknown !== isUnknown ||
            isSettlingFinal !== isFinal ||
            settlingCost !== Usd.from(actualCostUsd).toAmount())
        ) {
          throw unavailable()
        }
        settlingCost = Usd.from(actualCostUsd).toAmount()
        isSettlingCostUnknown = isUnknown
        isSettlingFinal = isFinal
        settling ??= settleEntry(actualCostUsd, isUnknown, isFinal)
        const current = settling
        try {
          return await current
        } finally {
          if (settling === current) {
            settling = undefined
            settlingCost = undefined
            isSettlingCostUnknown = undefined
            isSettlingFinal = undefined
          }
        }
      },
    }
  }

  const withReservationLock = async <T>(scope: Scope, operation: () => Promise<T>): Promise<T> => {
    const lock = `${scope.intent}.lock`
    const marker = `${LOCK_OWNER_PREFIX}${String(process.pid)}-${ownerId}`
    await mkdir(path.dirname(lock), { recursive: true })
    let hasLock = false
    for (let attempt = 0; attempt < DAILY_BUDGET_LOCK_ATTEMPTS; attempt += 1) {
      try {
        if (deps.recoverUnsent === true) {
          // No await separates ownership from the first durable reservation.
          mkdirSync(lock)
          mkdirSync(path.join(lock, marker))
        } else await mkdir(lock)
        hasLock = true
        break
      } catch (error: unknown) {
        if (storeErrorCode(error) !== EXISTS) throw unavailable(error)
        if (deps.recoverUnsent === true) {
          const names = readdirSync(lock)
          const old = names.length === 1 ? names[0] : undefined
          const pid = old === undefined ? undefined : LOCK_OWNER_PATTERN.exec(old)?.[1]
          if (pid !== undefined && Number.isSafeInteger(Number(pid)) && Number(pid) > 0) {
            try {
              process.kill(Number(pid), 0)
            } catch (error_: unknown) {
              if (old !== undefined && storeErrorCode(error_) === 'ESRCH') {
                try {
                  // Only removal of this exact dead owner's marker grants release;
                  // a racing takeover or legacy/ownerless lock stays closed.
                  rmdirSync(path.join(lock, old))
                  rmdirSync(lock)
                } catch (error_: unknown) {
                  if (![MISSING, EXISTS, 'ENOTEMPTY'].includes(storeErrorCode(error_) ?? ''))
                    throw unavailable(error_)
                }
              }
            }
          }
        }
        await deps.sleep(DAILY_BUDGET_LOCK_WAIT_MS)
      }
    }
    if (!hasLock) throw unavailable()
    try {
      return await operation()
    } finally {
      if (deps.recoverUnsent === true) {
        rmdirSync(path.join(lock, marker))
        rmdirSync(lock)
      } else await rmdir(lock)
    }
  }

  const recoverUnsent = async (scope: Scope, seed: Seed) => {
    if (deps.recoverUnsent !== true) return
    // D2: calibrate the kernel record against this process first. A wrong
    // tick rate (or an unreadable record) disables start-time recovery and
    // keeps pid-existence recovery, never the reverse.
    const selfStart = processStartMs(process.pid)
    const isStartReliable =
      selfStart !== undefined &&
      Math.abs(selfStart - ownerStartMs) < DAILY_BUDGET_OWNER_START_SKEW_MS
    const claimIds = readdirSync(path.join(scope.directory, CLAIMS_DIRECTORY))
    for (const claimId of claimIds) {
      const claim = readClaim(scope, seed, claimId)
      if (claim.ownerPid === undefined || claim.settledUsd !== undefined) continue
      let isGone = false
      try {
        process.kill(claim.ownerPid, 0)
      } catch (error: unknown) {
        // EPERM is still live/unknown; age is never proof of death.
        if (storeErrorCode(error) !== 'ESRCH') continue
        isGone = true
      }
      if (
        !isGone &&
        isStartReliable &&
        claim.ownerStartMs !== undefined &&
        claim.ownerPid !== process.pid
      ) {
        // The pid answers, but for a process that started somewhere else:
        // the OS handed the owner's pid to someone new.
        const start = processStartMs(claim.ownerPid)
        if (
          start !== undefined &&
          Math.abs(start - claim.ownerStartMs) >= DAILY_BUDGET_OWNER_START_SKEW_MS
        )
          isGone = true
      }
      if (!isGone) continue
      const directory = path.join(scope.directory, CLAIMS_DIRECTORY, claimId)
      const wasSent = await isPresent(path.join(directory, SENT_DIRECTORY))
      await writeFileAtomically(
        path.join(directory, CLAIM_FILE),
        JSON.stringify({
          ...claim,
          settledUsd: wasSent ? claim.reservedUsd : '0',
          hasUnknownCost: wasSent,
        }),
        options,
      )
    }
  }

  // D2: every process that reads the ledger recovers first. Best effort:
  // a display read never breaks here; reserve paths still fail closed.
  const recoverBestEffort = async (scope: Scope): Promise<void> => {
    if (deps.recoverUnsent !== true) return
    try {
      await recoverUnsent(scope, readSeed(scope))
    } catch {
      // The totals below still validate the scope; reserve paths throw.
    }
  }

  return {
    async reserveAdmitted(sessionId, accountId, costUsd, capUsd) {
      const scope = scopeFor(sessionId, accountId)
      let claim: SessionBudgetClaim | undefined
      try {
        return await withReservationLock(scope, async () => {
          assertCost(capUsd)
          if (Usd.from(capUsd).compare(Usd.from(0)) <= 0) throw unavailable()
          const seed = await ensure(scope)
          await recoverUnsent(scope, seed)
          claim = claimFor(scope, seed, await writeClaim(scope, seed, costUsd, true))
          claim.check(capUsd)
          return claim
        })
      } catch (error: unknown) {
        // Releasing the admission lock is also awaited after publication.
        // A failure there must not strand a claim that never reached its caller.
        await claim?.settle(Usd.from(0).toAmount())
        throw error
      }
    },
    async readExisting(sessionId, accountId) {
      const scope = scopeFor(sessionId, accountId)
      if (!(await isPresent(scope.intent)) && !(await isPresent(scope.directory))) return
      await recoverBestEffort(scope)
      const { spent, held: _held, openClaims: _open, ...total } = totalFor(scope, true)
      return { ...total, spentUsd: spent.toAmount() }
    },
    async describeStop(sessionId, accountId, capUsd) {
      const stop = deps.dailyStop
      if (stop === undefined) throw unavailable()
      assertCost(capUsd)
      const scope = scopeFor(sessionId, accountId)
      const seed = await ensure(scope)
      // Fail-closed: a caller that cannot describe keeps its plain refusal.
      await recoverUnsent(scope, seed)
      const total = totalFor(scope)
      const settled = total.spent.subtract(Usd.from(total.held))
      const details: PaidStopDetails = {
        limitUsd: Usd.from(capUsd).toAmount(),
        spentUsd: settled.toAmount(),
        heldUsd: total.held,
        openClaims: total.openClaims,
        resetsAtMs: nextMidnightMs(stop.nowMs()),
        setting: stop.setting,
      }
      return new PaidBudgetStopError(formatPaidBudgetStop(details), details)
    },
    lookupByClaimId(sessionId, accountId, claimId) {
      const scope = scopeFor(sessionId, accountId)
      const { reservedUsd, settledUsd, retainedUsd, ...fields } = readClaim(
        scope,
        readSeed(scope),
        claimId,
      )
      return Promise.resolve({
        ...fields,
        reservedUsd: Usd.from(reservedUsd).toAmount(),
        ...(settledUsd !== undefined && { settledUsd: Usd.from(settledUsd).toAmount() }),
        ...(retainedUsd !== undefined && { retainedUsd: Usd.from(retainedUsd).toAmount() }),
      })
    },
    async read(sessionId, accountId) {
      const scope = scopeFor(sessionId, accountId)
      await ensure(scope)
      await recoverBestEffort(scope)
      return projectedTotal(scope)
    },
    async reserve(sessionId, accountId, costUsd, flags = {}) {
      const scope = scopeFor(sessionId, accountId)
      return await withReservationLock(scope, async () => {
        const seed = await ensure(scope)
        await recoverUnsent(scope, seed)
        return claimFor(
          scope,
          seed,
          await writeClaim(scope, seed, costUsd, true, claimFlagsSchema.parse(flags)),
        )
      })
    },
    async record(sessionId, accountId, actualCostUsd, hasUnknownCost = false) {
      const scope = scopeFor(sessionId, accountId)
      const seed = await ensure(scope)
      return await claimFor(
        scope,
        seed,
        await writeClaim(
          scope,
          seed,
          actualCostUsd,
          false,
          claimFlagsSchema.parse({ hasUnknownCost }),
        ),
      ).settle(actualCostUsd)
    },
    async project(session) {
      if (session.accountId === undefined) {
        return session
      }
      const scope = scopeFor(session.sessionId, session.accountId)
      if (!(await isPresent(scope.intent)) && !(await isPresent(scope.directory))) {
        return session
      }
      const total = totalFor(scope)
      const { budgetIsFreshFork: _initialFork, ...projected } = session
      return { ...projected, budgetSpentUsd: total.spent.toAmount() }
    },
  }
}
