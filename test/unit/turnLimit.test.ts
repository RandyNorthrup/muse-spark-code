import { describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { parseExec } from '../../src/runtime/exec/execArgs'
import { isTurnLimitRounds, readTurnLimit } from '../../src/shared/turnLimit'

// Lane LIMITSFIX, F8 (D113): the person's own per-turn tool-round limit is any
// whole number from 1 up, or off, on every surface. It used to accept only
// off, 25, 50, 100, 200 and 500, so a limit of 3 could not be set from the
// terminal or the editor protocol.
describe('the turn limit reading', () => {
  it('accepts off and any whole number from 1 up', () => {
    expect(readTurnLimit('off')).toEqual({ isValid: true, rounds: undefined })
    for (const text of ['1', '3', '7', '25', '73', '1000', '5000']) {
      expect(readTurnLimit(text)).toEqual({ isValid: true, rounds: Number(text) })
    }
  })

  it('refuses zero, negatives, fractions, words, padding and unsafe sizes', () => {
    const refused = ['0', '-1', '1.5', '3 ', ' 3', '03', 'many', '', 'Off', '1e3', '9'.repeat(30)]
    for (const text of refused) {
      expect(readTurnLimit(text), JSON.stringify(text)).toEqual({ isValid: false })
    }
  })

  it('agrees with the session check', () => {
    for (const value of [1, 3, 99, 100_000]) expect(isTurnLimitRounds(value)).toBe(true)
    for (const value of [0, -1, 1.5, NaN, Infinity]) {
      expect(isTurnLimitRounds(value)).toBe(false)
    }
  })
})

describe('the terminal flags', () => {
  const values = { backend: 'modelApi', 'max-budget-usd': '1' }

  it('exec takes a limit of 3, which the fixed list refused', () => {
    const parsed = parseExec({ ...values, 'max-turn-requests': '3' }, ['task'])
    expect(parsed.ok && parsed.options.maxTurnRequests).toBe(3)
  })

  it('exec still takes off and refuses what is not a whole number of rounds', () => {
    const off = parseExec({ ...values, 'max-turn-requests': 'off' }, ['task'])
    expect(off.ok && off.options.maxTurnRequests).toBeUndefined()
    expect(off.ok).toBe(true)
    for (const bad of ['0', '-4', '2.5', 'lots']) {
      expect(parseExec({ ...values, 'max-turn-requests': bad }, ['task']).ok, bad).toBe(false)
    }
  })

  it('serve takes any whole number too, and refuses the same values', () => {
    expect(parseCommandLine(['--backend', 'modelApi', '--max-turn-requests', '3'])).toMatchObject({
      command: 'serve',
      options: { maxTurnRequests: 3 },
    })
    for (const bad of ['0', '-4', '2.5', 'lots']) {
      expect(
        parseCommandLine(['--backend', 'modelApi', '--max-turn-requests', bad]).command,
        bad,
      ).toBe('invalid')
    }
  })
})
