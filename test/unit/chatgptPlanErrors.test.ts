// A non-OK answer from the plan route says what OpenAI answered. The
// fixtures are the lead's 2026-10-14 captures through our own app on
// Windows: GET /v1/models answered the catalogue entry, and POST
// /v1/responses answered HTTP 400 with its body. These run through the
// real error envelope, the real sentence template, the real shared retry
// policy. The former client case replaced our grant host and Meta client;
// it was removed under the owner's no-stand-ins rule. Product refusal text
// remains a real-life scenario for the lead; no live request runs here.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { errorBodySchema } from '../../src/core/backends/modelapi/schemas'
import { planRequestError } from '../../src/core/providers/subscriptions/registry'
import { fill, UI_TEXT } from '../../src/shared/l10n/text'
import { classifyRetry, RETRY_TABLES, type RetryFailure } from '../../src/shared/retryPolicy'

function capturedBody(): unknown {
  return JSON.parse(
    readFileSync(
      new URL('../fixtures/chatgpt-catalogue/plan-400-missing-description.json', import.meta.url),
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

  it('names the HTTP status where no envelope answers, keeping retry for the documented 503', async () => {
    expect(errorBodySchema.safeParse('<html>proxy error</html>').success).toBe(false)
    expect(errorBodySchema.safeParse({ error: { message: '' } }).success).toBe(true)
    // A refusal with no words from OpenAI is not a generic outage: its status is the cause.
    const empty = await planRequestError(new Response('', { status: 500 }))
    expect(empty.code).toBe('request-failed')
    expect(empty.message).toBe('The ChatGPT plan request failed: HTTP 500')
    expect(empty.message).not.toContain('temporarily unavailable')
    // The documented transient keeps the standing retry sentence.
    const unavailable = await planRequestError(new Response('', { status: 503 }))
    expect(unavailable.message).toBe(UI_TEXT.planUi.retry)
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
})
