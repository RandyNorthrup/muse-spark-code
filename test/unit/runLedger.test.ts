import { Usd } from '../../src/shared/usd'
import { describe, expect, it } from 'vitest'
import {
  createRunLedger,
  type ResponseTicket,
  type RunLedger,
} from '../../src/runtime/exec/runLedger'
import { MODEL_API_PRICES_PER_MILLION } from '../../src/shared/constants'

function tierPrice(isStandard = false) {
  const values = MODEL_API_PRICES_PER_MILLION[isStandard ? 'standard' : 'contributor']
  return {
    input: Usd.from(values.input).toAmount(),
    cachedInput: Usd.from(values.cachedInput).toAmount(),
    output: Usd.from(values.output).toAmount(),
  }
}
const price = tierPrice()
const valid = {
  input_tokens: 10,
  output_tokens: 5,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 1 },
  total_tokens: 15,
}
function response(ledger: RunLedger, isStandard = false, maxOutputTokens = 32_768): ResponseTicket {
  const ticket = ledger.admitResponse({
    model: isStandard ? 'muse-spark-1.3' : 'muse-spark-1.3-contributor',
    maxOutputTokens,
    price: isStandard ? tierPrice(true) : price,
  })
  if ('refused' in ticket) throw new Error(ticket.refused)
  return ticket
}
const eof = (usage: unknown = valid, terminal: string | null = 'completed') => ({
  kind: 'eof' as const,
  terminal,
  incompleteReason: null,
  usage,
  parseInvalid: false,
})

