// Lane PROVERR round 2: every recorded provider answer in, the true kind,
// the sentence, the retry decision and the stored form out.
//
// Each fixture is a byte-identical copy of a real answer the lead recorded
// on 2026-10-12 (~6:27-6:28 PM PT; no model ran; the account ids in the xAI
// and OpenRouter answers were replaced with zeros by the lead):
// `test/fixtures/provider-refusals/<provider>/bad-key.json` (the product's
// own model-list path asked with a made-up key) and `unknown-model.json`
// (the product's own request path asked for `no-such-model-real-life` with
// the real key). No server, no fake, no mock: file bytes in through the real
// extractor and classifier, facts out.
//
// A case whose body is not a recorded answer is a documented shape the lane
// could not record (a 429, a 529, a filter block): each names the
// documentation's address and the date it was read, and stays UNVERIFIED in
// `docs/certification/proverr-round2.md` until a real answer is recorded.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isRefusalRetryable,
  parseRefusalError,
  refusalOf,
  refusalSentence,
  scrubRefusalLeak,
  type ProviderRefusalKind,
  type RefusalCarrier,
} from '../../src/core/backends/modelapi/providerRefusal'
import { parseAnthropicError } from '../../src/core/backends/modelapi/codecs/anthropic'
import { presetById, quirksOf } from '../../src/core/providers/presets'

const FIXTURES = path.resolve('test/fixtures/provider-refusals')

interface RecordedAnswer {
  readonly status: number
  readonly responseHeaders: Record<string, string>
  readonly response: unknown
}

async function recorded(provider: string, name: string): Promise<RecordedAnswer> {
  const raw = await readFile(path.join(FIXTURES, provider, `${name}.json`), 'utf8')
  const parsed = JSON.parse(raw) as {
    status: number
    responseHeaders: Record<string, string>
    response: unknown
  }
  return {
    status: parsed.status,
    responseHeaders: parsed.responseHeaders,
    response: parsed.response,
  }
}

/** The request id the transport attaches (mirrors `describeFailure`). */
function requestIdOf(headers: Record<string, string>): string | undefined {
  const found = headers['request-id'] ?? headers['x-request-id']
  return found === undefined || found.trim() === '' ? undefined : found.trim()
}

/** Everything the extractor found, as the refusal paths carry it. */
function carrier(
  status: number,
  parsed: Pick<RefusalCarrier, 'message' | 'kind' | 'code' | 'reason' | 'errorCode'>,
  requestId?: string,
): RefusalCarrier {
  return {
    status,
    kind: parsed.kind,
    code: parsed.code,
    message: parsed.message,
    ...(parsed.reason !== undefined && { reason: parsed.reason }),
    ...(parsed.errorCode !== undefined && { errorCode: parsed.errorCode }),
    ...(requestId !== undefined && { requestId }),
  }
}

// Every recorded error answer with the kind that is true (the lane brief's
// table: bad key = authentication at all eleven, unknown model = notFound at
// all twelve) and the fragment of the sentence the person reads.
const RECORDED: readonly {
  readonly provider: string
  readonly name: string
  readonly kind: ProviderRefusalKind
  readonly fragment: string
}[] = [
  { provider: 'openai', name: 'bad-key', kind: 'authentication', fragment: 'was rejected' },
  { provider: 'openai', name: 'unknown-model', kind: 'notFound', fragment: 'no such model' },
  { provider: 'groq', name: 'bad-key', kind: 'authentication', fragment: 'was rejected' },
  { provider: 'groq', name: 'unknown-model', kind: 'notFound', fragment: 'no such model' },
  { provider: 'deepseek', name: 'bad-key', kind: 'authentication', fragment: 'was rejected' },
  { provider: 'deepseek', name: 'unknown-model', kind: 'notFound', fragment: 'no such model' },
  { provider: 'anthropic', name: 'bad-key', kind: 'authentication', fragment: 'was rejected' },
  { provider: 'anthropic', name: 'unknown-model', kind: 'notFound', fragment: 'no such model' },
  { provider: 'fireworks', name: 'bad-key', kind: 'authentication', fragment: 'was rejected' },
  { provider: 'fireworks', name: 'unknown-model', kind: 'notFound', fragment: 'no such model' },
  { provider: 'together', name: 'bad-key', kind: 'authentication', fragment: 'was rejected' },
  { provider: 'together', name: 'unknown-model', kind: 'notFound', fragment: 'no such model' },
  { provider: 'openrouter', name: 'bad-key', kind: 'authentication', fragment: 'was rejected' },
  { provider: 'openrouter', name: 'unknown-model', kind: 'notFound', fragment: 'no such model' },
  { provider: 'xai', name: 'bad-key', kind: 'authentication', fragment: 'was rejected' },
  { provider: 'xai', name: 'unknown-model', kind: 'notFound', fragment: 'no such model' },
  { provider: 'gemini', name: 'bad-key', kind: 'authentication', fragment: 'was rejected' },
  { provider: 'gemini', name: 'unknown-model', kind: 'notFound', fragment: 'no such model' },
  { provider: 'mistral', name: 'bad-key', kind: 'authentication', fragment: 'was rejected' },
  { provider: 'mistral', name: 'unknown-model', kind: 'notFound', fragment: 'no such model' },
  { provider: 'zai', name: 'bad-key', kind: 'authentication', fragment: 'was rejected' },
  { provider: 'zai', name: 'unknown-model', kind: 'notFound', fragment: 'no such model' },
  { provider: 'huggingface', name: 'unknown-model', kind: 'notFound', fragment: 'no such model' },
  // Hugging Face's model list answers 200 to any key (the key check is on
  // another host), so its bad-key fixture is no refusal and is not listed.
]

