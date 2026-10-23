import { describe, expect, it } from 'vitest'
import {
  ChildTaskRefusedError,
  ContextOverflowError,
  modelApiFailureRetryable,
} from '../../src/core/backends/modelapi/ModelApiHost'
import {
  SessionBudgetExceededError,
  ModelCallLimitError,
} from '../../src/core/backends/modelapi/sessionBudget'
import { MissingApiKeyError, ModelApiError } from '../../src/core/backends/modelapi/transport'
import { SpendLedgerError } from '../../src/core/paid/spendLedgerError'
import { CHATGPT_PLAN_LIMIT_ERROR_KIND } from '../../src/shared/constants'

// RLF-ACPTURNS: a failed Model API turn carries whether resubmitting may
// work. Only durable state the turn itself cannot clear says no; a
// model-call limit completes rather than fails, so it carries no judgment.

describe('modelApiFailureRetryable', () => {
  it('says no for durable state the turn cannot clear', () => {
    expect(
      modelApiFailureRetryable(
        new ContextOverflowError('error', 'muse-spark-1.3', 100_000, 'too long'),
      ),
    ).toBe(false)
    expect(modelApiFailureRetryable(new SessionBudgetExceededError('spent'))).toBe(false)
    expect(
      modelApiFailureRetryable(
        new ModelApiError('limited', 403, 'plan', CHATGPT_PLAN_LIMIT_ERROR_KIND),
      ),
    ).toBe(false)
    expect(modelApiFailureRetryable(new SpendLedgerError('damaged', { scope: 'session' }))).toBe(
      false,
    )
    expect(modelApiFailureRetryable(new MissingApiKeyError())).toBe(false)
    expect(
      modelApiFailureRetryable(new ModelApiError('denied', 401, 'auth', 'invalid_api_key')),
    ).toBe(false)
  })

  it('says yes for per-attempt conditions the next attempt re-evaluates', () => {
    expect(modelApiFailureRetryable(new ChildTaskRefusedError('tariffUnknown'))).toBe(true)
    expect(modelApiFailureRetryable(new ChildTaskRefusedError('consentDeclined'))).toBe(true)
    expect(modelApiFailureRetryable(new ModelApiError('broke', 500, 'modelError', undefined))).toBe(
      true,
    )
    expect(modelApiFailureRetryable(new ModelApiError('dropped', 0, undefined, undefined))).toBe(
      true,
    )
    expect(modelApiFailureRetryable(new Error('the store failed'))).toBe(true)
  })

  it('carries no judgment for a model-call limit, which completes', () => {
    expect(modelApiFailureRetryable(new ModelCallLimitError(1))).toBeUndefined()
  })
})
