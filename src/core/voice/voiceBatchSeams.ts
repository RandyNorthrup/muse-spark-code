// M105 lane V, seam 4: the paid consent and reserve adapters Muse Voice's
// batch transcription runs under, built over the money ports every host
// already binds for the Model API backend (one set, never a fork):
// - consent: the host's paid-use question (`allowsPaidUse`). VS Code's D78
//   popup asks once with the price and the shared daily budget; ACP asks its
//   client; headless has only what its explicit flag turned on.
// - reserve: D78's shared daily ledger (`reservePaidExtra`, exact UsdAmount)
//   and, when the conversation has an M82 cap, the owner's running total.
//   The batch cost is bounded (the file's duration is known before the
//   POST), so under a cap it is estimate-checked against what is left
//   (D121), never held; both are rechecked synchronously at the send, and
//   settled from the receipt; an unknown bill is counted as cost unknown.
// - usage: the window's loud tally (`notePaidUse('voice', seconds)`).
import { SessionBudgetExceededError } from '../backends/modelapi/sessionBudget'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import type { PaidUseRequest } from '../../shared/paid'
import { Usd, type UsdAmount } from '../../shared/usd'
import type { ModelApiPaidHooks } from '../backends/modelapi/ModelApiHost'
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
  /**
  M82: the owner conversation's limit and running total (D121), for the
  batch cost to be checked against and charged to. Absent: this turn has
  no conversation-cap path, so only the daily ledger admits.
  */
  readonly session:
    | {
        readonly capUsd: () => UsdAmount
        readonly spentUsd: () => UsdAmount
        readonly charge: (costUsd: UsdAmount | undefined) => void
      }
    | undefined
}

/** One bounded batch cost admitted against the owner's running total. */
interface SessionAdmission {
  readonly check: () => void
  readonly settle: (amountUsd: UsdAmount | undefined) => Promise<void>
}

const ZERO = Usd.from(0).toAmount()

/** Refunds every claim taken so far; the first refund failure is the one reported. */
async function refund(claims: readonly (PaidExtraClaim | SessionAdmission)[]): Promise<void> {
  const results = await Promise.allSettled(claims.map((claim) => claim.settle(ZERO)))
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected')
    throw new Error(UI_TEXT.paidDailyLedgerUnavailable, { cause: failed.reason })
}

/**
The batch's bounded cost against what is left of the owner's cap (D121):
a request whose cost would pass the cap is not sent, with the same
sentence the request path says. Nothing is held.
*/
function checkSessionFits(
  session: NonNullable<VoiceBatchSeamDeps['session']>,
  amount: UsdAmount,
): void {
  const cap = session.capUsd()
  const spent = session.spentUsd()
  if (Usd.from(spent).add(Usd.from(amount)).compare(Usd.from(cap)) > 0)
    throw new SessionBudgetExceededError(
      fill(UI_TEXT.sessionBudgetStopped, {
        estimate: formatUsd(amount),
        cap: formatUsd(cap),
        spent: formatUsd(spent),
      }),
    )
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
    const scope = deps.session
    let session: SessionAdmission | undefined
    try {
      signal.throwIfAborted()
      if (scope !== undefined && Usd.from(scope.capUsd()).compare(Usd.from(0)) > 0) {
        checkSessionFits(scope, amount)
        const owned = scope
        session = {
          check: () => {
            checkSessionFits(owned, amount)
          },
          settle: (settled) => {
            owned.charge(settled)
            return Promise.resolve()
          },
        }
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
        owned?.check()
      },
      settle: async (actual) => {
        const settled = actual?.toAmount() ?? amount
        const hasUnknownCost = actual === undefined
        try {
          await owned?.settle(hasUnknownCost ? undefined : settled)
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
