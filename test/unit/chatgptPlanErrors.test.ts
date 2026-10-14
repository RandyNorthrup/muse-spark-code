// A non-OK answer from the plan route says what OpenAI answered. The
// fixtures are the lead's 2026-10-14 captures through our own app on
// Windows: GET /v1/models answered the catalogue entry, and POST
// /v1/responses answered HTTP 400 with its body. These run through the
// real error envelope, the real sentence template, the real shared retry
// policy and, last, the real subscription client over a replaying fetch,
// with a test-owned sign-in record that never leaves this process: no
// live request runs here.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { errorBodySchema } from '../../src/core/backends/modelapi/schemas'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import {
  ChatGptSignIn,
  type ChatGptHostPort,
  type ChatGptRecord,
} from '../../src/core/providers/subscriptions/chatgpt'
import { createSubscriptionClient } from '../../src/core/providers/subscriptions/registry'
import { providerEntrySchema, type ProvidersFile } from '../../src/core/providers/providersFile'
import { fill, UI_TEXT } from '../../src/shared/l10n/text'
import { classifyRetry, RETRY_TABLES, type RetryFailure } from '../../src/shared/retryPolicy'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'

function capturedBody(): unknown {
  return JSON.parse(
    readFileSync(
      new URL('../fixtures/chatgpt-catalogue/plan-400-missing-description.json', import.meta.url),
      'utf8',
    ),
  )
}

function capturedEntry(): unknown {
  return JSON.parse(
    readFileSync(
      new URL('../fixtures/chatgpt-catalogue/gpt-6.1-sol.json', import.meta.url),
      'utf8',
    ),
  )
}

function failure(status: number, kind?: string, code?: string): RetryFailure {
  return {
    status,
    kind,
    code,
    message: "Missing required parameter: 'tools[0].description'.",
    retryAfterMs: undefined,
  }
}

describe('chatgpt plan request errors', () => {
  it('reports OpenAI’s own message for the captured 400', () => {
    const parsed = errorBodySchema.safeParse(capturedBody())
    if (!parsed.success) throw new Error('the captured 400 parses as the error envelope')
    expect(parsed.data.error.message).toBe("Missing required parameter: 'tools[0].description'.")
    expect(fill(UI_TEXT.planUi.requestFailed, { message: parsed.data.error.message })).toBe(
      "The ChatGPT plan request failed: Missing required parameter: 'tools[0].description'.",
    )
  })

  it('keeps the retry sentence where no envelope answers', () => {
    expect(errorBodySchema.safeParse('<html>proxy error</html>').success).toBe(false)
    expect(errorBodySchema.safeParse({ error: { message: '' } }).success).toBe(true)
    expect(UI_TEXT.planUi.retry).toBe('ChatGPT is temporarily unavailable. Try again.')
  })

  it('never retries a 400, while 429 stays retryable', () => {
    expect(
      classifyRetry(
        RETRY_TABLES.responses,
        failure(400, 'invalid_request_error', 'missing_required_parameter'),
      ),
    ).toEqual({ retry: false, reason: 'not-retryable' })
    expect(classifyRetry(RETRY_TABLES.responses, failure(403)).retry).toBe(false)
    expect(classifyRetry(RETRY_TABLES.responses, failure(429)).retry).toBe(true)
  })

  it('yields OpenAI’s message once through the real subscription client', async () => {
    // A test-owned grant that never refreshes: the expiry stays ahead, so
    // the client sends the stored token and no OAuth exchange runs.
    const record: ChatGptRecord = {
      v: 1,
      auth: 'subscription',
      origin: 'https://api.openai.com',
      issuer: 'https://auth.openai.com',
      clientId: 'test-owned-client',
      hostId: 'urn:uuid:12345678-1234-1234-1234-1234567890ab',
      accessToken: 'test-owned-access',
      refreshToken: 'test-owned-refresh',
      expiresAt: Date.now() + 3_600_000,
      scope: 'openid chatgpt.tokens.use.direct',
      nonce: 'test-owned-nonce',
    }
    const host: ChatGptHostPort = {
      hostId: record.hostId,
      fetch: () => Promise.reject(new Error('no HTTP past the replay')),
      now: Date.now,
      openBrowser: () => Promise.reject(new Error('no browser in this test')),
      startCallback: () => Promise.reject(new Error('no callback in this test')),
      readRecord: () => Promise.resolve(record),
      writeRecord: () => Promise.resolve(),
      deleteRecord: () => Promise.resolve(),
      withRefreshLock: (work) => work(),
    }
    const posts: string[] = []
    const replay: typeof fetch = (url, init) => {
      let href: string
      if (typeof url === 'string') href = url
      else if (url instanceof URL) href = url.href
      else href = url.url
      if (href === 'https://api.openai.com/v1/models' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(Response.json({ models: [capturedEntry()] }))
      }
      if (href === 'https://api.openai.com/v1/responses' && init?.method === 'POST') {
        posts.push(typeof init.body === 'string' ? init.body : '')
        return Promise.resolve(Response.json(capturedBody(), { status: 400 }))
      }
      throw new Error(`unexpected replay path ${href}`)
    }
    const file: ProvidersFile = {
      v: 1,
      providers: [
        providerEntrySchema.parse({
          id: 'chatgpt',
          preset: 'chatgpt',
          address: 'https://api.openai.com',
          format: 'responses',
          auth: 'subscription',
          models: ['gpt-6.1-sol'],
        }),
      ],
    }
    const client = createSubscriptionClient(
      fakeModelApiClient(fakeModelApi(), new FakeLogOutputChannel()),
      {
        fetch: replay,
        providers: () => Promise.resolve(file),
        chatgpt: () => Promise.resolve(new ChatGptSignIn(host)),
        accountId: () => Promise.resolve('test-account'),
      },
    )
    const body: CreateResponseBody = {
      model: 'chatgpt/gpt-6.1-sol',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'say hello' }] },
      ],
      instructions: 'Plan-route error replay',
      tools: [],
      tool_choice: 'auto',
      reasoning: { effort: 'low' },
      stream: true,
      store: false,
      include: [],
      max_output_tokens: 32,
      prompt_cache_key: 'plan-error-replay',
      prompt_cache_retention: 'in_memory',
    }
    const events = await Array.fromAsync(
      client.streamResponse(body, new AbortController().signal, undefined, undefined, undefined, {
        modelId: body.model,
        keyDigest: 'test',
        isStillAllowed: () => true,
        onRequestStarted: () => undefined,
      }),
    )
    expect(events).toHaveLength(1)
    const first = events[0]
    if (first?.type !== 'error') throw new Error('expected one error event')
    expect(first.message).toBe(
      "The ChatGPT plan request failed: Missing required parameter: 'tools[0].description'.",
    )
    expect(posts).toHaveLength(1)
  })
})
