// M121 P2-1: the v1 money JSON parse keeps each numeric literal's source
// text, so exactness never depends on the JSON reviver's third argument
// (absent on Node 20, the production host target).
import { describe, expect, it } from 'vitest'
import { parseJsonWithExactNumbers } from '../../src/shared/exactJson'
import { INEXACT_MONEY_LITERALS } from './helpers/inexactMoneyLiterals'

const MONEY = new Set(['usd', 'paidCapUsd'])

describe('parseJsonWithExactNumbers', () => {
  it.each(INEXACT_MONEY_LITERALS)(
    'fails closed for exotic money literal %s (RVM121B)',
    (literal) => {
      expect(parseJsonWithExactNumbers(`{"usd":${literal}}`, MONEY).isExact).toBe(false)
    },
  )

  it('accepts generated writer spellings at the finite double extremes', () => {
    for (const value of [
      0,
      Number.MIN_VALUE,
      Number.MAX_VALUE,
      ...[1, 2, 100].flatMap((n) => [n, n / 100, n * 1e-300, n * 1e300]),
    ]) {
      const literal = JSON.stringify(value)
      expect(parseJsonWithExactNumbers(`{"usd":${literal}}`, MONEY).isExact).toBe(true)
    }
  })

  it.each(['NaN', 'Infinity', '-Infinity'])('refuses invalid JSON money %s', (literal) => {
    expect(() => parseJsonWithExactNumbers(`{"usd":${literal}}`, MONEY)).toThrow(SyntaxError)
  })

  it('refuses the reviewer literal a double cannot carry', () => {
    const text = '{"v":1,"cost":{"usd":0.123456789012345678901}}'
    const { value, isExact } = parseJsonWithExactNumbers(text, MONEY)
    expect(isExact).toBe(false)
    // The parsed value is plain `JSON.parse` output: the rounded double.
    expect(value).toEqual(JSON.parse(text))
  })

  it('accepts written decimals a double carries, including shortest spellings', () => {
    for (const literal of ['0.17', '0.123456789', '1', '0', '1e-3', '2.5E4', '0.0000000001']) {
      expect(parseJsonWithExactNumbers(`{"usd":${literal}}`, MONEY)).toMatchObject({
        isExact: true,
      })
    }
  })

  it('ignores numbers outside money keys and non-numeric money values', () => {
    expect(
      parseJsonWithExactNumbers(
        '{"atMs":0.123456789012345678901,"usd":"0.123456789012345678901"}',
        MONEY,
      ).isExact,
    ).toBe(true)
  })

  it('pairs sources by path through nesting, arrays and reordered integer-like keys', () => {
    const text =
      '{"rows":[{"usd":0.17},{"usd":0.123456789012345678901}],"2":{"paidCapUsd":1},"x":{"paidCapUsd":2}}'
    const { value, isExact } = parseJsonWithExactNumbers(text, MONEY)
    expect(isExact).toBe(false)
    expect(value).toEqual(JSON.parse(text))
  })

  it('matches each nested literal with its own value, not a neighbour', () => {
    // The inexact literal sits under an integer-like key that `JSON.parse`
    // visits before `x`; path pairing still refuses exactly it.
    const exact = parseJsonWithExactNumbers('{"x":{"usd":0.25},"2":{"paidCapUsd":2}}', MONEY)
    expect(exact.isExact).toBe(true)
    const refused = parseJsonWithExactNumbers(
      '{"x":{"usd":0.25},"2":{"paidCapUsd":0.123456789012345678901}}',
      MONEY,
    )
    expect(refused.isExact).toBe(false)
  })

  it('reads through duplicate keys the way JSON.parse keeps the last', () => {
    expect(parseJsonWithExactNumbers('{"usd":0.17,"usd":0.25}', MONEY)).toMatchObject({
      isExact: true,
      value: { usd: 0.25 },
    })
  })

  it('sees past escaped strings, including an escaped money key', () => {
    // A money-looking literal inside a string value is not a money literal;
    // the escaped key below decodes to `usd` and holds an exact decimal.
    expect(
      parseJsonWithExactNumbers(String.raw`{"note":"{\"usd\": 0.5}","\u0075sd":0.17}`, MONEY)
        .isExact,
    ).toBe(true)
    expect(
      parseJsonWithExactNumbers('{"note":"0.123456789012345678901","usd":0.17}', MONEY).isExact,
    ).toBe(true)
  })

  it('throws on invalid text, as JSON.parse does', () => {
    expect(() => parseJsonWithExactNumbers('{"usd":', MONEY)).toThrow(SyntaxError)
  })
})
