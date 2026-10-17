import { describe, expect, it } from 'vitest'
import { classifyContextOverflow } from '../../src/core/providers/overflow'
import type { ProviderFormat } from '../../src/core/providers/providersFile'

// Synthetic classifier inputs, not newly captured native error envelopes.
const ERRORS: readonly (readonly [ProviderFormat, string])[] = [
  ['responses', 'This model maximum context length is 8192 tokens'],
  ['responses', 'Please reduce the length of your input'],
  ['chat', 'The request exceeds the available context size'],
  ['chat', 'Maximum prompt length is 8192'],
  ['chat', 'Too many tokens'],
  ['anthropic', 'prompt is too long: 9000 tokens > 8192 maximum'],
  ['anthropic', 'Input is too long for requested model'],
  ['gemini', 'The input token count exceeds the maximum number of tokens allowed'],
  ['ollama', 'input length exceeds context length'],
]
const FORMATS: readonly ProviderFormat[] = ['responses', 'chat', 'anthropic', 'gemini', 'ollama']

describe('provider context overflow (M101 item 6)', () => {
  it.each(ERRORS)('classifies %s context refusal: %s', (format, message) => {
    expect(classifyContextOverflow({ format, error: { status: 400, message } })).toBe('error')
  })

  it.each(ERRORS)('never classifies a 429 on %s: %s', (format, message) => {
    expect(classifyContextOverflow({ format, error: { status: 429, message } })).toBeUndefined()
  })

  it.each(FORMATS)('rate limit words and codes veto overflow on %s', (format) => {
    for (const veto of [
      'rate limit',
      'rate_limit_error',
      'rate-limit',
      'too many requests',
      'tokens per minute',
      'TPM',
      'rate exceeded',
      'HTTP 429',
    ]) {
      expect(
        classifyContextOverflow({
          format,
          error: {
            status: 400,
            message: 'prompt is too long; input length exceeds context length',
            code: veto,
          },
        }),
      ).toBeUndefined()
    }
  })

  it.each(FORMATS)('quota, billing and credit evidence vetoes overflow on %s', (format) => {
    const overflow =
      'prompt is too long; input token count exceeds the maximum; input length exceeds context length'
    for (const veto of [
      'insufficient_quota',
      'quota_exceeded',
      'Quota exhausted: too many tokens',
      'Requested tokens exceed the quota limit',
      'Token limit exceeded for your current quota',
      'billing_hard_limit_reached',
      'billing limit exceeded',
      'credit balance is too low',
      'out of credits',
      'insufficient credits',
      'insufficient_credits',
    ]) {
      for (const field of ['code', 'kind', 'message']) {
        expect(
          classifyContextOverflow({
            format,
            error: {
              status: 403,
              message: overflow,
              [field]: field === 'message' ? `${veto}; ${overflow}` : veto,
            },
          }),
          `${format}: ${field}: ${veto}`,
        ).toBeUndefined()
      }
    }
  })

  it('keeps unrelated errors, unknown formats and foreign format prose unclassified', () => {
    for (const message of [
      'Output exceeds the maximum token limit',
      'Filename is too long',
      'Invalid API key',
      'Service overloaded',
    ]) {
      expect(classifyContextOverflow({ format: 'responses', error: { message } })).toBeUndefined()
    }
    expect(
      classifyContextOverflow({ format: undefined, error: { message: 'prompt is too long' } }),
    ).toBeUndefined()
    expect(
      classifyContextOverflow({
        format: 'gemini',
        error: { message: 'Maximum prompt length is 8192' },
      }),
    ).toBeUndefined()
    expect(
      classifyContextOverflow({
        format: 'responses',
        error: { code: 'context_length_exceeded', message: 'Rejected' },
      }),
    ).toBe('error')
    expect(
      classifyContextOverflow({
        format: 'responses',
        error: { kind: 'rate_limit_error', message: 'prompt is too long' },
      }),
    ).toBeUndefined()
  })

  it('detects completed input above the selected window even with nonzero output', () => {
    expect(
      classifyContextOverflow({
        format: 'ollama',
        contextTokens: 8192,
        response: { completed: true, inputTokens: 8193, outputTokens: 20 },
      }),
    ).toBe('input-above-window')
    expect(
      classifyContextOverflow({
        format: 'ollama',
        contextTokens: 8192,
        response: { completed: true, inputTokens: 8192, outputTokens: 20 },
      }),
    ).toBeUndefined()
  })

  it('detects zero output at 99% but permits nonzero output and lower occupancy', () => {
    expect(
      classifyContextOverflow({
        format: 'ollama',
        contextTokens: 10_000,
        response: { completed: true, inputTokens: 9900, outputTokens: 0 },
      }),
    ).toBe('empty-near-window')
    for (const [inputTokens, outputTokens] of [
      [9899, 0],
      [9900, 1],
    ]) {
      expect(
        classifyContextOverflow({
          format: 'ollama',
          contextTokens: 10_000,
          response: {
            completed: true,
            inputTokens: inputTokens ?? 0,
            outputTokens: outputTokens ?? 0,
          },
        }),
      ).toBeUndefined()
    }
  })

  it('requires completed replies and valid known windows and usage for silent signals', () => {
    for (const contextTokens of [undefined, 0, -1, NaN, Infinity, 1.5]) {
      expect(
        classifyContextOverflow({
          format: 'ollama',
          contextTokens,
          response: { completed: true, inputTokens: 10_000, outputTokens: 0 },
        }),
      ).toBeUndefined()
    }
    for (const count of [-1, NaN, Infinity, 1.5]) {
      expect(
        classifyContextOverflow({
          format: 'ollama',
          contextTokens: 8192,
          response: { completed: true, inputTokens: count, outputTokens: 0 },
        }),
      ).toBeUndefined()
      expect(
        classifyContextOverflow({
          format: 'ollama',
          contextTokens: 8192,
          response: { completed: true, inputTokens: 8193, outputTokens: count },
        }),
      ).toBeUndefined()
    }
    expect(
      classifyContextOverflow({
        format: 'ollama',
        contextTokens: 8192,
        response: { completed: false, inputTokens: 8193, outputTokens: 0 },
      }),
    ).toBeUndefined()
  })
})
