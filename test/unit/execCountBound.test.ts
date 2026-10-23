// The byte-bound fallback's info line: a failed exact count names its
// redacted HTTP failure, an over-length count has its own line, and the
// estimate keeps its margin line. Real ledger tickets flow into the real
// line selector; the failure detail is read from real ModelApiError values.
import { describe, expect, it, beforeEach } from 'vitest'
import { inputBoundInfoLine } from '../../src/runtime/exec/inputBoundLine'
import { countFailureDetail } from '../../src/runtime/runtimeAccountingEntry'
import { ModelApiError } from '../../src/core/backends/modelapi/transport'
import { createRunLedger } from '../../src/runtime/exec/runLedger'
import { Usd } from '../../src/shared/usd'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'

function ticket(
  inputBound: 'exact' | 'estimate' | 'bytes-after-failure' | 'bytes-over-length',
  countFailure?: { status: number; kind: string },
) {
  const ledger = createRunLedger({ capUsd: Usd.from(1).toAmount(), maxRequests: 1 })
  const admitted = ledger.admitResponse({
    model: 'anthropic/claude-haiku-4-5',
    maxOutputTokens: 1024,
    reserveUsd: Usd.from(1).toAmount(),
    price: {
      input: Usd.from(5).toAmount(),
      cachedInput: Usd.from(5).toAmount(),
      output: Usd.from(90).toAmount(),
    },
    inputBound,
    ...(countFailure !== undefined && { countFailure }),
  })
  if ('refused' in admitted) throw new Error(admitted.refused)
  return admitted
}

describe('count failure detail', () => {
  it('reads the status and error type from a provider answer', () => {
    expect(
      countFailureDetail(new ModelApiError('overloaded', 529, 'overloaded_error', undefined)),
    ).toEqual({ status: 529, kind: 'overloaded_error' })
  })

  it('never passes provider-shaped text through as the kind', () => {
    expect(countFailureDetail(new ModelApiError('bad', 400, 'not a word!', undefined))).toEqual({
      status: 400,
      kind: 'an unrecognized value',
    })
  })

  it('reads no detail where no provider answer exists', () => {
    expect(countFailureDetail(new ModelApiError('down', 0, undefined, undefined))).toBeUndefined()
    expect(countFailureDetail(new ModelApiError('bare', 500, undefined, undefined))).toBeUndefined()
    expect(countFailureDetail(new Error('models unavailable'))).toBeUndefined()
    expect(countFailureDetail('boom')).toBeUndefined()
    expect(countFailureDetail(undefined)).toBeUndefined()
  })
})

describe('input bound info line', () => {
  beforeEach(() => {
    setUiText(EN, BASE_LOCALE)
  })

  it('names the redacted HTTP failure on a failed count', () => {
    expect(
      inputBoundInfoLine(ticket('bytes-after-failure', { status: 429, kind: 'rate_limit_error' })),
    ).toBe(
      'The provider input count failed (HTTP 429, rate_limit_error), so the byte bound reserves this request instead.',
    )
  })

  it('keeps the generic line where the failure carried no HTTP answer', () => {
    expect(inputBoundInfoLine(ticket('bytes-after-failure'))).toBe(
      'The provider input count failed, so the byte bound reserves this request instead.',
    )
  })

  it('gives a rejected over-length count its own line', () => {
    expect(inputBoundInfoLine(ticket('bytes-over-length'))).toBe(
      'The provider input count exceeded the request size, so the byte bound reserves this request instead.',
    )
  })

  it('keeps the estimate margin line and stays silent otherwise', () => {
    expect(inputBoundInfoLine(ticket('estimate'))).toBe(
      'Input reservation: provider estimate + 25%, capped by the upper bound from size.',
    )
    expect(inputBoundInfoLine(ticket('exact'))).toBeUndefined()
    expect(inputBoundInfoLine({})).toBeUndefined()
  })
})
