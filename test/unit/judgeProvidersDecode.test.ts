import { describe, expect, it } from 'vitest'
import { JUDGE_TOP1_MIN_PROB } from '../../src/shared/constants'
import { decodeByoResponse, type ByoDecodeRequest } from '../../src/core/judge/providers/decode'
import capture from './fixtures/localJudgeCapture.json'

const MODEL = 'qwen3:4b-instruct-2507-q4_K_M'

function request(patch: Partial<ByoDecodeRequest> = {}): ByoDecodeRequest {
  return {
    model: MODEL,
    technique: 'logprob',
    kind: 'noul',
    optionCount: 2,
    top1Floor: JUDGE_TOP1_MIN_PROB,
    ...patch,
  }
}

function chatBody(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...capture.chat, ...patch }
}

function answered(value: unknown, query: ByoDecodeRequest = request()) {
  const decoded = decodeByoResponse(value, query)
  expect(decoded.outcome).toBe('answer')
  if (decoded.outcome !== 'answer') {
    throw new Error('expected an answer')
  }
  return decoded
}

describe('decodeByoResponse', () => {
  it('reads the captured ollama chat body, singular logprob and both answers', () => {
    const decoded = answered(capture.chat)
    expect(decoded.material.technique).toBe('logprob')
    expect(decoded.material.partial).toBe(false)
    expect(decoded.material.probabilities).toHaveLength(2)
    expect(decoded.material.probabilities[1]).toBeGreaterThan(
      decoded.material.probabilities[0] ?? 0,
    )
    expect(decoded.usage).toEqual({ inputTokens: 30, outputTokens: 1 })
    const listed = capture.chat.logprobs[0]?.top_logprobs ?? []
    expect(listed.every((entry) => Object.hasOwn(entry, 'logprob'))).toBe(true)
    expect(listed.some((entry) => Object.hasOwn(entry, 'logprobs'))).toBe(false)
  })

  it('reads a dropped logprobs field as an engine failure, never certainty', () => {
    const rest: Record<string, unknown> = { ...capture.chat }
    delete rest['logprobs']
    const decoded = decodeByoResponse(rest, request())
    expect(decoded.outcome).toBe('failure')
    expect(rest['message']).toMatchObject({ content: 'no' })
  })

  it('fails an empty logprobs list instead of reading the assistant text', () => {
    const decoded = decodeByoResponse(chatBody({ logprobs: [] }), request())
    expect(decoded.outcome).toBe('failure')
  })

  it('rejects a plural logprobs key beside a singular logprob', () => {
    const decoded = decodeByoResponse(
      chatBody({
        logprobs: [
          {
            token: 'no',
            logprob: -0.01,
            logprobs: -0.01,
            top_logprobs: [{ token: 'no', logprob: -0.01, logprobs: -0.01 }],
          },
        ],
      }),
      request(),
    )
    expect(decoded.outcome).toBe('failure')
  })

  it('does not slice a multi-character token into an option', () => {
    const decoded = decodeByoResponse(
      chatBody({
        message: { role: 'assistant', content: 'AA' },
        logprobs: [
          {
            token: 'AA',
            logprob: 0,
            top_logprobs: [{ token: 'AA', logprob: 0 }],
          },
        ],
      }),
      request({ technique: 'logprob', kind: 'choice', optionCount: 2 }),
    )
    expect(decoded.outcome).toBe('failure')
  })

  it('keeps a short top-k partial instead of padding the unseen mass', () => {
    const decoded = answered(
      chatBody({
        logprobs: [
          {
            token: 'yes',
            logprob: 0,
            top_logprobs: [{ token: 'yes', logprob: 0 }],
          },
        ],
      }),
    )
    expect(decoded.material.partial).toBe(true)
    expect(decoded.material.probabilities[0]).toBe(1)
    expect(decoded.material.probabilities[1]).toBe(0)
  })

  it('answers top-1 from the first candidate above the floor and marks it partial', () => {
    const decoded = answered(capture.chat, request({ technique: 'top1' }))
    expect(decoded.material.technique).toBe('top1')
    expect(decoded.material.partial).toBe(true)
    expect(decoded.material.probabilities[1]).toBeGreaterThan(JUDGE_TOP1_MIN_PROB)
  })

  it('falls back when top-1 is under the floor', () => {
    const decoded = decodeByoResponse(
      chatBody({
        logprobs: [
          {
            token: 'no',
            logprob: Math.log(0.6),
            top_logprobs: [{ token: 'no', logprob: Math.log(0.6) }],
          },
        ],
      }),
      request({ technique: 'top1' }),
    )
    expect(decoded.outcome).toBe('fallback')
    if (decoded.outcome !== 'fallback') {
      throw new Error('expected a fallback')
    }
    expect(decoded.usage).toEqual({ inputTokens: 30, outputTokens: 1 })
  })

  it('applies the caller floor rather than a hardcoded one', () => {
    const body = chatBody({
      logprobs: [
        {
          token: 'yes',
          logprob: Math.log(0.6),
          top_logprobs: [{ token: 'yes', logprob: Math.log(0.6) }],
        },
      ],
    })
    expect(decodeByoResponse(body, request({ technique: 'top1', top1Floor: 0.8 })).outcome).toBe(
      'fallback',
    )
    const lowered = decodeByoResponse(body, request({ technique: 'top1', top1Floor: 0.5 }))
    expect(lowered.outcome).toBe('answer')
  })

  it('fails when the response model is not the requested model', () => {
    expect(decodeByoResponse(chatBody({ model: 'other' }), request()).outcome).toBe('failure')
  })

  it('parses a stated JSON object and does not read bare text as certainty', () => {
    const stated = answered(
      chatBody({
        message: { role: 'assistant', content: '{"answer":"yes","confidence":80}' },
      }),
      request({ technique: 'stated' }),
    )
    expect(stated.material.technique).toBe('stated')
    expect(stated.material.partial).toBe(false)
    expect(stated.material.probabilities[0]).toBeCloseTo(0.8)
    expect(
      decodeByoResponse(
        chatBody({ message: { role: 'assistant', content: 'no' } }),
        request({ technique: 'stated' }),
      ).outcome,
    ).toBe('failure')
  })

  it('reads the normalized seam and rejects extra vendor keys', () => {
    const decoded = answered({
      text: 'ignored',
      usage: { input_tokens: 4, output_tokens: 1 },
      alternatives: [
        { token: 'yes', logprob: Math.log(0.75) },
        { token: 'no', logprob: Math.log(0.25) },
      ],
    })
    expect(decoded.material.technique).toBe('logprob')
    expect(decoded.material.partial).toBe(false)
    expect(decoded.usage).toEqual({ inputTokens: 4, outputTokens: 1 })
    expect(
      decodeByoResponse(
        {
          text: 'no',
          usage: { input_tokens: 1, output_tokens: 1 },
          alternatives: [{ token: 'no', logprob: 0 }],
          logprobs: [],
        },
        request(),
      ).outcome,
    ).toBe('failure')
    expect(
      decodeByoResponse({ text: 'no', usage: { input_tokens: 1, output_tokens: 1 } }, request())
        .outcome,
    ).toBe('failure')
  })

  it('accepts the captured bytes field on an ollama alternative', () => {
    const token = capture.chat.logprobs[0]
    expect(token?.bytes).toEqual([110, 111])
    expect(answered(capture.chat).outcome).toBe('answer')
  })

  it('does not treat a non-object body as an answer', () => {
    expect(decodeByoResponse('no', request()).outcome).toBe('failure')
    expect(decodeByoResponse(null, request()).outcome).toBe('failure')
  })
})