describe('M80 ledger integer admission and retained liability', () => {
  it('L3 refuses simultaneous direct tickets and clears last response at admission', () => {
    const l = createRunLedger({ capUsd: Usd.from(1).toAmount(), maxRequests: 30 })
    const first = response(l)
    expect(() => l.admitImage('images.generations')).toThrow()
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.price)).toBe(true)
    l.settleResponse(first, eof())
    expect(l.lastResponse?.terminal).toBe('completed')
    const second = response(l)
    expect(l.lastResponse).toBeNull()
    l.settleResponse(second, {
      kind: 'transport',
      why: 'error',
      terminal: 'completed',
      incompleteReason: null,
      usage: valid,
    })
    expect(l.lastResponse).toMatchObject({
      terminal: 'completed',
      transportError: 'error',
      usage: 'valid',
      settlement: 'full-reservation',
    })
  })
  it.each([0, 501, 0.5, NaN, Infinity])('rejects invalid request cap %s', (maxRequests) => {
    expect(() => createRunLedger({ capUsd: Usd.from(1).toAmount(), maxRequests })).toThrow()
  })
  it('F1/L9 rounds contributor reservation upward and preserves isStandard minimum', () => {
    expect(
      response(createRunLedger({ capUsd: Usd.from(1).toAmount(), maxRequests: 30 })).reserveUsd,
    ).toBe(Usd.from(0.108135).toAmount())
    expect(
      response(createRunLedger({ capUsd: Usd.from(2).toAmount(), maxRequests: 30 }), true)
        .reserveUsd,
    ).toBe(Usd.from(1.409024).toAmount())
    for (const [cap, isStandard] of [
      [0.108134, false],
      [1.409023, true],
    ] as const) {
      const l = createRunLedger({ capUsd: Usd.from(cap).toAmount(), maxRequests: 30 })
      expect(
        l.admitResponse({
          model: 'm',
          maxOutputTokens: 32_768,
          price: isStandard ? tierPrice(true) : price,
        }),
      ).toEqual({ refused: 'budget' })
      expect(l.totals().requests).toBe(0)
    }
    const l = createRunLedger({ capUsd: Usd.from(0.108135).toAmount(), maxRequests: 1 })
    expect(response(l).reserveUsd).toBe(Usd.from(0.108135).toAmount())
  })
  it('L2 prices cached/uncached/output exactly before upward micro rounding', () => {
    const l = createRunLedger({ capUsd: Usd.from(1).toAmount(), maxRequests: 30 })
    expect(l.settleResponse(response(l), eof({ input_tokens: 1, output_tokens: 0 }))).toEqual({
      outcome: 'priced',
      chargedUsd: Usd.from(0.000001).toAmount(),
    })
    expect(
      l.settleResponse(
        response(l),
        eof({
          input_tokens: 1_015_808,
          output_tokens: 32_768,
          input_tokens_details: { cached_tokens: 1_015_808 },
          output_tokens_details: { reasoning_tokens: 32_768 },
          total_tokens: 1_048_576,
        }),
      ),
    ).toEqual({ outcome: 'priced', chargedUsd: Usd.from(0.008586).toAmount() })
    expect(l.totals().tokens).toEqual({
      inputTokens: 1_015_809,
      outputTokens: 32_768,
      cachedTokens: 1_015_808,
      reasoningTokens: 32_768,
    })
    expect(l.totals().settledUsd).toBe(Usd.from(0.008587).toAmount())
  })
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'L1 refuses invalid counter %s without credit',
    (bad) => {
      const l = createRunLedger({ capUsd: Usd.from(1).toAmount(), maxRequests: 30 })
      expect(l.settleResponse(response(l), eof({ ...valid, input_tokens: bad }))).toEqual({
        outcome: 'full-reservation',
        chargedUsd: Usd.from(0.108135).toAmount(),
        latch: 'accounting_invalid',
      })
      expect(l.lastResponse?.usage).toBe('invalid')
      expect(l.totals().uncertainUsd).toBe(Usd.from(0.108135).toAmount())
      expect(l.admitImage('images.generations')).toEqual({ refused: 'closed' })
    },
  )
  it.each([
    { ...valid, input_tokens_details: { cached_tokens: 11 } },
    { ...valid, output_tokens_details: { reasoning_tokens: 6 } },
    { ...valid, total_tokens: 16 },
    { ...valid, total_tokens: -1 },
    { ...valid, input_tokens_details: { cached_tokens: 'zero' } },
  ])('L1 inconsistent usage closes accounting', (bad) => {
    const l = createRunLedger({ capUsd: Usd.from(1).toAmount(), maxRequests: 30 })
    expect(l.settleResponse(response(l), eof(bad)).latch).toBe('accounting_invalid')
    expect(l.totals().settledUsd).toBe(Usd.from(0).toAmount())
  })
  it.each([
    { input_tokens: 1_015_809, output_tokens: 0 },
    { input_tokens: 0, output_tokens: 32_769 },
  ])('P9/L1 reports bound breach with full reserve', (bad) => {
    const l = createRunLedger({ capUsd: Usd.from(1).toAmount(), maxRequests: 30 })
    expect(l.settleResponse(response(l), eof(bad)).latch).toBe('breach')
    expect(l.totals()).toMatchObject({
      breach: true,
      uncertainUsd: Usd.from(0.108135).toAmount(),
      settledUsd: Usd.from(0).toAmount(),
    })
  })
  it.each(['incomplete', 'failed', null])('L4 cut-short terminal %s never refunds', (terminal) => {
    const l = createRunLedger({ capUsd: Usd.from(1).toAmount(), maxRequests: 30 })
    l.settleResponse(response(l), eof(valid, terminal))
    expect(l.totals().uncertainUsd).toBe(Usd.from(0.108135).toAmount())
    expect(l.lastResponse).toMatchObject({ terminal, settlement: 'full-reservation' })
  })
  it('F2 keeps terminal, reason and semantically valid usage on aborted transport, exactly once', () => {
    const l = createRunLedger({ capUsd: Usd.from(1).toAmount(), maxRequests: 30 })
    const t = response(l)
    expect(
      l.settleResponse(t, {
        kind: 'transport',
        why: 'aborted',
        terminal: 'incomplete',
        incompleteReason: 'max_output_tokens',
        usage: valid,
      }),
    ).toEqual({ outcome: 'full-reservation', chargedUsd: Usd.from(0.108135).toAmount() })
    expect(l.lastResponse).toMatchObject({
      terminal: 'incomplete',
      incompleteReason: 'max_output_tokens',
      usage: 'valid',
      transportError: 'aborted',
      settlement: 'full-reservation',
    })
    expect(() => l.settleResponse(t, eof())).toThrow()
  })
  it.each([400, 401, 403, 429, 500])(
    'D13/L4 HTTP %s retains liability before next attempt',
    (status) => {
      const l = createRunLedger({ capUsd: Usd.from(0.216269).toAmount(), maxRequests: 30 })
      l.settleResponse(response(l), { kind: 'http', status })
      expect(l.lastResponse).toMatchObject({ httpStatus: status, terminal: null })
      expect(l.admitResponse({ model: 'm', maxOutputTokens: 32_768, price })).toEqual({
        refused: 'budget',
      })
      expect(l.totals().requests).toBe(1)
    },
  )
  it('D7 request count and closed state refuse before consuming credit', () => {
    const l = createRunLedger({ capUsd: Usd.from(1).toAmount(), maxRequests: 1 })
    l.settleResponse(response(l), eof())
    expect(l.admitImage('images.edits')).toEqual({ refused: 'requests' })
    l.close()
    expect(l.admitImage('images.edits')).toEqual({ refused: 'closed' })
    expect(l.totals().requests).toBe(1)
  })
  it('P2/P5/P6 refunds only a successful empty image return; images never replace latest response', () => {
    const l = createRunLedger({ capUsd: Usd.from(1).toAmount(), maxRequests: 30 })
    l.settleResponse(response(l), eof())
    const last = l.lastResponse
    for (const outcome of [
      { kind: 'returned', count: 1 },
      { kind: 'returned', count: 0 },
      { kind: 'http', status: 429 },
      { kind: 'unparsable' },
    ] as const) {
      const ticket = l.admitImage('images.generations')
      if ('refused' in ticket) throw new Error(ticket.refused)
      l.settleImage(ticket, outcome)
      expect(() => l.settleImage(ticket, outcome)).toThrow()
    }
    expect(l.lastResponse).toEqual(last)
    expect(l.totals().paid).toEqual({
      imageAttempts: 4,
      imagesReturned: 1,
      imagesRefunded: 1,
      imagesUncertain: 2,
      settledUsd: Usd.from(0.01).toAmount(),
      uncertainUsd: Usd.from(0.02).toAmount(),
    })
  })
  it('P9 returned image count above n marks breach without fabricated credit', () => {
    const l = createRunLedger({ capUsd: Usd.from(1).toAmount(), maxRequests: 30 })
    const ticket = l.admitImage('images.edits')
    if ('refused' in ticket) throw new Error(ticket.refused)
    expect(l.settleImage(ticket, { kind: 'returned', count: 2 })).toEqual({
      outcome: 'full-reservation',
      chargedUsd: Usd.from(0.01).toAmount(),
      latch: 'breach',
    })
    expect(l.totals().paid.imagesUncertain).toBe(1)
  })
  it.each([undefined, null])(
    'L6 missing usage keeps reservation without invalid latch',
    (usage) => {
      const l = createRunLedger({ capUsd: Usd.from(1).toAmount(), maxRequests: 30 })
      expect(l.settleResponse(response(l), { ...eof(), usage })).toEqual({
        outcome: 'full-reservation',
        chargedUsd: Usd.from(0.108135).toAmount(),
      })
      expect(l.lastResponse?.usage).toBe('missing')
    },
  )
  it('L5 invalid M/price and unsafe cap refuse', () => {
    for (const m of [0, 15, 32_769, 0.5, NaN])
      expect(
        createRunLedger({ capUsd: Usd.from(1).toAmount(), maxRequests: 30 }).admitResponse({
          model: 'm',
          maxOutputTokens: m,
          price,
        }),
      ).toEqual({ refused: 'request_shape' })
    expect(
      createRunLedger({ capUsd: Usd.from(1).toAmount(), maxRequests: 30 }).admitResponse({
        model: 'm',
        maxOutputTokens: 16,
        price: { ...price, cachedInput: Usd.from(1).toAmount() },
      }),
    ).toEqual({ refused: 'unpriced' })
    for (const cap of [0, -1, 20.000001, 0.0000001, 0.1081351, Infinity])
      expect(() => createRunLedger({ capUsd: Usd.from(cap).toAmount(), maxRequests: 1 })).toThrow()
  })
})