describe('recorded provider answers classify to the true kind', () => {
  it.each(RECORDED)('$provider/$name is $kind', async ({ provider, name, kind, fragment }) => {
    const answer = await recorded(provider, name)
    const parsed = parseRefusalError(answer.status, answer.response)
    // Every recorded answer parses: none stays unrecognised.
    expect(parsed.parsed).toBe(true)
    const requestId = requestIdOf(answer.responseHeaders)
    const refusal = refusalOf(carrier(answer.status, parsed, requestId))
    expect(refusal.kind).toBe(kind)
    expect(refusal.status).toBe(answer.status)
    if (requestId !== undefined) expect(refusal.requestId).toBe(requestId)
    const sentence = refusalSentence(refusal, provider)
    expect(sentence).toContain(fragment)
    expect(sentence).toContain(parsed.message)
    // Authentication and not-found refusals are never retried.
    expect(isRefusalRetryable(carrier(answer.status, parsed), undefined)).toBe(false)
  })
})

// The measured Anthropic out-of-credit bytes the lead's drill replays
// (recorded in round 1): a 400 about credit is `credit`, not `invalidRequest.
const CREDIT_BODY = {
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message:
      'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
  },
}

describe('recorded credit refusal', () => {
  it('is credit, never retried, with the request id the provider sent', () => {
    const parsed = parseRefusalError(400, CREDIT_BODY)
    const refusal = refusalOf(carrier(400, parsed, 'req-credit-1'))
    expect(refusal.kind).toBe('credit')
    expect(refusal.requestId).toBe('req-credit-1')
    expect(refusalSentence(refusal, 'anthropic')).toContain('out of credit')
    expect(isRefusalRetryable(carrier(400, parsed), undefined)).toBe(false)
  })
})

describe('the stored form carries no key remnant or account id', () => {
  it.each([
    {
      provider: 'openai',
      name: 'bad-key',
      scrubbed:
        'Incorrect API key provided: [key] You can find your API key at https://platform.openai.com/account/api-keys.',
    },
    {
      provider: 'deepseek',
      name: 'bad-key',
      scrubbed:
        'Authentication Fails, Your api key: [key] is invalid (request_id: 2370f52c-74d2-43b5-8c72-ce2b00322e0b)',
    },
    {
      provider: 'xai',
      name: 'unknown-model',
      scrubbed:
        'The model no-such-model-real-life does not exist or your team [account] does not have access to it. If you believe this is a mistake, please contact support and quote your team ID and the model name.',
    },
  ])('$provider/$name scrubs to the stored form', async ({ provider, name, scrubbed }) => {
    const answer = await recorded(provider, name)
    const parsed = parseRefusalError(answer.status, answer.response)
    expect(parsed.parsed).toBe(true)
    // The request id is the provider support handle and is kept.
    expect(scrubRefusalLeak(parsed.message)).toBe(scrubbed)
    expect(scrubRefusalLeak(parsed.message)).not.toMatch(/\*{2,}/)
  })
})

