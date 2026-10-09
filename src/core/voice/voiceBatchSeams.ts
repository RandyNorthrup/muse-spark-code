// M105 lane V, seam 4: the paid consent and reserve adapters Muse Voice's
// batch transcription runs under, built over the money ports every host
// already binds for the Model API backend (one set, never a fork):
// - consent: the host's paid-use question (`allowsPaidUse`). VS Code's D78
//   popup asks once with the price and the shared daily budget; ACP asks its
//   client; headless has only what its explicit flag turned on.
// - reserve: D78's shared daily ledger (`reservePaidExtra`, exact UsdAmount)
//   and, when the session has an M82 cap, the session journal. Both are
//   durable before the POST, rechecked synchronously at the send, and
//   settled from the receipt; an unknown bill keeps the reservation.
// - usage: the window's loud tally (`notePaidUse('voice', seconds)`).
import { UI_TEXT } from '../../shared/constants'
import type { PaidUseRequest } from '../../shared/paid'
import { Usd, type UsdAmount } from '../../shared/usd'
import type { ModelApiPaidHooks } from '../backends/modelapi/ModelApiHost'
import type { SessionBudgetClaim, SessionBudgetJournal } from '../backends/modelapi/sessionBudget'
import type { AudioMessagePreparationDeps } from './audioMessagePreparation'
import type { BatchSpendClaim } from './transcribeBatch'

/** One exact reservation on D78's shared daily ledger. */
export interface PaidExtraClaim {
  readonly reservedUsd: UsdAmount
  /** Synchronous final admission: today's cap, Stop and the owner. */
  readonly check: () => void
  readonly settle: (amountUsd: UsdAmount, hasUnknownCost?: boolean) => Promise<unknown>
}

export type ReservePaidExtra = (costUsd: UsdAmount, signal: AbortSignal) => Promise<PaidExtraClaim>

export interface VoiceBatchSeamDeps extends Pick<
  ModelApiPaidHooks,
  'isPaidFeatureOn' | 'allowsPaidUse' | 'notePaidUse'
> {
  readonly sessionId: string
  /** D78's exact daily reservation. Absent: nothing billed outside a request can be admitted. */
  readonly reservePaidExtra: ReservePaidExtra | undefined
  /** M82: the session cap now (0 is none), its journal and the key's account. */
  readonly session: {
    readonly capUsd: () => UsdAmount
    readonly journal: SessionBudgetJournal | undefined
    readonly accountId: () => Promise<string | undefined>
  }
}

const ZERO = Usd.from(0).toAmount()

/** Refunds every claim taken so far; the first refund failure is the one reported. */
async function refund(claims: readonly (PaidExtraClaim | SessionBudgetClaim)[]): Promise<void> {
  const results = await Promise.allSettled(claims.map((claim) => claim.settle(ZERO)))
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected')
    throw new Error(UI_TEXT.paidDailyLedgerUnavailable, { cause: failed.reason })
}

/** The voice batch's gate, consent, reserve and tally over the host's money ports. */
export function voiceBatchSeams(
  deps: VoiceBatchSeamDeps,
): Pick<AudioMessagePreparationDeps, 'gate' | 'consent' | 'reserve' | 'usage'> {
  const reserve = async (cost: Usd, signal: AbortSignal): Promise<BatchSpendClaim> => {
    signal.throwIfAborted()
    if (deps.reservePaidExtra === undefined) throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
    const amount = cost.toAmount()
    const daily = await deps.reservePaidExtra(amount, signal)
    let session: SessionBudgetClaim | undefined
    try {
      signal.throwIfAborted()
      const capUsd = deps.session.capUsd()
      if (Usd.from(capUsd).compare(Usd.from(0)) > 0) {
        const accountId = await deps.session.accountId()
        if (accountId === undefined || deps.session.journal === undefined)
          throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
        session = await deps.session.journal.reserve(deps.sessionId, accountId, amount)
        session.check(deps.session.capUsd())
      }
      daily.check()
    } catch (error: unknown) {
      await refund(session === undefined ? [daily] : [daily, session])
      throw error
    }
    const owned = session
    return {
      admitSend: () => {
        daily.check()
        owned?.check(deps.session.capUsd())
      },
      settle: async (actual) => {
        const settled = actual?.toAmount() ?? amount
        const hasUnknownCost = actual === undefined
        try {
          await owned?.settle(settled, hasUnknownCost)
        } finally {
          await daily.settle(settled, hasUnknownCost)
        }
      },
    }
  }
  return {
    gate: { isOn: (feature) => deps.isPaidFeatureOn(feature) },
    consent: {
      allows: async (request: PaidUseRequest, requiresAsking = false) =>
        (await deps.allowsPaidUse(request, requiresAsking, deps.sessionId)) === true,
    },
    reserve,
    usage: {
      addVoiceBatch: (seconds) => {
        deps.notePaidUse('voice', seconds)
      },
    },
  }
}
