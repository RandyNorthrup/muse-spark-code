// A non-OK answer from the plan route says what OpenAI answered. The
// fixture is the lead's 2026-10-14 capture through our own app on
// Windows: POST /v1/responses answered HTTP 400 with this body. These
// run through the real error envelope, the real sentence template and
// the real shared retry policy with recorded data: no sign-in, no model
// call and no request runs here.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { errorBodySchema } from '../../src/core/backends/modelapi/schemas'
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
})
