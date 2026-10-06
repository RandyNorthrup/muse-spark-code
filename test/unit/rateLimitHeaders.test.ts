import { ModelApiClient, type ResponseObservation } from '../../src/core/backends/modelapi/client'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { fakeModelApi, fakeModelApiClientSettings } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'
import { describe, expect, it } from 'vitest'
import { rateLimitHeaders } from '../../src/core/backends/modelapi/client'
import { USAGE_HEADER_MAX_CHARS } from '../../src/shared/constants'

const REQUEST: CreateResponseBody = {
  model: 'muse-spark-1.3',
  instructions: 'hello',
  input: [],
  tools: [],
  tool_choice: 'auto',
  reasoning: { effort: 'none', summary: 'auto' },
  stream: true,
  store: false,
  include: [],
  max_output_tokens: 100,
  prompt_cache_key: 'key',
  prompt_cache_retention: 'in_memory',
}

describe('response header recording', () => {
  it('keeps only the explicit allow list and never credentials or account headers', () => {
    expect(
      rateLimitHeaders(
        new Headers({
          'retry-after': '2',
          'X-RateLimit-Remaining-Tokens': '120',
          authorization: 'private credential',
          'x-ratelimit-account': 'private account',
          'x-request-id': 'private id',
          'x-codex-account-id': 'private account',
        }),
      ),
    ).toEqual({ 'retry-after': '2', 'x-ratelimit-remaining-tokens': '120' })
  })
  it('drops oversized and non-ASCII values without changing valid reported text', () => {
    expect(
      rateLimitHeaders(
        new Headers({
          'retry-after': 'a'.repeat(USAGE_HEADER_MAX_CHARS + 1),
          ratelimit: 'é',
          'ratelimit-policy': 'raw policy',
          'x-ratelimit-reset-tokens': '6m0s',
        }),
      ),
    ).toEqual({ 'ratelimit-policy': 'raw policy', 'x-ratelimit-reset-tokens': '6m0s' })
  })
})

describe('transport observations', () => {
  it('observes HTTP retries, rate limits and first token without changing the request', async () => {
    const api = fakeModelApi()
    api.script({ httpError: { status: 429 } }, { reasoning: 'thinking', text: 'answer' })
    const observations: ResponseObservation[] = []
    const settings = fakeModelApiClientSettings(new FakeLogOutputChannel())
    const client = new ModelApiClient({
      ...settings,
      fetch: async (input, init) => {
        const response = await api.fetch(input, init)
        response.headers.set('x-ratelimit-remaining-tokens', '120')
        response.headers.set('x-account-id', 'private account')
        return response
      },
    })
    const body = REQUEST
    const events = client.streamResponse(
      body,
      new AbortController().signal,
      undefined,
      undefined,
      Object.assign(() => undefined, {
        observe: (observation: ResponseObservation) => {
          observations.push(observation)
        },
      }),
    )
    let hasTerminal = false
    for await (const event of events) if (event.type === 'response.completed') hasTerminal = true
    expect(hasTerminal).toBe(true)
    expect(observations).toContainEqual(
      expect.objectContaining({
        rateLimited: true,
        headers: expect.objectContaining({ 'x-ratelimit-remaining-tokens': '120' }),
      }),
    )
    expect(observations).toContainEqual({ retries: 1 })
    expect(observations).toContainEqual({ firstTokenMs: 0 })
    expect(
      observations.filter((observation) => observation.firstTokenMs !== undefined),
    ).toHaveLength(1)
    expect(JSON.stringify(observations)).not.toContain('private account')
    expect(api.responseBodies()).toEqual([body, body])
  })
  it('a failed observer cannot fail a model response', async () => {
    const api = fakeModelApi()
    api.script({ text: 'answer' })
    const log = new FakeLogOutputChannel()
    const client = new ModelApiClient({
      ...fakeModelApiClientSettings(log),
      fetch: api.fetch,
    })
    const body = REQUEST
    const events = client.streamResponse(
      body,
      new AbortController().signal,
      undefined,
      undefined,
      Object.assign(() => undefined, {
        observe: () => {
          throw new Error('private failure')
        },
      }),
    )
    let hasTerminal = false
    for await (const event of events) if (event.type === 'response.completed') hasTerminal = true
    expect(hasTerminal).toBe(true)
    expect(log.warn).toHaveBeenCalledExactlyOnceWith('Usage observation failed')
  })
})
