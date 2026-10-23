import { describe, expect, it } from 'vitest'
import { readOneSetting } from './helpers/oneSetting'

function capOf(value: unknown) {
  return readOneSetting('tabMaxOutputTokens', value)
}

describe('Tab output cap setting (M94 goal, D121)', () => {
  it('takes unset and 0 as the provider maximum, and keeps a set cap whole', () => {
    expect(capOf(undefined)).toBe(0)
    expect(capOf(0)).toBe(0)
    expect(capOf(2048)).toBe(2048)
  })

  it('falls back to the provider maximum below zero and off-integer', () => {
    expect(capOf(-1)).toBe(0)
    expect(capOf(10.5)).toBe(0)
    expect(capOf('2048')).toBe(0)
  })
})