describe('documented shapes the lane could not record (UNVERIFIED)', () => {
  it('tells an OpenAI quota 429 from a bare one (OPENAI-G20)', () => {
    // OpenAI documents insufficient_quota as "won't restore API access" on
    // retry (https://developers.openai.com/api/docs/guides/error-codes, read
    // 2026-10-13). A 429 with no kind or code retries; the same 429 with the
    // quota code does not.
    const bare = parseRefusalError(429, {
      error: { message: 'Rate limit reached for gpt-5.', type: 'rate_limit_error' },
    })
    expect(refusalOf(carrier(429, bare)).kind).toBe('rateLimited')
    expect(isRefusalRetryable(carrier(429, bare), undefined)).toBe(true)
    const quota = parseRefusalError(429, {
      error: {
        message: 'You exceeded your current quota, please check your plan and billing details.',
        type: 'insufficient_quota',
        code: 'insufficient_quota',
      },
    })
    expect(refusalOf(carrier(429, quota)).kind).toBe('credit')
    expect(isRefusalRetryable(carrier(429, quota), undefined)).toBe(false)
  })

  it('reads the preset retry override (OPENAI-G20)', () => {
    // OpenAI documents `server_error` as retryable past the format statuses
    // (the `quirks.retry` override in src/core/providers/presets.ts); the
    // transport and the stream client both decide by it.
    const preset = presetById('openai')
    if (preset === undefined) throw new Error('expected the openai preset')
    const table = quirksOf(preset).retry
    expect(
      isRefusalRetryable(
        { status: 500, kind: 'server_error', code: 'server_error', message: 'Server error.' },
        undefined,
        table,
      ),
    ).toBe(true)
    expect(
      isRefusalRetryable(
        {
          status: 429,
          kind: 'insufficient_quota',
          code: 'insufficient_quota',
          message: 'You exceeded your current quota.',
        },
        undefined,
        table,
      ),
    ).toBe(false)
  })

  it('reads the Anthropic spend-cap error code instead of retrying it (GAPANTH-G20)', () => {
    // A tier spend-cap 429 carries `enforced_spend_limit_reached` in
    // `error.details.error_code` while `type` stays `rate_limit_error`
    // (https://platform.claude.com/docs/en/api/rate-limits#reaching-your-spend-cap,
    // read 2026-10-13); retrying it keeps failing, so it is credit.
    const error = parseAnthropicError(429, {
      type: 'error',
      error: {
        type: 'rate_limit_error',
        message: 'Number of tokens used in the last minute exceeds the limit.',
        details: { error_code: 'enforced_spend_limit_reached' },
      },
    })
    // The documented error code rides as the failure code, so the shared
    // classifier — not a prose match — decides.
    expect(error.code).toBe('enforced_spend_limit_reached')
    const refusal = refusalOf(error)
    expect(refusal.kind).toBe('credit')
    expect(refusalSentence(refusal, 'anthropic')).toContain('out of credit')
    expect(isRefusalRetryable(error, undefined)).toBe(false)
  })

  it('maps an Azure content-filter block to its own sentence (AZURE-G06)', () => {
    // A filtered prompt answers HTTP 400 with `error.code: "content_filter"`
    // (https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/content-filter,
    // read 2026-10-13; the Azure route itself is another lane's branch).
    const parsed = parseRefusalError(400, {
      error: {
        message:
          'The response was filtered due to the prompt triggering Azure content management policy.',
        code: 'content_filter',
      },
    })
    const refusal = refusalOf(carrier(400, parsed))
    expect(refusal.kind).toBe('contentFilter')
    expect(refusalSentence(refusal, 'azure')).toContain('content filter blocked')
    expect(isRefusalRetryable(carrier(400, parsed), undefined)).toBe(false)
  })

  it('ends an unsupported-parameter answer as invalid, never retried', () => {
    // Measured through the product on 2026-10-12 (lane brief: xAI answers
    // `reasoning.effort` on `grok-build-0.1` with this 400); no fixture was
    // saved, so this stays UNVERIFIED until a real answer is recorded.
    const parsed = parseRefusalError(400, {
      code: 'invalid-argument',
      error: 'Model grok-build-0.1 does not support parameter reasoningEffort.',
    })
    const refusal = refusalOf(carrier(400, parsed))
    expect(refusal.kind).toBe('invalidRequest')
    expect(isRefusalRetryable(carrier(400, parsed), undefined)).toBe(false)
  })
})

describe('answers no parser reads', () => {
  it('classifies an unparsable body by its status, apart from the kind', () => {
    const parsed = parseRefusalError(502, '<html><body>Bad Gateway</body></html>')
    // "The body could not be read" travels beside the kind, never as one.
    expect(parsed.parsed).toBe(false)
    expect(parsed.kind).toBeUndefined()
    expect(refusalOf(carrier(502, parsed)).kind).toBe('serverError')
  })

  it('keeps a stream error its own kind at the answer status', () => {
    const refusal = refusalOf({
      status: 200,
      kind: 'streamError',
      code: 'content_filter',
      message: 'The generation was filtered.',
    })
    // A streamed filter block consumed output, so it never reads as the
    // uncharged 400 content-filter sentence; liability stays uncertain.
    expect(refusal.kind).toBe('streamError')
    expect(refusalSentence(refusal, 'azure')).toContain('stopped answering')
  })
})
