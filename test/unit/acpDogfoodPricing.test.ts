import { describe, expect, it } from 'vitest'
import { settleUsageAmount, type PriceCard } from '../../src/core/providers/priceCard'
import { createUsageRecord } from '../../src/core/usage/journalRecord'
import { Usd } from '../../src/shared/usd'

const card: PriceCard = {
  input: 0.000004,
  cachedInput: 0.0000004,
  cacheWrite: 0.000005,
  cacheWrite1h: 0.000008,
  output: 0.000016,
  source: 'catalogue',
}
const context = {
  id: 'call',
  at: 100,
  startedAt: 1,
  client: 'Zed',
  backend: 'modelApi',
  provider: 'anthropic',
  model: 'claude',
  kind: 'turn',
  outcome: 'completed',
  pricing: { kind: 'priced', card },
} as const

describe('ACPDOG exact token settlement', () => {
  it.each([
    ['input', { inputTokens: 100, outputTokens: 0 }, '0.0004'],
    ['cached read', { inputTokens: 100, cachedTokens: 100, outputTokens: 0 }, '0.00004'],
    ['cache write 5m', { inputTokens: 100, cacheWriteTokens: 100, outputTokens: 0 }, '0.0005'],
    [
      'cache write 1h',
      { inputTokens: 100, cacheWriteTokens: 100, cacheWriteTokens1h: 100, outputTokens: 0 },
      '0.0008',
    ],
    ['output (includes reasoning)', { inputTokens: 0, outputTokens: 100 }, '0.0016'],
    [
      'mixed',
      {
        inputTokens: 100,
        cachedTokens: 20,
        cacheWriteTokens: 30,
        cacheWriteTokens1h: 10,
        outputTokens: 10,
      },
      '0.000548',
    ],
  ])('prices %s at its own rate', (_name, usage, expected) => {
    expect(settleUsageAmount(card, usage)).toBe(Usd.from(expected).toAmount())
  })
  it.each(['cachedInput', 'cacheWrite', 'cacheWrite1h'] as const)(
    'bounds missing %s at the highest input-side rate',
    (missing) => {
      const partial = { ...card, [missing]: undefined }
      const usage = {
        inputTokens: 100,
        cachedTokens: 30,
        cacheWriteTokens: 40,
        cacheWriteTokens1h: 10,
        outputTokens: 0,
      }
      const amounts = { cachedInput: '0.00059', cacheWrite: '0.000452', cacheWrite1h: '0.000332' }
      expect(settleUsageAmount(partial, usage)).toBe(Usd.from(amounts[missing]).toAmount())
      const record = createUsageRecord(
        {
          input_tokens: 100,
          output_tokens: 0,
          input_tokens_details: {
            cached_tokens: 30,
            cache_write_tokens: 40,
            cache_write_tokens_1h: 10,
          },
        },
        { ...context, pricing: { kind: 'priced', card: partial } },
      )
      expect(record.cost).toMatchObject({ upperBound: true })
    },
  )
  it('retains exact settlement in the journal, including the dogfood cache-write receipt', () => {
    const record = createUsageRecord(
      {
        input_tokens: 16_168,
        output_tokens: 347,
        input_tokens_details: { cache_write_tokens: 16_168 },
      },
      context,
    )
    expect(record.cost.usdAmount).toBe(Usd.from('0.086392').toAmount())
    expect(record.cost.usd).toBe(0.086392)
  })
})
