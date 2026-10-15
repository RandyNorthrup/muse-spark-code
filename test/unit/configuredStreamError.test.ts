import { describe, expect, it } from 'vitest'
import {
  configuredProviderStreamError,
  configuredStreamError,
} from '../../src/core/providers/configured'
import { ModelApiError } from '../../src/core/backends/modelapi/transport'
import { SessionBudgetExceededError } from '../../src/core/backends/modelapi/sessionBudget'
import { UI_TEXT } from '../../src/shared/constants'

// Lane LIMITSA, F88: a configured provider send masks nothing. Every product
// error keeps its own words and HTTP status; unknown failures never blame
// the panel. Pure: the real classifiers, values passed in as data.
describe('configuredStreamError', () => {
  it('rethrows the provider’s own error with its status and message', () => {
    const provider = new ModelApiError('Bad request: unknown model', 400, 'invalid_request', 'x')
    const error = configuredStreamError(provider)
    expect(error.message).toBe('HTTP 400: Bad request: unknown model')
    expect(error).toMatchObject({ status: 400, kind: 'invalid_request', code: 'x' })
  })

  it('keeps the HTTP status from a separately bundled provider constructor', () => {
    const error = configuredStreamError({
      name: 'ModelApiError',
      message: 'Invalid model',
      status: 400,
      kind: 'invalid_request_error',
      code: 'invalid_model',
    })
    expect(error.message).toBe('HTTP 400: Invalid model')
  })

  it('rethrows the session-budget refusal in its own words', () => {
    const budget = new SessionBudgetExceededError(
      'Stopped: the next request (about $0.11) would pass the session budget of $0.10.',
    )
    expect(configuredStreamError(budget)).toBe(budget)
  })

  it('rethrows a paid-daily stop in its own words', () => {
    const stopped = new Error('Paid extras are stopped until tomorrow.')
    expect(configuredStreamError(stopped)).toBe(stopped)
  })

  it('rethrows a stalled stream in its own words', () => {
    const stalled = new ModelApiError('The stream stalled.', 0, undefined, undefined)
    expect(configuredStreamError(stalled)).toBe(stalled)
  })

  it('gives a wordless throw an honest request failure', () => {
    const error = configuredStreamError('boom')
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('unknown_provider_failure')
    expect(error.message).not.toBe(UI_TEXT.modelsPanelUnavailable)
  })
})

describe('configuredProviderStreamError', () => {
  it('keeps an error event’s message and code', () => {
    const error = configuredProviderStreamError(
      { type: 'error', code: 'invalid_api_key', message: 'bad key' },
      401,
    )
    expect(error).toBeInstanceOf(ModelApiError)
    expect(error?.message).toBe('bad key')
    expect(error?.status).toBe(401)
    expect(error?.code).toBe('invalid_api_key')
    expect(error?.message).not.toContain('Models & Agents')
  })

  it('keeps a failed response’s error message and code', () => {
    const error = configuredProviderStreamError(
      {
        type: 'response.failed',
        response: {
          id: 'r1',
          status: 'failed',
          output: [],
          error: { code: 'server_error', message: 'provider blew up' },
        },
      },
      200,
    )
    expect(error?.message).toBe('provider blew up')
    expect(error?.code).toBe('server_error')
  })

  it('passes a completed response without an error through', () => {
    expect(
      configuredProviderStreamError(
        { type: 'response.completed', response: { id: 'r1', status: 'completed', output: [] } },
        200,
      ),
    ).toBeUndefined()
  })
})
