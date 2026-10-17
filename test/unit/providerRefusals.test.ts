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
// extractor and classifier, facts out. Only recorded answers are fed in
// (owner, 2026-10-17: no invented data); what no recorded answer covers yet
// is listed for capture in `docs/certification/provider-refusals.md`.
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
    // The provider's support handle reaches the person (lane PROVERRORS).
    if (requestId !== undefined) expect(sentence).toContain(requestId)
    // Authentication and not-found refusals are never retried.
    expect(isRefusalRetryable(carrier(answer.status, parsed))).toBe(false)
  })
})

// The Anthropic out-of-credit answer the lead measured on 2026-10-12
// (released 0.18.1, real calls; bytes in
// `docs/certification/provider-refusals.md`, "The measured case"): a 400
// about credit is `credit`, not `invalidRequest`.
const CREDIT_BODY = {
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message:
      'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
  },
}

describe('recorded credit refusal', () => {
  it('is credit and never retried', () => {
    const parsed = parseRefusalError(400, CREDIT_BODY)
    const refusal = refusalOf(carrier(400, parsed))
    expect(refusal.kind).toBe('credit')
    expect(refusalSentence(refusal, 'anthropic')).toContain('out of credit')
    expect(isRefusalRetryable(carrier(400, parsed))).toBe(false)
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
