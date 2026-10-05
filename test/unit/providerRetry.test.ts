// M101 lane P2 (BYO 5): retry classification per wire format. The shared
// tables say what each format retries and never its quota; `FormatQuirks`
// carries the same tables for the providers bundle, and the Meta client
// reads the responses table. Fakes only.

import { describe, expect, it } from 'vitest'
import { FORMAT_QUIRKS, PRESETS, quirksOf } from '../../src/core/providers/presets'
import { classifyRetry, RETRY_TABLES, type RetryFormat } from '../../src/shared/retryPolicy'

const FORMATS: readonly RetryFormat[] = ['responses', 'chat', 'anthropic', 'gemini', 'ollama']

function failure(
  status: number,
  extra: Partial<{ kind: string; code: string; message: string; retryAfterMs: number }> = {},
) {
  return {
    status,
    kind: undefined,
    code: undefined,
    message: 'synthetic failure',
    retryAfterMs: undefined,
    ...extra,
  }
}

describe('classifyRetry', () => {
  it('retries Meta responses failures exactly as before (429, 500, 502, 503)', () => {
    const tables = RETRY_TABLES.responses
    for (const status of [429, 500, 502, 503]) {
      expect(classifyRetry(tables, failure(status))).toEqual({ retry: true })
    }
    for (const status of [200, 400, 401, 403, 404, 408, 504, 529]) {
      expect(classifyRetry(tables, failure(status))).toEqual({
        retry: false,
        reason: 'not-retryable',
      })
    }
  })

  it('never retries quota, whatever the status', () => {
    for (const tables of Object.values(RETRY_TABLES)) {
      expect(
        classifyRetry(
          tables,
          failure(429, { kind: 'rate_limit_error', code: 'insufficient_quota' }),
        ),
      ).toEqual({ retry: false, reason: 'quota' })
      expect(classifyRetry(tables, failure(400, { message: 'You exceeded your quota' }))).toEqual(
        { retry: false, reason: 'quota' },
      )
      expect(classifyRetry(tables, failure(402, { message: 'nope' }))).toEqual({
        retry: false,
        reason: 'quota',
      })
    }
  })

  it('fails at once past a 60 s Retry-After, and retries at it', () => {
    for (const tables of Object.values(RETRY_TABLES)) {
      expect(classifyRetry(tables, failure(429, { retryAfterMs: 61_000 }))).toEqual({
        retry: false,
        reason: 'retry-after-cap',
      })
      expect(classifyRetry(tables, failure(503, { retryAfterMs: 60_000 }))).toEqual({
        retry: true,
      })
      expect(classifyRetry(tables, failure(503))).toEqual({ retry: true })
    }
  })

  it('retries each format’s own failures', () => {
    expect(classifyRetry(RETRY_TABLES.anthropic, failure(529))).toEqual({ retry: true })
    expect(classifyRetry(RETRY_TABLES.anthropic, failure(504))).toEqual({ retry: true })
    expect(
      classifyRetry(RETRY_TABLES.anthropic, failure(400, { kind: 'overloaded_error' })),
    ).toEqual({ retry: true })
    expect(classifyRetry(RETRY_TABLES.chat, failure(408))).toEqual({ retry: true })
    expect(classifyRetry(RETRY_TABLES.responses, failure(529))).toEqual({
      retry: false,
      reason: 'not-retryable',
    })
  })
})

describe('FormatQuirks retry tables', () => {
  it('carries the shared table per format, one source for both bundles', () => {
    for (const format of FORMATS) {
      expect(FORMAT_QUIRKS[format].retry).toBe(RETRY_TABLES[format])
    }
  })

  it('covers every preset’s format with a non-empty retryable set', () => {
    for (const preset of PRESETS) {
      const quirks = quirksOf(preset)
      expect(quirks.retry.statuses.length).toBeGreaterThan(0)
      expect(quirks.retry.retryAfterCapMs).toBeGreaterThan(0)
    }
  })

  it('gives OpenAI its documented server_error past the format’s statuses', () => {
    const openai = PRESETS.find((preset) => preset.id === 'openai')
    if (openai === undefined) {
      throw new Error('Missing OpenAI preset')
    }
    const quirks = quirksOf(openai)
    expect(
      classifyRetry(quirks.retry, failure(400, { kind: 'server_error', message: 'gone' })),
    ).toEqual({ retry: true })
    expect(
      classifyRetry(RETRY_TABLES.responses, failure(400, { kind: 'server_error', message: 'gone' })),
    ).toEqual({ retry: false, reason: 'not-retryable' })
  })
})
