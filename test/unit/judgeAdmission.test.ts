// The judge's admission ledger faults (D119 catch burn-down): a ledger fault
// refuses (ledger-unavailable), a paid stop is never a ledger fault, and
// anything else surfaces wrapped with its cause instead of masquerading as
// a refusal the caller could retry as a send failure. The ledgers below are
// the module's own injected seam failing for real; every refusal and every
// rejection is asserted through the real admit/verify functions.
import { describe, expect, it } from 'vitest'
import {
  admitJudgeCall,
  JudgeLedgerError,
  verifyJudgeDispatch,
  type JudgeAdmissionBinding,
  type JudgeAdmissionClaim,
  type JudgeDailyLedger,
  type JudgeLedgerClaim,
} from '../../src/core/judge/admission'
import { UserRefusalError } from '../../src/core/refusal'
import { Usd } from '../../src/shared/usd'

const binding: JudgeAdmissionBinding = {
  ownerId: 'owner',
  modelId: 'model',
  engine: 'same',
  confidential: false,
  backend: 'modelApi',
  consent: 'granted',
}

const tariff = {
  input: Usd.from(0).toAmount(),
  cachedInput: Usd.from(0).toAmount(),
  output: Usd.from(0).toAmount(),
}

function ledgerWith(overrides: Partial<JudgeDailyLedger>): JudgeDailyLedger {
  return {
    remainingUsd: () => Promise.resolve(Usd.from(0).toAmount()),
    reserve: (costUsd) =>
      Promise.resolve({
        claimId: 'claim',
        reservedUsd: costUsd,
        check: () => {
          // Admitted by default; fault tests override the guard.
        },
        settle: () => Promise.resolve(),
      }),
    ...overrides,
  }
}

function request(ledger: JudgeDailyLedger) {
  return {
    binding,
    billing: { kind: 'metered' as const, ledger },
    estimatedInputTokens: 100,
    maxOutputTokens: 10,
    priceOf: () => tariff,
  }
}

/** The rejection of a promise that must fail, for asserting what surfaces. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error: unknown) {
    return error
  }
  throw new Error('expected the admission to fail')
}

describe('judge admission ledger faults', () => {
  it('refuses ledger-unavailable when the remaining read fails as a ledger fault', async () => {
    const admitted = await admitJudgeCall(
      request(
        ledgerWith({
          remainingUsd: () => Promise.reject(new JudgeLedgerError('store unreadable')),
        }),
      ),
    )
    expect(admitted).toEqual({ admitted: false, refusal: 'ledger-unavailable' })
  })

  it('wraps a foreign remaining-read failure with its cause instead of refusing', async () => {
    const cause = new Error('connection reset')
    const error = await rejectionOf(
      admitJudgeCall(
        request(
          ledgerWith({
            remainingUsd: () => Promise.reject(cause),
          }),
        ),
      ),
    )
    expect(error).toBeInstanceOf(JudgeLedgerError)
    expect((error as JudgeLedgerError).cause).toBe(cause)
  })

  it('lets a paid stop out of the remaining read instead of refusing it', async () => {
    const stop = new UserRefusalError('daily stop', 'daily_stopped')
    const error = await rejectionOf(
      admitJudgeCall(
        request(
          ledgerWith({
            remainingUsd: () => Promise.reject(stop),
          }),
        ),
      ),
    )
    expect(error).toBe(stop)
  })

  it('refuses over-budget when the reservation fails as a paid stop', async () => {
    const admitted = await admitJudgeCall(
      request(
        ledgerWith({
          reserve: () => Promise.reject(new UserRefusalError('daily stop', 'daily_stopped')),
        }),
      ),
    )
    expect(admitted).toEqual({ admitted: false, refusal: 'over-budget' })
  })

  it('refuses ledger-unavailable when the reservation fails as a ledger fault', async () => {
    const admitted = await admitJudgeCall(
      request(
        ledgerWith({
          reserve: () => Promise.reject(new JudgeLedgerError('store unwritable')),
        }),
      ),
    )
    expect(admitted).toEqual({ admitted: false, refusal: 'ledger-unavailable' })
  })

  it('wraps a foreign reservation failure with its cause instead of refusing', async () => {
    const cause = new TypeError('not a function')
    const error = await rejectionOf(
      admitJudgeCall(
        request(
          ledgerWith({
            reserve: () => Promise.reject(cause),
          }),
        ),
      ),
    )
    expect(error).toBeInstanceOf(JudgeLedgerError)
    expect((error as JudgeLedgerError).cause).toBe(cause)
  })

  it('refuses ledger-unavailable when the reservation guard fails as a ledger fault', async () => {
    const settled: string[] = []
    const failing: JudgeLedgerClaim = {
      claimId: 'claim',
      reservedUsd: Usd.from(0).toAmount(),
      check: () => {
        throw new JudgeLedgerError('claim invalid')
      },
      settle: () => {
        settled.push('zero')
        return Promise.resolve()
      },
    }
    const admitted = await admitJudgeCall(
      request(ledgerWith({ reserve: () => Promise.resolve(failing) })),
    )
    expect(admitted).toEqual({ admitted: false, refusal: 'ledger-unavailable' })
    expect(settled).toEqual(['zero'])
  })

  it('keeps a failed zero-settlement visible instead of refusing over it', async () => {
    const cause = new Error('disk full')
    const failing: JudgeLedgerClaim = {
      claimId: 'claim',
      reservedUsd: Usd.from(0).toAmount(),
      check: () => {
        throw new JudgeLedgerError('claim invalid')
      },
      settle: () => Promise.reject(cause),
    }
    const error = await rejectionOf(
      admitJudgeCall(request(ledgerWith({ reserve: () => Promise.resolve(failing) }))),
    )
    expect(error).toBeInstanceOf(JudgeLedgerError)
    expect((error as JudgeLedgerError).cause).toBe(cause)
  })

  it('wraps a foreign dispatch-check failure with its cause in verifyJudgeDispatch', async () => {
    const claim = await admitJudgeCall(request(ledgerWith({})))
    expect(claim.admitted).toBe(true)
    if (!claim.admitted) return
    const checked: JudgeAdmissionClaim = {
      ...claim.claim,
      check: () => {
        throw new Error('guard crashed')
      },
    }
    const error = await rejectionOf(verifyJudgeDispatch(checked, binding, ledgerWith({})))
    expect(error).toBeInstanceOf(JudgeLedgerError)
    expect((error as Error).message).toContain('Judge admission ledger failed')
  })

  it('refuses dispatch when the ledger read fails as a ledger fault', async () => {
    const claim = await admitJudgeCall(request(ledgerWith({})))
    expect(claim.admitted).toBe(true)
    if (!claim.admitted) return
    const verified = await verifyJudgeDispatch(
      claim.claim,
      binding,
      ledgerWith({
        remainingUsd: () => Promise.reject(new JudgeLedgerError('store unreadable')),
      }),
    )
    expect(verified).toEqual({ proceed: false, reason: 'ledger-unavailable' })
  })
})
