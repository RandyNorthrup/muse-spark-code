import { describe, expect, it } from 'vitest'
import { execEventSchema } from '../../src/runtime/exec/execProtocol'

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
