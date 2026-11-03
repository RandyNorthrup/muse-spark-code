import { describe, expect, it } from 'vitest'
import { modelApiLimitFailureOf } from '../../src/core/backends/modelapi/ModelApiHost'
import {
  ModelCallLimitError,
  SessionBudgetExceededError,
} from '../../src/core/backends/modelapi/sessionBudget'
import { ModelApiError } from '../../src/core/backends/modelapi/modelApiError'
import { MODEL_API_BUDGET_ERROR_KIND, RATE_LIMITED_ERROR_KIND } from '../../src/shared/constants'

// M88 lane C (PLAN.md D67, item 16): a failed Model API turn names its
// limit for the failed row's offer. A 429 past the client's retries
// names `rateLimited` with the last Retry-After's wait; a spent
// session budget names `budget`; a quota refusal and a model-call
// limit name nothing.

function refusal(
  message: string,
  kind: string | undefined,
  code: string | undefined,
): ModelApiError {
  return new ModelApiError(message, 429, kind, code)
}

describe('modelApiLimitFailureOf', () => {
  it('names a bare 429 rateLimited, with the last Retry-After when named', () => {
    const waited = refusal('slow down', 'rate_limit_error', undefined)
    waited.retryAfterMs = 45_000
    expect(modelApiLimitFailureOf(waited)).toEqual({
      errorKind: RATE_LIMITED_ERROR_KIND,
      retryAfterMs: 45_000,
    })
    expect(modelApiLimitFailureOf(refusal('slow down', undefined, undefined))).toEqual({
      errorKind: RATE_LIMITED_ERROR_KIND,
    })
  })

  it('names a spent session budget, but never a model-call limit', () => {
    expect(modelApiLimitFailureOf(new SessionBudgetExceededError('spent'))).toEqual({
      errorKind: MODEL_API_BUDGET_ERROR_KIND,
    })
    expect(modelApiLimitFailureOf(new ModelCallLimitError(1))).toBeUndefined()
  })

  it('names nothing for quota refusals and ordinary failures', () => {
    expect(
      modelApiLimitFailureOf(refusal('no credit', 'credit', 'insufficient_quota')),
    ).toBeUndefined()
    expect(modelApiLimitFailureOf(refusal('weekly cap', undefined, '1310'))).toBeUndefined()
    expect(
      modelApiLimitFailureOf(new ModelApiError('broke', 500, 'modelError', undefined)),
    ).toBeUndefined()
    expect(modelApiLimitFailureOf(new Error('the store failed'))).toBeUndefined()
  })
})
