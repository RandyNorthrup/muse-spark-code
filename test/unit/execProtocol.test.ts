import { describe, expect, it } from 'vitest'
import { execEventSchema, outcomeStatus } from '../../src/runtime/exec/execProtocol'

const paidUse = (usd: string) => ({
  v: 2,
  seq: 1,
  time: new Date(0).toISOString(),
  type: 'paid_use',
  feature: 'imageGeneration',
  n: 1,
  phase: 'returned',
  units: 1,
  usd,
})

describe('execProtocol fixed-unit boundary', () => {
  it('takes an exactly representable amount', () => {
    expect(() => execEventSchema.parse(paidUse('0.000001'))).not.toThrow()
  })

  it('refuses a decimal no micro-USD unit can represent exactly', () => {
    expect(() => execEventSchema.parse(paidUse('0.0000001'))).toThrow()
  })
})

describe('outcomeStatus (M110r Y1)', () => {
  it('a lost connection is incomplete, never failed', () => {
    expect(outcomeStatus(null, 'error', null)).toBe('incomplete-transport')
    expect(outcomeStatus('completed', 'error', null)).toBe('incomplete-transport')
  })
  it('an explicit failure stays failed even with a lost connection', () => {
    expect(outcomeStatus('failed', 'error', null)).toBe('failed')
  })
  it.each([['aborted'], ['tooLarge'], ['malformed']])(
    'a refused answer (%s) stays failed',
    (why) => {
      expect(outcomeStatus(null, why, null)).toBe('failed')
    },
  )
  it('an HTTP error stays failed', () => {
    expect(outcomeStatus(null, null, 500)).toBe('failed')
    expect(outcomeStatus(null, null, 399)).toBe('other')
  })
  it('a clean run falls through to the other rules', () => {
    expect(outcomeStatus('completed', null, null)).toBe('other')
    expect(outcomeStatus(null, null, null)).toBe('other')
  })
})
