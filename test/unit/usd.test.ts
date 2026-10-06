import { beforeEach, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import {
  compareUsd,
  formatUsd,
  multiplyUsd,
  parseUsd,
  subtractUsd,
  sumUsd,
  usdDecimal,
  usdNumber,
} from '../../src/shared/usd'

beforeEach(() => {
  setUiText(EN, 'en')
})

it('keeps sums, differences and rational multiplication in integer nano-USD', () => {
  expect(sumUsd([parseUsd(0.1), parseUsd(0.2)])).toBe(parseUsd(0.3))
  expect(subtractUsd(parseUsd(0.3), parseUsd(0.2))).toBe(parseUsd(0.1))
  expect(multiplyUsd(parseUsd('0.000000001'), 1n, 2n)).toBe(1n)
  expect(multiplyUsd(parseUsd('0.000000001'), 1n, 2n, 'floor')).toBe(0n)
  expect(compareUsd(parseUsd(0.1), parseUsd(0.2))).toBe(-1)
  expect(compareUsd(parseUsd(0.2), parseUsd(0.2))).toBe(0)
  expect(compareUsd(parseUsd(0.3), parseUsd(0.2))).toBe(1)
  expect(usdDecimal(subtractUsd(parseUsd(0.1), parseUsd(0.2)))).toBe('-0.1')
  expect(usdNumber(parseUsd('0.000000001'))).toBe(0.000000001)
})

it('rounds liabilities up and caps down without binary arithmetic', () => {
  expect(parseUsd('0.0000000001')).toBe(1n)
  expect(parseUsd('0.0000000001', 'floor')).toBe(0n)
  expect(parseUsd('0.1234567891')).toBe(123_456_790n)
  expect(parseUsd('0.1234567891', 'floor')).toBe(123_456_789n)
  expect(parseUsd('1e10')).toBe(10_000_000_000_000_000_000n)
  expect(parseUsd('1e-100')).toBe(1n)
  expect(parseUsd('0e10')).toBe(0n)
})

it('refuses malformed, unbounded and negative amounts and invalid divisors', () => {
  for (const value of [
    NaN,
    Infinity,
    -1,
    '',
    'x',
    '1e1000',
    '0e1000',
    '1'.repeat(129),
    '0'.repeat(129),
    Number.MAX_VALUE,
  ])
    expect(() => parseUsd(value)).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
  expect(() => parseUsd('9007199254740992')).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
  expect(() => multiplyUsd(parseUsd(1), 1n, 0n)).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
  expect(() => usdNumber(-1n)).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
  expect(() => usdNumber(sumUsd([parseUsd(Number.MAX_SAFE_INTEGER), parseUsd(1)]))).toThrow(
    UI_TEXT.sessionBudgetStoreUnavailable,
  )
  expect(() => formatUsd(-1n)).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
  for (const digits of [-1, 0.5, 10])
    expect(() => formatUsd(parseUsd(1), digits)).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
})

it.each([
  ['0.00003375', '$0.000034'],
  ['0.00011', '$0.00011'],
  ['0.002501', '$0.0026'],
  ['1.004', '$1.01'],
  ['0.000000001', '$0.000000001'],
  ['0', '$0.0000'],
])('displays %s with a ceiling and visible positive fractions', (value, displayed) => {
  expect(formatUsd(parseUsd(value))).toBe(displayed)
})

it('formats the exact fraction in the installed language, including large whole amounts', () => {
  setUiText(EN, 'de')
  expect(formatUsd(parseUsd('123456789012345.123456789'), 9)).toBe(
    '123.456.789.012.345,123456789\u{A0}$',
  )
})
