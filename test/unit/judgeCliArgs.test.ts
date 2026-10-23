import { describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { JUDGE_REQUEST_TIMEOUT_MS } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'

describe('judge command reservation', () => {
  it('reserves all supported commands before ACP parsing', () => {
    for (const action of ['ask', 'calibrate', 'report', 'mcp', 'serve', 'lint']) {
      expect(parseCommandLine(['judge', action])).toMatchObject({
        command: 'judge',
        action,
        options: {
          engine: 'auto',
          budgetUsd: Usd.from(0).toAmount(),
          timeoutMs: JUDGE_REQUEST_TIMEOUT_MS,
        },
      })
    }
  })
  it('keeps command-looking exec prompts as prompts', () => {
    expect(parseCommandLine(['exec', 'judge ask'])).toMatchObject({
      command: 'exec',
      options: { prompt: { kind: 'text', text: 'judge ask' } },
    })
  })
  it('validates all declared options without accepting extension off', () => {
    for (const engine of ['auto', 'same', 'separate', 'both']) {
      expect(
        parseCommandLine([
          'judge',
          'ask',
          '--engine',
          engine,
          '--model',
          'chosen',
          '--separate',
          'local:tev1',
          '--budget-usd',
          '0.000001',
          '--timeout-ms',
          '100',
        ]),
      ).toMatchObject({
        command: 'judge',
        options: {
          engine,
          model: 'chosen',
          separate: 'local:tev1',
          budgetUsd: Usd.from('0.000001').toAmount(),
          timeoutMs: 100,
        },
      })
    }
    expect(parseCommandLine(['judge', 'ask', '--engine', 'off'])).toMatchObject({
      command: 'invalid',
      exitCode: 2,
    })
  })
  it('refuses malformed, duplicate, unknown and prompt-shaped judge arguments at exit 2', () => {
    for (const args of [
      [],
      ['hook'],
      ['unknown'],
      ['ask', 'a prompt'],
      ['ask', '--help'],
      ['ask', '--model'],
      ['ask', '--model', ''],
      ['ask', '--separate', ' '],
      ['ask', '--engine', 'guessed'],
      ['ask', '--engine', 'same', '--engine', 'auto'],
    ]) {
      expect(parseCommandLine(['judge', ...args])).toMatchObject({
        command: 'invalid',
        exitCode: 2,
      })
    }
  })
  it('refuses negative, nonfinite, imprecise and oversized budgets', () => {
    for (const value of [
      '-1',
      'NaN',
      'Infinity',
      '1e2',
      '.1',
      '1.',
      // Ten decimals: finer than the nano-USD liability precision.
      '0.0000000001',
      '99999999999999999999999',
    ]) {
      expect(parseCommandLine(['judge', 'ask', '--budget-usd', value])).toMatchObject({
        command: 'invalid',
        exitCode: 2,
      })
    }
  })
  it('refuses zero, fractional and oversized deadlines', () => {
    for (const value of ['0', '-1', '1.5', 'Infinity', '1e2', '99999999999999999999999']) {
      expect(parseCommandLine(['judge', 'ask', '--timeout-ms', value])).toMatchObject({
        command: 'invalid',
        exitCode: 2,
      })
    }
  })
  it('accepts any positive safe integer deadline (D121: no run deadline of ours)', () => {
    // No provider publishes a run deadline, so a set --timeout-ms is any
    // positive safe integer (AUDITCLIFIX): the six-hour exec ceiling this
    // value once probed was removed as invented with EXEC_MAX_TIMEOUT_SECONDS.
    expect(parseCommandLine(['judge', 'ask', '--timeout-ms', '21600001'])).toMatchObject({
      command: 'judge',
      options: { timeoutMs: 21_600_001 },
    })
  })
  it('keeps decimal caps as canonical amounts, nine decimals (RVM98P2R2 8)', () => {
    expect(parseCommandLine(['judge', 'ask', '--budget-usd', '0.016249'])).toMatchObject({
      command: 'judge',
      options: { budgetUsd: Usd.from('0.016249').toAmount() },
    })
    expect(parseCommandLine(['judge', 'ask', '--budget-usd', '0.01'])).toMatchObject({
      command: 'judge',
      options: { budgetUsd: Usd.from('0.01').toAmount() },
    })
    // One nano-USD above a route ceiling is a different cap, not a rounding.
    expect(parseCommandLine(['judge', 'ask', '--budget-usd', '0.002688001'])).toMatchObject({
      command: 'judge',
      options: { budgetUsd: Usd.from('0.002688001').toAmount() },
    })
    expect(parseCommandLine(['judge', 'ask', '--budget-usd', '0.0026880001'])).toMatchObject({
      command: 'invalid',
      exitCode: 2,
    })
  })
  it('leaves CS and H flags to their injected parsers', () => {
    expect(parseCommandLine(['judge', 'serve', '--host', '127.0.0.1'])).toMatchObject({
      command: 'judge',
      action: 'serve',
      surfaceArgs: ['--host', '127.0.0.1'],
    })
    expect(parseCommandLine(['judge', 'lint', '--changed'])).toMatchObject({
      command: 'judge',
      action: 'lint',
      surfaceArgs: ['--changed'],
    })
  })
  it('does not echo arbitrary raw options or positional text', () => {
    const parsed = parseCommandLine(['judge', 'ask', '--private-value=sensitive-fixture'])
    expect(parsed).toMatchObject({ command: 'invalid', exitCode: 2 })
    expect(JSON.stringify(parsed)).not.toContain('sensitive-fixture')
  })
})
